"use client";

import Link from "next/link";
import { Eye, EyeOff, ListChecks } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { db, auth } from "@/lib/firebase";
import {
  collection,
  addDoc,
  onSnapshot,
  query,
  where,
  serverTimestamp,
  QuerySnapshot,
  DocumentData,
  getDocs,
  writeBatch,
  doc,
  updateDoc,
  deleteDoc,
} from "firebase/firestore";
import type { DocKind, Folder, DocItem, GridItem, FolderColor } from "@/components/dokumente/types";
import { FolderTile, DocumentTile } from "@/components/dokumente/Tiles";
import { ItemNameMenu } from "@/components/dokumente/NameMenu";
import DokumenteHudStyles from "@/components/dokumente/HudStyles";
import { uploadMultipleFiles, deleteDocumentFile, downloadDocumentFile } from "@/components/dokumente/upload";
import { downloadFolderAsZip } from "@/components/dokumente/zip";
import StorageRing from "@/components/dokumente/StorageRing";
import { usePreviewPref } from "@/components/dokumente/usePreviewPref";
import { ImageLightbox } from "@/components/dokumente/ImageLightbox";
import { FolderPickerModal } from "@/components/dokumente/FolderPickerModal";
import { moveDocument, moveFolder } from "@/components/dokumente/move";
import { SelectionOverlay } from "@/components/dokumente/SelectionOverlay";
import { hudColor, HUD_COLOR_ORDER } from "@/components/dokumente/hud";

/* ======================
   Page
   ====================== */

export default function DokumenteRootPage() {
  // Root hat keinen Pfad → parentPathSlug = "" (leer)
  const currentPathSlug = "";

  // ----- Auth -----
  const [uid, setUid] = useState<string | null>(null);
  const [authReady, setAuthReady] = useState(false);
  useEffect(() => {
    const off = auth.onAuthStateChanged((u) => {
      setUid(u?.uid ?? null);
      setAuthReady(true);
    });
    return () => off();
  }, []);

  // ----- State -----
  const [folders, setFolders] = useState<Folder[]>([]);
  const [docs, setDocs] = useState<DocItem[]>([]);
  const [loadingFolders, setLoadingFolders] = useState(true);
  const [loadingDocs, setLoadingDocs] = useState(true);

  // UI: „Neuer Ordner“
  const [isCreateFolderOpen, setIsCreateFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");

  // UI: „Neues Dokument“
  const [isCreateDocOpen, setIsCreateDocOpen] = useState(false);
  const [newDocName, setNewDocName] = useState("");

  // UI: Datei-Upload
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [uploadPct, setUploadPct] = useState<number | null>(null);

  // UI: Ordner-Download
  const [downloadPct, setDownloadPct] = useState<number | null>(null);

  // UI: Bild-Vorschau an/aus
  const { showPreview, setShowPreview } = usePreviewPref(uid);

  // UI: Bilder-Lightbox (Durchblaettern)
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  // UI: Verschieben
  const [movingItem, setMovingItem] = useState<{ kind: "folder" | "doc"; id: string; name: string } | null>(null);

  // UI: Mehrfachauswahl
  const [selectMode, setSelectMode] = useState(false);
  const [selectedFolderIds, setSelectedFolderIds] = useState<Set<string>>(new Set());
  const [selectedDocIds, setSelectedDocIds] = useState<Set<string>>(new Set());
  const [showBulkPalette, setShowBulkPalette] = useState(false);
  const [bulkMoveOpen, setBulkMoveOpen] = useState(false);

  // ----- Laden: Unterordner auf Root -----
  useEffect(() => {
    if (!authReady) return;
    if (!uid) {
      setFolders([]);
      setLoadingFolders(false);
      return;
    }
    setLoadingFolders(true);

    const qRef = query(
      collection(db, "folders"),
      where("parentPathSlug", "==", currentPathSlug),
      where("uid", "==", uid)
    );

    const unsub = onSnapshot(
      qRef,
      (snap: QuerySnapshot<DocumentData>) => {
        const raw = snap.docs.map((d) => {
          const data = d.data();
          return {
            id: d.id,
            name: (data.name as string) ?? "Unbenannt",
            slug: (data.slug as string) ?? d.id,
            color: (data.color as FolderColor) ?? "blue",
            createdAtClient:
              typeof data.createdAtClient === "number" ? data.createdAtClient : 0,
          } as Folder;
        });
        raw.sort((a, b) => (a.createdAtClient ?? 0) - (b.createdAtClient ?? 0));
        setFolders(raw);
        setLoadingFolders(false);
      },
      (err) => {
        console.warn("folders(root) error", err);
        setFolders([]);
        setLoadingFolders(false);
      }
    );

    return () => unsub();
  }, [authReady, uid, currentPathSlug]);

  // ----- Laden: Dokumente auf Root -----
  useEffect(() => {
    if (!authReady) return;
    if (!uid) {
      setDocs([]);
      setLoadingDocs(false);
      return;
    }
    setLoadingDocs(true);

    const qRef = query(
      collection(db, "documents"),
      where("parentPathSlug", "==", currentPathSlug),
      where("uid", "==", uid)
    );

    const unsub = onSnapshot(
      qRef,
      (snap: QuerySnapshot<DocumentData>) => {
        const raw: DocItem[] = snap.docs.map((d) => {
          const data = d.data();
          return {
            id: d.id,
            name: (data.name as string) ?? "Unbenannt",
            color: (data.color as FolderColor) ?? "blue",
            createdAtClient:
              typeof data.createdAtClient === "number" ? data.createdAtClient : 0,
            docKind: (data.docKind as DocKind) ?? "canvas",
            storagePath: data.storagePath as string | undefined,
            downloadURL: data.downloadURL as string | undefined,
            mimeType: data.mimeType as string | undefined,
            sizeBytes: data.sizeBytes as number | undefined,
          };
        });
        raw.sort((a, b) => a.createdAtClient - b.createdAtClient);
        setDocs(raw);
        setLoadingDocs(false);
      },
      (err) => {
        console.warn("documents(root) error", err);
        setDocs([]);
        setLoadingDocs(false);
      }
    );

    return () => unsub();
  }, [authReady, uid, currentPathSlug]);

  // ----- Helpers: slugify + unique slug (für Ordner) -----
  const slugify = (s: string) =>
    s
      .toLowerCase()
      .normalize("NFKD")
      .replace(/\p{Diacritic}/gu, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .replace(/--+/g, "-")
      .slice(0, 64);

  const makeUniqueSlug = async (baseSlug: string, parentPathSlug: string) => {
    if (!uid) return baseSlug;
    let candidate = baseSlug || "ordner";
    let i = 1;
    while (true) {
      const snap = await getDocs(
        query(
          collection(db, "folders"),
          where("uid", "==", uid),
          where("parentPathSlug", "==", parentPathSlug),
          where("slug", "==", candidate)
        )
      );
      if (snap.empty) return candidate;
      i += 1;
      candidate = `${baseSlug || "ordner"}-${i}`;
    }
  };

  // ----- Anlegen: Ordner auf Root -----
  const createFolder = async () => {
    const name = newFolderName.trim();
    if (!name) return;
    if (!uid) {
      alert("Bitte zuerst einloggen, um Ordner anzulegen.");
      return;
    }
    const slug = await makeUniqueSlug(slugify(name), currentPathSlug);

    await addDoc(collection(db, "folders"), {
      name,
      slug,
      parentPathSlug: currentPathSlug, // ""
      color: "blue",
      uid,
      createdAt: serverTimestamp(),
      createdAtClient: Date.now(),
    });

    setNewFolderName("");
    setIsCreateFolderOpen(false);
  };

  // ----- Anlegen: Dokument auf Root -----
  const createDocument = async () => {
    const name = newDocName.trim();
    if (!name) return;
    if (!uid) {
      alert("Bitte zuerst einloggen, um Dokumente anzulegen.");
      return;
    }
    await addDoc(collection(db, "documents"), {
      name,
      parentPathSlug: currentPathSlug, // ""
      uid,
      color: "blue",
      createdAt: serverTimestamp(),
      createdAtClient: Date.now(),
    });
    setNewDocName("");
    setIsCreateDocOpen(false);
  };

  // ----- Datei(en) hochladen -----
  const uploadFiles = async (files: File[]) => {
    if (files.length === 0 || !uid) return;
    setUploadPct(0);
    try {
      await uploadMultipleFiles({ files, uid, parentPathSlug: currentPathSlug, onProgress: setUploadPct });
    } catch (err) {
      console.error("Upload fehlgeschlagen:", err);
      alert("Datei-Upload fehlgeschlagen.");
    } finally {
      setUploadPct(null);
    }
  };

  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = ""; // erlaubt erneutes Auswählen derselben Datei(en)
    await uploadFiles(files);
  };

  // ----- Drag & Drop -----
  const dragCounterRef = useRef(0);
  const [isDragOver, setIsDragOver] = useState(false);

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.types.includes("Files")) {
      dragCounterRef.current += 1;
      setIsDragOver(true);
    }
  };
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };
  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    dragCounterRef.current -= 1;
    if (dragCounterRef.current <= 0) {
      dragCounterRef.current = 0;
      setIsDragOver(false);
    }
  };
  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    dragCounterRef.current = 0;
    setIsDragOver(false);
    const files = Array.from(e.dataTransfer.files ?? []);
    await uploadFiles(files);
  };

  // ----- rekursiv löschen von Ordnerbäumen -----
  const deleteFolderTree = async ({
    parentPathSlug,
    slug,
    folderId,
  }: {
    parentPathSlug: string;
    slug: string;
    folderId: string;
  }) => {
    const fullPathSlug = parentPathSlug ? `${parentPathSlug}/${slug}` : slug;

    const refs: { id: string }[] = [];
    const queue: string[] = [fullPathSlug];
    while (queue.length) {
      const p = queue.shift()!;
      const snapF = await getDocs(
        query(
          collection(db, "folders"),
          where("parentPathSlug", "==", p),
          where("uid", "==", uid)
        )
      );
      for (const d of snapF.docs) {
        refs.push({ id: d.id });
        const childSlug = d.data().slug as string;
        queue.push(p ? `${p}/${childSlug}` : childSlug);
      }
      const snapD = await getDocs(
        query(
          collection(db, "documents"),
          where("parentPathSlug", "==", p),
          where("uid", "==", uid)
        )
      );
      for (const d of snapD.docs) {
        await deleteDocumentFile(d.data().storagePath as string | undefined);
        await deleteDoc(doc(db, "documents", d.id));
      }
    }

    const CHUNK = 450;
    for (let i = 0; i < refs.length; i += CHUNK) {
      const batch = writeBatch(db);
      refs.slice(i, i + CHUNK).forEach((r) => batch.delete(doc(db, "folders", r.id)));
      await batch.commit();
    }
    await deleteDoc(doc(db, "folders", folderId));
  };

  // ----- Aktionen: Ordner -----
  const handleRenameFolder = async (id: string) => {
    const name = prompt("Neuer Ordnername:");
    if (!name) return;
    await updateDoc(doc(db, "folders", id), { name: name.trim() });
  };
  const handleDeleteFolder = async (f: Folder) => {
    const ok = confirm("Diesen Ordner inkl. aller Unterordner und Dokumente löschen?");
    if (!ok) return;
    await deleteFolderTree({
      parentPathSlug: currentPathSlug,
      slug: f.slug,
      folderId: f.id,
    });
  };
  const handleColorFolder = async (id: string, color: FolderColor) => {
    await updateDoc(doc(db, "folders", id), { color });
  };
  const handleDownloadFolder = async (f: Folder) => {
    if (!uid) return;
    setDownloadPct(0);
    try {
      const fullPathSlug = currentPathSlug ? `${currentPathSlug}/${f.slug}` : f.slug;
      await downloadFolderAsZip({ uid, rootName: f.name, fullPathSlug, onProgress: setDownloadPct });
    } catch (err) {
      if (err instanceof Error && err.message === "EMPTY_FOLDER") {
        alert("Dieser Ordner enthält keine hochgeladenen Dateien zum Herunterladen.");
      } else {
        console.error("Ordner-Download fehlgeschlagen:", err);
        alert("Ordner-Download fehlgeschlagen.");
      }
    } finally {
      setDownloadPct(null);
    }
  };

  // ----- Aktionen: Dokument -----
  const handleRenameDoc = async (id: string) => {
    const name = prompt("Neuer Dokumentname:");
    if (!name) return;
    await updateDoc(doc(db, "documents", id), { name: name.trim() });
  };
  const handleDeleteDoc = async (d: DocItem) => {
    const ok = confirm(d.docKind === "file" ? "Diese Datei löschen?" : "Dieses Dokument löschen?");
    if (!ok) return;
    await deleteDocumentFile(d.storagePath);
    await deleteDoc(doc(db, "documents", d.id));
  };
  const handleColorDoc = async (id: string, color: FolderColor) => {
    await updateDoc(doc(db, "documents", id), { color });
  };
  const handleDownloadDoc = async (d: DocItem) => {
    if (!d.downloadURL) return;
    setDownloadPct(0);
    try {
      await downloadDocumentFile(d.downloadURL, d.name, setDownloadPct);
    } catch (err) {
      console.error("Download fehlgeschlagen:", err);
      alert("Download fehlgeschlagen. Möglicherweise fehlt die CORS-Freigabe im Storage-Bucket.");
    } finally {
      setDownloadPct(null);
    }
  };

  // ----- Verschieben (Ordner + Dokument gemeinsam) -----
  const handleMoveSelect = async (targetPathSlug: string) => {
    if (!uid || !movingItem) return;
    try {
      if (movingItem.kind === "doc") {
        await moveDocument({ docId: movingItem.id, newParentPathSlug: targetPathSlug });
      } else {
        const f = folders.find((x) => x.id === movingItem.id);
        if (f) {
          await moveFolder({ uid, folder: f, oldParentPathSlug: currentPathSlug, newParentPathSlug: targetPathSlug });
        }
      }
      setMovingItem(null);
    } catch (err) {
      if (err instanceof Error && err.message === "CANNOT_MOVE_INTO_OWN_SUBTREE") {
        alert("Ein Ordner kann nicht in sich selbst oder einen eigenen Unterordner verschoben werden.");
      } else {
        console.error("Verschieben fehlgeschlagen:", err);
        alert("Verschieben fehlgeschlagen.");
      }
    }
  };

  // ----- Verschieben per Drag&Drop auf ein Ordner-Icon (Desktop-Bonus) -----
  const DND_MIME = "application/x-dokumente-item";
  const [dragOverFolderId, setDragOverFolderId] = useState<string | null>(null);

  const handleTileDragStart = (
    e: React.DragEvent,
    item: { kind: "folder" | "doc"; id: string; name: string }
  ) => {
    e.dataTransfer.setData(DND_MIME, JSON.stringify(item));
    e.dataTransfer.effectAllowed = "move";
  };
  const handleFolderDragOver = (e: React.DragEvent, folderId: string) => {
    if (!e.dataTransfer.types.includes(DND_MIME)) return;
    e.preventDefault();
    e.stopPropagation();
    setDragOverFolderId(folderId);
  };
  const handleFolderDragLeave = (folderId: string) => {
    setDragOverFolderId((cur) => (cur === folderId ? null : cur));
  };
  const handleFolderDropTarget = async (e: React.DragEvent, targetFolder: Folder) => {
    if (!e.dataTransfer.types.includes(DND_MIME)) return;
    e.preventDefault();
    e.stopPropagation();
    setDragOverFolderId(null);
    const raw = e.dataTransfer.getData(DND_MIME);
    if (!raw || !uid) return;
    const item = JSON.parse(raw) as { kind: "folder" | "doc"; id: string; name: string };
    if (item.kind === "folder" && item.id === targetFolder.id) return;

    const targetPathSlug = currentPathSlug ? `${currentPathSlug}/${targetFolder.slug}` : targetFolder.slug;
    try {
      if (item.kind === "doc") {
        await moveDocument({ docId: item.id, newParentPathSlug: targetPathSlug });
      } else {
        const f = folders.find((x) => x.id === item.id);
        if (f) await moveFolder({ uid, folder: f, oldParentPathSlug: currentPathSlug, newParentPathSlug: targetPathSlug });
      }
    } catch (err) {
      if (err instanceof Error && err.message === "CANNOT_MOVE_INTO_OWN_SUBTREE") {
        alert("Ein Ordner kann nicht in sich selbst oder einen eigenen Unterordner verschoben werden.");
      } else {
        console.error("Verschieben fehlgeschlagen:", err);
        alert("Verschieben fehlgeschlagen.");
      }
    }
  };

  // ----- Mehrfachauswahl -----
  const toggleFolderSelected = (id: string) => {
    setSelectedFolderIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const toggleDocSelected = (id: string) => {
    setSelectedDocIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const selectedCount = selectedFolderIds.size + selectedDocIds.size;
  const exitSelectMode = () => {
    setSelectMode(false);
    setSelectedFolderIds(new Set());
    setSelectedDocIds(new Set());
    setShowBulkPalette(false);
  };

  const handleBulkDelete = async () => {
    if (selectedCount === 0) return;
    const ok = confirm(`${selectedCount} Element(e) inkl. Inhalt wirklich löschen?`);
    if (!ok) return;
    for (const id of selectedFolderIds) {
      const f = folders.find((x) => x.id === id);
      if (f) await deleteFolderTree({ parentPathSlug: currentPathSlug, slug: f.slug, folderId: f.id });
    }
    for (const id of selectedDocIds) {
      const d = docs.find((x) => x.id === id);
      if (d) {
        await deleteDocumentFile(d.storagePath);
        await deleteDoc(doc(db, "documents", d.id));
      }
    }
    exitSelectMode();
  };

  const handleBulkColor = async (color: FolderColor) => {
    for (const id of selectedFolderIds) await updateDoc(doc(db, "folders", id), { color });
    for (const id of selectedDocIds) await updateDoc(doc(db, "documents", id), { color });
    setShowBulkPalette(false);
  };

  const handleBulkMoveSelect = async (targetPathSlug: string) => {
    if (!uid) return;
    for (const id of selectedFolderIds) {
      const f = folders.find((x) => x.id === id);
      if (!f) continue;
      try {
        await moveFolder({ uid, folder: f, oldParentPathSlug: currentPathSlug, newParentPathSlug: targetPathSlug });
      } catch (err) {
        if (err instanceof Error && err.message === "CANNOT_MOVE_INTO_OWN_SUBTREE") {
          alert(`Ordner "${f.name}" kann nicht in sich selbst/einen eigenen Unterordner verschoben werden, wird übersprungen.`);
        } else {
          throw err;
        }
      }
    }
    for (const id of selectedDocIds) {
      await moveDocument({ docId: id, newParentPathSlug: targetPathSlug });
    }
    setBulkMoveOpen(false);
    exitSelectMode();
  };

  // --- GEMEINSAMES GRID ---
  const items: GridItem[] = useMemo(() => {
    const F = folders.map((f) => ({
      kind: "folder" as const,
      createdAtClient: f.createdAtClient ?? 0,
      folder: f,
    }));
    const D = docs.map((d) => ({
      kind: "doc" as const,
      createdAtClient: d.createdAtClient,
      doc: d,
    }));
    return [...F, ...D].sort((a, b) => a.createdAtClient - b.createdAtClient);
  }, [folders, docs]);

  // Nur Bilder, gleiche Reihenfolge wie im Grid -> Basis fuer die Lightbox
  const imageDocs = useMemo(
    () => docs.filter((d) => d.docKind === "file" && d.mimeType?.startsWith("image/")),
    [docs]
  );

  return (
    <div
      className="min-h-screen dhud-bg text-cyan-50 relative overflow-hidden font-mono"
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div className="dhud-grid pointer-events-none absolute inset-0" />

      {isDragOver && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm border-4 border-dashed border-cyan-400/60 pointer-events-none">
          <div className="text-cyan-200 text-lg tracking-widest uppercase font-semibold text-center px-6">
            Dateien hier ablegen zum Hochladen
          </div>
        </div>
      )}

      {/* Durchgehende Header-Leiste, einheitlich mit den anderen Modulen */}
      <header className="relative z-10 w-full flex items-center justify-between px-6 py-4 border-b border-cyan-400/20 bg-black/20 backdrop-blur-sm">
        <div className="flex items-center gap-3">
          <Link href="/" className="text-xs tracking-widest text-cyan-400/70 hover:text-cyan-300 transition uppercase">
            ← Zurück
          </Link>
          <span className="text-cyan-400/20">|</span>
          <h1 className="dhud-title text-lg font-bold text-cyan-100 uppercase">Dokumente</h1>
        </div>
        <span className="flex items-center gap-1.5 text-[10px] tracking-[0.2em] text-cyan-400/70 uppercase">
          <span className="dhud-dot h-1.5 w-1.5 rounded-full bg-cyan-400" />
          Sync aktiv
        </span>
      </header>

      <div className="relative z-10 p-6 md:p-8 max-w-6xl mx-auto">
        {/* Actions */}
        <div className="flex items-center justify-end mb-8 flex-wrap gap-3">

          <div className="flex items-center gap-2 flex-wrap">
            {/* Neuer Ordner */}
            {!isCreateFolderOpen ? (
              <button
                onClick={() => setIsCreateFolderOpen(true)}
                className="dhud-btn dhud-btn-outline"
                disabled={!uid}
              >
                Neuer Ordner
              </button>
            ) : (
              <div className="flex items-center gap-2">
                <input
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                  placeholder="Ordnername"
                  autoFocus
                  className="dhud-input"
                />
                <button onClick={createFolder} className="dhud-btn dhud-btn-primary">
                  Speichern
                </button>
                <button
                  onClick={() => { setIsCreateFolderOpen(false); setNewFolderName(""); }}
                  className="dhud-btn dhud-btn-outline"
                >
                  Abbrechen
                </button>
              </div>
            )}

            {/* Neues Dokument */}
            {!isCreateDocOpen ? (
              <button
                onClick={() => setIsCreateDocOpen(true)}
                className="dhud-btn dhud-btn-primary"
                disabled={!uid}
              >
                Neues Dokument
              </button>
            ) : (
              <div className="flex items-center gap-2">
                <input
                  value={newDocName}
                  onChange={(e) => setNewDocName(e.target.value)}
                  placeholder="Dokumentname"
                  autoFocus
                  className="dhud-input"
                />
                <button onClick={createDocument} className="dhud-btn dhud-btn-primary">
                  Speichern
                </button>
                <button
                  onClick={() => { setIsCreateDocOpen(false); setNewDocName(""); }}
                  className="dhud-btn dhud-btn-outline"
                >
                  Abbrechen
                </button>
              </div>
            )}

            {/* Datei(en) hochladen */}
            <input ref={fileInputRef} type="file" multiple onChange={handleFileSelected} className="hidden" />
            <button
              onClick={() => fileInputRef.current?.click()}
              className="dhud-btn dhud-btn-outline"
              disabled={!uid || uploadPct !== null}
              title="Auswaehlen oder Dateien per Drag&Drop irgendwo auf die Seite ziehen"
            >
              {uploadPct !== null ? `Lädt hoch… ${uploadPct}%` : "Hochladen"}
            </button>

            {/* Bild-Vorschau an/aus */}
            <button
              onClick={() => setShowPreview(!showPreview)}
              className={`dhud-btn dhud-toggle ${showPreview ? "dhud-toggle-on" : ""}`}
              disabled={!uid}
              title="Bild-Vorschau in den Kacheln an/aus"
            >
              {showPreview ? <Eye size={14} className="inline -mt-0.5 mr-1.5" /> : <EyeOff size={14} className="inline -mt-0.5 mr-1.5" />}
              Vorschau
            </button>

            {/* Mehrfachauswahl an/aus */}
            <button
              onClick={() => (selectMode ? exitSelectMode() : setSelectMode(true))}
              className={`dhud-btn dhud-toggle ${selectMode ? "dhud-toggle-on-alt" : ""}`}
              disabled={!uid}
              title="Mehrere Ordner/Dokumente gemeinsam bearbeiten"
            >
              <ListChecks size={14} className="inline -mt-0.5 mr-1.5" />
              Auswählen
            </button>
          </div>
        </div>

        {/* Sammel-Aktionen */}
        {selectMode && (
          <div className="dhud-menu rounded-xl px-4 py-3 mb-4 flex items-center gap-2 flex-wrap">
            <span className="text-xs text-fuchsia-200 tracking-wide mr-1">
              {selectedCount} ausgewählt
            </span>
            <button
              onClick={() => setShowBulkPalette((v) => !v)}
              className="dhud-btn dhud-btn-outline"
              disabled={selectedCount === 0}
            >
              Farbe ändern
            </button>
            <button
              onClick={() => setBulkMoveOpen(true)}
              className="dhud-btn dhud-btn-outline"
              disabled={selectedCount === 0}
            >
              Verschieben
            </button>
            <button
              onClick={handleBulkDelete}
              className="dhud-btn dhud-btn-danger"
              disabled={selectedCount === 0}
            >
              Löschen
            </button>
            <button onClick={exitSelectMode} className="dhud-btn dhud-btn-outline ml-auto">
              Fertig
            </button>

            {showBulkPalette && (
              <div className="w-full pt-2">
                <div className="grid grid-cols-9 gap-1.5 max-w-xs">
                  {HUD_COLOR_ORDER.map((c) => (
                    <button
                      key={c}
                      title={c}
                      aria-label={c}
                      onClick={() => handleBulkColor(c)}
                      className="h-7 w-7 rounded-full border border-white/20"
                      style={{ background: hudColor(c), boxShadow: `0 0 6px ${hudColor(c)}` }}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Speicher-/Upload-/Download-Ring */}
        <div className="mb-8 -mt-4">
          <StorageRing
            uid={uid}
            activity={
              uploadPct !== null
                ? { type: "upload", pct: uploadPct }
                : downloadPct !== null
                ? { type: "download", pct: downloadPct }
                : null
            }
          />
        </div>

        {/* Grid */}
        {!authReady ? (
          <div className="text-cyan-300/40 text-sm">Initialisiere…</div>
        ) : !uid ? (
          <div className="text-cyan-300/40 text-sm">Bitte einloggen, um Inhalte zu sehen.</div>
        ) : loadingFolders || loadingDocs ? (
          <div className="text-cyan-300/40 text-sm">Lade…</div>
        ) : folders.length + docs.length === 0 ? (
          <div className="text-cyan-300/30 text-sm">
            — Noch nichts hier. Lege oben Ordner oder Dokumente an. —
          </div>
        ) : (
          <div className="grid gap-6 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {items.map((it, idx) =>
              it.kind === "folder" ? (
                <div key={`f-${it.folder.id}-${idx}`} className="flex flex-col items-stretch gap-2">
                  <div
                    className="relative"
                    draggable={!selectMode}
                    onDragStart={(e) => handleTileDragStart(e, { kind: "folder", id: it.folder.id, name: it.folder.name })}
                    onDragOver={(e) => handleFolderDragOver(e, it.folder.id)}
                    onDragLeave={() => handleFolderDragLeave(it.folder.id)}
                    onDrop={(e) => handleFolderDropTarget(e, it.folder)}
                  >
                    <FolderTile
                      href={`/dokumente/${encodeURIComponent(it.folder.slug)}`}
                      name={it.folder.name}
                      color={it.folder.color ?? "blue"}
                    />
                    {dragOverFolderId === it.folder.id && (
                      <div
                        className="absolute inset-0 z-30 rounded-xl border-2 border-dashed pointer-events-none"
                        style={{ borderColor: "#22d3ee", boxShadow: "0 0 20px rgba(34,211,238,0.5)" }}
                      />
                    )}
                    {selectMode && (
                      <SelectionOverlay
                        selected={selectedFolderIds.has(it.folder.id)}
                        onToggle={() => toggleFolderSelected(it.folder.id)}
                      />
                    )}
                  </div>
                  {!selectMode && (
                    <ItemNameMenu
                      name={it.folder.name}
                      color={it.folder.color ?? "blue"}
                      onRename={() => handleRenameFolder(it.folder.id)}
                      onDelete={() => handleDeleteFolder(it.folder)}
                      onColor={(c) => handleColorFolder(it.folder.id, c)}
                      onDownload={() => handleDownloadFolder(it.folder)}
                      onMove={() => setMovingItem({ kind: "folder", id: it.folder.id, name: it.folder.name })}
                    />
                  )}
                </div>
              ) : (
                <div key={`d-${it.doc.id}-${idx}`} className="flex flex-col items-stretch gap-2">
                  <div
                    className="relative"
                    draggable={!selectMode}
                    onDragStart={(e) => handleTileDragStart(e, { kind: "doc", id: it.doc.id, name: it.doc.name })}
                  >
                    <DocumentTile
                      doc={it.doc}
                      showPreview={showPreview}
                      onOpenPreview={() => {
                        const idx = imageDocs.findIndex((x) => x.id === it.doc.id);
                        if (idx >= 0) setLightboxIndex(idx);
                      }}
                    />
                    {selectMode && (
                      <SelectionOverlay
                        selected={selectedDocIds.has(it.doc.id)}
                        onToggle={() => toggleDocSelected(it.doc.id)}
                      />
                    )}
                  </div>
                  {!selectMode && (
                    <ItemNameMenu
                      name={it.doc.name}
                      color={it.doc.color ?? "blue"}
                      onRename={() => handleRenameDoc(it.doc.id)}
                      onDelete={() => handleDeleteDoc(it.doc)}
                      onColor={(c) => handleColorDoc(it.doc.id, c)}
                      onDownload={
                        it.doc.docKind === "file" && it.doc.downloadURL
                          ? () => handleDownloadDoc(it.doc)
                          : undefined
                      }
                      onMove={() => setMovingItem({ kind: "doc", id: it.doc.id, name: it.doc.name })}
                    />
                  )}
                </div>
              )
            )}
          </div>
        )}
      </div>

      {lightboxIndex !== null && (
        <ImageLightbox
          images={imageDocs}
          index={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
          onIndexChange={setLightboxIndex}
        />
      )}

      {movingItem && uid && (
        <FolderPickerModal
          uid={uid}
          title={`"${movingItem.name}" verschieben nach…`}
          excludeFullPathSlug={
            movingItem.kind === "folder"
              ? (() => {
                  const f = folders.find((x) => x.id === movingItem.id);
                  if (!f) return undefined;
                  return currentPathSlug ? `${currentPathSlug}/${f.slug}` : f.slug;
                })()
              : undefined
          }
          onClose={() => setMovingItem(null)}
          onSelect={handleMoveSelect}
        />
      )}

      {bulkMoveOpen && uid && (
        <FolderPickerModal
          uid={uid}
          title={`${selectedCount} Element(e) verschieben nach…`}
          onClose={() => setBulkMoveOpen(false)}
          onSelect={handleBulkMoveSelect}
        />
      )}

      <DokumenteHudStyles />
    </div>
  );
}
