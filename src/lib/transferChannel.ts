"use client";

// Belegung der Übertragungsstrecke.
//
// Wichtig zur Einordnung: Firebase Storage ist nicht der Engpass, das skaliert weit
// ueber alles hinaus, was hier anfaellt. Was sich wirklich teilt, ist der eigene
// Anschluss - laufen in zwei Tabs gleichzeitig Uebertragungen, halbiert sich die
// Bandbreite je Vorgang.
//
// Deshalb wird der Zustand ueber BroadcastChannel geteilt: das erreicht alle Tabs
// desselben Browsers, also genau die Vorgaenge, die sich tatsaechlich in die Quere
// kommen. Ueber Geraete hinweg waere die Anzeige irrefuehrend, weil zwei Geraete in
// verschiedenen Netzen einander nicht bremsen.

export type TransferKind = "upload" | "download";

export type ActiveTransfer = {
  id: string;
  kind: TransferKind;
  label: string;
  /** Zeitstempel des letzten Lebenszeichens */
  seenAt: number;
};

export type ChannelState = {
  busy: boolean;
  uploads: number;
  downloads: number;
  labels: string[];
};

const CHANNEL = "osb-transfer";
const HEARTBEAT_MS = 2000;
// Grosszuegiger als der Herzschlag: ein abgestuerzter oder geschlossener Tab soll die
// Anzeige nicht dauerhaft auf "belegt" stehen lassen
const STALE_MS = 6000;

type Msg =
  | { type: "alive"; id: string; kind: TransferKind; label: string }
  | { type: "end"; id: string }
  | { type: "ping" };

const own = new Map<string, { kind: TransferKind; label: string }>();
const foreign = new Map<string, ActiveTransfer>();
const listeners = new Set<(s: ChannelState) => void>();

let bc: BroadcastChannel | null = null;
let heartbeat: ReturnType<typeof setInterval> | null = null;

function post(msg: Msg) {
  try {
    bc?.postMessage(msg);
  } catch {
    // BroadcastChannel nicht verfuegbar - dann gilt eben nur der eigene Tab
  }
}

function snapshot(): ChannelState {
  const now = Date.now();
  const all: { kind: TransferKind; label: string }[] = [...own.values()];
  for (const t of foreign.values()) {
    if (now - t.seenAt <= STALE_MS) all.push({ kind: t.kind, label: t.label });
  }
  return {
    busy: all.length > 0,
    uploads: all.filter((t) => t.kind === "upload").length,
    downloads: all.filter((t) => t.kind === "download").length,
    labels: all.map((t) => t.label),
  };
}

function emit() {
  const s = snapshot();
  listeners.forEach((fn) => fn(s));
}

function ensureChannel() {
  if (bc || typeof window === "undefined" || typeof BroadcastChannel === "undefined") return;
  bc = new BroadcastChannel(CHANNEL);
  bc.onmessage = (e: MessageEvent<Msg>) => {
    const msg = e.data;
    if (msg.type === "alive") {
      foreign.set(msg.id, { id: msg.id, kind: msg.kind, label: msg.label, seenAt: Date.now() });
      emit();
    } else if (msg.type === "end") {
      foreign.delete(msg.id);
      emit();
    } else if (msg.type === "ping") {
      // Ein neuer Tab fragt nach: eigene laufende Vorgaenge sofort melden, damit er
      // nicht bis zum naechsten Herzschlag "frei" anzeigt
      for (const [id, t] of own) post({ type: "alive", id, ...t });
    }
  };
}

function ensureHeartbeat() {
  if (heartbeat || own.size === 0) return;
  heartbeat = setInterval(() => {
    for (const [id, t] of own) post({ type: "alive", id, ...t });
    // veraltete Fremdeintraege verwerfen, falls ein Tab ohne Abmeldung verschwand
    const now = Date.now();
    let changed = false;
    for (const [id, t] of foreign) {
      if (now - t.seenAt > STALE_MS) {
        foreign.delete(id);
        changed = true;
      }
    }
    if (changed) emit();
  }, HEARTBEAT_MS);
}

function stopHeartbeatIfIdle() {
  if (own.size === 0 && heartbeat) {
    clearInterval(heartbeat);
    heartbeat = null;
  }
}

/** Meldet einen laufenden Vorgang an. Rueckgabe unbedingt in finally aufrufen. */
export function beginTransfer(kind: TransferKind, label: string): () => void {
  ensureChannel();
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  own.set(id, { kind, label });
  post({ type: "alive", id, kind, label });
  ensureHeartbeat();
  emit();

  let ended = false;
  return () => {
    if (ended) return;
    ended = true;
    own.delete(id);
    post({ type: "end", id });
    stopHeartbeatIfIdle();
    emit();
  };
}

export function subscribeChannel(cb: (s: ChannelState) => void): () => void {
  ensureChannel();
  listeners.add(cb);
  cb(snapshot());
  // andere Tabs nach ihrem Stand fragen
  post({ type: "ping" });
  return () => {
    listeners.delete(cb);
  };
}
