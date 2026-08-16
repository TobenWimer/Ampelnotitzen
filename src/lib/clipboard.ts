import { doc, getDoc, setDoc } from "firebase/firestore";
import { ref, uploadBytesResumable, getDownloadURL, deleteObject } from "firebase/storage";
import { db, storage } from "@/lib/firebase";

// Geteilter Inhalt ist bewusst nur eine kurze Zeit gültig (Handoff-Zweck, kein Speicher)
export const CLIPBOARD_TTL_MS = 3 * 60 * 1000;
export const isClipboardExpired = (updatedAt: number) => Date.now() - updatedAt > CLIPBOARD_TTL_MS;

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

  const uploaded: ClipboardFile[] = [];
  const total = files.length;

  for (let i = 0; i < total; i++) {
    const file = files[i];
    const storagePath = `clipboardUploads/${uid}/${Date.now()}-${i}-${file.name}`;
    const storageRef = ref(storage, storagePath);

    await new Promise<void>((resolve, reject) => {
      const task = uploadBytesResumable(storageRef, file);
      task.on(
        "state_changed",
        (snap) => {
          const filePct = snap.bytesTransferred / snap.totalBytes;
          onProgress?.(Math.round(((i + filePct) / total) * 100));
        },
        reject,
        () => resolve()
      );
    });

    uploaded.push({
      fileName: file.name,
      storagePath,
      downloadURL: await getDownloadURL(storageRef),
      mimeType: file.type || "application/octet-stream",
      sizeBytes: file.size,
    });
  }

  await setDoc(doc(db, "clipboard", uid), {
    kind: "files",
    files: [...keepFiles, ...uploaded],
    updatedAt: Date.now(),
  });

  for (const p of prevPaths) {
    deleteObject(ref(storage, p)).catch(() => {});
  }
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
