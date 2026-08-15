"use client";

// Gemeinsame Styles fuer die Dokumente-Ordner-/Browse-Seiten (Jarvis/Hologramm-Look).
// Nur lokal in diesen Seiten eingebunden, nicht im globalen CSS -> betrifft nur /dokumente.
export default function DokumenteHudStyles() {
  return (
    <style>{`
      .dhud-bg {
        background: radial-gradient(ellipse 80% 50% at 50% -10%, #0b2432 0%, #030509 55%, #000103 100%);
      }
      .dhud-grid {
        background-image:
          linear-gradient(rgba(34,211,238,0.07) 1px, transparent 1px),
          linear-gradient(90deg, rgba(34,211,238,0.07) 1px, transparent 1px);
        background-size: 38px 38px;
        -webkit-mask-image: radial-gradient(ellipse at top, black 0%, transparent 70%);
        mask-image: radial-gradient(ellipse at top, black 0%, transparent 70%);
      }
      .dhud-title {
        letter-spacing: 0.14em;
        text-shadow: 0 0 10px rgba(34,211,238,0.6), 0 0 26px rgba(34,211,238,0.25);
      }
      .dhud-dot {
        box-shadow: 0 0 6px rgba(34,211,238,0.9), 0 0 2px rgba(34,211,238,1);
        animation: dhud-blink 1.6s ease-in-out infinite;
      }

      /* Kacheln (Ordner/Dokument) */
      .dhud-tile {
        position: relative;
        background: linear-gradient(135deg, rgba(10,26,38,0.55), rgba(3,8,14,0.75));
        border: 1px solid color-mix(in srgb, var(--glow) 45%, transparent);
        backdrop-filter: blur(10px);
        -webkit-backdrop-filter: blur(10px);
        transition: box-shadow 0.25s ease, border-color 0.25s ease, transform 0.15s ease;
        box-shadow: 0 0 10px color-mix(in srgb, var(--glow) 18%, transparent), inset 0 0 18px color-mix(in srgb, var(--glow) 6%, transparent);
      }
      .dhud-tile:hover {
        border-color: color-mix(in srgb, var(--glow) 80%, transparent);
        box-shadow: 0 0 22px color-mix(in srgb, var(--glow) 40%, transparent), inset 0 0 24px color-mix(in srgb, var(--glow) 10%, transparent);
        transform: translateY(-2px);
      }
      .dhud-tile::before {
        content: "";
        position: absolute;
        left: 0; right: 0; height: 40%;
        background: linear-gradient(to bottom, transparent, color-mix(in srgb, var(--glow) 20%, transparent), transparent);
        animation: dhud-scan 6s linear infinite;
        pointer-events: none;
      }
      .dhud-corner {
        position: absolute;
        width: 10px;
        height: 10px;
        border-color: color-mix(in srgb, var(--glow) 70%, transparent);
        opacity: 0.85;
        pointer-events: none;
      }
      .dhud-corner-tl { top: 6px; left: 6px; border-top: 2px solid; border-left: 2px solid; }
      .dhud-corner-tr { top: 6px; right: 6px; border-top: 2px solid; border-right: 2px solid; }
      .dhud-corner-bl { bottom: 6px; left: 6px; border-bottom: 2px solid; border-left: 2px solid; }
      .dhud-corner-br { bottom: 6px; right: 6px; border-bottom: 2px solid; border-right: 2px solid; }

      /* Name-Button + Dropdown */
      .dhud-name-btn {
        padding: 0.25rem 0.6rem;
        font-size: 0.85rem;
        font-weight: 600;
        color: #cffafe;
        max-width: 100%;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        border-radius: 0.5rem;
        transition: background 0.15s ease, color 0.15s ease;
        letter-spacing: 0.02em;
      }
      .dhud-name-btn:hover {
        background: rgba(34,211,238,0.08);
        color: #ecfeff;
      }
      .dhud-menu {
        background: linear-gradient(135deg, rgba(8,20,32,0.92), rgba(3,8,14,0.96));
        border: 1px solid rgba(34,211,238,0.3);
        backdrop-filter: blur(14px);
        -webkit-backdrop-filter: blur(14px);
        box-shadow: 0 0 22px rgba(34,211,238,0.2);
      }
      .dhud-menu-item {
        display: block;
        width: 100%;
        text-align: left;
        padding: 0.5rem 0.75rem;
        font-size: 0.8rem;
        color: #a5f3fc;
        transition: background 0.15s ease, color 0.15s ease;
      }
      .dhud-menu-item:hover {
        background: rgba(34,211,238,0.1);
        color: #ecfeff;
      }
      .dhud-menu-item-danger {
        color: #fda4af;
      }
      .dhud-menu-item-danger:hover {
        background: rgba(244,63,94,0.12);
        color: #fecdd3;
      }
      .dhud-menu-divider {
        height: 1px;
        background: rgba(34,211,238,0.15);
      }

      /* Buttons + Inputs (Kopfzeile) */
      .dhud-btn {
        padding: 0.55rem 1rem;
        border-radius: 0.75rem;
        font-size: 0.78rem;
        letter-spacing: 0.04em;
        text-transform: uppercase;
        transition: all 0.2s ease;
        border-width: 1px;
        border-style: solid;
        white-space: nowrap;
      }
      .dhud-btn:disabled {
        opacity: 0.3;
        cursor: not-allowed;
      }
      .dhud-btn-primary {
        background: linear-gradient(135deg, rgba(34,211,238,0.28), rgba(34,211,238,0.08));
        border-color: rgba(34,211,238,0.6);
        color: #ecfeff;
        text-shadow: 0 0 8px rgba(34,211,238,0.6);
      }
      .dhud-btn-primary:hover {
        box-shadow: 0 0 18px rgba(34,211,238,0.5);
        background: linear-gradient(135deg, rgba(34,211,238,0.4), rgba(34,211,238,0.15));
      }
      .dhud-btn-outline {
        border-color: rgba(148,163,184,0.3);
        color: #a5f3fc;
        background: transparent;
      }
      .dhud-btn-outline:not(:disabled):hover {
        border-color: rgba(34,211,238,0.6);
        color: #cffafe;
        box-shadow: 0 0 12px rgba(34,211,238,0.25);
      }
      .dhud-btn-danger {
        border-color: rgba(244,63,94,0.35);
        color: #fda4af;
        background: transparent;
      }
      .dhud-btn-danger:not(:disabled):hover {
        border-color: rgba(244,63,94,0.7);
        box-shadow: 0 0 14px rgba(244,63,94,0.4);
        color: #fecdd3;
      }
      .dhud-input {
        background: rgba(0,0,0,0.4);
        border: 1px solid rgba(34,211,238,0.3);
        color: #ecfeff;
        border-radius: 0.75rem;
        padding: 0.55rem 0.9rem;
        font-size: 0.85rem;
      }
      .dhud-input:focus {
        outline: none;
        border-color: rgba(34,211,238,0.7);
        box-shadow: 0 0 10px rgba(34,211,238,0.25);
      }
      .dhud-input::placeholder {
        color: rgba(165,243,252,0.3);
      }

      @keyframes dhud-scan {
        0% { transform: translateY(-120%); opacity: 0; }
        15% { opacity: 0.7; }
        85% { opacity: 0.7; }
        100% { transform: translateY(220%); opacity: 0; }
      }
      @keyframes dhud-blink {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.25; }
      }
    `}</style>
  );
}
