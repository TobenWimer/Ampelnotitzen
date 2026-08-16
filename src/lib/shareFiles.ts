import JSZip from "jszip";
import type { ClipboardFile } from "@/lib/clipboard";

// Laedt eine Liste von Dateien herunter und meldet den Fortschritt bytegenau.
// Frueher wurde pro fertiger Datei gezaehlt, wodurch die Anzeige bei zwei Dateien
// von 0 auf 50 auf 100 sprang statt durchzulaufen
async function fetchAll(files: ClipboardFile[], onProgress?: (pct: number) => void) {
  const totalBytes = files.reduce((sum, f) => sum + (f.sizeBytes || 0), 0);
  let doneBytes = 0;

  const blobs: { file: ClipboardFile; blob: Blob }[] = [];

  for (const file of files) {
    const res = await fetch(file.downloadURL);
    const reader = res.body?.getReader();

    if (!reader || totalBytes === 0) {
      // Kein Stream verfuegbar: wenigstens nach jeder Datei melden
      blobs.push({ file, blob: await res.blob() });
      doneBytes += file.sizeBytes || 0;
      onProgress?.(totalBytes ? Math.round((doneBytes / totalBytes) * 100) : 0);
      continue;
    }

    const chunks: BlobPart[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      doneBytes += value.length;
      onProgress?.(Math.min(100, Math.round((doneBytes / totalBytes) * 100)));
    }
    blobs.push({ file, blob: new Blob(chunks, { type: file.mimeType }) });
  }

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
export async function prepareShareFiles(
  files: ClipboardFile[],
  onProgress?: (pct: number) => void
): Promise<File[]> {
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
