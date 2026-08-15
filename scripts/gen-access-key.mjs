// Erzeugt einen neuen Zugangsschluessel fuer OneStepBehind.
//
//   node scripts/gen-access-key.mjs            -> zufaelliger Schluessel
//   node scripts/gen-access-key.mjs "MeinKey"  -> Hash zu einem selbst gewaehlten Schluessel
//
// Danach in der Firebase Console anlegen:
//   Firestore -> Sammlung "accessKeys" -> Dokument-ID = der ausgegebene HASH
//   (Felder sind optional, z.B. "label" fuer die eigene Uebersicht)
//
// Widerrufen: dieses Dokument loeschen. Bereits freigeschaltete Konten bleiben
// freigeschaltet - die entfernt man ueber die Sammlung "allowlist".

import crypto from "node:crypto";

const custom = process.argv[2];
const key = custom ?? `OSB-${crypto.randomBytes(12).toString("base64url")}`;
const hash = crypto.createHash("sha256").update(key).digest("hex");

console.log("");
console.log("  Schluessel (weitergeben):");
console.log(`  ${key}`);
console.log("");
console.log("  Dokument-ID in accessKeys (in Firestore anlegen):");
console.log(`  ${hash}`);
console.log("");
