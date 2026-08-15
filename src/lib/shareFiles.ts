import JSZip from "jszip";
import type { ClipboardFile } from "@/lib/clipboard";

// Laedt eine Liste von Dateien herunter und meldet den kombinierten Fortschritt
async function fetchAll(files: ClipboardFile[], onProgress?: (pct: number) => void) {
  const blobs: { file: ClipboardFile; blob: Blob }[] = [];
  for (let i = 0; i < files.length; i++) {
    const res = await fetch(files[i].downloadURL);
    blobs.push({ file: files[i], blob: await res.blob() });
    onProgress?.(Math.round(((i + 1) / files.length) * 100));
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

// Uebergibt die Dateien an das System-Teilen-Sheet
export async function shareFiles(files: ClipboardFile[], onProgress?: (pct: number) => void) {
  const blobs = await fetchAll(files, onProgress);
  const shareable = blobs.map(({ file, blob }) => new File([blob], file.fileName, { type: file.mimeType }));

  if (!navigator.canShare?.({ files: shareable })) {
    throw new Error("SHARE_UNSUPPORTED");
  }
  await navigator.share({ files: shareable });
}
