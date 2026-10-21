/* Regra pura (sem dependências) que decide QUEM suspender ou reativar no Firebase Authentication,
   comparando a lista de usuários antes e depois de uma gravação em dados/g__usr.
   Salvaguardas: lista vazia/ausente ou sem nenhum administrador ativo = não faz nada (evita bloqueio em massa). */
const ativo = u => !!u && (u.statusAcesso || 'aprovado') === 'aprovado';

function calcularSuspensoes(antes, depois) {
  const vazio = { desabilitar: [], habilitar: [] };
  antes = Array.isArray(antes) ? antes : [];
  depois = Array.isArray(depois) ? depois : [];
  if (!depois.length) return vazio;
  if (!depois.some(u => u && u.perfil === 'admin' && ativo(u))) return vazio;
  const mapaAntes = new Map(antes.filter(Boolean).map(u => [u.id, u]));
  const mapaDepois = new Map(depois.filter(Boolean).map(u => [u.id, u]));
  const desabilitar = [], habilitar = [];
  antes.forEach(u => { if (u && u.id && ativo(u)) { const d = mapaDepois.get(u.id); if (!d || !ativo(d)) desabilitar.push(u.id); } });
  depois.forEach(u => { if (u && u.id && ativo(u)) { const a = mapaAntes.get(u.id); if (a && !ativo(a)) habilitar.push(u.id); } });
  return { desabilitar, habilitar };
}
module.exports = { calcularSuspensoes };
