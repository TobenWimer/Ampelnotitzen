// Migriert den cbrain-Obsidian-Vault nach Firestore, Sammlung "cbrainEntries".
//
// Vorbereitung (einmalig):
//   1. Firebase Console -> Projekteinstellungen -> Dienstkonten -> "Neuen privaten
//      Schluessel generieren". Datei speichern als:
//        scripts/prod.serviceaccount.json
//      (per .gitignore geschuetzt, landet nie im Repo)
//   2. npm install --save-dev firebase-admin
//
// Nutzung:
//   node scripts/migrate-cbrain.mjs             -> Trockenlauf, schreibt NICHTS,
//                                                   zeigt nur was passieren wuerde
//   node scripts/migrate-cbrain.mjs --write      -> schreibt wirklich nach Firestore
//
// MOCs/ wird seit 2026-08-20 mitmigriert (siehe Decisions/2026-08-20-cbrain-MCP-Server-und-OAuth.md):
// /cbrain und /cbrain-cleanup lesen die Bootstrap-Dateien (System-Prompt, Profile,
// Timon-Uebersicht) jetzt ueber den MCP-Connector statt lokal, damit sie auch vom
// Handy aus funktionieren.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const VAULT_ROOT = "C:\\Dateien_Timon\\Master\\Obsidian_ClaudeMemory\\Claude-Memory";
const SKIP_FOLDERS = new Set();
const SERVICE_ACCOUNT_PATH = path.join(__dirname, "prod.serviceaccount.json");

const isWrite = process.argv.includes("--write");

function parseFrontmatter(raw) {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) {
    return { fields: {}, content: raw.trim() };
  }
  const [, block, rest] = match;
  const fields = {};
  for (const line of block.split(/\r?\n/)) {
    const fieldMatch = line.match(/^([a-zA-Z_]+):\s*(.*)$/);
    if (fieldMatch) {
      fields[fieldMatch[1]] = fieldMatch[2].trim();
    }
  }
  return { fields, content: rest.trim() };
}

function collectMarkdownFiles(dir, folder) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SKIP_FOLDERS.has(entry.name)) continue;
      files.push(...collectMarkdownFiles(path.join(dir, entry.name), entry.name));
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      files.push({ filePath: path.join(dir, entry.name), folder, fileName: entry.name });
    }
  }
  return files;
}

function toEntry({ filePath, folder, fileName }) {
  const raw = fs.readFileSync(filePath, "utf8");
  const { fields, content } = parseFrontmatter(raw);
  const slug = fileName.replace(/\.md$/, "");

  const entry = {
    folder,
    slug,
    type: fields.type ?? folder.toLowerCase(),
    summary: fields.summary ?? "",
    content,
  };
  if (fields.status) entry.status = fields.status;

  const updatedDate = fields.updated ? new Date(fields.updated) : null;
  entry.updatedAt =
    updatedDate && !Number.isNaN(updatedDate.getTime())
      ? Timestamp.fromDate(updatedDate)
      : Timestamp.now();

  return { docId: `${folder}__${slug}`, entry };
}

function main() {
  if (!fs.existsSync(VAULT_ROOT)) {
    console.error(`Vault nicht gefunden: ${VAULT_ROOT}`);
    process.exit(1);
  }

  const topLevelDirs = fs
    .readdirSync(VAULT_ROOT, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !SKIP_FOLDERS.has(e.name));

  const files = topLevelDirs.flatMap((dirEntry) =>
    collectMarkdownFiles(path.join(VAULT_ROOT, dirEntry.name), dirEntry.name)
  );

  const items = files.map(toEntry);

  console.log(`Gefunden: ${items.length} Dateien in ${topLevelDirs.length} Ordnern.`);
  const missingSummary = items.filter((i) => !i.entry.summary);
  if (missingSummary.length) {
    console.log(`Ohne summary (Frontmatter fehlt vermutlich): ${missingSummary.map((i) => i.docId).join(", ")}`);
  }

  if (!isWrite) {
    console.log("\nTrockenlauf, es wurde NICHTS geschrieben. Beispiel-Dokument:");
    console.log(JSON.stringify(items[0], null, 2));
    console.log("\nZum wirklichen Schreiben: node scripts/migrate-cbrain.mjs --write");
    return;
  }

  if (!fs.existsSync(SERVICE_ACCOUNT_PATH)) {
    console.error(`Service-Account-Schluessel fehlt: ${SERVICE_ACCOUNT_PATH}`);
    console.error("Siehe Kommentar am Dateianfang fuer die Beschaffung.");
    process.exit(1);
  }

  initializeApp({
    credential: cert(JSON.parse(fs.readFileSync(SERVICE_ACCOUNT_PATH, "utf8"))),
  });
  const db = getFirestore();

  const batch = db.batch();
  for (const { docId, entry } of items) {
    batch.set(db.collection("cbrainEntries").doc(docId), entry);
  }

  batch
    .commit()
    .then(() => {
      console.log(`\n${items.length} Dokumente nach cbrainEntries geschrieben.`);
      process.exit(0);
    })
    .catch((err) => {
      console.error("Fehler beim Schreiben:", err);
      process.exit(1);
    });
}

main();
