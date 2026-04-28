/**
 * ═══════════════════════════════════════════════════════════════
 * firestore.js — Camada de Dados Firestore
 * Sistema de Gestão Financeira Multi-Filial
 * ═══════════════════════════════════════════════════════════════
 *
 * ESTRUTURA NO FIRESTORE:
 *
 * /sistema/config              → configurações globais (nome do app, etc.)
 * /usuarios/{uid}              → dados dos usuários
 * /filiais/{filialId}          → dados de cada filial
 * /filiais/{filialId}/dados/{colecao}  → subcoleções de dados
 *
 * COLEÇÕES POR FILIAL:
 *   cp, cr, despesas, vendas, escala
 *   forn, colab, prest, atrac, hosp
 *   pousada, voo
 *   prod, ent, said, cont, pedidos
 *   rh_func, rh_folha, rh_ferias, rh_ponto
 *
 * COMO USAR:
 * 1. Inclua firebase.js antes deste arquivo
 * 2. Chame await FS.init() após fbOnAuthChange
 * 3. Use FS.get(filialId, colecao) e FS.set(filialId, colecao, dados)
 *    como substitutos de gfd() e sfd()+sv()
 */

// ═══════════════════════════════════════════════════════════════
// MAPEAMENTO: colecao local → caminho Firestore
// ═══════════════════════════════════════════════════════════════
const FS_COLLECTIONS = [
  // Financeiro
  'cp', 'cr', 'despesas', 'vendas', 'escala',
  // Cadastros
  'forn', 'colab', 'prest', 'atrac', 'hosp',
  // Agendas
  'pousada', 'voo',
  // Estoque
  'prod', 'ent', 'said', 'cont', 'pedidos',
  // RH
  'rh_func', 'rh_folha', 'rh_ferias', 'rh_ponto',
];

// Coleções globais (não pertencem a uma filial específica)
const FS_GLOBAL = ['filiais', 'usuarios', 'planoContas', 'config'];

// ═══════════════════════════════════════════════════════════════
// CACHE EM MEMÓRIA (performance — evita leituras desnecessárias)
// ═══════════════════════════════════════════════════════════════
const FS_CACHE = {
  _data: {},          // { [filialId]: { [colecao]: [...] } }
  _global: {},        // { __fil__: [...], __usr__: [...], ... }
  _loaded: new Set(), // filiais já carregadas
  _listeners: [],     // unsubscribe functions de real-time listeners

  get(filialId, col) {
    return this._data[filialId]?.[col] || [];
  },
  getGlobal(key) {
    return this._global[key];
  },
  set(filialId, col, data) {
    if (!this._data[filialId]) this._data[filialId] = {};
    this._data[filialId][col] = data;
  },
  setGlobal(key, data) {
    this._global[key] = data;
  },
  clear() {
    this._data = {};
    this._global = {};
    this._loaded.clear();
    this._listeners.forEach(u => u());
    this._listeners = [];
  },
};

// ═══════════════════════════════════════════════════════════════
// FIRESTORE HELPER — caminhos de documentos
// ═══════════════════════════════════════════════════════════════
function fsPath(filialId, col) {
  return `filiais/${filialId}/dados/${col}`;
}
function fsGlobalPath(key) {
  return `sistema/${key.replace(/^__(.+)__$/, '$1')}`;
}

// ═══════════════════════════════════════════════════════════════
// FS — INTERFACE PRINCIPAL
// ═══════════════════════════════════════════════════════════════
const FS = {

  ready: false,

  // ─── INICIALIZAÇÃO ─────────────────────────────────────────
  /**
   * Inicializa o Firestore e carrega os dados globais.
   * Chame após login bem-sucedido.
   */
  async init() {
    if (!FB.ready || !FB.db) {
      console.warn('[Firestore] Firebase não pronto. Usando localStorage.');
      return false;
    }
    try {
      await this.loadGlobal();
      this.ready = true;
      console.info('[Firestore] ✅ Inicializado.');
      return true;
    } catch (err) {
      console.error('[Firestore] Falha na inicialização:', err);
      return false;
    }
  },

  // ─── DADOS GLOBAIS ──────────────────────────────────────────
  /**
   * Carrega filiais, usuários, plano de contas e config do sistema
   */
  async loadGlobal() {
    const db = FB.db;
    const docs = await Promise.all([
      db.doc('sistema/filiais').get(),
      db.doc('sistema/usuarios').get(),
      db.doc('sistema/planoContas').get(),
      db.doc('sistema/config').get(),
    ]);

    FS_CACHE.setGlobal('__fil__', docs[0] && docs[0].exists ? docs[0].data().lista || [] : [];
    FS_CACHE.setGlobal('__usr__', docs[1].exists ? docs[1].data().lista || [] : []);
    FS_CACHE.setGlobal('__pc__',  docs[2].exists ? docs[2].data().lista || [] : []);
    FS_CACHE.setGlobal('__app__', docs[3].exists ? docs[3].data() || {} : {});
  },

  /**
   * Salva dados globais no Firestore
   * @param {string} key - '__fil__' | '__usr__' | '__pc__' | '__app__'
   * @param {*} data
   */
  async saveGlobal(key, data) {
    const db = FB.db;
    const pathMap = {
      '__fil__': 'sistema/filiais',
      '__usr__': 'sistema/usuarios',
      '__pc__':  'sistema/planoContas',
      '__app__': 'sistema/config',
    };
    const path = pathMap[key];
    if (!path) return;

    FS_CACHE.setGlobal(key, data);

    if (key === '__app__') {
      await db.doc(path).set(data, { merge: true });
    } else {
      await db.doc(path).set({ lista: data }, { merge: false });
    }
  },

  // ─── DADOS DE FILIAL ─────────────────────────────────────────
  /**
   * Carrega todas as coleções de uma filial
   * @param {string} filialId
   */
  async loadFilial(filialId) {
    if (!FB.ready || FS_CACHE._loaded.has(filialId)) return;

    const db = FB.db;
    const reads = FS_COLLECTIONS.map(async col => {
  try{
     const snap = await db.doc(fsPath(filialId,col)).get()
     return {col,data:snap.exists ? snap.data().lista || [] : []}
  }catch(e){
     return {col,data:[]}
  }
});
    const results = await Promise.all(reads);
    results.forEach(({ col, data }) => FS_CACHE.set(filialId, col, data));
    FS_CACHE._loaded.add(filialId);
    console.info(`[Firestore] Filial "${filialId}" carregada.`);
  },

  /**
   * Retorna dados de uma coleção (do cache)
   * @param {string} filialId
   * @param {string} col - nome da coleção
   * @returns {Array}
   */
  get(filialId, col) {
    return FS_CACHE.get(filialId, col);
  },

  /**
   * Salva uma coleção completa no Firestore e atualiza o cache
   * @param {string} filialId
   * @param {string} col
   * @param {Array} data
   */
  async set(filialId, col, data) {
    FS_CACHE.set(filialId, col, data);

    if (if (!FB.ready || !FB.db || !FB.auth?.currentUser)

    try {
      await FB.db.doc(fsPath(filialId, col)).set({ lista: data });
    } catch (err) {
      console.warn(`[Firestore] Falha ao salvar ${col}:`, err.message);
    }
  },

  // ─── OPERAÇÕES INDIVIDUAIS ───────────────────────────────────
  /**
   * Adiciona um item a uma coleção
   * @param {string} filialId
   * @param {string} col
   * @param {Object} item - deve ter campo 'id'
   */
  async add(filialId, col, item) {
    const lista = [...FS_CACHE.get(filialId, col), item];
    await this.set(filialId, col, lista);
    return item;
  },

  /**
   * Atualiza um item existente pelo id
   * @param {string} filialId
   * @param {string} col
   * @param {string} id
   * @param {Object} updates
   */
  async update(filialId, col, id, updates) {
    const lista = FS_CACHE.get(filialId, col).map(i =>
      i.id === id ? { ...i, ...updates } : i
    );
    await this.set(filialId, col, lista);
  },

  /**
   * Remove um item pelo id
   * @param {string} filialId
   * @param {string} col
   * @param {string} id
   */
  async remove(filialId, col, id) {
    const lista = FS_CACHE.get(filialId, col).filter(i => i.id !== id);
    await this.set(filialId, col, lista);
  },

  /**
   * Busca um item pelo id
   * @param {string} filialId
   * @param {string} col
   * @param {string} id
   */
  findById(filialId, col, id) {
    return FS_CACHE.get(filialId, col).find(i => i.id === id) || null;
  },

  // ─── REAL-TIME LISTENERS ─────────────────────────────────────
  /**
   * Escuta mudanças em tempo real em uma coleção
   * Útil para sistemas multi-usuário simultâneo
   * @param {string} filialId
   * @param {string} col
   * @param {function} callback - chamado com (dados) quando há mudança
   * @returns {function} unsubscribe
   */
  listen(filialId, col, callback) {
    if (!FB.ready || !FB.db) return () => {};

    const unsubscribe = FB.db.doc(fsPath(filialId, col))
      .onSnapshot(snap => {
        const data = snap.exists ? snap.data().lista || [] : [];
        FS_CACHE.set(filialId, col, data);
        callback(data);
      }, err => {
        console.warn(`[Firestore] Listener erro ${col}:`, err.message);
      });

    FS_CACHE._listeners.push(unsubscribe);
    return unsubscribe;
  },

  // ─── OPERAÇÕES EM LOTE ───────────────────────────────────────
  /**
   * Salva múltiplas coleções em uma única transação (batch)
   * @param {string} filialId
   * @param {Object} updates - { col: data, ... }
   */
  async batch(filialId, updates) {
    // Atualiza cache imediatamente
    Object.entries(updates).forEach(([col, data]) => {
      FS_CACHE.set(filialId, col, data);
    });

    if (!FB.ready || !FB.db) return;

    const batch = FB.db.batch();
    Object.entries(updates).forEach(([col, data]) => {
      const ref = FB.db.doc(fsPath(filialId, col));
      batch.set(ref, { lista: data });
    });

    try {
      await batch.commit();
    } catch (err) {
      console.warn('[Firestore] Batch falhou:', err.message);
    }
  },

  // ─── EXPORTAÇÃO / BACKUP ─────────────────────────────────────
  /**
   * Exporta todos os dados de uma filial como JSON
   * @param {string} filialId
   * @returns {Object}
   */
  async exportFilial(filialId) {
    await this.loadFilial(filialId);
    const result = { filialId, exportadoEm: new Date().toISOString() };
    FS_COLLECTIONS.forEach(col => {
      result[col] = FS_CACHE.get(filialId, col);
    });
    return result;
  },

  /**
   * Importa dados para uma filial (sobrescreve tudo)
   * @param {string} filialId
   * @param {Object} dados - resultado de exportFilial()
   */
  async importFilial(filialId, dados) {
    const updates = {};
    FS_COLLECTIONS.forEach(col => {
      if (Array.isArray(dados[col])) {
        updates[col] = dados[col];
      }
    });
    await this.batch(filialId, updates);
    console.info(`[Firestore] Importação concluída para filial ${filialId}.`);
  },

  // ─── LIMPEZA ─────────────────────────────────────────────────
  /**
   * Limpa o cache e desativa todos os listeners
   * Chame ao fazer logout
   */
  cleanup() {
    FS_CACHE.clear();
    this.ready = false;
    console.info('[Firestore] Cache limpo e listeners removidos.');
  },
};

// ═══════════════════════════════════════════════════════════════
// INTEGRAÇÃO COM O SISTEMA (compatibilidade com gfd/sfd/sv/ld)
// ═══════════════════════════════════════════════════════════════
/**
 * Sobrescreve as funções de storage do sistema principal
 * para usar Firestore quando disponível.
 *
 * Chame integrateFirestore() após FS.init() para ativar.
 */
function integrateFirestore() {
  console.info('[Firestore] Integrando com o sistema...');

  // Sobrescreve gfil() — retorna filiais do Firestore
  window._origGfil = window.gfil;
  window.gfil = () => {
    if (FS.ready) {
      const cached = FS_CACHE.getGlobal('__fil__');
      if (cached && cached.length) return cached;
    }
    return window._origGfil ? window._origGfil() : [];
  };

  // Sobrescreve sfil() — salva filiais no Firestore
  window._origSfil = window.sfil;
  window.sfil = (data) => {
    FS_CACHE.setGlobal('__fil__', data);
    if (FS.ready) FS.saveGlobal('__fil__', data).catch(console.warn);
    if (window._origSfil) window._origSfil(data);
  };

  // Sobrescreve gus() — retorna usuários do Firestore
  window._origGus = window.gus;
  window.gus = () => {
    if (FS.ready) {
      const cached = FS_CACHE.getGlobal('__usr__');
      if (cached && cached.length) return cached;
    }
    return window._origGus ? window._origGus() : [];
  };

  // Sobrescreve sus() — salva usuários no Firestore
  window._origSus = window.sus;
  window.sus = (data) => {
    FS_CACHE.setGlobal('__usr__', data);
    if (FS.ready) FS.saveGlobal('__usr__', data).catch(console.warn);
    if (window._origSus) window._origSus(data);
  };

  // Sobrescreve gpc() — plano de contas do Firestore
  window._origGpc = window.gpc;
  window.gpc = () => {
    if (FS.ready) {
      const cached = FS_CACHE.getGlobal('__pc__');
      if (cached && cached.length) return cached;
    }
    return window._origGpc ? window._origGpc() : [];
  };

  // Sobrescreve spc() — salva plano de contas no Firestore
  window._origSpc = window.spc;
  window.spc = (data) => {
    FS_CACHE.setGlobal('__pc__', data);
    if (FS.ready) FS.saveGlobal('__pc__', data).catch(console.warn);
    if (window._origSpc) window._origSpc(data);
  };

  // Sobrescreve gapp() — configurações do sistema
  window._origGapp = window.gapp;
  window.gapp = () => {
    if (FS.ready) {
      const cached = FS_CACHE.getGlobal('__app__');
      if (cached && (cached.nome || cached.sub)) return cached;
    }
    return window._origGapp ? window._origGapp() : { nome: 'Gestão Financeira', sub: 'Multi-Filial' };
  };

  // Sobrescreve sapp() — salva config do sistema
  window._origSapp = window.sapp;
  window.sapp = (data) => {
    FS_CACHE.setGlobal('__app__', data);
    if (FS.ready) FS.saveGlobal('__app__', data).catch(console.warn);
    if (window._origSapp) window._origSapp(data);
  };

  // Sobrescreve gfd() — retorna coleção de filial
  window._origGfd = window.gfd;
  window.gfd = (db, filialId, col) => {
    if (FS.ready && FS_CACHE._loaded.has(filialId)) {
      return FS_CACHE.get(filialId, col);
    }
    // Fallback localStorage
    return window._origGfd ? window._origGfd(db, filialId, col) : [];
  };

  // Sobrescreve sv() — persiste no Firestore
  const _origSv = window.sv;
  window.sv = async (db) => {
    // Salva sempre no localStorage (síncrono, fallback)
    if (_origSv) _origSv(db);

    if (!FS.ready) return;

    // Sincroniza mudanças por filial
    const filiais = FS_CACHE.getGlobal('__fil__') || [];
    for (const filial of filiais) {
      const fid = filial.id;
      if (!fid || !db[fid]) continue;

      const updates = {};
      FS_COLLECTIONS.forEach(col => {
        if (db[fid][col] !== undefined) {
          updates[col] = db[fid][col];
          FS_CACHE.set(fid, col, db[fid][col]);
        }
      });

      if (Object.keys(updates).length > 0) {
        FS.batch(fid, updates).catch(err =>
          console.warn('[Firestore] sv() sync erro:', err.message)
        );
      }
    }
  };

  console.info('[Firestore] ✅ Integração ativa — dados sincronizando com Firestore.');
}

// ═══════════════════════════════════════════════════════════════
// INICIALIZAÇÃO AUTOMÁTICA COM AUTH
// ═══════════════════════════════════════════════════════════════
/**
 * Fluxo completo de inicialização:
 * 1. Aguarda Firebase estar pronto
 * 2. Escuta mudanças de autenticação
 * 3. Ao fazer login: carrega dados e ativa integração
 * 4. Ao fazer logout: limpa cache
 */
async function initFirestoreLayer() {
  // Aguarda Firebase inicializar
  if (!FB.ready) {
    console.warn('[Firestore] Firebase não está pronto. Operando apenas com localStorage.');
    return false;
  }

  // Escuta autenticação
  fbOnAuthChange(async (user) => {
    if (user) {
      console.info('[Firestore] Usuário autenticado:', user.email);

      // Inicializa Firestore
      const ok = await FS.init();
      if (ok) {
        integrateFirestore();

        // Carrega filial ativa
        const filiais = FS_CACHE.getGlobal('__fil__') || [];
        if (filiais.length > 0) {
          await FS.loadFilial(filiais[0].id);
        }

        // Re-renderiza com dados do Firestore
        if (typeof render === 'function') render();
      }
    } else {
      // Logout: limpa dados
      FS.cleanup();
      if (typeof render === 'function') render();
    }
  });

  return true;
}

// ═══════════════════════════════════════════════════════════════
// UTILITÁRIOS
// ═══════════════════════════════════════════════════════════════

/**
 * Verifica se o Firestore está disponível e funcionando
 */
function fsIsOnline() {
  return FB.ready && FS.ready;
}

/**
 * Força sincronização de uma filial do localStorage para o Firestore
 * Útil para migrar dados existentes
 * @param {string} filialId
 */
async function fsMigrateFromLocalStorage(filialId) {
  if (!FS.ready) {
    console.warn('[Firestore] Não está pronto para migração.');
    return false;
  }

  const K = 'gf_v3';
  const raw = localStorage.getItem(K);
  if (!raw) {
    console.warn('[Firestore] Nenhum dado no localStorage.');
    return false;
  }

  try {
    const db = JSON.parse(raw);
    const filialData = db[filialId];
    if (!filialData) {
      console.warn(`[Firestore] Filial "${filialId}" não encontrada no localStorage.`);
      return false;
    }

    const updates = {};
    FS_COLLECTIONS.forEach(col => {
      if (Array.isArray(filialData[col]) && filialData[col].length > 0) {
        updates[col] = filialData[col];
        console.info(`[Firestore] Migrando ${col}: ${filialData[col].length} registros`);
      }
    });

    // Migra dados globais
    if (db['__fil__']) await FS.saveGlobal('__fil__', db['__fil__']);
    if (db['__usr__']) await FS.saveGlobal('__usr__', db['__usr__']);
    if (db['__pc__'])  await FS.saveGlobal('__pc__',  db['__pc__']);
    if (db['__app__']) await FS.saveGlobal('__app__', db['__app__']);

    if (Object.keys(updates).length > 0) {
      await FS.batch(filialId, updates);
    }

    console.info('[Firestore] ✅ Migração concluída!');
    return true;
  } catch (err) {
    console.error('[Firestore] Erro na migração:', err);
    return false;
  }
}

// ═══════════════════════════════════════════════════════════════
// EXPORTAÇÕES GLOBAIS
// ═══════════════════════════════════════════════════════════════
window.FS                      = FS;
window.FS_CACHE                = FS_CACHE;
window.FS_COLLECTIONS          = FS_COLLECTIONS;
window.integrateFirestore      = integrateFirestore;
window.initFirestoreLayer      = initFirestoreLayer;
window.fsIsOnline              = fsIsOnline;
window.fsMigrateFromLocalStorage = fsMigrateFromLocalStorage;

// Auto-inicia após Firebase estar pronto
if (typeof FB !== 'undefined' && FB.ready) {
  initFirestoreLayer();
} else {
  window.addEventListener('load', () => {
    setTimeout(() => {
      if (typeof FB !== 'undefined' && FB.ready) initFirestoreLayer();
    }, 500);
  });
}
