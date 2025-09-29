"use client";

import Image from "next/image";
import Link from "next/link";
import Protected from "@/components/Protected";
import { signOut } from "@/lib/firebase";
import { useState } from "react";
import { Settings } from "lucide-react";

type Module = {
  key: string;
  title: string;
  desc: string;
  href?: string;
};

const modules: Module[] = [
  {
    key: "notes",
    title: "Notizen",
    desc: "Kleine Gedanken schnell festhalten.",
    href: "/notes",
  },
];

function Card({ m }: { m: Module }) {
  const base =
    "group relative rounded-2xl border backdrop-blur-md p-5 shadow-sm transition " +
    "bg-gradient-to-br from-gray-200/55 via-white/35 to-gray-100/45 border-black/20";
  const hover = m.href ? "hover:shadow-lg hover:border-black/40" : "opacity-60 cursor-not-allowed";

  const content = (
    <>
      <div className="flex items-center gap-3 mb-3">
        <h3 className="text-xl font-bold text-black tracking-tight">{m.title}</h3>
      </div>
      <p className="text-sm text-gray-700">{m.desc}</p>
    </>
  );

  if (m.href) {
    return (
      <Link href={m.href} className={`${base} ${hover}`} aria-label={`${m.title} öffnen`}>
        {content}
      </Link>
    );
  }
  return (
    <div className={`${base} ${hover}`} aria-disabled>
      {content}
    </div>
  );
}

function Header() {
  const [open, setOpen] = useState(false);

  return (
    <header className="w-full flex items-center justify-between px-6 py-4 bg-white/40 backdrop-blur-md border-b border-black/10">
      <div className="flex items-center gap-3">
        <Image src="/logo.png" alt="OneStepBehind Logo" width={40} height={40} />
        <h1 className="text-2xl font-bold text-black">OneStepBehind</h1>
      </div>

      {/* Settings Menu */}
      <div className="relative">
        <button
          onClick={() => setOpen((o) => !o)}
          className="p-2 rounded-xl border border-black/20 bg-gradient-to-br from-gray-200/55 via-white/35 to-gray-100/45 backdrop-blur-md hover:bg-white/60 transition"
          aria-haspopup="menu"
          aria-expanded={open}
        >
          <Settings size={20} className="text-gray-800" />
        </button>

        {open && (
          <div
            role="menu"
            className="absolute right-0 mt-2 w-40 rounded-xl border border-black/20 bg-gradient-to-br from-gray-200/70 via-white/40 to-gray-100/60 backdrop-blur-md shadow-lg p-2"
          >
            <button
              onClick={signOut}
              className="w-full text-left px-3 py-2 rounded-lg hover:bg-white/70 text-gray-900 text-sm"
              role="menuitem"
            >
              Abmelden
            </button>
          </div>
        )}
      </div>
    </header>
  );
}

export default function Home() {
  return (
    <Protected>
      <main className="min-h-screen bg-white flex flex-col">
        <Header />
        <div className="flex-1 max-w-5xl mx-auto px-6 py-10">
          {/* Nur eine Kachel: Notizen */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {modules.map((m) => (
              <Card key={m.key} m={m} />
            ))}
          </div>
        </div>
      </main>
    </Protected>
  );
}
