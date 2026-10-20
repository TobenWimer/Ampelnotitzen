"use client";

// Schlichte Test-Oberflaeche fuer Aurora (Jarvis v1). Bewusst ohne Design.
// Die echte Sperre sitzt in /api/jarvis/chat (requireOwner), diese Seite zeigt Fremden nur eine Fehlermeldung.

import { useEffect, useRef, useState } from "react";
import { onAuthStateChanged, type User } from "firebase/auth";
import { auth, ensureAnonAuth } from "@/lib/firebase";

type Msg = { role: "user" | "assistant"; content: string };
type Usage = { model: string; input: number; output: number; cacheRead: number; cacheWrite: number; calls: number; costUsd: number; ms: number; gate?: string };

export default function JarvisPage() {
  const [user, setUser] = useState<User | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [deep, setDeep] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUsage, setLastUsage] = useState<Usage | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    ensureAnonAuth().catch(() => setError("Anmeldung fehlgeschlagen"));
    return onAuthStateChanged(auth, setUser);
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy]);

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
        body: JSON.stringify({ messages: next, mode: deep ? "deep" : "normal" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(`Fehler ${res.status}: ${data.error ?? "unbekannt"}${data.detail ? ` (${data.detail})` : ""}`);
        setMessages(messages); // fehlgeschlagene Frage zuruecknehmen
        setInput(text);
        return;
      }
      setMessages([...next, { role: "assistant", content: data.reply }]);
      setLastUsage(data.usage);
    } catch {
      setError("Netzwerkfehler");
      setMessages(messages);
      setInput(text);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: 16, fontFamily: "sans-serif", color: "#ddd" }}>
      <h1 style={{ fontSize: 20 }}>Aurora (Test)</h1>
      <div style={{ minHeight: 300 }}>
        {messages.map((m, i) => (
          <p key={i} style={{ whiteSpace: "pre-wrap", margin: "12px 0" }}>
            <b>{m.role === "user" ? "Du" : "Aurora"}:</b> {m.content}
          </p>
        ))}
        {busy && <p style={{ opacity: 0.6 }}>Aurora denkt nach ...</p>}
        <div ref={endRef} />
      </div>
      {error && <p style={{ color: "#f66" }}>{error}</p>}
      {lastUsage && (
        <p style={{ fontSize: 12, opacity: 0.6 }}>
          {lastUsage.model}, {lastUsage.calls} Aufruf(e), {lastUsage.input} in / {lastUsage.output} out, Cache gelesen {lastUsage.cacheRead},
          geschrieben {lastUsage.cacheWrite}, ca. {(lastUsage.costUsd * 100).toFixed(2)} Cent, {(lastUsage.ms / 1000).toFixed(1)} s
          {lastUsage.gate ? `, Kuerzer: ${lastUsage.gate}` : ""}
        </p>
      )}
      <label style={{ display: "block", margin: "8px 0" }}>
        <input type="checkbox" checked={deep} onChange={(e) => setDeep(e.target.checked)} /> gruendlich (Opus, teurer)
      </label>
      <textarea
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            send();
          }
        }}
        rows={3}
        style={{ width: "100%", color: "#000", padding: 8 }}
        placeholder="Frag Aurora etwas (Enter zum Senden)"
      />
      <button onClick={send} disabled={busy || !user} style={{ marginTop: 8, padding: "8px 16px" }}>
        Senden
      </button>
    </main>
  );
}
