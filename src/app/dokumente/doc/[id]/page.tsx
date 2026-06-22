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
import { useEffect, useMemo, useRef, useState } from "react";
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

type PageDoc = {
  uid: string;
  order: number;
  format: Format;
  orientation: Orientation;
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
  theDoc: {
  }
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
    penIdx, setPenIdx,
    markerIdx, setMarkerIdx,
    sizeIdxPen, setSizeIdxPen,
    sizeIdxMarker, setSizeIdxMarker,
    currentPenColor,
    currentMarkerColor,
    currentPenSize,
    currentMarkerSize,
  } = useEditorPrefs();

  // UI: aktives Tool (nicht persistent)
  const [tool, setTool] = useState<Tool>("pen");

  // Inline-Editoren (Picker)
  const [editColorIdx, setEditColorIdx] = useState<{ type: "pen" | "marker"; idx: number } | null>(null);
  const [editSizeIdx, setEditSizeIdx] = useState<{ type: "pen" | "marker"; idx: number } | null>(null);

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
  type PageRef = { id: string; order: number; format: Format; orientation: Orientation };

  const [pages, setPages] = useState<PageRef[]>([]);
  const [pagesReady, setPagesReady] = useState(false);
  const creatingInitialRef = useRef(false);
  const [debugMsg, setDebugMsg] = useState<string>("");

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

  const changePageFormat = async (index: number, format: Format) => {
    const coll = collection(db, "documents", docId, "pages");
    const target = pages[index];
    await updateDoc(doc(coll, target.id), { format });
  };

  const changePageOrientation = async (index: number, orientation: Orientation) => {
    const coll = collection(db, "documents", docId, "pages");
    const target = pages[index];
    await updateDoc(doc(coll, target.id), { orientation });
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
  const activeSize = tool === "pen" ? currentPenSize : tool === "marker" ? currentMarkerSize : currentPenSize;

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

            {/* Undo/Redo – Platzhalter */}
            <ToolBtn title="Rückgängig" onClick={() => {}}>
              <UndoIcon />
            </ToolBtn>
            <ToolBtn title="Wiederholen" onClick={() => {}}>
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
            </div>

            <div className="hidden md:flex items-center gap-2 ml-2 text-xs text-gray-200">
              <span className="inline-flex items-center gap-1">
                <span>Farbe</span>
                <span className="inline-block h-4 w-4 rounded-full border border-white/20" style={{ background: activeColor }} />
              </span>
              <span>•</span>
              <span>Strich: {activeSize}px</span>
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
                onAddBelow={() => addPageAfter(idx)}
                onDuplicateBelow={() => duplicatePageAfter(idx)}
                onDelete={() => deletePageAt(idx)}
                onChangeFormat={(fmt) => changePageFormat(idx, fmt)}
                onChangeOrientation={(ori) => changePageOrientation(idx, ori)}
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
  type: "pen" | "marker";
  sizes: number[];
  selectedIdx: number;
  onPick: (i: number) => void;
  editSizeIdx: { type: "pen" | "marker"; idx: number } | null;
  setEditSizeIdx: (v: { type: "pen" | "marker"; idx: number } | null) => void;
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
  type: "pen" | "marker";
  idx: number;
  value: number;
  selected?: boolean;
  onPick: () => void;
  editSizeIdx: { type: "pen" | "marker"; idx: number } | null;
  setEditSizeIdx: (v: { type: "pen" | "marker"; idx: number } | null) => void;
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

function A4LikePage({
  pageIndex,
  page,
  scale,
  onAddBelow,
  onDuplicateBelow,
  onDelete,
  onChangeFormat,
  onChangeOrientation,
}: {
  pageIndex: number;
  page: { id: string; order: number; format: Format; orientation: Orientation };
  scale: number;
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

  useEffect(() => {
    const cvs = canvasRef.current;
    if (!cvs) return;
    const { w, h } = sizeFor(page.format, page.orientation);
    cvs.width = w;
    cvs.height = h;
    const ctx = cvs.getContext("2d");
    if (ctx) {
      ctx.fillStyle = "#FFFFFF";
      ctx.fillRect(0, 0, w, h);
    }
  }, [page.format, page.orientation]);

  const { w, h } = sizeFor(page.format, page.orientation);
  const scaledW = Math.round(w * scale);
  const scaledH = Math.round(h * scale);

  const handleCanvasDown = () => {
    if (menuOpen || formatOpen) {
      setMenuOpen(false);
      setFormatOpen(false);
    }
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

        {/* skaliertes Papier */}
        <div
          className="absolute top-0 left-0"
          style={{
            width: w,
            height: h,
            transform: `scale(${scale})`,
            transformOrigin: "top left",
          }}
        >
          <canvas
            ref={canvasRef}
            className="relative z-10 select-none bg-white rounded-xl ring-1 ring-black/20"
            style={{ width: w, height: h, cursor: "default" }}
          />
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
