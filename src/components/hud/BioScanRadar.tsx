"use client";

import { useEffect, useState } from "react";

export type RadarAxis = { key: string; label: string; value: number; color: string };

const R_OUTER = 78;
const CX = 100;
const CY = 100;

// Wert 1..10 -> Radius. 5 (neutral) liegt bewusst genau auf halber Strecke,
// damit "besser/schlechter als gestern" als Ausbuchtung/Delle sofort lesbar ist
const valueToRadius = (v: number) => ((v - 1) / 9) * R_OUTER;

const pointAt = (angleDeg: number, radius: number) => {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return [CX + Math.cos(rad) * radius, CY + Math.sin(rad) * radius] as const;
};

// Bio-Scan: radiales 8-Speichen-Diagramm des letzten Eintrags. Die Flaeche faehrt beim
// Laden hoch (Scan-Animation), Achsen sind anklickbar zum Hervorheben einer Kategorie
export function BioScanRadar({
  axes,
  dateLabel,
  selectedKey,
  onSelect,
}: {
  axes: RadarAxis[];
  dateLabel: string;
  selectedKey: string | null;
  onSelect: (key: string | null) => void;
}) {
  const [scan, setScan] = useState(0);

  useEffect(() => {
    setScan(0);
    const t = setTimeout(() => setScan(1), 60);
    return () => clearTimeout(t);
  }, [axes]);

  const step = 360 / axes.length;
  const neutralR = valueToRadius(5);

  const areaPoints = axes
    .map((a, i) => pointAt(i * step, valueToRadius(a.value) * scan).join(","))
    .join(" ");
  const neutralPoints = axes.map((_, i) => pointAt(i * step, neutralR).join(",")).join(" ");

  const avg = axes.reduce((s, a) => s + a.value, 0) / axes.length;
  const delta = avg - 5;

  return (
    <div className="flex flex-col items-center">
      <svg viewBox="0 0 200 200" className="w-full max-w-[340px]">
        <defs>
          {/* Radial-Shading hinter dem Tacho: dunkler Kern, leuchtender Rand */}
          <radialGradient id="bioscan-dish" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#0b2432" stopOpacity="0.95" />
            <stop offset="62%" stopColor="#062029" stopOpacity="0.75" />
            <stop offset="100%" stopColor="#22d3ee" stopOpacity="0.12" />
          </radialGradient>
          {/* Verlauf der gescannten Flaeche */}
          <radialGradient id="bioscan-area" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#22d3ee" stopOpacity="0.05" />
            <stop offset="100%" stopColor="#22d3ee" stopOpacity="0.35" />
          </radialGradient>
          {/* Sweep-Keil des Scanners */}
          <linearGradient id="bioscan-sweep" x1="0" y1="1" x2="1" y2="0">
            <stop offset="0%" stopColor="#22d3ee" stopOpacity="0" />
            <stop offset="100%" stopColor="#22d3ee" stopOpacity="0.28" />
          </linearGradient>
        </defs>

        {/* Schuessel-Shading */}
        <circle cx={CX} cy={CY} r={R_OUTER + 12} fill="url(#bioscan-dish)" />
        <circle cx={CX} cy={CY} r={R_OUTER + 12} fill="none" stroke="rgba(34,211,238,0.2)" strokeWidth="0.8" />

        {/* aeusserer Tick-Kranz, langsam gegenlaeufig rotierend */}
        <g className="hud-ring-spin-slow-rev" style={{ transformOrigin: "100px 100px" }}>
          {Array.from({ length: 36 }, (_, i) => i * 10).map((deg, i) => (
            <line
              key={deg}
              x1={CX}
              y1={CY - (R_OUTER + 12)}
              x2={CX}
              y2={CY - (R_OUTER + (i % 3 === 0 ? 5 : 8))}
              stroke="rgba(34,211,238,0.45)"
              strokeWidth={i % 3 === 0 ? 0.9 : 0.5}
              transform={`rotate(${deg} ${CX} ${CY})`}
            />
          ))}
        </g>

        {/* Gitterringe */}
        {[0.25, 0.5, 0.75, 1].map((f) => (
          <polygon
            key={f}
            points={axes.map((_, i) => pointAt(i * step, R_OUTER * f).join(",")).join(" ")}
            fill="none"
            stroke="rgba(34,211,238,0.12)"
            strokeWidth="0.7"
          />
        ))}

        {/* Speichen mit Achsen-Endkappen */}
        {axes.map((a, i) => {
          const [x, y] = pointAt(i * step, R_OUTER);
          const [cx2, cy2] = pointAt(i * step, R_OUTER + 6);
          return (
            <g key={a.key}>
              <line x1={CX} y1={CY} x2={x} y2={y} stroke="rgba(34,211,238,0.15)" strokeWidth="0.7" />
              <circle cx={cx2} cy={cy2} r="1.3" fill={a.color} opacity={selectedKey === a.key ? 0.95 : 0.4} />
            </g>
          );
        })}

        {/* Neutrallinie (5 = wie gestern) */}
        <polygon points={neutralPoints} fill="none" stroke="rgba(148,163,184,0.5)" strokeWidth="0.9" strokeDasharray="3 3" />

        {/* gescannte Flaeche */}
        <polygon
          points={areaPoints}
          fill="url(#bioscan-area)"
          stroke="#22d3ee"
          strokeWidth="1.6"
          style={{ transition: "all 1.1s cubic-bezier(0.22,1,0.36,1)", filter: "drop-shadow(0 0 6px rgba(34,211,238,0.6))" }}
        />

        {/* rotierender Scanner-Strahl mit nachlaufendem Keil */}
        <g className="hud-ring-spin-slow" style={{ transformOrigin: "100px 100px" }}>
          <path d={`M ${CX} ${CY} L ${CX} ${CY - R_OUTER} A ${R_OUTER} ${R_OUTER} 0 0 1 ${CX + R_OUTER * 0.71} ${CY - R_OUTER * 0.71} Z`} fill="url(#bioscan-sweep)" />
          <line x1={CX} y1={CY} x2={CX} y2={CY - R_OUTER} stroke="rgba(34,211,238,0.55)" strokeWidth="1.2" />
        </g>

        {/* Achsenpunkte, anklickbar */}
        {axes.map((a, i) => {
          const [x, y] = pointAt(i * step, valueToRadius(a.value) * scan);
          const isSel = selectedKey === a.key;
          return (
            <circle
              key={a.key}
              cx={x}
              cy={y}
              r={isSel ? 4.5 : 2.6}
              fill={a.color}
              stroke={isSel ? "#ecfeff" : "transparent"}
              strokeWidth="1.2"
              className="cursor-pointer"
              onClick={() => onSelect(isSel ? null : a.key)}
              style={{ filter: `drop-shadow(0 0 5px ${a.color})`, transition: "all 0.9s cubic-bezier(0.22,1,0.36,1)" }}
            >
              <title>{`${a.label}: ${a.value}`}</title>
            </circle>
          );
        })}

        {/* Mittelwert im Zentrum */}
        <text x={CX} y={CY - 2} textAnchor="middle" fontSize="15" fontWeight="bold" fill="#ecfeff">
          {delta >= 0 ? "+" : ""}{delta.toFixed(1)}
        </text>
        <text x={CX} y={CY + 9} textAnchor="middle" fontSize="6" fill="rgba(165,243,252,0.55)" letterSpacing="1">
          Ø DELTA
        </text>
      </svg>

      <div className="text-[10px] tracking-[0.2em] uppercase text-cyan-400/60 mt-1">
        Letzter Scan · {dateLabel}
      </div>

      {/* Achsen-Legende, ebenfalls anklickbar */}
      <div className="flex flex-wrap justify-center gap-x-3 gap-y-1 mt-3 max-w-md">
        {axes.map((a) => {
          const isSel = selectedKey === a.key;
          return (
            <button
              key={a.key}
              onClick={() => onSelect(isSel ? null : a.key)}
              className="flex items-center gap-1.5 text-[10px] transition"
              style={{ color: isSel ? a.color : "rgba(165,243,252,0.45)" }}
            >
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{ background: a.color, boxShadow: isSel ? `0 0 6px ${a.color}` : "none" }}
              />
              {a.label}
              <span className="font-bold">{a.value}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
