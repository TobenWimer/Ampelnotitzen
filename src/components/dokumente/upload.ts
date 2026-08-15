import { collection, doc, serverTimestamp, setDoc } from "firebase/firestore";
import { ref, uploadBytesResumable, getDownloadURL, deleteObject } from "firebase/storage";
import { db, storage } from "@/lib/firebase";

// Laedt eine Datei direkt zu Firebase Storage hoch und legt danach das
// Firestore-Dokument mit den Metadaten an (docKind: "file")
export async function uploadDocumentFile({
  file,
  uid,
  parentPathSlug,
  onProgress,
}: {
  file: File;
  uid: string;
  parentPathSlug: string;
  onProgress?: (pct: number) => void;
}) {
  const docRef = doc(collection(db, "documents"));
  const storagePath = `documentUploads/${uid}/${docRef.id}/${file.name}`;
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

  await setDoc(docRef, {
    name: file.name,
    parentPathSlug,
    uid,
    color: "blue",
    docKind: "file",
    storagePath,
    downloadURL,
    mimeType: file.type || "application/octet-stream",
    sizeBytes: file.size,
    createdAt: serverTimestamp(),
    createdAtClient: Date.now(),
  });
}

// Laedt mehrere Dateien nacheinander hoch (Datei-Picker mit multiple oder Drag&Drop),
// meldet den kombinierten Fortschritt ueber alle Dateien hinweg (gleich gewichtet pro Datei)
export async function uploadMultipleFiles({
  files,
  uid,
  parentPathSlug,
  onProgress,
}: {
  files: File[];
  uid: string;
  parentPathSlug: string;
  onProgress?: (pct: number) => void;
}) {
  const total = files.length;
  for (let i = 0; i < total; i++) {
    await uploadDocumentFile({
      file: files[i],
      uid,
      parentPathSlug,
      onProgress: (filePct) => {
        onProgress?.(Math.round(((i + filePct / 100) / total) * 100));
      },
    });
  }
}

// Erzwingt echten Datei-Download (Blob statt direkter Navigation), da eine simple
// Link-Navigation zur Firebase-URL vom Browser nur angezeigt statt heruntergeladen wird.
// Liest den Response-Body gestreamt statt res.blob(), damit echter Fortschritt (Ring) moeglich ist
export async function downloadDocumentFile(url: string, filename: string, onProgress?: (pct: number) => void) {
  const res = await fetch(url);
  const total = Number(res.headers.get("content-length")) || 0;
  const reader = res.body?.getReader();

  let blob: Blob;
  if (reader && total > 0) {
    const chunks: BlobPart[] = [];
    let received = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.length;
      onProgress?.(Math.round((received / total) * 100));
    }
    blob = new Blob(chunks);
  } else {
    blob = await res.blob();
  }

  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = objectUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(objectUrl);
}

// Best effort: Storage-Objekt entfernen, falls vorhanden. Fehler werden verschluckt,
// damit das Loeschen des Firestore-Dokuments (der eigentlich wichtige Teil) nicht blockiert
export async function deleteDocumentFile(storagePath?: string) {
  if (!storagePath) return;
  try {
    await deleteObject(ref(storage, storagePath));
  } catch {
    // Datei evtl. schon weg oder Berechtigung fehlt - nicht kritisch
  }
}
