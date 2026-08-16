import { ImageResponse } from "next/og";

// Vorschaubild fuer geteilte Links (WhatsApp, Signal, Slack, ...). Next.js erkennt
// die Datei automatisch und setzt die passenden og:/twitter:-Angaben.
export const alt = "OneStepBehind";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 64,
          background: "#04070c",
        }}
      >
        {/* Reaktor-Signet, gleiche Bildsprache wie in der App */}
        <div
          style={{
            width: 300,
            height: 300,
            borderRadius: "50%",
            border: "6px solid rgba(239,68,68,0.28)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div
            style={{
              width: 214,
              height: 214,
              borderRadius: "50%",
              border: "8px solid rgba(239,68,68,0.55)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <div
              style={{
                width: 108,
                height: 108,
                borderRadius: "50%",
                background: "#ef4444",
                boxShadow: "0 0 60px 22px rgba(239,68,68,0.8)",
              }}
            />
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column" }}>
          <div
            style={{
              fontSize: 66,
              fontWeight: 700,
              letterSpacing: 8,
              color: "#ecfeff",
            }}
          >
            ONESTEPBEHIND
          </div>
          <div
            style={{
              marginTop: 18,
              fontSize: 27,
              letterSpacing: 4,
              color: "#22d3ee",
            }}
          >
            NOTIZEN · TRACKER · TRANSFER
          </div>
        </div>
      </div>
    ),
    size
  );
}
