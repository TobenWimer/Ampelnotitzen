"use client";

import { useEffect, useState } from "react";
import { Smartphone, Monitor } from "lucide-react";

// Transfer-Leitung: lineares Gegenstueck zu den runden Anzeigen der anderen Module.
// Zeigt die Datenstrecke zwischen zwei Geraeten - Pakete laufen nur, wenn wirklich
// etwas in der Ablage liegt, sonst atmet die Leitung nur langsam ("Leitung frei").
// Klick dreht die Uebertragungsrichtung um (reine Spielerei)
export type TransferActivity = { type: "upload" | "download"; pct: number } | null;

export function TransferLine({
  active,
  label,
  remainingFraction,
  activity,
}: {
  active: boolean;
  label: string;
  remainingFraction: number;
  activity: TransferActivity;
}) {
  const [reverse, setReverse] = useState(false);
  const [booted, setBooted] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setBooted(true), 60);
    return () => clearTimeout(t);
  }, []);

  // Upload cyan, Download gruen, sonst der normale Belegt/Leer-Zustand
  const color =
    activity?.type === "upload" ? "#22d3ee" : activity?.type === "download" ? "#4ade80" : active ? "#22d3ee" : "#475569";

  // Waehrend eines Transfers laufen die Pakete immer in Transferrichtung, unabhaengig
  // von der per Klick gewaehlten Deko-Richtung (Upload = raus, Download = rein)
  const flowReverse = activity ? activity.type === "download" : reverse;
  const busy = !!activity;

  const endpoint = (icon: React.ReactNode, caption: string) => (
    <div className="flex flex-col items-center gap-1 shrink-0">
      <div
        className="relative h-10 w-10 rounded-lg border flex items-center justify-center transition-colors duration-500"
        style={{
          borderColor: active || busy ? `${color}aa` : `${color}66`,
          background: `${color}14`,
          boxShadow: active || busy ? `0 0 18px ${color}66, inset 0 0 10px ${color}33` : "none",
          animation: busy
            ? "hud-idle-breath 0.9s ease-in-out infinite"
            : active
            ? "hud-idle-breath 2.4s ease-in-out infinite"
            : "hud-idle-breath 7s ease-in-out infinite",
        }}
      >
        {icon}
      </div>
      <span className="text-[8px] tracking-widest uppercase text-cyan-300/40">{caption}</span>
    </div>
  );

  return (
    <button
      onClick={() => setReverse((v) => !v)}
      className="hud-panel rounded-2xl p-4 w-full block text-left"
      title="Übertragungsrichtung umkehren"
    >
      <div className="relative z-10">
        <div className="flex items-center gap-3">
          {endpoint(
            reverse ? <Monitor size={17} style={{ color }} /> : <Smartphone size={17} style={{ color }} />,
            reverse ? "Desktop" : "Mobil"
          )}

          {/* Leitung - overflow-hidden, damit Pakete/Schimmer nie unter die Icons laufen */}
          <div className="relative flex-1 h-10 flex items-center overflow-hidden rounded-md">
            {/* Kanalhintergrund */}
            <div
              className="absolute left-0 right-0 h-6 rounded-md border"
              style={{
                borderColor: `${color}22`,
                background: `linear-gradient(90deg, ${color}08, ${color}14, ${color}08)`,
              }}
            />

            {/* Grundlinie */}
            <div
              className="absolute left-0 right-0 h-[2px]"
              style={{
                background: `linear-gradient(90deg, ${color}33, ${color}cc, ${color}33)`,
                boxShadow: active ? `0 0 10px ${color}88` : "none",
                animation: active ? "none" : "hud-idle-breath 7s ease-in-out infinite",
              }}
            />

            {/* Fuellstand: waehrend eines Transfers der Fortschritt, sonst die
                verbleibende Gueltigkeit des Inhalts */}
            <div
              className={`absolute h-[4px] rounded-full ${busy ? "" : "transition-all duration-1000"}`}
              style={{
                width: busy
                  ? `${Math.max(2, activity!.pct)}%`
                  : active && booted
                  ? `${Math.max(2, remainingFraction * 100)}%`
                  : "0%",
                background: `linear-gradient(90deg, ${color}, #ecfeff)`,
                boxShadow: `0 0 14px 2px ${color}`,
                ...(flowReverse ? { right: 0 } : { left: 0 }),
              }}
            />

            {/* Segmentmarkierungen */}
            {[...Array(9)].map((_, i) => (
              <span
                key={`seg-${i}`}
                className="absolute h-3 w-px"
                style={{ left: `${(i + 1) * 10}%`, background: `${color}33` }}
              />
            ))}

            {/* Datenpakete mit Kometenschweif - waehrend eines Transfers schneller und dichter */}
            {(active || busy) &&
              (busy ? [0, 1, 2, 3, 4, 5, 6] : [0, 1, 2, 3, 4]).map((i) => (
                <span
                  key={i}
                  className="absolute"
                  style={{
                    animation: `hud-transfer ${busy ? 1 : 1.8}s linear ${i * (busy ? 0.14 : 0.36)}s infinite`,
                    animationDirection: flowReverse ? "reverse" : "normal",
                  }}
                >
                  <span
                    className="absolute top-1/2 -translate-y-1/2 h-[3px] w-12 rounded-full"
                    style={{
                      background: flowReverse
                        ? `linear-gradient(90deg, ${color}, transparent)`
                        : `linear-gradient(90deg, transparent, ${color})`,
                      [flowReverse ? "left" : "right"]: 0,
                    }}
                  />
                  <span
                    className="absolute top-1/2 -translate-y-1/2 h-2.5 w-2.5 rounded-full"
                    style={{ background: "#ecfeff", boxShadow: `0 0 14px 4px ${color}` }}
                  />
                </span>
              ))}

            {/* Standby: langsam driftender Schimmer, damit die Leitung auch leer lebt */}
            {!active && !busy && (
              <span
                className="absolute h-[3px] w-[35%] rounded-full pointer-events-none"
                style={{
                  background: `linear-gradient(90deg, transparent, ${color}dd, transparent)`,
                  animation: "hud-idle-drift 9s ease-in-out infinite",
                }}
              />
            )}
          </div>

          {endpoint(
            reverse ? <Smartphone size={17} style={{ color }} /> : <Monitor size={17} style={{ color }} />,
            reverse ? "Mobil" : "Desktop"
          )}
        </div>

        <div className="flex items-center justify-between mt-2 text-[9px] tracking-widest uppercase">
          <span
            style={{
              color: busy ? color : active ? "#a5f3fc" : "rgba(165,243,252,0.3)",
              textShadow: active || busy ? `0 0 8px ${color}88` : "none",
            }}
          >
            {busy ? `${activity!.type === "upload" ? "Upload" : "Download"} · ${Math.round(activity!.pct)}%` : label}
          </span>
          <span className="text-cyan-300/25 normal-case tracking-normal">Klick: Richtung</span>
        </div>
      </div>
    </button>
  );
}
