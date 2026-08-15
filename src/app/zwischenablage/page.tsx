"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { File as FileIcon } from "lucide-react";
import { doc, setDoc, deleteDoc, onSnapshot } from "firebase/firestore";
import { onAuthStateChanged, User } from "firebase/auth";
import { auth, db } from "@/lib/firebase";
import { CLIPBOARD_TTL_MS, isClipboardExpired, uploadClipboardFile, deleteClipboardFile, ClipboardData } from "@/lib/clipboard";
import { downloadFileFromUrl } from "@/lib/download";

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

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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
  const [uploadPct, setUploadPct] = useState<number | null>(null);
  const [, forceTick] = useState(0);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const dragCounterRef = useRef(0);
  const [isDragOver, setIsDragOver] = useState(false);

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

  // "vor Xs" auffrischen und abgelaufenen Inhalt aufräumen
  useEffect(() => {
    const t = setInterval(() => {
      forceTick((n) => n + 1);
      if (user && data && isClipboardExpired(data.updatedAt)) {
        if (data.kind === "file") deleteClipboardFile(data.storagePath).catch(() => {});
        deleteDoc(doc(db, "clipboard", user.uid)).catch(() => {});
      }
    }, 5000);
    return () => clearInterval(t);
  }, [user, data]);

  const expired = data ? isClipboardExpired(data.updatedAt) : false;
  const visible = expired ? null : data;
  const remainingMs = visible ? Math.max(0, CLIPBOARD_TTL_MS - (Date.now() - visible.updatedAt)) : 0;
  const remainingMin = visible ? Math.max(1, Math.ceil(remainingMs / 60000)) : 0;
  const remainingFraction = visible ? remainingMs / CLIPBOARD_TTL_MS : 0;
  const ringR = 17;
  const ringC = 2 * Math.PI * ringR;

  const flash = useCallback((msg: string) => {
    setStatus(msg);
    setTimeout(() => setStatus(null), 2000);
  }, []);

  const save = useCallback(async (text: string) => {
    if (!user || !text) return;
    await setDoc(doc(db, "clipboard", user.uid), { kind: "text", text, updatedAt: Date.now() });
  }, [user]);

  const uploadFile = useCallback(async (file: File) => {
    if (!user) return;
    setUploadPct(0);
    try {
      await uploadClipboardFile({ file, uid: user.uid, onProgress: setUploadPct });
      flash("Datei eingefügt.");
    } catch (err) {
      console.error("Clipboard-Upload fehlgeschlagen:", err);
      alert("Datei-Upload fehlgeschlagen.");
    } finally {
      setUploadPct(null);
    }
  }, [user, flash]);

  const handleFileSelected = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) await uploadFile(file);
  }, [uploadFile]);

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.types.includes("Files")) {
      dragCounterRef.current += 1;
      setIsDragOver(true);
    }
  };
  const handleDragOver = (e: React.DragEvent) => e.preventDefault();
  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    dragCounterRef.current -= 1;
    if (dragCounterRef.current <= 0) {
      dragCounterRef.current = 0;
      setIsDragOver(false);
    }
  };
  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    dragCounterRef.current = 0;
    setIsDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) await uploadFile(file);
  };

  const handlePaste = useCallback(async () => {
    if (!user) return;

    // Erst versuchen, ein Bild direkt aus der System-Zwischenablage zu lesen
    try {
      if (navigator.clipboard?.read) {
        const items = await navigator.clipboard.read();
        for (const item of items) {
          const imageType = item.types.find((t) => t.startsWith("image/"));
          if (imageType) {
            const blob = await item.getType(imageType);
            const ext = imageType.split("/")[1] || "png";
            const file = new File([blob], `bild-${Date.now()}.${ext}`, { type: imageType });
            await uploadFile(file);
            return;
          }
        }
      }
    } catch {
      // Bild-Zugriff nicht moeglich/verweigert -> unten Text-Fallback versuchen
    }

    try {
      const text = await navigator.clipboard.readText();
      if (!text) { flash("Zwischenablage ist leer."); return; }
      await save(text);
      flash("Eingefügt.");
    } catch {
      // Kein Zugriff auf die Zwischenablage (Browser/Berechtigung) → manuelles Einfügen anbieten
      setManualMode(true);
    }
  }, [user, uploadFile, save, flash]);

  const handleManualSave = useCallback(async () => {
    if (!manualText.trim()) return;
    await save(manualText);
    setManualText("");
    setManualMode(false);
    flash("Eingefügt.");
  }, [manualText, save, flash]);

  const handleCopy = useCallback(async () => {
    if (!visible?.text) return;
    try {
      await navigator.clipboard.writeText(visible.text);
      flash("Kopiert.");
    } catch {
      flash("Kopieren nicht möglich.");
    }
  }, [visible, flash]);

  const handleCopyImage = useCallback(async () => {
    if (!visible?.downloadURL) return;
    try {
      const res = await fetch(visible.downloadURL);
      const blob = await res.blob();
      await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
      flash("Bild kopiert.");
    } catch {
      flash("Kopieren nicht möglich – bitte herunterladen.");
    }
  }, [visible, flash]);

  const handleDownloadFile = useCallback(async () => {
    if (!visible?.downloadURL || !visible.fileName) return;
    try {
      await downloadFileFromUrl(visible.downloadURL, visible.fileName);
    } catch (err) {
      console.error("Download fehlgeschlagen:", err);
      alert("Download fehlgeschlagen. Möglicherweise fehlt die CORS-Freigabe im Storage-Bucket.");
    }
  }, [visible]);

  const handleDelete = useCallback(async () => {
    if (!user || !visible) return;
    if (!confirm("Zwischenablage wirklich löschen?")) return;
    if (visible.kind === "file") await deleteClipboardFile(visible.storagePath);
    await deleteDoc(doc(db, "clipboard", user.uid));
    flash("Gelöscht.");
  }, [user, visible, flash]);

  if (loading) return (
    <div className="min-h-screen zwa-bg flex items-center justify-center">
      <p className="text-cyan-400/70 text-xs font-mono tracking-[0.3em] uppercase zwa-blink-text">
        Initialisiere…
      </p>
      <HudStyles />
    </div>
  );

  const isImageFile = visible?.kind === "file" && !!visible.mimeType?.startsWith("image/");

  return (
    <div
      className="min-h-screen zwa-bg text-cyan-50 flex flex-col relative overflow-hidden font-mono"
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div className="zwa-grid pointer-events-none absolute inset-0" />

      {isDragOver && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm border-4 border-dashed border-cyan-400/60 pointer-events-none">
          <div className="text-cyan-200 text-lg tracking-widest uppercase font-semibold text-center px-6">
            Datei hier ablegen zum Einfügen
          </div>
        </div>
      )}

      <header className="relative z-10 w-full flex items-center justify-between px-6 py-4 border-b border-cyan-400/20 bg-black/20 backdrop-blur-sm">
        <div className="flex items-center gap-3">
          <Link href="/" className="text-xs tracking-widest text-cyan-400/70 hover:text-cyan-300 transition uppercase">
            ← Zurück
          </Link>
          <span className="text-cyan-400/20">|</span>
          <h1 className="zwa-title text-lg font-bold text-cyan-100 uppercase">Zwischenablage</h1>
        </div>
        <span className="flex items-center gap-1.5 text-[10px] tracking-[0.2em] text-cyan-400/70 uppercase">
          <span className="zwa-dot h-1.5 w-1.5 rounded-full bg-cyan-400" />
          Sync aktiv
        </span>
      </header>

      <div className="relative z-10 flex-1 max-w-2xl w-full mx-auto px-6 py-10">
        <p className="text-xs text-cyan-300/50 mb-6 tracking-wide">
          &gt; Auf einem Gerät einfügen, auf jedem anderen Gerät sofort abrufbar. Text, Bilder oder Dateien.
        </p>

        {loadError && (
          <div className="mb-4 rounded-lg border border-rose-400/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
            ⚠ Verbindung fehlgeschlagen: {loadError}
          </div>
        )}

        <div className="flex items-center gap-3 mb-5 flex-wrap">
          <button onClick={handlePaste} className="zwa-btn zwa-btn-primary">
            Einfügen
          </button>

          <input ref={fileInputRef} type="file" onChange={handleFileSelected} className="hidden" />
          <button
            onClick={() => fileInputRef.current?.click()}
            className="zwa-btn zwa-btn-outline"
            disabled={!user || uploadPct !== null}
            title="Auswählen oder Datei per Drag&Drop auf die Seite ziehen"
          >
            {uploadPct !== null ? `Lädt hoch… ${uploadPct}%` : "Datei hochladen"}
          </button>

          {visible?.kind === "file" ? (
            <>
              {isImageFile && (
                <button onClick={handleCopyImage} className="zwa-btn zwa-btn-outline">
                  Bild kopieren
                </button>
              )}
              <button onClick={handleDownloadFile} className="zwa-btn zwa-btn-outline">
                Herunterladen
              </button>
            </>
          ) : (
            <button onClick={handleCopy} disabled={!visible?.text} className="zwa-btn zwa-btn-outline">
              Kopieren
            </button>
          )}

          <button onClick={handleDelete} disabled={!visible} className="zwa-btn zwa-btn-danger">
            Löschen
          </button>
          {status && <span className="text-xs text-cyan-300/70 tracking-wide">{">> " + status}</span>}
        </div>

        {manualMode && (
          <div className="zwa-panel rounded-2xl p-4 mb-6">
            <p className="text-[11px] text-cyan-300/60 mb-2 relative z-10">
              Direkter Zugriff nicht möglich. Hier einfügen (Halten → Einfügen, oder Strg/Cmd+V):
            </p>
            <textarea
              value={manualText}
              onChange={(e) => setManualText(e.target.value)}
              autoFocus
              rows={4}
              className="relative z-10 w-full rounded-xl border border-cyan-400/30 bg-black/40 px-3 py-2 text-sm text-cyan-50 focus:outline-none focus:border-cyan-400/70 transition placeholder:text-cyan-100/20"
              placeholder="Text hier einfügen…"
            />
            <div className="relative z-10 mt-3 flex items-center gap-2">
              <button onClick={handleManualSave} className="zwa-btn zwa-btn-primary">
                Übernehmen
              </button>
              <button
                onClick={() => { setManualMode(false); setManualText(""); }}
                className="text-xs text-cyan-300/50 hover:text-cyan-200 transition px-2"
              >
                Abbrechen
              </button>
            </div>
          </div>
        )}

        <div className="zwa-panel rounded-2xl p-5">
          {visible ? (
            <div className="relative z-10">
              {visible.kind === "file" ? (
                <div className="flex flex-col items-center gap-3 py-2">
                  {isImageFile && visible.downloadURL ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={visible.downloadURL}
                      alt={visible.fileName}
                      className="max-h-64 rounded-lg object-contain border border-cyan-400/20"
                    />
                  ) : (
                    <FileIcon size={44} className="text-cyan-300/60" strokeWidth={1.4} />
                  )}
                  <div className="text-sm text-cyan-50/90 text-center break-words max-w-full">
                    {visible.fileName}
                  </div>
                  {typeof visible.sizeBytes === "number" && (
                    <div className="text-[11px] text-cyan-300/40">{formatSize(visible.sizeBytes)}</div>
                  )}
                </div>
              ) : (
                <p className="text-sm text-cyan-50/90 whitespace-pre-wrap break-words leading-relaxed">
                  {visible.text}
                </p>
              )}
              <div className="mt-4 pt-3 border-t border-cyan-400/10 flex items-center justify-between gap-3">
                <span className="text-[10px] text-cyan-300/40 tracking-wide">
                  Aktualisiert {timeAgo(visible.updatedAt)}
                </span>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-[10px] text-cyan-300/50 tracking-wide">{remainingMin}min</span>
                  <svg width="30" height="30" viewBox="0 0 40 40">
                    <circle cx="20" cy="20" r={ringR} fill="none" stroke="rgba(34,211,238,0.15)" strokeWidth="3" />
                    <circle
                      cx="20" cy="20" r={ringR} fill="none"
                      stroke="#22d3ee" strokeWidth="3" strokeLinecap="round"
                      strokeDasharray={ringC}
                      strokeDashoffset={ringC * (1 - remainingFraction)}
                      transform="rotate(-90 20 20)"
                      style={{ filter: "drop-shadow(0 0 4px rgba(34,211,238,0.8))", transition: "stroke-dashoffset 1s linear" }}
                    />
                  </svg>
                </div>
              </div>
            </div>
          ) : (
            <p className="relative z-10 text-sm text-cyan-300/30 text-center py-10 tracking-wide">
              — Kein Signal —
            </p>
          )}
        </div>
        <p className="text-[10px] text-cyan-300/30 text-center mt-4 tracking-wide">
          Inhalt löscht sich automatisch nach 3 Minuten.
        </p>
      </div>

      <HudStyles />
    </div>
  );
}

// Eigenständige, zu dieser Seite gehörende Styles (nicht im globalen CSS, betrifft nur diese Page)
function HudStyles() {
  return (
    <style>{`
      .zwa-bg {
        background: radial-gradient(ellipse 80% 50% at 50% -10%, #0b2432 0%, #030509 55%, #000103 100%);
      }
      .zwa-grid {
        background-image:
          linear-gradient(rgba(34,211,238,0.07) 1px, transparent 1px),
          linear-gradient(90deg, rgba(34,211,238,0.07) 1px, transparent 1px);
        background-size: 38px 38px;
        -webkit-mask-image: radial-gradient(ellipse at top, black 0%, transparent 70%);
        mask-image: radial-gradient(ellipse at top, black 0%, transparent 70%);
      }
      .zwa-title {
        letter-spacing: 0.18em;
        text-shadow: 0 0 10px rgba(34,211,238,0.6), 0 0 26px rgba(34,211,238,0.25);
      }
      .zwa-dot {
        box-shadow: 0 0 6px rgba(34,211,238,0.9), 0 0 2px rgba(34,211,238,1);
        animation: zwa-blink 1.6s ease-in-out infinite;
      }
      .zwa-blink-text {
        animation: zwa-blink 1.4s ease-in-out infinite;
      }
      .zwa-panel {
        position: relative;
        background: linear-gradient(135deg, rgba(10,26,38,0.55), rgba(3,8,14,0.75));
        border: 1px solid rgba(34,211,238,0.3);
        backdrop-filter: blur(14px);
        -webkit-backdrop-filter: blur(14px);
        animation: zwa-pulse-glow 4.5s ease-in-out infinite;
        overflow: hidden;
      }
      .zwa-panel::before {
        content: "";
        position: absolute;
        left: 0; right: 0; height: 45%;
        background: linear-gradient(to bottom, transparent, rgba(34,211,238,0.12), transparent);
        animation: zwa-scan 6s linear infinite;
        pointer-events: none;
      }
      .zwa-btn {
        padding: 0.55rem 1.1rem;
        border-radius: 0.75rem;
        font-size: 0.8rem;
        letter-spacing: 0.05em;
        text-transform: uppercase;
        transition: all 0.2s ease;
        border-width: 1px;
        border-style: solid;
      }
      .zwa-btn:disabled {
        opacity: 0.3;
        cursor: not-allowed;
      }
      .zwa-btn-primary {
        background: linear-gradient(135deg, rgba(34,211,238,0.28), rgba(34,211,238,0.08));
        border-color: rgba(34,211,238,0.6);
        color: #ecfeff;
        text-shadow: 0 0 8px rgba(34,211,238,0.6);
      }
      .zwa-btn-primary:hover {
        box-shadow: 0 0 18px rgba(34,211,238,0.5);
        background: linear-gradient(135deg, rgba(34,211,238,0.4), rgba(34,211,238,0.15));
      }
      .zwa-btn-outline {
        border-color: rgba(148,163,184,0.3);
        color: #a5f3fc;
        background: transparent;
      }
      .zwa-btn-outline:not(:disabled):hover {
        border-color: rgba(34,211,238,0.6);
        color: #cffafe;
        box-shadow: 0 0 12px rgba(34,211,238,0.25);
      }
      .zwa-btn-danger {
        border-color: rgba(244,63,94,0.35);
        color: #fda4af;
        background: transparent;
      }
      .zwa-btn-danger:not(:disabled):hover {
        border-color: rgba(244,63,94,0.7);
        box-shadow: 0 0 14px rgba(244,63,94,0.4);
        color: #fecdd3;
      }
      @keyframes zwa-pulse-glow {
        0%, 100% { box-shadow: 0 0 14px rgba(34,211,238,0.25), inset 0 0 24px rgba(34,211,238,0.04); }
        50% { box-shadow: 0 0 26px rgba(34,211,238,0.45), inset 0 0 32px rgba(34,211,238,0.08); }
      }
      @keyframes zwa-scan {
        0% { transform: translateY(-120%); opacity: 0; }
        15% { opacity: 0.7; }
        85% { opacity: 0.7; }
        100% { transform: translateY(220%); opacity: 0; }
      }
      @keyframes zwa-blink {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.25; }
      }
    `}</style>
  );
}
