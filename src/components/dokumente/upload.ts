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

// Erzwingt echten Datei-Download (Blob statt direkter Navigation), da eine simple
// Link-Navigation zur Firebase-URL vom Browser nur angezeigt statt heruntergeladen wird
export async function downloadDocumentFile(url: string, filename: string) {
  const res = await fetch(url);
  const blob = await res.blob();
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
