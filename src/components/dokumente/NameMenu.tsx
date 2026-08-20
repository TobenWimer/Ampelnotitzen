"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { hudColor, HUD_COLOR_ORDER } from "./hud";
import type { FolderColor } from "./types";

// Ordner und Dokument hatten vorher zwei fast identische Menu-Komponenten, hier vereint
export function ItemNameMenu({
  name,
  color,
  onRename,
  onDelete,
  onColor,
  onDownload,
  onMove,
}: {
  name: string;
  color?: FolderColor;
  onRename: () => void;
  onDelete: () => void;
  onColor: (c: FolderColor) => void;
  onDownload?: () => void;
  onMove?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [showPalette, setShowPalette] = useState(false);
  const [align, setAlign] = useState<"left" | "right">("left");
  const [vAlign, setVAlign] = useState<"down" | "up">("down");
  const rootRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onOutside = (e: Event) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
        setShowPalette(false);
      }
    };
    document.addEventListener("mousedown", onOutside);
    document.addEventListener("touchstart", onOutside);
    return () => {
      document.removeEventListener("mousedown", onOutside);
      document.removeEventListener("touchstart", onOutside);
    };
  }, [open]);

  // Verhindert, dass das Menu aus dem sichtbaren Bereich rausrutscht (rechts UND
  // unten, das Zweite war der eigentliche vom Handy gemeldete Fall): nach dem
  // Aufklappen (und bei Groessenaenderung durch die Farbpalette) die tatsaechliche
  // Position messen statt sie blind anzunehmen. useLayoutEffect statt useEffect,
  // damit die Korrektur vor dem ersten sichtbaren Frame passiert und nicht erst
  // kurz an der falschen Stelle aufblitzt.
  useLayoutEffect(() => {
    if (!open) {
      setAlign("left");
      setVAlign("down");
      return;
    }
    const check = () => {
      const el = menuRef.current;
      const btn = rootRef.current;
      if (!el || !btn) return;
      const rect = el.getBoundingClientRect();
      const btnRect = btn.getBoundingClientRect();
      const margin = 8;
      setAlign(rect.right > window.innerWidth - margin ? "right" : "left");
      // Nur nach oben klappen, wenn oben tatsaechlich mehr Platz ist, sonst
      // wuerde ein Button nahe am oberen Rand das Menu dort ebenso abschneiden.
      const overflowsBelow = rect.bottom > window.innerHeight - margin;
      const roomAbove = btnRect.top;
      const roomBelow = window.innerHeight - btnRect.bottom;
      setVAlign(overflowsBelow && roomAbove > roomBelow ? "up" : "down");
    };
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, [open, showPalette]);

  return (
    <div ref={rootRef} className="relative flex justify-center">
      <button onClick={() => setOpen((v) => !v)} className="dhud-name-btn" title={name}>
        {name}
      </button>

      {open && (
        <div
          ref={menuRef}
          role="menu"
          className={`dhud-menu absolute z-50 min-w-44 rounded-xl overflow-y-auto overflow-x-hidden max-h-[min(70vh,26rem)] ${
            align === "right" ? "right-0" : "left-0"
          } ${vAlign === "up" ? "bottom-full mb-2" : "top-full mt-2"}`}
        >
          {onDownload && (
            <button
              onClick={() => { setOpen(false); onDownload(); }}
              className="dhud-menu-item"
            >
              Herunterladen
            </button>
          )}

          <button
            onClick={() => { setOpen(false); onRename(); }}
            className="dhud-menu-item"
          >
            Umbenennen
          </button>

          {onMove && (
            <button
              onClick={() => { setOpen(false); onMove(); }}
              className="dhud-menu-item"
            >
              Verschieben
            </button>
          )}

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
