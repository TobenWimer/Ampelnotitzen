"use client";

import { useEffect, useState } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";

// Free-Tier-Limit fuer Firebase Storage (5 GB)
const STORAGE_CAP_BYTES = 5 * 1024 * 1024 * 1024;

function formatGB(bytes: number) {
  const gb = bytes / (1024 * 1024 * 1024);
  return gb >= 10 ? gb.toFixed(0) : gb.toFixed(gb < 1 ? 2 : 1);
}

// Kreisring unter den Aktions-Buttons: zeigt waehrend eines Uploads den
// Fortschritt in %, sonst den belegten Speicher (von 5 GB) - je nach Modus
// unterschiedliche Farbe, plus rotierender Deko-Ring als Animation.
export default function StorageRing({
  uid,
  uploadPct,
}: {
  uid: string | null;
  uploadPct: number | null;
}) {
  const [usedBytes, setUsedBytes] = useState(0);

  useEffect(() => {
    if (!uid) {
      setUsedBytes(0);
      return;
    }
    const qRef = query(collection(db, "documents"), where("uid", "==", uid));
    const unsub = onSnapshot(
      qRef,
      (snap) => {
        let total = 0;
        snap.forEach((d) => {
          const sz = d.data().sizeBytes;
          if (typeof sz === "number") total += sz;
        });
        setUsedBytes(total);
      },
      (err) => console.warn("storage usage error", err)
    );
    return () => unsub();
  }, [uid]);

  const isUpload = uploadPct !== null;
  const storagePct = Math.min(100, (usedBytes / STORAGE_CAP_BYTES) * 100);
  const pct = isUpload ? Math.min(100, uploadPct ?? 0) : storagePct;

  const radius = 26;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference - (pct / 100) * circumference;

  // Upload/Download: cyan | Speicher-Auslastung: violett
  const color = isUpload ? "#22d3ee" : "#c084fc";
  const glow = isUpload ? "rgba(34,211,238,0.65)" : "rgba(192,132,252,0.65)";

  if (!uid) return null;

  return (
    <div className="flex items-center gap-3">
      <div className="relative h-14 w-14 shrink-0">
        <svg
          viewBox="0 0 64 64"
          className="absolute inset-0 h-full w-full dhud-ring-spin"
          style={{ color }}
        >
          <circle
            cx="32"
            cy="32"
            r="30"
            fill="none"
            stroke="currentColor"
            strokeWidth="1"
            strokeDasharray="2 6"
            opacity="0.55"
          />
        </svg>

        <svg viewBox="0 0 64 64" className="absolute inset-0 h-full w-full -rotate-90">
          <circle cx="32" cy="32" r={radius} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="4" />
          <circle
            cx="32"
            cy="32"
            r={radius}
            fill="none"
            stroke={color}
            strokeWidth="4"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={dashOffset}
            style={{
              filter: `drop-shadow(0 0 4px ${glow})`,
              transition: "stroke-dashoffset 0.3s ease, stroke 0.3s ease",
            }}
          />
        </svg>

        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-[10px] font-bold tabular-nums" style={{ color }}>
            {Math.round(pct)}%
          </span>
        </div>
      </div>

      <div className="text-[10px] leading-tight tracking-wide uppercase">
        <div style={{ color }} className="font-semibold">
          {isUpload ? "Upload" : "Speicher"}
        </div>
        <div className="text-cyan-300/50 normal-case tracking-normal">
          {isUpload ? "läuft…" : `${formatGB(usedBytes)} / 5 GB`}
        </div>
      </div>
    </div>
  );
}
