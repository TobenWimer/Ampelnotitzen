"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { File as FileIcon, ChevronDown, ShieldCheck } from "lucide-react";
import { loadGate, isGateExpired, type Gate } from "@/lib/gate";
import { downloadFileFromUrl } from "@/lib/download";
import { downloadAllFiles, downloadFilesAsZip, shareFiles, canShareFiles } from "@/lib/shareFiles";
import HudGlobalStyles from "@/components/hud/HudGlobalStyles";

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatRemaining(ms: number): string {
  if (ms <= 0) return "abgelaufen";
  const min = Math.floor(ms / 60000);
  if (min < 60) return `${Math.max(1, min)} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} Std`;
  return `${Math.floor(h / 24)} Tage`;
}

// Oeffentliche Empfangsseite eines Intertransfer-Gates. Bewusst NICHT in <Protected>:
// Empfaenger sollen ohne Anmeldung an die Dateien kommen. Sie koennen hier ausschliesslich
// herunterladen/teilen - kein Hochladen, kein Loeschen, kein Zugriff auf andere Module.
export default function GatePage() {
  const params = useParams() as { id?: string };
  const gateId = params?.id ?? "";

  const [gate, setGate] = useState<Gate | null>(null);
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState<number | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [, forceTick] = useState(0);

  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const g = await loadGate(gateId);
      if (cancelled) return;
      setGate(g);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [gateId]);

  // Restlaufzeit mitlaufen lassen und das Gate schliessen, sobald sie abgelaufen ist
  useEffect(() => {
    const t = setInterval(() => {
      forceTick((n) => n + 1);
      setGate((g) => (g && isGateExpired(g) ? null : g));
    }, 10000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const onOutside = (e: Event) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", onOutside);
    document.addEventListener("touchstart", onOutside);
    return () => {
      document.removeEventListener("mousedown", onOutside);
      document.removeEventListener("touchstart", onOutside);
    };
  }, [menuOpen]);

  const runAction = useCallback(async (label: string, fn: (onProgress: (p: number) => void) => Promise<void>) => {
    setProgress(0);
    setMenuOpen(false);
    try {
      await fn(setProgress);
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return; // Teilen abgebrochen
      if (err instanceof Error && err.message === "SHARE_UNSUPPORTED") {
        alert("Dieses Gerät unterstützt das Teilen von Dateien nicht. Bitte herunterladen.");
        return;
      }
      console.error(`${label} fehlgeschlagen:`, err);
      alert(`${label} fehlgeschlagen.`);
    } finally {
      setProgress(null);
    }
  }, []);

  const shell = (children: React.ReactNode) => (
    <div className="min-h-screen hud-bg text-cyan-50 flex flex-col relative overflow-hidden font-mono">
      <div className="hud-grid pointer-events-none absolute inset-0" />

      <header className="relative z-10 w-full flex items-center justify-between px-6 py-4 border-b border-cyan-400/20 bg-black/20 backdrop-blur-sm">
        <div className="flex items-center gap-3">
          <h1 className="hud-title text-lg font-bold text-cyan-100 uppercase">Intertransfer</h1>
        </div>
        <span className="flex items-center gap-1.5 text-[10px] tracking-[0.2em] text-cyan-400/70 uppercase">
          <ShieldCheck size={12} />
          Gastzugang
        </span>
      </header>

      <div className="relative z-10 flex-1 max-w-2xl w-full mx-auto px-6 py-10">{children}</div>
      <HudGlobalStyles />
    </div>
  );

  if (loading) {
    return shell(
      <p className="text-cyan-400/70 text-xs tracking-[0.3em] uppercase text-center py-20">Gate wird geprüft…</p>
    );
  }

  if (!gate) {
    return shell(
      <div className="hud-panel rounded-2xl p-8 text-center">
        <div className="relative z-10">
          <div className="text-cyan-100 text-sm font-semibold tracking-widest uppercase mb-2">Gate geschlossen</div>
          <p className="text-cyan-300/50 text-xs leading-relaxed">
            Dieser Link ist abgelaufen oder existiert nicht.
            <br />
            Die Dateien sind nicht mehr abrufbar.
          </p>
        </div>
      </div>
    );
  }

  const remaining = gate.expiresAt - Date.now();
  const files = gate.files;

  return shell(
    <>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <p className="text-xs text-cyan-300/50 tracking-wide">
          &gt; {files.length} {files.length === 1 ? "Datei" : "Dateien"} für dich bereitgestellt.
        </p>
        <span className="text-[10px] tracking-widest uppercase text-amber-300/80">
          Noch {formatRemaining(remaining)} verfügbar
        </span>
      </div>

      {gate.note && (
        <div className="hud-panel rounded-xl p-3 mb-4">
          <p className="relative z-10 text-xs text-cyan-100/80 whitespace-pre-wrap break-words">{gate.note}</p>
        </div>
      )}

      <div className="flex items-center gap-3 mb-5 flex-wrap">
        <div className="relative" ref={menuRef}>
          <button
            onClick={() => setMenuOpen((v) => !v)}
            className="hud-btn hud-btn-primary inline-flex items-center gap-1.5"
            disabled={progress !== null}
          >
            {progress !== null ? `Läuft… ${progress}%` : "Empfangen"}
            <ChevronDown size={13} />
          </button>

          {menuOpen && (
            <div role="menu" className="hud-menu absolute left-0 top-full mt-2 z-50 min-w-56 rounded-xl overflow-hidden">
              {files.length === 1 ? (
                <button
                  className="hud-menu-item"
                  onClick={() => runAction("Download", (p) => downloadFileFromUrl(files[0].downloadURL, files[0].fileName, p))}
                >
                  Herunterladen
                </button>
              ) : (
                <button className="hud-menu-item" onClick={() => runAction("Download", (p) => downloadAllFiles(files, p))}>
                  Alle einzeln herunterladen
                </button>
              )}

              <button
                className="hud-menu-item"
                onClick={() => runAction("Download", (p) => downloadFilesAsZip(files, "intertransfer", p))}
              >
                Als ZIP herunterladen
              </button>

              {canShareFiles() && (
                <button className="hud-menu-item" onClick={() => runAction("Teilen", (p) => shareFiles(files, p))}>
                  Teilen{files.some((f) => f.mimeType.startsWith("image/")) ? " (z.B. in die Galerie)" : ""}
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="hud-panel rounded-2xl p-5">
        <div className={`relative z-10 ${files.length === 1 ? "" : "grid grid-cols-2 sm:grid-cols-3 gap-3"}`}>
          {files.map((f) => {
            const isImg = f.mimeType.startsWith("image/");
            return (
              <button
                key={f.storagePath}
                onClick={() => runAction("Download", (p) => downloadFileFromUrl(f.downloadURL, f.fileName, p))}
                title={`${f.fileName} herunterladen`}
                className="flex flex-col items-center gap-2 rounded-lg border border-cyan-400/15 bg-black/20 p-2 hover:border-cyan-400/50 transition min-w-0 w-full"
              >
                {isImg ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={f.downloadURL}
                    alt={f.fileName}
                    className={`rounded object-contain ${files.length === 1 ? "max-h-64" : "h-24 w-full object-cover"}`}
                  />
                ) : (
                  <div className={`flex items-center justify-center ${files.length === 1 ? "py-6" : "h-24"}`}>
                    <FileIcon size={files.length === 1 ? 44 : 30} className="text-cyan-300/60" strokeWidth={1.4} />
                  </div>
                )}
                <div className="text-[11px] text-cyan-50/90 text-center break-words [overflow-wrap:anywhere] w-full">
                  {f.fileName}
                </div>
                <div className="text-[10px] text-cyan-300/40">{formatSize(f.sizeBytes)}</div>
              </button>
            );
          })}
        </div>
      </div>

      <p className="text-[10px] text-cyan-300/30 text-center mt-4 tracking-wide">
        Nach Ablauf schliesst sich das Gate und die Dateien sind nicht mehr abrufbar.
      </p>
    </>
  );
}
