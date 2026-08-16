"use client";

import { useCallback, useRef, useState } from "react";
import { Share2, Check, Loader2 } from "lucide-react";
import type { ClipboardFile } from "@/lib/clipboard";
import { prepareShareFiles, shareNow, canShareFiles, MAX_SHARE_FILES } from "@/lib/shareFiles";

// Das System-Teilen-Sheet vertraegt nur wenige Dateien auf einmal. Statt bei vielen
// Dateien einfach abzulehnen, werden sie hier in Gruppen zu MAX_SHARE_FILES aufgeteilt
// und je Gruppe ein Knopf angeboten.
//
// Ablauf je Gruppe: erst herunterladen (vorbereiten), dann teilen. Zwei Schritte sind
// noetig, weil navigator.share() eine frische Nutzergeste verlangt und die waehrend
// des Herunterladens ablaeuft.
//
// Die Automatik: sobald eine Gruppe geteilt ist, laedt die naechste im Hintergrund
// schon los - waehrend der Nutzer noch im Teilen-Sheet steht. Kommt er zurueck, ist
// sie fertig und braucht nur noch einen Klick statt zwei.
export function ShareBatches({
  files,
  onShared,
  onError,
  className = "",
}: {
  files: ClipboardFile[];
  /** Wird nach jedem erfolgreich geteilten Stapel aufgerufen */
  onShared?: () => void;
  onError?: (message: string) => void;
  className?: string;
}) {
  const groups: ClipboardFile[][] = [];
  for (let i = 0; i < files.length; i += MAX_SHARE_FILES) {
    groups.push(files.slice(i, i + MAX_SHARE_FILES));
  }

  const [doneGroups, setDoneGroups] = useState<Set<number>>(new Set());
  const [prepared, setPrepared] = useState<{ index: number; files: File[] } | null>(null);
  const [busyIndex, setBusyIndex] = useState<number | null>(null);
  const [pct, setPct] = useState(0);

  // Verhindert, dass zwei Vorbereitungen gleichzeitig laufen (Hintergrundladen +
  // ungeduldiger Klick auf eine andere Gruppe)
  const preparingRef = useRef(false);

  const prepare = useCallback(
    async (index: number): Promise<File[] | null> => {
      if (preparingRef.current) return null;
      preparingRef.current = true;
      setBusyIndex(index);
      setPct(0);
      try {
        const ready = await prepareShareFiles(groups[index], setPct);
        setPrepared({ index, files: ready });
        return ready;
      } catch (err) {
        if (err instanceof Error && err.message === "SHARE_UNSUPPORTED") {
          onError?.("Dieses Gerät unterstützt das Teilen von Dateien nicht. Bitte herunterladen.");
        } else {
          console.error("Teilen vorbereiten fehlgeschlagen:", err);
          onError?.("Vorbereiten fehlgeschlagen.");
        }
        return null;
      } finally {
        preparingRef.current = false;
        setBusyIndex(null);
      }
    },
    // groups wird bei jedem Render neu gebaut, haengt aber nur an files
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [files, onError]
  );

  const share = useCallback(
    async (index: number, ready: File[]) => {
      try {
        await shareNow(ready);
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") return; // Nutzer hat abgebrochen
        console.error("Teilen fehlgeschlagen:", err);
        onError?.("Teilen fehlgeschlagen.");
        return;
      }

      setDoneGroups((prev) => new Set(prev).add(index));
      // Speicher der geteilten Gruppe freigeben, sonst liegen bei vielen Gruppen
      // hunderte Megabyte im Arbeitsspeicher
      setPrepared(null);
      onShared?.();

      // Naechste offene Gruppe schon vorbereiten, damit sie nur noch einen Klick braucht
      const next = groups.findIndex((_, i) => i !== index && !doneGroups.has(i));
      if (next >= 0) prepare(next);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [doneGroups, onShared, onError, prepare]
  );

  const handleClick = useCallback(
    async (index: number) => {
      if (prepared?.index === index) {
        // Schon vorbereitet: direkt teilen, kein await davor - die Geste muss frisch bleiben
        share(index, prepared.files);
        return;
      }
      const ready = await prepare(index);
      // Nach dem Laden ist die urspruengliche Geste abgelaufen. Der Knopf wechselt
      // deshalb auf "Jetzt teilen" und wartet auf einen zweiten Klick
      if (!ready) return;
    },
    [prepared, prepare, share]
  );

  if (!canShareFiles() || files.length === 0) return null;

  const shareBtnStyle = {
    borderColor: "rgba(74,222,128,0.6)",
    background: "linear-gradient(135deg, rgba(74,222,128,0.28), rgba(74,222,128,0.08))",
    color: "#dcfce7",
    textShadow: "0 0 8px rgba(74,222,128,0.6)",
  };

  // Eine Gruppe: schlichter Einzelknopf wie vorher
  if (groups.length === 1) {
    const isReady = prepared?.index === 0;
    const isBusy = busyIndex === 0;
    return (
      <button
        className={`hud-btn inline-flex items-center gap-1.5 ${isReady ? "hud-alarm" : ""} ${className}`}
        disabled={isBusy}
        style={shareBtnStyle}
        onClick={() => handleClick(0)}
      >
        {isBusy ? <Loader2 size={13} className="animate-spin" /> : <Share2 size={13} />}
        {isBusy ? `Lädt… ${pct}%` : isReady ? "Jetzt teilen" : "Teilen"}
      </button>
    );
  }

  const allDone = doneGroups.size === groups.length;

  return (
    <div className={`flex flex-col gap-2 ${className}`}>
      <div className="flex items-center gap-2 text-[10px] tracking-widest uppercase text-cyan-300/40">
        <Share2 size={12} />
        {allDone
          ? "Alle Stapel geteilt"
          : `Teilen in ${groups.length} Stapeln · je max. ${MAX_SHARE_FILES} Dateien`}
      </div>

      <div className="flex flex-wrap gap-1.5">
        {groups.map((g, i) => {
          const from = i * MAX_SHARE_FILES + 1;
          const to = from + g.length - 1;
          const isDone = doneGroups.has(i);
          const isReady = prepared?.index === i;
          const isBusy = busyIndex === i;

          return (
            <button
              key={i}
              onClick={() => handleClick(i)}
              disabled={busyIndex !== null && !isBusy}
              title={
                isDone
                  ? `Stapel ${from}–${to} bereits geteilt`
                  : isReady
                  ? `Stapel ${from}–${to} jetzt teilen`
                  : `Stapel ${from}–${to} vorbereiten`
              }
              className={`hud-btn inline-flex items-center gap-1.5 ${isReady ? "hud-alarm" : ""}`}
              style={
                isDone
                  ? { borderColor: "rgba(74,222,128,0.35)", color: "rgba(220,252,231,0.55)", background: "transparent" }
                  : isReady
                  ? shareBtnStyle
                  : undefined
              }
            >
              {isBusy ? (
                <Loader2 size={12} className="animate-spin" />
              ) : isDone ? (
                <Check size={12} />
              ) : null}
              {isBusy ? `${pct}%` : `${from}–${to}`}
            </button>
          );
        })}
      </div>
    </div>
  );
}
