"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { doc, setDoc, onSnapshot } from "firebase/firestore";
import { onAuthStateChanged, User } from "firebase/auth";
import { auth, db } from "@/lib/firebase";

type Trade = {
  asset: string;
  type: string;
  investedChf: number;
  receivedAmt: number;
  currency: string;
  entryFx: number;
  entryDate: string;
};

type HistoryEntry = {
  date: string;
  chf: number;
  plChf: number;
  plPct: number;
};

type GlobalHistoryEntry = {
  potNr: number;
  asset: string;
  type: string;
  entryDate: string;
  closeDate: string;
  investedChf: number;
  currency: string;
  receivedAmt: number;
  exitAmt: number;
  entryFx: number;
  exitChf: number;
  plChf: number;
  plPct: number;
};

type Pot = {
  nr: number;
  trade: Trade | null;
  history: HistoryEntry[];
  availableChf: number | null;
};

type TrackerData = {
  pots: Pot[];
  history: GlobalHistoryEntry[];
};

type ModalState =
  | { type: "entry"; potIndex: number }
  | { type: "detail"; potIndex: number }
  | null;

type ContextMenu = {
  x: number; y: number; kind: "history"; index: number;
} | {
  x: number; y: number; kind: "pot"; index: number;
} | null;

type PotSelection = "gesamt" | "alle" | number;

const fmt = (n: number, currency = "CHF") =>
  `${n >= 0 ? "+" : ""}${n.toFixed(2)} ${currency}`;
const fmtAbs = (n: number, currency = "CHF") =>
  `${n.toFixed(2)} ${currency}`;
const fmtPct = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;

const MONTH_SHORT = ["Jan","Feb","Mär","Apr","Mai","Jun","Jul","Aug","Sep","Okt","Nov","Dez"];
const fmtDate = (iso: string) => {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${d}.${MONTH_SHORT[parseInt(m) - 1]}.${y.slice(2)}`;
};

const CURRENCIES = ["CHF", "USD", "EUR", "JPY", "GBP", "Andere"];
const TYPES = ["Aktie", "Krypto", "Forex", "ETF", "Andere"];

const inputCls = "w-full rounded-xl border border-black/20 bg-gray-50 px-3 py-2 text-sm text-black focus:outline-none focus:border-black/40 transition";
const btnCls = "px-4 py-2 rounded-xl text-sm border border-black/20 text-gray-700 hover:bg-gray-50 transition";
const btnPrimaryCls = "px-4 py-2 rounded-xl text-sm bg-black text-white hover:bg-gray-800 transition";
const POT_COLORS = ["#2563eb","#16a34a","#dc2626","#9333ea","#f59e0b","#0891b2","#db2777","#65a30d"];

// ── Timeline builders ──────────────────────────────────────────────────────

// Gesamtwert-Mode: zeigt den aktuellen CHF-Wert des Pots über Zeit
// Startet beim ersten investedChf, springt bei jedem Close auf exitChf,
// bleibt flat danach. Offener Trade: flat auf investedChf bis heute.
function buildPotTimeline(
  potNr: number,
  history: GlobalHistoryEntry[],
  allPots: Pot[],
  today: string
): { date: string; val: number; isClose: boolean }[] {
  const potHistory = [...history.filter(h => h.potNr === potNr)]
    .sort((a, b) => a.entryDate.localeCompare(b.entryDate) || a.closeDate.localeCompare(b.closeDate));

  const pot = allPots.find(p => p.nr === potNr);
  if (potHistory.length === 0 && !pot?.trade) return [];

  const points: { date: string; val: number; isClose: boolean }[] = [];
  let currentVal = 0;

  potHistory.forEach((h, i) => {
    if (i === 0) {
      // Allererster Entry: starte bei investedChf
      points.push({ date: h.entryDate, val: h.investedChf, isClose: false });
    } else {
      // Weiterer Trade: Entry zeigt aktuellen Stand (exitChf des vorherigen)
      points.push({ date: h.entryDate, val: currentVal, isClose: false });
      // Dann springe auf investedChf dieses Trades (das Kapital ist jetzt investiert)
      points.push({ date: h.entryDate, val: h.investedChf + (currentVal - currentVal), isClose: false });
    }
    currentVal = h.exitChf;
    points.push({ date: h.closeDate, val: currentVal, isClose: true });
  });

  if (pot?.trade) {
    const t = pot.trade;
    if (potHistory.length === 0) {
      // Nur offener Trade, keine History
      points.push({ date: t.entryDate, val: t.investedChf, isClose: false });
    } else {
      points.push({ date: t.entryDate, val: t.investedChf, isClose: false });
    }
    points.push({ date: today, val: t.investedChf, isClose: false });
  } else if (potHistory.length > 0) {
    // Freier Pot: bleibt flat auf letztem exitChf bis heute
    points.push({ date: today, val: currentVal, isClose: false });
  }

  // Deduplizieren: gleicher Datum → letzter Wert
  const map = new Map<string, { val: number; isClose: boolean }>();
  points.forEach(p => map.set(p.date, { val: p.val, isClose: p.isClose }));
  return [...map.entries()]
    .map(([date, { val, isClose }]) => ({ date, val, isClose }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

// P/L-Mode: zeigt kumulierten realisierten Gewinn über Zeit
// Startet bei 0, springt bei jedem Close um plChf
function buildPlTimeline(
  potNr: number,
  history: GlobalHistoryEntry[],
  allPots: Pot[],
  today: string
): { date: string; val: number; isClose: boolean }[] {
  const potHistory = [...history.filter(h => h.potNr === potNr)]
    .sort((a, b) => a.entryDate.localeCompare(b.entryDate) || a.closeDate.localeCompare(b.closeDate));

  const pot = allPots.find(p => p.nr === potNr);
  if (potHistory.length === 0 && !pot?.trade) return [];

  const points: { date: string; val: number; isClose: boolean }[] = [];
  let cumPl = 0;

  const firstDate = potHistory.length > 0 ? potHistory[0].entryDate : pot?.trade?.entryDate ?? today;
  points.push({ date: firstDate, val: 0, isClose: false });

  potHistory.forEach(h => {
    points.push({ date: h.entryDate, val: cumPl, isClose: false });
    cumPl += h.plChf;
    points.push({ date: h.closeDate, val: cumPl, isClose: true });
  });

  if (pot?.trade) {
    points.push({ date: pot.trade.entryDate, val: cumPl, isClose: false });
    points.push({ date: today, val: cumPl, isClose: false });
  } else {
    points.push({ date: today, val: cumPl, isClose: false });
  }

  const map = new Map<string, { val: number; isClose: boolean }>();
  points.forEach(p => map.set(p.date, { val: p.val, isClose: p.isClose }));
  return [...map.entries()]
    .map(([date, { val, isClose }]) => ({ date, val, isClose }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

// Interpoliert den Wert einer Timeline an einem bestimmten Datum
function interpolateVal(timeline: { date: string; val: number }[], date: string): number {
  if (timeline.length === 0) return 0;
  const before = [...timeline].reverse().find(p => p.date <= date);
  return before ? before.val : 0;
}

function makePath(
  points: { date: string; val: number }[],
  dateToX: (d: string) => number,
  toY: (v: number) => number,
  brick: boolean
): string {
  if (points.length === 0) return "";
  if (!brick) {
    return points.map((p, i) => `${i === 0 ? "M" : "L"} ${dateToX(p.date)} ${toY(p.val)}`).join(" ");
  }
  let d = `M ${dateToX(points[0].date)} ${toY(points[0].val)}`;
  for (let i = 1; i < points.length; i++) {
    d += ` H ${dateToX(points[i].date)} V ${toY(points[i].val)}`;
  }
  return d;
}

// ── Main ───────────────────────────────────────────────────────────────────

export default function TrackerPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [data, setData] = useState<TrackerData>({ pots: [], history: [] });
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"pots" | "history" | "graph">("pots");
  const [modal, setModal] = useState<ModalState>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenu>(null);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      if (!u) { router.push("/"); return; }
      setUser(u);
    });
    return unsub;
  }, [router]);

  useEffect(() => {
    if (!user) return;
    const ref = doc(db, "tracker", user.uid);
    const unsub = onSnapshot(ref, (snap) => {
      if (snap.exists()) setData(snap.data() as TrackerData);
      else setData({ pots: [], history: [] });
      setLoading(false);
    });
    return unsub;
  }, [user]);

  useEffect(() => {
    const close = () => setContextMenu(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, []);

  const save = useCallback(async (next: TrackerData) => {
    if (!user) return;
    setData(next);
    await setDoc(doc(db, "tracker", user.uid), next);
  }, [user]);

  const addPot = useCallback(() => {
    const nr = data.pots.length > 0 ? Math.max(...data.pots.map(p => p.nr)) + 1 : 1;
    save({ ...data, pots: [...data.pots, { nr, trade: null, history: [], availableChf: null }] });
  }, [data, save]);

  const deletePot = useCallback((i: number) => {
    save({ ...data, pots: data.pots.filter((_, idx) => idx !== i) });
    setContextMenu(null);
  }, [data, save]);

  const submitEntry = useCallback((potIndex: number, fields: { asset: string; type: string; chf: number; recv: number; currency: string; date: string }) => {
    const { asset, type, chf, recv, currency, date } = fields;
    const fx = currency === "CHF" ? 1 : chf / recv;
    const next = { ...data, pots: [...data.pots] };
    next.pots[potIndex] = {
      ...next.pots[potIndex],
      trade: { asset, type, investedChf: chf, receivedAmt: recv, currency, entryFx: fx, entryDate: date },
      availableChf: null,
    };
    save(next);
    setModal(null);
  }, [data, save]);

  const closeTrade = useCallback((potIndex: number, exitAmt: number, closeDate: string) => {
    const pot = data.pots[potIndex];
    if (!pot.trade) return;
    const t = pot.trade;
    const exitChf = exitAmt * t.entryFx;
    const plChf = exitChf - t.investedChf;
    const plPct = (plChf / t.investedChf) * 100;
    const histEntry: GlobalHistoryEntry = {
      potNr: pot.nr, asset: t.asset, type: t.type, entryDate: t.entryDate,
      closeDate, investedChf: t.investedChf, currency: t.currency,
      receivedAmt: t.receivedAmt, exitAmt, entryFx: t.entryFx, exitChf, plChf, plPct,
    };
    const next = { ...data, pots: [...data.pots], history: [histEntry, ...data.history] };
    next.pots[potIndex] = {
      ...pot, trade: null, availableChf: exitChf,
      history: [...(pot.history || []), { date: closeDate, chf: exitChf, plChf, plPct }],
    };
    save(next);
    setModal(null);
  }, [data, save]);

  const deleteHistory = useCallback((i: number) => {
    save({ ...data, history: data.history.filter((_, idx) => idx !== i) });
    setContextMenu(null);
  }, [data, save]);

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-white">
      <p className="text-gray-400 text-sm">Laden…</p>
    </div>
  );

  const totalInvested = data.pots.reduce((s, p) => s + (p.trade?.investedChf ?? 0), 0);
  const openPots = data.pots.filter(p => p.trade).length;
  const freePots = data.pots.filter(p => !p.trade).length;

  return (
    <div className="min-h-screen bg-white flex flex-col" onClick={() => setContextMenu(null)}>
      <header className="w-full flex items-center justify-between px-6 py-4 bg-white/40 backdrop-blur-md border-b border-black/10">
        <div className="flex items-center gap-3">
          <Link href="/" className="text-sm text-gray-500 hover:text-black transition">← Zurück</Link>
          <span className="text-black/20">|</span>
          <h1 className="text-xl font-bold text-black">Investment Tracker</h1>
        </div>
      </header>

      <div className="flex-1 max-w-4xl mx-auto px-6 py-8 w-full">
        <div className="flex gap-1 border-b border-black/10 mb-8">
          {(["pots", "history", "graph"] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-4 py-2 text-sm transition border-b-2 -mb-px ${tab === t ? "border-black text-black font-medium" : "border-transparent text-gray-400 hover:text-gray-700"}`}>
              {t === "pots" ? "Pots" : t === "history" ? "History" : "Graph"}
            </button>
          ))}
        </div>

        {tab === "pots" && (
          <div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
              {[
                { label: "Investiert", value: fmtAbs(totalInvested) },
                { label: "Offene Pots", value: String(openPots) },
                { label: "Freie Pots", value: String(freePots) },
                { label: "Pots total", value: String(data.pots.length) },
              ].map(k => (
                <div key={k.label} className="rounded-xl bg-gray-50 border border-black/10 p-4">
                  <p className="text-xs text-gray-400 mb-1">{k.label}</p>
                  <p className="text-lg font-bold text-black">{k.value}</p>
                </div>
              ))}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {data.pots.map((pot, i) => (
                <PotCard key={pot.nr} pot={pot}
                  onClick={() => setModal(pot.trade ? { type: "detail", potIndex: i } : { type: "entry", potIndex: i })}
                  onContextMenu={e => { e.preventDefault(); setContextMenu({ x: e.clientX, y: e.clientY, kind: "pot", index: i }); }}
                />
              ))}
              <button onClick={addPot}
                className="rounded-2xl border border-dashed border-black/20 p-5 text-gray-400 text-sm hover:border-black/40 hover:text-gray-600 transition flex items-center justify-center gap-2 min-h-[100px]">
                + Neuer Pot
              </button>
            </div>
            <p className="text-xs text-gray-300 text-center mt-4">Rechtsklick auf einen Pot zum Löschen</p>
          </div>
        )}

        {tab === "history" && (
          <div className="flex flex-col gap-3">
            {data.history.length === 0 && <p className="text-gray-400 text-sm text-center py-12">Noch keine abgeschlossenen Trades.</p>}
            {data.history.map((h, i) => (
              <div key={i}
                className="rounded-xl border border-black/10 p-4 flex justify-between items-center bg-white cursor-context-menu select-none"
                onContextMenu={e => { e.preventDefault(); setContextMenu({ x: e.clientX, y: e.clientY, kind: "history", index: i }); }}>
                <div>
                  <p className="font-medium text-black">Pot {h.potNr} · {h.asset}</p>
                  <p className="text-xs text-gray-400 mt-0.5">{h.type} · {fmtDate(h.entryDate)} → {fmtDate(h.closeDate)}</p>
                  <p className="text-xs text-gray-400">{fmtAbs(h.investedChf)} CHF · {h.receivedAmt.toFixed(4)} {h.currency} → {h.exitAmt.toFixed(4)} {h.currency}</p>
                </div>
                <div className="text-right">
                  <p className={`font-bold text-sm ${h.plChf >= 0 ? "text-green-600" : "text-red-500"}`}>{fmtPct(h.plPct)}</p>
                  <p className={`text-sm ${h.plChf >= 0 ? "text-green-600" : "text-red-500"}`}>{fmt(h.plChf)}</p>
                  <p className="text-xs text-gray-400 mt-0.5">{fmtAbs(h.exitChf)} CHF</p>
                </div>
              </div>
            ))}
            <p className="text-xs text-gray-300 text-center mt-2">Rechtsklick auf einen Eintrag zum Löschen</p>
          </div>
        )}

        {tab === "graph" && <GraphView history={data.history} allPots={data.pots} />}
      </div>

      {contextMenu && (
        <div className="fixed z-50 bg-white border border-black/10 rounded-xl shadow-lg py-1 min-w-[160px]"
          style={{ top: contextMenu.y, left: contextMenu.x }}
          onClick={e => e.stopPropagation()}>
          {contextMenu.kind === "pot" && (
            <>
              <div className="px-4 py-1.5 text-xs text-gray-400 border-b border-black/5">Pot {data.pots[contextMenu.index]?.nr}</div>
              <button className="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50 transition"
                onClick={() => { if (confirm("Pot wirklich löschen?")) deletePot(contextMenu.index); }}>
                Pot löschen
              </button>
            </>
          )}
          {contextMenu.kind === "history" && (
            <button className="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50 transition"
              onClick={() => { if (confirm("Trade löschen?")) deleteHistory(contextMenu.index); }}>
              Löschen
            </button>
          )}
        </div>
      )}

      {modal !== null && modal.type === "entry" && (
        <EntryModal pot={data.pots[modal.potIndex]} onClose={() => setModal(null)}
          onSubmit={fields => submitEntry((modal as { type: "entry"; potIndex: number }).potIndex, fields)} />
      )}
      {modal !== null && modal.type === "detail" && (
        <DetailModal pot={data.pots[modal.potIndex]} onClose={() => setModal(null)}
          onCloseTrade={(exitAmt, closeDate) => closeTrade((modal as { type: "detail"; potIndex: number }).potIndex, exitAmt, closeDate)} />
      )}
    </div>
  );
}

// ── Components ─────────────────────────────────────────────────────────────

function PotCard({ pot, onClick, onContextMenu }: { pot: Pot; onClick: () => void; onContextMenu: (e: React.MouseEvent) => void }) {
  const t = pot.trade;
  return (
    <button onClick={onClick} onContextMenu={onContextMenu}
      className="rounded-2xl border border-black/20 bg-gradient-to-br from-gray-200/55 via-white/35 to-gray-100/45 backdrop-blur-md p-5 shadow-sm hover:shadow-md hover:border-black/40 transition text-left">
      <p className="text-xs text-gray-400 mb-1">Pot {pot.nr}</p>
      {t ? (
        <>
          <p className="text-base font-bold text-black mb-1">{t.asset}</p>
          <p className="text-sm text-gray-600">{fmtAbs(t.investedChf)} CHF investiert</p>
          <p className="text-xs text-gray-400">{t.receivedAmt.toFixed(4)} {t.currency}</p>
          <span className="inline-block mt-2 text-xs px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-100">Offen</span>
        </>
      ) : (
        <>
          <p className="text-sm text-gray-400 mb-1">Frei</p>
          {pot.availableChf && <p className="text-xs text-blue-500">{pot.availableChf.toFixed(2)} CHF verfügbar</p>}
          <span className="inline-block mt-2 text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-400">Kein Trade</span>
        </>
      )}
    </button>
  );
}

function EntryModal({ pot, onClose, onSubmit }: {
  pot: Pot; onClose: () => void;
  onSubmit: (f: { asset: string; type: string; chf: number; recv: number; currency: string; date: string }) => void;
}) {
  const [asset, setAsset] = useState("");
  const [type, setType] = useState("Aktie");
  const [chf, setChf] = useState(pot.availableChf ? pot.availableChf.toFixed(2) : "");
  const [recv, setRecv] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const fx = currency !== "CHF" && recv && chf ? (parseFloat(chf) / parseFloat(recv)).toFixed(4) : null;
  const handleSubmit = () => {
    const c = parseFloat(chf), r = parseFloat(recv);
    if (!asset || isNaN(c) || isNaN(r)) { alert("Bitte alle Felder ausfüllen."); return; }
    onSubmit({ asset, type, chf: c, recv: r, currency, date });
  };
  return (
    <Modal title={`Pot ${pot.nr} — Trade eröffnen`} onClose={onClose}>
      {pot.availableChf && (
        <div className="mb-4 p-3 rounded-lg bg-blue-50 border border-blue-100 text-xs text-blue-700">
          Verfügbar: <strong>{pot.availableChf.toFixed(2)} CHF</strong>
        </div>
      )}
      <Field label="Asset"><input value={asset} onChange={e => setAsset(e.target.value)} placeholder="z.B. Nvidia, BTC" className={inputCls} /></Field>
      <Field label="Typ"><select value={type} onChange={e => setType(e.target.value)} className={inputCls}>{TYPES.map(t => <option key={t}>{t}</option>)}</select></Field>
      <Field label="CHF abgebucht"><input type="number" value={chf} onChange={e => setChf(e.target.value)} placeholder="500" className={inputCls} /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Betrag erhalten"><input type="number" value={recv} onChange={e => setRecv(e.target.value)} placeholder="460" className={inputCls} /></Field>
        <Field label="Währung"><select value={currency} onChange={e => setCurrency(e.target.value)} className={inputCls}>{CURRENCIES.map(c => <option key={c}>{c}</option>)}</select></Field>
      </div>
      {fx && <p className="text-xs text-gray-400 mb-3">FX-Kurs: 1 {currency} = {fx} CHF</p>}
      <Field label="Datum"><input type="date" value={date} onChange={e => setDate(e.target.value)} className={inputCls} /></Field>
      <div className="flex gap-2 justify-end mt-5">
        <button onClick={onClose} className={btnCls}>Abbrechen</button>
        <button onClick={handleSubmit} className={btnPrimaryCls}>Entry bestätigen</button>
      </div>
    </Modal>
  );
}

function DetailModal({ pot, onClose, onCloseTrade }: {
  pot: Pot; onClose: () => void; onCloseTrade: (exitAmt: number, closeDate: string) => void;
}) {
  const t = pot.trade!;
  const [exitAmt, setExitAmt] = useState("");
  const [closeDate, setCloseDate] = useState(new Date().toISOString().slice(0, 10));
  const [preview, setPreview] = useState<{ plChf: number; plPct: number } | null>(null);
  const updatePreview = (val: string) => {
    setExitAmt(val);
    const n = parseFloat(val);
    if (isNaN(n)) { setPreview(null); return; }
    const exitChf = n * t.entryFx;
    const plChf = exitChf - t.investedChf;
    setPreview({ plChf, plPct: (plChf / t.investedChf) * 100 });
  };
  const handleClose = () => {
    const n = parseFloat(exitAmt);
    if (isNaN(n)) { alert("Bitte Ausstiegsbetrag eingeben."); return; }
    onCloseTrade(n, closeDate);
  };
  return (
    <Modal title={`Pot ${pot.nr} · ${t.asset}`} onClose={onClose}>
      <div className="grid grid-cols-2 gap-3 mb-4">
        {[
          { label: "Investiert", value: fmtAbs(t.investedChf) + " CHF" },
          { label: `Betrag (${t.currency})`, value: t.receivedAmt.toFixed(4) + " " + t.currency },
          { label: "Entry FX", value: t.currency === "CHF" ? "—" : t.entryFx.toFixed(4) },
          { label: "Datum", value: fmtDate(t.entryDate) },
        ].map(k => (
          <div key={k.label} className="rounded-lg bg-gray-50 border border-black/10 p-3">
            <p className="text-xs text-gray-400 mb-0.5">{k.label}</p>
            <p className="text-sm font-medium text-black">{k.value}</p>
          </div>
        ))}
      </div>
      <Field label={`Aktueller Wert (${t.currency}) — P/L Vorschau`}>
        <input type="number" placeholder={t.receivedAmt.toFixed(4)} onChange={e => updatePreview(e.target.value)} className={inputCls} />
      </Field>
      {preview && (
        <p className={`text-sm mb-3 ${preview.plChf >= 0 ? "text-green-600" : "text-red-500"}`}>
          P/L: {fmt(preview.plChf)} CHF / {fmtPct(preview.plPct)}
        </p>
      )}
      <div className="border-t border-black/10 pt-4 mt-2">
        <p className="text-xs font-medium text-gray-400 mb-3 uppercase tracking-wide">Trade schliessen</p>
        <Field label={`Ausstiegsbetrag (${t.currency})`}>
          <input type="number" value={exitAmt} onChange={e => updatePreview(e.target.value)} placeholder="z.B. 580" className={inputCls} />
        </Field>
        <Field label="Closing-Datum">
          <input type="date" value={closeDate} onChange={e => setCloseDate(e.target.value)} className={inputCls} />
        </Field>
      </div>
      <div className="flex gap-2 justify-end mt-5">
        <button onClick={onClose} className={btnCls}>Abbrechen</button>
        <button onClick={handleClose} className="px-4 py-2 rounded-xl text-sm border border-red-200 text-red-600 hover:bg-red-50 transition">Trade schliessen</button>
      </div>
    </Modal>
  );
}

// ── GraphView ──────────────────────────────────────────────────────────────

function GraphView({ history, allPots }: { history: GlobalHistoryEntry[]; allPots: Pot[] }) {
  const [mode, setMode] = useState<"pl" | "total">("pl");
  const [potSelection, setPotSelection] = useState<PotSelection>("gesamt");
  const [brick, setBrick] = useState(false);

  const today = new Date().toISOString().slice(0, 10);
  const potNrs = [...new Set([
    ...history.map(h => h.potNr),
    ...allPots.filter(p => p.trade || (p.availableChf ?? 0) > 0).map(p => p.nr),
  ])].sort((a, b) => a - b);

  if (potNrs.length === 0) return <p className="text-gray-400 text-sm text-center py-12">Noch keine Daten für den Graph.</p>;

  const handlePotBtn = (nr: number) => setPotSelection(prev => prev === nr ? "gesamt" : nr);

  type Series = { label: string; color: string; points: { date: string; val: number; isClose: boolean }[] };
  const series: Series[] = [];

  const getTimeline = (nr: number) =>
    mode === "total"
      ? buildPotTimeline(nr, history, allPots, today)
      : buildPlTimeline(nr, history, allPots, today);

  if (potSelection === "gesamt") {
    const allTimelines = potNrs.map(nr => getTimeline(nr));
    const allDates = [...new Set(allTimelines.flatMap(t => t.map(p => p.date)))].sort();
    const points = allDates.map(date => ({
      date,
      val: parseFloat(allTimelines.reduce((sum, tl) => sum + interpolateVal(tl, date), 0).toFixed(2)),
      isClose: false,
    }));
    series.push({ label: "Gesamt", color: "#2563eb", points });
  } else if (potSelection === "alle") {
    potNrs.forEach((nr, i) => {
      const tl = getTimeline(nr);
      if (tl.length > 0) series.push({ label: `Pot ${nr}`, color: POT_COLORS[i % POT_COLORS.length], points: tl });
    });
  } else {
    const nr = potSelection as number;
    const i = potNrs.indexOf(nr);
    const tl = getTimeline(nr);
    series.push({ label: `Pot ${nr}`, color: POT_COLORS[i % POT_COLORS.length], points: tl });
  }

  const allVals = series.flatMap(s => s.points.map(p => p.val));
  const allDates = [...new Set(series.flatMap(s => s.points.map(p => p.date)))].sort();

  if (allDates.length === 0) return <p className="text-gray-400 text-sm text-center py-12">Noch keine Daten.</p>;

  const max = Math.max(...allVals, 0);
  const min = Math.min(...allVals, 0);
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
  allDates.forEach(d => {
    const x = dateToX(d);
    if (x - lastLabelX >= minPxGap) { labelDates.push(d); lastLabelX = x; }
  });
  if (labelDates[labelDates.length - 1] !== allDates[allDates.length - 1]) {
    labelDates.push(allDates[allDates.length - 1]);
  }

  return (
    <div>
      <div className="flex flex-wrap gap-3 mb-3 items-center">
        <div className="flex gap-2 items-center">
          <button onClick={() => setMode("pl")}
            className={`px-3 py-1.5 rounded-lg text-xs border transition ${mode === "pl" ? "bg-black text-white border-black" : "border-black/20 text-gray-500 hover:bg-gray-50"}`}>
            Nur P/L
          </button>
          <button onClick={() => setMode("total")}
            className={`px-3 py-1.5 rounded-lg text-xs border transition ${mode === "total" ? "bg-black text-white border-black" : "border-black/20 text-gray-500 hover:bg-gray-50"}`}>
            Gesamtwert
          </button>
          <button onClick={() => setBrick(b => !b)} title="Brick-Modus"
            className={`px-3 py-1.5 rounded-lg text-xs border transition flex items-center gap-1.5 ${brick ? "bg-black text-white border-black" : "border-black/20 text-gray-500 hover:bg-gray-50"}`}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
              <path d="M1 12 H4 V8 H7 V5 H10 V2 H13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            Brick
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 mb-5">
        {(["gesamt", "alle"] as const).map(v => (
          <button key={v} onClick={() => setPotSelection(v)}
            className={`px-3 py-1.5 rounded-lg text-xs border transition ${potSelection === v ? "bg-black text-white border-black" : "border-black/20 text-gray-500 hover:bg-gray-50"}`}>
            {v.charAt(0).toUpperCase() + v.slice(1)}
          </button>
        ))}
        {potNrs.map((nr, i) => (
          <button key={nr} onClick={() => handlePotBtn(nr)}
            className={`px-3 py-1.5 rounded-lg text-xs border transition ${potSelection === nr ? "text-white border-transparent" : "border-black/20 text-gray-500 hover:bg-gray-50"}`}
            style={potSelection === nr ? { background: POT_COLORS[i % POT_COLORS.length] } : {}}>
            Pot {nr}
          </button>
        ))}
      </div>

      <div className="rounded-xl border border-black/10 p-4 overflow-x-auto">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ minWidth: 300 }}>
          <line x1={pad} y1={pad} x2={pad} y2={pad + innerH} stroke="#e5e7eb" strokeWidth="1" />
          <line x1={pad} y1={pad + innerH} x2={pad + innerW} y2={pad + innerH} stroke="#e5e7eb" strokeWidth="1" />

          {[0, 0.5, 1].map(t => {
            const v = min + t * range;
            const y = toY(v);
            return (
              <g key={t}>
                <line x1={pad} y1={y} x2={pad + innerW} y2={y} stroke="#f3f4f6" strokeWidth="1" />
                <text x={pad - 6} y={y + 4} textAnchor="end" fontSize="10" fill="#9ca3af">{v.toFixed(0)}</text>
              </g>
            );
          })}

          {series.map((s, si) => {
            const path = makePath(s.points, dateToX, toY, brick);
            return path ? <path key={si} d={path} fill="none" stroke={s.color} strokeWidth="2" /> : null;
          })}

          {series.map((s, si) =>
            s.points.filter(p => p.isClose).map((p, i) => (
              <circle key={`${si}-${i}`} cx={dateToX(p.date)} cy={toY(p.val)} r="3" fill={s.color} />
            ))
          )}

          {labelDates.map(d => (
            <text key={d} x={dateToX(d)} y={H - 6} textAnchor="middle" fontSize="9" fill="#9ca3af">{fmtDate(d)}</text>
          ))}
        </svg>
      </div>

      <div className="flex gap-4 mt-3 text-xs text-gray-400 flex-wrap items-center">
        {series.map((s, i) => (
          <span key={i} className="flex items-center gap-1">
            <span style={{ display: "inline-block", width: 16, height: 2, background: s.color }}></span>
            {s.label}
          </span>
        ))}
        {brick && (
          <span className="flex items-center gap-1 text-gray-300">
            <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
              <path d="M1 12 H4 V8 H7 V5 H10 V2 H13" stroke="#d1d5db" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            Brick-Modus aktiv
          </span>
        )}
      </div>
      <p className="text-xs text-gray-300 mt-2 text-center">
        {mode === "pl" ? "P/L in CHF" : "Gesamtwert in CHF"} · aktualisiert bei Trade-Abschluss
      </p>
    </div>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-white rounded-2xl border border-black/10 p-6 w-full max-w-sm shadow-xl">
        <h3 className="text-base font-bold text-black mb-4">{title}</h3>
        {children}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-3">
      <label className="block text-xs text-gray-400 mb-1">{label}</label>
      {children}
    </div>
  );
}