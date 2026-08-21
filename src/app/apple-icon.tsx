import { ImageResponse } from "next/og";

// Homescreen-Icon fuer iOS ("Zum Home-Bildschirm hinzufuegen"). Separat von icon.tsx,
// das nur den Browser-Tab/Favicon steuert - iOS Safari ignoriert das fuer den
// Homescreen komplett und braucht dieses eigene Next.js-Dateikonvention-Symbol,
// sonst fuellt iOS selbst einen Platzhalter mit dem Anfangsbuchstaben des Titels.
// Gleiches Reaktor-Design wie icon.tsx, nur auf Apples Standardgroesse 180x180 und
// mit vollflaechigem Hintergrund (iOS setzt die abgerundeten Ecken selbst, Transparenz
// wuerde nur schwarz durchscheinen lassen).
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

const TICKS = Array.from({ length: 20 }, (_, i) => i * (360 / 20));
const HEX_POINTS = "80,48 64,75.7 32,75.7 16,48 32,20.3 64,20.3";
const HEX_RIVETS: [number, number][] = [
  [80, 48],
  [64, 75.7],
  [32, 75.7],
  [16, 48],
  [32, 20.3],
  [64, 20.3],
];

export default function AppleIcon() {
  const red = "#ef4444";
  const ringSize = 160;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#04070c",
        }}
      >
        <div style={{ position: "relative", width: ringSize, height: ringSize, display: "flex" }}>
          <svg
            viewBox="0 0 96 96"
            width={ringSize}
            height={ringSize}
            style={{ position: "absolute", top: 0, left: 0 }}
          >
            <circle cx="48" cy="48" r="45" fill="none" stroke={red} strokeWidth="1" opacity="0.35" />
            {TICKS.map((deg, i) => (
              <line
                key={deg}
                x1="48"
                y1="2.5"
                x2="48"
                y2={i % 5 === 0 ? "9" : "6"}
                stroke={red}
                strokeWidth={i % 5 === 0 ? 1.6 : 0.9}
                opacity={i % 5 === 0 ? 0.85 : 0.4}
                transform={`rotate(${deg} 48 48)`}
              />
            ))}
          </svg>

          <svg
            viewBox="0 0 96 96"
            width={ringSize}
            height={ringSize}
            style={{ position: "absolute", top: 0, left: 0 }}
          >
            <polygon points={HEX_POINTS} fill="rgba(239,68,68,0.08)" stroke={red} strokeWidth="1.5" opacity="0.6" />
            {HEX_RIVETS.map(([x, y]) => (
              <circle key={`${x}-${y}`} cx={x} cy={y} r="2" fill={red} opacity="0.75" />
            ))}
          </svg>

          <svg
            viewBox="0 0 96 96"
            width={ringSize}
            height={ringSize}
            style={{ position: "absolute", top: 0, left: 0 }}
          >
            <circle cx="48" cy="48" r="34" fill="none" stroke={red} strokeWidth="1.5" strokeDasharray="5 4" opacity="0.65" />
          </svg>

          <svg
            viewBox="0 0 96 96"
            width={ringSize}
            height={ringSize}
            style={{ position: "absolute", top: 0, left: 0 }}
          >
            <circle cx="48" cy="48" r="24" fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="3" />
            <circle cx="48" cy="48" r="24" fill="none" stroke="#fca5a5" strokeWidth="3" strokeDasharray="7 4" opacity="0.7" />
            {[0, 120, 240].map((deg) => (
              <line
                key={deg}
                x1="48"
                y1="48"
                x2="48"
                y2="26"
                stroke="#fca5a5"
                strokeWidth="1.5"
                opacity="0.55"
                transform={`rotate(${deg} 48 48)`}
              />
            ))}
          </svg>

          <div
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <div
              style={{
                width: 72,
                height: 72,
                borderRadius: "50%",
                background:
                  "radial-gradient(circle, #fff1f1 0%, #f87171 40%, #ef4444 60%, rgba(239,68,68,0) 78%)",
                boxShadow:
                  "0 0 24px 8px rgba(239,68,68,0.8), 0 0 44px 14px rgba(239,68,68,0.4)",
              }}
            />
          </div>
        </div>
      </div>
    ),
    size
  );
}
