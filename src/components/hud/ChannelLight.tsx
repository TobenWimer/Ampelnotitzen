"use client";

import { useEffect, useState } from "react";
import { subscribeChannel, type ChannelState } from "@/lib/transferChannel";

// Statusleuchte fuer die Uebertragungsstrecke. Gruen = frei, violett/gruen blinkend =
// belegt. Zeigt die Vorgaenge aller Tabs desselben Browsers, also genau die, die sich
// gegenseitig Bandbreite wegnehmen.
export function ChannelLight({ className = "" }: { className?: string }) {
  const [state, setState] = useState<ChannelState>({ busy: false, uploads: 0, downloads: 0, labels: [] });

  useEffect(() => subscribeChannel(setState), []);

  // Upload violett, Download gruen - gleiche Bedeutung wie ueberall sonst in der App.
  // Laufen beide, gewinnt der Upload, weil er den knapperen Uplink belegt
  const color = !state.busy ? "#4ade80" : state.uploads > 0 ? "#a78bfa" : "#4ade80";
  const total = state.uploads + state.downloads;

  const text = !state.busy
    ? "Kanal frei"
    : total === 1
    ? `Kanal belegt · ${state.labels[0]}`
    : `Kanal belegt · ${total} Vorgänge`;

  return (
    <span
      className={`inline-flex items-center gap-1.5 text-[10px] tracking-[0.2em] uppercase ${className}`}
      style={{ color: state.busy ? color : "rgba(165,243,252,0.55)" }}
      title={state.busy ? state.labels.join(", ") : "Keine Übertragung aktiv"}
    >
      <span
        className="h-1.5 w-1.5 rounded-full shrink-0"
        style={{
          background: color,
          boxShadow: `0 0 6px ${color}`,
          animation: state.busy ? "osb-chan 1.1s ease-in-out infinite" : "none",
        }}
      />
      {text}

      {/* eigene Keyframes, damit die Leuchte auch im Dokumente-Modul funktioniert -
          das nutzt ein anderes Stilsystem (dhud-) ohne die hud-Animationen */}
      <style>{`
        @keyframes osb-chan { 0%, 100% { opacity: 1; } 50% { opacity: 0.25; } }
      `}</style>
    </span>
  );
}
