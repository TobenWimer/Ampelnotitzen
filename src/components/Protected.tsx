"use client";

import { ReactNode, useEffect, useState } from "react";
import { auth, signInWithGoogleLinked } from "@/lib/firebase";

type Props = { children: ReactNode };

export default function Protected({ children }: Props) {
  const [loading, setLoading] = useState(true);
  const [isAuthedGoogle, setIsAuthedGoogle] = useState(false);

  useEffect(() => {
    const unsub = auth.onAuthStateChanged((u) => {
      if (u && !u.isAnonymous) {
        // Eingeloggt und NICHT anonym -> erlauben
        setIsAuthedGoogle(true);
      } else {
        // nicht eingeloggt ODER anonym -> sperren
        setIsAuthedGoogle(false);
      }
      setLoading(false);
    });
    return () => unsub();
  }, []);

  if (loading) {
    return <div className="p-10 text-center">Lade...</div>;
  }

  if (!isAuthedGoogle) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-white">
        <h1 className="text-3xl font-bold mb-6">OneStepBehind</h1>
        <p className="mb-4 text-gray-700 text-sm">
          Bitte mit Google anmelden, um fortzufahren.
        </p>
        <button
  onClick={signInWithGoogleLinked}
  className="rounded-2xl px-4 py-2 text-sm 
             bg-gradient-to-br from-gray-200/55 via-white/35 to-gray-100/45
             text-gray-900 border border-black/30 backdrop-blur-md 
             hover:bg-white/60 transition shadow-sm"
>
  Mit Google anmelden
</button>

      </div>
    );
  }

  return <>{children}</>;
}
