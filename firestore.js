// ══════════════════════════════════════════════════════════════
// firestore.js
// Camada de dados: cache, leitura/escrita no Firestore,
// listeners em tempo real, polling, keep-alive, registro de usuário
// ══════════════════════════════════════════════════════════════

// ── Caminhos no Firestore ───────────────────────────────────
// Globais:  dados/g__fil  dados/g__usr  dados/g__pc  dados/g__app
// Filiais:  dados/{fid}__{col}   ex: dados/f1__cp
const _fsGlobalPath = key => `dados/g__${key.replace(/^__(.+)__$/,'$1')}`;
const _fsFilialPath = (fid, col) => `dados/${fid}__${col}`;

// Coleções por filial
const FS_COLS = [
  'cp','cr','despesas','vendas','escala',
  'forn','colab','prest','atrac',
  'hosp','pousada','voo',
  'prod','ent','said','cont','pedidos',
  'rh_func','rh_folha','rh_ferias','rh_ponto','rh_deslig',
  'docs','caixa','com'
];

// ══════════════════════════════════════════════════════════════
// CACHE EM MEMÓRIA
// Fonte única de verdade para a UI após o primeiro load.
// localStorage é apenas bootstrap (lido antes do Firestore responder)
// e cache offline (gravado sem base64 para não exceder quota).
// ══════════════════════════════════════════════════════════════
const K = 'gf_v3';
let _cache      = {};
let _cacheReady = false;

// Retorna o cache. Usa localStorage apenas antes do primeiro load do Firestore.
const ld = () => {
  if (_cacheReady) return _cache;
  try {
    const ls = localStorage.getItem(K);
    return ls ? JSON.parse(ls) : {};
  } catch { return {}; }
};

// Persiste no cache em memória e no localStorage (sem base64 para não explodir a quota)
function _saveCache(db) {
  _cache      = db;
  _cacheReady = true;
  try {
    const lean  = JSON.parse(JSON.stringify(db));
    const strip = arr => Array.isArray(arr) ? arr.map(it => {
      if (!it || typeof it !== 'object') return it;
      const n = { ...it };
      if (typeof n.foto   === 'string' && n.foto.startsWith('data:'))   n.foto   = '';
      if (typeof n.anexo  === 'string' && n.anexo.startsWith('data:'))  n.anexo  = '';
      return n;
    }) : arr;
    Object.keys(lean).forEach(k => {
      if (!lean[k] || typeof lean[k] !== 'object') return;
      if (Array.isArray(lean[k])) lean[k] = strip(lean[k]);
      else Object.keys(lean[k]).forEach(k2 => {
        if (Array.isArray(lean[k][k2])) lean[k][k2] = strip(lean[k][k2]);
      });
    });
    localStorage.setItem(K, JSON.stringify(lean));
  } catch (e) {
    // Fallback mínimo (sem dados de filiais) se quota excedida
    try {
      const m = { __fil__: db.__fil__, __usr__: db.__usr__, __pc__: db.__pc__, __app__: db.__app__ };
      localStorage.setItem(K, JSON.stringify(m));
    } catch (e2) {}
  }
}

// ══════════════════════════════════════════════════════════════
// ESCRITA NO FIRESTORE
// Base64 cru é sempre removido antes de enviar (limite 1MB/doc)
// ══════════════════════════════════════════════════════════════
function _cleanList(lista) {
  if (!Array.isArray(lista)) return lista || [];
  return lista.map(it => {
    if (!it || typeof it !== 'object') return it;
    const n = { ...it };
    if (typeof n.foto  === 'string' && n.foto.startsWith('data:'))  n.foto  = '';
    if (typeof n.anexo === 'string' && n.anexo.startsWith('data:')) n.anexo = '';
    return n;
  });
}

function _writeCol(fid, col, lista) {
  if (!_fbReady) return Promise.resolve();
  const clean = _cleanList(lista);
  return _fbDb.doc(_fsFilialPath(fid, col))
    .set({ lista: clean, updatedAt: firebase.firestore.FieldValue.serverTimestamp() })
    .then(() => console.info('[FS] ✅ write', fid, col, clean.length, 'itens'))
    .catch(e => console.error('[FS] ❌ write', fid, col, e.code || e.message));
}

function _writeGlobal(key, data) {
  if (!_fbReady) return Promise.resolve();
  return _fbDb.doc(_fsGlobalPath(key))
    .set({ data, updatedAt: firebase.firestore.FieldValue.serverTimestamp() })
    .then(() => console.info('[FS] ✅ global', key))
    .catch(e => console.error('[FS] ❌ global', key, e.code || e.message));
}

// ── Aliases de compatibilidade ──────────────────────────────
const _syncCol = (fid, col, lista) => _writeCol(fid, col, lista);
const sfd      = (db, fid, col, d) => { if (!db[fid]) db[fid] = {}; db[fid][col] = d; };
const gfd      = (db, fid, col)    => (db[fid] && db[fid][col]) || [];

// sv() — salva todo o db (legado)
const sv = d => {
  _saveCache(d);
  ['__fil__','__usr__','__pc__','__app__'].forEach(k => {
    if (d[k] !== undefined) _writeGlobal(k, d[k]);
  });
  (d['__fil__'] || []).forEach(fil => {
    const fid = fil.id;
    if (!d[fid]) return;
    FS_COLS.forEach(col => {
      if (d[fid][col] !== undefined) _writeCol(fid, col, d[fid][col]);
    });
  });
};

// ══════════════════════════════════════════════════════════════
// LEITURA DO FIRESTORE — SEMPRE DO SERVIDOR
// Usa {source:'server'} para ignorar o cache do SDK.
// Fallback para cache SDK se offline.
// ══════════════════════════════════════════════════════════════
async function _getServer(path) {
  try {
    return await _fbDb.doc(path).get({ source: 'server' });
  } catch (e) {
    try { return await _fbDb.doc(path).get(); } catch { return null; }
  }
}

// Carrega os 4 documentos globais do servidor
async function _fbLoadGlobal() {
  if (!_fbReady) return false;
  const KEYS  = ['__fil__','__usr__','__pc__','__app__'];
  const db    = JSON.parse(localStorage.getItem(K) || '{}');
  const snaps = await Promise.all(KEYS.map(k => _getServer(_fsGlobalPath(k))));
  let hasData = false;
  KEYS.forEach((k, i) => {
    const snap = snaps[i];
    if (snap && snap.exists) {
      const d = snap.data();
      if (d && d.data !== undefined) { db[k] = d.data; hasData = true; }
    }
  });
  if (!db['__fil__'] || !db['__fil__'].length)
    db['__fil__'] = [{ id: 'f1', nome: 'Filial Principal', modulos: [] }];
  _saveCache(db);
  return hasData;
}

// Carrega todas as coleções de todas as filiais do servidor (background)
async function _fbLoadFiliais(cb) {
  if (!_fbReady) return;
  const fils = gfil();
  const db   = { ..._cache };
  for (const fil of fils) {
    const fid   = fil.id;
    db[fid]     = db[fid] || {};
    const snaps = await Promise.all(
      FS_COLS.map(col => _getServer(_fsFilialPath(fid, col)))
    );
    let changed = false;
    FS_COLS.forEach((col, i) => {
      const snap = snaps[i];
      if (snap && snap.exists) {
        const d = snap.data();
        if (Array.isArray(d.lista)) { db[fid][col] = d.lista; changed = true; }
      }
    });
    if (changed) {
      _saveCache(db);
      if (typeof cb === 'function') cb();
    }
  }
  console.info('[FB] ✅ Filiais carregadas do servidor');
}

// ══════════════════════════════════════════════════════════════
// LISTENERS EM TEMPO REAL
// includeMetadataChanges:false = só eventos confirmados pelo servidor
// Sem ecos de escritas locais, sem snapshots do cache SDK.
// ══════════════════════════════════════════════════════════════
let _listeners = [];

function _startRealtimeListeners() {
  if (!_fbReady) { console.warn('[RT] Firebase não pronto'); return; }
  _stopRealtimeListeners();

  // 4 documentos globais
  ['__fil__','__usr__','__pc__','__app__'].forEach(key => {
    const unsub = _fbDb.doc(_fsGlobalPath(key))
      .onSnapshot({ includeMetadataChanges: false }, snap => {
        if (!snap.exists || snap.metadata.hasPendingWrites) return;
        const d = snap.data();
        if (!d || d.data === undefined) return;
        _cache[key] = d.data;
        _saveCache(_cache);
        const origem = snap.metadata.fromCache ? '[cache]' : '[servidor]';
        console.info('[RT] global', key, origem);
        renderDebounced(250);
      }, e => console.warn('[RT] erro global', key, e.code));
    _listeners.push(unsub);
  });

  // Filial ativa
  const fid = (typeof S !== 'undefined' && S.fid) || gfil()[0]?.id;
  if (fid) _listenFilialCols(fid);

  console.info('[RT] ✅', _listeners.length, 'listeners ativos');
}

function _listenFilialCols(fid) {
  if (!fid || !_fbReady) return;
  // Remove listeners de filial anteriores, mantém os 4 globais
  _listeners.slice(4).forEach(u => { try { u(); } catch (e) {} });
  _listeners = _listeners.slice(0, 4);

  FS_COLS.forEach(col => {
    const unsub = _fbDb.doc(_fsFilialPath(fid, col))
      .onSnapshot({ includeMetadataChanges: false }, snap => {
        if (!snap.exists || snap.metadata.hasPendingWrites) return;
        const d = snap.data();
        if (!d || !Array.isArray(d.lista)) return;
        if (!_cache[fid]) _cache[fid] = {};
        _cache[fid][col] = d.lista;
        _saveCache(_cache);
        if (typeof S !== 'undefined' && S.fid === fid) renderDebounced(250);
      }, () => {});
    _listeners.push(unsub);
  });
}

function _stopRealtimeListeners() {
  _listeners.forEach(u => { try { u(); } catch (e) {} });
  _listeners = [];
}

// ══════════════════════════════════════════════════════════════
// KEEP-ALIVE + POLLING + HEALTH CHECK
// ══════════════════════════════════════════════════════════════
let _keepAliveTmr = null;
let _pollTmr      = null;
let _healthTmr    = null;
let _lastRenderTime = Date.now();
let _lastPollTs     = {};

// Mantém a conexão WebSocket ativa (evita timeout de 90s do Firestore)
function _startKeepAlive() {
  _stopKeepAlive();
  _keepAliveTmr = setInterval(async () => {
    if (!_fbReady || !_fbUid || typeof S === 'undefined' || !S.ok || document.hidden) return;
    try { await _fbDb.doc(_fsGlobalPath('__app__')).get({ source: 'server' }).catch(() => {}); } catch (e) {}
  }, 90 * 1000);
}
function _stopKeepAlive() {
  if (_keepAliveTmr) { clearInterval(_keepAliveTmr); _keepAliveTmr = null; }
}

// Verifica a cada 10s se há mudanças que os listeners possam ter perdido
function _startPolling() {
  _stopPolling();
  _pollTmr = setInterval(async () => {
    if (!_fbReady || !_fbUid || typeof S === 'undefined' || !S.ok || document.hidden) return;
    try {
      const fid  = S.fid; if (!fid) return;
      const snap = await _fbDb.doc(_fsFilialPath(fid, 'cp')).get({ source: 'server' }).catch(() => null);
      if (!snap || !snap.exists) return;
      const serverTs  = snap.data()?.updatedAt?.toMillis?.() || 0;
      const lastKnown = _lastPollTs[fid] || 0;
      if (serverTs > lastKnown) {
        console.info('[Poll] Mudança detectada em', fid, '— recarregando...');
        _lastPollTs[fid] = serverTs;
        await _fbLoadFiliais(() => { if (S.ok) renderDebounced(200); });
      }
    } catch (e) {}
  }, 10 * 1000);
}
function _stopPolling() {
  if (_pollTmr) { clearInterval(_pollTmr); _pollTmr = null; }
}

// Reinicia listeners se a UI ficar mais de 3 min sem re-render
function _startHealthCheck() {
  if (_healthTmr) clearInterval(_healthTmr);
  _healthTmr = setInterval(() => {
    if (typeof S === 'undefined' || !S.ok || !_fbReady) return;
    if (Date.now() - _lastRenderTime > 3 * 60 * 1000) {
      console.warn('[Health] Inatividade detectada — reiniciando listeners');
      _stopRealtimeListeners();
      _startRealtimeListeners();
    }
  }, 60 * 1000);
}

// Resincroniza quando a aba volta ao foco
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState !== 'visible' || !_fbReady || typeof S === 'undefined' || !S.ok) return;
  console.info('[Vis] Aba voltou ao foco — sincronizando...');
  _stopRealtimeListeners();
  _startRealtimeListeners();
  _lastPollTs = {};
  await _fbLoadGlobal().catch(() => {});
  renderDebounced(200);
  _fbLoadFiliais(() => { if (S.ok) renderDebounced(200); }).catch(() => {});
});

// Inicia / para todos os serviços de sincronização
function _startAllServices() {
  _startRealtimeListeners();
  _startKeepAlive();
  _startPolling();
  _startHealthCheck();
}
function _stopAllServices() {
  _stopRealtimeListeners();
  _stopKeepAlive();
  _stopPolling();
}

// ══════════════════════════════════════════════════════════════
// SETTERS GLOBAIS
// ══════════════════════════════════════════════════════════════
function _setGlobal(key, data) {
  const db = ld(); db[key] = data; _saveCache(db); _writeGlobal(key, data);
}
const sfil = f => _setGlobal('__fil__', f);
const sus  = u => _setGlobal('__usr__', u);
const spc  = p => _setGlobal('__pc__', p);
const sapp = a => { _setGlobal('__app__', a); document.title = a.nome || 'Gestão Financeira'; };

const gfil = () => { const db = ld(); return db['__fil__'] || [{ id: 'f1', nome: 'Filial Principal' }]; };
const gus  = () => { const db = ld(); return db['__usr__'] || [{ id: 'u1', nome: 'Administrador', email: 'admin@empresa.com', senha: '123456', perfil: 'admin', filiais: [] }]; };
const gpc  = () => { const db = ld(); return db['__pc__']  || []; };
const gapp = () => { const db = ld(); return db['__app__'] || { nome: 'B2You Financial Control', sub: 'Sistema de Gestão Financeira' }; };

// ══════════════════════════════════════════════════════════════
// REGISTRO DE USUÁRIO
// ══════════════════════════════════════════════════════════════
async function _registrarUsuario(fbUser) {
  if (!fbUser) return null;
  const db = ld();
  if (!db['__fil__'] || !db['__fil__'].length)
    db['__fil__'] = [{ id: 'f1', nome: 'Filial Principal', modulos: [] }];
  if (!db['__usr__']) db['__usr__'] = [];
  const users = db['__usr__'];
  const idx   = users.findIndex(x =>
    x.id === fbUser.uid || (x.email || '').toLowerCase() === (fbUser.email || '').toLowerCase()
  );
  let u;
  if (idx >= 0) {
    u = users[idx];
    u.id    = fbUser.uid;
    u.email = fbUser.email;
    if (!u.nomePersonalizado && fbUser.displayName) u.nome = fbUser.displayName;
    u.fotoUrl      = fbUser.photoURL || u.fotoUrl || '';
    u.ultimoAcesso = new Date().toISOString();
    u.provedor     = fbUser.providerData?.[0]?.providerId || 'password';
    if (!u.statusAcesso) u.statusAcesso = 'aprovado';
    if (!u.modulos || u.modulos.length === 0) u.modulos = []; // [] = acesso total
    users[idx] = u;
  } else {
    const isFirst = users.length === 0;
    u = {
      id: fbUser.uid,
      nome: fbUser.displayName || fbUser.email.split('@')[0],
      email: fbUser.email,
      perfil: isFirst ? 'admin' : 'usuario',
      filiais: [], modulos: [], statusAcesso: 'aprovado',
      fotoUrl: fbUser.photoURL || '',
      provedor: fbUser.providerData?.[0]?.providerId || 'password',
      criadoEm: new Date().toISOString(),
      ultimoAcesso: new Date().toISOString(),
      nomePersonalizado: false,
    };
    users.push(u);
    console.info('[Auth] Novo usuário:', u.email, '— perfil:', u.perfil);
  }
  db['__usr__'] = users;
  _saveCache(db);
  if (_fbReady) {
    try {
      await _fbDb.doc(_fsGlobalPath('__usr__')).set({
        data: users, updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
    } catch (e) { console.warn('[FB] Sync usuário:', e.code || e.message); }
  }
  return u;
}

// ══════════════════════════════════════════════════════════════
// MIGRAÇÃO: caminhos antigos → novo caminho compartilhado
// ══════════════════════════════════════════════════════════════
async function _migrarDadosAntigos(uid) {
  if (!_fbReady || !uid) return false;
  let migrou = false;
  const ts   = firebase.firestore.FieldValue.serverTimestamp();
  for (const k of ['__fil__','__usr__','__pc__','__app__']) {
    try {
      const snap = await _fbDb.doc(`sistema/${uid}/global/${k}`).get();
      if (snap.exists) {
        const d = snap.data();
        if (d && d.data !== undefined) {
          await _fbDb.doc(_fsGlobalPath(k)).set({ data: d.data, updatedAt: ts });
          migrou = true;
        }
      }
    } catch (e) {}
  }
  try {
    const filSnap = await _fbDb.doc(`sistema/${uid}/global/__fil__`).get();
    if (filSnap.exists) {
      const fils = filSnap.data()?.data || [];
      for (const fil of fils) {
        for (const col of FS_COLS) {
          try {
            const s = await _fbDb.doc(`dados/${uid}/${fil.id}/${col}`).get();
            if (s.exists) {
              const d = s.data();
              if (d && Array.isArray(d.lista) && d.lista.length > 0) {
                await _fbDb.doc(_fsFilialPath(fil.id, col)).set({ lista: d.lista, updatedAt: ts });
                migrou = true;
              }
            }
          } catch (e) {}
        }
      }
    }
  } catch (e) {}
  if (migrou) console.info('[FB] ✅ Migração concluída');
  return migrou;
}

async function _uploadLocalParaFirestore() {
  if (!_fbReady) return;
  const db = JSON.parse(localStorage.getItem(K) || '{}');
  const ts = firebase.firestore.FieldValue.serverTimestamp();
  for (const k of ['__fil__','__usr__','__pc__','__app__']) {
    if (db[k] === undefined) continue;
    try {
      const snap = await _fbDb.doc(_fsGlobalPath(k)).get();
      if (!snap.exists) await _fbDb.doc(_fsGlobalPath(k)).set({ data: db[k], updatedAt: ts });
    } catch (e) {}
  }
  const fils = db['__fil__'] || [];
  for (const fil of fils) {
    const fid = fil.id; if (!db[fid]) continue;
    for (const col of FS_COLS) {
      if (!db[fid][col] || !db[fid][col].length) continue;
      try {
        const snap = await _fbDb.doc(_fsFilialPath(fid, col)).get();
        if (!snap.exists)
          await _fbDb.doc(_fsFilialPath(fid, col)).set({ lista: db[fid][col], updatedAt: ts });
      } catch (e) {}
    }
  }
}

// ══════════════════════════════════════════════════════════════
// LOG DO SISTEMA
// ══════════════════════════════════════════════════════════════
function addLog(acao, modulo, detalhe, extra) {
  try {
    const user  = typeof S !== 'undefined' ? S.user : null;
    const entry = {
      id: uid(), ts: new Date().toISOString(), data: td(),
      hora: new Date().toLocaleTimeString('pt-BR', { hour:'2-digit', minute:'2-digit', second:'2-digit' }),
      userId: user?.id || '?', userName: user?.nome || 'Sistema', userEmail: user?.email || '',
      acao, modulo, detalhe, extra: extra || '',
      filial: gfil().find(f => f.id === (typeof S !== 'undefined' ? S.fid : null))?.nome || '',
    };
    const K_LOG = 'gf_logs_v1';
    let logs = [];
    try { logs = JSON.parse(localStorage.getItem(K_LOG) || '[]'); } catch {}
    logs.unshift(entry);
    if (logs.length > 5000) logs = logs.slice(0, 5000);
    localStorage.setItem(K_LOG, JSON.stringify(logs));
    if (_fbReady) _fbDb.collection('logs').add(entry).catch(() => {});
  } catch (e) {}
}

function getLogs() {
  try { return JSON.parse(localStorage.getItem('gf_logs_v1') || '[]'); } catch { return []; }
}

// ── Compatibilidade com código legado ──────────────────────
async function _fbSyncAll(db) { return sv(db); }
async function _fsSet(path, data) {
  if (!_fbReady || !_fbUid) return;
  await _fbDb.doc(path).set(data);
}
