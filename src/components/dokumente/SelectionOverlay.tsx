"use client";

import { Check } from "lucide-react";

// Deckt die Kachel im Auswahl-Modus ab: Klick markiert/entmarkiert statt zu
// navigieren (die Link/<a>-Kachel liegt dahinter und bekommt so nie den Klick)
export function SelectionOverlay({ selected, onToggle }: { selected: boolean; onToggle: () => void }) {
  const glow = "#e879f9"; // Fuchsia - eigener Auswahl-Akzent, unterscheidet sich von Upload/Download/Speicher/Vorschau

  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onToggle();
      }}
      className="absolute inset-0 z-20 rounded-xl transition"
      style={{
        background: selected ? `${glow}22` : "transparent",
        border: selected ? `2px solid ${glow}` : "2px solid transparent",
        boxShadow: selected ? `0 0 16px ${glow}66, inset 0 0 12px ${glow}33` : "none",
      }}
      aria-pressed={selected}
      title={selected ? "Auswahl entfernen" : "Auswählen"}
    >
      <span
        className="absolute top-2 left-2 h-5 w-5 rounded-full border-2 flex items-center justify-center"
        style={{
          borderColor: selected ? glow : "rgba(255,255,255,0.5)",
          background: selected ? glow : "rgba(0,0,0,0.45)",
        }}
      >
        {selected && <Check size={12} className="text-black" strokeWidth={3} />}
      </span>
    </button>
  );
}
