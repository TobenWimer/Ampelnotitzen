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
// (öffnet/lädt die Datei direkt) mit passendem Icon in derselben Kachel-Optik.
// showPreview: zeigt bei Bildern eine echte Thumbnail-Vorschau statt des Icons.
// onOpenPreview: bei aktiver Vorschau oeffnet ein Klick auf ein Bild die Lightbox
// statt eines neuen Tabs (Navigation wird per preventDefault unterdrueckt)
export function DocumentTile({
  doc,
  showPreview,
  onOpenPreview,
}: {
  doc: DocItem;
  showPreview?: boolean;
  onOpenPreview?: () => void;
}) {
  const glow = hudColor(doc.color);
  const isFile = doc.docKind === "file";
  const isImage = isFile && !!doc.mimeType?.startsWith("image/");
  // PDFs zeigt der Browser beim direkten Link inline an, alles andere (Word, Excel,
  // Zip, ...) kennt er nicht und laedt es beim Klick sofort ungefragt herunter statt
  // es zu oeffnen. Fuer diese Typen bleibt die Kachel deshalb bewusst nicht klickbar,
  // "Herunterladen" im Menuepunkt darunter macht das kontrolliert.
  const isPdf = isFile && doc.mimeType === "application/pdf";
  const canOpenDirectly = isImage || isPdf;
  const Icon = isFile ? (isImage ? ImageIcon : FileIcon) : FileText;
  const ext = isFile ? fileExt(doc.name) : null;

  const inner = (
    <>
      <Corners />
      {isImage && showPreview && doc.downloadURL ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={doc.downloadURL}
          alt={doc.name}
          loading="lazy"
          className="relative z-10 h-full w-full object-cover"
        />
      ) : (
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
      )}
      <span className="sr-only">{doc.name}</span>
    </>
  );

  const className = "dhud-tile group relative block w-full aspect-[4/3] rounded-xl overflow-hidden";
  const style = { "--glow": glow } as React.CSSProperties;

  if (isFile) {
    const useLightbox = isImage && showPreview && !!onOpenPreview;

    if (!canOpenDirectly) {
      return (
        <div title={doc.name} className={className} style={style}>
          {inner}
        </div>
      );
    }

    return (
      <a
        href={doc.downloadURL}
        target="_blank"
        rel="noopener noreferrer"
        title={doc.name}
        className={className}
        style={style}
        onClick={
          useLightbox
            ? (e) => {
                e.preventDefault();
                onOpenPreview!();
              }
            : undefined
        }
      >
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
