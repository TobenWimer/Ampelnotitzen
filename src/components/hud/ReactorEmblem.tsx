"use client";

const TICKS = Array.from({ length: 16 }, (_, i) => i * (360 / 16));

// Rotierendes Reaktorkern-Emblem als App-Signet (ersetzt das statische Logo auf der
// Startseite) - drei gegenlaeufig rotierende Ringe um einen pulsierenden Energiekern
export function ReactorEmblem({ size = 88 }: { size?: number }) {
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg viewBox="0 0 96 96" className="absolute inset-0 h-full w-full hud-ring-spin-slow-rev" style={{ color: "#22d3ee" }}>
        <circle cx="48" cy="48" r="45" fill="none" stroke="currentColor" strokeWidth="1" opacity="0.3" />
        {TICKS.map((deg, i) => (
          <line
            key={deg}
            x1="48"
            y1="3.5"
            x2="48"
            y2={i % 4 === 0 ? "9" : "6.5"}
            stroke="currentColor"
            strokeWidth={i % 4 === 0 ? 1.4 : 0.8}
            opacity={i % 4 === 0 ? 0.75 : 0.35}
            transform={`rotate(${deg} 48 48)`}
          />
        ))}
      </svg>

      <svg viewBox="0 0 96 96" className="absolute inset-0 h-full w-full hud-ring-spin-slow" style={{ color: "#22d3ee" }}>
        <circle cx="48" cy="48" r="36" fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="4 5" opacity="0.55" />
      </svg>

      <svg viewBox="0 0 96 96" className="absolute inset-0 h-full w-full">
        <circle cx="48" cy="48" r="26" fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="3" />
        <circle cx="48" cy="48" r="26" fill="none" stroke="#67e8f9" strokeWidth="3" strokeDasharray="8 4" opacity="0.6" />
      </svg>

      <div className="absolute inset-0 flex items-center justify-center">
        <div
          className="h-8 w-8 rounded-full"
          style={{
            background: "radial-gradient(circle, #ecfeff 0%, #22d3ee 45%, rgba(34,211,238,0) 75%)",
            boxShadow: "0 0 20px 6px rgba(34,211,238,0.7), 0 0 40px 14px rgba(34,211,238,0.35)",
            animation: "hud-core-pulse 2.6s ease-in-out infinite",
          }}
        />
      </div>
    </div>
  );
}
