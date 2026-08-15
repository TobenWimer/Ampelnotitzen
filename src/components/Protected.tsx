"use client";

import { ReactNode, useEffect, useState } from "react";
import { auth, signInWithGoogleLinked, signOut } from "@/lib/firebase";
import { isAllowed, claimAccess } from "@/lib/access";
import HudGlobalStyles from "@/components/hud/HudGlobalStyles";
import { ReactorEmblem } from "@/components/hud/ReactorEmblem";

type Props = { children: ReactNode };

type Phase = "loading" | "signin" | "key" | "ready";

// Zwei Stufen: Google-Login, danach der Zugangsschluessel. Der Schluessel begrenzt,
// wer die App (und damit den geteilten Speicher) ueberhaupt nutzen kann. Geprueft
// wird er in den Firestore-Regeln, nicht hier - siehe src/lib/access.ts
export default function Protected({ children }: Props) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [uid, setUid] = useState<string | null>(null);
  const [keyInput, setKeyInput] = useState("");
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const unsub = auth.onAuthStateChanged(async (u) => {
      if (!u || u.isAnonymous) {
        setUid(null);
        setPhase("signin");
        return;
      }
      setUid(u.uid);
      setPhase((await isAllowed(u.uid)) ? "ready" : "key");
    });
    return () => unsub();
  }, []);

  const submitKey = async () => {
    if (!uid || !keyInput.trim()) return;
    setChecking(true);
    setError(null);
    const ok = await claimAccess(uid, keyInput);
    setChecking(false);
    if (ok) {
      setKeyInput("");
      setPhase("ready");
    } else {
      setError("Zugangsschlüssel ungültig.");
    }
  };

  const gateShell = (children: ReactNode) => (
    <div className="min-h-screen hud-bg text-cyan-50 flex flex-col items-center justify-center relative overflow-hidden font-mono px-6">
      <div className="hud-grid pointer-events-none absolute inset-0" />
      <div className="relative z-10 flex flex-col items-center text-center w-full max-w-sm">{children}</div>
      <HudGlobalStyles />
    </div>
  );

  if (phase === "loading") {
    return gateShell(
      <p className="text-cyan-400/70 text-xs tracking-[0.3em] uppercase">Initialisiere…</p>
    );
  }

  if (phase === "signin") {
    return gateShell(
      <>
        <ReactorEmblem className="w-24 h-24" />
        <h1 className="hud-title text-2xl font-bold text-cyan-100 uppercase mt-5">OneStepBehind</h1>
        <p className="text-xs text-cyan-300/50 mt-3 mb-6 leading-relaxed">
          Zugang nur für freigeschaltete Konten.
          <br />
          Bitte zuerst mit Google anmelden.
        </p>
        <button onClick={signInWithGoogleLinked} className="hud-btn hud-btn-primary">
          Mit Google anmelden
        </button>
      </>
    );
  }

  if (phase === "key") {
    return gateShell(
      <>
        <ReactorEmblem className="w-24 h-24" active={false} />
        <h1 className="hud-title text-xl font-bold text-cyan-100 uppercase mt-5">Zugang gesperrt</h1>
        <p className="text-xs text-cyan-300/50 mt-3 mb-6 leading-relaxed">
          Dieses Konto ist noch nicht freigeschaltet.
          <br />
          Bitte den Zugangsschlüssel eingeben.
        </p>

        <input
          value={keyInput}
          onChange={(e) => setKeyInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submitKey()}
          placeholder="Zugangsschlüssel"
          autoFocus
          className="hud-input w-full text-center tracking-widest mb-3"
        />

        {error && <p className="text-[11px] text-rose-300 mb-3">{error}</p>}

        <button onClick={submitKey} disabled={checking || !keyInput.trim()} className="hud-btn hud-btn-primary w-full">
          {checking ? "Prüfe…" : "Freischalten"}
        </button>

        <button onClick={signOut} className="text-[11px] text-cyan-300/40 hover:text-cyan-200 transition mt-4">
          Mit anderem Konto anmelden
        </button>
      </>
    );
  }

  return <>{children}</>;
}
