// ══════════════════════════════════════════════════════════════
// firebase.js
// Inicialização do Firebase App, Auth e Storage
// Funções: initFirebase, _comprimirImagem, _uploadStorage, _processarAnexo
// ══════════════════════════════════════════════════════════════

const firebaseConfig = {
  apiKey:            "AIzaSyAHm-78QNkFI93Gi9fa9yK7ne2atQINnK8",
  authDomain:        "b2youfinancialcontrol.firebaseapp.com",
  projectId:         "b2youfinancialcontrol",
  storageBucket:     "b2youfinancialcontrol.firebasestorage.app",
  messagingSenderId: "120136860530",
  appId:             "1:120136860130:web:da6c8312cf7135d8a813eb"
};

// ── Instâncias globais ──────────────────────────────────────
let _fbApp     = null;
let _fbAuth    = null;
let _fbDb      = null;
let _fbStorage = null;
let _fbReady   = false;
let _fbUid     = null;

// ── Inicializa todos os serviços Firebase ───────────────────
function initFirebase() {
  if (_fbReady) return true;
  try {
    _fbApp     = firebase.initializeApp(firebaseConfig);
    _fbAuth    = firebase.auth();
    _fbDb      = firebase.firestore();
    _fbStorage = firebase.storage();
    // Sem cache persistente — dados sempre frescos do servidor
    _fbDb.settings({ merge: true });
    _fbReady = true;
    console.info('[Firebase] ✅ Inicializado — projeto:', firebaseConfig.projectId);
    return true;
  } catch (e) {
    console.error('[Firebase] ❌ Falha ao inicializar:', e);
    return false;
  }
}

// ══════════════════════════════════════════════════════════════
// STORAGE — Upload de Anexos e Fotos
// Caminho: /anexos/{fid}/{col}/{itemId}/{fileName}
// ══════════════════════════════════════════════════════════════

// Limite seguro para o Firestore (1MB/doc — margem de 300KB)
const FIRESTORE_MAX = 700 * 1024;

// Comprime imagem base64 para o tamanho máximo em KB
async function _comprimirImagem(dataUrl, maxKB = 150) {
  return new Promise(resolve => {
    try {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let w = img.width, h = img.height;
        const MAX_DIM = 1200;
        if (w > MAX_DIM || h > MAX_DIM) {
          if (w > h) { h = Math.round(h * MAX_DIM / w); w = MAX_DIM; }
          else       { w = Math.round(w * MAX_DIM / h); h = MAX_DIM; }
        }
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        let quality = 0.75;
        let result  = canvas.toDataURL('image/jpeg', quality);
        while (result.length > maxKB * 1024 * 1.37 && quality > 0.2) {
          quality -= 0.1;
          result   = canvas.toDataURL('image/jpeg', quality);
        }
        resolve(result);
      };
      img.onerror = () => resolve(dataUrl);
      img.src = dataUrl;
    } catch (e) {
      resolve(dataUrl);
    }
  });
}

// Faz upload de um base64 para o Firebase Storage e retorna a URL pública
async function _uploadStorage(dataUrl, fileName, fid, col, itemId) {
  if (!_fbReady || !_fbStorage || !_fbUid) return null;
  try {
    const parts = dataUrl.split(',');
    const mime  = parts[0].match(/:(.*?);/)?.[1] || 'application/octet-stream';
    const bytes = atob(parts[1]);
    const arr   = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
    const blob  = new Blob([arr], { type: mime });
    const path  = `anexos/${fid}/${col}/${itemId}/${fileName}`;
    const snap  = await _fbStorage.ref(path).put(blob, { contentType: mime });
    const url   = await snap.ref.getDownloadURL();
    console.info('[Storage] ✅ Upload concluído:', path);
    return url;
  } catch (e) {
    console.warn('[Storage] ❌ Falha no upload:', e.code || e.message);
    return null;
  }
}

// Processa anexo/foto de um item antes de salvar:
// — Imagem: comprime; faz upload se > FIRESTORE_MAX
// — PDF:    faz upload se > FIRESTORE_MAX; senão mantém base64
async function _processarAnexo(item, fid, col) {
  const itemId = item.id || uid();

  // Foto (câmera ou galeria)
  if (item.foto && item.foto.startsWith('data:image')) {
    const comp = await _comprimirImagem(item.foto, 150);
    item.foto  = comp;
    if (comp.length > FIRESTORE_MAX) {
      const url = await _uploadStorage(comp, 'foto_' + itemId + '.jpg', fid, col, itemId);
      if (url) { item.fotoUrl = url; item.foto = ''; }
      else      { item.foto = ''; item.fotoUrl = ''; }
    }
  }

  // PDF ou outro arquivo
  if (item.anexo && item.anexo.startsWith('data:')) {
    if (item.anexo.length > FIRESTORE_MAX) {
      const nome = item.anexoNome || ('anexo_' + itemId + '.pdf');
      const url  = await _uploadStorage(item.anexo, nome, fid, col, itemId);
      if (url) { item.anexoUrl = url; item.anexo = ''; }
      else      { item.anexo = ''; item.anexoUrl = ''; }
    }
  }

  return item;
}
