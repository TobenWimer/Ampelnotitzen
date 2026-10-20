"use client";

// Aurora (Jarvis v1): Chat-Oberflaeche im HUD-Stil der App, mobil-first.
// Die echte Sperre sitzt in /api/jarvis/chat (requireOwner); diese Seite zeigt Fremden nur eine Fehlermeldung.

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { onAuthStateChanged, type User } from "firebase/auth";
import { SendHorizontal, RotateCcw } from "lucide-react";
import Protected from "@/components/Protected";
import { auth } from "@/lib/firebase";
import HudGlobalStyles from "@/components/hud/HudGlobalStyles";
import { ReactorEmblem } from "@/components/hud/ReactorEmblem";

type Mode = "fast" | "normal" | "deep";
type Usage = {
  model: string;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  calls: number;
  searches?: number;
  costUsd: number;
  ms: number;
  gate?: string;
  warn?: string;
};
type Msg = { role: "user" | "assistant"; content: string; meta?: string };

const MODES: { key: Mode; label: string; hint: string }[] = [
  { key: "fast", label: "Schnell", hint: "Haiku 5.5, am guenstigsten" },
  { key: "normal", label: "Normal", hint: "Sonnet 5.5" },
  { key: "deep", label: "Gruendlich", hint: "Opus 5.5, am teuersten" },
];
const MODE_STORAGE_KEY = "aurora-mode";
const MODEL_SHORT: Record<string, string> = {
  "claude-haiku-5-5": "Haiku",
  "claude-sonnet-5-5": "Sonnet",
  "claude-opus-5-5": "Opus",
};

function metaOf(u: Usage): string {
  const parts = [
    MODEL_SHORT[u.model] ?? u.model,
    `${(u.costUsd * 100).toFixed(2)} ct`,
    `${(u.ms / 1000).toFixed(1)} s`,
  ];
  if (u.searches) parts.push(`${u.searches}x Suche`);
  if (u.gate) parts.push(`Kuerzer ${u.gate}`);
  if (u.warn) parts.push(u.warn);
  return parts.join(" · ");
}

export default function JarvisPage() {
  const [user, setUser] = useState<User | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [mode, setMode] = useState<Mode>("fast");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => onAuthStateChanged(auth, setUser), []);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(MODE_STORAGE_KEY);
      if (saved === "fast" || saved === "normal" || saved === "deep") setMode(saved);
    } catch {
      // localStorage nicht verfuegbar: Voreinstellung bleibt
    }
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy]);

  function pickMode(next: Mode) {
    setMode(next);
    try {
      localStorage.setItem(MODE_STORAGE_KEY, next);
    } catch {
      // egal
    }
  }

  async function send() {
    const text = input.trim();
    if (!text || busy || !user) return;
    const next: Msg[] = [...messages, { role: "user", content: text }];
    setMessages(next);
    setInput("");
    setBusy(true);
    setError(null);
    try {
      const token = await user.getIdToken();
      const res = await fetch("/api/jarvis/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        // Nur Rolle und Text schicken, die Meta-Zeile bleibt lokal
        body: JSON.stringify({ messages: next.map(({ role, content }) => ({ role, content })), mode }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(
          res.status === 403
            ? "Kein Zugriff. Aurora gehoert nur Timon."
            : `Fehler ${res.status}: ${data.error ?? "unbekannt"}${data.detail ? ` (${data.detail})` : ""}`
        );
        setMessages(messages);
        setInput(text);
        return;
      }
      setMessages([...next, { role: "assistant", content: data.reply, meta: metaOf(data.usage) }]);
    } catch {
      setError("Netzwerkfehler");
      setMessages(messages);
      setInput(text);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Protected>
      <div className="h-[100dvh] hud-bg text-cyan-50 flex flex-col relative overflow-hidden font-mono">
        <div className="hud-grid pointer-events-none absolute inset-0" />

        {/* Einheitliche Kopfzeile wie in den anderen Modulen */}
        <header className="relative z-10 w-full flex items-center justify-between px-4 sm:px-6 py-3 border-b border-cyan-400/20 bg-black/20 backdrop-blur-sm">
          <div className="flex items-center gap-3">
            <Link href="/" className="text-xs tracking-widest text-cyan-400/70 hover:text-cyan-300 transition uppercase">
              ← Zurück
            </Link>
            <span className="text-cyan-400/20">|</span>
            <h1 className="hud-title text-lg font-bold text-cyan-100 uppercase">Aurora</h1>
          </div>
          <div className="flex items-center gap-3">
            {messages.length > 0 && (
              <button
                onClick={() => {
                  setMessages([]);
                  setError(null);
                }}
                title="Neues Gespräch"
                className="text-cyan-400/50 hover:text-cyan-200 transition p-1.5 -m-1.5"
              >
                <RotateCcw size={15} />
              </button>
            )}
            <span className="flex items-center gap-1.5 text-[10px] tracking-[0.2em] text-cyan-400/70 uppercase">
              <span className="hud-dot h-1.5 w-1.5 rounded-full bg-cyan-400" />
              Online
            </span>
          </div>
        </header>

        {/* Gespraech */}
        <div className="relative z-10 flex-1 overflow-y-auto">
          <div className="max-w-2xl mx-auto w-full px-4 sm:px-6 py-6 flex flex-col gap-4 min-h-full">
            {messages.length === 0 && !busy && (
              <div className="flex-1 flex flex-col items-center justify-center text-center gap-5 py-10">
                <ReactorEmblem active className="w-24 h-24 sm:w-28 sm:h-28" />
                <p className="text-xs tracking-[0.25em] text-cyan-300/50 uppercase">Aurora bereit</p>
              </div>
            )}

            {messages.map((m, i) =>
              m.role === "user" ? (
                <div key={i} className="self-end max-w-[85%]">
                  <div
                    className="rounded-2xl rounded-br-sm px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap"
                    style={{
                      background: "linear-gradient(135deg, rgba(34,211,238,0.18), rgba(34,211,238,0.06))",
                      border: "1px solid rgba(34,211,238,0.35)",
                    }}
                  >
                    {m.content}
                  </div>
                </div>
              ) : (
                <div key={i} className="self-start max-w-[92%] flex gap-3">
                  <ReactorEmblem active={false} className="w-8 h-8 mt-1" />
                  <div className="min-w-0">
                    <div
                      className="rounded-2xl rounded-tl-sm px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap"
                      style={{
                        background: "linear-gradient(135deg, rgba(10,26,38,0.6), rgba(3,8,14,0.8))",
                        border: "1px solid rgba(239,68,68,0.3)",
                        boxShadow: "0 0 14px rgba(239,68,68,0.08)",
                      }}
                    >
                      {m.content}
                    </div>
                    {m.meta && <p className="mt-1 ml-1 text-[10px] tracking-wider text-cyan-300/30">{m.meta}</p>}
                  </div>
                </div>
              )
            )}

            {busy && (
              <div className="self-start flex items-center gap-3">
                <ReactorEmblem active className="w-8 h-8" />
                <span className="flex items-center gap-1.5 text-[10px] tracking-[0.2em] text-red-300/70 uppercase">
                  <span className="hud-dot h-1.5 w-1.5 rounded-full bg-red-400" />
                  Aurora denkt
                </span>
              </div>
            )}

            {error && (
              <p className="self-center text-xs text-rose-300 border border-rose-400/40 rounded-xl px-3 py-2 text-center">{error}</p>
            )}
            <div ref={endRef} />
          </div>
        </div>

        {/* Eingabe */}
        <div className="relative z-10 border-t border-cyan-400/20 bg-black/30 backdrop-blur-sm px-4 sm:px-6 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <div className="max-w-2xl mx-auto w-full">
            <div className="flex gap-1.5 mb-2.5">
              {MODES.map((m) => (
                <button
                  key={m.key}
                  onClick={() => pickMode(m.key)}
                  title={m.hint}
                  className={`hud-btn !px-3 !py-1.5 !text-[11px] ${mode === m.key ? "hud-btn-primary" : "hud-btn-outline"}`}
                >
                  {m.label}
                </button>
              ))}
            </div>
            <div className="flex gap-2 items-end">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    send();
                  }
                }}
                rows={1}
                className="hud-input flex-1 resize-none max-h-32"
                placeholder="Frag Aurora etwas ..."
                style={{ fontSize: 16 /* verhindert Zoom auf dem iPhone */ }}
              />
              <button onClick={send} disabled={busy || !user || !input.trim()} className="hud-btn hud-btn-primary !px-3.5 !py-3" aria-label="Senden">
                <SendHorizontal size={18} />
              </button>
            </div>
          </div>
        </div>

        <HudGlobalStyles />
      </div>
    </Protected>
  );
}
