"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { doc, setDoc, onSnapshot } from "firebase/firestore";
import { onAuthStateChanged, User } from "firebase/auth";
import { auth, db } from "@/lib/firebase";
import HudGlobalStyles from "@/components/hud/HudGlobalStyles";
import { HudFooter } from "@/components/hud/HudFooter";
import { BioScanRadar, RadarAxis } from "@/components/hud/BioScanRadar";

type CategoryKey =
  | "energie"
  | "fokus"
  | "disziplin"
  | "produktivitaet"
  | "stimmung"
  | "bewegung"
  | "ernaehrung"
  | "soziales";

const CATEGORIES: { key: CategoryKey; label: string }[] = [
  { key: "energie", label: "Energie / Schlaf" },
  { key: "fokus", label: "Fokus / Konzentration" },
  { key: "disziplin", label: "Disziplin / Selbstkontrolle" },
  { key: "produktivitaet", label: "Produktivität" },
  { key: "stimmung", label: "Stimmung / Mentalität" },
  { key: "bewegung", label: "Bewegung / Sport" },
  { key: "ernaehrung", label: "Ernährung" },
  { key: "soziales", label: "Soziales / Umfeld" },
];

type DayEntry = {
  date: string; // YYYY-MM-DD
  values: Record<CategoryKey, number>;
};

type DailyRecapData = {
  entries: DayEntry[];
};

const MONTH_SHORT = ["Jan","Feb","Mär","Apr","Mai","Jun","Jul","Aug","Sep","Okt","Nov","Dez"];
const fmtDate = (iso: string) => {
  const [y, m, d] = iso.split("-");
  return `${d}.${MONTH_SHORT[parseInt(m) - 1]}.${y.slice(2)}`;
};
const todayIso = () => new Date().toISOString().slice(0, 10);

const defaultValues = (): Record<CategoryKey, number> =>
  Object.fromEntries(CATEGORIES.map((c) => [c.key, 5])) as Record<CategoryKey, number>;

const avgDelta = (values: Record<CategoryKey, number>) =>
  CATEGORIES.reduce((s, c) => s + (values[c.key] - 5), 0) / CATEGORIES.length;

const fmtDelta = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(1)}`;

const CATEGORY_COLORS = ["#38bdf8","#4ade80","#f87171","#a78bfa","#fbbf24","#2dd4bf","#f472b6","#a3e635"];

type ContextMenu = { x: number; y: number; date: string } | null;

export default function DailyRecapPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [data, setData] = useState<DailyRecapData>({ entries: [] });
  const [loading, setLoading] = useState(true);
  const [values, setValues] = useState<Record<CategoryKey, number>>(defaultValues());
  const [saved, setSaved] = useState(false);
  const [tab, setTab] = useState<"eintrag" | "verlauf" | "charts">("eintrag");
  const [contextMenu, setContextMenu] = useState<ContextMenu>(null);
  const [radarSelected, setRadarSelected] = useState<string | null>(null);

  const today = todayIso();

  const sortedEntries = useMemo(
    () => [...data.entries].sort((a, b) => b.date.localeCompare(a.date)),
    [data.entries]
  );

  // Der Bio-Scan zeigt bewusst den zuletzt gespeicherten Eintrag, nicht "heute":
  // die Bewertung passiert abends, tagsueber waere "heute" sonst immer leer
  const lastEntry = sortedEntries[0] ?? null;

  const radarAxes: RadarAxis[] = useMemo(() => {
    if (!lastEntry) return [];
    return CATEGORIES.map((c, i) => ({
      key: c.key,
      label: c.label.split(" / ")[0],
      value: lastEntry.values[c.key],
      color: CATEGORY_COLORS[i % CATEGORY_COLORS.length],
    }));
  }, [lastEntry]);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      if (!u) { router.push("/"); return; }
      setUser(u);
    });
    return unsub;
  }, [router]);

  useEffect(() => {
    if (!user) return;
    const ref = doc(db, "dailyRecap", user.uid);
    const unsub = onSnapshot(
      ref,
      (snap) => {
        const next = snap.exists() ? (snap.data() as DailyRecapData) : { entries: [] };
        setData(next);
        const todayEntry = next.entries.find((e) => e.date === today);
        setValues(todayEntry ? todayEntry.values : defaultValues());
        setLoading(false);
      },
      (err) => {
        console.error("[DailyRecap] snapshot failed:", err);
        setLoading(false);
      }
    );
    return unsub;
  }, [user, today]);

  useEffect(() => {
    const close = () => setContextMenu(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, []);

  const setValue = useCallback((key: CategoryKey, v: number) => {
    setValues((prev) => ({ ...prev, [key]: v }));
    setSaved(false);
  }, []);

  const save = useCallback(async () => {
    if (!user) return;
    const otherEntries = data.entries.filter((e) => e.date !== today);
    const next: DailyRecapData = { entries: [...otherEntries, { date: today, values }] };
    setData(next);
    await setDoc(doc(db, "dailyRecap", user.uid), next);
    setSaved(true);
  }, [user, data, today, values]);

  const deleteEntry = useCallback(async (date: string) => {
    if (!user) return;
    const next: DailyRecapData = { entries: data.entries.filter((e) => e.date !== date) };
    setData(next);
    await setDoc(doc(db, "dailyRecap", user.uid), next);
    setContextMenu(null);
  }, [user, data]);

  if (loading) return (
    <div className="min-h-screen hud-bg flex items-center justify-center">
      <p className="text-cyan-400/70 text-xs font-mono tracking-[0.3em] uppercase" style={{ animation: "hud-blink 1.4s ease-in-out infinite" }}>
        Initialisiere…
      </p>
      <HudGlobalStyles />
    </div>
  );

  return (
    <div className="min-h-screen hud-bg text-cyan-50 flex flex-col relative overflow-hidden font-mono" onClick={() => setContextMenu(null)}>
      <div className="hud-grid pointer-events-none absolute inset-0" />

      <header className="relative z-10 w-full flex items-center justify-between px-6 py-4 border-b border-cyan-400/20 bg-black/20 backdrop-blur-sm">
        <div className="flex items-center gap-3">
          <Link href="/" className="text-xs tracking-widest text-cyan-400/70 hover:text-cyan-300 transition uppercase">
            ← Zurück
          </Link>
          <span className="text-cyan-400/20">|</span>
          <h1 className="hud-title text-lg font-bold text-cyan-100 uppercase">Daily Recap</h1>
        </div>
        <span className="flex items-center gap-1.5 text-[10px] tracking-[0.2em] text-cyan-400/70 uppercase">
          <span className="hud-dot h-1.5 w-1.5 rounded-full bg-cyan-400" />
          Sync aktiv
        </span>
      </header>

      <div className="relative z-10 flex-1 max-w-2xl w-full mx-auto px-6 py-8">
        {/* Bio-Scan des letzten Eintrags */}
        {radarAxes.length > 0 && lastEntry && (
          <div className="hud-panel rounded-2xl p-5 mb-8">
            <div className="relative z-10">
              <BioScanRadar
                axes={radarAxes}
                dateLabel={fmtDate(lastEntry.date)}
                selectedKey={radarSelected}
                onSelect={setRadarSelected}
              />
            </div>
          </div>
        )}

        <div className="flex gap-1 border-b border-cyan-400/15 mb-8">
          {(["eintrag", "verlauf", "charts"] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-4 py-2 text-xs uppercase tracking-wider transition border-b-2 -mb-px ${tab === t ? "border-cyan-400 text-cyan-100 font-medium" : "border-transparent text-cyan-300/40 hover:text-cyan-200"}`}>
              {t === "eintrag" ? "Eintrag" : t === "verlauf" ? "Verlauf" : "Charts"}
            </button>
          ))}
        </div>

        {tab === "eintrag" && (
          <div>
            <p className="text-xs text-cyan-300/50 mb-6 tracking-wide">
              &gt; {fmtDate(today)} · 5 = gleich wie gestern, &lt;5 schlechter, &gt;5 besser
            </p>

            <div className="space-y-4">
              {CATEGORIES.map((c, i) => {
                const v = values[c.key];
                const color = CATEGORY_COLORS[i % CATEGORY_COLORS.length];
                return (
                  <div key={c.key} className="hud-panel rounded-2xl p-4">
                    <div className="relative z-10">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs uppercase tracking-wide text-cyan-100/80">{c.label}</span>
                        <span
                          className="text-sm font-bold w-8 text-right tabular-nums"
                          style={{ color, textShadow: `0 0 8px ${color}88` }}
                        >
                          {v}
                        </span>
                      </div>
                      <input
                        type="range"
                        min={1}
                        max={10}
                        step={1}
                        value={v}
                        onChange={(e) => setValue(c.key, parseInt(e.target.value))}
                        className="w-full"
                        style={{ accentColor: color }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="mt-8 flex items-center gap-3">
              <button onClick={save} className="hud-btn hud-btn-primary">
                Speichern
              </button>
              {saved && <span className="text-xs text-cyan-300/70 tracking-wide">&gt;&gt; Gespeichert.</span>}
            </div>
          </div>
        )}

        {tab === "verlauf" && (
          <div className="flex flex-col gap-3">
            {sortedEntries.length === 0 && (
              <p className="text-cyan-300/30 text-sm text-center py-12">— Noch keine Einträge. —</p>
            )}
            {sortedEntries.map((e) => {
              const delta = avgDelta(e.values);
              return (
                <div key={e.date}
                  className="hud-panel rounded-xl p-4 cursor-context-menu select-none"
                  onContextMenu={(ev) => { ev.preventDefault(); setContextMenu({ x: ev.clientX, y: ev.clientY, date: e.date }); }}>
                  <div className="relative z-10">
                    <div className="flex justify-between items-center mb-2">
                      <p className="text-sm font-medium text-cyan-100">{fmtDate(e.date)}</p>
                      <p className={`font-bold text-sm tabular-nums ${delta > 0 ? "text-emerald-400" : delta < 0 ? "text-rose-400" : "text-cyan-300/40"}`}>
                        {fmtDelta(delta)}
                      </p>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-3 gap-y-1">
                      {CATEGORIES.map((c) => (
                        <div key={c.key} className="flex justify-between text-[11px]">
                          <span className="text-cyan-300/35">{c.label.split(" / ")[0]}</span>
                          <span className={`font-medium tabular-nums ${e.values[c.key] > 5 ? "text-emerald-400" : e.values[c.key] < 5 ? "text-rose-400" : "text-cyan-300/40"}`}>
                            {e.values[c.key]}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              );
            })}
            {sortedEntries.length > 0 && (
              <p className="text-[10px] text-cyan-300/25 text-center mt-2 tracking-wide">Rechtsklick auf einen Eintrag zum Löschen</p>
            )}
          </div>
        )}

        {tab === "charts" && <GraphView entries={data.entries} />}
      </div>

      {contextMenu && (
        <div className="hud-menu fixed z-50 rounded-xl overflow-hidden min-w-[160px]"
          style={{ top: contextMenu.y, left: contextMenu.x }}
          onClick={(e) => e.stopPropagation()}>
          <button className="hud-menu-item text-rose-300 hover:bg-rose-500/10"
            onClick={() => { if (confirm("Eintrag löschen?")) deleteEntry(contextMenu.date); }}>
            Löschen
          </button>
        </div>
      )}

      <HudFooter />
      <HudGlobalStyles />
    </div>
  );
}

// ── GraphView ──────────────────────────────────────────────────────────────

type CatSelection = "alle" | CategoryKey;

function buildCategorySeries(entries: DayEntry[], key: CategoryKey, mode: "kumuliert" | "werte") {
  const sorted = [...entries].sort((a, b) => a.date.localeCompare(b.date));
  let cum = 0;
  return sorted.map((e) => {
    const raw = e.values[key];
    if (mode === "werte") return { date: e.date, val: raw };
    cum += raw - 5;
    return { date: e.date, val: cum };
  });
}

function GraphView({ entries }: { entries: DayEntry[] }) {
  const [mode, setMode] = useState<"kumuliert" | "werte">("kumuliert");
  const [catSelection, setCatSelection] = useState<CatSelection>("alle");

  if (entries.length === 0) return <p className="text-cyan-300/30 text-sm text-center py-12">— Noch keine Daten für den Graph. —</p>;

  const catKeys: CategoryKey[] = catSelection === "alle" ? CATEGORIES.map((c) => c.key) : [catSelection];
  const series = catKeys.map((key) => {
    const i = CATEGORIES.findIndex((c) => c.key === key);
    return {
      key,
      label: CATEGORIES[i].label,
      color: CATEGORY_COLORS[i % CATEGORY_COLORS.length],
      points: buildCategorySeries(entries, key, mode),
    };
  });

  const allDates = [...new Set(entries.map((e) => e.date))].sort();
  const allVals = series.flatMap((s) => s.points.map((p) => p.val));

  const max = mode === "werte" ? 10 : Math.max(...allVals, 0);
  const min = mode === "werte" ? 1 : Math.min(...allVals, 0);
  const range = max - min || 1;
  const W = 600; const H = 240; const pad = 56;
  const innerW = W - pad * 2; const innerH = H - pad * 2;

  const firstMs = new Date(allDates[0]).getTime();
  const lastMs = new Date(allDates[allDates.length - 1]).getTime();
  const totalMs = lastMs - firstMs || 1;

  const dateToX = (d: string) => pad + ((new Date(d).getTime() - firstMs) / totalMs) * innerW;
  const toY = (v: number) => pad + innerH - ((v - min) / range) * innerH;

  const minPxGap = 65;
  const labelDates: string[] = [];
  let lastLabelX = -999;
  allDates.forEach((d) => {
    const x = dateToX(d);
    if (x - lastLabelX >= minPxGap) { labelDates.push(d); lastLabelX = x; }
  });
  if (labelDates[labelDates.length - 1] !== allDates[allDates.length - 1]) {
    labelDates.push(allDates[allDates.length - 1]);
  }

  const neutralY = mode === "werte" ? toY(5) : toY(0);

  return (
    <div>
      <div className="flex flex-wrap gap-2 mb-3">
        <button onClick={() => setMode("kumuliert")}
          className={`hud-btn ${mode === "kumuliert" ? "hud-btn-primary" : "hud-btn-outline"}`}>
          Kumulierter Trend
        </button>
        <button onClick={() => setMode("werte")}
          className={`hud-btn ${mode === "werte" ? "hud-btn-primary" : "hud-btn-outline"}`}>
          Tageswerte
        </button>
      </div>

      <div className="flex flex-wrap gap-2 mb-5">
        <button onClick={() => setCatSelection("alle")}
          className={`hud-btn ${catSelection === "alle" ? "hud-btn-primary" : "hud-btn-outline"}`}>
          Alle
        </button>
        {CATEGORIES.map((c, i) => {
          const color = CATEGORY_COLORS[i % CATEGORY_COLORS.length];
          const active = catSelection === c.key;
          return (
            <button key={c.key} onClick={() => setCatSelection(c.key)}
              className="hud-btn hud-btn-outline"
              style={active ? { borderColor: color, color, boxShadow: `0 0 14px ${color}55`, background: `${color}1a` } : {}}>
              {c.label.split(" / ")[0]}
            </button>
          );
        })}
      </div>

      <div className="hud-panel rounded-xl p-4 overflow-x-auto">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full relative z-10" style={{ minWidth: 300 }}>
          <line x1={pad} y1={pad} x2={pad} y2={pad + innerH} stroke="rgba(34,211,238,0.2)" strokeWidth="1" />
          <line x1={pad} y1={pad + innerH} x2={pad + innerW} y2={pad + innerH} stroke="rgba(34,211,238,0.2)" strokeWidth="1" />

          {[0, 0.5, 1].map((t) => {
            const v = min + t * range;
            const y = toY(v);
            return (
              <g key={t}>
                <line x1={pad} y1={y} x2={pad + innerW} y2={y} stroke="rgba(34,211,238,0.08)" strokeWidth="1" />
                <text x={pad - 6} y={y + 4} textAnchor="end" fontSize="10" fill="rgba(165,243,252,0.4)">{v.toFixed(0)}</text>
              </g>
            );
          })}

          <line x1={pad} y1={neutralY} x2={pad + innerW} y2={neutralY} stroke="rgba(148,163,184,0.4)" strokeWidth="1" strokeDasharray="4 3" />

          {series.map((s, si) => {
            if (s.points.length === 0) return null;
            const d = s.points.map((p, i) => `${i === 0 ? "M" : "L"} ${dateToX(p.date)} ${toY(p.val)}`).join(" ");
            return (
              <path
                key={si}
                d={d}
                fill="none"
                stroke={s.color}
                strokeWidth="2"
                style={{ filter: `drop-shadow(0 0 4px ${s.color}88)` }}
              />
            );
          })}

          {labelDates.map((d) => (
            <text key={d} x={dateToX(d)} y={H - 6} textAnchor="middle" fontSize="9" fill="rgba(165,243,252,0.4)">{fmtDate(d)}</text>
          ))}
        </svg>
      </div>

      <div className="flex gap-4 mt-3 text-[11px] text-cyan-300/45 flex-wrap items-center">
        {series.map((s, i) => (
          <span key={i} className="flex items-center gap-1">
            <span style={{ display: "inline-block", width: 16, height: 2, background: s.color, boxShadow: `0 0 6px ${s.color}` }}></span>
            {s.label.split(" / ")[0]}
          </span>
        ))}
      </div>
      <p className="text-[10px] text-cyan-300/25 mt-2 text-center tracking-wide">
        {mode === "kumuliert" ? "Kumulierte Abweichung von 5 (neutral)" : "Tageswerte 1–10 · gestrichelt = 5 (neutral)"}
      </p>
    </div>
  );
}
