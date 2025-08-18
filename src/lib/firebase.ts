// src/lib/firebase.ts
import { initializeApp, getApps, getApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth, signInAnonymously, onAuthStateChanged } from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyDX9JFQeYbIcFY3KzRhOGQRommFEO7Y5ho",
  authDomain: "ampelnotitzen.firebaseapp.com",
  projectId: "ampelnotitzen",
  storageBucket: "ampelnotitzen.firebasestorage.app",
  messagingSenderId: "805136433036",
  appId: "1:805136433036:web:609f87596024deeeaca0a9"
};

// Nur einmal initialisieren (Next.js lädt Module mehrfach im Dev)
const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();

// Services
export const db = getFirestore(app);
export const auth = getAuth(app);

// Anonym anmelden (fürs Entwickeln)
export async function ensureAnonAuth() {
  return new Promise<void>((resolve, reject) => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      try {
        if (!user) {
          await signInAnonymously(auth);
        }
        resolve();
        unsub();
      } catch (e) {
        reject(e);
      }
    });
  });
}
