'use client';

import Link from "next/link";
import Image from "next/image";

export default function DokumentePage() {
  return (
    <div className="min-h-screen bg-white">
      <div className="p-8 max-w-5xl mx-auto font-sans">
        {/* Mini-Header: Logo + Title → Link zur Startseite */}
        <Link href="/" className="flex flex-col items-center mb-6 group" title="Zur Startseite">
          <Image
            src="/logo.png"
            alt="OneStepBehind Logo"
            width={88}
            height={88}
            priority
            className="transition-transform group-hover:scale-105"
          />
          <h1 className="mt-3 text-4xl md:text-5xl font-extrabold text-black tracking-tight group-hover:opacity-90">
            OneStepBehind
          </h1>
          <span className="mt-1 text-xs text-gray-600 opacity-80">Zur Startseite klicken</span>
        </Link>

        {/* Inhalt der Dokumente-Seite */}
        <h2 className="text-2xl font-bold">Dokumente</h2>
        <p className="mt-2">Die Dokumente-Seite ist bereit. Weiter geht’s gleich.</p>
      </div>
    </div>
  );
}
