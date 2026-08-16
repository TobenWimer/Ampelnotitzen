"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { File as FileIcon, ShieldCheck, Download, FileArchive } from "lucide-react";
import { subscribeGate, registerGateDownload, isGateExpired, type Gate } from "@/lib/gate";
import { downloadFileFromUrl } from "@/lib/download";
import { downloadAllFiles, downloadFilesAsZip } from "@/lib/shareFiles";
import HudGlobalStyles from "@/components/hud/HudGlobalStyles";
import { GateBeam } from "@/components/hud/GateBeam";
import { MediaLightbox } from "@/components/hud/MediaLightbox";
import { ShareBatches } from "@/components/hud/ShareBatches";
import { ChannelLight } from "@/components/hud/ChannelLight";
import { beginTransfer } from "@/lib/transferChannel";

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
  const [done, setDone] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [, forceTick] = useState(0);

  // Live an das Gate gehaengt: schliesst der Ersteller es oder laeuft es ab, verschwindet
  // die Seite sofort - ohne dass der Empfaenger neu laden muss
  useEffect(() => {
    const unsub = subscribeGate(gateId, (g) => {
      setGate(g);
      setLoading(false);
    });
    return () => unsub();
  }, [gateId]);

  // Restlaufzeit mitlaufen lassen und lokal dichtmachen, sobald sie abgelaufen ist
  useEffect(() => {
    const t = setInterval(() => {
      forceTick((n) => n + 1);
      setGate((g) => (g && isGateExpired(g) ? null : g));
    }, 5000);
    return () => clearInterval(t);
  }, []);

  const runAction = useCallback(
    async (label: string, fn: (onProgress: (p: number) => void) => Promise<void>) => {
      setProgress(0);
      const endTransfer = beginTransfer("download", label);
      try {
        await fn(setProgress);
        registerGateDownload(gateId); // Ersteller sieht, dass abgeholt wurde
        // kurz den Abschluss zeigen, sonst verschwindet die Sequenz im selben Moment,
        // in dem sie fertig wird
        setDone(true);
        setTimeout(() => setDone(false), 1600);
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") return; // Teilen abgebrochen
        if (err instanceof Error && err.message === "SHARE_UNSUPPORTED") {
          alert("Dieses Gerät unterstützt das Teilen von Dateien nicht. Bitte herunterladen.");
          return;
        }
        console.error(`${label} fehlgeschlagen:`, err);
        alert(`${label} fehlgeschlagen.`);
      } finally {
        endTransfer();
        setProgress(null);
      }
    },
    [gateId]
  );


  const shell = (children: React.ReactNode) => (
    <div className="min-h-screen hud-bg text-cyan-50 flex flex-col relative overflow-hidden font-mono">
      <div className="hud-grid pointer-events-none absolute inset-0" />

      <header className="relative z-10 w-full flex items-center justify-between px-6 py-4 border-b border-cyan-400/20 bg-black/20 backdrop-blur-sm">
        <div className="flex items-center gap-3">
          <h1 className="hud-title text-lg font-bold text-cyan-100 uppercase">Intertransfer</h1>
        </div>
        {/* Das Schild-Symbol ist ein stiller Link zur Startseite - bewusst ohne
            Beschriftung und ohne Hinweis, Gaeste sollen hier nichts weiter suchen */}
        <span className="flex items-center gap-1.5 text-[10px] tracking-[0.2em] text-cyan-400/70 uppercase">
          <Link href="/" aria-label="OneStepBehind" className="text-cyan-400/70 hover:text-cyan-400/70">
            <ShieldCheck size={12} />
          </Link>
          Gastzugang
        </span>
        <ChannelLight className="hidden sm:inline-flex" />
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
  // Nur Bilder, in Anzeigereihenfolge - Basis fuer die Vorschau
  const images = files
    .filter((f) => f.mimeType.startsWith("image/"))
    .map((f) => ({ id: f.storagePath, name: f.fileName, url: f.downloadURL }));

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
        <p className="text-lg md:text-xl text-cyan-100/90 leading-relaxed whitespace-pre-wrap break-words mb-6">
          {gate.note}
        </p>
      )}

      {/* Aktionen bewusst direkt sichtbar statt im Dropdown - Empfaenger sollen ohne
          Sucherei an die Dateien kommen */}
      <div className="flex items-center gap-2 mb-5 flex-wrap">
        <button
          className="hud-btn hud-btn-primary inline-flex items-center gap-1.5"
          disabled={progress !== null}
          onClick={() =>
            files.length === 1
              ? runAction("Download", (p) => downloadFileFromUrl(files[0].downloadURL, files[0].fileName, p))
              : runAction("Download", (p) => downloadAllFiles(files, p))
          }
        >
          <Download size={13} />
          {files.length === 1 ? "Herunterladen" : "Alle einzeln"}
        </button>

        <button
          className="hud-btn hud-btn-outline inline-flex items-center gap-1.5"
          disabled={progress !== null}
          onClick={() => runAction("Download", (p) => downloadFilesAsZip(files, "intertransfer", p))}
        >
          <FileArchive size={13} />
          Als ZIP
        </button>

        {/* Bei bis zu 20 Dateien ein Knopf, darueber automatisch in Stapel geteilt */}
        <ShareBatches
          files={files}
          onShared={() => registerGateDownload(gateId)}
          onError={(m) => alert(m)}
        />
      </div>

      {(progress !== null || done) && <GateBeam pct={progress ?? 100} done={done} />}

      <div className="hud-panel rounded-2xl p-5">
        <div className={`relative z-10 ${files.length === 1 ? "" : "grid grid-cols-2 sm:grid-cols-3 gap-3"}`}>
          {files.map((f) => {
            const isImg = f.mimeType.startsWith("image/");
            const imgIndex = isImg ? images.findIndex((x) => x.id === f.storagePath) : -1;

            // Nur Bilder sind anklickbar und oeffnen die Vorschau. Kein Klick loest
            // mehr einen Download aus - der laeuft ausschliesslich ueber die Knoepfe oben
            const Tile = isImg ? "button" : "div";
            return (
              <Tile
                key={f.storagePath}
                onClick={isImg ? () => setLightboxIndex(imgIndex) : undefined}
                title={isImg ? `${f.fileName} ansehen` : f.fileName}
                className={`flex flex-col items-center gap-2 rounded-lg border border-cyan-400/15 bg-black/20 p-2 min-w-0 w-full transition ${
                  isImg ? "hover:border-cyan-400/50 cursor-pointer" : ""
                }`}
              >
                {isImg ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={f.downloadURL}
                    alt={f.fileName}
                    loading="lazy"
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
              </Tile>
            );
          })}
        </div>
      </div>

      {lightboxIndex !== null && (
        <MediaLightbox
          images={images}
          index={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
          onIndexChange={setLightboxIndex}
          onDownload={(img) => runAction("Download", (p) => downloadFileFromUrl(img.url, img.name, p))}
        />
      )}

      <p className="text-[10px] text-cyan-300/30 text-center mt-4 tracking-wide">
        Nach Ablauf schliesst sich das Gate und die Dateien sind nicht mehr abrufbar.
      </p>
    </>
  );
}
