import { collection, getDoc, getDocs, doc, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { clipboardFiles, type ClipboardData } from "@/lib/clipboard";

// Firebase-Free-Tier sind 5 GB. Die harte Grenze liegt bewusst darunter, damit ein
// Upload nicht exakt an der Kante scheitert und noch Luft fuer Firestore-Overhead bleibt.
export const STORAGE_LIMIT_BYTES = 4.6 * 1024 * 1024 * 1024;

// Muss mit der Obergrenze in storage.rules uebereinstimmen. Wird sie dort geaendert,
// hier nachziehen - sonst laesst der Client etwas durch, das der Server ablehnt,
// und der Upload bricht mitten drin mit einer nichtssagenden Meldung ab
export const MAX_FILE_BYTES = 1024 * 1024 * 1024;

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

// Summiert alles, was dieser User im Storage belegt: Dokumente-Uploads, die
// Transfer-Ablage und alle offenen Gates. Die Zahlen stehen jeweils als sizeBytes
// in den Firestore-Dokumenten, es wird also nicht der Storage selbst abgefragt
export async function getUsedBytes(uid: string): Promise<number> {
  let total = 0;

  const docsSnap = await getDocs(query(collection(db, "documents"), where("uid", "==", uid)));
  docsSnap.forEach((d) => {
    const sz = d.data().sizeBytes;
    if (typeof sz === "number") total += sz;
  });

  const clipSnap = await getDoc(doc(db, "clipboard", uid));
  if (clipSnap.exists()) {
    for (const f of clipboardFiles(clipSnap.data() as ClipboardData)) total += f.sizeBytes ?? 0;
  }

  const gatesSnap = await getDocs(query(collection(db, "gates"), where("ownerUid", "==", uid)));
  gatesSnap.forEach((g) => {
    for (const f of (g.data().files ?? []) as { sizeBytes?: number }[]) total += f.sizeBytes ?? 0;
  });

  return total;
}

export type QuotaCheck = {
  ok: boolean;
  used: number;
  incoming: number;
  limit: number;
  /** Fertige Meldung fuer die UI, wenn ok === false */
  message: string;
};

// Prueft VOR dem Upload, ob die neuen Dateien noch ins Kontingent passen.
// Bewusst vorher statt hinterher: ein abgebrochener Upload wuerde sonst Bytes
// im Storage hinterlassen, die keine Metadaten haben und niemandem auffallen
export async function checkQuota(uid: string, files: File[]): Promise<QuotaCheck> {
  const incoming = files.reduce((sum, f) => sum + f.size, 0);

  // Zuerst die Einzeldatei-Grenze, ohne Firestore-Abfrage: eine zu grosse Datei
  // scheitert ohnehin an den Storage-Regeln, das muss man nicht erst herausfinden
  const tooBig = files.find((f) => f.size > MAX_FILE_BYTES);
  if (tooBig) {
    return {
      ok: false,
      used: 0,
      incoming,
      limit: STORAGE_LIMIT_BYTES,
      message:
        `„${tooBig.name}" ist mit ${formatBytes(tooBig.size)} zu gross. ` +
        `Pro Datei sind maximal ${formatBytes(MAX_FILE_BYTES)} möglich.`,
    };
  }

  const used = await getUsedBytes(uid);
  const ok = used + incoming <= STORAGE_LIMIT_BYTES;

  return {
    ok,
    used,
    incoming,
    limit: STORAGE_LIMIT_BYTES,
    message: ok
      ? ""
      : `Speicher reicht nicht: ${formatBytes(used)} belegt, ${formatBytes(incoming)} sollen dazu. ` +
        `Grenze ist ${formatBytes(STORAGE_LIMIT_BYTES)}. Bitte zuerst etwas löschen.`,
  };
}
