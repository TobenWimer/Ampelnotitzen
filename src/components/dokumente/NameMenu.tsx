"use client";

import { useState } from "react";
import { hudColor, HUD_COLOR_ORDER } from "./hud";
import type { FolderColor } from "./types";

// Ordner und Dokument hatten vorher zwei fast identische Menu-Komponenten, hier vereint
export function ItemNameMenu({
  name,
  color,
  onRename,
  onDelete,
  onColor,
}: {
  name: string;
  color?: FolderColor;
  onRename: () => void;
  onDelete: () => void;
  onColor: (c: FolderColor) => void;
}) {
  const [open, setOpen] = useState(false);
  const [showPalette, setShowPalette] = useState(false);

  return (
    <div className="relative flex justify-center">
      <button onClick={() => setOpen((v) => !v)} className="dhud-name-btn" title={name}>
        {name}
      </button>

      {open && (
        <div role="menu" className="dhud-menu absolute top-full mt-2 z-50 min-w-44 rounded-xl overflow-hidden">
          <button
            onClick={() => { setOpen(false); onRename(); }}
            className="dhud-menu-item"
          >
            Umbenennen
          </button>

          <button
            onClick={() => setShowPalette((v) => !v)}
            className="dhud-menu-item"
          >
            Farbe ändern
          </button>

          {showPalette && (
            <div className="px-3 pb-2 pt-1">
              <div className="grid grid-cols-9 gap-1.5">
                {HUD_COLOR_ORDER.map((c) => (
                  <button
                    key={c}
                    title={c}
                    aria-label={c}
                    onClick={() => { onColor(c); setOpen(false); setShowPalette(false); }}
                    className="h-6 w-6 rounded-full border border-white/20"
                    style={{ background: hudColor(c), boxShadow: `0 0 6px ${hudColor(c)}` }}
                  />
                ))}
              </div>
              <div className="mt-2 text-[10px] text-cyan-300/50">
                Aktuell: <span className="font-medium text-cyan-200">{color ?? "blue"}</span>
              </div>
            </div>
          )}

          <div className="dhud-menu-divider" />
          <button
            onClick={() => { setOpen(false); onDelete(); }}
            className="dhud-menu-item dhud-menu-item-danger"
          >
            Löschen
          </button>
        </div>
      )}
    </div>
  );
}
