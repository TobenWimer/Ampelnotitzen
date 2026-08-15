"use client";

import Link from "next/link";
import Protected from "@/components/Protected";
import { auth, db, signOut } from "@/lib/firebase";
import { useEffect, useState } from "react";
import {
  Settings,
  ClipboardCopy,
  Check,
  StickyNote,
  TrendingUp,
  Activity,
  ClipboardList,
  FolderOpen,
} from "lucide-react";
import { doc, onSnapshot } from "firebase/firestore";
import { isClipboardExpired, ClipboardData } from "@/lib/clipboard";
import HudGlobalStyles from "@/components/hud/HudGlobalStyles";
import { ReactorEmblem } from "@/components/hud/ReactorEmblem";

type Module = {
  key: string;
  title: string;
  desc: string;
  href: string;
  icon: typeof StickyNote;
  accent: string;
};

const modules: Module[] = [
  {
    key: "notes",
    title: "Notizen",
    desc: "Kleine Gedanken schnell festhalten.",
    href: "/notes",
    icon: StickyNote,
    accent: "#fbbf24",
  },
  {
    key: "tracker",
    title: "Investment Tracker",
    desc: "Pots verwalten, Trades eröffnen und Gewinne verfolgen.",
    href: "/tracker",
    icon: TrendingUp,
    accent: "#34d399",
  },
  {
    key: "daily",
    title: "Daily Recap",
    desc: "Tägliche Selbstbewertung: besser oder schlechter als gestern?",
    href: "/daily",
    icon: Activity,
    accent: "#a78bfa",
  },
  {
    key: "zwischenablage",
    title: "Zwischenablage",
    desc: "Auf einem Gerät einfügen, auf jedem anderen sofort kopierbar.",
    href: "/zwischenablage",
    icon: ClipboardList,
    accent: "#22d3ee",
  },
  {
    key: "dokumente",
    title: "Dokumente",
    desc: "Ordner und Dokumente organisieren.",
    href: "/dokumente",
    icon: FolderOpen,
    accent: "#38bdf8",
  },
];

function Card({ m }: { m: Module }) {
  const Icon = m.icon;
  return (
    <Link
      href={m.href}
      aria-label={`${m.title} öffnen`}
      className="hud-panel hud-panel-hover group relative rounded-2xl p-5 block"
      style={{ borderColor: `${m.accent}44` }}
    >
      <span className="hud-corner hud-corner-tl" style={{ borderColor: m.accent }} />
      <span className="hud-corner hud-corner-tr" style={{ borderColor: m.accent }} />
      <span className="hud-corner hud-corner-bl" style={{ borderColor: m.accent }} />
      <span className="hud-corner hud-corner-br" style={{ borderColor: m.accent }} />

      <div className="relative z-10 flex items-center gap-3 mb-3">
        <Icon size={22} style={{ color: m.accent, filter: `drop-shadow(0 0 6px ${m.accent}aa)` }} />
        <h3 className="text-base font-bold tracking-wide uppercase text-cyan-50">{m.title}</h3>
      </div>
      <p className="relative z-10 text-sm text-cyan-200/50 leading-relaxed">{m.desc}</p>
    </Link>
  );
}

// Zeigt einen Kopieren-Button im Header, sobald in der Zwischenablage etwas (noch nicht abgelaufenes) liegt
function ClipboardQuickCopy() {
  const [uid, setUid] = useState<string | null>(null);
  const [entry, setEntry] = useState<ClipboardData | null>(null);
  const [copied, setCopied] = useState(false);
  const [, forceTick] = useState(0);

  useEffect(() => {
    const off = auth.onAuthStateChanged((u) => setUid(u?.uid ?? null));
    return off;
  }, []);

  useEffect(() => {
    if (!uid) { setEntry(null); return; }
    const ref = doc(db, "clipboard", uid);
    const off = onSnapshot(
      ref,
      (snap) => setEntry(snap.exists() ? (snap.data() as ClipboardData) : null),
      () => setEntry(null)
    );
    return off;
  }, [uid]);

  // Ablauf auch ohne neuen Snapshot erkennen, falls kein anderes Gerät gerade aufräumt
  useEffect(() => {
    const t = setInterval(() => forceTick((n) => n + 1), 30000);
    return () => clearInterval(t);
  }, []);

  // Quick-Copy im Header bleibt bewusst auf Text beschraenkt (Bilder/Dateien -> /zwischenablage)
  if (!entry || !entry.text || isClipboardExpired(entry.updatedAt)) return null;
  const text = entry.text;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Zugriff verweigert: kein Feedback nötig, Nutzer versucht es erneut
    }
  };

  return (
    <button onClick={handleCopy} title="Aus der Zwischenablage kopieren" className="hud-btn hud-btn-outline">
      {copied ? <Check size={16} className="inline -mt-0.5" /> : <ClipboardCopy size={16} className="inline -mt-0.5" />}
    </button>
  );
}

function Header() {
  const [open, setOpen] = useState(false);

  return (
    <header className="relative z-10 w-full flex items-center justify-between px-6 py-4 border-b border-cyan-400/20 bg-black/20 backdrop-blur-sm">
      <div className="flex items-center gap-4">
        <ReactorEmblem size={52} />
        <div>
          <h1 className="hud-title text-xl font-bold text-cyan-100 uppercase">OneStepBehind</h1>
          <span className="flex items-center gap-1.5 text-[10px] tracking-[0.2em] text-cyan-400/70 uppercase mt-0.5">
            <span className="hud-dot h-1.5 w-1.5 rounded-full bg-cyan-400" />
            Sync aktiv
          </span>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <ClipboardQuickCopy />
        <div className="relative">
          <button
            onClick={() => setOpen((o) => !o)}
            className="hud-btn hud-btn-outline"
            aria-haspopup="menu"
            aria-expanded={open}
          >
            <Settings size={16} className="inline -mt-0.5" />
          </button>

          {open && (
            <div role="menu" className="hud-menu absolute right-0 mt-2 min-w-40 rounded-xl overflow-hidden z-50">
              <button onClick={signOut} className="hud-menu-item" role="menuitem">
                Abmelden
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

export default function Home() {
  return (
    <Protected>
      <main className="min-h-screen hud-bg text-cyan-50 flex flex-col relative overflow-hidden font-mono">
        <div className="hud-grid pointer-events-none absolute inset-0" />
        <Header />
        <div className="relative z-10 flex-1 max-w-5xl mx-auto px-6 py-10 w-full">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {modules.map((m) => (
              <Card key={m.key} m={m} />
            ))}
          </div>
        </div>
        <HudGlobalStyles />
      </main>
    </Protected>
  );
}
