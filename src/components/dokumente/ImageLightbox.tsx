"use client";

import { useEffect } from "react";
import { X, ChevronLeft, ChevronRight } from "lucide-react";
import type { DocItem } from "./types";

// Vollbild-Bildbetrachter: oeffnet sich beim Klick auf eine Bild-Kachel
// (nur wenn Vorschau an ist), erlaubt Durchblaettern aller Bilder im Ordner
// per Pfeil-Buttons oder Tastatur (Links/Rechts/Escape)
export function ImageLightbox({
  images,
  index,
  onClose,
  onIndexChange,
}: {
  images: DocItem[];
  index: number;
  onClose: () => void;
  onIndexChange: (i: number) => void;
}) {
  const current = images[index];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft") onIndexChange((index - 1 + images.length) % images.length);
      if (e.key === "ArrowRight") onIndexChange((index + 1) % images.length);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, images.length, onClose, onIndexChange]);

  if (!current) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 backdrop-blur-sm font-mono"
      onClick={onClose}
    >
      <button
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        className="absolute top-5 right-5 z-10 h-10 w-10 flex items-center justify-center rounded-full border border-cyan-400/40 text-cyan-300 hover:bg-cyan-400/10 hover:border-cyan-300 transition"
        title="Schließen"
      >
        <X size={18} />
      </button>

      {images.length > 1 && (
        <>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onIndexChange((index - 1 + images.length) % images.length);
            }}
            className="absolute left-3 md:left-6 z-10 h-11 w-11 flex items-center justify-center rounded-full border border-cyan-400/40 text-cyan-300 hover:bg-cyan-400/10 hover:border-cyan-300 transition"
            title="Vorheriges Bild"
          >
            <ChevronLeft size={22} />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onIndexChange((index + 1) % images.length);
            }}
            className="absolute right-3 md:right-6 z-10 h-11 w-11 flex items-center justify-center rounded-full border border-cyan-400/40 text-cyan-300 hover:bg-cyan-400/10 hover:border-cyan-300 transition"
            title="Nächstes Bild"
          >
            <ChevronRight size={22} />
          </button>
        </>
      )}

      <div
        className="relative max-w-[92vw] max-h-[82vh] rounded-xl overflow-hidden border border-cyan-400/30 shadow-[0_0_40px_rgba(34,211,238,0.25)]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={current.downloadURL}
          alt={current.name}
          className="block max-w-[92vw] max-h-[82vh] object-contain"
        />
      </div>

      <div className="absolute bottom-5 left-1/2 -translate-x-1/2 text-center px-4">
        <div className="text-cyan-100 text-sm font-medium truncate max-w-[80vw]">{current.name}</div>
        {images.length > 1 && (
          <div className="text-cyan-400/60 text-[11px] tracking-widest uppercase mt-1">
            {index + 1} / {images.length}
          </div>
        )}
      </div>
    </div>
  );
}
