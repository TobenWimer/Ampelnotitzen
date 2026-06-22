"use client";

import { useParams } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { useEffect, useId, useMemo, useState } from "react";
import { db, auth } from "@/lib/firebase";
import {
  collection,
  addDoc,
  onSnapshot,
  query,
  where,
  serverTimestamp,
  DocumentData,
  QuerySnapshot,
  getDocs,
  writeBatch,
  doc,
  updateDoc,
  deleteDoc,
} from "firebase/firestore";

/* ======================
   Types
   ====================== */

type FolderColor =
  | "blue"
  | "teal"
  | "green"
  | "yellow"
  | "orange"
  | "red"
  | "pink"
  | "purple"
  | "gray";

type Folder = {
  id: string;
  name: string;
  slug: string;
  color?: FolderColor;
  createdAtClient?: number;
};

type DocItem = {
  id: string;
  name: string;
  color?: FolderColor; // Dokumentfarben gleiches Schema
  createdAtClient: number;
};

type GridItem =
  | { kind: "folder"; createdAtClient: number; folder: Folder }
  | { kind: "doc"; createdAtClient: number; doc: DocItem };

/* ======================
   Page
   ====================== */

export default function AnyDepthFolderPage() {
  // ----- Pfad (Slugs) -----
  const params = useParams() as { path?: string[] };
  const segs: string[] = Array.isArray(params?.path) ? params.path : [];
  const decodedSegs = useMemo(() => segs.map(decodeURIComponent), [segs]);
  const currentPathSlug = useMemo(() => decodedSegs.join("/"), [decodedSegs]);

  const parentHref =
    decodedSegs.length <= 1
      ? "/dokumente"
      : `/dokumente/${decodedSegs
          .slice(0, -1)
          .map(encodeURIComponent)
          .join("/")}`;

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

  // ----- Laden: Unterordner -----
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
          const data = d.data() as any;
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
        console.warn("folders(child) error", err);
        setFolders([]);
        setLoadingFolders(false);
      }
    );

    return () => unsub();
  }, [authReady, uid, currentPathSlug]);

  // ----- Laden: Dokumente in diesem Pfad -----
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
          const data = d.data() as any;
          return {
            id: d.id,
            name: (data.name as string) ?? "Unbenannt",
            color: (data.color as FolderColor) ?? "blue",
            createdAtClient:
              typeof data.createdAtClient === "number" ? data.createdAtClient : 0,
          };
        });
        raw.sort((a, b) => a.createdAtClient - b.createdAtClient);
        setDocs(raw);
        setLoadingDocs(false);
      },
      (err) => {
        console.warn("documents(child) error", err);
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
      .replace(/[\u0300-\u036f]/g, "")
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

  // ----- Anlegen: Unterordner -----
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
      parentPathSlug: currentPathSlug,
      color: "blue",
      uid,
      createdAt: serverTimestamp(),
      createdAtClient: Date.now(),
    });

    setNewFolderName("");
    setIsCreateFolderOpen(false);
  };

  // ----- Anlegen: Dokument in diesem Pfad -----
  const createDocument = async () => {
    const name = newDocName.trim();
    if (!name) return;
    if (!uid) {
      alert("Bitte zuerst einloggen, um Dokumente anzulegen.");
      return;
    }
    await addDoc(collection(db, "documents"), {
      name,
      parentPathSlug: currentPathSlug,
      color: "blue",
      uid,
      createdAt: serverTimestamp(),
      createdAtClient: Date.now(),
    });
    setNewDocName("");
    setIsCreateDocOpen(false);
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
        const childSlug = (d.data() as any).slug as string;
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
  const handleDeleteDoc = async (id: string) => {
    const ok = confirm("Dieses Dokument löschen?");
    if (!ok) return;
    await deleteDoc(doc(db, "documents", id));
  };
  const handleColorDoc = async (id: string, color: FolderColor) => {
    await updateDoc(doc(db, "documents", id), { color });
  };

  // ----- Breadcrumbs -----
  const Breadcrumbs = (
    <nav className="text-sm text-gray-800">
      <ol className="flex items-center gap-2">
        <li>
          <Link href="/dokumente" className="hover:underline">
            Dokumente
          </Link>
        </li>
        {decodedSegs.map((seg, i) => {
          const isLast = i === decodedSegs.length - 1;
          const href = `/dokumente/${decodedSegs
            .slice(0, i + 1)
            .map(encodeURIComponent)
            .join("/")}`;
          return (
            <li key={`${seg}-${i}`} className="flex items-center gap-2">
              <span className="text-gray-400">/</span>
              {isLast ? (
                <span className="font-semibold text-gray-900">{seg}</span>
              ) : (
                <Link href={href} className="hover:underline">
                  {seg}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );

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
    <div className="min-h-screen bg-white">
      <div className="p-8 max-w-6xl mx-auto font-sans">
        {/* Header */}
        <Link href="/" className="flex flex-col items-center mb-6 group" title="Home">
          <Image
            src="/logo.png"
            alt="OneStepBehind Logo"
            width={88}
            height={88}
            priority
            className="transition-transform group-hover:scale-105"
          />
          <h1 className="mt-3 text-4xl md:text-5xl font-extrabold text-black tracking-tight">
            OneStepBehind
          </h1>
        </Link>

        {/* Breadcrumbs + Actions */}
        <div className="flex items-center justify-between mb-6">
          {Breadcrumbs}

          <div className="flex items-center gap-2">
            <Link
              href={parentHref}
              className="rounded-xl border border-black/20 px-3 py-2 text-sm
                         bg-gradient-to-br from-gray-200/55 via-white/35 to-gray-100/45
                         text-gray-900 transition shadow-sm"
            >
              Zurück
            </Link>

            {/* Neuer Ordner */}
            {!isCreateFolderOpen ? (
              <button
                onClick={() => setIsCreateFolderOpen(true)}
                className="rounded-xl border border-black/20 px-3 py-2 text-sm
                           bg-gradient-to-br from-gray-200/55 via-white/35 to-gray-100/45 text-gray-900 transition shadow-sm"
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
                  className="px-3 py-2 rounded-xl border border-black/30
                             bg-gradient-to-br from-white/70 via-white/40 to-white/20 backdrop-blur-md
                             text-gray-900 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-black/20"
                />
                <button
                  onClick={createFolder}
                  className="rounded-xl border border-black/20 px-3 py-2 text-sm
                             bg-gradient-to-br from-gray-200/55 via-white/35 to-gray-100/45 text-gray-900 transition shadow-sm"
                >
                  Speichern
                </button>
                <button
                  onClick={() => {
                    setIsCreateFolderOpen(false);
                    setNewFolderName("");
                  }}
                  className="rounded-xl border border-black/20 px-3 py-2 text-sm
                             bg-gradient-to-br from-gray-200/55 via-white/35 to-gray-100/45 text-gray-900 transition shadow-sm"
                >
                  Abbrechen
                </button>
              </div>
            )}

            {/* Neues Dokument */}
            {!isCreateDocOpen ? (
              <button
                onClick={() => setIsCreateDocOpen(true)}
                className="rounded-xl border border-black/20 px-3 py-2 text-sm
                           bg-gradient-to-br from-gray-200/55 via-white/35 to-gray-100/45 text-gray-900 transition shadow-sm"
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
                  className="px-3 py-2 rounded-xl border border-black/30
                             bg-gradient-to-br from-white/70 via-white/40 to-white/20 backdrop-blur-md
                             text-gray-900 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-black/20"
                />
                <button
                  onClick={createDocument}
                  className="rounded-xl border border-black/20 px-3 py-2 text-sm
                             bg-gradient-to-br from-gray-200/55 via-white/35 to-gray-100/45 text-gray-900 transition shadow-sm"
                >
                  Speichern
                </button>
                <button
                  onClick={() => {
                    setIsCreateDocOpen(false);
                    setNewDocName("");
                  }}
                  className="rounded-xl border border-black/20 px-3 py-2 text-sm
                             bg-gradient-to-br from-gray-200/55 via-white/35 to-gray-100/45 text-gray-900 transition shadow-sm"
                >
                  Abbrechen
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Grid */}
        {!authReady ? (
          <div className="text-gray-500">Initialisiere…</div>
        ) : !uid ? (
          <div className="text-gray-500">Bitte einloggen, um Inhalte zu sehen.</div>
        ) : loadingFolders || loadingDocs ? (
          <div className="text-gray-500">Lade…</div>
        ) : items.length === 0 ? (
          <div className="text-gray-500">
            Noch nichts hier. Lege oben Ordner oder Dokumente an.
          </div>
        ) : (
          <div className="grid gap-6 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {items.map((it, idx) =>
              it.kind === "folder" ? (
                <FolderCardChild
                  key={`f-${it.folder.id}-${idx}`}
                  segs={decodedSegs}
                  folder={it.folder}
                  onRename={() => handleRenameFolder(it.folder.id)}
                  onDelete={() => handleDeleteFolder(it.folder)}
                  onColor={(c) => handleColorFolder(it.folder.id, c)}
                />
              ) : (
                <DocumentCardChild
                  key={`d-${it.doc.id}-${idx}`}
                  segs={decodedSegs}
                  doc={it.doc}
                  onRename={() => handleRenameDoc(it.doc.id)}
                  onDelete={() => handleDeleteDoc(it.doc.id)}
                  onColor={(c) => handleColorDoc(it.doc.id, c)}
                />
              )
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ======================
   UI-Bausteine
   ====================== */

function FolderCardChild({
  segs,
  folder,
  onRename,
  onDelete,
  onColor,
}: {
  segs: string[];
  folder: Folder;
  onRename: () => void;
  onDelete: () => void;
  onColor: (c: FolderColor) => void;
}) {
  const nextHref = `/dokumente/${[...segs, folder.slug]
    .map(encodeURIComponent)
    .join("/")}`;
  return (
    <div className="flex flex-col items-stretch">
      <FolderTile
        href={nextHref}
        name={folder.name}
        color={folder.color ?? "blue"}
      />
      <div className="mt-2 relative z-30">
        <FolderNameWithMenu
          name={folder.name}
          color={folder.color ?? "blue"}
          onRename={onRename}
          onDelete={onDelete}
          onColor={onColor}
        />
      </div>
    </div>
  );
}

function DocumentCardChild({
  segs, // ungenutzt für den Link (wir verlinken ABSOLUT!)
  doc,
  onRename,
  onDelete,
  onColor,
}: {
  segs: string[];
  doc: DocItem;
  onRename: () => void;
  onDelete: () => void;
  onColor: (c: FolderColor) => void;
}) {
  // WICHTIG: absoluter Link zur Editor-Route → nie vom Catch-All gefressen
  const href = `/dokumente/doc/${encodeURIComponent(doc.id)}`;
  return (
    <div className="flex flex-col items-stretch">
      <DocumentTile href={href} name={doc.name} color={doc.color ?? "blue"} />
      <div className="mt-2 relative z-30">
        <DocumentNameWithMenu
          name={doc.name}
          color={doc.color ?? "blue"}
          onRename={onRename}
          onDelete={onDelete}
          onColor={onColor}
        />
      </div>
    </div>
  );
}

/* ----- Menüs unter dem Namen (zentriert, klickbar) ----- */

function FolderNameWithMenu({
  name,
  color,
  onRename,
  onDelete,
  onColor,
}: {
  name: string;
  color: FolderColor;
  onRename: () => void;
  onDelete: () => void;
  onColor: (c: FolderColor) => void;
}) {
  const [open, setOpen] = useState(false);
  const [showPalette, setShowPalette] = useState(false);
  const colors: FolderColor[] = [
    "blue",
    "teal",
    "green",
    "yellow",
    "orange",
    "red",
    "pink",
    "purple",
    "gray",
  ];

  return (
    <div className="relative flex justify-center">
      <button
        onClick={() => setOpen((v) => !v)}
        className="px-2 py-1 text-base sm:text-lg font-bold text-gray-900 truncate rounded-md hover:bg-black/5"
        title={name}
      >
        {name}
      </button>

      {open && (
        <div
          role="menu"
          className="absolute top-full mt-2 z-50 min-w-44 rounded-2xl overflow-hidden
                     border border-black/15 shadow-lg
                     bg-gradient-to-br from-gray-100/70 via-white/60 to-gray-50/50 backdrop-blur-md"
        >
          <button
            onClick={() => {
              setOpen(false);
              onRename();
            }}
            className="w-full text-left px-3 py-2 text-sm text-gray-900 hover:bg-white/70"
          >
            Umbenennen
          </button>

          <button
            onClick={() => setShowPalette((v) => !v)}
            className="w-full text-left px-3 py-2 text-sm text-gray-900 hover:bg-white/70"
          >
            Farbe ändern
          </button>

          {showPalette && (
            <div className="px-3 pb-2 pt-1">
              <div className="grid grid-cols-9 gap-1.5">
                {colors.map((c) => (
                  <button
                    key={c}
                    title={c}
                    aria-label={c}
                    onClick={() => {
                      onColor(c);
                      setOpen(false);
                      setShowPalette(false);
                    }}
                    className="h-6 w-6 rounded-full border border-black/20"
                    style={{ background: sampleSwatch(c) }}
                  />
                ))}
              </div>
              <div className="mt-2 text-[11px] text-gray-600">
                Aktuell: <span className="font-medium">{color}</span>
              </div>
            </div>
          )}

          <div className="h-px bg-black/10" />
          <button
            onClick={() => {
              setOpen(false);
              onDelete();
            }}
            className="w-full text-left px-3 py-2 text-sm text-red-600 hover:bg-white/70"
          >
            Löschen
          </button>
        </div>
      )}
    </div>
  );
}

function DocumentNameWithMenu({
  name,
  color,
  onRename,
  onDelete,
  onColor,
}: {
  name: string;
  color: FolderColor;
  onRename: () => void;
  onDelete: () => void;
  onColor: (c: FolderColor) => void;
}) {
  const [open, setOpen] = useState(false);
  const [showPalette, setShowPalette] = useState(false);
  const colors: FolderColor[] = [
    "blue",
    "teal",
    "green",
    "yellow",
    "orange",
    "red",
    "pink",
    "purple",
    "gray",
  ];

  return (
    <div className="relative flex justify-center">
      <button
        onClick={() => setOpen((v) => !v)}
        className="px-2 py-1 text-base sm:text-lg font-bold text-gray-900 truncate rounded-md hover:bg-black/5"
        title={name}
      >
        {name}
      </button>

      {open && (
        <div
          role="menu"
          className="absolute top-full mt-2 z-50 min-w-44 rounded-2xl overflow-hidden
                     border border-black/15 shadow-lg
                     bg-gradient-to-br from-gray-100/70 via-white/60 to-gray-50/50 backdrop-blur-md"
        >
          <button
            onClick={() => {
              setOpen(false);
              onRename();
            }}
            className="w-full text-left px-3 py-2 text-sm text-gray-900 hover:bg-white/70"
          >
            Umbenennen
          </button>

          <button
            onClick={() => setShowPalette((v) => !v)}
            className="w-full text-left px-3 py-2 text-sm text-gray-900 hover:bg-white/70"
          >
            Farbe ändern
          </button>

          {showPalette && (
            <div className="px-3 pb-2 pt-1">
              <div className="grid grid-cols-9 gap-1.5">
                {colors.map((c) => (
                  <button
                    key={c}
                    title={c}
                    aria-label={c}
                    onClick={() => {
                      onColor(c);
                      setOpen(false);
                      setShowPalette(false);
                    }}
                    className="h-6 w-6 rounded-full border border-black/20"
                    style={{ background: sampleSwatch(c) }}
                  />
                ))}
              </div>
              <div className="mt-2 text-[11px] text-gray-600">
                Aktuell: <span className="font-medium">{color}</span>
              </div>
            </div>
          )}

          <div className="h-px bg-black/10" />
          <button
            onClick={() => {
              setOpen(false);
              onDelete();
            }}
            className="w-full text-left px-3 py-2 text-sm text-red-600 hover:bg-white/70"
          >
            Löschen
          </button>
        </div>
      )}
    </div>
  );
}

/* ======================
   Kacheln
   ====================== */

function FolderTile({
  href,
  name,
  color,
}: {
  href: string;
  name: string;
  color: FolderColor;
}) {
  const uid = useId().replace(/:/g, "");
  const D_FRONT = `
    M 360 60
    L 120 60
    C 112 60, 105 62, 100 68
    C 97 72, 96 79, 95 86
    C 94 88, 92 88, 88 88
    L 20 88
    L 20 230
    C 20 262, 40 280, 72 280
    L 328 280
    C 360 280, 380 262, 380 230
    L 380 90
    C 380 68, 372 60, 360 60
    Z
  `;
  const D_BACK = `
    M 360 60
    L 120 60
    C 112 60, 106 58, 102 54
    C 98 50, 95 45, 94 42
    L 92 40
    L 48 40
    C 36 40, 26 50, 22 58
    C 21 60, 20 61, 20 62
    L 20 230
    C 20 262, 40 280, 72 280
    L 328 280
    C 360 280, 380 262, 380 230
    L 380 90
    C 380 68, 372 60, 360 60
    Z
  `;
  const G = gradientFor(color);

  return (
    <Link
      href={href}
      title={name}
      className="group block relative z-0 w-full aspect-[4/3] rounded-[18px] overflow-hidden"
      prefetch={false}
    >
      <svg
        viewBox="0 0 400 300"
        className="absolute inset-0 w-full h-full"
        aria-hidden="true"
        style={{ pointerEvents: "none" }}
      >
        <defs>
          <linearGradient id={`gradBack-${uid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={G.backTop} stopOpacity="0.55" />
            <stop offset="100%" stopColor={G.backBot} stopOpacity="0.45" />
          </linearGradient>
          <linearGradient id={`gradFront-${uid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={G.frontTop} stopOpacity="0.50" />
            <stop offset="100%" stopColor={G.frontBot} stopOpacity="0.42" />
          </linearGradient>
          <linearGradient id={`shade-${uid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#000000" stopOpacity="0" />
            <stop offset="100%" stopColor="#000000" stopOpacity="0.05" />
          </linearGradient>
        </defs>

        {/* BACK */}
        <path d={D_BACK} fill={`url(#gradBack-${uid})`} />
        <path d={D_BACK} fill={`url(#shade-${uid})`} />
        <path
          d={D_BACK}
          fill="none"
          stroke="#565a61ff"
          strokeOpacity="0.34"
          strokeWidth="3"
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {/* FRONT */}
        <path d={D_FRONT} fill={`url(#gradFront-${uid})`} />
        <path d={D_FRONT} fill={`url(#shade-${uid})`} />
        <path
          d={D_FRONT}
          fill="none"
          stroke="#8d92a0"
          strokeOpacity="0.5"
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      </svg>
      <span className="sr-only">{name}</span>
    </Link>
  );
}

function DocumentTile({
  href,
  name,
  color,
}: {
  href: string;
  name: string;
  color: FolderColor;
}) {
  const uid = useId().replace(/:/g, "");
  const GG = gradientFor(color);

  return (
    <Link
      href={href}
      title={name}
      className="group relative z-0 w-full aspect-[6/5] rounded-[14px] overflow-hidden"
      prefetch={false}
    >
      <svg
        viewBox="0 0 400 330"
        className="absolute inset-0 w-full h-full"
        aria-hidden="true"
        style={{ pointerEvents: "none" }}
        shapeRendering="geometricPrecision"
      >
        <defs>
          {/* Clip = Shape des Buchkörpers */}
          <clipPath id={`clip-${uid}`}>
            <path
              d="
                M 100 60
                H 320
                C 336 60 348 76 348 92
                V 240
                C 348 256 336 272 320 272
                H 100
                C 88 272 72 260 72 248
                V 80
                C 72 68 88 60 100 60
                Z
              "
            />
          </clipPath>

          {/* Cover-Verlauf: gleiche Farbwelt wie Ordner */}
          <linearGradient id={`cover-${uid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={GG.frontTop} stopOpacity="0.85" />
            <stop offset="100%" stopColor={GG.frontBot} stopOpacity="0.70" />
          </linearGradient>

          {/* leichte Abdunklung */}
          <linearGradient id={`shade-${uid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#000" stopOpacity="0.00" />
            <stop offset="100%" stopColor="#000" stopOpacity="0.06" />
          </linearGradient>
        </defs>

        {/* Körper im Clip */}
        <g clipPath={`url(#clip-${uid})`}>
          <path
            d="
              M 100 60
              H 320
              C 336 60 348 76 348 92
              V 240
              C 348 256 336 272 320 272
              H 100
              C 88 272 72 260 72 248
              V 80
              C 72 68 88 60 100 60
              Z
            "
            fill={`url(#cover-${uid})`}
          />

          {/* Rücken links (dunkle feine Linie) */}
          <path
            d="M 100 66 L 100 266"
            fill="none"
            stroke="#1E3A8A"
            strokeOpacity="0.7"
            strokeWidth="2"
            strokeLinecap="round"
          />

          {/* Abdunklung */}
          <path
            d="
              M 100 60
              H 320
              C 336 60 348 76 348 92
              V 240
              C 348 256 336 272 320 272
              H 100
              C 88 272 72 260 72 248
              V 80
              C 72 68 88 60 100 60
              Z
            "
            fill={`url(#shade-${uid})`}
          />
        </g>

        {/* Outline direkt am Shape – keine überstehenden Linien */}
        <path
          d="
            M 100 60
            H 320
            C 336 60 348 76 348 92
            V 240
            C 348 256 336 272 320 272
            H 100
            C 88 272 72 260 72 248
            V 80
            C 72 68 88 60 100 60
            Z
          "
          fill="none"
          stroke="#6B7280"
          strokeOpacity="0.55"
          strokeWidth="1"
          strokeLinejoin="round"
        />
      </svg>

      <span className="sr-only">{name}</span>
    </Link>
  );
}

/* -------- Farb-Helfer -------- */
type GSpec = {
  backTop: string;
  backBot: string;
  frontTop: string;
  frontBot: string;
};
function gradientFor(color: FolderColor): GSpec {
  switch (color) {
    case "teal":
      return {
        backTop: "#10BFAF",
        backBot: "#8BF3E6",
        frontTop: "#0FB4A7",
        frontBot: "#A6FFF3",
      };
    case "green":
      return {
        backTop: "#22C55E",
        backBot: "#BEECD0",
        frontTop: "#1FB155",
        frontBot: "#D4F7E0",
      };
    case "yellow":
      return {
        backTop: "#F7C23A",
        backBot: "#FFF4B8",
        frontTop: "#F5B51E",
        frontBot: "#FFF3CC",
      };
    case "orange":
      return {
        backTop: "#FF8A3D",
        backBot: "#FFE0C7",
        frontTop: "#FF7A1F",
        frontBot: "#FFE7D6",
      };
    case "red":
      return {
        backTop: "#F75C5C",
        backBot: "#FFD7D7",
        frontTop: "#EF4343",
        frontBot: "#FFE2E2",
      };
    case "pink":
      return {
        backTop: "#F472B6",
        backBot: "#FDE7F4",
        frontTop: "#EC5AA8",
        frontBot: "#FEE7F7",
      };
    case "purple":
      return {
        backTop: "#A78BFA",
        backBot: "#ECE7FF",
        frontTop: "#8B6CFB",
        frontBot: "#F0ECFF",
      };
    case "gray":
      return {
        backTop: "#AEB6C2",
        backBot: "#EEF1F5",
        frontTop: "#9FA7B4",
        frontBot: "#F4F6F9",
      };
    case "blue":
    default:
      return {
        backTop: "#4DA3FF",
        backBot: "#E0F0FF",
        frontTop: "#3886F6",
        frontBot: "#E6F3FF",
      };
  }
}
function sampleSwatch(color: FolderColor) {
  return gradientFor(color).frontTop;
}
