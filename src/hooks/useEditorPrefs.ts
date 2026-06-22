"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { auth, db } from "@/lib/firebase";
import { doc, onSnapshot, serverTimestamp, setDoc } from "firebase/firestore";

/* =========================
   Typen & Defaults
   ========================= */
export type Tool = "pen" | "marker" | "eraser";

export type EditorPrefs = {
  uid: string;
  penColors: string[];     // Hex ohne Alpha
  markerColors: string[];  // Hex ohne Alpha (Alpha fügt UI hinzu)
  penSizes: number[];
  markerSizes: number[];
  penIdx: number;
  markerIdx: number;
  sizeIdxPen: number;
  sizeIdxMarker: number;
  updatedAt?: any;
};

const DEFAULTS: EditorPrefs = {
  uid: "",
  penColors: ["#111827", "#2563EB", "#10B981", "#F59E0B", "#EF4444"],
  markerColors: ["#FBBF24", "#60A5FA", "#34D399", "#F472B6", "#A78BFA"],
  penSizes: [2, 4, 7],
  markerSizes: [8, 16, 24],
  penIdx: 0,
  markerIdx: 0,
  sizeIdxPen: 1,
  sizeIdxMarker: 1,
};

function clampIdx<T>(arr: T[], i: number, fallback = 0) {
  if (!Array.isArray(arr) || arr.length === 0) return fallback;
  const idx = typeof i === "number" ? i : fallback;
  return Math.max(0, Math.min(arr.length - 1, idx));
}
function stripAlpha(hex: string) {
  if (!hex?.startsWith("#")) return "#111827";
  if (hex.length === 9) return hex.slice(0, 7);
  if (hex.length === 4) return expandShortHex(hex);
  return hex;
}
function ensureAlpha(hex: string, alpha?: number) {
  const base = stripAlpha(hex);
  const a = Math.round(Math.max(0, Math.min(1, alpha ?? 1)) * 255);
  const aa = a.toString(16).padStart(2, "0").toUpperCase();
  return `${base}${aa}`;
}
function expandShortHex(h: string) {
  if (!h.startsWith("#") || h.length !== 4) return h;
  const r = h[1], g = h[2], b = h[3];
  return `#${r}${r}${g}${g}${b}${b}`;
}

/* =========================
   Hook
   ========================= */
export function useEditorPrefs() {
  // Auth
  const [uid, setUid] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const off = auth.onAuthStateChanged((u) => {
      setUid(u?.uid ?? null);
      setReady(true);
    });
    return () => off();
  }, []);

  // State (intern)
  const [penColors, _setPenColors] = useState<string[]>(DEFAULTS.penColors);
  const [markerColors, _setMarkerColors] = useState<string[]>(DEFAULTS.markerColors);
  const [penSizes, _setPenSizes] = useState<number[]>(DEFAULTS.penSizes);
  const [markerSizes, _setMarkerSizes] = useState<number[]>(DEFAULTS.markerSizes);

  const [penIdx, _setPenIdx] = useState<number>(DEFAULTS.penIdx);
  const [markerIdx, _setMarkerIdx] = useState<number>(DEFAULTS.markerIdx);
  const [sizeIdxPen, _setSizeIdxPen] = useState<number>(DEFAULTS.sizeIdxPen);
  const [sizeIdxMarker, _setSizeIdxMarker] = useState<number>(DEFAULTS.sizeIdxMarker);

  // „Jitter“-Schutz
  const firstLoadRef = useRef(true);
  const lastLocalWriteRef = useRef(0);

  // Live laden
  useEffect(() => {
    if (!ready || !uid) return;

    const ref = doc(db, "editorPrefs", uid);
    // Doc sicherstellen
    setDoc(ref, { uid }, { merge: true }).catch(() => {});

    const off = onSnapshot(
      ref,
      (snap) => {
        if (!snap.exists()) { return; }
        const d = snap.data() as Partial<EditorPrefs>;

        // Eigenes frisches Save ignorieren (um „Zurückspringen“ zu vermeiden)
        const serverUpdated =
          d.updatedAt && typeof (d.updatedAt as any).toMillis === "function"
            ? (d.updatedAt as any).toMillis()
            : 0;
        if (!firstLoadRef.current && serverUpdated && serverUpdated <= lastLocalWriteRef.current + 250) {
          return;
        }

        // Arrays (mit Fallbacks)
        const nextPenColors   = Array.isArray(d.penColors)   && d.penColors.length   ? d.penColors.map(stripAlpha) : penColors;
        const nextMarkerColors= Array.isArray(d.markerColors)&& d.markerColors.length? d.markerColors.map(stripAlpha) : markerColors;
        const nextPenSizes    = Array.isArray(d.penSizes)    && d.penSizes.length    ? d.penSizes : penSizes;
        const nextMarkerSizes = Array.isArray(d.markerSizes) && d.markerSizes.length ? d.markerSizes : markerSizes;

        _setPenColors(nextPenColors);
        _setMarkerColors(nextMarkerColors);
        _setPenSizes(nextPenSizes);
        _setMarkerSizes(nextMarkerSizes);

        // Indizes — OHNE funktionale Setter, explizit berechnet
        if (typeof d.penIdx === "number") {
          _setPenIdx(clampIdx(nextPenColors, d.penIdx, penIdx));
        }
        if (typeof d.markerIdx === "number") {
          _setMarkerIdx(clampIdx(nextMarkerColors, d.markerIdx, markerIdx));
        }
        if (typeof d.sizeIdxPen === "number") {
          _setSizeIdxPen(clampIdx(nextPenSizes, d.sizeIdxPen, sizeIdxPen));
        }
        if (typeof d.sizeIdxMarker === "number") {
          _setSizeIdxMarker(clampIdx(nextMarkerSizes, d.sizeIdxMarker, sizeIdxMarker));
        }

        firstLoadRef.current = false;
      },
      // Fehler: still halten, UI soll weiterlaufen
      () => {}
    );

    return () => off();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, uid]);

  // Debounced Save
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const save = (payload: EditorPrefs) => {
    if (!uid) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      lastLocalWriteRef.current = Date.now();
      setDoc(doc(db, "editorPrefs", uid), { ...payload, updatedAt: serverTimestamp() }, { merge: true })
        .catch((e) => console.warn("[editorPrefs] save failed:", e));
    }, 220);
  };

  // Öffentliche Setter (lösen Save aus)
  const snapshot = (): EditorPrefs => ({
    uid: uid ?? "",
    penColors, markerColors, penSizes, markerSizes,
    penIdx, markerIdx, sizeIdxPen, sizeIdxMarker,
  });

  const setPenColors = (v: string[] | ((prev: string[]) => string[])) => {
    const next = typeof v === "function" ? v(penColors) : v;
    _setPenColors(next);
    if (!firstLoadRef.current) save({ ...snapshot(), penColors: next });
  };
  const setMarkerColors = (v: string[] | ((prev: string[]) => string[])) => {
    const next = typeof v === "function" ? v(markerColors) : v;
    _setMarkerColors(next);
    if (!firstLoadRef.current) save({ ...snapshot(), markerColors: next });
  };
  const setPenSizes = (v: number[] | ((prev: number[]) => number[])) => {
    const next = typeof v === "function" ? v(penSizes) : v;
    _setPenSizes(next);
    if (!firstLoadRef.current) save({ ...snapshot(), penSizes: next });
  };
  const setMarkerSizes = (v: number[] | ((prev: number[]) => number[])) => {
    const next = typeof v === "function" ? v(markerSizes) : v;
    _setMarkerSizes(next);
    if (!firstLoadRef.current) save({ ...snapshot(), markerSizes: next });
  };

  const setPenIdx = (i: number) => { _setPenIdx(i); if (!firstLoadRef.current) save({ ...snapshot(), penIdx: i }); };
  const setMarkerIdx = (i: number) => { _setMarkerIdx(i); if (!firstLoadRef.current) save({ ...snapshot(), markerIdx: i }); };
  const setSizeIdxPen = (i: number) => { _setSizeIdxPen(i); if (!firstLoadRef.current) save({ ...snapshot(), sizeIdxPen: i }); };
  const setSizeIdxMarker = (i: number) => { _setSizeIdxMarker(i); if (!firstLoadRef.current) save({ ...snapshot(), sizeIdxMarker: i }); };

  // Abgeleitet für UI
  const currentPenColor    = useMemo(() => stripAlpha(penColors[clampIdx(penColors, penIdx)] ?? "#111827"), [penColors, penIdx]);
  const currentMarkerColor = useMemo(() => ensureAlpha(stripAlpha(markerColors[clampIdx(markerColors, markerIdx)] ?? "#FBBF24"), 0.66), [markerColors, markerIdx]);
  const currentPenSize     = useMemo(() => penSizes[clampIdx(penSizes, sizeIdxPen)] ?? 2, [penSizes, sizeIdxPen]);
  const currentMarkerSize  = useMemo(() => markerSizes[clampIdx(markerSizes, sizeIdxMarker)] ?? 16, [markerSizes, sizeIdxMarker]);

  return {
    // auth/ready
    uid, ready,

    // arrays + setter
    penColors, setPenColors,
    markerColors, setMarkerColors,
    penSizes, setPenSizes,
    markerSizes, setMarkerSizes,

    // indices + setter
    penIdx, setPenIdx,
    markerIdx, setMarkerIdx,
    sizeIdxPen, setSizeIdxPen,
    sizeIdxMarker, setSizeIdxMarker,

    // abgeleitet
    currentPenColor,
    currentMarkerColor,
    currentPenSize,
    currentMarkerSize,
  };
}
