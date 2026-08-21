import { ImageResponse } from "next/og";

// App-Symbol (Favicon, Startbildschirm). Wird von Next.js automatisch erkannt und
// ersetzt frueher Verweise auf /logo.png. Bewusst aus Code statt als Bilddatei, damit
// es zum Reaktor-Signet der App passt und ohne Bildwerkzeug aenderbar bleibt.
//
// Naeher am echten Bauteil (src/components/hud/ReactorEmblem.tsx) als die vorherige
// vereinfachte Drei-Ringe-Version: Reticle-Ring mit Tick-Marks, hexagonale Gehaeuseplatte
// mit Nieten, gestrichelter Mittelring, innerer Ring mit Speichen, gluehender Kern. Statisch
// (kein Rotieren/Pulsieren moeglich fuer ein Icon), deshalb bewusst im "aktiven" Vollglut-Stand.
//
// WICHTIG: es darf nur EINE Favicon-Quelle im app/-Ordner liegen. src/app/favicon.ico wurde
// entfernt (Next.js-Scaffolding-Rest), sonst konkurrieren beide und der Browser zeigt
// inkonsistent mal die alte, mal die neue Version.
export const size = { width: 512, height: 512 };
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

export default function Icon() {
  const red = "#ef4444";
  const ringSize = 440;

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
          {/* aeusserer Reticle-Ring mit Tick-Marks */}
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

          {/* hexagonale Reaktor-Gehaeuseplatte mit Nieten */}
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

          {/* mittlerer gestrichelter Ring */}
          <svg
            viewBox="0 0 96 96"
            width={ringSize}
            height={ringSize}
            style={{ position: "absolute", top: 0, left: 0 }}
          >
            <circle cx="48" cy="48" r="34" fill="none" stroke={red} strokeWidth="1.5" strokeDasharray="5 4" opacity="0.65" />
          </svg>

          {/* innerer Ring + Energie-Speichen */}
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

          {/* gluehender Energiekern */}
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
                width: 200,
                height: 200,
                borderRadius: "50%",
                background:
                  "radial-gradient(circle, #fff1f1 0%, #f87171 40%, #ef4444 60%, rgba(239,68,68,0) 78%)",
                boxShadow:
                  "0 0 60px 20px rgba(239,68,68,0.8), 0 0 110px 36px rgba(239,68,68,0.4)",
              }}
            />
          </div>
        </div>
      </div>
    ),
    size
  );
}
