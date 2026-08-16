// src/app/layout.tsx
import type { Metadata } from "next";
import "./globals.css";

// Symbol und Link-Vorschaubild kommen aus src/app/icon.tsx bzw. opengraph-image.tsx,
// Next.js erkennt beide automatisch. Deshalb hier keine icons-Angabe mehr.
// Ohne description zeigen Messenger nur Titel und Domain statt einer Beschreibung,
// die den Zweck der App ohnehin nicht mehr trifft.
export const metadata: Metadata = {
  title: "OneStepBehind",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="de">
      {/* Dunkler Grundton, damit beim Laden kein weisses Aufblitzen entsteht.
          Jede Seite setzt ihren eigenen Hintergrund darueber */}
      <body className="antialiased bg-[#04070c] text-cyan-50">
        {children}
      </body>
    </html>
  );
}
