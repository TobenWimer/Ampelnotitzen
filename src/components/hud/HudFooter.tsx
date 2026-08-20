// Durchgaengige Fusszeile ueber alle internen Module, Gegenstueck zur Kopfzeile.
// Zweiter Zweck neben der Optik: reserviert dauerhaft Platz am unteren Rand, damit
// Dropdowns, die sich am Seitenende oeffnen, nicht ohne Scroll-Reserve aus dem
// sichtbaren Bereich rutschen (siehe NameMenu.tsx fuer den zugehoerigen Vertikal-Flip).
// dotClassName: welche Puls-Animation greift, je nach Stilsystem der Seite.
// hud-dot (HudGlobalStyles) ueberall ausser Dokumente, dort dhud-dot (HudStyles).
export function HudFooter({ dotClassName = "hud-dot" }: { dotClassName?: string }) {
  return (
    <footer className="relative z-10 mt-auto w-full flex items-center justify-between px-6 py-3 border-t border-cyan-400/20 bg-black/20 backdrop-blur-sm">
      <span className="text-[10px] tracking-[0.2em] text-cyan-400/50 uppercase">
        TW · CORE
      </span>
      <span className="flex items-center gap-1.5 text-[10px] tracking-[0.2em] text-cyan-400/70 uppercase">
        <span className={`${dotClassName} h-1.5 w-1.5 rounded-full bg-cyan-400`} />
        Sync aktiv
      </span>
    </footer>
  );
}
