"use client";

/**
 * OneStepBehind – Dokument-Editor (UI + Seitenverwaltung + globale Editor-Prefs)
 * - Schwarzer Hintergrund, Header (Logo-only, Undo/Redo, Pen/Marker/Eraser), Zoom +/-
 * - A4/A3/A2/A1 (Portrait/Landscape), konstanter Abstand (y-4), runder glassy Button pro Seite
 * - Menü pro Seite: Größe/Ausrichtung, + Seite, Duplizieren, Kopieren, Löschen
 * - Editor-Presets (Farben/Strichdicken) werden nutzerweit in /editorPrefs/{uid} gespeichert
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
   Typen & Defaults (lokal)
   ========================= */

type Tool = "pen" | "marker" | "eraser";
type Format = "A4" | "A3" | "A2" | "A1";
type Orientation = "portrait" | "landscape";

// Punkte in absoluten Pixeln (Basis: Format/Ausrichtung bei 100% Zoom).
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
  createdAt?: any;
  createdAtClient?: number;
};

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

/* =========================
   Page
   ========================= */

export default function DocumentEditorPage() {
  const params = useParams() as { id?: string };
  const docId = params?.id ?? "";

  // Auth (UI-Hinweise)
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

  // Zoom
  const [zoomPct, setZoomPct] = useState(100);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const delta = -Math.sign(e.deltaY) * 10;
      setZoomPct((p) => clamp(25, 200, p + delta));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);
  const scale = zoomPct / 100;

  /* =========================
     Seiten (Firestore)
     ========================= */
  type PageRef = { id: string; order: number; format: Format; orientation: Orientation; strokes: Stroke[] };

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
            } catch (e) {
              // log only
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
    const p0 = doc(collRef);
    const p1 = doc(collRef);
    batch.set(p0, {
      uid: ownerUid,
      order: 0,
      format: "A4",
      orientation: "portrait",
      createdAt: serverTimestamp(),
      createdAtClient: Date.now(),
    } as PageDoc);
    batch.set(p1, {
      uid: ownerUid,
      order: 1,
      format: "A4",
      orientation: "portrait",
      createdAt: serverTimestamp(),
      createdAtClient: Date.now(),
    } as PageDoc);
    await batch.commit();
  }

  const reindexPages = async (current: PageRef[]) => {
    const coll = collection(db, "documents", docId, "pages");
    const batch = writeBatch(db);
    current.forEach((p, i) => batch.update(doc(coll, p.id), { order: i }));
    await batch.commit();
  };

  const addPageAfter = async (index: number) => {
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

  const duplicatePageAfter = async (index: number) => {
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

  const deletePageAt = async (index: number) => {
    if (pages.length <= 1) return;
    const coll = collection(db, "documents", docId, "pages");
    const target = pages[index];
    await deleteDoc(doc(coll, target.id));
    const next = pages.filter((_, i) => i !== index);
    await reindexPages(next.map((p, i) => ({ ...p, order: i })));
  };

  // Striche behalten ihre absolute Pixelgrösse/Position, wenn sich nur das Blatt ändert
  // (kein Skalieren, kein Rotieren). Würde dadurch etwas ausserhalb des neuen Blatts liegen,
  // wird vorher eine Bestätigung verlangt.
  const strokesOverflow = (strokes: Stroke[], w: number, h: number) =>
    strokes.some((s) => s.points.some((p) => p.x > w || p.y > h));

  const changePageFormat = async (index: number, format: Format) => {
    const coll = collection(db, "documents", docId, "pages");
    const target = pages[index];
    if (target.format === format) return;
    const { w, h } = sizeFor(format, target.orientation);
    if (strokesOverflow(target.strokes, w, h)) {
      const ok = confirm("Das neue Format ist kleiner als die Zeichnung. Teile davon liegen dann ausserhalb des Blatts. Trotzdem ändern?");
      if (!ok) return;
    }
    await updateDoc(doc(coll, target.id), { format });
  };

  const changePageOrientation = async (index: number, orientation: Orientation) => {
    const coll = collection(db, "documents", docId, "pages");
    const target = pages[index];
    if (target.orientation === orientation) return;
    const { w, h } = sizeFor(target.format, orientation);
    if (strokesOverflow(target.strokes, w, h)) {
      const ok = confirm("Die neue Ausrichtung ist kleiner als die Zeichnung. Teile davon liegen dann ausserhalb des Blatts. Trotzdem ändern?");
      if (!ok) return;
    }
    await updateDoc(doc(coll, target.id), { orientation });
  };

  const saveStrokes = async (index: number, strokes: Stroke[]) => {
    const coll = collection(db, "documents", docId, "pages");
    const target = pages[index];
    await updateDoc(doc(coll, target.id), { strokes });
  };

  const pushHistory = (pageId: string, action: HistoryAction) => {
    undoStacksRef.current[pageId] = [...(undoStacksRef.current[pageId] ?? []), action];
    redoStacksRef.current[pageId] = [];
  };

  const handleAddStroke = (index: number, stroke: Stroke) => {
    lastPageIndexRef.current = index;
    const target = pages[index];
    pushHistory(target.id, { kind: "add", stroke });
    saveStrokes(index, [...target.strokes, stroke]);
  };

  const handleEraseStrokes = (index: number, removed: { stroke: Stroke; index: number }[]) => {
    if (removed.length === 0) return;
    lastPageIndexRef.current = index;
    const target = pages[index];
    pushHistory(target.id, { kind: "erase", removed });
    const removeIdx = new Set(removed.map((r) => r.index));
    saveStrokes(index, target.strokes.filter((_, i) => !removeIdx.has(i)));
  };

  const handleUndo = () => {
    const idx = lastPageIndexRef.current;
    if (idx === null) return;
    const target = pages[idx];
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
     Header / Icons
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

  const activeColor = tool === "pen" ? currentPenColor : tool === "marker" ? currentMarkerColor : "#000000";
  const activeSize = tool === "pen" ? currentPenSize : tool === "marker" ? currentMarkerSize : currentEraserSize;

  return (
    <div className="min-h-screen bg-black flex flex-col">
      {/* Header */}
      <header className="sticky top-0 z-40 bg-neutral-900/70 backdrop-blur-md">
        <div className="max-w-6xl mx-auto px-4 py-3">
          <div className="flex items-center gap-3">
            {/* Logo only */}
            <Link href="/" title="Home" className="flex items-center gap-2 group">
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

            {/* Tools */}
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

            {/* Presets (sichtbar je nach Tool) */}
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

            <div className="hidden md:flex items-center gap-2 ml-2 text-xs text-gray-200">
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

            {/* Zoom Controls */}
            <div className="flex items-center gap-2">
              <button
                className="rounded-lg border border-white/25 px-2 py-1 text-xs
                           bg-gradient-to-br from-white/10 via-white/5 to-white/0
                           text-white hover:bg-white/10 shadow-sm"
                onClick={() => setZoomPct((p) => clamp(25, 200, p - 10))}
                title="Zoom -"
              >
                −
              </button>
              <div className="min-w-[52px] text-center text-xs text-white/90 select-none">
                {zoomPct}%
              </div>
              <button
                className="rounded-lg border border-white/25 px-2 py-1 text-xs
                           bg-gradient-to-br from-white/10 via-white/5 to-white/0
                           text-white hover:bg-white/10 shadow-sm"
                onClick={() => setZoomPct((p) => clamp(25, 200, p + 10))}
                title="Zoom +"
              >
                +
              </button>
            </div>

            {/* Home */}
            <Link
              href="/dokumente"
              title="Dokumente"
              className="ml-2 rounded-xl border border-white/25 px-3 py-2 text-sm
                         bg-gradient-to-br from-white/10 via-white/5 to-white/0
                         text-white hover:bg-white/10 shadow-sm"
            >
              <HomeIcon />
            </Link>
          </div>
        </div>
        <div className="h-px w-full bg-white/10" />
      </header>

      {/* Seiten-Layout */}
      <div ref={scrollerRef} className="flex-1 overflow-auto" style={{ WebkitOverflowScrolling: "touch" }}>
        {!authReady || !prefsReady ? (
          <div className="text-gray-400 p-6">Initialisiere…</div>
        ) : !uid ? (
          <div className="text-gray-400 p-6">Bitte einloggen, um das Dokument zu öffnen.</div>
        ) : !pagesReady ? (
          <div className="text-gray-400 p-6">Seiten werden vorbereitet…</div>
        ) : pages.length === 0 ? (
          <NoPagesFallback uid={uid} docId={docId} debugMsg={debugMsg} />
        ) : (
          <div className="max-w-[calc(2400px)] mx-auto px-2 py-4">
            {pages.map((p, idx) => (
              <A4LikePage
                key={p.id}
                pageIndex={idx}
                page={p}
                scale={scale}
                tool={tool}
                eraserMode={eraserMode}
                color={activeColor}
                width={activeSize}
                onAddBelow={() => addPageAfter(idx)}
                onDuplicateBelow={() => duplicatePageAfter(idx)}
                onDelete={() => deletePageAt(idx)}
                onChangeFormat={(fmt) => changePageFormat(idx, fmt)}
                onChangeOrientation={(ori) => changePageOrientation(idx, ori)}
                onAddStroke={(stroke) => handleAddStroke(idx, stroke)}
                onEraseStrokes={(removed) => handleEraseStrokes(idx, removed)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* =========================
   UI-Atoms
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
        "rounded-xl border px-3 py-2 text-sm transition shadow-sm backdrop-blur-md " +
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
   A-Seite (Canvas-Platzhalter + Seitenmenü)
   ========================= */

// Kürzester Abstand von Punkt p zu Liniensegment a-b
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

function A4LikePage({
  pageIndex,
  page,
  scale,
  tool,
  eraserMode,
  color,
  width,
  onAddBelow,
  onDuplicateBelow,
  onDelete,
  onChangeFormat,
  onChangeOrientation,
  onAddStroke,
  onEraseStrokes,
}: {
  pageIndex: number;
  page: { id: string; order: number; format: Format; orientation: Orientation; strokes: Stroke[] };
  scale: number;
  tool: Tool;
  eraserMode: "pixel" | "linie";
  color: string;
  width: number;
  onAddBelow: () => void;
  onDuplicateBelow: () => void;
  onDelete: () => void;
  onChangeFormat: (fmt: Format) => void;
  onChangeOrientation: (ori: Orientation) => void;
  onAddStroke: (stroke: Stroke) => void;
  onEraseStrokes: (removed: { stroke: Stroke; index: number }[]) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [formatOpen, setFormatOpen] = useState(false);
  const [info, setInfo] = useState<string | null>(null);
  const [hoverPos, setHoverPos] = useState<{ x: number; y: number } | null>(null);
  const drawingRef = useRef(false);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);
  const currentStrokeRef = useRef<StrokePoint[]>([]);
  const currentStyleRef = useRef<{ color: string; width: number; tool: Tool }>({ color, width, tool: "pen" });
  // Linien-Radierer: verbleibende Striche mit Original-Index (für Undo), Treffer dieser Geste
  const eraseWorkingRef = useRef<{ stroke: Stroke; index: number }[] | null>(null);
  const eraseHitsRef = useRef<{ stroke: Stroke; index: number }[]>([]);

  const drawStroke = (ctx: CanvasRenderingContext2D, stroke: Stroke) => {
    if (stroke.points.length < 2) return;
    ctx.globalCompositeOperation = stroke.tool === "eraser" ? "destination-out" : "source-over";
    ctx.strokeStyle = stroke.color;
    ctx.lineWidth = stroke.width;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    stroke.points.forEach((p, i) => {
      if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
    });
    ctx.stroke();
  };

  const { w, h } = sizeFor(page.format, page.orientation);
  const scaledW = Math.round(w * scale);
  const scaledH = Math.round(h * scale);

  // Weiss füllen, Striche replayen (Marker immer unter Pen, sonst "fogt" ein nachträglicher
  // Marker die Pen-Striche ein). Wiederverwendet vom Redraw-Effect und vom Linien-Radierer.
  const redrawWith = useCallback((strokesToUse: Stroke[]) => {
    const cvs = canvasRef.current;
    const ctx = cvs?.getContext("2d");
    if (!cvs || !ctx) return;
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, w, h);
    const ordered = [
      ...strokesToUse.filter((s) => s.tool === "marker"),
      ...strokesToUse.filter((s) => s.tool !== "marker"),
    ];
    ordered.forEach((s) => drawStroke(ctx, s));
  }, [w, h]);

  // Seite neu aufbauen: Auflösung an Zoom/Displaydichte anpassen (sonst wird's beim Reinzoomen unscharf)
  useEffect(() => {
    const cvs = canvasRef.current;
    if (!cvs) return;
    const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
    const resFactor = clamp(1, 3, scale * dpr);
    cvs.width = Math.round(w * resFactor);
    cvs.height = Math.round(h * resFactor);
    const ctx = cvs.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(resFactor, 0, 0, resFactor, 0, 0);
    redrawWith(page.strokes);
  }, [page.format, page.orientation, page.strokes, scale, w, h, redrawWith]);

  const handleCanvasDown = () => {
    if (menuOpen || formatOpen) {
      setMenuOpen(false);
      setFormatOpen(false);
    }
  };

  // Liefert die Position in den gleichen absoluten Basis-Pixeln, in denen Striche gespeichert
  // werden (unabhängig von Zoom/Displaydichte, die nur die Canvas-Auflösung betreffen)
  const getCanvasPoint = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const cvs = canvasRef.current!;
    const rect = cvs.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * w,
      y: ((e.clientY - rect.top) / rect.height) * h,
    };
  };

  const isLineEraser = tool === "eraser" && eraserMode === "linie";

  // Trifft der Punkt einen der noch verbliebenen Striche, wird er (samt Original-Index)
  // aus dem Arbeits-Set entfernt und in den Treffern dieser Geste gesammelt
  const applyLineErase = (point: StrokePoint) => {
    const current = eraseWorkingRef.current;
    if (!current) return;
    const hits = current.filter(({ stroke }) => strokeHit(stroke, point, width / 2));
    if (hits.length === 0) return;
    const hitSet = new Set(hits);
    const remaining = current.filter((entry) => !hitSet.has(entry));
    eraseHitsRef.current = [...eraseHitsRef.current, ...hits];
    eraseWorkingRef.current = remaining;
    redrawWith(remaining.map((entry) => entry.stroke));
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const cvs = canvasRef.current;
    if (!cvs) return;
    cvs.setPointerCapture(e.pointerId);
    drawingRef.current = true;
    const point = getCanvasPoint(e);
    lastPointRef.current = point;

    if (isLineEraser) {
      eraseWorkingRef.current = page.strokes.map((stroke, index) => ({ stroke, index }));
      eraseHitsRef.current = [];
      applyLineErase(point);
      return;
    }

    currentStyleRef.current = { color, width, tool };
    currentStrokeRef.current = [point];
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const point = getCanvasPoint(e);
    if (tool === "eraser") setHoverPos(point);
    else if (hoverPos) setHoverPos(null);

    if (!drawingRef.current || !lastPointRef.current) return;

    if (isLineEraser) {
      applyLineErase(point);
      lastPointRef.current = point;
      return;
    }

    const cvs = canvasRef.current;
    const ctx = cvs?.getContext("2d");
    if (!cvs || !ctx) return;
    ctx.globalCompositeOperation = currentStyleRef.current.tool === "eraser" ? "destination-out" : "source-over";
    ctx.strokeStyle = currentStyleRef.current.color;
    ctx.lineWidth = currentStyleRef.current.width;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(lastPointRef.current.x, lastPointRef.current.y);
    ctx.lineTo(point.x, point.y);
    ctx.stroke();
    lastPointRef.current = point;
    currentStrokeRef.current.push(point);
  };

  const handlePointerUp = () => {
    drawingRef.current = false;
    lastPointRef.current = null;

    if (isLineEraser) {
      if (eraseHitsRef.current.length > 0) onEraseStrokes(eraseHitsRef.current);
      eraseWorkingRef.current = null;
      eraseHitsRef.current = [];
      return;
    }

    if (currentStrokeRef.current.length > 1) {
      onAddStroke({ points: currentStrokeRef.current, ...currentStyleRef.current });
    }
    currentStrokeRef.current = [];
  };

  const handlePointerLeave = () => {
    handlePointerUp();
    setHoverPos(null);
  };

  const copyPageToClipboard = async () => {
    try {
      const cvs = canvasRef.current;
      if (!cvs) return;
      const blob: Blob = await new Promise((res, rej) =>
        cvs.toBlob((b) => (b ? res(b) : rej(new Error("toBlob failed"))), "image/png")
      );
      // @ts-ignore
      if (navigator.clipboard && (window as any).ClipboardItem) {
        // @ts-ignore
        const item = new (window as any).ClipboardItem({ "image/png": blob });
        await navigator.clipboard.write([item]);
        setInfo("Seite als PNG kopiert.");
      } else {
        const url = URL.createObjectURL(blob);
        window.open(url, "_blank");
        setInfo("PNG in neuem Tab geöffnet.");
      }
    } catch {
      setInfo("Kopieren nicht möglich.");
    } finally {
      setTimeout(() => setInfo(null), 2200);
    }
  };

  return (
    <div className="w-full flex justify-center">
      <div
        className="relative"
        style={{ width: `${scaledW}px`, height: `${scaledH}px`, marginBottom: "16px" }}
        onMouseDown={handleCanvasDown}
        onTouchStart={handleCanvasDown}
      >
        {/* dunkler Teppich */}
        <div
          className="absolute"
          style={{
            top: `calc(-6px * ${scale})`,
            left: `calc(-6px * ${scale})`,
            right: `calc(-6px * ${scale})`,
            bottom: `calc(-6px * ${scale})`,
            borderRadius: `${12 * scale}px`,
            background: "rgba(31,41,55,0.4)",
          }}
        />

        {/* Papier: CSS-Grösse wächst direkt mit dem Zoom mit (kein transform:scale mehr),
            sonst würde ein bereits fertig gerastertes Bild nachträglich hochskaliert und unscharf */}
        <div className="absolute top-0 left-0" style={{ width: scaledW, height: scaledH }}>
          <canvas
            ref={canvasRef}
            className="relative z-10 select-none touch-none bg-white rounded-xl ring-1 ring-black/20"
            style={{ width: scaledW, height: scaledH, cursor: tool === "eraser" ? "none" : "crosshair", touchAction: "none" }}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerLeave={handlePointerLeave}
            onPointerCancel={handlePointerLeave}
          />
          {tool === "eraser" && hoverPos && (
            <div
              className="absolute z-20 rounded-full border-2 border-black/70 bg-white/20 pointer-events-none"
              style={{
                left: hoverPos.x * scale - (width * scale) / 2,
                top: hoverPos.y * scale - (width * scale) / 2,
                width: width * scale,
                height: width * scale,
              }}
            />
          )}
        </div>

        {/* Seitenzahl */}
        <div className="absolute -left-12 top-2 text-xs text-gray-400">
          Seite {pageIndex + 1}
        </div>

        {/* Seitenmenü-Button */}
        <button
          aria-label="Seitenmenü"
          onClick={(e) => {
            e.stopPropagation();
            setMenuOpen((v) => !v);
            setFormatOpen(false);
          }}
          className="absolute z-30 h-10 w-10 rounded-full
                     bg-gradient-to-br from-gray-200/50 via-gray-100/30 to-gray-50/10
                     border border-black/40 backdrop-blur-md
                     hover:bg-gray-200/60 active:bg-gray-300/60 transition"
          style={{ right: 8, bottom: 8 }}
        />

        {/* Hauptmenü */}
        {menuOpen && (
          <div
            className="absolute z-40 min-w=[240px] rounded-2xl overflow-hidden
                       border border-black/30 shadow-xl
                       bg-gradient-to-br from-gray-100/85 via-gray-200/70 to-gray-100/50
                       backdrop-blur-md text-gray-900 text-sm"
            style={{ right: 8, bottom: 48 }}
            role="menu"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="px-3 py-2 font-medium flex items-center justify-between">
              <span>Seite {pageIndex + 1}</span>
              <span className="text-[11px] text-gray-600">
                {page.format} • {page.orientation === "portrait" ? "Hoch" : "Quer"}
              </span>
            </div>
            <div className="h-px bg-black/10" />

            <button onClick={() => setFormatOpen((v) => !v)} className="w-full text-left px-3 py-2 hover:bg-gray-100/70">
              Seitengröße ändern
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
          <div className="absolute z-40 bottom-12 right-8 px-3 py-1.5 rounded-lg bg-black/75 text-white text-xs shadow">
            {info}
          </div>
        )}
      </div>
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
                const p0 = doc(coll);
                const p1 = doc(coll);
                batch.set(p0, {
                  uid,
                  order: 0,
                  format: "A4",
                  orientation: "portrait",
                  createdAt: serverTimestamp(),
                  createdAtClient: Date.now(),
                } as PageDoc);
                batch.set(p1, {
                  uid,
                  order: 1,
                  format: "A4",
                  orientation: "portrait",
                  createdAt: serverTimestamp(),
                  createdAtClient: Date.now(),
                } as PageDoc);
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
   Helpers
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
