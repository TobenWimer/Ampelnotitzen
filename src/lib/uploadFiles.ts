import { ref, uploadBytes, uploadBytesResumable, getDownloadURL } from "firebase/storage";
import { storage } from "@/lib/firebase";

export type UploadedFile = {
  fileName: string;
  storagePath: string;
  downloadURL: string;
  mimeType: string;
  sizeBytes: number;
};

// Ab dieser Groesse lohnt sich der resumable Upload. Darunter ist der zusaetzliche
// Initialisierungs-Roundtrip teurer als die Uebertragung selbst - bei vielen kleinen
// Dateien war das die Hauptbremse
const RESUMABLE_THRESHOLD = 4 * 1024 * 1024;

// Wie viele Dateien gleichzeitig laufen. Hoeher bringt bei kleinen Dateien kaum noch
// etwas und riskiert, dass der Browser die Verbindungen selbst drosselt
const CONCURRENCY = 4;

// Laedt mehrere Dateien parallel hoch und meldet den Fortschritt ueber alle hinweg
// bytegenau. Kleine Dateien gehen als einfacher Upload raus (ein Request), grosse
// resumable mit laufender Rueckmeldung.
export async function uploadFilesToStorage({
  files,
  pathFor,
  onProgress,
}: {
  files: File[];
  /** Liefert den Storage-Pfad fuer eine Datei. Index hilft, Namenskollisionen zu vermeiden */
  pathFor: (file: File, index: number) => string;
  onProgress?: (pct: number) => void;
}): Promise<UploadedFile[]> {
  const totalBytes = files.reduce((sum, f) => sum + f.size, 0) || 1;

  // Fortschritt je Datei getrennt fuehren, sonst zaehlen parallele Uploads
  // durcheinander und die Summe springt
  const progressPerFile = new Array<number>(files.length).fill(0);
  const report = () => {
    const done = progressPerFile.reduce((a, b) => a + b, 0);
    onProgress?.(Math.min(100, Math.round((done / totalBytes) * 100)));
  };

  const results = new Array<UploadedFile>(files.length);
  let next = 0;

  async function worker() {
    while (true) {
      const index = next++;
      if (index >= files.length) return;

      const file = files[index];
      const storagePath = pathFor(file, index);
      const storageRef = ref(storage, storagePath);
      const metadata = { contentType: file.type || "application/octet-stream" };

      if (file.size >= RESUMABLE_THRESHOLD) {
        await new Promise<void>((resolve, reject) => {
          const task = uploadBytesResumable(storageRef, file, metadata);
          task.on(
            "state_changed",
            (snap) => {
              progressPerFile[index] = snap.bytesTransferred;
              report();
            },
            reject,
            () => resolve()
          );
        });
      } else {
        await uploadBytes(storageRef, file, metadata);
        progressPerFile[index] = file.size;
        report();
      }

      results[index] = {
        fileName: file.name,
        storagePath,
        downloadURL: await getDownloadURL(storageRef),
        mimeType: metadata.contentType,
        sizeBytes: file.size,
      };
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, files.length) }, worker));
  onProgress?.(100);
  return results;
}
