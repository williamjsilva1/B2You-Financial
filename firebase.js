// src/services/firebase.js
// =============================================================
// As credenciais são lidas das variáveis de ambiente (.env)
// Nunca coloque as chaves diretamente aqui se for subir ao GitHub
// =============================================================

import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';

const firebaseConfig = {
  apiKey: "AIzaSyAFsMwT1WMRUaRVD4skV-jHa-PdTR2vHOM",
  authDomain: "b2you-financial-e580d.firebaseapp.com",
  projectId: "b2you-financial-e580d",
  storageBucket: "b2you-financial-e580d.firebasestorage.app",
  messagingSenderId: "956219392265",
  appId: "1:956219392265:web:a9b0f92c3f14147bb653d8"
};

const app = initializeApp(firebaseConfig);

export const auth    = getAuth(app);
export const db      = getFirestore(app);
export const storage = getStorage(app);

export default app;
