"use client";

import Link from "next/link";
import { Folder as FolderIcon, FileText } from "lucide-react";
import { hudColor } from "./hud";
import type { FolderColor } from "./types";

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
        <FolderIcon size={38} strokeWidth={1.5} style={{ color: glow, filter: `drop-shadow(0 0 8px ${glow}aa)` }} />
      </div>
      <span className="sr-only">{name}</span>
    </Link>
  );
}

export function DocumentTile({ href, name, color }: { href: string; name: string; color?: FolderColor }) {
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
        <FileText size={38} strokeWidth={1.5} style={{ color: glow, filter: `drop-shadow(0 0 8px ${glow}aa)` }} />
      </div>
      <span className="sr-only">{name}</span>
    </Link>
  );
}
