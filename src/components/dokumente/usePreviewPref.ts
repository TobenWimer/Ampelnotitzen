"use client";

import { useEffect, useState } from "react";
import { doc, onSnapshot, setDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";

// Live-synced Praeferenz "Bild-Vorschau an/aus" pro User, geteilt zwischen
// Root- und Unterordner-Dokumente-Seite (kein localStorage, siehe Projektkonvention)
export function usePreviewPref(uid: string | null) {
  const [showPreview, setShowPreviewState] = useState(false);

  useEffect(() => {
    if (!uid) {
      setShowPreviewState(false);
      return;
    }
    const ref = doc(db, "dokumentePrefs", uid);
    const unsub = onSnapshot(
      ref,
      (snap) => {
        setShowPreviewState(snap.exists() ? Boolean(snap.data().showPreview) : false);
      },
      (err) => console.warn("dokumentePrefs error", err)
    );
    return () => unsub();
  }, [uid]);

  const setShowPreview = async (value: boolean) => {
    setShowPreviewState(value); // optimistisch, onSnapshot bestaetigt danach
    if (!uid) return;
    await setDoc(doc(db, "dokumentePrefs", uid), { showPreview: value }, { merge: true });
  };

  return { showPreview, setShowPreview };
}
