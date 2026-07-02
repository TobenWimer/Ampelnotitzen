"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { doc, setDoc, onSnapshot } from "firebase/firestore";
import { onAuthStateChanged, User } from "firebase/auth";
import { auth, db } from "@/lib/firebase";

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

const CATEGORY_COLORS = ["#2563eb","#16a34a","#dc2626","#9333ea","#f59e0b","#0891b2","#db2777","#65a30d"];

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

  const today = todayIso();

  const sortedEntries = useMemo(
    () => [...data.entries].sort((a, b) => b.date.localeCompare(a.date)),
    [data.entries]
  );

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
    const unsub = onSnapshot(ref, (snap) => {
      const next = snap.exists() ? (snap.data() as DailyRecapData) : { entries: [] };
      setData(next);
      const todayEntry = next.entries.find((e) => e.date === today);
      setValues(todayEntry ? todayEntry.values : defaultValues());
      setLoading(false);
    });
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
    <div className="min-h-screen flex items-center justify-center bg-white">
      <p className="text-gray-400 text-sm">Laden…</p>
    </div>
  );

  return (
    <div className="min-h-screen bg-white flex flex-col" onClick={() => setContextMenu(null)}>
      <header className="w-full flex items-center justify-between px-6 py-4 bg-white/40 backdrop-blur-md border-b border-black/10">
        <div className="flex items-center gap-3">
          <Link href="/" className="text-sm text-gray-500 hover:text-black transition">← Zurück</Link>
          <span className="text-black/20">|</span>
          <h1 className="text-xl font-bold text-black">Daily Recap</h1>
        </div>
      </header>

      <div className="flex-1 max-w-2xl w-full mx-auto px-6 py-8">
        <div className="flex gap-1 border-b border-black/10 mb-8">
          {(["eintrag", "verlauf", "charts"] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-4 py-2 text-sm transition border-b-2 -mb-px ${tab === t ? "border-black text-black font-medium" : "border-transparent text-gray-400 hover:text-gray-700"}`}>
              {t === "eintrag" ? "Eintrag" : t === "verlauf" ? "Verlauf" : "Charts"}
            </button>
          ))}
        </div>

        {tab === "eintrag" && (
          <div>
            <p className="text-sm text-gray-500 mb-6">
              {fmtDate(today)} · 5 = gleich wie gestern, &lt;5 schlechter, &gt;5 besser
            </p>

            <div className="space-y-5">
              {CATEGORIES.map((c) => (
                <div key={c.key} className="rounded-2xl border border-black/20 bg-gradient-to-br from-gray-200/55 via-white/35 to-gray-100/45 backdrop-blur-md p-4 shadow-sm">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium text-black">{c.label}</span>
                    <span className="text-sm font-bold text-black w-6 text-right">{values[c.key]}</span>
                  </div>
                  <input
                    type="range"
                    min={1}
                    max={10}
                    step={1}
                    value={values[c.key]}
                    onChange={(e) => setValue(c.key, parseInt(e.target.value))}
                    className="w-full accent-black"
                  />
                </div>
              ))}
            </div>

            <div className="mt-8 flex items-center gap-3">
              <button
                onClick={save}
                className="px-4 py-2 rounded-xl text-sm bg-black text-white hover:bg-gray-800 transition"
              >
                Speichern
              </button>
              {saved && <span className="text-sm text-gray-500">Gespeichert.</span>}
            </div>
          </div>
        )}

        {tab === "verlauf" && (
          <div className="flex flex-col gap-3">
            {sortedEntries.length === 0 && (
              <p className="text-gray-400 text-sm text-center py-12">Noch keine Einträge.</p>
            )}
            {sortedEntries.map((e) => {
              const delta = avgDelta(e.values);
              return (
                <div key={e.date}
                  className="rounded-xl border border-black/10 p-4 bg-white cursor-context-menu select-none"
                  onContextMenu={(ev) => { ev.preventDefault(); setContextMenu({ x: ev.clientX, y: ev.clientY, date: e.date }); }}>
                  <div className="flex justify-between items-center mb-2">
                    <p className="font-medium text-black">{fmtDate(e.date)}</p>
                    <p className={`font-bold text-sm ${delta > 0 ? "text-green-600" : delta < 0 ? "text-red-500" : "text-gray-400"}`}>
                      {fmtDelta(delta)}
                    </p>
                  </div>
                  <div className="grid grid-cols-4 gap-x-3 gap-y-1">
                    {CATEGORIES.map((c) => (
                      <div key={c.key} className="flex justify-between text-xs">
                        <span className="text-gray-400">{c.label.split(" / ")[0]}</span>
                        <span className={`font-medium ${e.values[c.key] > 5 ? "text-green-600" : e.values[c.key] < 5 ? "text-red-500" : "text-gray-400"}`}>
                          {e.values[c.key]}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
            {sortedEntries.length > 0 && (
              <p className="text-xs text-gray-300 text-center mt-2">Rechtsklick auf einen Eintrag zum Löschen</p>
            )}
          </div>
        )}

        {tab === "charts" && <GraphView entries={data.entries} />}
      </div>

      {contextMenu && (
        <div className="fixed z-50 bg-white border border-black/10 rounded-xl shadow-lg py-1 min-w-[160px]"
          style={{ top: contextMenu.y, left: contextMenu.x }}
          onClick={(e) => e.stopPropagation()}>
          <button className="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50 transition"
            onClick={() => { if (confirm("Eintrag löschen?")) deleteEntry(contextMenu.date); }}>
            Löschen
          </button>
        </div>
      )}
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

  if (entries.length === 0) return <p className="text-gray-400 text-sm text-center py-12">Noch keine Daten für den Graph.</p>;

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
          className={`px-3 py-1.5 rounded-lg text-xs border transition ${mode === "kumuliert" ? "bg-black text-white border-black" : "border-black/20 text-gray-500 hover:bg-gray-50"}`}>
          Kumulierter Trend
        </button>
        <button onClick={() => setMode("werte")}
          className={`px-3 py-1.5 rounded-lg text-xs border transition ${mode === "werte" ? "bg-black text-white border-black" : "border-black/20 text-gray-500 hover:bg-gray-50"}`}>
          Tageswerte
        </button>
      </div>

      <div className="flex flex-wrap gap-2 mb-5">
        <button onClick={() => setCatSelection("alle")}
          className={`px-3 py-1.5 rounded-lg text-xs border transition ${catSelection === "alle" ? "bg-black text-white border-black" : "border-black/20 text-gray-500 hover:bg-gray-50"}`}>
          Alle
        </button>
        {CATEGORIES.map((c, i) => (
          <button key={c.key} onClick={() => setCatSelection(c.key)}
            className={`px-3 py-1.5 rounded-lg text-xs border transition ${catSelection === c.key ? "text-white border-transparent" : "border-black/20 text-gray-500 hover:bg-gray-50"}`}
            style={catSelection === c.key ? { background: CATEGORY_COLORS[i % CATEGORY_COLORS.length] } : {}}>
            {c.label.split(" / ")[0]}
          </button>
        ))}
      </div>

      <div className="rounded-xl border border-black/10 p-4 overflow-x-auto">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ minWidth: 300 }}>
          <line x1={pad} y1={pad} x2={pad} y2={pad + innerH} stroke="#e5e7eb" strokeWidth="1" />
          <line x1={pad} y1={pad + innerH} x2={pad + innerW} y2={pad + innerH} stroke="#e5e7eb" strokeWidth="1" />

          {[0, 0.5, 1].map((t) => {
            const v = min + t * range;
            const y = toY(v);
            return (
              <g key={t}>
                <line x1={pad} y1={y} x2={pad + innerW} y2={y} stroke="#f3f4f6" strokeWidth="1" />
                <text x={pad - 6} y={y + 4} textAnchor="end" fontSize="10" fill="#9ca3af">{v.toFixed(0)}</text>
              </g>
            );
          })}

          <line x1={pad} y1={neutralY} x2={pad + innerW} y2={neutralY} stroke="#d1d5db" strokeWidth="1" strokeDasharray="4 3" />

          {series.map((s, si) => {
            if (s.points.length === 0) return null;
            const d = s.points.map((p, i) => `${i === 0 ? "M" : "L"} ${dateToX(p.date)} ${toY(p.val)}`).join(" ");
            return <path key={si} d={d} fill="none" stroke={s.color} strokeWidth="2" />;
          })}

          {labelDates.map((d) => (
            <text key={d} x={dateToX(d)} y={H - 6} textAnchor="middle" fontSize="9" fill="#9ca3af">{fmtDate(d)}</text>
          ))}
        </svg>
      </div>

      <div className="flex gap-4 mt-3 text-xs text-gray-400 flex-wrap items-center">
        {series.map((s, i) => (
          <span key={i} className="flex items-center gap-1">
            <span style={{ display: "inline-block", width: 16, height: 2, background: s.color }}></span>
            {s.label.split(" / ")[0]}
          </span>
        ))}
      </div>
      <p className="text-xs text-gray-300 mt-2 text-center">
        {mode === "kumuliert" ? "Kumulierte Abweichung von 5 (neutral)" : "Tageswerte 1–10 · gestrichelt = 5 (neutral)"}
      </p>
    </div>
  );
}
