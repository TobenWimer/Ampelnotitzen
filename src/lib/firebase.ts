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

/**
 * ⚠️ Firebase Config – exakt aus der Firebase Console (Web-App "Config")
 * Project settings → Your apps (</>) → SDK setup and configuration → Config
 */
const firebaseConfig = {
  apiKey: "AIzaSyDX9JFQeYbIcFY3KzRhOGQRommFEO7Y5ho",
  authDomain: "ampelnotitzen.firebaseapp.com",
  projectId: "ampelnotitzen",
  storageBucket: "ampelnotitzen.firebasestorage.app",
  messagingSenderId: "805136433036",
  appId: "1:805136433036:web:609f87596024deeeaca0a9",
};

// Singleton-App (wichtig für Next.js Dev-Mode)
const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();

// Services
export const db = getFirestore(app);
export const auth = getAuth(app);

// Provider
const provider = new GoogleAuthProvider();

/**
 * Stellt sicher, dass wir mindestens anonym angemeldet sind.
 * Wird beim App-Start aufgerufen.
 */
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

/**
 * Google-Login:
 * - Falls der User aktuell anonym ist, wird der anonyme Account MIT Google verknüpft (UID bleibt erhalten!)
 * - Ansonsten normaler Google-Login per Popup.
 */
export async function signInWithGoogleLinked(): Promise<void> {
  const user = auth.currentUser;
  // Für konsistentes Verhalten — Google-Kontoauswahl immer zeigen
  provider.setCustomParameters({ prompt: "select_account" });

  try {
    if (user && user.isAnonymous) {
      await linkWithPopup(user, provider);
    } else {
      await signInWithPopup(auth, provider);
    }
    return;
  } catch (err: any) {
    // Typische Popup-Probleme: blockiert, geschlossen, konkurrierende Popups
    const code = err?.code || "";
    const popupIssues = [
      "auth/popup-blocked",
      "auth/popup-closed-by-user",
      "auth/cancelled-popup-request",
    ];
    if (popupIssues.includes(code)) {
      // Fallback: Redirect-Fluss (Seite lädt neu, Auth-Status wird danach gesetzt)
      const doRedirect = async () => {
        if (user && user.isAnonymous) {
          // Für anonyme Verknüpfung gibt es keinen linkWithRedirect,
          // daher vorher signInWithPopup versucht; hier als Fallback normal per Redirect anmelden:
          await signInWithPopup(auth, provider).catch(async () => {
            // Wenn auch das fehlschlägt, letzter Versuch: Redirect
            const { signInWithRedirect } = await import("firebase/auth");
            await signInWithRedirect(auth, provider);
          });
        } else {
          const { signInWithRedirect } = await import("firebase/auth");
          await signInWithRedirect(auth, provider);
        }
      };
      await doRedirect();
      return;
    }
    // Andere Fehler durchreichen, damit man sie in der Konsole sieht
    console.error("Google Sign-In Error:", err);
    throw err;
  }
}


/**
 * Logout:
 * - Meldet den aktuellen User ab
 * - Meldet direkt wieder anonym an (damit die App weiter nutzbar bleibt)
 */
export async function signOut() {
  await fbSignOut(auth);
  await signInAnonymously(auth);
}
