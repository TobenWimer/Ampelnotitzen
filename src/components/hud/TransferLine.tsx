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

  // Upload violett, Download gruen, sonst der normale Belegt(cyan)/Leer(grau)-Zustand
  const color =
    activity?.type === "upload" ? "#a78bfa" : activity?.type === "download" ? "#4ade80" : active ? "#22d3ee" : "#475569";

  // Waehrend eines Transfers laufen die Pakete immer in Transferrichtung, unabhaengig
  // von der per Klick gewaehlten Deko-Richtung (Upload = raus, Download = rein)
  const flowReverse = activity ? activity.type === "download" : reverse;
  const busy = !!activity;

  // Drei Intensitaetsstufen: Standby laeuft bewusst auch, nur traege und blass
  const packets = busy
    ? { count: 4, durationSec: 1.6, opacity: 0.85, dot: 6, glow: 9 }
    : active
    ? { count: 3, durationSec: 2.6, opacity: 0.7, dot: 6, glow: 8 }
    : { count: 2, durationSec: 6, opacity: 0.4, dot: 4, glow: 5 };

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
                boxShadow: active || busy ? `0 0 8px ${color}66` : "none",
                animation: active || busy ? "none" : "hud-idle-breath 7s ease-in-out infinite",
              }}
            />

            {/* Fuellstand: waehrend eines Transfers der Fortschritt, sonst die
                verbleibende Gueltigkeit des Inhalts. Waechst immer von links, damit
                er als Fortschrittsbalken lesbar bleibt */}
            <div
              className={`absolute left-0 h-[4px] rounded-full ${busy ? "" : "transition-all duration-1000"}`}
              style={{
                width: busy
                  ? `${Math.max(2, activity!.pct)}%`
                  : active && booted
                  ? `${Math.max(2, remainingFraction * 100)}%`
                  : "0%",
                background: `linear-gradient(90deg, ${color}, #ecfeff)`,
                boxShadow: `0 0 10px 1px ${color}`,
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

            {/* Datenpakete: laufen immer, nur unterschiedlich dicht/kraeftig.
                Standby traege und blass, belegte Ablage lebhafter, aktiver Transfer
                zuegig aber bewusst diskret (kein Blendeffekt) */}
            {Array.from({ length: packets.count }, (_, i) => (
              <span
                key={i}
                className="absolute top-1/2 -translate-y-1/2 h-2 w-12 pointer-events-none"
                style={{
                  // negative Verzoegerung: die Pakete sind ab dem ersten Frame gleichmaessig
                  // auf der Strecke verteilt, statt nach jedem Zustandswechsel erst
                  // nacheinander von links einzutroepfeln
                  animation: `${flowReverse ? "hud-transfer-rev" : "hud-transfer"} ${packets.durationSec}s linear ${
                    -(i * packets.durationSec) / packets.count
                  }s infinite`,
                  opacity: packets.opacity,
                  transition: "opacity 0.4s ease",
                }}
              >
                {/* Schweif: liegt immer hinter dem Punkt */}
                <span
                  className="absolute top-1/2 -translate-y-1/2 left-0 right-0 h-[2px] rounded-full"
                  style={{
                    background: flowReverse
                      ? `linear-gradient(90deg, ${color}, transparent)`
                      : `linear-gradient(90deg, transparent, ${color})`,
                  }}
                />
                {/* Punkt: sitzt an der Spitze in Laufrichtung */}
                <span
                  className="absolute top-1/2 -translate-y-1/2 rounded-full"
                  style={{
                    height: packets.dot,
                    width: packets.dot,
                    background: "#ecfeff",
                    boxShadow: `0 0 ${packets.glow}px ${packets.glow / 3}px ${color}`,
                    ...(flowReverse ? { left: 0 } : { right: 0 }),
                  }}
                />
              </span>
            ))}
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
