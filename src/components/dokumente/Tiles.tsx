"use client";

import Link from "next/link";
import { Folder as FolderIcon, FileText, Image as ImageIcon, File as FileIcon } from "lucide-react";
import { hudColor } from "./hud";
import type { DocItem, FolderColor } from "./types";

function Corners() {
  return (
    <>
      <span className="dhud-corner dhud-corner-tl" />
      <span className="dhud-corner dhud-corner-tr" />
      <span className="dhud-corner dhud-corner-bl" />
      <span className="dhud-corner dhud-corner-br" />
    </>
  );
}

// Dateiendung aus dem Namen, z.B. "Vertrag.pdf" -> "PDF"
function fileExt(name: string) {
  const m = name.match(/\.([a-zA-Z0-9]+)$/);
  return m ? m[1].toUpperCase() : null;
}

export function FolderTile({ href, name, color }: { href: string; name: string; color?: FolderColor }) {
  const glow = hudColor(color);
  return (
    <Link
      href={href}
      title={name}
      prefetch={false}
      className="dhud-tile group relative block w-full aspect-[4/3] rounded-xl overflow-hidden"
      style={{ "--glow": glow } as React.CSSProperties}
    >
      <Corners />
      <div className="relative z-10 h-full flex items-center justify-center">
        <FolderIcon size={54} strokeWidth={1.4} style={{ color: glow, filter: `drop-shadow(0 0 10px ${glow}aa)` }} />
      </div>
      <span className="sr-only">{name}</span>
    </Link>
  );
}

// Zeigt gezeichnete Dokumente (führt in den Editor) und hochgeladene Dateien
// (öffnet/lädt die Datei direkt) mit passendem Icon in derselben Kachel-Optik
export function DocumentTile({ doc }: { doc: DocItem }) {
  const glow = hudColor(doc.color);
  const isFile = doc.docKind === "file";
  const Icon = isFile ? (doc.mimeType?.startsWith("image/") ? ImageIcon : FileIcon) : FileText;
  const ext = isFile ? fileExt(doc.name) : null;

  const inner = (
    <>
      <Corners />
      <div className="relative z-10 h-full flex flex-col items-center justify-center gap-1.5">
        <Icon size={54} strokeWidth={1.4} style={{ color: glow, filter: `drop-shadow(0 0 10px ${glow}aa)` }} />
        {ext && (
          <span
            className="text-[9px] font-bold tracking-widest px-1.5 py-0.5 rounded"
            style={{ color: glow, border: `1px solid ${glow}66`, background: `${glow}1a` }}
          >
            {ext}
          </span>
        )}
      </div>
      <span className="sr-only">{doc.name}</span>
    </>
  );

  const className = "dhud-tile group relative block w-full aspect-[4/3] rounded-xl overflow-hidden";
  const style = { "--glow": glow } as React.CSSProperties;

  if (isFile) {
    return (
      <a href={doc.downloadURL} target="_blank" rel="noopener noreferrer" title={doc.name} className={className} style={style}>
        {inner}
      </a>
    );
  }
  return (
    <Link href={`/dokumente/doc/${encodeURIComponent(doc.id)}`} prefetch={false} title={doc.name} className={className} style={style}>
      {inner}
    </Link>
  );
}
