"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { onSnapshot, query, where } from "firebase/firestore";
import { Link2, Check, Trash2, Eye, Plus, Share2 } from "lucide-react";

// Teilen ohne Dateien braucht nur navigator.share, nicht canShare({files})
const canShareLink = () => typeof navigator !== "undefined" && !!navigator.share;
import {
  createGate,
  closeGate,
  addFilesToGate,
  gatesCollection,
  gateFromData,
  gateUrl,
  gatePath,
  isGateExpired,
  GATE_DURATIONS,
  type Gate,
} from "@/lib/gate";
import { GateReactors, type GateStage } from "@/components/hud/GateReactors";
import { checkQuota } from "@/lib/storageUsage";

function formatRemaining(ms: number): string {
  if (ms <= 0) return "abgelaufen";
  const min = Math.floor(ms / 60000);
  if (min < 60) return `${Math.max(1, min)} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} Std`;
  return `${Math.floor(h / 24)} Tage`;
}

// Intertransfer: Dateien in ein Gate legen und den Link an Dritte geben. Empfaenger
// brauchen keinen Account - die zufaellige Gate-ID im Link ist der Zugangsschutz.
// Nach Ablauf sperren die Firestore-Regeln den Zugriff; die Dateien selbst werden
// beim naechsten Besuch dieser Seite aufgeraeumt (kein Server/Cron in diesem Stack)
export function IntertransferPanel({ uid }: { uid: string | null }) {
  const [gates, setGates] = useState<Gate[]>([]);
  const [creating, setCreating] = useState(false);
  const [uploadPct, setUploadPct] = useState<number | null>(null);
  const [durationMs, setDurationMs] = useState(GATE_DURATIONS[1].ms);
  const [note, setNote] = useState("");
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [linking, setLinking] = useState(false);
  const [quotaError, setQuotaError] = useState<string | null>(null);
  const [, forceTick] = useState(0);

  // Merkt sich den zuletzt gesehenen Abhol-Zaehler, um eine neue Abholung als
  // kurzen Statuswechsel ("Empfaenger holt ab") anzeigen zu koennen
  const seenDownloadsRef = useRef<Record<string, number>>({});
  const [receiving, setReceiving] = useState<{ count: number } | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const addInputRef = useRef<HTMLInputElement | null>(null);
  const addTargetRef = useRef<Gate | null>(null);

  useEffect(() => {
    if (!uid) {
      setGates([]);
      return;
    }
    const qRef = query(gatesCollection(), where("ownerUid", "==", uid));
    const unsub = onSnapshot(
      qRef,
      (snap) => {
        const raw = snap.docs.map((d) => gateFromData(d.id, d.data()));
        raw.sort((a, b) => b.createdAt - a.createdAt);

        // neue Abholung erkennen -> Reaktoren kurz auf "Empfaenger holt ab" stellen
        let fresh: number | null = null;
        for (const g of raw) {
          const seen = seenDownloadsRef.current[g.id];
          if (seen !== undefined && g.downloadCount > seen) fresh = g.downloadCount;
          seenDownloadsRef.current[g.id] = g.downloadCount;
        }
        if (fresh !== null) {
          setReceiving({ count: fresh });
          setTimeout(() => setReceiving(null), 6000);
        }

        setGates(raw);
      },
      (err) => console.warn("gates error", err)
    );
    return () => unsub();
  }, [uid]);

  // Restlaufzeiten aktualisieren und abgelaufene Gates aufraeumen
  useEffect(() => {
    const t = setInterval(() => {
      forceTick((n) => n + 1);
      for (const g of gates) {
        if (isGateExpired(g)) closeGate(g).catch(() => {});
      }
    }, 15000);
    return () => clearInterval(t);
  }, [gates]);

  const handleCreate = useCallback(async () => {
    if (!uid || pendingFiles.length === 0) return;
    setQuotaError(null);

    // Erst pruefen, dann hochladen - ein abgebrochener Upload wuerde sonst Bytes
    // im Storage hinterlassen, zu denen es kein Gate gibt
    const quota = await checkQuota(uid, pendingFiles);
    if (!quota.ok) {
      setQuotaError(quota.message);
      return;
    }

    setUploadPct(0);
    try {
      await createGate({ files: pendingFiles, uid, durationMs, note: note.trim(), onProgress: setUploadPct });
      // kurz die "Link wird erzeugt"-Stufe stehen lassen, sonst springt die Anzeige
      // direkt von 100% auf "offen" und der Schritt ist nicht lesbar
      setLinking(true);
      setTimeout(() => setLinking(false), 900);
      setPendingFiles([]);
      setNote("");
      setCreating(false);
    } catch (err) {
      console.error("Gate anlegen fehlgeschlagen:", err);
      const code = (err as { code?: string })?.code;
      setQuotaError(
        code === "storage/unauthorized"
          ? "Upload vom Server abgelehnt. Datei zu gross oder Storage-Regeln nicht aktuell."
          : `Gate konnte nicht angelegt werden${code ? ` (${code})` : ""}.`
      );
    } finally {
      setUploadPct(null);
    }
  }, [uid, pendingFiles, durationMs, note]);

  const handleCopy = useCallback(async (gate: Gate) => {
    const url = gateUrl(gate.id);
    try {
      await navigator.clipboard.writeText(url);
      setCopiedId(gate.id);
      setTimeout(() => setCopiedId(null), 1800);
    } catch {
      prompt("Link kopieren:", url);
    }
  }, []);

  // Nachlegen in ein offenes Gate: Laufzeit und Link bleiben, Empfaenger sehen die
  // neuen Dateien sofort. Ein verstecktes Input pro Gate waere Overkill, deshalb ein
  // gemeinsames, das sich merkt, fuer welches Gate es gerade offen ist
  const handleAddFiles = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files ?? []);
      e.target.value = "";
      const gate = addTargetRef.current;
      addTargetRef.current = null;
      if (!uid || !gate || files.length === 0) return;

      setQuotaError(null);
      const quota = await checkQuota(uid, files);
      if (!quota.ok) {
        setQuotaError(quota.message);
        return;
      }

      setUploadPct(0);
      try {
        await addFilesToGate({ gate, files, onProgress: setUploadPct });
      } catch (err) {
        console.error("Nachlegen fehlgeschlagen:", err);
        const code = (err as { code?: string })?.code;
        setQuotaError(
          code === "storage/unauthorized"
            ? "Upload vom Server abgelehnt. Datei zu gross oder Storage-Regeln nicht aktuell."
            : `Dateien konnten nicht dazugelegt werden${code ? ` (${code})` : ""}.`
        );
      } finally {
        setUploadPct(null);
      }
    },
    [uid]
  );

  // Link teilen statt kopieren: geht ohne vorheriges Herunterladen direkt im
  // Klick-Handler, die Nutzergeste bleibt also erhalten (anders als beim Teilen
  // von Dateien, das erst laden muss)
  const handleShareLink = useCallback(async (gate: Gate) => {
    const url = gateUrl(gate.id);
    try {
      await navigator.share({
        title: "Dateien für dich",
        text: gate.note ? gate.note : "Hier kannst du die Dateien abholen:",
        url,
      });
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return; // Nutzer hat abgebrochen
      console.error("Link teilen fehlgeschlagen:", err);
    }
  }, []);

  const handleClose = useCallback(async (gate: Gate) => {
    if (!confirm("Gate jetzt schliessen? Der Link wird sofort ungültig und die Dateien werden gelöscht.")) return;
    // Dokument zuerst weg: die Empfangsseite haengt per onSnapshot daran und macht
    // dadurch sofort dicht, ohne dass jemand neu laden muss
    await closeGate(gate);
  }, []);

  const activeGates = gates.filter((g) => !isGateExpired(g));

  const stage: GateStage =
    quotaError
      ? { kind: "error", message: quotaError }
      : uploadPct !== null
      ? { kind: "uploading", pct: uploadPct }
      : linking
      ? { kind: "linking" }
      : receiving
      ? { kind: "receiving", count: receiving.count }
      : activeGates.length > 0
      ? {
          kind: "open",
          gates: activeGates.length,
          remainingLabel: `noch ${formatRemaining(
            Math.max(...activeGates.map((g) => g.expiresAt)) - Date.now()
          )}`,
        }
      : { kind: "idle" };

  return (
    <div className="zwa-panel rounded-2xl p-5 mb-6">
      <div className="relative z-10">
        <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
          <div>
            <h2 className="text-xs font-bold tracking-[0.2em] uppercase text-cyan-100">Intertransfer</h2>
            <p className="text-[10px] text-cyan-300/40 mt-0.5">
              Dateien per Link an Dritte geben — ohne Anmeldung, auf Zeit begrenzt.
            </p>
          </div>
          {!creating && (
            <button onClick={() => setCreating(true)} className="zwa-btn zwa-btn-primary inline-flex items-center gap-1.5" disabled={!uid}>
              <Plus size={13} />
              Gate öffnen
            </button>
          )}
        </div>

        {/* Doppelreaktor: zeigt Upload, Link-Erzeugung, offenes Gate und Abholungen */}
        <GateReactors stage={stage} />

        {/* gemeinsames Input fuers Nachlegen, das Ziel-Gate steht in addTargetRef */}
        <input ref={addInputRef} type="file" multiple onChange={handleAddFiles} className="hidden" />

        {/* Neues Gate anlegen */}
        {creating && (
          <div className="rounded-xl border border-cyan-400/20 bg-black/30 p-3 mb-4 space-y-3">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => {
                setPendingFiles(Array.from(e.target.files ?? []));
                setQuotaError(null); // neue Auswahl, alte Ablehnung nicht stehen lassen
                e.target.value = "";
              }}
            />
            <div className="flex items-center gap-2 flex-wrap">
              <button onClick={() => fileInputRef.current?.click()} className="zwa-btn zwa-btn-outline">
                Dateien wählen
              </button>
              <span className="text-[11px] text-cyan-300/50">
                {pendingFiles.length === 0
                  ? "keine Dateien gewählt"
                  : `${pendingFiles.length} ${pendingFiles.length === 1 ? "Datei" : "Dateien"} gewählt`}
              </span>
            </div>

            <div>
              <div className="text-[10px] tracking-widest uppercase text-cyan-300/40 mb-1.5">Gültig für</div>
              <div className="flex items-center gap-1.5 flex-wrap">
                {GATE_DURATIONS.map((d) => (
                  <button
                    key={d.ms}
                    onClick={() => setDurationMs(d.ms)}
                    className={`px-2.5 py-1 rounded-lg text-[11px] border transition ${
                      durationMs === d.ms
                        ? "border-cyan-400/70 bg-cyan-400/15 text-cyan-100"
                        : "border-cyan-400/20 text-cyan-300/50 hover:border-cyan-400/50"
                    }`}
                  >
                    {d.label}
                  </button>
                ))}
              </div>
            </div>

            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Notiz für den Empfänger (optional)"
              className="w-full rounded-lg border border-cyan-400/25 bg-black/40 px-3 py-2 text-xs text-cyan-50 placeholder:text-cyan-100/25 focus:outline-none focus:border-cyan-400/60"
            />

            <div className="flex items-center gap-2">
              <button
                onClick={handleCreate}
                className="zwa-btn zwa-btn-primary"
                disabled={pendingFiles.length === 0 || uploadPct !== null}
              >
                {uploadPct !== null ? `Lädt hoch… ${uploadPct}%` : "Gate erstellen"}
              </button>
              <button
                onClick={() => {
                  setCreating(false);
                  setPendingFiles([]);
                  setNote("");
                }}
                className="text-xs text-cyan-300/50 hover:text-cyan-200 transition px-2"
              >
                Abbrechen
              </button>
            </div>
          </div>
        )}

        {/* Offene Gates */}
        {activeGates.length === 0 ? (
          <p className="text-xs text-cyan-300/25 text-center py-4 tracking-wide">— keine offenen Gates —</p>
        ) : (
          <div className="space-y-2">
            {activeGates.map((g) => (
              <div key={g.id} className="rounded-xl border border-cyan-400/15 bg-black/25 p-3">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <div className="text-xs text-cyan-100 font-semibold">
                      {g.files.length} {g.files.length === 1 ? "Datei" : "Dateien"}
                      {g.note && <span className="text-cyan-300/40 font-normal"> · {g.note}</span>}
                    </div>
                    <div className="text-[10px] tracking-wide mt-0.5 flex items-center gap-2 flex-wrap">
                      <span className="text-amber-300/70">noch {formatRemaining(g.expiresAt - Date.now())}</span>
                      <span className={g.downloadCount > 0 ? "text-emerald-300/80" : "text-cyan-300/30"}>
                        {g.downloadCount > 0 ? `${g.downloadCount}× abgeholt` : "noch nicht abgeholt"}
                      </span>
                    </div>
                  </div>

                  {/* Nur Symbole, Bedeutung steht im title/aria-label. Haelt die Zeile
                      schmal genug, dass alle Aktionen auch auf dem Handy nebeneinander passen */}
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      onClick={() => {
                        addTargetRef.current = g;
                        addInputRef.current?.click();
                      }}
                      className="zwa-btn zwa-btn-outline zwa-icon-btn"
                      disabled={uploadPct !== null}
                      title="Weitere Dateien in dieses Gate legen"
                      aria-label="Dateien nachlegen"
                    >
                      <Plus size={15} />
                    </button>

                    <button
                      onClick={() => handleCopy(g)}
                      className="zwa-btn zwa-btn-outline zwa-icon-btn"
                      title="Link kopieren"
                      aria-label="Link kopieren"
                    >
                      {copiedId === g.id ? <Check size={15} /> : <Link2 size={15} />}
                    </button>

                    {canShareLink() && (
                      <button
                        onClick={() => handleShareLink(g)}
                        className="zwa-btn zwa-btn-outline zwa-icon-btn"
                        title="Link teilen (WhatsApp, Mail, …)"
                        aria-label="Link teilen"
                      >
                        <Share2 size={15} />
                      </button>
                    )}

                    <a
                      href={gatePath(g.id)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="zwa-btn zwa-btn-outline zwa-icon-btn"
                      title="Gastansicht öffnen (so sehen es die Empfänger)"
                      aria-label="Gastansicht öffnen"
                    >
                      <Eye size={15} />
                    </a>

                    <button
                      onClick={() => handleClose(g)}
                      className="zwa-btn zwa-btn-danger zwa-icon-btn"
                      title="Gate sofort schliessen"
                      aria-label="Gate schliessen"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
