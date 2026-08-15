import { doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";

// Zugangsschlüssel-Kontrolle: nur wer den Schluessel kennt, wird in die Allowlist
// aufgenommen und darf die App ueberhaupt nutzen.
//
// Die Pruefung passiert bewusst NICHT hier im Client, sondern in den Firestore-Regeln:
// Der Client schickt nur den Hash mit, die Regel vergleicht ihn mit dem Hash in
// config/access. Dieses Dokument ist fuer Clients komplett gesperrt (allow read: if false),
// bleibt aber ueber get() in den Regeln lesbar - so kommt niemand an den Sollwert.
// Eine reine UI-Abfrage waere wertlos, weil man Firestore auch direkt ansprechen kann.

export async function sha256Hex(input: string) {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

// Ist dieser User bereits freigeschaltet?
export async function isAllowed(uid: string) {
  try {
    const snap = await getDoc(doc(db, "allowlist", uid));
    return snap.exists();
  } catch {
    return false;
  }
}

// Schaltet den User frei, sofern der Schluessel stimmt. Stimmt er nicht, lehnt die
// Firestore-Regel den Schreibvorgang ab - der Fehler wird hier zu false uebersetzt
export async function claimAccess(uid: string, key: string) {
  const keyHash = await sha256Hex(key.trim());
  try {
    await setDoc(doc(db, "allowlist", uid), { keyHash, createdAt: serverTimestamp() });
    return true;
  } catch {
    return false;
  }
}
