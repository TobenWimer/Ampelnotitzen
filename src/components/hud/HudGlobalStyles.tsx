"use client";

// App-weites Jarvis/HUD-Stilsystem (Prefix "hud-"), geteilt von allen Modulen ausser
// Dokumente/Zwischenablage (die haben ihre eigenen, bereits fertigen dhud-/zwa-Styles -
// bewusst nicht angetastet, um funktionierende Seiten nicht zu riskieren). Sorgt fuer eine
// einheitliche Titel-/Panel-/Button-Optik ueber Notizen, Tracker, Daily Recap und Startseite.
export default function HudGlobalStyles() {
  return (
    <style>{`
      .hud-bg {
        background: radial-gradient(ellipse 80% 50% at 50% -10%, #0b2432 0%, #030509 55%, #000103 100%);
      }
      .hud-grid {
        background-image:
          linear-gradient(rgba(34,211,238,0.07) 1px, transparent 1px),
          linear-gradient(90deg, rgba(34,211,238,0.07) 1px, transparent 1px);
        background-size: 38px 38px;
        -webkit-mask-image: radial-gradient(ellipse at top, black 0%, transparent 70%);
        mask-image: radial-gradient(ellipse at top, black 0%, transparent 70%);
      }
      .hud-title {
        letter-spacing: 0.14em;
        text-shadow: 0 0 10px rgba(34,211,238,0.6), 0 0 26px rgba(34,211,238,0.25);
      }
      .hud-dot {
        box-shadow: 0 0 6px rgba(34,211,238,0.9), 0 0 2px rgba(34,211,238,1);
        animation: hud-blink 1.6s ease-in-out infinite;
      }

      .hud-panel {
        position: relative;
        background: linear-gradient(135deg, rgba(10,26,38,0.55), rgba(3,8,14,0.75));
        border: 1px solid rgba(34,211,238,0.25);
        backdrop-filter: blur(14px);
        -webkit-backdrop-filter: blur(14px);
        overflow: hidden;
        transition: box-shadow 0.25s ease, border-color 0.25s ease, transform 0.15s ease;
        box-shadow: 0 0 14px rgba(34,211,238,0.12), inset 0 0 24px rgba(34,211,238,0.04);
      }
      .hud-panel-hover:hover {
        border-color: rgba(34,211,238,0.6);
        box-shadow: 0 0 24px rgba(34,211,238,0.3), inset 0 0 24px rgba(34,211,238,0.08);
        transform: translateY(-2px);
      }
      .hud-panel::before {
        content: "";
        position: absolute;
        left: 0; right: 0; height: 45%;
        background: linear-gradient(to bottom, transparent, rgba(34,211,238,0.1), transparent);
        animation: hud-scan 7s linear infinite;
        pointer-events: none;
      }

      .hud-corner {
        position: absolute;
        z-index: 20;
        width: 10px;
        height: 10px;
        border-color: rgba(34,211,238,0.7);
        opacity: 0.85;
        pointer-events: none;
      }
      .hud-corner-tl { top: 6px; left: 6px; border-top: 2px solid; border-left: 2px solid; }
      .hud-corner-tr { top: 6px; right: 6px; border-top: 2px solid; border-right: 2px solid; }
      .hud-corner-bl { bottom: 6px; left: 6px; border-bottom: 2px solid; border-left: 2px solid; }
      .hud-corner-br { bottom: 6px; right: 6px; border-bottom: 2px solid; border-right: 2px solid; }

      .hud-btn {
        padding: 0.55rem 1.1rem;
        border-radius: 0.75rem;
        font-size: 0.8rem;
        letter-spacing: 0.05em;
        text-transform: uppercase;
        transition: all 0.2s ease;
        border-width: 1px;
        border-style: solid;
        white-space: nowrap;
      }
      .hud-btn:disabled {
        opacity: 0.3;
        cursor: not-allowed;
      }
      .hud-btn-primary {
        background: linear-gradient(135deg, rgba(34,211,238,0.28), rgba(34,211,238,0.08));
        border-color: rgba(34,211,238,0.6);
        color: #ecfeff;
        text-shadow: 0 0 8px rgba(34,211,238,0.6);
      }
      .hud-btn-primary:hover {
        box-shadow: 0 0 18px rgba(34,211,238,0.5);
        background: linear-gradient(135deg, rgba(34,211,238,0.4), rgba(34,211,238,0.15));
      }
      .hud-btn-outline {
        border-color: rgba(148,163,184,0.3);
        color: #a5f3fc;
        background: transparent;
      }
      .hud-btn-outline:not(:disabled):hover {
        border-color: rgba(34,211,238,0.6);
        color: #cffafe;
        box-shadow: 0 0 12px rgba(34,211,238,0.25);
      }
      .hud-btn-danger {
        border-color: rgba(244,63,94,0.35);
        color: #fda4af;
        background: transparent;
      }
      .hud-btn-danger:not(:disabled):hover {
        border-color: rgba(244,63,94,0.7);
        box-shadow: 0 0 14px rgba(244,63,94,0.4);
        color: #fecdd3;
      }

      .hud-input {
        background: rgba(0,0,0,0.4);
        border: 1px solid rgba(34,211,238,0.3);
        color: #ecfeff;
        border-radius: 0.75rem;
        padding: 0.55rem 0.9rem;
        font-size: 0.85rem;
      }
      .hud-input:focus {
        outline: none;
        border-color: rgba(34,211,238,0.7);
        box-shadow: 0 0 10px rgba(34,211,238,0.25);
      }
      .hud-input::placeholder {
        color: rgba(165,243,252,0.3);
      }

      .hud-menu {
        background: linear-gradient(135deg, rgba(8,20,32,0.92), rgba(3,8,14,0.96));
        border: 1px solid rgba(34,211,238,0.3);
        backdrop-filter: blur(14px);
        -webkit-backdrop-filter: blur(14px);
        box-shadow: 0 0 22px rgba(34,211,238,0.2);
      }
      .hud-menu-item {
        display: block;
        width: 100%;
        text-align: left;
        padding: 0.5rem 0.75rem;
        font-size: 0.8rem;
        color: #a5f3fc;
        transition: background 0.15s ease, color 0.15s ease;
      }
      .hud-menu-item:hover {
        background: rgba(34,211,238,0.1);
        color: #ecfeff;
      }

      .hud-ring-spin-slow { animation: hud-spin 22s linear infinite; }
      .hud-ring-spin-slow-rev { animation: hud-spin-rev 34s linear infinite; }

      @keyframes hud-spin {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
      }
      @keyframes hud-spin-rev {
        from { transform: rotate(360deg); }
        to { transform: rotate(0deg); }
      }
      @keyframes hud-scan {
        0% { transform: translateY(-120%); opacity: 0; }
        15% { opacity: 0.7; }
        85% { opacity: 0.7; }
        100% { transform: translateY(220%); opacity: 0; }
      }
      @keyframes hud-blink {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.25; }
      }
      @keyframes hud-pulse-glow {
        0%, 100% { box-shadow: 0 0 14px rgba(34,211,238,0.25), inset 0 0 24px rgba(34,211,238,0.04); }
        50% { box-shadow: 0 0 26px rgba(34,211,238,0.45), inset 0 0 32px rgba(34,211,238,0.08); }
      }
      @keyframes hud-core-pulse {
        0%, 100% { transform: scale(1); opacity: 1; }
        50% { transform: scale(1.12); opacity: 0.85; }
      }
      /* vertikaler Scanner, faehrt in einer Saeule hoch und runter */
      @keyframes hud-vscan {
        0% { top: 100%; opacity: 0; }
        10% { opacity: 1; }
        50% { top: 0%; opacity: 1; }
        90% { opacity: 1; }
        100% { top: 100%; opacity: 0; }
      }
      /* horizontaler Transfer-Puls, laeuft von links nach rechts durch eine Leitung */
      @keyframes hud-transfer {
        0% { left: -20%; }
        100% { left: 100%; }
      }
      @keyframes hud-dash-flow {
        to { stroke-dashoffset: -100; }
      }
    `}</style>
  );
}
