import { collection, doc, serverTimestamp, setDoc } from "firebase/firestore";
import { ref, deleteObject } from "firebase/storage";
import { db, storage } from "@/lib/firebase";
import { downloadFileFromUrl } from "@/lib/download";
import { uploadFilesToStorage } from "@/lib/uploadFiles";

export { downloadFileFromUrl as downloadDocumentFile };

// Laedt eine oder mehrere Dateien parallel hoch und legt je Datei ein
// Firestore-Dokument mit den Metadaten an (docKind: "file").
// Die Firestore-Schreibvorgaenge laufen gebuendelt am Ende, nicht nach jeder Datei
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
  if (files.length === 0) return;

  // Dokument-Referenzen vorab erzeugen, damit die id schon im Storage-Pfad steht
  const docRefs = files.map(() => doc(collection(db, "documents")));

  const uploaded = await uploadFilesToStorage({
    files,
    pathFor: (file, i) => `documentUploads/${uid}/${docRefs[i].id}/${file.name}`,
    onProgress,
  });

  await Promise.all(
    uploaded.map((u, i) =>
      setDoc(docRefs[i], {
        name: u.fileName,
        parentPathSlug,
        uid,
        color: "blue",
        docKind: "file",
        storagePath: u.storagePath,
        downloadURL: u.downloadURL,
        mimeType: u.mimeType,
        sizeBytes: u.sizeBytes,
        createdAt: serverTimestamp(),
        createdAtClient: Date.now() + i, // stabile Reihenfolge im Grid
      })
    )
  );
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
