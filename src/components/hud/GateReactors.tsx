"use client";

export type GateStage =
  | { kind: "idle" }
  | { kind: "uploading"; pct: number }
  | { kind: "linking" }
  | { kind: "open"; gates: number; remainingLabel: string }
  | { kind: "receiving"; count: number };

const TICKS = Array.from({ length: 16 }, (_, i) => i * (360 / 16));

// Ein Reaktor der Doppelanzeige. Die Farbe steht fuer die Rolle (Quelle/Gate), die
// Aktivitaet fuer den Zustand: ruhend dreht sich nur der Aussenring langsam,
// aktiv pulsiert zusaetzlich der Kern
function Core({
  color,
  label,
  caption,
  active,
  pct,
}: {
  color: string;
  label: string;
  caption: string;
  active: boolean;
  pct?: number;
}) {
  const radius = 26;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = pct === undefined ? circumference : circumference - (Math.min(100, pct) / 100) * circumference;

  return (
    <div className="flex flex-col items-center gap-1.5 shrink-0">
      <div
        className="relative h-16 w-16 transition-[filter] duration-500"
        style={{ filter: active ? `drop-shadow(0 0 12px ${color}88)` : `drop-shadow(0 0 4px ${color}33)` }}
      >
        {/* Aussenring mit Tick-Marks */}
        <svg
          viewBox="0 0 72 72"
          className={`absolute inset-0 h-full w-full ${active ? "hud-ring-spin-slow-rev" : "hud-ring-spin-slow"}`}
          style={{ color, opacity: active ? 1 : 0.45 }}
        >
          <circle cx="36" cy="36" r="34" fill="none" stroke="currentColor" strokeWidth="0.8" opacity="0.3" />
          {TICKS.map((deg, i) => (
            <line
              key={deg}
              x1="36"
              y1="2"
              x2="36"
              y2={i % 4 === 0 ? "7" : "5"}
              stroke="currentColor"
              strokeWidth={i % 4 === 0 ? 1.2 : 0.7}
              opacity={i % 4 === 0 ? 0.8 : 0.35}
              transform={`rotate(${deg} 36 36)`}
            />
          ))}
        </svg>

        {/* Fortschritts-/Statusring */}
        <svg viewBox="0 0 72 72" className="absolute inset-0 h-full w-full -rotate-90">
          <circle cx="36" cy="36" r={radius} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="3.5" />
          <circle
            cx="36"
            cy="36"
            r={radius}
            fill="none"
            stroke={color}
            strokeWidth="3.5"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={dashOffset}
            style={{ transition: "stroke-dashoffset 0.3s ease", opacity: active ? 0.95 : 0.4 }}
          />
        </svg>

        {/* Kern */}
        <div className="absolute inset-0 flex items-center justify-center">
          <div
            className="h-6 w-6 rounded-full transition-all duration-500"
            style={{
              background: active
                ? `radial-gradient(circle, #ffffff 0%, ${color} 45%, transparent 75%)`
                : `radial-gradient(circle, ${color}55 0%, transparent 70%)`,
              boxShadow: active ? `0 0 16px 4px ${color}aa` : "none",
              animation: active ? "hud-core-pulse 1.6s ease-in-out infinite" : "none",
            }}
          />
        </div>

        {pct !== undefined && (
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-[9px] font-bold tabular-nums" style={{ color: "#ffffff" }}>
              {Math.round(pct)}%
            </span>
          </div>
        )}
      </div>

      <div className="text-center leading-tight">
        <div className="text-[9px] tracking-widest uppercase font-semibold" style={{ color }}>
          {label}
        </div>
        <div className="text-[9px] text-cyan-300/40">{caption}</div>
      </div>
    </div>
  );
}

// Doppelreaktor: links die Quelle (mein Geraet), rechts das Gate. Dazwischen eine
// Leitung, deren Pakete in die jeweils passende Richtung laufen - hoch beim Erstellen,
// runter, wenn ein Empfaenger abholt
export function GateReactors({ stage }: { stage: GateStage }) {
  const SOURCE = "#a78bfa"; // violett wie der Upload in der Transfer-Leitung
  const GATE = "#fbbf24"; // bernstein: offenes Gate
  const RECEIVE = "#4ade80"; // gruen wie der Download

  const uploading = stage.kind === "uploading";
  const linking = stage.kind === "linking";
  const receiving = stage.kind === "receiving";
  const open = stage.kind === "open";

  const gateColor = receiving ? RECEIVE : open || linking ? GATE : "#475569";
  const sourceActive = uploading || linking;
  const gateActive = open || receiving || linking;

  const lineColor = receiving ? RECEIVE : uploading || linking ? SOURCE : open ? GATE : "#475569";
  const flowReverse = receiving; // Abholen laeuft vom Gate zurueck zum Empfaenger
  const busyLine = uploading || linking || receiving;
  const packets = busyLine
    ? { count: 4, durationSec: 1.6, opacity: 0.85 }
    : open
    ? { count: 2, durationSec: 3.2, opacity: 0.55 }
    : { count: 2, durationSec: 7, opacity: 0.3 };

  const statusText =
    stage.kind === "uploading"
      ? `Dateien werden hochgeladen · ${Math.round(stage.pct)}%`
      : stage.kind === "linking"
      ? "Gate wird erzeugt, Link wird generiert…"
      : stage.kind === "receiving"
      ? `Empfänger holt ab · ${stage.count}× abgeholt`
      : stage.kind === "open"
      ? `${stage.gates} ${stage.gates === 1 ? "Gate" : "Gates"} offen · ${stage.remainingLabel}`
      : "Kein Gate offen";

  return (
    <div className="rounded-xl border border-cyan-400/15 bg-black/25 p-3 mb-4">
      <div className="flex items-center gap-3">
        <Core
          color={SOURCE}
          label="Quelle"
          caption={uploading ? "sendet" : "bereit"}
          active={sourceActive}
          pct={uploading ? stage.pct : undefined}
        />

        {/* Leitung zwischen den Reaktoren */}
        <div className="relative flex-1 h-10 flex items-center overflow-hidden rounded-md">
          <div
            className="absolute left-0 right-0 h-6 rounded-md border"
            style={{ borderColor: `${lineColor}22`, background: `linear-gradient(90deg, ${lineColor}08, ${lineColor}14, ${lineColor}08)` }}
          />
          <div
            className="absolute left-0 right-0 h-[2px]"
            style={{
              background: `linear-gradient(90deg, ${lineColor}33, ${lineColor}cc, ${lineColor}33)`,
              animation: busyLine ? "none" : "hud-idle-breath 7s ease-in-out infinite",
            }}
          />
          {[...Array(7)].map((_, i) => (
            <span
              key={`seg-${i}`}
              className="absolute h-3 w-px"
              style={{ left: `${(i + 1) * 12.5}%`, background: `${lineColor}33` }}
            />
          ))}

          {/* Gruppen-key haelt die Animation stabil: aendert sich Tempo oder Richtung,
              werden die Pakete neu aufgebaut statt mitten im Lauf umgestellt */}
          <span key={`${flowReverse ? "rev" : "fwd"}-${packets.durationSec}-${packets.count}`}>
            {Array.from({ length: packets.count }, (_, i) => (
              <span
                key={i}
                className="absolute top-1/2 -translate-y-1/2 h-2 w-12 pointer-events-none"
                style={{
                  animation: `${flowReverse ? "hud-transfer-rev" : "hud-transfer"} ${packets.durationSec}s linear ${
                    -(i * packets.durationSec) / packets.count
                  }s infinite`,
                  opacity: packets.opacity,
                  willChange: "left",
                }}
              >
                <span
                  className="absolute top-1/2 -translate-y-1/2 left-0 right-0 h-[2px] rounded-full"
                  style={{
                    background: flowReverse
                      ? `linear-gradient(90deg, ${lineColor}, transparent)`
                      : `linear-gradient(90deg, transparent, ${lineColor})`,
                  }}
                />
                <span
                  className="absolute top-1/2 -translate-y-1/2 h-1.5 w-1.5 rounded-full"
                  style={{
                    background: "#ecfeff",
                    boxShadow: `0 0 8px 3px ${lineColor}`,
                    ...(flowReverse ? { left: 0 } : { right: 0 }),
                  }}
                />
              </span>
            ))}
          </span>
        </div>

        <Core
          color={gateColor}
          label="Gate"
          caption={receiving ? "Abholung" : open ? "offen" : linking ? "öffnet" : "zu"}
          active={gateActive}
        />
      </div>

      <div className="text-[10px] tracking-wide text-center mt-2" style={{ color: busyLine || open ? lineColor : "rgba(165,243,252,0.3)" }}>
        {statusText}
      </div>
    </div>
  );
}
