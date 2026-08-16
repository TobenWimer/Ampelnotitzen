import { doc, getDoc, setDoc } from "firebase/firestore";
import { ref, deleteObject } from "firebase/storage";
import { db, storage } from "@/lib/firebase";
import { uploadFilesToStorage } from "@/lib/uploadFiles";

// Geteilter Inhalt ist standardmaessig nur eine kurze Zeit gültig (Handoff-Zweck,
// kein Speicher). Per Schalter laesst sich der Ablauf abstellen, dann bleibt der
// Inhalt liegen bis er von Hand geloescht wird
export const CLIPBOARD_TTL_MS = 3 * 60 * 1000;

// Nimmt den ganzen Eintrag, weil der Ablauf jetzt vom noExpiry-Schalter abhaengt
export function isClipboardExpired(data: ClipboardData | null): boolean {
  if (!data) return false;
  if (data.noExpiry) return false;
  return Date.now() - data.updatedAt > CLIPBOARD_TTL_MS;
}

export type ClipboardFile = {
  fileName: string;
  storagePath: string;
  downloadURL: string;
  mimeType: string;
  sizeBytes: number;
};

export type ClipboardData = {
  // "file" = Alt-Format mit genau einer Datei in den Wurzelfeldern,
  // "files" = aktuelles Format mit files[]. Fehlt kind -> als "text" behandeln
  kind?: "text" | "file" | "files";
  text?: string;
  files?: ClipboardFile[];
  // Legacy-Wurzelfelder (Eintraege von vor dem Mehrdatei-Umbau)
  fileName?: string;
  storagePath?: string;
  downloadURL?: string;
  mimeType?: string;
  sizeBytes?: number;
  updatedAt: number;
  /** true = kein automatischer Ablauf, Inhalt bleibt bis er von Hand geloescht wird */
  noExpiry?: boolean;
};

// Vereinheitlicht altes Einzeldatei- und neues Mehrdatei-Format, damit die UI nur
// einen Fall kennen muss. Alte Eintraege laufen nach 3 Minuten ohnehin aus, der
// Fallback kostet aber nichts und vermeidet eine kaputte Anzeige in der Zwischenzeit
export function clipboardFiles(data: ClipboardData | null): ClipboardFile[] {
  if (!data) return [];
  if (data.files?.length) return data.files;
  if (data.kind === "file" && data.storagePath && data.downloadURL) {
    return [
      {
        fileName: data.fileName ?? "Datei",
        storagePath: data.storagePath,
        downloadURL: data.downloadURL,
        mimeType: data.mimeType ?? "application/octet-stream",
        sizeBytes: data.sizeBytes ?? 0,
      },
    ];
  }
  return [];
}

export const isFileEntry = (data: ClipboardData | null) =>
  !!data && (data.kind === "file" || data.kind === "files");

// Laedt eine oder mehrere Dateien in die (geraeteuebergreifende) Ablage. Ersetzt den
// kompletten bisherigen Inhalt (Text oder Dateien), vorherige Storage-Objekte werden
// danach best-effort entfernt, da pro User nur ein Ablage-Slot existiert.
// Fortschritt ist ueber alle Dateien kombiniert (gleich gewichtet pro Datei)
export async function uploadClipboardFiles({
  files,
  uid,
  append = false,
  onProgress,
}: {
  files: File[];
  uid: string;
  /** true = zu den bestehenden Dateien dazulegen, false = alles ersetzen */
  append?: boolean;
  onProgress?: (pct: number) => void;
}) {
  if (files.length === 0) return;

  const prevSnap = await getDoc(doc(db, "clipboard", uid));
  const prevData = prevSnap.exists() ? (prevSnap.data() as ClipboardData) : null;
  const prevFiles = clipboardFiles(prevData);

  // Beim Nachlegen bleiben die alten Dateien stehen und werden nicht aus Storage
  // entfernt. Nur beim Ersetzen wird aufgeraeumt
  const keepFiles = append ? prevFiles : [];
  const prevPaths = append ? [] : prevFiles.map((f) => f.storagePath);

  const stamp = Date.now();
  const uploaded = await uploadFilesToStorage({
    files,
    pathFor: (file, i) => `clipboardUploads/${uid}/${stamp}-${i}-${file.name}`,
    onProgress,
  });

  await setDoc(doc(db, "clipboard", uid), {
    kind: "files",
    files: [...keepFiles, ...uploaded],
    updatedAt: Date.now(),
    // Schalter des bisherigen Eintrags uebernehmen, sonst laeuft neuer Inhalt
    // wieder ab obwohl der Ablauf abgestellt war
    ...(prevData?.noExpiry ? { noExpiry: true } : {}),
  });

  for (const p of prevPaths) {
    deleteObject(ref(storage, p)).catch(() => {});
  }
}

// Schaltet den automatischen Ablauf um. updatedAt bleibt beim Einschalten des
// Ablaufs bewusst unveraendert - der Timer laeuft dann ab dem urspruenglichen
// Zeitpunkt weiter statt neu zu starten. Existiert noch kein Eintrag, wird ein
// leerer angelegt, damit die Einstellung schon vor dem ersten Inhalt gilt
export async function setClipboardNoExpiry(uid: string, noExpiry: boolean) {
  const snap = await getDoc(doc(db, "clipboard", uid));
  const prev = snap.exists() ? (snap.data() as ClipboardData) : null;

  await setDoc(
    doc(db, "clipboard", uid),
    { ...(prev ?? { updatedAt: Date.now() }), noExpiry },
    { merge: true }
  );
}

// Best effort: alle Storage-Objekte eines Ablage-Eintrags entfernen
export async function deleteClipboardFiles(files: ClipboardFile[]) {
  await Promise.all(
    files.map((f) =>
      deleteObject(ref(storage, f.storagePath)).catch(() => {
        // Datei evtl. schon weg oder Berechtigung fehlt - nicht kritisch
      })
    )
  );
}
