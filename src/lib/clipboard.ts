import { doc, getDoc, setDoc } from "firebase/firestore";
import { ref, uploadBytesResumable, getDownloadURL, deleteObject } from "firebase/storage";
import { db, storage } from "@/lib/firebase";

// Geteilter Inhalt ist bewusst nur eine kurze Zeit gültig (Handoff-Zweck, kein Speicher)
export const CLIPBOARD_TTL_MS = 3 * 60 * 1000;
export const isClipboardExpired = (updatedAt: number) => Date.now() - updatedAt > CLIPBOARD_TTL_MS;

export type ClipboardData = {
  kind?: "text" | "file"; // fehlt bei alten Eintraegen -> als "text" behandeln
  text?: string;
  fileName?: string;
  storagePath?: string;
  downloadURL?: string;
  mimeType?: string;
  sizeBytes?: number;
  updatedAt: number;
};

// Laedt eine Datei/ein Bild in die (geraeteuebergreifende) Zwischenablage. Ersetzt den
// kompletten bisherigen Inhalt (Text oder Datei), ein vorheriges Storage-Objekt wird
// danach best-effort entfernt, da pro User nur ein Zwischenablage-Slot existiert
export async function uploadClipboardFile({
  file,
  uid,
  onProgress,
}: {
  file: File;
  uid: string;
  onProgress?: (pct: number) => void;
}) {
  const prevSnap = await getDoc(doc(db, "clipboard", uid));
  const prevPath = prevSnap.exists() ? (prevSnap.data().storagePath as string | undefined) : undefined;

  const storagePath = `clipboardUploads/${uid}/${Date.now()}-${file.name}`;
  const storageRef = ref(storage, storagePath);

  await new Promise<void>((resolve, reject) => {
    const task = uploadBytesResumable(storageRef, file);
    task.on(
      "state_changed",
      (snap) => onProgress?.(Math.round((snap.bytesTransferred / snap.totalBytes) * 100)),
      reject,
      () => resolve()
    );
  });

  const downloadURL = await getDownloadURL(storageRef);

  await setDoc(doc(db, "clipboard", uid), {
    kind: "file",
    fileName: file.name,
    storagePath,
    downloadURL,
    mimeType: file.type || "application/octet-stream",
    sizeBytes: file.size,
    updatedAt: Date.now(),
  });

  if (prevPath) {
    deleteObject(ref(storage, prevPath)).catch(() => {});
  }
}

export async function deleteClipboardFile(storagePath?: string) {
  if (!storagePath) return;
  try {
    await deleteObject(ref(storage, storagePath));
  } catch {
    // Datei evtl. schon weg oder Berechtigung fehlt - nicht kritisch
  }
}
