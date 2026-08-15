import { collection, deleteDoc, doc, getDoc, setDoc } from "firebase/firestore";
import { ref, uploadBytesResumable, getDownloadURL, deleteObject } from "firebase/storage";
import { db, storage } from "@/lib/firebase";
import type { ClipboardFile } from "@/lib/clipboard";

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
};

export const GATE_DURATIONS = [
  { label: "15 Minuten", ms: 15 * 60 * 1000 },
  { label: "1 Stunde", ms: 60 * 60 * 1000 },
  { label: "6 Stunden", ms: 6 * 60 * 60 * 1000 },
  { label: "24 Stunden", ms: 24 * 60 * 60 * 1000 },
  { label: "7 Tage", ms: 7 * 24 * 60 * 60 * 1000 },
];

export const isGateExpired = (gate: Pick<Gate, "expiresAt">) => Date.now() >= gate.expiresAt;

// Unrateba­re ID - sie ersetzt die Anmeldung als Zugangsschutz, darf also nicht
// hochzaehlbar oder kurz sein
function newGateId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID().replace(/-/g, "");
  }
  const bytes = new Uint8Array(16);
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
  const uploaded: GateFile[] = [];
  const total = files.length;

  for (let i = 0; i < total; i++) {
    const file = files[i];
    const storagePath = `gateUploads/${uid}/${gateId}/${i}-${file.name}`;
    const storageRef = ref(storage, storagePath);

    await new Promise<void>((resolve, reject) => {
      const task = uploadBytesResumable(storageRef, file);
      task.on(
        "state_changed",
        (snap) => {
          const filePct = snap.bytesTransferred / snap.totalBytes;
          onProgress?.(Math.round(((i + filePct) / total) * 100));
        },
        reject,
        () => resolve()
      );
    });

    uploaded.push({
      fileName: file.name,
      storagePath,
      downloadURL: await getDownloadURL(storageRef),
      mimeType: file.type || "application/octet-stream",
      sizeBytes: file.size,
    });
  }

  const now = Date.now();
  const gate: Gate = {
    id: gateId,
    ownerUid: uid,
    files: uploaded,
    createdAt: now,
    expiresAt: now + durationMs,
    note,
  };

  await setDoc(doc(db, "gates", gateId), {
    ownerUid: gate.ownerUid,
    files: gate.files,
    createdAt: gate.createdAt,
    expiresAt: gate.expiresAt,
    note: gate.note,
  });

  return gate;
}

// Laedt ein Gate ueber den Link. Ist es abgelaufen, verweigern bereits die Regeln den
// Zugriff - der Fehler wird hier bewusst nicht unterschieden, damit die Seite in beiden
// Faellen dieselbe neutrale Meldung zeigen kann
export async function loadGate(gateId: string): Promise<Gate | null> {
  try {
    const snap = await getDoc(doc(db, "gates", gateId));
    if (!snap.exists()) return null;
    const data = snap.data();
    const gate: Gate = {
      id: snap.id,
      ownerUid: data.ownerUid,
      files: (data.files ?? []) as GateFile[],
      createdAt: data.createdAt ?? 0,
      expiresAt: data.expiresAt ?? 0,
      note: data.note ?? "",
    };
    return isGateExpired(gate) ? null : gate;
  } catch {
    return null;
  }
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
