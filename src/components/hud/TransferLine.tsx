"use client";

import { useEffect, useState } from "react";
import { Smartphone, Monitor } from "lucide-react";

// Transfer-Leitung: lineares Gegenstueck zu den runden Anzeigen der anderen Module.
// Zeigt die Datenstrecke zwischen zwei Geraeten - Pakete laufen nur, wenn wirklich
// etwas in der Zwischenablage liegt, sonst steht die Leitung still ("Leitung frei").
// Klick dreht die Uebertragungsrichtung um (reine Spielerei)
export function TransferLine({
  active,
  label,
  remainingFraction,
}: {
  active: boolean;
  label: string;
  remainingFraction: number;
}) {
  const [reverse, setReverse] = useState(false);
  const [booted, setBooted] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setBooted(true), 60);
    return () => clearTimeout(t);
  }, []);

  const color = active ? "#22d3ee" : "#475569";

  return (
    <button
      onClick={() => setReverse((v) => !v)}
      className="hud-panel rounded-2xl p-4 w-full block text-left"
      title="Übertragungsrichtung umkehren"
    >
      <div className="relative z-10">
        <div className="flex items-center gap-3">
          {/* Quelle */}
          <div className="flex flex-col items-center gap-1 shrink-0">
            <div
              className="h-9 w-9 rounded-lg border flex items-center justify-center transition-colors duration-500"
              style={{
                borderColor: `${color}66`,
                background: `${color}12`,
                boxShadow: active ? `0 0 12px ${color}55` : "none",
              }}
            >
              {reverse ? <Monitor size={16} style={{ color }} /> : <Smartphone size={16} style={{ color }} />}
            </div>
            <span className="text-[8px] tracking-widest uppercase text-cyan-300/40">
              {reverse ? "Desktop" : "Mobil"}
            </span>
          </div>

          {/* Leitung */}
          <div className="relative flex-1 h-9 flex items-center">
            <div
              className="absolute left-0 right-0 h-px"
              style={{ background: `linear-gradient(90deg, ${color}22, ${color}88, ${color}22)` }}
            />
            {/* Fuellstand = verbleibende Gueltigkeit des Inhalts */}
            <div
              className="absolute left-0 h-[3px] rounded-full transition-all duration-1000"
              style={{
                width: active && booted ? `${Math.max(2, remainingFraction * 100)}%` : "0%",
                background: color,
                boxShadow: `0 0 8px ${color}`,
                ...(reverse ? { left: "auto", right: 0 } : {}),
              }}
            />
            {/* laufende Datenpakete, nur bei aktivem Inhalt */}
            {active &&
              [0, 1, 2].map((i) => (
                <span
                  key={i}
                  className="absolute h-1.5 w-1.5 rounded-full"
                  style={{
                    background: "#ecfeff",
                    boxShadow: `0 0 8px 2px ${color}`,
                    animation: `hud-transfer 2.2s linear ${i * 0.73}s infinite`,
                    animationDirection: reverse ? "reverse" : "normal",
                  }}
                />
              ))}
            {/* Segmentmarkierungen */}
            {[...Array(9)].map((_, i) => (
              <span
                key={`seg-${i}`}
                className="absolute h-2 w-px"
                style={{ left: `${(i + 1) * 10}%`, background: `${color}33` }}
              />
            ))}
          </div>

          {/* Ziel */}
          <div className="flex flex-col items-center gap-1 shrink-0">
            <div
              className="h-9 w-9 rounded-lg border flex items-center justify-center transition-colors duration-500"
              style={{
                borderColor: `${color}66`,
                background: `${color}12`,
                boxShadow: active ? `0 0 12px ${color}55` : "none",
              }}
            >
              {reverse ? <Smartphone size={16} style={{ color }} /> : <Monitor size={16} style={{ color }} />}
            </div>
            <span className="text-[8px] tracking-widest uppercase text-cyan-300/40">
              {reverse ? "Mobil" : "Desktop"}
            </span>
          </div>
        </div>

        <div className="flex items-center justify-between mt-2 text-[9px] tracking-widest uppercase">
          <span style={{ color: active ? "#a5f3fc" : "rgba(165,243,252,0.3)" }}>{label}</span>
          <span className="text-cyan-300/25 normal-case tracking-normal">Klick: Richtung</span>
        </div>
      </div>
    </button>
  );
}
