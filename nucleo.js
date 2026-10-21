/* Lógica da função de servidor, sem depender do Firebase (recebe as dependências por parâmetro: dá para testar).
   Duas tarefas:
   1) sincronizar(antes, depois)      — roda quando a lista de usuários muda: grava o "cartão de acesso" de cada pessoa em
                                         acesso/{uid} (é ele que as regras do Firestore consultam), desativa a conta de quem
                                         foi bloqueado/excluído e reativa quem voltou.
   2) processarSolicitacao(uid)        — roda quando alguém entra no app: confere NO SERVIDOR (Firebase Authentication) se o
                                         e-mail é verificado, assume cadastro pré-aprovado, cria pedido pendente, e grava o cartão. */
const { calcularSuspensoes } = require('./suspender');

const norm = e => String(e || '').trim().toLowerCase();
const ativo = u => !!u && (u.statusAcesso || 'aprovado') === 'aprovado';
const temAdminAtivo = lista => lista.some(u => u && u.perfil === 'admin' && ativo(u));
const SEIS_HORAS = 6 * 3600 * 1000;

function montarCartao(rec, uid, verificado, extra) {
  return Object.assign({
    uid,
    email: norm(rec.email),
    status: rec.statusAcesso || 'aprovado',
    ativo: ativo(rec),
    perfil: rec.perfil === 'admin' ? 'admin' : 'usuario',
    filiais: Array.isArray(rec.filiais) ? rec.filiais : [],
    modulos: Array.isArray(rec.modulos) ? rec.modulos : [],
    rosterId: rec.id || uid,
    verificado: !!verificado
  }, extra || {});
}
const CAMPOS_CARTAO = ['uid', 'email', 'status', 'ativo', 'perfil', 'filiais', 'modulos', 'rosterId', 'verificado', 'motivo'];
const mesmoCartao = (a, b) => !!a && CAMPOS_CARTAO.every(k => JSON.stringify(a[k] === undefined ? null : a[k]) === JSON.stringify(b[k] === undefined ? null : b[k]));

/* Descobre a quem (uid do Firebase Authentication) pertence um registro da lista.
   Registro ainda não assumido só vale para um login com o MESMO e-mail já VERIFICADO. */
async function resolverUid(rec, deps) {
  if (rec && rec.id) { const u = await deps.getUser(rec.id); if (u) return { uid: u.uid, verificado: !!u.emailVerified }; }
  if (rec && rec.email) { const u = await deps.getUserByEmail(norm(rec.email)); if (u && u.emailVerified) return { uid: u.uid, verificado: true }; }
  return null;
}

async function sincronizar(antes, depois, deps) {
  antes = Array.isArray(antes) ? antes.filter(Boolean) : [];
  depois = Array.isArray(depois) ? depois.filter(Boolean) : [];
  const res = { escritos: [], desabilitados: [], habilitados: [] };
  // Salvaguarda: lista vazia ou sem nenhum administrador ativo = algo deu errado; não mexe em nada (evita trancar todo mundo)
  if (!depois.length || !temAdminAtivo(depois)) return res;
  for (const rec of depois) {
    const r = await resolverUid(rec, deps);
    if (!r) continue;
    const novo = montarCartao(rec, r.uid, r.verificado);
    const atual = await deps.lerCartao(r.uid);
    if (!mesmoCartao(atual, novo)) { await deps.gravarCartao(r.uid, { ...novo, solicitacaoEm: (atual && atual.solicitacaoEm) || null }); res.escritos.push(r.uid); }
  }
  // Quem saiu da lista (exclusão antiga, definitiva) perde o acesso
  const ids = new Set(depois.map(u => u.id));
  for (const rec of antes) {
    if (!rec.id || ids.has(rec.id)) continue;
    const u = await deps.getUser(rec.id);
    if (u) { const atual = await deps.lerCartao(u.uid); await deps.gravarCartao(u.uid, { ...montarCartao({ ...rec, statusAcesso: 'excluido', perfil: 'usuario', filiais: [], modulos: [] }, u.uid, !!u.emailVerified), solicitacaoEm: (atual && atual.solicitacaoEm) || null }); res.escritos.push(u.uid); }
  }
  const s = calcularSuspensoes(antes, depois);
  for (const id of s.desabilitar) { await deps.desativarConta(id); res.desabilitados.push(id); }
  for (const id of s.habilitar) { await deps.reativarConta(id); res.habilitados.push(id); }
  return res;
}

async function processarSolicitacao(uid, deps) {
  const au = await deps.getUser(uid);
  if (!au) return { resultado: 'sem_usuario' };
  const email = norm(au.email), verificado = !!au.emailVerified;
  const provedor = (au.providerData && au.providerData[0] && au.providerData[0].providerId) || 'password';
  let resultado = '', rec = null;

  await deps.transacaoRoster(listaOrig => {
    // (a transação pode ser repetida: tudo é recalculado do zero a cada tentativa)
    const lista = Array.isArray(listaOrig) ? listaOrig.slice() : [];
    const agora = deps.agora();
    resultado = ''; rec = null;
    const atualizaPerfil = r => {
      const n = { ...r };
      if (!n.nomePersonalizado && au.displayName) n.nome = au.displayName;
      n.fotoUrl = au.photoURL || n.fotoUrl || '';
      n.provedor = provedor; n.emailVerificado = verificado;
      if (!n.ultimoAcesso || (Date.parse(agora) - Date.parse(n.ultimoAcesso)) > SEIS_HORAS) n.ultimoAcesso = agora;
      return n;
    };
    const i = lista.findIndex(x => x && x.id === uid);
    if (i >= 0) {
      resultado = 'existente';
      const n = atualizaPerfil(lista[i]); rec = n;
      if (JSON.stringify(n) !== JSON.stringify(lista[i])) { lista[i] = n; return lista; }
      return null;
    }
    const j = lista.findIndex(x => x && norm(x.email) === email && email);
    if (j >= 0) {
      if (!verificado) { resultado = 'email_nao_verificado'; rec = lista[j]; return null; }   // NÃO assume sem provar o e-mail
      resultado = 'assumido';
      lista[j] = atualizaPerfil({ ...lista[j], id: uid, email }); rec = lista[j];
      return lista;
    }
    const vazia = lista.length === 0;
    const podeSerPrimeiro = vazia && verificado && (!deps.adminInicial || norm(deps.adminInicial) === email);
    resultado = podeSerPrimeiro ? 'primeiro_admin' : 'novo';
    rec = {
      id: uid, nome: au.displayName || email.split('@')[0], email,
      perfil: podeSerPrimeiro ? 'admin' : 'usuario', filiais: [], modulos: [],
      statusAcesso: podeSerPrimeiro ? 'aprovado' : 'pendente',
      fotoUrl: au.photoURL || '', provedor, emailVerificado: verificado,
      criadoEm: agora, ultimoAcesso: agora, nomePersonalizado: false
    };
    lista.push(rec);
    return lista;
  });

  const cartao = resultado === 'email_nao_verificado'
    ? montarCartao({ ...rec, statusAcesso: 'pendente', perfil: 'usuario', filiais: [], modulos: [] }, uid, false, { motivo: 'email_nao_verificado', rosterId: rec.id })
    : montarCartao(rec, uid, verificado);
  // Carimbo do pedido: o app confere que o cartão que leu é a resposta ao pedido que acabou de fazer (e não um cartão antigo)
  const sol = await deps.lerSolicitacao(uid);
  const solicitacaoEm = (sol && sol.ultimoAcesso) || null;
  const atual = await deps.lerCartao(uid);
  if (!mesmoCartao(atual, cartao) || (atual && atual.solicitacaoEm) !== solicitacaoEm) await deps.gravarCartao(uid, { ...cartao, solicitacaoEm });
  return { resultado, cartao: { ...cartao, solicitacaoEm } };
}

module.exports = { sincronizar, processarSolicitacao, montarCartao, mesmoCartao, resolverUid, ativo, temAdminAtivo };
