"use client";

import { useEffect, useRef, useState } from "react";
import { X, ChevronLeft, ChevronRight, Download, Loader2 } from "lucide-react";

export type LightboxImage = { id: string; name: string; url: string };

// Vollbild-Bildbetrachter. Blaettern per Pfeil-Buttons, Tastatur (Links/Rechts/Escape)
// und Wischen. Wird von der Gate-Empfangsseite und dem Dokumente-Modul genutzt,
// damit es nicht zwei fast gleiche Varianten gibt.
export function MediaLightbox({
  images,
  index,
  onClose,
  onIndexChange,
  onDownload,
}: {
  images: LightboxImage[];
  index: number;
  onClose: () => void;
  onIndexChange: (i: number) => void;
  /** Optional: zeigt einen Herunterladen-Knopf neben dem Schliessen-X */
  onDownload?: (image: LightboxImage) => Promise<void> | void;
}) {
  const current = images[index];
  const [busy, setBusy] = useState(false);
  const touchStartX = useRef<number | null>(null);

  const go = (delta: number) => onIndexChange((index + delta + images.length) % images.length);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft") go(-1);
      if (e.key === "ArrowRight") go(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, images.length, onClose]);

  if (!current) return null;

  const handleDownload = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!onDownload || busy) return;
    setBusy(true);
    try {
      await onDownload(current);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 backdrop-blur-sm font-mono"
      onClick={onClose}
      onTouchStart={(e) => {
        touchStartX.current = e.touches[0]?.clientX ?? null;
      }}
      onTouchEnd={(e) => {
        const start = touchStartX.current;
        touchStartX.current = null;
        if (start === null || images.length < 2) return;
        const delta = (e.changedTouches[0]?.clientX ?? start) - start;
        // Schwelle, damit ein Tippen nicht versehentlich weiterblaettert
        if (Math.abs(delta) > 50) go(delta < 0 ? 1 : -1);
      }}
    >
      <div className="absolute top-5 right-5 z-10 flex items-center gap-2">
        {onDownload && (
          <button
            onClick={handleDownload}
            disabled={busy}
            className="h-10 w-10 flex items-center justify-center rounded-full border border-emerald-400/40 text-emerald-300 hover:bg-emerald-400/10 hover:border-emerald-300 transition disabled:opacity-40"
            title="Bild herunterladen"
            aria-label="Bild herunterladen"
          >
            {busy ? <Loader2 size={18} className="animate-spin" /> : <Download size={18} />}
          </button>
        )}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          className="h-10 w-10 flex items-center justify-center rounded-full border border-cyan-400/40 text-cyan-300 hover:bg-cyan-400/10 hover:border-cyan-300 transition"
          title="Schließen"
          aria-label="Schließen"
        >
          <X size={18} />
        </button>
      </div>

      {images.length > 1 && (
        <>
          <button
            onClick={(e) => {
              e.stopPropagation();
              go(-1);
            }}
            className="absolute left-3 md:left-6 z-10 h-11 w-11 flex items-center justify-center rounded-full border border-cyan-400/40 text-cyan-300 hover:bg-cyan-400/10 hover:border-cyan-300 transition"
            title="Vorheriges Bild"
            aria-label="Vorheriges Bild"
          >
            <ChevronLeft size={22} />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              go(1);
            }}
            className="absolute right-3 md:right-6 z-10 h-11 w-11 flex items-center justify-center rounded-full border border-cyan-400/40 text-cyan-300 hover:bg-cyan-400/10 hover:border-cyan-300 transition"
            title="Nächstes Bild"
            aria-label="Nächstes Bild"
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
          src={current.url}
          alt={current.name}
          draggable={false}
          className="block max-w-[92vw] max-h-[82vh] object-contain select-none"
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
