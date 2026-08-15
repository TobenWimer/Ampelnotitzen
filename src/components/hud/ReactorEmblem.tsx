"use client";

const TICKS = Array.from({ length: 20 }, (_, i) => i * (360 / 20));

// Hexagonale Reaktor-Platte (Gehaeuse) mit Nieten an den Ecken, feste Grundschicht
// hinter den rotierenden Ringen - Radius 32 um Zentrum (48,48)
const HEX_POINTS = "80,48 64,75.7 32,75.7 16,48 32,20.3 64,20.3";
const HEX_RIVETS: [number, number][] = [
  [80, 48],
  [64, 75.7],
  [32, 75.7],
  [16, 48],
  [32, 20.3],
  [64, 20.3],
];

// Aufwendiges rotierendes Reaktorkern-Emblem als App-Signet - Halo-Glow, Reticle-Ring,
// hexagonale Gehaeuseplatte mit Nieten, gegenlaeufig rotierende Ringe, pulsierender Kern.
// Rot statt cyan, damit es sich bewusst vom Rest der HUD-Optik (cyan) abhebt
export function ReactorEmblem({ size = 108 }: { size?: number }) {
  const red = "#ef4444";
  return (
    <div
      className="relative shrink-0"
      style={{
        width: size,
        height: size,
        filter: "drop-shadow(0 0 18px rgba(239,68,68,0.55))",
      }}
    >
      {/* aeusserer Reticle-Ring mit Tick-Marks, langsam gegenlaeufig */}
      <svg viewBox="0 0 96 96" className="absolute inset-0 h-full w-full hud-ring-spin-slow-rev" style={{ color: red }}>
        <circle cx="48" cy="48" r="45" fill="none" stroke="currentColor" strokeWidth="1" opacity="0.35" />
        {TICKS.map((deg, i) => (
          <line
            key={deg}
            x1="48"
            y1="2.5"
            x2="48"
            y2={i % 5 === 0 ? "9" : "6"}
            stroke="currentColor"
            strokeWidth={i % 5 === 0 ? 1.6 : 0.9}
            opacity={i % 5 === 0 ? 0.85 : 0.4}
            transform={`rotate(${deg} 48 48)`}
          />
        ))}
      </svg>

      {/* feste hexagonale Reaktor-Gehaeuseplatte mit Nieten */}
      <svg viewBox="0 0 96 96" className="absolute inset-0 h-full w-full" style={{ color: red }}>
        <polygon points={HEX_POINTS} fill="rgba(239,68,68,0.05)" stroke="currentColor" strokeWidth="1.5" opacity="0.55" />
        {HEX_RIVETS.map(([x, y]) => (
          <circle key={`${x}-${y}`} cx={x} cy={y} r="2" fill="currentColor" opacity="0.7" />
        ))}
      </svg>

      {/* mittlerer gestrichelter Ring, langsam rotierend */}
      <svg viewBox="0 0 96 96" className="absolute inset-0 h-full w-full hud-ring-spin-slow" style={{ color: red }}>
        <circle cx="48" cy="48" r="34" fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="5 4" opacity="0.6" />
      </svg>

      {/* innerer Ring + Energie-Speichen */}
      <svg viewBox="0 0 96 96" className="absolute inset-0 h-full w-full">
        <circle cx="48" cy="48" r="24" fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="3" />
        <circle cx="48" cy="48" r="24" fill="none" stroke="#fca5a5" strokeWidth="3" strokeDasharray="7 4" opacity="0.65" />
        {[0, 120, 240].map((deg) => (
          <line
            key={deg}
            x1="48"
            y1="48"
            x2="48"
            y2="26"
            stroke="#fca5a5"
            strokeWidth="1.5"
            opacity="0.5"
            transform={`rotate(${deg} 48 48)`}
          />
        ))}
      </svg>

      {/* pulsierender Energiekern */}
      <div className="absolute inset-0 flex items-center justify-center">
        <div
          className="h-11 w-11 rounded-full"
          style={{
            background: "radial-gradient(circle, #fff1f1 0%, #f87171 40%, #ef4444 60%, rgba(239,68,68,0) 78%)",
            boxShadow:
              "0 0 26px 8px rgba(239,68,68,0.75), 0 0 54px 18px rgba(239,68,68,0.4), 0 0 90px 30px rgba(239,68,68,0.15)",
            animation: "hud-core-pulse 2.4s ease-in-out infinite",
          }}
        />
      </div>
    </div>
  );
}
