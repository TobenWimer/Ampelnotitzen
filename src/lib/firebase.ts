// src/lib/firebase.ts
import { initializeApp, getApps, getApp } from "firebase/app";
import {
  getAuth,
  onAuthStateChanged,
  signInAnonymously,
  GoogleAuthProvider,
  linkWithPopup,
  signInWithPopup,
  signOut as fbSignOut,
} from "firebase/auth";
import { getFirestore } from "firebase/firestore";

// ⬇️ Deine echten Config-Werte aus Firebase
const firebaseConfig = {
  apiKey: "AIzaSyDX9JFQeYbIcFY3KzRhOGQRommFEO7Y5ho",
  authDomain: "ampelnotitzen.firebaseapp.com",
  projectId: "ampelnotitzen",
  storageBucket: "ampelnotitzen.firebasestorage.app",
  messagingSenderId: "805136433036",
  appId: "1:805136433036:web:609f87596024deeeaca0a9"
};

const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();

export const db = getFirestore(app);
export const auth = getAuth(app);
const provider = new GoogleAuthProvider();

/** Stellt sicher, dass wir mind. anonym eingeloggt sind */
export async function ensureAnonAuth(): Promise<void> {
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

/** Google-Login – bevorzugt: Anonymen Account mit Google **verknüpfen** */
export async function signInWithGoogleLinked(): Promise<void> {
  // Falls der Nutzer noch anonym ist → verknüpfen, sonst normal einloggen
  const user = auth.currentUser;
  if (user && user.isAnonymous) {
    await linkWithPopup(user, provider);
  } else {
    await signInWithPopup(auth, provider);
  }
}

/** Logout */
export async function signOut() {
  await fbSignOut(auth);
  // Optional zurück in anonymen Modus:
  await signInAnonymously(auth);
}
