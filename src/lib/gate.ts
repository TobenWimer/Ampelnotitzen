import { collection, deleteDoc, doc, increment, onSnapshot, setDoc, updateDoc } from "firebase/firestore";
import { ref, deleteObject } from "firebase/storage";
import { db, storage } from "@/lib/firebase";
import type { ClipboardFile } from "@/lib/clipboard";
import { uploadFilesToStorage } from "@/lib/uploadFiles";

// Ein "Gate" ist ein zeitlich begrenzter, oeffentlicher Abholpunkt: der Ersteller laedt
// Dateien hoch und verschickt den Link. Empfaenger brauchen keinen Account - die zufaellige
// Gate-ID im Link IST das Geheimnis. Nach Ablauf verweigern die Firestore-Regeln den Zugriff,
// der Link fuehrt also ins Leere.
export type GateFile = ClipboardFile;

export type Gate = {
  id: string;
  ownerUid: string;
  files: GateFile[];
  createdAt: number;
  expiresAt: number;
  note: string;
  downloadCount: number;
};

export const GATE_DURATIONS = [
  { label: "3 Minuten", ms: 3 * 60 * 1000 },
  { label: "5 Minuten", ms: 5 * 60 * 1000 },
  { label: "15 Minuten", ms: 15 * 60 * 1000 },
  { label: "1 Stunde", ms: 60 * 60 * 1000 },
  { label: "6 Stunden", ms: 6 * 60 * 60 * 1000 },
  { label: "24 Stunden", ms: 24 * 60 * 60 * 1000 },
  { label: "7 Tage", ms: 7 * 24 * 60 * 60 * 1000 },
];

export const isGateExpired = (gate: Pick<Gate, "expiresAt">) => Date.now() >= gate.expiresAt;

// Unratbare ID - sie ersetzt die Anmeldung als Zugangsschutz, darf also nicht
// hochzaehlbar oder kurz sein. 32 Zufallsbytes = 64 Hex-Zeichen (256 Bit)
function newGateId() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

// Fuer href-Attribute: relativ, damit Server- und Client-Rendering identisch sind
export function gatePath(gateId: string) {
  return `/gate/${gateId}`;
}

// Fuer die Zwischenablage: absolute URL. Nur im Browser aufrufen (Klick-Handler)
export function gateUrl(gateId: string) {
  return `${window.location.origin}${gatePath(gateId)}`;
}

// Legt ein Gate an: Dateien hochladen, danach das Firestore-Dokument schreiben.
// Der Storage-Pfad enthaelt die uid, damit die Storage-Regeln das Schreiben auf den
// Besitzer begrenzen koennen, und die gateId, damit Aufraeumen einfach bleibt
export async function createGate({
  files,
  uid,
  durationMs,
  note,
  onProgress,
}: {
  files: File[];
  uid: string;
  durationMs: number;
  note: string;
  onProgress?: (pct: number) => void;
}): Promise<Gate> {
  if (files.length === 0) throw new Error("NO_FILES");

  const gateId = newGateId();
  const uploaded = await uploadFilesToStorage({
    files,
    pathFor: (file, i) => `gateUploads/${uid}/${gateId}/${i}-${file.name}`,
    onProgress,
  });

  const now = Date.now();
  const gate: Gate = {
    id: gateId,
    ownerUid: uid,
    files: uploaded,
    createdAt: now,
    expiresAt: now + durationMs,
    note,
    downloadCount: 0,
  };

  await setDoc(doc(db, "gates", gateId), {
    ownerUid: gate.ownerUid,
    files: gate.files,
    createdAt: gate.createdAt,
    expiresAt: gate.expiresAt,
    note: gate.note,
    downloadCount: 0,
  });

  return gate;
}

export function gateFromData(id: string, data: Record<string, unknown>): Gate {
  return {
    id,
    ownerUid: (data.ownerUid as string) ?? "",
    files: (data.files ?? []) as GateFile[],
    createdAt: (data.createdAt as number) ?? 0,
    expiresAt: (data.expiresAt as number) ?? 0,
    note: (data.note as string) ?? "",
    downloadCount: (data.downloadCount as number) ?? 0,
  };
}

// Beobachtet ein Gate live. Wird es geschlossen (Dokument geloescht) oder laeuft es ab
// (Regeln verweigern den Zugriff), meldet der Callback null - die Empfangsseite kann so
// sofort dichtmachen, ohne dass jemand neu laden muss
export function subscribeGate(gateId: string, onChange: (gate: Gate | null) => void) {
  return onSnapshot(
    doc(db, "gates", gateId),
    (snap) => {
      if (!snap.exists()) {
        onChange(null);
        return;
      }
      const gate = gateFromData(snap.id, snap.data());
      onChange(isGateExpired(gate) ? null : gate);
    },
    () => onChange(null)
  );
}

// Meldet dem Ersteller, dass gerade jemand abholt. Die Firestore-Regel laesst genau
// diese eine Erhoehung um 1 zu und sonst nichts - mehr als einen falschen Zaehlerstand
// kann ein Empfaenger damit nicht anrichten
export async function registerGateDownload(gateId: string) {
  try {
    await updateDoc(doc(db, "gates", gateId), { downloadCount: increment(1) });
  } catch {
    // nur eine Statusanzeige - Fehler duerfen den Download nicht blockieren
  }
}

// Legt Dateien in ein bereits offenes Gate nach. Laufzeit und Link bleiben unveraendert,
// Empfaenger sehen die neuen Dateien sofort (die Gastseite haengt per onSnapshot dran)
export async function addFilesToGate({
  gate,
  files,
  onProgress,
}: {
  gate: Gate;
  files: File[];
  onProgress?: (pct: number) => void;
}) {
  if (files.length === 0) return;

  // Zeitstempel im Pfad, damit ein zweiter Upload derselben Datei den ersten
  // nicht ueberschreibt
  const stamp = Date.now();
  const uploaded = await uploadFilesToStorage({
    files,
    pathFor: (file, i) => `gateUploads/${gate.ownerUid}/${gate.id}/${stamp}-${i}-${file.name}`,
    onProgress,
  });

  await updateDoc(doc(db, "gates", gate.id), { files: [...gate.files, ...uploaded] });
}

// Schliesst ein Gate endgueltig: erst die Dateien aus Storage, dann das Dokument.
// Reihenfolge ist wichtig - die Storage-Pfade stehen nur im Dokument
export async function closeGate(gate: Gate) {
  await Promise.all(
    gate.files.map((f) =>
      deleteObject(ref(storage, f.storagePath)).catch(() => {
        // schon geloescht oder keine Berechtigung - nicht kritisch
      })
    )
  );
  await deleteDoc(doc(db, "gates", gate.id));
}

export const gatesCollection = () => collection(db, "gates");
