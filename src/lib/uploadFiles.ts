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

// Wie viele Dateien gleichzeitig laufen
const CONCURRENCY = 4;

// Mobile Verbindungen brechen einzelne Uploads gelegentlich ab (Firebase meldet dann
// storage/unknown oder storage/retry-limit-exceeded). Ein paar Wiederholungen fangen
// das ab, statt den ganzen Vorgang scheitern zu lassen
const MAX_ATTEMPTS = 3;

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

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

  const paths = files.map((f, i) => pathFor(f, i));
  let next = 0;

  async function uploadOne(index: number) {
    const file = files[index];
    const storageRef = ref(storage, paths[index]);
    const metadata = { contentType: file.type || "application/octet-stream" };

    for (let attempt = 1; ; attempt++) {
      try {
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
        return;
      } catch (err) {
        const code = (err as { code?: string })?.code ?? "";
        // Zu grosse Datei oder fehlende Berechtigung wird durch Wiederholen nicht besser
        if (code === "storage/unauthorized" || attempt >= MAX_ATTEMPTS) throw err;
        progressPerFile[index] = 0;
        report();
        await wait(attempt * 800);
      }
    }
  }

  async function worker() {
    while (true) {
      const index = next++;
      if (index >= files.length) return;
      await uploadOne(index);
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, files.length) }, worker));

  // Download-URLs erst am Schluss und alle gleichzeitig. Vorher lief pro Datei ein
  // eigener Roundtrip mitten zwischen den Uploads, das hat den Ablauf ausgebremst
  const urls = await Promise.all(paths.map((p) => getDownloadURL(ref(storage, p))));

  onProgress?.(100);
  return files.map((file, i) => ({
    fileName: file.name,
    storagePath: paths[i],
    downloadURL: urls[i],
    mimeType: file.type || "application/octet-stream",
    sizeBytes: file.size,
  }));
}
