"use client";

import { useEffect, useState } from "react";

export type SignalCounts = { green: number; yellow: number; red: number };

const LAMPS = [
  { key: "red" as const, color: "#f87171", glow: "rgba(248,113,113,0.9)", label: "Dringend" },
  { key: "yellow" as const, color: "#fbbf24", glow: "rgba(251,191,36,0.9)", label: "Offen" },
  { key: "green" as const, color: "#4ade80", glow: "rgba(74,222,128,0.9)", label: "Erledigt" },
];

// Ampel-Turm: die Namensgeberin der App als lebendiges Statuslicht. Jede Lampe leuchtet
// proportional zur Anzahl Notizen dieser Farbe, die staerkste Kategorie pulsiert.
// Klick auf eine Lampe filtert die Notizenliste auf diese Farbe
export function SignalTower({
  counts,
  activeFilter,
  onFilter,
}: {
  counts: SignalCounts;
  activeFilter: "green" | "yellow" | "red" | null;
  onFilter: (c: "green" | "yellow" | "red" | null) => void;
}) {
  const total = counts.green + counts.yellow + counts.red;
  const dominant = LAMPS.reduce((best, l) => (counts[l.key] > counts[best.key] ? l : best), LAMPS[0]);
  const [booted, setBooted] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setBooted(true), 80);
    return () => clearTimeout(t);
  }, []);

  // Auslastung = Anteil noch offener (gelb/rot) Notizen, treibt die Saeulenhoehe
  const load = total === 0 ? 0 : (counts.yellow + counts.red) / total;
  const loadColor = load > 0.66 ? "#f87171" : load > 0.33 ? "#fbbf24" : "#4ade80";

  return (
    <div className="hud-panel rounded-2xl p-4 inline-flex items-center gap-4">
      {/* Auslastungs-Saeule: Fuellstand = offene Notizen, mit auf/ab fahrendem Scanner */}
      <div className="relative z-10 h-[104px] w-6 rounded-lg border border-cyan-400/20 bg-black/40 overflow-hidden shrink-0">
        {[...Array(12)].map((_, i) => (
          <div key={i} className="absolute left-0 right-0 h-px bg-cyan-400/10" style={{ top: `${(i + 1) * (100 / 13)}%` }} />
        ))}
        <div
          className="absolute left-0 right-0 bottom-0 transition-all duration-1000"
          style={{
            height: `${booted ? Math.max(6, load * 100) : 0}%`,
            background: `linear-gradient(to top, ${loadColor}, ${loadColor}33)`,
            boxShadow: `0 0 12px ${loadColor}99`,
          }}
        />
        <div
          className="absolute left-0 right-0 h-[3px]"
          style={{
            background: `linear-gradient(90deg, transparent, ${loadColor}, transparent)`,
            boxShadow: `0 0 10px 2px ${loadColor}`,
            animation: "hud-vscan 3.4s ease-in-out infinite",
          }}
        />
      </div>

      <div className="relative z-10 flex flex-col gap-2.5 rounded-xl border border-cyan-400/20 bg-black/40 px-3 py-3">
        {LAMPS.map((l) => {
          const n = counts[l.key];
          const isActive = n > 0;
          const isSelected = activeFilter === l.key;
          const isDominant = total > 0 && dominant.key === l.key && n > 0;
          return (
            <button
              key={l.key}
              onClick={() => onFilter(isSelected ? null : l.key)}
              title={`${l.label}: ${n}`}
              className="relative h-7 w-7 rounded-full transition-all duration-700"
              style={{
                background: isActive && booted ? l.color : "rgba(255,255,255,0.05)",
                border: `2px solid ${isSelected ? "#ecfeff" : isActive ? l.color : "rgba(255,255,255,0.12)"}`,
                boxShadow: isActive && booted ? `0 0 14px 3px ${l.glow}, inset 0 0 8px rgba(255,255,255,0.4)` : "none",
                animation: isDominant && booted ? "hud-core-pulse 2.2s ease-in-out infinite" : "none",
                opacity: isActive ? 1 : 0.5,
              }}
            >
              <span
                className="absolute -right-1.5 -top-1.5 min-w-[16px] h-4 px-1 rounded-full text-[9px] font-bold flex items-center justify-center tabular-nums"
                style={{
                  background: "rgba(3,8,14,0.95)",
                  color: isActive ? l.color : "rgba(165,243,252,0.3)",
                  border: `1px solid ${isActive ? `${l.color}66` : "rgba(255,255,255,0.1)"}`,
                }}
              >
                {n}
              </span>
            </button>
          );
        })}
      </div>

      <div className="relative z-10 text-[10px] leading-relaxed tracking-wide uppercase">
        <div className="text-cyan-100 font-semibold">Statusmast</div>
        <div className="text-cyan-300/50 normal-case tracking-normal">
          {total} Notiz{total === 1 ? "" : "en"} aktiv
        </div>
        <div className="normal-case tracking-normal" style={{ color: loadColor }}>
          {Math.round(load * 100)}% offen
        </div>
        <div className="text-cyan-300/30 normal-case tracking-normal text-[9px] mt-0.5">
          {activeFilter ? "Klick: Filter aufheben" : "Klick auf Lampe: filtern"}
        </div>
      </div>
    </div>
  );
}
