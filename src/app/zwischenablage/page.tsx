"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { doc, setDoc, onSnapshot } from "firebase/firestore";
import { onAuthStateChanged, User } from "firebase/auth";
import { auth, db } from "@/lib/firebase";

type ClipboardData = {
  text: string;
  updatedAt: number;
};

function timeAgo(ts: number): string {
  const diffSec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (diffSec < 10) return "gerade eben";
  if (diffSec < 60) return `vor ${diffSec}s`;
  const min = Math.floor(diffSec / 60);
  if (min < 60) return `vor ${min}min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `vor ${h}h`;
  const d = Math.floor(h / 24);
  return `vor ${d}d`;
}

export default function ZwischenablagePage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [data, setData] = useState<ClipboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [manualText, setManualText] = useState("");
  const [manualMode, setManualMode] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [, forceTick] = useState(0);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      if (!u) { router.push("/"); return; }
      setUser(u);
    });
    return unsub;
  }, [router]);

  useEffect(() => {
    if (!user) return;
    const ref = doc(db, "clipboard", user.uid);
    const unsub = onSnapshot(
      ref,
      (snap) => {
        setData(snap.exists() ? (snap.data() as ClipboardData) : null);
        setLoading(false);
        setLoadError(null);
      },
      (err) => {
        console.error("[Zwischenablage] snapshot failed:", err);
        setLoadError(err.message);
        setLoading(false);
      }
    );
    return unsub;
  }, [user]);

  // "vor Xs" alle paar Sekunden auffrischen
  useEffect(() => {
    const t = setInterval(() => forceTick((n) => n + 1), 5000);
    return () => clearInterval(t);
  }, []);

  const flash = useCallback((msg: string) => {
    setStatus(msg);
    setTimeout(() => setStatus(null), 2000);
  }, []);

  const save = useCallback(async (text: string) => {
    if (!user || !text) return;
    await setDoc(doc(db, "clipboard", user.uid), { text, updatedAt: Date.now() });
  }, [user]);

  const handlePaste = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (!text) { flash("Zwischenablage ist leer."); return; }
      await save(text);
      flash("Eingefügt.");
    } catch {
      // Kein Zugriff auf die Zwischenablage (Browser/Berechtigung) → manuelles Einfügen anbieten
      setManualMode(true);
    }
  }, [save, flash]);

  const handleManualSave = useCallback(async () => {
    if (!manualText.trim()) return;
    await save(manualText);
    setManualText("");
    setManualMode(false);
    flash("Eingefügt.");
  }, [manualText, save, flash]);

  const handleCopy = useCallback(async () => {
    if (!data?.text) return;
    try {
      await navigator.clipboard.writeText(data.text);
      flash("Kopiert.");
    } catch {
      flash("Kopieren nicht möglich.");
    }
  }, [data, flash]);

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-white">
      <p className="text-gray-400 text-sm">Laden…</p>
    </div>
  );

  return (
    <div className="min-h-screen bg-white flex flex-col">
      <header className="w-full flex items-center justify-between px-6 py-4 bg-white/40 backdrop-blur-md border-b border-black/10">
        <div className="flex items-center gap-3">
          <Link href="/" className="text-sm text-gray-500 hover:text-black transition">← Zurück</Link>
          <span className="text-black/20">|</span>
          <h1 className="text-xl font-bold text-black">Zwischenablage</h1>
        </div>
      </header>

      <div className="flex-1 max-w-2xl w-full mx-auto px-6 py-8">
        <p className="text-sm text-gray-500 mb-6">
          Auf einem Gerät einfügen, auf jedem anderen Gerät sofort kopierbar.
        </p>

        {loadError && (
          <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            Verbindung zu Firestore fehlgeschlagen: {loadError}
          </div>
        )}

        <div className="flex items-center gap-3 mb-4">
          <button
            onClick={handlePaste}
            className="px-4 py-2 rounded-xl text-sm bg-black text-white hover:bg-gray-800 transition"
          >
            Einfügen
          </button>
          <button
            onClick={handleCopy}
            disabled={!data?.text}
            className="px-4 py-2 rounded-xl text-sm border border-black/20 text-gray-700 hover:bg-gray-50 transition disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Kopieren
          </button>
          {status && <span className="text-sm text-gray-500">{status}</span>}
        </div>

        {manualMode && (
          <div className="mb-6 rounded-2xl border border-black/20 bg-gray-50 p-4">
            <p className="text-xs text-gray-500 mb-2">
              Direkter Zugriff auf die Zwischenablage nicht möglich. Hier einfügen (Halten → Einfügen, oder Strg/Cmd+V):
            </p>
            <textarea
              value={manualText}
              onChange={(e) => setManualText(e.target.value)}
              autoFocus
              rows={4}
              className="w-full rounded-xl border border-black/20 bg-white px-3 py-2 text-sm text-black focus:outline-none focus:border-black/40 transition"
              placeholder="Text hier einfügen…"
            />
            <div className="mt-2 flex items-center gap-2">
              <button
                onClick={handleManualSave}
                className="px-4 py-2 rounded-xl text-sm bg-black text-white hover:bg-gray-800 transition"
              >
                Übernehmen
              </button>
              <button
                onClick={() => { setManualMode(false); setManualText(""); }}
                className="px-4 py-2 rounded-xl text-sm text-gray-500 hover:text-black transition"
              >
                Abbrechen
              </button>
            </div>
          </div>
        )}

        <div className="rounded-2xl border border-black/20 bg-gradient-to-br from-gray-200/55 via-white/35 to-gray-100/45 backdrop-blur-md p-4 shadow-sm">
          {data?.text ? (
            <>
              <p className="text-sm text-black whitespace-pre-wrap break-words">{data.text}</p>
              <p className="text-xs text-gray-400 mt-3">Aktualisiert {timeAgo(data.updatedAt)}</p>
            </>
          ) : (
            <p className="text-sm text-gray-400 text-center py-8">Noch nichts eingefügt.</p>
          )}
        </div>
      </div>
    </div>
  );
}
