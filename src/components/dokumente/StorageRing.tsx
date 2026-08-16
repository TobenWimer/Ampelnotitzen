"use client";

import { useEffect, useState } from "react";
import { publishOwnUsage, subscribeUsageStats, type UsageStats } from "@/lib/storageUsage";

// Free-Tier-Limit fuer Firebase Storage (5 GB). Gilt fuer das ganze Projekt,
// nicht pro Person - deshalb der Gesamt-Modus im Ring
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
  const [stats, setStats] = useState<UsageStats>({ own: 0, total: 0, users: 0 });
  // Klick auf die MEM-Saeule schaltet zwischen eigenem und Gesamtverbrauch um
  const [showTotal, setShowTotal] = useState(false);

  useEffect(() => {
    if (!uid) {
      setStats({ own: 0, total: 0, users: 0 });
      return;
    }
    const unsub = subscribeUsageStats(uid, setStats);
    return () => unsub();
  }, [uid]);

  // Eigenen Stand neu berechnen und veroeffentlichen: beim Oeffnen und immer wenn
  // ein Upload/Download gerade fertig geworden ist
  const busy = !!activity;
  useEffect(() => {
    if (!uid || busy) return;
    publishOwnUsage(uid).catch(() => {});
  }, [uid, busy]);

  const usedBytes = showTotal ? stats.total : stats.own;
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

      {/* Pegel-Saeulen: Speicherbelegung, Live-Aktivitaet und Verbindungsstatus */}
      <div className="flex items-end gap-1.5 shrink-0">
        <LevelBar
          fillPct={storagePct}
          color="#c084fc"
          sweeping
          sweepSec={7}
          label="MEM"
          active={showTotal}
          onClick={() => setShowTotal((v) => !v)}
          title={showTotal ? "Zurück auf eigenen Speicher" : "Gesamtspeicher aller Nutzer anzeigen"}
        />
        <LevelBar
          fillPct={activity ? Math.min(100, activity.pct) : 0}
          color={activity?.type === "download" ? "#4ade80" : "#22d3ee"}
          sweeping={!!activity}
          sweepSec={2.4}
          label="I/O"
        />
        <LevelBar fillPct={100} color="#22d3ee" sweeping sweepSec={11} label="NET" />
      </div>

      <div className="text-[10px] leading-tight tracking-wide uppercase">
        <div style={{ color }} className="font-semibold">
          {activity?.type === "upload"
            ? "Upload"
            : activity?.type === "download"
            ? "Download"
            : showTotal
            ? "Gesamt"
            : "Speicher"}
        </div>
        <div className="text-cyan-300/50 normal-case tracking-normal">
          {activity ? "läuft…" : `${formatGB(usedBytes)} / 5 GB`}
        </div>
        {!activity && (
          <div className="text-cyan-300/30 normal-case tracking-normal text-[9px] mt-0.5">
            {showTotal
              ? `alle Nutzer${stats.users > 1 ? ` (${stats.users})` : ""}`
              : "nur ich · Klick auf MEM"}
          </div>
        )}
      </div>
    </div>
  );
}

// Schmale vertikale Pegel-Saeule mit Segmentlinien; bei Aktivitaet laeuft zusaetzlich
// ein Scanner-Strich hoch und runter
function LevelBar({
  fillPct,
  color,
  sweeping,
  sweepSec,
  label,
  onClick,
  active,
  title,
}: {
  fillPct: number;
  color: string;
  sweeping: boolean;
  sweepSec: number;
  label: string;
  /** Gesetzt = Saeule ist anklickbar (aktuell nur MEM zum Umschalten der Anzeige) */
  onClick?: () => void;
  active?: boolean;
  title?: string;
}) {
  const Wrapper = onClick ? "button" : "div";

  return (
    <Wrapper
      onClick={onClick}
      title={title}
      aria-label={title}
      className={`flex flex-col items-center gap-1 ${onClick ? "cursor-pointer" : ""}`}
      style={onClick ? { background: "transparent", border: "none", padding: 0 } : undefined}
    >
      <div
        className="relative h-20 w-4 rounded-md border bg-black/40 overflow-hidden transition-colors duration-200"
        style={{ borderColor: active ? `${color}cc` : "rgba(34,211,238,0.2)" }}
      >
        {[...Array(9)].map((_, i) => (
          <div key={i} className="absolute left-0 right-0 h-px bg-cyan-400/10" style={{ top: `${(i + 1) * 10}%` }} />
        ))}
        <div
          className="absolute left-0 right-0 bottom-0 transition-all duration-700"
          style={{
            height: `${Math.max(fillPct > 0 ? 4 : 0, fillPct)}%`,
            background: `linear-gradient(to top, ${color}, ${color}33)`,
            boxShadow: `0 0 10px ${color}88`,
          }}
        />
        {sweeping && (
          <div
            className="absolute left-0 right-0 h-[3px]"
            style={{
              background: `linear-gradient(90deg, transparent, ${color}, transparent)`,
              boxShadow: `0 0 8px 2px ${color}`,
              animation: `dhud-vscan ${sweepSec}s ease-in-out infinite`,
            }}
          />
        )}
      </div>
      <span
        className="text-[7px] tracking-widest transition-colors duration-200"
        style={{ color: active ? color : "rgba(165,243,252,0.35)" }}
      >
        {label}
      </span>
    </Wrapper>
  );
}
