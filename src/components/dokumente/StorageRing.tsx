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

// Tick-Marks fuer den aeusseren Reticle-Ring
const TICKS = Array.from({ length: 24 }, (_, i) => i * (360 / 24));

export type RingActivity = { type: "upload" | "download"; pct: number } | null;

// Kreisring unter den Aktions-Buttons: zeigt waehrend eines Uploads/Downloads
// den Fortschritt in %, sonst den belegten Speicher (von 5 GB) - je nach Modus
// unterschiedliche Farbe, plus zwei gegenlaeufig rotierende Deko-Ringe.
export default function StorageRing({
  uid,
  activity,
}: {
  uid: string | null;
  activity: RingActivity;
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

  const storagePct = Math.min(100, (usedBytes / STORAGE_CAP_BYTES) * 100);
  const pct = activity ? Math.min(100, activity.pct) : storagePct;

  const radius = 33;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference - (pct / 100) * circumference;

  // Upload: cyan | Download: gruen | Speicher-Auslastung: violett
  const color = activity?.type === "upload" ? "#22d3ee" : activity?.type === "download" ? "#4ade80" : "#c084fc";
  const glow =
    activity?.type === "upload"
      ? "rgba(34,211,238,0.7)"
      : activity?.type === "download"
      ? "rgba(74,222,128,0.7)"
      : "rgba(192,132,252,0.7)";

  if (!uid) return null;

  return (
    <div className="flex items-center gap-4">
      <div className="relative h-24 w-24 shrink-0">
        {/* aeusserer Reticle-Ring mit Tick-Marks, langsam & gegenlaeufig */}
        <svg viewBox="0 0 96 96" className="absolute inset-0 h-full w-full dhud-ring-spin-slow-rev" style={{ color }}>
          <circle cx="48" cy="48" r="45" fill="none" stroke="currentColor" strokeWidth="1" opacity="0.25" />
          {TICKS.map((deg, i) => (
            <line
              key={deg}
              x1="48"
              y1="3.5"
              x2="48"
              y2={i % 6 === 0 ? "8.5" : "6.5"}
              stroke="currentColor"
              strokeWidth={i % 6 === 0 ? 1.4 : 0.8}
              opacity={i % 6 === 0 ? 0.7 : 0.35}
              transform={`rotate(${deg} 48 48)`}
            />
          ))}
        </svg>

        {/* mittlerer gestrichelter Ring, langsam rotierend */}
        <svg viewBox="0 0 96 96" className="absolute inset-0 h-full w-full dhud-ring-spin-slow" style={{ color }}>
          <circle cx="48" cy="48" r="40" fill="none" stroke="currentColor" strokeWidth="1" strokeDasharray="1 7" opacity="0.5" />
        </svg>

        {/* Fortschritts-Ring */}
        <svg viewBox="0 0 96 96" className="absolute inset-0 h-full w-full -rotate-90">
          <circle cx="48" cy="48" r={radius} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="5" />
          <circle
            cx="48"
            cy="48"
            r={radius}
            fill="none"
            stroke={color}
            strokeWidth="5"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={dashOffset}
            style={{
              filter: `drop-shadow(0 0 6px ${glow})`,
              transition: "stroke-dashoffset 0.3s ease, stroke 0.3s ease",
            }}
          />
        </svg>

        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-base font-bold tabular-nums leading-none" style={{ color, textShadow: `0 0 10px ${glow}` }}>
            {Math.round(pct)}%
          </span>
        </div>
      </div>

      <div className="text-[10px] leading-tight tracking-wide uppercase">
        <div style={{ color }} className="font-semibold">
          {activity?.type === "upload" ? "Upload" : activity?.type === "download" ? "Download" : "Speicher"}
        </div>
        <div className="text-cyan-300/50 normal-case tracking-normal">
          {activity ? "läuft…" : `${formatGB(usedBytes)} / 5 GB`}
        </div>
      </div>
    </div>
  );
}
