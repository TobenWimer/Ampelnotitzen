import { ImageResponse } from "next/og";

// App-Symbol (Favicon, Startbildschirm). Wird von Next.js automatisch erkannt und
// ersetzt die frueheren Verweise auf /logo.png. Bewusst aus Code statt als Bilddatei,
// damit es zum Reaktor-Signet der App passt und ohne Bildwerkzeug aenderbar bleibt.
export const size = { width: 512, height: 512 };
export const contentType = "image/png";

export default function Icon() {
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
        {/* aeusserer Ring */}
        <div
          style={{
            width: 420,
            height: 420,
            borderRadius: "50%",
            border: "10px solid rgba(239,68,68,0.30)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {/* mittlerer Ring */}
          <div
            style={{
              width: 300,
              height: 300,
              borderRadius: "50%",
              border: "12px solid rgba(239,68,68,0.60)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {/* Kern */}
            <div
              style={{
                width: 150,
                height: 150,
                borderRadius: "50%",
                background: "#ef4444",
                boxShadow: "0 0 70px 26px rgba(239,68,68,0.85)",
              }}
            />
          </div>
        </div>
      </div>
    ),
    size
  );
}
