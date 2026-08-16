// Erzeugt eine fertige Einladungsseite fuer eine neue Person - Schluessel, Hash und
// HTML in einem Schritt.
//
//   node scripts/make-invite.mjs "Nadine"                 -> neuer Zufallsschluessel
//   node scripts/make-invite.mjs "Max" "OSB-eigenerKey"    -> bestehenden Schluessel nutzen
//
// Ergebnis:
//   docs/Zugang-<Name>.html   fertige Seite zum Verschicken
//   Konsole                   Schluessel + Hash fuer die Firestore-Sammlung accessKeys
//
// Danach in der Firebase Console: Firestore -> accessKeys -> Dokument hinzufuegen,
// Dokument-ID = der ausgegebene Hash, Feld "label" (string) = Name der Person.
// Ohne diesen Eintrag meldet die App "Zugangsschluessel ungueltig".
//
// Widerrufen: das Dokument in accessKeys loeschen. Wer damit schon freigeschaltet ist,
// bleibt drin - dafuer zusaetzlich sein Dokument in allowlist loeschen.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const APP_URL = "https://onestepbehind.vercel.app";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const templatePath = path.join(root, "docs", "templates", "einladung.template.html");

const name = process.argv[2];
const providedKey = process.argv[3];

if (!name) {
  console.error('\n  Name fehlt.\n  Aufruf: node scripts/make-invite.mjs "Nadine"\n');
  process.exit(1);
}

const key = providedKey ?? `OSB-${crypto.randomBytes(12).toString("base64url")}`;
const hash = crypto.createHash("sha256").update(key).digest("hex");

// Dateiname ohne Umlaute/Sonderzeichen, damit er ueberall sauber ankommt
const slug = name
  .normalize("NFKD")
  .replace(/\p{Diacritic}/gu, "")
  .replace(/ß/g, "ss")
  .replace(/[^a-zA-Z0-9]+/g, "-")
  .replace(/^-+|-+$/g, "");

const html = fs
  .readFileSync(templatePath, "utf8")
  .replaceAll("{{NAME}}", name)
  .replaceAll("{{KEY}}", key)
  .replaceAll("{{APP_URL}}", APP_URL)
  .replaceAll("{{APP_HOST}}", APP_URL.replace(/^https?:\/\//, ""));

const outPath = path.join(root, "docs", `Zugang-${slug}.html`);
fs.writeFileSync(outPath, html, "utf8");

console.log("");
console.log(`  Einladung fuer ${name} erstellt:`);
console.log(`  ${path.relative(root, outPath)}`);
console.log("");
console.log("  Schluessel (an die Person):");
console.log(`  ${key}`);
console.log("");
console.log("  Dokument-ID in accessKeys (in Firestore anlegen):");
console.log(`  ${hash}`);
console.log("");
