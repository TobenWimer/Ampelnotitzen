"use client";

import { Check } from "lucide-react";

const SEGMENTS = 24;
const TICKS = Array.from({ length: 32 }, (_, i) => i * (360 / 32));

// Vollbild-Übertragungssequenz auf der Gate-Empfangsseite. Bewusst auffaellig:
// diese Seite bekommen Dritte zu sehen, der Download soll sich nach etwas anfuehlen.
// Erscheint nur waehrend eines laufenden Vorgangs und kurz danach beim Abschluss.
export function GateBeam({ pct, done }: { pct: number; done: boolean }) {
  const color = done ? "#4ade80" : "#22d3ee";
  const clamped = Math.max(0, Math.min(100, pct));
  const shown = done ? 100 : clamped;

  const radius = 78;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference - (shown / 100) * circumference;

  const phase = done
    ? "Übertragung abgeschlossen"
    : shown < 8
    ? "Verbindung wird aufgebaut"
    : shown < 92
    ? "Daten werden übertragen"
    : "Wird abgeschlossen";

  return (
    <div
      className="fixed inset-0 z-[200] flex flex-col items-center justify-center gap-8 px-6"
      style={{ background: "rgba(0,1,3,0.92)", backdropFilter: "blur(6px)" }}
      role="status"
      aria-live="polite"
      aria-label={`${phase}, ${Math.round(shown)} Prozent`}
    >
      <div className="relative h-52 w-52 shrink-0" style={{ filter: `drop-shadow(0 0 26px ${color}66)` }}>
        {/* aeusserer Tick-Kranz, dreht langsam gegen den Uhrzeigersinn */}
        <svg viewBox="0 0 200 200" className="absolute inset-0 h-full w-full gb-spin-rev" style={{ color }}>
          <circle cx="100" cy="100" r="96" fill="none" stroke="currentColor" strokeWidth="0.8" opacity="0.25" />
          {TICKS.map((deg, i) => (
            <line
              key={deg}
              x1="100"
              y1="6"
              x2="100"
              y2={i % 4 === 0 ? "16" : "11"}
              stroke="currentColor"
              strokeWidth={i % 4 === 0 ? 1.5 : 0.8}
              opacity={i % 4 === 0 ? 0.8 : 0.35}
              transform={`rotate(${deg} 100 100)`}
            />
          ))}
        </svg>

        {/* mittlerer gestrichelter Ring, dreht mit */}
        <svg viewBox="0 0 200 200" className="absolute inset-0 h-full w-full gb-spin" style={{ color }}>
          <circle cx="100" cy="100" r="88" fill="none" stroke="currentColor" strokeWidth="1" strokeDasharray="3 7" opacity="0.5" />
        </svg>

        {/* Fortschrittsring */}
        <svg viewBox="0 0 200 200" className="absolute inset-0 h-full w-full -rotate-90">
          <circle cx="100" cy="100" r={radius} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="6" />
          <circle
            cx="100"
            cy="100"
            r={radius}
            fill="none"
            stroke={color}
            strokeWidth="6"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={dashOffset}
            style={{ transition: "stroke-dashoffset 0.35s ease, stroke 0.4s ease", filter: `drop-shadow(0 0 8px ${color})` }}
          />
        </svg>

        {/* Zentrum: Prozent oder Haken */}
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          {done ? (
            <Check size={54} style={{ color, filter: `drop-shadow(0 0 12px ${color})` }} strokeWidth={2.5} />
          ) : (
            <>
              <span
                className="text-5xl font-bold tabular-nums leading-none"
                style={{ color: "#ecfeff", textShadow: `0 0 18px ${color}` }}
              >
                {Math.round(shown)}
              </span>
              <span className="text-[11px] tracking-[0.3em] mt-1.5" style={{ color: `${color}bb` }}>
                PROZENT
              </span>
            </>
          )}
        </div>
      </div>

      {/* Segmentleiste: fuellt sich Zelle fuer Zelle */}
      <div className="w-full max-w-md">
        <div className="flex gap-[3px] h-3">
          {Array.from({ length: SEGMENTS }, (_, i) => {
            const lit = (i + 1) / SEGMENTS <= shown / 100;
            const isEdge = !done && Math.abs((i + 1) / SEGMENTS - shown / 100) < 1 / SEGMENTS;
            return (
              <span
                key={i}
                className="flex-1 rounded-sm transition-all duration-300"
                style={{
                  background: lit ? color : "rgba(255,255,255,0.06)",
                  boxShadow: lit ? `0 0 8px ${color}aa` : "none",
                  animation: isEdge ? "gb-edge 0.7s ease-in-out infinite" : "none",
                }}
              />
            );
          })}
        </div>

        <div className="flex items-center justify-between mt-3 text-[10px] tracking-[0.2em] uppercase">
          <span style={{ color: `${color}cc` }}>{phase}</span>
          <span className="text-cyan-300/30">Intertransfer</span>
        </div>
      </div>

      <style>{`
        .gb-spin { animation: gb-rot 14s linear infinite; transform-origin: 50% 50%; }
        .gb-spin-rev { animation: gb-rot-rev 26s linear infinite; transform-origin: 50% 50%; }
        @keyframes gb-rot { to { transform: rotate(360deg); } }
        @keyframes gb-rot-rev { from { transform: rotate(360deg); } to { transform: rotate(0deg); } }
        @keyframes gb-edge { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }
        @media (prefers-reduced-motion: reduce) {
          .gb-spin, .gb-spin-rev { animation: none; }
        }
      `}</style>
    </div>
  );
}
