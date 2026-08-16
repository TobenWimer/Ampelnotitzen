import JSZip from "jszip";
import type { ClipboardFile } from "@/lib/clipboard";

// Laedt eine Liste von Dateien herunter und meldet den Fortschritt bytegenau.
// Frueher wurde pro fertiger Datei gezaehlt, wodurch die Anzeige bei zwei Dateien
// von 0 auf 50 auf 100 sprang statt durchzulaufen
const CONCURRENCY = 4;

async function fetchAll(files: ClipboardFile[], onProgress?: (pct: number) => void) {
  const totalBytes = files.reduce((sum, f) => sum + (f.sizeBytes || 0), 0);

  // Fortschritt je Datei getrennt fuehren, sonst zaehlen parallele Downloads durcheinander
  const progressPerFile = new Array<number>(files.length).fill(0);
  const report = () => {
    if (!totalBytes) return;
    const done = progressPerFile.reduce((a, b) => a + b, 0);
    onProgress?.(Math.min(100, Math.round((done / totalBytes) * 100)));
  };

  const blobs = new Array<{ file: ClipboardFile; blob: Blob }>(files.length);
  let next = 0;

  async function worker() {
    while (true) {
      const index = next++;
      if (index >= files.length) return;

      const file = files[index];
      const res = await fetch(file.downloadURL);
      const reader = res.body?.getReader();

      if (!reader) {
        blobs[index] = { file, blob: await res.blob() };
        progressPerFile[index] = file.sizeBytes || 0;
        report();
        continue;
      }

      const chunks: BlobPart[] = [];
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        progressPerFile[index] += value.length;
        report();
      }
      blobs[index] = { file, blob: new Blob(chunks, { type: file.mimeType }) };
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, files.length) }, worker));
  onProgress?.(100);
  return blobs;
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// Laedt alle Dateien einzeln herunter (nacheinander, damit der Browser die
// Downloads nicht als Popup-Flut blockt)
export async function downloadAllFiles(files: ClipboardFile[], onProgress?: (pct: number) => void) {
  const blobs = await fetchAll(files, onProgress);
  for (const { file, blob } of blobs) {
    triggerDownload(blob, file.fileName);
    // kleine Pause, sonst verwirft Safari die spaeteren Downloads
    await new Promise((r) => setTimeout(r, 250));
  }
}

// Packt alle Dateien in ein Zip und laedt dieses herunter
export async function downloadFilesAsZip(
  files: ClipboardFile[],
  zipName: string,
  onProgress?: (pct: number) => void
) {
  const blobs = await fetchAll(files, onProgress);
  const zip = new JSZip();
  // gleiche Dateinamen wuerden sich im Zip gegenseitig ueberschreiben -> durchnummerieren
  const seen = new Map<string, number>();
  for (const { file, blob } of blobs) {
    const n = seen.get(file.fileName) ?? 0;
    seen.set(file.fileName, n + 1);
    const name = n === 0 ? file.fileName : file.fileName.replace(/(\.[^.]+)?$/, `-${n}$1`);
    zip.file(name, blob);
  }
  triggerDownload(await zip.generateAsync({ type: "blob" }), `${zipName}.zip`);
}

// Ob das Geraet das Teilen von Dateien ueber das System-Sheet unterstuetzt
// (auf dem Handy landen Fotos darueber direkt in der Galerie)
export function canShareFiles() {
  return typeof navigator !== "undefined" && !!navigator.canShare && !!navigator.share;
}

// Laedt die Dateien herunter und bereitet sie fuers Teilen vor, teilt aber noch nicht.
// Getrennt, weil navigator.share() eine frische Nutzergeste braucht: das Herunterladen
// dauert je nach Groesse mehrere Sekunden, danach ist die Geste vom urspruenglichen
// Klick abgelaufen und der Aufruf scheitert mit NotAllowedError
// Das System-Teilen-Sheet vertraegt nur eine begrenzte Zahl Dateien - Android bricht
// bei vielen kommentarlos ab, und alle vorher in den Arbeitsspeicher zu laden sprengt
// auf dem Handy ohnehin den Rahmen. Ab hier lieber auf ZIP verweisen
export const MAX_SHARE_FILES = 20;

export async function prepareShareFiles(
  files: ClipboardFile[],
  onProgress?: (pct: number) => void
): Promise<File[]> {
  if (files.length > MAX_SHARE_FILES) {
    throw new Error("SHARE_TOO_MANY");
  }
  const blobs = await fetchAll(files, onProgress);
  const shareable = blobs.map(({ file, blob }) => new File([blob], file.fileName, { type: file.mimeType }));

  if (!navigator.canShare?.({ files: shareable })) {
    throw new Error("SHARE_UNSUPPORTED");
  }
  return shareable;
}

// Ruft das System-Teilen-Sheet auf. MUSS direkt im Klick-Handler stehen, ohne await
// davor, sonst ist die Nutzergeste bereits verbraucht
export async function shareNow(shareable: File[]) {
  await navigator.share({ files: shareable });
}

// Bequemer Einzelaufruf: erst vorbereiten, dann sofort teilen. Klappt zuverlaessig nur
// bei kleinen Dateien - bei groesseren die beiden Schritte einzeln nutzen
export async function shareFiles(files: ClipboardFile[], onProgress?: (pct: number) => void) {
  await shareNow(await prepareShareFiles(files, onProgress));
}
