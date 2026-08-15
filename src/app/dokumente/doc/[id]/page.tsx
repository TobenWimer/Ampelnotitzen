"use client";

/**
 * OneStepBehind – Dokument-Editor
 *
 * Aufbau (Kamera-Modell):
 * - Ein Viewport-Container füllt den Bildschirm unter dem Header und fängt ALLE Zeigereingaben ab.
 *   Der Canvas selbst bekommt `pointer-events: none`, damit iOS ihn nie als "Bild" antippen kann
 *   (sonst erscheint das native Auswahlmenü und Striche brechen ab).
 * - Darin liegt eine Welt-Ebene, die per CSS-Transform verschoben und skaliert wird (die "Kamera").
 *   Die Seiten sind darin in Weltkoordinaten angeordnet. Dadurch ist freies Verschieben und
 *   beliebiges Zoomen möglich, unabhängig von der Seitengrösse (kein Scroll-Container mehr).
 * - Touch steuert ausschliesslich die Navigation (1 Finger schiebt, 2 Finger zoomen),
 *   Stift und Maus zeichnen ausschliesslich. Beides kollidiert dadurch nie.
 * - Die Canvas-Auflösung folgt der Zoomstufe (verzögert), damit die Zeichnung scharf bleibt,
 *   ohne bei jedem Pinch-Frame alles neu rastern zu müssen.
 *
 * Editor-Presets (Farben/Strichdicken) werden nutzerweit in /editorPrefs/{uid} gespeichert.
 */

import Link from "next/link";
import Image from "next/image";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { db, auth } from "@/lib/firebase";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getCountFromServer,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  writeBatch,
} from "firebase/firestore";

// Persistente Editor-Prefs
import { useEditorPrefs } from "@/hooks/useEditorPrefs";

/* =========================
   Typen & Defaults
   ========================= */

type Tool = "pen" | "marker" | "eraser";
type Format = "A4" | "A3" | "A2" | "A1";
type Orientation = "portrait" | "landscape";

// Punkte in absoluten Seiten-Pixeln (Basis: Format/Ausrichtung bei 100% Zoom).
// Bewusst NICHT relativ zur Seitengrösse normiert: die Zeichnung soll ihre
// tatsächliche Grösse behalten, wenn sich nur das Blattformat/die Ausrichtung ändert.
type StrokePoint = { x: number; y: number };
type Stroke = { points: StrokePoint[]; color: string; width: number; tool: Tool };

// Undo/Redo-Historie pro Seite: "add" merkt sich den angehängten Strich, "erase" merkt sich
// jeden vom Linien-Radierer entfernten Strich samt Original-Position (für korrektes Wiedereinfügen)
type HistoryAction =
  | { kind: "add"; stroke: Stroke }
  | { kind: "erase"; removed: { stroke: Stroke; index: number }[] };

type PageDoc = {
  uid: string;
  order: number;
  format: Format;
  orientation: Orientation;
  strokes?: Stroke[];
  createdAt?: unknown;
  createdAtClient?: number;
};

type PageRef = { id: string; order: number; format: Format; orientation: Orientation; strokes: Stroke[] };

// Kamera: Bildschirm = Welt * k + (x, y)
type Camera = { x: number; y: number; k: number };

// A4 Portrait ~150 DPI
const A4_W = 1240;
const A4_H = 1754;
const FORMAT_RANK: Record<Format, number> = { A4: 0, A3: 1, A2: 2, A1: 3 };
function sizeFor(format: Format, orientation: Orientation) {
  const rank = FORMAT_RANK[format] ?? 0;
  const m = Math.pow(Math.SQRT2, rank);
  const w = Math.round(A4_W * m);
  const h = Math.round(A4_H * m);
  return orientation === "portrait" ? { w, h } : { w: h, h: w };
}
function clamp(min: number, max: number, v: number) {
  return Math.max(min, Math.min(max, v));
}

const MIN_K = 0.05;
const MAX_K = 8;
const clampK = (k: number) => clamp(MIN_K, MAX_K, k);
const PAGE_GAP = 60; // Weltpixel zwischen zwei Blättern

/* =========================
   Zeichen-Helfer
   ========================= */

function drawStrokeOn(ctx: CanvasRenderingContext2D, stroke: Stroke) {
  if (stroke.points.length === 0) return;
  ctx.globalCompositeOperation = stroke.tool === "eraser" ? "destination-out" : "source-over";
  ctx.strokeStyle = stroke.color;
  ctx.lineWidth = stroke.width;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  if (stroke.points.length === 1) {
    // Einzelner Tipp: als Punkt zeichnen, sonst wäre er unsichtbar
    const p = stroke.points[0];
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(p.x + 0.01, p.y);
  } else {
    stroke.points.forEach((p, i) => {
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    });
  }
  ctx.stroke();
  ctx.globalCompositeOperation = "source-over";
}

// Marker immer unter Pen zeichnen, sonst "fogt" ein nachträglicher Marker die Pen-Striche ein
function orderForRender(strokes: Stroke[]) {
  return [...strokes.filter((s) => s.tool === "marker"), ...strokes.filter((s) => s.tool !== "marker")];
}

function paintPage(ctx: CanvasRenderingContext2D, w: number, h: number, strokes: Stroke[]) {
  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, w, h);
  orderForRender(strokes).forEach((s) => drawStrokeOn(ctx, s));
}

// Auflösungsfaktor mit Pixelbudget: iOS/Safari bricht bei zu grossen Canvas-Backingstores ab
// (grosse Formate wie A1 würden bei hohem Zoom sonst weit über das Limit laufen).
function resFactorFor(w: number, h: number, k: number, dpr: number) {
  const MAX_SIDE = 4096;
  const MAX_PIXELS = 6_000_000;
  let f = clamp(0.4, 3, k) * dpr;
  if (w * f > MAX_SIDE) f = MAX_SIDE / w;
  if (h * f > MAX_SIDE) f = MAX_SIDE / h;
  if (w * f * h * f > MAX_PIXELS) f = Math.sqrt(MAX_PIXELS / (w * h));
  return Math.max(0.2, f);
}

// Kürzester Abstand von Punkt p zu Liniensegment a-b (für den Linien-Radierer)
function distToSegment(p: StrokePoint, a: StrokePoint, b: StrokePoint) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}
function strokeHit(stroke: Stroke, p: StrokePoint, radius: number) {
  if (stroke.points.length < 2) {
    return stroke.points.some((sp) => Math.hypot(p.x - sp.x, p.y - sp.y) <= radius);
  }
  for (let i = 1; i < stroke.points.length; i++) {
    if (distToSegment(p, stroke.points[i - 1], stroke.points[i]) <= radius) return true;
  }
  return false;
}

/* =========================
   Seite
   ========================= */

export default function DocumentEditorPage() {
  const params = useParams() as { id?: string };
  const docId = params?.id ?? "";

  // Auth
  const [uid, setUid] = useState<string | null>(null);
  const [authReady, setAuthReady] = useState(false);
  useEffect(() => {
    const off = auth.onAuthStateChanged((u) => {
      setUid(u?.uid ?? null);
      setAuthReady(true);
    });
    return () => off();
  }, []);

  // Globale (nutzerweite) Editor-Prefs
  const {
    ready: prefsReady,
    penColors, setPenColors,
    markerColors, setMarkerColors,
    penSizes, setPenSizes,
    markerSizes, setMarkerSizes,
    eraserSizes, setEraserSizes,
    penIdx, setPenIdx,
    markerIdx, setMarkerIdx,
    sizeIdxPen, setSizeIdxPen,
    sizeIdxMarker, setSizeIdxMarker,
    sizeIdxEraser, setSizeIdxEraser,
    currentPenColor,
    currentMarkerColor,
    currentPenSize,
    currentMarkerSize,
    currentEraserSize,
  } = useEditorPrefs();

  // UI: aktives Tool (nicht persistent)
  const [tool, setTool] = useState<Tool>("pen");
  // Radierer-Modus: "pixel" radiert punktuell, "linie" löscht den ganzen berührten Strich
  const [eraserMode, setEraserMode] = useState<"pixel" | "linie">("pixel");

  // Inline-Editoren (Picker)
  const [editColorIdx, setEditColorIdx] = useState<{ type: "pen" | "marker"; idx: number } | null>(null);
  const [editSizeIdx, setEditSizeIdx] = useState<{ type: "pen" | "marker" | "eraser"; idx: number } | null>(null);

  const activeColor = tool === "pen" ? currentPenColor : tool === "marker" ? currentMarkerColor : "#000000";
  const activeSize = tool === "pen" ? currentPenSize : tool === "marker" ? currentMarkerSize : currentEraserSize;

  /* =========================
     Seiten (Firestore)
     ========================= */

  const [pages, setPages] = useState<PageRef[]>([]);
  const [pagesReady, setPagesReady] = useState(false);
  const creatingInitialRef = useRef(false);
  const [debugMsg, setDebugMsg] = useState<string>("");

  // Undo/Redo: bezieht sich auf die zuletzt bearbeitete Seite, Historie pro Seite
  const lastPageIndexRef = useRef<number | null>(null);
  const undoStacksRef = useRef<Record<string, HistoryAction[]>>({});
  const redoStacksRef = useRef<Record<string, HistoryAction[]>>({});

  useEffect(() => {
    if (!authReady || !uid || !docId) return;

    const coll = collection(db, "documents", docId, "pages");
    const qPages = query(coll, orderBy("order", "asc"));

    const unsub = onSnapshot(
      qPages,
      async (snap) => {
        if (snap.empty) {
          setDebugMsg("Keine Seiten in Firestore gefunden (Snapshot leer).");
          if (!creatingInitialRef.current) {
            creatingInitialRef.current = true;
            try {
              const count = await getCountFromServer(qPages);
              if (count.data().count === 0) {
                await createTwoDefaultPages(coll, uid);
              }
            } catch {
              // still bleiben, UI zeigt den Fallback
            } finally {
              creatingInitialRef.current = false;
            }
          }
          setPages([]);
          setPagesReady(false);
          return;
        }

        const arr: PageRef[] = snap.docs.map((d) => {
          const data = d.data() as PageDoc;
          return {
            id: d.id,
            order: data.order ?? 0,
            format: (data.format as Format) ?? "A4",
            orientation: (data.orientation as Orientation) ?? "portrait",
            strokes: data.strokes ?? [],
          };
        });
        arr.sort((a, b) => a.order - b.order);
        setPages(arr);
        setPagesReady(true);
        setDebugMsg("");
      },
      (err) => {
        setDebugMsg("Snapshot-Fehler: " + (err?.message ?? String(err)));
        setPages([]);
        setPagesReady(true);
      }
    );

    return () => unsub();
  }, [authReady, uid, docId]);

  async function createTwoDefaultPages(collRef: ReturnType<typeof collection>, ownerUid: string) {
    const batch = writeBatch(db);
    [0, 1].forEach((order) => {
      batch.set(doc(collRef), {
        uid: ownerUid,
        order,
        format: "A4",
        orientation: "portrait",
        createdAt: serverTimestamp(),
        createdAtClient: Date.now(),
      } as PageDoc);
    });
    await batch.commit();
  }

  const reindexPages = async (current: PageRef[]) => {
    const coll = collection(db, "documents", docId, "pages");
    const batch = writeBatch(db);
    current.forEach((p, i) => batch.update(doc(coll, p.id), { order: i }));
    await batch.commit();
  };

  const insertPageAfter = async (index: number) => {
    if (!uid) return;
    const refPage = pages[index];
    const coll = collection(db, "documents", docId, "pages");
    const newRef = await addDoc(coll, {
      uid,
      order: pages.length,
      format: refPage.format,
      orientation: refPage.orientation,
      createdAt: serverTimestamp(),
      createdAtClient: Date.now(),
    } as PageDoc);

    const next = [...pages];
    next.splice(index + 1, 0, {
      id: newRef.id,
      order: index + 1,
      format: refPage.format,
      orientation: refPage.orientation,
      strokes: [],
    });
    await reindexPages(next.map((p, i) => ({ ...p, order: i })));
  };

  // Duplizieren übernimmt jetzt auch die Striche (vorher wurde nur eine leere Seite angelegt)
  const duplicatePageAfter = async (index: number) => {
    if (!uid) return;
    const refPage = pages[index];
    const coll = collection(db, "documents", docId, "pages");
    const newRef = await addDoc(coll, {
      uid,
      order: pages.length,
      format: refPage.format,
      orientation: refPage.orientation,
      strokes: refPage.strokes,
      createdAt: serverTimestamp(),
      createdAtClient: Date.now(),
    } as PageDoc);

    const next = [...pages];
    next.splice(index + 1, 0, {
      id: newRef.id,
      order: index + 1,
      format: refPage.format,
      orientation: refPage.orientation,
      strokes: refPage.strokes,
    });
    await reindexPages(next.map((p, i) => ({ ...p, order: i })));
  };

  const deletePageAt = async (index: number) => {
    if (pages.length <= 1) return;
    const coll = collection(db, "documents", docId, "pages");
    const target = pages[index];
    await deleteDoc(doc(coll, target.id));
    const next = pages.filter((_, i) => i !== index);
    await reindexPages(next.map((p, i) => ({ ...p, order: i })));
  };

  // Striche behalten ihre absolute Pixelgrösse/Position, wenn sich nur das Blatt ändert
  // (kein Skalieren, kein Rotieren). Würde dadurch etwas ausserhalb liegen, vorher nachfragen.
  const strokesOverflow = (strokes: Stroke[], w: number, h: number) =>
    strokes.some((s) => s.points.some((p) => p.x > w || p.y > h));

  const changePageFormat = async (index: number, format: Format) => {
    const coll = collection(db, "documents", docId, "pages");
    const target = pages[index];
    if (target.format === format) return;
    const { w, h } = sizeFor(format, target.orientation);
    if (strokesOverflow(target.strokes, w, h)) {
      if (!confirm("Das neue Format ist kleiner als die Zeichnung. Teile davon liegen dann ausserhalb des Blatts. Trotzdem ändern?")) return;
    }
    await updateDoc(doc(coll, target.id), { format });
  };

  const changePageOrientation = async (index: number, orientation: Orientation) => {
    const coll = collection(db, "documents", docId, "pages");
    const target = pages[index];
    if (target.orientation === orientation) return;
    const { w, h } = sizeFor(target.format, orientation);
    if (strokesOverflow(target.strokes, w, h)) {
      if (!confirm("Die neue Ausrichtung ist kleiner als die Zeichnung. Teile davon liegen dann ausserhalb des Blatts. Trotzdem ändern?")) return;
    }
    await updateDoc(doc(coll, target.id), { orientation });
  };

  const saveStrokes = async (index: number, strokes: Stroke[]) => {
    const coll = collection(db, "documents", docId, "pages");
    const target = pages[index];
    if (!target) return;
    await updateDoc(doc(coll, target.id), { strokes });
  };

  const pushHistory = (pageId: string, action: HistoryAction) => {
    undoStacksRef.current[pageId] = [...(undoStacksRef.current[pageId] ?? []), action];
    redoStacksRef.current[pageId] = [];
  };

  const commitStroke = (index: number, stroke: Stroke) => {
    lastPageIndexRef.current = index;
    const target = pages[index];
    if (!target) return;
    pushHistory(target.id, { kind: "add", stroke });
    saveStrokes(index, [...target.strokes, stroke]);
  };

  const commitErase = (index: number, removed: { stroke: Stroke; index: number }[]) => {
    if (removed.length === 0) return;
    lastPageIndexRef.current = index;
    const target = pages[index];
    if (!target) return;
    pushHistory(target.id, { kind: "erase", removed });
    const removeIdx = new Set(removed.map((r) => r.index));
    saveStrokes(index, target.strokes.filter((_, i) => !removeIdx.has(i)));
  };

  const handleUndo = () => {
    const idx = lastPageIndexRef.current;
    if (idx === null) return;
    const target = pages[idx];
    if (!target) return;
    const stack = undoStacksRef.current[target.id] ?? [];
    if (stack.length === 0) return;
    const action = stack[stack.length - 1];
    undoStacksRef.current[target.id] = stack.slice(0, -1);
    redoStacksRef.current[target.id] = [...(redoStacksRef.current[target.id] ?? []), action];

    if (action.kind === "add") {
      saveStrokes(idx, target.strokes.slice(0, -1));
    } else {
      const next = [...target.strokes];
      [...action.removed]
        .sort((a, b) => a.index - b.index)
        .forEach(({ stroke, index }) => next.splice(Math.min(index, next.length), 0, stroke));
      saveStrokes(idx, next);
    }
  };

  const handleRedo = () => {
    const idx = lastPageIndexRef.current;
    if (idx === null) return;
    const target = pages[idx];
    if (!target) return;
    const stack = redoStacksRef.current[target.id] ?? [];
    if (stack.length === 0) return;
    const action = stack[stack.length - 1];
    redoStacksRef.current[target.id] = stack.slice(0, -1);
    undoStacksRef.current[target.id] = [...(undoStacksRef.current[target.id] ?? []), action];

    if (action.kind === "add") {
      saveStrokes(idx, [...target.strokes, action.stroke]);
    } else {
      const removeIdx = new Set(action.removed.map((r) => r.index));
      saveStrokes(idx, target.strokes.filter((_, i) => !removeIdx.has(i)));
    }
  };

  /* =========================
     Welt-Layout & Kamera
     ========================= */

  // Blätter untereinander, horizontal um die Weltachse x=0 zentriert
  const layout = useMemo(() => {
    let y = 0;
    return pages.map((page) => {
      const { w, h } = sizeFor(page.format, page.orientation);
      const entry = { page, x: -w / 2, y, w, h };
      y += h + PAGE_GAP;
      return entry;
    });
  }, [pages]);

  const [cam, setCam] = useState<Camera>({ x: 0, y: 0, k: 1 });
  const viewportRef = useRef<HTMLDivElement | null>(null);

  // Refs, damit die Zeiger-Handler immer den aktuellen Stand sehen (keine veralteten Closures)
  const camRef = useRef(cam);
  camRef.current = cam;
  const layoutRef = useRef(layout);
  layoutRef.current = layout;

  // Canvas-Auflösung folgt dem Zoom verzögert: während des Pinchens skaliert die Kamera
  // optisch (flüssig), kurz danach wird in passender Auflösung neu gerastert (scharf).
  const [renderScale, setRenderScale] = useState(1);
  useEffect(() => {
    const t = setTimeout(() => setRenderScale(cam.k), 140);
    return () => clearTimeout(t);
  }, [cam.k]);

  // Startansicht: erstes Blatt einpassen und mittig zeigen
  const didInitCamRef = useRef(false);
  useEffect(() => {
    if (didInitCamRef.current || layout.length === 0) return;
    const el = viewportRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return;
    const k = clampK(Math.min(1, (r.width - 64) / layout[0].w));
    setCam({ k, x: r.width / 2, y: 32 });
    didInitCamRef.current = true;
  }, [layout]);

  const screenToWorld = useCallback((clientX: number, clientY: number) => {
    const el = viewportRef.current;
    const c = camRef.current;
    if (!el) return { x: 0, y: 0 };
    const r = el.getBoundingClientRect();
    return { x: (clientX - r.left - c.x) / c.k, y: (clientY - r.top - c.y) / c.k };
  }, []);

  // Zoom um einen festen Bildschirmpunkt: der Weltpunkt darunter bleibt unter dem Punkt
  const zoomAround = useCallback((screenX: number, screenY: number, factor: number) => {
    setCam((c) => {
      const k = clampK(c.k * factor);
      const rf = k / c.k;
      return { k, x: screenX - (screenX - c.x) * rf, y: screenY - (screenY - c.y) * rf };
    });
  }, []);

  const zoomFromButton = (factor: number) => {
    const el = viewportRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    zoomAround(r.width / 2, r.height / 2, factor);
  };

  const resetView = () => {
    const el = viewportRef.current;
    if (!el || layout.length === 0) return;
    const r = el.getBoundingClientRect();
    const k = clampK(Math.min(1, (r.width - 64) / layout[0].w));
    setCam({ k, x: r.width / 2, y: 32 });
  };

  // Mausrad: normal = verschieben, mit Strg/Cmd = zoomen. Muss non-passiv registriert werden.
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) {
        zoomAround(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * 0.0025));
      } else {
        setCam((c) => ({ ...c, x: c.x - e.deltaX, y: c.y - e.deltaY }));
      }
    };
    // Safari-eigene Seiten-Zoom-Gesten unterdrücken, sonst zoomt iOS die ganze Seite
    const prevent = (e: Event) => e.preventDefault();
    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("gesturestart", prevent);
    el.addEventListener("gesturechange", prevent);
    el.addEventListener("gestureend", prevent);
    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("gesturestart", prevent);
      el.removeEventListener("gesturechange", prevent);
      el.removeEventListener("gestureend", prevent);
    };
  }, [zoomAround]);

  /* =========================
     Canvas-Registry (für Live-Zeichnen)
     ========================= */

  const canvasesRef = useRef<Map<string, HTMLCanvasElement>>(new Map());
  const registerCanvas = useCallback((id: string, el: HTMLCanvasElement | null) => {
    if (el) canvasesRef.current.set(id, el);
    else canvasesRef.current.delete(id);
  }, []);

  const ctxFor = (pageIdx: number) => {
    const entry = layoutRef.current[pageIdx];
    if (!entry) return null;
    return canvasesRef.current.get(entry.page.id)?.getContext("2d") ?? null;
  };

  /* =========================
     Zeichnen & Radieren (Stift/Maus)
     ========================= */

  const drawRef = useRef<
    | { pageIdx: number; style: { color: string; width: number; tool: Tool }; points: StrokePoint[]; last: StrokePoint }
    | null
  >(null);
  const eraseRef = useRef<
    | { pageIdx: number; working: { stroke: Stroke; index: number }[]; hits: { stroke: Stroke; index: number }[] }
    | null
  >(null);
  const [hoverWorld, setHoverWorld] = useState<StrokePoint | null>(null);

  const isLineEraser = tool === "eraser" && eraserMode === "linie";

  const hitPage = (wx: number, wy: number) => {
    const L = layoutRef.current;
    for (let i = 0; i < L.length; i++) {
      if (wx >= L[i].x && wx <= L[i].x + L[i].w && wy >= L[i].y && wy <= L[i].y + L[i].h) return i;
    }
    return -1;
  };

  const toLocal = (pageIdx: number, world: StrokePoint) => {
    const entry = layoutRef.current[pageIdx];
    return { x: world.x - entry.x, y: world.y - entry.y };
  };

  const applyLineErase = (local: StrokePoint) => {
    const st = eraseRef.current;
    if (!st) return;
    const hits = st.working.filter(({ stroke }) => strokeHit(stroke, local, activeSize / 2));
    if (hits.length === 0) return;
    const hitSet = new Set(hits);
    st.working = st.working.filter((entry) => !hitSet.has(entry));
    st.hits = [...st.hits, ...hits];
    const entry = layoutRef.current[st.pageIdx];
    const ctx = ctxFor(st.pageIdx);
    if (ctx) paintPage(ctx, entry.w, entry.h, st.working.map((e) => e.stroke));
  };

  const startDraw = (clientX: number, clientY: number) => {
    const world = screenToWorld(clientX, clientY);
    const pageIdx = hitPage(world.x, world.y);
    if (pageIdx < 0) return;
    const local = toLocal(pageIdx, world);

    if (isLineEraser) {
      eraseRef.current = {
        pageIdx,
        working: layoutRef.current[pageIdx].page.strokes.map((stroke, index) => ({ stroke, index })),
        hits: [],
      };
      applyLineErase(local);
      return;
    }
    const style = { color: activeColor, width: activeSize, tool };
    drawRef.current = { pageIdx, style, points: [local], last: local };
    // Aufsetzpunkt sofort zeichnen, sonst fehlt bei einem kurzen Tipp (i-Punkt,
    // Satzzeichen) jede Rückmeldung bis zum Loslassen
    const ctx = ctxFor(pageIdx);
    if (ctx) drawStrokeOn(ctx, { points: [local], ...style });
  };

  const extendDraw = (clientX: number, clientY: number) => {
    const st = drawRef.current;
    const er = eraseRef.current;
    if (!st && !er) return;
    const world = screenToWorld(clientX, clientY);

    if (er) {
      applyLineErase(toLocal(er.pageIdx, world));
      return;
    }
    if (!st) return;

    const local = toLocal(st.pageIdx, world);
    const ctx = ctxFor(st.pageIdx);
    if (ctx) {
      ctx.globalCompositeOperation = st.style.tool === "eraser" ? "destination-out" : "source-over";
      ctx.strokeStyle = st.style.color;
      ctx.lineWidth = st.style.width;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      ctx.moveTo(st.last.x, st.last.y);
      ctx.lineTo(local.x, local.y);
      ctx.stroke();
      ctx.globalCompositeOperation = "source-over";
    }
    st.points.push(local);
    st.last = local;
  };

  const endDraw = () => {
    const er = eraseRef.current;
    if (er) {
      commitErase(er.pageIdx, er.hits);
      eraseRef.current = null;
      return;
    }
    const st = drawRef.current;
    drawRef.current = null;
    if (st && st.points.length >= 1) {
      commitStroke(st.pageIdx, { points: st.points, ...st.style });
    }
  };

  /* =========================
     Zeigereingaben am Viewport
     ========================= */

  // Touch = Navigation. Zwei getrennte Kanäle, damit Finger und Stift sich nie in die Quere kommen.
  const touchesRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const gestureRef = useRef<
    | { type: "pan"; lastX: number; lastY: number }
    | { type: "pinch"; lastDist: number; lastMidX: number; lastMidY: number }
    | null
  >(null);

  const syncGesture = () => {
    const pts = [...touchesRef.current.values()];
    if (pts.length === 1) {
      gestureRef.current = { type: "pan", lastX: pts[0].x, lastY: pts[0].y };
    } else if (pts.length >= 2) {
      gestureRef.current = {
        type: "pinch",
        lastDist: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y),
        lastMidX: (pts[0].x + pts[1].x) / 2,
        lastMidY: (pts[0].y + pts[1].y) / 2,
      };
    } else {
      gestureRef.current = null;
    }
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    if (e.pointerType === "touch") {
      touchesRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      syncGesture();
      return;
    }
    startDraw(e.clientX, e.clientY);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === "touch") {
      if (!touchesRef.current.has(e.pointerId)) return;
      touchesRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const g = gestureRef.current;
      const pts = [...touchesRef.current.values()];
      const el = viewportRef.current;
      if (!g || !el) return;

      if (g.type === "pan" && pts.length === 1) {
        const dx = pts[0].x - g.lastX;
        const dy = pts[0].y - g.lastY;
        g.lastX = pts[0].x;
        g.lastY = pts[0].y;
        setCam((c) => ({ ...c, x: c.x + dx, y: c.y + dy }));
      } else if (g.type === "pinch" && pts.length >= 2) {
        const r = el.getBoundingClientRect();
        const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
        const midX = (pts[0].x + pts[1].x) / 2;
        const midY = (pts[0].y + pts[1].y) / 2;
        const prevX = g.lastMidX - r.left;
        const prevY = g.lastMidY - r.top;
        const nowX = midX - r.left;
        const nowY = midY - r.top;
        const factor = g.lastDist > 0 ? dist / g.lastDist : 1;
        g.lastDist = dist;
        g.lastMidX = midX;
        g.lastMidY = midY;
        // Skalieren um den Fingermittelpunkt UND dessen Verschiebung mitnehmen,
        // damit zwei Finger gleichzeitig zoomen und schieben können
        setCam((c) => {
          const k = clampK(c.k * factor);
          const rf = k / c.k;
          return { k, x: nowX - (prevX - c.x) * rf, y: nowY - (prevY - c.y) * rf };
        });
      }
      return;
    }

    // Stift/Maus: Vorschaukreis des Radierers mitführen
    if (tool === "eraser") setHoverWorld(screenToWorld(e.clientX, e.clientY));
    else if (hoverWorld) setHoverWorld(null);

    if (!drawRef.current && !eraseRef.current) return;
    // Zwischenpunkte auswerten: Apple Pencil liefert deutlich mehr Punkte als Frames,
    // ohne das werden schnelle Striche eckig
    const native = e.nativeEvent;
    const coalesced =
      typeof native.getCoalescedEvents === "function" ? native.getCoalescedEvents() : [];
    if (coalesced.length > 0) coalesced.forEach((ev) => extendDraw(ev.clientX, ev.clientY));
    else extendDraw(e.clientX, e.clientY);
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === "touch") {
      touchesRef.current.delete(e.pointerId);
      syncGesture();
      return;
    }
    endDraw();
  };

  const onPointerLeave = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== "touch") setHoverWorld(null);
    onPointerUp(e);
  };

  /* =========================
     Icons
     ========================= */

  const PenIcon = () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M3 21l3.75-.75L19 8.99a1.5 1.5 0 0 0 0-2.12l-1.86-1.86a1.5 1.5 0 0 0-2.12 0L2.75 16.27 2 20.99 3 21z" stroke="black" strokeWidth="1.6" fill="none"/>
      <path d="M14.5 5.5l4 4" stroke="black" strokeWidth="1.6" />
    </svg>
  );
  const MarkerIcon = () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M5 19l3-3h6l3 3" stroke="black" strokeWidth="1.6" />
      <path d="M8.5 16L16 8.5a2 2 0 0 0 0-2.83L15.33 5a2 2 0 0 0-2.83 0L5 12.5" stroke="black" strokeWidth="1.6" />
    </svg>
  );
  const EraserIcon = () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M3 16l7-7 6 6-4 4H7z" stroke="black" strokeWidth="1.6" fill="none"/>
      <path d="M12 9l3-3" stroke="black" strokeWidth="1.6" />
    </svg>
  );
  const UndoIcon = () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M7 7l-4 4 4 4" stroke="black" strokeWidth="1.6" />
      <path d="M20 17a7 7 0 0 0-7-7H3" stroke="black" strokeWidth="1.6" />
    </svg>
  );
  const RedoIcon = () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M17 7l4 4-4 4" stroke="black" strokeWidth="1.6" />
      <path d="M4 17a7 7 0 0 1 7-7h10" stroke="black" strokeWidth="1.6" />
    </svg>
  );
  const HomeIcon = () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M3 10l9-7 9 7" stroke="black" strokeWidth="1.6" />
      <path d="M5 10v10h14V10" stroke="black" strokeWidth="1.6" />
    </svg>
  );

  return (
    <div className="h-screen bg-black flex flex-col overflow-hidden">
      {/* Header */}
      <header className="shrink-0 z-40 bg-neutral-900/70 backdrop-blur-md">
        <div className="px-4 py-3 overflow-x-auto">
          <div className="flex items-center gap-3 min-w-max">
            <Link href="/" title="Home" className="flex items-center gap-2 group shrink-0">
              <Image
                src="/logo.png"
                alt="OneStepBehind Logo"
                width={36}
                height={36}
                className="rounded-md transition-transform group-hover:scale-105"
              />
            </Link>

            <div className="mx-3 h-6 w-px bg-white/10" />

            {/* Undo/Redo – bezieht sich auf die zuletzt bearbeitete Seite */}
            <ToolBtn title="Rückgängig" onClick={handleUndo}>
              <UndoIcon />
            </ToolBtn>
            <ToolBtn title="Wiederholen" onClick={handleRedo}>
              <RedoIcon />
            </ToolBtn>

            <div className="mx-3 h-6 w-px bg-white/10" />

            {/* Werkzeuge */}
            <ToolBtn title="Stift" active={tool === "pen"} onClick={() => setTool("pen")}>
              <PenIcon />
            </ToolBtn>
            <ToolBtn title="Marker" active={tool === "marker"} onClick={() => setTool("marker")}>
              <MarkerIcon />
            </ToolBtn>
            <ToolBtn title="Radierer" active={tool === "eraser"} onClick={() => setTool("eraser")}>
              <EraserIcon />
            </ToolBtn>

            <div className="mx-3 h-6 w-px bg-white/10" />

            {/* Presets (sichtbar je nach Werkzeug) */}
            <div className="relative flex items-center gap-2">
              {tool === "pen" && (
                <>
                  <ColorRow
                    type="pen"
                    colors={penColors}
                    selectedIdx={penIdx}
                    onPick={(i) => { setPenIdx(i); setEditColorIdx(null); }}
                    editColorIdx={editColorIdx}
                    setEditColorIdx={setEditColorIdx}
                    setPenColors={setPenColors}
                    setMarkerColors={setMarkerColors}
                  />
                  <Divider dark />
                  <SizeRow
                    type="pen"
                    sizes={penSizes}
                    selectedIdx={sizeIdxPen}
                    onPick={(i) => { setSizeIdxPen(i); setEditSizeIdx(null); }}
                    editSizeIdx={editSizeIdx}
                    setEditSizeIdx={setEditSizeIdx}
                    setSizes={setPenSizes}
                  />
                </>
              )}
              {tool === "marker" && (
                <>
                  <ColorRow
                    type="marker"
                    colors={markerColors}
                    selectedIdx={markerIdx}
                    onPick={(i) => { setMarkerIdx(i); setEditColorIdx(null); }}
                    editColorIdx={editColorIdx}
                    setEditColorIdx={setEditColorIdx}
                    setPenColors={setPenColors}
                    setMarkerColors={setMarkerColors}
                  />
                  <Divider dark />
                  <SizeRow
                    type="marker"
                    sizes={markerSizes}
                    selectedIdx={sizeIdxMarker}
                    onPick={(i) => { setSizeIdxMarker(i); setEditSizeIdx(null); }}
                    editSizeIdx={editSizeIdx}
                    setEditSizeIdx={setEditSizeIdx}
                    setSizes={setMarkerSizes}
                  />
                </>
              )}
              {tool === "eraser" && (
                <>
                  <div className="flex gap-1.5">
                    <button
                      onClick={() => setEraserMode("pixel")}
                      className={`px-3 py-1.5 rounded-lg text-xs border transition ${eraserMode === "pixel" ? "bg-white text-black border-white" : "border-white/25 text-white/80 hover:bg-white/10"}`}
                    >
                      Pixel
                    </button>
                    <button
                      onClick={() => setEraserMode("linie")}
                      className={`px-3 py-1.5 rounded-lg text-xs border transition ${eraserMode === "linie" ? "bg-white text-black border-white" : "border-white/25 text-white/80 hover:bg-white/10"}`}
                    >
                      Linie
                    </button>
                  </div>
                  <Divider dark />
                  <SizeRow
                    type="eraser"
                    sizes={eraserSizes}
                    selectedIdx={sizeIdxEraser}
                    onPick={(i) => { setSizeIdxEraser(i); setEditSizeIdx(null); }}
                    editSizeIdx={editSizeIdx}
                    setEditSizeIdx={setEditSizeIdx}
                    setSizes={setEraserSizes}
                  />
                </>
              )}
            </div>

            <div className="hidden md:flex items-center gap-2 ml-2 text-xs text-gray-200 shrink-0">
              {tool !== "eraser" && (
                <>
                  <span className="inline-flex items-center gap-1">
                    <span>Farbe</span>
                    <span className="inline-block h-4 w-4 rounded-full border border-white/20" style={{ background: activeColor }} />
                  </span>
                  <span>•</span>
                </>
              )}
              <span>{tool === "eraser" ? "Radius" : "Strich"}: {activeSize}px</span>
            </div>

            <div className="flex-1" />

            {/* Zoom */}
            <div className="flex items-center gap-2 shrink-0">
              <button
                className="rounded-lg border border-white/25 px-2 py-1 text-xs
                           bg-gradient-to-br from-white/10 via-white/5 to-white/0
                           text-white hover:bg-white/10 shadow-sm"
                onClick={() => zoomFromButton(1 / 1.25)}
                title="Zoom -"
              >
                −
              </button>
              <button
                className="min-w-[56px] text-center text-xs text-white/90 hover:text-white select-none"
                onClick={resetView}
                title="Ansicht zurücksetzen"
              >
                {Math.round(cam.k * 100)}%
              </button>
              <button
                className="rounded-lg border border-white/25 px-2 py-1 text-xs
                           bg-gradient-to-br from-white/10 via-white/5 to-white/0
                           text-white hover:bg-white/10 shadow-sm"
                onClick={() => zoomFromButton(1.25)}
                title="Zoom +"
              >
                +
              </button>
            </div>

            <Link
              href="/dokumente"
              title="Dokumente"
              className="ml-2 shrink-0 rounded-xl border border-white/25 px-3 py-2 text-sm
                         bg-gradient-to-br from-white/10 via-white/5 to-white/0
                         text-white hover:bg-white/10 shadow-sm"
            >
              <HomeIcon />
            </Link>
          </div>
        </div>
        <div className="h-px w-full bg-white/10" />
      </header>

      {/* Viewport: fängt alle Zeigereingaben ab. touch-action:none verhindert native
          Browser-Gesten, die Callout-/Select-Eigenschaften das iOS-Auswahlmenü. */}
      <div
        ref={viewportRef}
        className="relative flex-1 min-h-0 overflow-hidden"
        style={{
          touchAction: "none",
          WebkitTouchCallout: "none",
          WebkitUserSelect: "none",
          userSelect: "none",
          cursor: tool === "eraser" ? "none" : "crosshair",
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={onPointerLeave}
        onContextMenu={(e) => e.preventDefault()}
      >
        {!authReady || !prefsReady ? (
          <div className="text-gray-400 p-6">Initialisiere…</div>
        ) : !uid ? (
          <div className="text-gray-400 p-6">Bitte einloggen, um das Dokument zu öffnen.</div>
        ) : !pagesReady ? (
          <div className="text-gray-400 p-6">Seiten werden vorbereitet…</div>
        ) : pages.length === 0 ? (
          <NoPagesFallback uid={uid} docId={docId} debugMsg={debugMsg} />
        ) : (
          <div
            className="absolute top-0 left-0 origin-top-left"
            style={{ transform: `translate(${cam.x}px, ${cam.y}px) scale(${cam.k})` }}
          >
            {layout.map((entry, idx) => (
              <PageView
                key={entry.page.id}
                index={idx}
                page={entry.page}
                x={entry.x}
                y={entry.y}
                w={entry.w}
                h={entry.h}
                camK={cam.k}
                renderScale={renderScale}
                registerCanvas={registerCanvas}
                onAddBelow={() => insertPageAfter(idx)}
                onDuplicateBelow={() => duplicatePageAfter(idx)}
                onDelete={() => deletePageAt(idx)}
                onChangeFormat={(fmt) => changePageFormat(idx, fmt)}
                onChangeOrientation={(ori) => changePageOrientation(idx, ori)}
              />
            ))}

            {tool === "eraser" && hoverWorld && (
              <div
                className="absolute rounded-full border-2 border-black/70 bg-white/20 pointer-events-none"
                style={{
                  left: hoverWorld.x - activeSize / 2,
                  top: hoverWorld.y - activeSize / 2,
                  width: activeSize,
                  height: activeSize,
                }}
              />
            )}
          </div>
        )}

        {/* Bedienhinweis */}
        <div className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 text-[11px] text-white/35">
          Ein Finger schiebt · Zwei Finger zoomen · Stift zeichnet
        </div>
      </div>
    </div>
  );
}

/* =========================
   Seiten-Ansicht
   ========================= */

function PageView({
  index,
  page,
  x,
  y,
  w,
  h,
  camK,
  renderScale,
  registerCanvas,
  onAddBelow,
  onDuplicateBelow,
  onDelete,
  onChangeFormat,
  onChangeOrientation,
}: {
  index: number;
  page: PageRef;
  x: number;
  y: number;
  w: number;
  h: number;
  camK: number;
  renderScale: number;
  registerCanvas: (id: string, el: HTMLCanvasElement | null) => void;
  onAddBelow: () => void;
  onDuplicateBelow: () => void;
  onDelete: () => void;
  onChangeFormat: (fmt: Format) => void;
  onChangeOrientation: (ori: Orientation) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [formatOpen, setFormatOpen] = useState(false);
  const [info, setInfo] = useState<string | null>(null);

  const copyPageToClipboard = async () => {
    try {
      const cvs = canvasRef.current;
      if (!cvs) return;
      const blob: Blob = await new Promise((res, rej) =>
        cvs.toBlob((b) => (b ? res(b) : rej(new Error("toBlob failed"))), "image/png")
      );
      if (navigator.clipboard && "ClipboardItem" in window) {
        await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
        setInfo("Seite als PNG kopiert.");
      } else {
        window.open(URL.createObjectURL(blob), "_blank");
        setInfo("PNG in neuem Tab geöffnet.");
      }
    } catch {
      setInfo("Kopieren nicht möglich.");
    } finally {
      setTimeout(() => setInfo(null), 2200);
    }
  };

  useEffect(() => {
    registerCanvas(page.id, canvasRef.current);
    return () => registerCanvas(page.id, null);
  }, [page.id, registerCanvas]);

  // Auflösung an Zoom/Displaydichte anpassen und Striche neu aufbauen
  useEffect(() => {
    const cvs = canvasRef.current;
    if (!cvs) return;
    const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
    const f = resFactorFor(w, h, renderScale, dpr);
    cvs.width = Math.round(w * f);
    cvs.height = Math.round(h * f);
    const ctx = cvs.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(f, 0, 0, f, 0, 0);
    paintPage(ctx, w, h, page.strokes);
  }, [page.strokes, w, h, renderScale]);

  // Bedienelemente gegenskalieren, damit sie bei jedem Zoom gleich gross bleiben
  const uiScale = 1 / camK;

  return (
    <div className="absolute" style={{ left: x, top: y, width: w, height: h }}>
      <canvas
        ref={canvasRef}
        draggable={false}
        className="absolute inset-0 bg-white rounded-xl ring-1 ring-black/20 shadow-2xl pointer-events-none select-none"
        style={{ width: w, height: h, WebkitTouchCallout: "none", WebkitUserSelect: "none" }}
      />

      {/* Seitenzahl */}
      <div
        className="absolute pointer-events-none text-gray-400"
        style={{
          left: 0,
          top: 0,
          transform: `scale(${uiScale}) translate(-100%, 0)`,
          transformOrigin: "top left",
          paddingRight: 12,
          fontSize: 12,
          whiteSpace: "nowrap",
        }}
      >
        Seite {index + 1}
      </div>

      {/* Seitenmenü: eigener Zeiger-Kanal, damit ein Tipp darauf nicht die Kamera bewegt */}
      <div
        className="absolute"
        style={{ right: 8, bottom: 8, transform: `scale(${uiScale})`, transformOrigin: "bottom right" }}
        onPointerDown={(e) => e.stopPropagation()}
        onPointerMove={(e) => e.stopPropagation()}
        onPointerUp={(e) => e.stopPropagation()}
      >
        <div className="relative">
          <button
            aria-label="Seitenmenü"
            onClick={() => { setMenuOpen((v) => !v); setFormatOpen(false); }}
            className="h-10 w-10 rounded-full
                       bg-gradient-to-br from-gray-200/70 via-gray-100/50 to-gray-50/30
                       border border-black/40 backdrop-blur-md
                       hover:bg-gray-200/80 active:bg-gray-300/80 transition"
          />

          {menuOpen && (
            <div
              className="absolute right-0 bottom-12 min-w-[240px] rounded-2xl overflow-hidden
                         border border-black/30 shadow-xl
                         bg-gradient-to-br from-gray-100/95 via-gray-200/90 to-gray-100/85
                         backdrop-blur-md text-gray-900 text-sm"
              role="menu"
            >
              <div className="px-3 py-2 font-medium flex items-center justify-between">
                <span>Seite {index + 1}</span>
                <span className="text-[11px] text-gray-600">
                  {page.format} • {page.orientation === "portrait" ? "Hoch" : "Quer"}
                </span>
              </div>
              <div className="h-px bg-black/10" />

              <button onClick={() => setFormatOpen((v) => !v)} className="w-full text-left px-3 py-2 hover:bg-gray-100/70">
                Seitengrösse ändern
              </button>

              {formatOpen && (
                <div className="px-3 pb-2 pt-1">
                  <div className="text-xs text-gray-600 mb-1">Format</div>
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {(["A4", "A3", "A2", "A1"] as Format[]).map((fmt) => (
                      <button
                        key={fmt}
                        onClick={() => onChangeFormat(fmt)}
                        className={
                          "px-2 py-1 rounded-lg border text-sm " +
                          (page.format === fmt ? "border-black/50 bg-white" : "border-black/20 bg-white/70 hover:bg-white")
                        }
                      >
                        {fmt}
                      </button>
                    ))}
                  </div>

                  <div className="text-xs text-gray-600 mb-1">Ausrichtung</div>
                  <div className="flex gap-1.5">
                    {(["portrait", "landscape"] as Orientation[]).map((ori) => (
                      <button
                        key={ori}
                        onClick={() => onChangeOrientation(ori)}
                        className={
                          "px-2 py-1 rounded-lg border text-sm " +
                          (page.orientation === ori ? "border-black/50 bg-white" : "border-black/20 bg-white/70 hover:bg-white")
                        }
                      >
                        {ori === "portrait" ? "Hoch" : "Quer"}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <button
                onClick={() => { onAddBelow(); setMenuOpen(false); }}
                className="w-full text-left px-3 py-2 hover:bg-gray-100/70"
              >
                + Seite hinzufügen
              </button>

              <button
                onClick={() => { onDuplicateBelow(); setMenuOpen(false); }}
                className="w-full text-left px-3 py-2 hover:bg-gray-100/70"
              >
                Seite duplizieren
              </button>

              <button
                onClick={async () => { await copyPageToClipboard(); setMenuOpen(false); }}
                className="w-full text-left px-3 py-2 hover:bg-gray-100/70"
              >
                Seite kopieren
              </button>

              <div className="h-px bg-black/10" />
              <button
                onClick={() => { onDelete(); setMenuOpen(false); }}
                className="w-full text-left px-3 py-2 text-red-600 hover:bg-gray-100/70"
              >
                Seite löschen
              </button>
            </div>
          )}

          {info && (
            <div className="absolute right-0 bottom-12 whitespace-nowrap px-3 py-1.5 rounded-lg bg-black/75 text-white text-xs shadow">
              {info}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* =========================
   UI-Atome
   ========================= */

function ToolBtn({
  active,
  title,
  onClick,
  children,
}: {
  active?: boolean;
  title: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={
        "shrink-0 rounded-xl border px-3 py-2 text-sm transition shadow-sm backdrop-blur-md " +
        (active
          ? "border-white/60 text-white bg-gradient-to-br from-white/25 via-white/15 to-white/10"
          : "border-white/25 text-white bg-gradient-to-br from-white/10 via-white/5 to-white/0 hover:bg-white/10")
      }
    >
      {children}
    </button>
  );
}

function Divider({ dark }: { dark?: boolean }) {
  return <div className={`mx-2 h-6 w-px ${dark ? "bg-white/12" : "bg-black/10"}`} />;
}

function ColorRow({
  type,
  colors,
  selectedIdx,
  onPick,
  editColorIdx,
  setEditColorIdx,
  setPenColors,
  setMarkerColors,
}: {
  type: "pen" | "marker";
  colors: string[];
  selectedIdx: number;
  onPick: (i: number) => void;
  editColorIdx: { type: "pen" | "marker"; idx: number } | null;
  setEditColorIdx: (v: { type: "pen" | "marker"; idx: number } | null) => void;
  setPenColors: React.Dispatch<React.SetStateAction<string[]>>;
  setMarkerColors: React.Dispatch<React.SetStateAction<string[]>>;
}) {
  return (
    <div className="relative flex items-center gap-1.5">
      {colors.map((c, i) => (
        <InlineColor
          key={`${type}-${i}`}
          type={type}
          idx={i}
          value={c}
          selected={selectedIdx === i}
          onPick={() => onPick(i)}
          editColorIdx={editColorIdx}
          setEditColorIdx={setEditColorIdx}
          setPenColors={setPenColors}
          setMarkerColors={setMarkerColors}
        />
      ))}
    </div>
  );
}

function SizeRow({
  type,
  sizes,
  selectedIdx,
  onPick,
  editSizeIdx,
  setEditSizeIdx,
  setSizes,
}: {
  type: "pen" | "marker" | "eraser";
  sizes: number[];
  selectedIdx: number;
  onPick: (i: number) => void;
  editSizeIdx: { type: "pen" | "marker" | "eraser"; idx: number } | null;
  setEditSizeIdx: (v: { type: "pen" | "marker" | "eraser"; idx: number } | null) => void;
  setSizes: React.Dispatch<React.SetStateAction<number[]>>;
}) {
  return (
    <div className="relative flex items-center gap-1.5">
      {sizes.map((s, i) => (
        <InlineSize
          key={`${type}-size-${i}`}
          type={type}
          idx={i}
          value={s}
          selected={selectedIdx === i}
          onPick={() => onPick(i)}
          editSizeIdx={editSizeIdx}
          setEditSizeIdx={setEditSizeIdx}
          setSizes={setSizes}
        />
      ))}
    </div>
  );
}

function InlineColor({
  type, idx, value, selected,
  onPick, editColorIdx, setEditColorIdx,
  setPenColors, setMarkerColors,
}: {
  type: "pen" | "marker";
  idx: number;
  value: string;
  selected?: boolean;
  onPick: () => void;
  editColorIdx: { type: "pen" | "marker"; idx: number } | null;
  setEditColorIdx: (v: { type: "pen" | "marker"; idx: number } | null) => void;
  setPenColors: React.Dispatch<React.SetStateAction<string[]>>;
  setMarkerColors: React.Dispatch<React.SetStateAction<string[]>>;
}) {
  const base = stripAlpha(value);
  const display = type === "marker" ? ensureAlpha(base, 0.66) : base;

  return (
    <div className="relative">
      <button
        title={base}
        onClick={() => (selected ? setEditColorIdx({ type, idx }) : onPick())}
        className={
          "relative h-7 w-7 rounded-full border " +
          (selected ? "ring-2 ring-white/70 border-white/40" : "border-white/30")
        }
        style={{ background: display }}
      />
      {editColorIdx && editColorIdx.type === type && editColorIdx.idx === idx && (
        <div className="absolute mt-2 z-50 p-2 rounded-xl border border-white/20 shadow-lg bg-neutral-900 text-white">
          <input
            type="color"
            value={base}
            onChange={(e) => {
              if (type === "pen") {
                setPenColors((arr) => arr.map((v, j) => (j === idx ? stripAlpha(e.target.value) : v)));
              } else {
                setMarkerColors((arr) => arr.map((v, j) => (j === idx ? stripAlpha(e.target.value) : v)));
              }
            }}
            className="h-10 w-16 bg-neutral-800 border border-white/20 rounded"
          />
          <button
            onClick={() => setEditColorIdx(null)}
            className="ml-2 rounded-lg border border-white/25 px-2 py-1 text-xs
                       bg-white/10 text-white hover:bg-white/15"
          >
            OK
          </button>
        </div>
      )}
    </div>
  );
}

function InlineSize({
  type, idx, value, selected,
  onPick, editSizeIdx, setEditSizeIdx,
  setSizes,
}: {
  type: "pen" | "marker" | "eraser";
  idx: number;
  value: number;
  selected?: boolean;
  onPick: () => void;
  editSizeIdx: { type: "pen" | "marker" | "eraser"; idx: number } | null;
  setEditSizeIdx: (v: { type: "pen" | "marker" | "eraser"; idx: number } | null) => void;
  setSizes: React.Dispatch<React.SetStateAction<number[]>>;
}) {
  return (
    <div className="relative">
      <button
        title={`${value}px`}
        onClick={() => (selected ? setEditSizeIdx({ type, idx }) : onPick())}
        className={
          "h-7 w-7 rounded-full border flex items-center justify-center " +
          (selected ? "ring-2 ring-white/70 border-white/40" : "border-white/30")
        }
      >
        <span className="rounded-full" style={{ width: value, height: value, background: "#F3F4F6" }} />
      </button>

      {editSizeIdx && editSizeIdx.type === type && editSizeIdx.idx === idx && (
        <div className="absolute mt-2 z-50 p-2 rounded-xl border border-white/20 shadow-lg bg-neutral-900 text-white">
          <input
            type="number"
            min={1}
            max={64}
            value={value}
            onChange={(e) =>
              setSizes((arr) => arr.map((v, j) => (j === idx ? clamp(1, 64, +e.target.value || 1) : v)))
            }
            className="h-9 w-20 rounded border border-white/25 px-2 text-sm bg-neutral-800 text-white"
          />
          <button
            onClick={() => setEditSizeIdx(null)}
            className="ml-2 rounded-lg border border-white/25 px-2 py-1 text-xs
                       bg-white/10 text-white hover:bg-white/15"
          >
            OK
          </button>
        </div>
      )}
    </div>
  );
}

/* =========================
   Fallback „keine Seiten“
   ========================= */

function NoPagesFallback({ uid, docId, debugMsg }: { uid: string; docId: string; debugMsg?: string }) {
  return (
    <div className="max-w-3xl mx-auto p-6">
      <div className="rounded-xl border border-white/15 bg-white/5 text-white p-4">
        <div className="font-semibold mb-1">Keine Seiten gefunden</div>
        <div className="text-sm opacity-80 mb-3">
          uid: <code className="opacity-90">{uid}</code> • docId:{" "}
          <code className="opacity-90">{docId}</code>
          {debugMsg ? (
            <>
              <br />
              <span className="text-amber-300">Debug:</span> {debugMsg}
            </>
          ) : null}
        </div>
        <button
          onClick={async () => {
            const coll = collection(db, "documents", docId, "pages");
            try {
              const existing = await getDocs(coll);
              if (existing.empty) {
                const batch = writeBatch(db);
                [0, 1].forEach((order) => {
                  batch.set(doc(coll), {
                    uid,
                    order,
                    format: "A4",
                    orientation: "portrait",
                    createdAt: serverTimestamp(),
                    createdAtClient: Date.now(),
                  } as PageDoc);
                });
                await batch.commit();
              }
            } catch (e) {
              console.warn("[Editor] manual default pages failed:", e);
            }
          }}
          className="rounded-lg border border-white/30 px-3 py-2 text-sm bg-white/10 hover:bg-white/15"
        >
          Seiten jetzt anlegen
        </button>
      </div>
    </div>
  );
}

/* =========================
   Farb-Helfer
   ========================= */

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
