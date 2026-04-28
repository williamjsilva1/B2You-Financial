/**
 * ═══════════════════════════════════════════════════════════════
 * firebase.js — Inicialização e Autenticação Firebase
 * Sistema de Gestão Financeira Multi-Filial
 * ═══════════════════════════════════════════════════════════════
 *
 * COMO USAR:
 * 1. Substitua os valores em FB_CONFIG com os do seu projeto Firebase
 * 2. Inclua no HTML ANTES do script principal:
 *    <script src="firebase.js"></script>
 *    <script src="firestore.js"></script>
 *
 * OBTENDO AS CREDENCIAIS:
 * Firebase Console → Configurações do Projeto → Seus apps → Web
 */

// ═══════════════════════════════════════════════════════════════
// CONFIGURAÇÃO DO FIREBASE — substitua com seus dados
// ═══════════════════════════════════════════════════════════════
const FB_CONFIG = {
  apiKey:            "AIzaSyAHm-78QNkFI93Gi9fa9yK7ne2atQINnK8",
  authDomain:        "b2youfinancialcontrol.firebaseapp.com",
  projectId:         "b2youfinancialcontrol",
  storageBucket:     "b2youfinancialcontrol.firebasestorage.app",
  messagingSenderId: "120136860530",
  appId:             "1:120136860530:web:da6c8312cf7135d8a813eb",
  // measurementId:  "SEU_MEASUREMENT_ID", // opcional (Analytics)
};

// ═══════════════════════════════════════════════════════════════
// SDKs Firebase (importação via CDN modular v10)
// ═══════════════════════════════════════════════════════════════
// Adicione estes scripts no <head> do HTML (ANTES deste arquivo):
//
// <script type="module">
//   import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
//   import { getAuth, ... }  from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
//   import { getFirestore, ... } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
//   window.FirebaseSDK = { initializeApp, getAuth, getFirestore, ... };
// </script>
//
// OU use a versão compatível (não-modular):
// <script src="https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js"></script>
// <script src="https://www.gstatic.com/firebasejs/10.12.0/firebase-auth-compat.js"></script>
// <script src="https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore-compat.js"></script>

// ═══════════════════════════════════════════════════════════════
// ESTADO GLOBAL FIREBASE
// ═══════════════════════════════════════════════════════════════
const FB = {
  app:     null,   // instância do app Firebase
  auth:    null,   // Firebase Auth
  db:      null,   // Firestore
  ready:   false,  // true quando inicializado com sucesso
  user:    null,   // usuário Firebase autenticado
  error:   null,   // último erro
};

// ═══════════════════════════════════════════════════════════════
// INICIALIZAÇÃO
// ═══════════════════════════════════════════════════════════════
function initFirebase() {
  // Verifica se as credenciais foram preenchidas
  if (FB_CONFIG.apiKey === 'SUA_API_KEY') {
    console.warn('[Firebase] Credenciais não configuradas. Usando localStorage como fallback.');
    return false;
  }

  // Verifica se o SDK está disponível (compat mode)
  if (typeof firebase === 'undefined') {
    console.error('[Firebase] SDK não carregado. Verifique os scripts no <head>.');
    return false;
  }

  try {
    // Inicializa o app (evita duplicar se já iniciado)
    if (!firebase.apps.length) {
      FB.app = firebase.initializeApp(FB_CONFIG);
    } else {
      FB.app = firebase.app();
    }

    FB.auth = firebase.auth();
    FB.db   = firebase.firestore();

    // Configurações de persistência offline
    FB.db.settings({ cacheSizeBytes: firebase.firestore.CACHE_SIZE_UNLIMITED });
    FB.db.enablePersistence({ synchronizeTabs: true })
      .catch(err => {
        if (err.code === 'failed-precondition') {
          console.warn('[Firestore] Múltiplas abas abertas — persistência offline desativada.');
        } else if (err.code === 'unimplemented') {
          console.warn('[Firestore] Navegador não suporta persistência offline.');
        }
      });

    FB.ready = true;
    console.info('[Firebase] ✅ Inicializado com sucesso. Projeto:', FB_CONFIG.projectId);
    return true;

  } catch (err) {
    FB.error = err;
    FB.ready = false;
    console.error('[Firebase] Falha na inicialização:', err.message);
    return false;
  }
}

// ═══════════════════════════════════════════════════════════════
// AUTENTICAÇÃO — Login com email e senha
// ═══════════════════════════════════════════════════════════════

/**
 * Faz login via Firebase Authentication
 * @param {string} email
 * @param {string} senha
 * @returns {Promise<{user, error}>}
 */
async function fbLogin(email, senha) {
  if (!FB.ready) return { user: null, error: 'Firebase não inicializado' };

  try {
    const credential = await FB.auth.signInWithEmailAndPassword(email, senha);
    FB.user = credential.user;
    console.info('[Firebase Auth] Login efetuado:', email);
    return { user: credential.user, error: null };
  } catch (err) {
    const msgs = {
      'auth/user-not-found':       'Usuário não encontrado.',
      'auth/wrong-password':       'Senha incorreta.',
      'auth/invalid-credential':   'Email ou senha incorretos.',
      'auth/too-many-requests':    'Muitas tentativas. Tente novamente mais tarde.',
      'auth/network-request-failed': 'Sem conexão com a internet.',
      'auth/user-disabled':        'Usuário desativado. Contate o administrador.',
      'auth/invalid-email':        'Formato de email inválido.',
    };
    const msg = msgs[err.code] || 'Erro no login: ' + err.message;
    console.warn('[Firebase Auth] Falha no login:', err.code, msg);
    return { user: null, error: msg };
  }
}

/**
 * Faz logout do Firebase
 */
async function fbLogout() {
  if (!FB.ready) return;
  try {
    await FB.auth.signOut();
    FB.user = null;
    console.info('[Firebase Auth] Logout efetuado.');
  } catch (err) {
    console.warn('[Firebase Auth] Erro no logout:', err.message);
  }
}

/**
 * Cria um novo usuário no Firebase Authentication
 * @param {string} email
 * @param {string} senha
 * @returns {Promise<{uid, error}>}
 */
async function fbCriarUsuario(email, senha) {
  if (!FB.ready) return { uid: null, error: 'Firebase não inicializado' };

  try {
    const credential = await FB.auth.createUserWithEmailAndPassword(email, senha);
    console.info('[Firebase Auth] Usuário criado:', email);
    return { uid: credential.user.uid, error: null };
  } catch (err) {
    const msgs = {
      'auth/email-already-in-use': 'Este email já está cadastrado.',
      'auth/weak-password':        'Senha fraca (mínimo 6 caracteres).',
      'auth/invalid-email':        'Formato de email inválido.',
    };
    return { uid: null, error: msgs[err.code] || err.message };
  }
}

/**
 * Altera a senha do usuário logado
 * @param {string} novaSenha
 * @returns {Promise<{success, error}>}
 */
async function fbAlterarSenha(novaSenha) {
  if (!FB.ready || !FB.user) return { success: false, error: 'Não autenticado' };
  try {
    await FB.user.updatePassword(novaSenha);
    return { success: true, error: null };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Envia email de redefinição de senha
 * @param {string} email
 */
async function fbResetSenha(email) {
  if (!FB.ready) return { success: false, error: 'Firebase não inicializado' };
  try {
    await FB.auth.sendPasswordResetEmail(email);
    return { success: true, error: null };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Escuta mudanças no estado de autenticação
 * @param {function} callback - chamado com (user) quando o estado muda
 * @returns {function} unsubscribe
 */
function fbOnAuthChange(callback) {
  if (!FB.ready) return () => {};
  return FB.auth.onAuthStateChanged(user => {
    FB.user = user;
    callback(user);
  });
}

/**
 * Retorna o usuário Firebase atualmente autenticado
 */
function fbGetCurrentUser() {
  return FB.ready ? FB.auth.currentUser : null;
}

/**
 * Retorna o token JWT do usuário para chamadas autenticadas
 */
async function fbGetToken() {
  if (!FB.ready || !FB.user) return null;
  try {
    return await FB.user.getIdToken();
  } catch (e) {
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════
// AUTO-INICIALIZAÇÃO
// ═══════════════════════════════════════════════════════════════
// Inicializa quando o script é carregado (se SDK disponível)
if (typeof firebase !== 'undefined') {
  initFirebase();
} else {
  // Aguarda o SDK carregar via window.onload
  window.addEventListener('load', () => {
    if (typeof firebase !== 'undefined') initFirebase();
  });
}

// Exporta para uso no script principal
window.FB       = FB;
window.fbLogin  = fbLogin;
window.fbLogout = fbLogout;
window.fbCriarUsuario  = fbCriarUsuario;
window.fbAlterarSenha  = fbAlterarSenha;
window.fbResetSenha    = fbResetSenha;
window.fbOnAuthChange  = fbOnAuthChange;
window.fbGetCurrentUser = fbGetCurrentUser;
window.fbGetToken      = fbGetToken;
window.initFirebase    = initFirebase;
