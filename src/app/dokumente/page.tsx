"use client";

import Link from "next/link";
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
import { uploadDocumentFile, deleteDocumentFile, downloadDocumentFile } from "@/components/dokumente/upload";
import StorageRing from "@/components/dokumente/StorageRing";

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

  // ----- Datei hochladen -----
  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // erlaubt erneutes Auswählen derselben Datei
    if (!file || !uid) return;
    setUploadPct(0);
    try {
      await uploadDocumentFile({ file, uid, parentPathSlug: currentPathSlug, onProgress: setUploadPct });
    } catch (err) {
      console.error("Upload fehlgeschlagen:", err);
      alert("Datei-Upload fehlgeschlagen.");
    } finally {
      setUploadPct(null);
    }
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

  return (
    <div className="min-h-screen dhud-bg text-cyan-50 relative overflow-hidden font-mono">
      <div className="dhud-grid pointer-events-none absolute inset-0" />

      <div className="relative z-10 p-6 md:p-8 max-w-6xl mx-auto">
        {/* Header */}
        <header className="flex items-center justify-between mb-8 pb-4 border-b border-cyan-400/20">
          <Link href="/" className="text-xs tracking-widest text-cyan-400/70 hover:text-cyan-300 transition uppercase">
            ← Home
          </Link>
          <span className="flex items-center gap-1.5 text-[10px] tracking-[0.2em] text-cyan-400/70 uppercase">
            <span className="dhud-dot h-1.5 w-1.5 rounded-full bg-cyan-400" />
            Sync aktiv
          </span>
        </header>

        {/* Titel + Actions */}
        <div className="flex items-center justify-between mb-8 flex-wrap gap-3">
          <h1 className="dhud-title text-lg font-bold text-cyan-100 uppercase">Dokumente</h1>

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

            {/* Datei hochladen */}
            <input ref={fileInputRef} type="file" onChange={handleFileSelected} className="hidden" />
            <button
              onClick={() => fileInputRef.current?.click()}
              className="dhud-btn dhud-btn-outline"
              disabled={!uid || uploadPct !== null}
            >
              {uploadPct !== null ? `Lädt hoch… ${uploadPct}%` : "Datei hochladen"}
            </button>
          </div>
        </div>

        {/* Speicher-/Upload-Ring */}
        <div className="mb-8 -mt-4">
          <StorageRing uid={uid} uploadPct={uploadPct} />
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
                  <FolderTile
                    href={`/dokumente/${encodeURIComponent(it.folder.slug)}`}
                    name={it.folder.name}
                    color={it.folder.color ?? "blue"}
                  />
                  <ItemNameMenu
                    name={it.folder.name}
                    color={it.folder.color ?? "blue"}
                    onRename={() => handleRenameFolder(it.folder.id)}
                    onDelete={() => handleDeleteFolder(it.folder)}
                    onColor={(c) => handleColorFolder(it.folder.id, c)}
                  />
                </div>
              ) : (
                <div key={`d-${it.doc.id}-${idx}`} className="flex flex-col items-stretch gap-2">
                  <DocumentTile doc={it.doc} />
                  <ItemNameMenu
                    name={it.doc.name}
                    color={it.doc.color ?? "blue"}
                    onRename={() => handleRenameDoc(it.doc.id)}
                    onDelete={() => handleDeleteDoc(it.doc)}
                    onColor={(c) => handleColorDoc(it.doc.id, c)}
                    onDownload={
                      it.doc.docKind === "file" && it.doc.downloadURL
                        ? () => downloadDocumentFile(it.doc.downloadURL!, it.doc.name)
                        : undefined
                    }
                  />
                </div>
              )
            )}
          </div>
        )}
      </div>

      <DokumenteHudStyles />
    </div>
  );
}
