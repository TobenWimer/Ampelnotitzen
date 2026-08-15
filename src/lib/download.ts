// Erzwingt echten Datei-Download (Blob statt direkter Navigation), da eine simple
// Link-Navigation zu einer Firebase-URL vom Browser nur angezeigt statt heruntergeladen wird.
// Liest den Response-Body gestreamt statt res.blob(), damit echter Fortschritt moeglich ist
export async function downloadFileFromUrl(url: string, filename: string, onProgress?: (pct: number) => void) {
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
