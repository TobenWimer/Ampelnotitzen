// Geteilter Inhalt ist bewusst nur eine kurze Zeit gültig (Handoff-Zweck, kein Speicher)
export const CLIPBOARD_TTL_MS = 3 * 60 * 1000;
export const isClipboardExpired = (updatedAt: number) => Date.now() - updatedAt > CLIPBOARD_TTL_MS;
