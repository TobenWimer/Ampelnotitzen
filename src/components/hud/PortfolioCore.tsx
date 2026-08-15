"use client";

import { useEffect, useState } from "react";

const TICKS = Array.from({ length: 24 }, (_, i) => i * (360 / 24));

// Portfolio-Reaktor: Ladering, dessen Fuellstand die realisierte Gesamt-Performance zeigt.
// Gruen bei Plus, rot bei Minus, cyan wenn noch nichts realisiert wurde. Klick schaltet
// zwischen absoluter CHF-Anzeige und Prozent um
export function PortfolioCore({
  totalPl,
  totalInvestedClosed,
  openCount,
}: {
  totalPl: number;
  totalInvestedClosed: number;
  openCount: number;
}) {
  const [showPct, setShowPct] = useState(false);
  const [charge, setCharge] = useState(0);

  const pct = totalInvestedClosed > 0 ? (totalPl / totalInvestedClosed) * 100 : 0;

  // Fuellstand: +/-20% Rendite entspricht dem vollen Ring, danach gekappt
  const fill = Math.min(1, Math.abs(pct) / 20);

  useEffect(() => {
    setCharge(0);
    const t = setTimeout(() => setCharge(fill), 80);
    return () => clearTimeout(t);
  }, [fill]);

  const neutral = totalInvestedClosed === 0;
  const color = neutral ? "#22d3ee" : totalPl >= 0 ? "#4ade80" : "#f87171";
  const glow = neutral
    ? "rgba(34,211,238,0.65)"
    : totalPl >= 0
    ? "rgba(74,222,128,0.65)"
    : "rgba(248,113,113,0.65)";

  const radius = 40;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference - charge * circumference;

  return (
    <button
      onClick={() => setShowPct((v) => !v)}
      className="flex items-center gap-4 bg-transparent border-0 p-0 cursor-pointer text-left"
      title="Umschalten zwischen CHF und Prozent"
    >
      <div className="relative h-28 w-28 shrink-0">
        {/* Reticle-Ring mit Tick-Marks, langsam gegenlaeufig */}
        <svg viewBox="0 0 112 112" className="absolute inset-0 h-full w-full hud-ring-spin-slow-rev" style={{ color }}>
          <circle cx="56" cy="56" r="53" fill="none" stroke="currentColor" strokeWidth="1" opacity="0.25" />
          {TICKS.map((deg, i) => (
            <line
              key={deg}
              x1="56"
              y1="3.5"
              x2="56"
              y2={i % 6 === 0 ? "9" : "6.5"}
              stroke="currentColor"
              strokeWidth={i % 6 === 0 ? 1.4 : 0.8}
              opacity={i % 6 === 0 ? 0.7 : 0.35}
              transform={`rotate(${deg} 56 56)`}
            />
          ))}
        </svg>

        {/* gestrichelter Ring, langsam rotierend */}
        <svg viewBox="0 0 112 112" className="absolute inset-0 h-full w-full hud-ring-spin-slow" style={{ color }}>
          <circle cx="56" cy="56" r="47" fill="none" stroke="currentColor" strokeWidth="1" strokeDasharray="1 7" opacity="0.5" />
        </svg>

        {/* Ladering (Performance) */}
        <svg viewBox="0 0 112 112" className="absolute inset-0 h-full w-full -rotate-90">
          <circle cx="56" cy="56" r={radius} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="5" />
          <circle
            cx="56"
            cy="56"
            r={radius}
            fill="none"
            stroke={color}
            strokeWidth="5"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={dashOffset}
            style={{
              filter: `drop-shadow(0 0 6px ${glow})`,
              transition: "stroke-dashoffset 1.2s cubic-bezier(0.22,1,0.36,1), stroke 0.4s ease",
            }}
          />
        </svg>

        <div className="absolute inset-0 flex flex-col items-center justify-center px-2">
          <span
            className="text-sm font-bold tabular-nums leading-none text-center"
            style={{ color, textShadow: `0 0 10px ${glow}` }}
          >
            {showPct
              ? `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`
              : `${totalPl >= 0 ? "+" : ""}${totalPl.toFixed(0)}`}
          </span>
          <span className="text-[8px] tracking-[0.15em] text-cyan-300/40 mt-1 uppercase">
            {showPct ? "Rendite" : "CHF"}
          </span>
        </div>
      </div>

      <div className="text-[10px] leading-relaxed tracking-wide uppercase">
        <div style={{ color }} className="font-semibold">
          Portfolio-Kern
        </div>
        <div className="text-cyan-300/50 normal-case tracking-normal">
          {openCount} offen{openCount === 1 ? "er" : "e"} Trade{openCount === 1 ? "" : "s"}
        </div>
        <div className="text-cyan-300/30 normal-case tracking-normal text-[9px] mt-0.5">
          Klick: CHF / %
        </div>
      </div>

      {/* zwei kleine Sweep-Radare als Deko rechts daneben */}
      <div className="hidden sm:flex items-center gap-3">
        <SweepRadar color={color} durationSec={4} />
        <SweepRadar color="#22d3ee" durationSec={6.5} reverse />
      </div>
    </button>
  );
}

// Kleines Radar mit umlaufendem Sweep-Keil und Blips - reine Deko, unterstreicht
// den "Ueberwachungs"-Charakter des Trackers
function SweepRadar({
  color,
  durationSec,
  reverse = false,
}: {
  color: string;
  durationSec: number;
  reverse?: boolean;
}) {
  const gradId = `sweep-${color.replace("#", "")}-${durationSec}${reverse ? "r" : ""}`;
  return (
    <div className="relative h-14 w-14 shrink-0 opacity-80">
      <svg viewBox="0 0 60 60" className="absolute inset-0 h-full w-full" style={{ color }}>
        <circle cx="30" cy="30" r="28" fill="rgba(0,0,0,0.35)" stroke="currentColor" strokeWidth="0.8" opacity="0.35" />
        <circle cx="30" cy="30" r="19" fill="none" stroke="currentColor" strokeWidth="0.6" opacity="0.22" />
        <circle cx="30" cy="30" r="10" fill="none" stroke="currentColor" strokeWidth="0.6" opacity="0.22" />
        <line x1="2" y1="30" x2="58" y2="30" stroke="currentColor" strokeWidth="0.5" opacity="0.18" />
        <line x1="30" y1="2" x2="30" y2="58" stroke="currentColor" strokeWidth="0.5" opacity="0.18" />
        {/* Blips */}
        <circle cx="41" cy="21" r="1.6" fill="currentColor" opacity="0.75" />
        <circle cx="22" cy="39" r="1.2" fill="currentColor" opacity="0.5" />
      </svg>

      {/* rotierender Sweep-Keil */}
      <svg
        viewBox="0 0 60 60"
        className="absolute inset-0 h-full w-full"
        style={{ animation: `hud-spin${reverse ? "-rev" : ""} ${durationSec}s linear infinite`, transformOrigin: "50% 50%" }}
      >
        <defs>
          <linearGradient id={gradId} x1="0" y1="1" x2="1" y2="0">
            <stop offset="0%" stopColor={color} stopOpacity="0" />
            <stop offset="100%" stopColor={color} stopOpacity="0.5" />
          </linearGradient>
        </defs>
        <path d="M30 30 L30 2 A28 28 0 0 1 54 16 Z" fill={`url(#${gradId})`} />
        <line x1="30" y1="30" x2="30" y2="2" stroke={color} strokeWidth="1.2" opacity="0.9" />
      </svg>
    </div>
  );
}
