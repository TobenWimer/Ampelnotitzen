"use client";

import { useEffect, useState } from "react";
import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { Folder as FolderIcon, ChevronRight, X } from "lucide-react";
import { hudColor } from "./hud";
import type { Folder, FolderColor } from "./types";

// Klick-Navigations-Dialog zum Auswaehlen eines Zielordners (fuer "Verschieben").
// excludeFullPathSlug: beim Verschieben eines Ordners darf man nicht in ihn selbst
// oder einen seiner Unterordner navigieren (Zyklus) -> wird aus der Liste gefiltert
export function FolderPickerModal({
  uid,
  title,
  excludeFullPathSlug,
  onSelect,
  onClose,
}: {
  uid: string;
  title: string;
  excludeFullPathSlug?: string;
  onSelect: (targetPathSlug: string) => void;
  onClose: () => void;
}) {
  const [navPath, setNavPath] = useState("");
  const [folders, setFolders] = useState<Folder[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      const snap = await getDocs(
        query(collection(db, "folders"), where("parentPathSlug", "==", navPath), where("uid", "==", uid))
      );
      if (cancelled) return;
      const raw = snap.docs
        .map((d) => {
          const data = d.data();
          return {
            id: d.id,
            name: (data.name as string) ?? "Unbenannt",
            slug: (data.slug as string) ?? d.id,
            color: (data.color as FolderColor) ?? "blue",
          } as Folder;
        })
        .filter((f) => {
          const fullPath = navPath ? `${navPath}/${f.slug}` : f.slug;
          return fullPath !== excludeFullPathSlug;
        });
      raw.sort((a, b) => a.name.localeCompare(b.name));
      setFolders(raw);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [navPath, uid, excludeFullPathSlug]);

  const segs = navPath ? navPath.split("/") : [];

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm font-mono p-4"
      onClick={onClose}
    >
      <div className="dhud-menu w-full max-w-md rounded-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-cyan-400/15">
          <span className="text-xs tracking-widest uppercase text-cyan-200 truncate">{title}</span>
          <button onClick={onClose} className="text-cyan-300/60 hover:text-cyan-200 transition shrink-0 ml-2">
            <X size={16} />
          </button>
        </div>

        <div className="px-4 py-2 text-[11px] text-cyan-300/50 flex items-center gap-1 flex-wrap border-b border-cyan-400/10">
          <button onClick={() => setNavPath("")} className="hover:text-cyan-200 transition uppercase">
            Dokumente
          </button>
          {segs.map((seg, i) => (
            <span key={i} className="flex items-center gap-1">
              <span className="text-cyan-400/30">/</span>
              <button
                onClick={() => setNavPath(segs.slice(0, i + 1).join("/"))}
                className="hover:text-cyan-200 transition"
              >
                {seg}
              </button>
            </span>
          ))}
        </div>

        <div className="max-h-72 overflow-y-auto">
          {loading ? (
            <div className="px-4 py-6 text-center text-xs text-cyan-300/40">Lade…</div>
          ) : folders.length === 0 ? (
            <div className="px-4 py-6 text-center text-xs text-cyan-300/30">— keine Unterordner —</div>
          ) : (
            folders.map((f) => (
              <button
                key={f.id}
                onClick={() => setNavPath(navPath ? `${navPath}/${f.slug}` : f.slug)}
                className="dhud-menu-item w-full flex items-center justify-between gap-2"
              >
                <span className="flex items-center gap-2 truncate">
                  <FolderIcon size={14} style={{ color: hudColor(f.color) }} />
                  <span className="truncate">{f.name}</span>
                </span>
                <ChevronRight size={14} className="text-cyan-400/30 shrink-0" />
              </button>
            ))
          )}
        </div>

        <div className="px-4 py-3 border-t border-cyan-400/15">
          <button onClick={() => onSelect(navPath)} className="dhud-btn dhud-btn-primary w-full">
            Hierher verschieben
          </button>
        </div>
      </div>
    </div>
  );
}
