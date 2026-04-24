// src/services/firestore.js
import {
  collection, doc, addDoc, updateDoc, deleteDoc,
  getDocs, getDoc, query, where, orderBy, serverTimestamp,
  onSnapshot
} from 'firebase/firestore';
import { db } from './firebase';

// Retorna o caminho base de uma coleção dentro da filial
const filialPath = (filialId, colecao) => `filiais/${filialId}/${colecao}`;

// ── CREATE ─────────────────────────────────────────────────────
export const criar = async (filialId, colecao, dados) => {
  const ref = collection(db, filialPath(filialId, colecao));
  const docRef = await addDoc(ref, { ...dados, criadoEm: serverTimestamp(), atualizadoEm: serverTimestamp() });
  return docRef.id;
};

// ── READ (lista) ───────────────────────────────────────────────
export const listar = async (filialId, colecao, filtros = []) => {
  const ref = collection(db, filialPath(filialId, colecao));
  const q = filtros.length > 0 ? query(ref, ...filtros) : query(ref, orderBy('criadoEm', 'desc'));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
};

// ── READ (único) ───────────────────────────────────────────────
export const buscar = async (filialId, colecao, id) => {
  const ref = doc(db, filialPath(filialId, colecao), id);
  const snap = await getDoc(ref);
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
};

// ── UPDATE ─────────────────────────────────────────────────────
export const atualizar = async (filialId, colecao, id, dados) => {
  const ref = doc(db, filialPath(filialId, colecao), id);
  await updateDoc(ref, { ...dados, atualizadoEm: serverTimestamp() });
};

// ── DELETE ─────────────────────────────────────────────────────
export const excluir = async (filialId, colecao, id) => {
  const ref = doc(db, filialPath(filialId, colecao), id);
  await deleteDoc(ref);
};

// ── REALTIME ───────────────────────────────────────────────────
export const escutar = (filialId, colecao, callback) => {
  const ref = collection(db, filialPath(filialId, colecao));
  return onSnapshot(query(ref, orderBy('criadoEm', 'desc')), snap => {
    callback(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  });
};

// ── USUÁRIOS GLOBAIS (fora da filial) ──────────────────────────
export const criarUsuarioDoc = async (uid, dados) => {
  const ref = doc(db, 'usuarios', uid);
  await updateDoc(ref, { ...dados, atualizadoEm: serverTimestamp() }).catch(async () => {
    const { setDoc } = await import('firebase/firestore');
    await setDoc(ref, { ...dados, criadoEm: serverTimestamp(), atualizadoEm: serverTimestamp() });
  });
};

export const buscarUsuario = async (uid) => {
  const ref = doc(db, 'usuarios', uid);
  const snap = await getDoc(ref);
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
};

export const listarUsuarios = async () => {
  const snap = await getDocs(collection(db, 'usuarios'));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
};

// ── FILIAIS GLOBAIS ────────────────────────────────────────────
export const listarFiliais = async () => {
  const snap = await getDocs(collection(db, 'filiais'));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
};

export const criarFilial = async (dados) => {
  const ref = await addDoc(collection(db, 'filiais'), { ...dados, criadoEm: serverTimestamp() });
  return ref.id;
};

export const atualizarFilial = async (id, dados) => {
  await updateDoc(doc(db, 'filiais', id), dados);
};
