import type { FolderColor } from "./types";

// Neon-Glow-Farben statt der frueheren Pastell-Verlaeufe, gleiche Farbschluessel
// (in Firestore gespeichert) wie vorher, nur die Darstellung ist neu.
export const HUD_COLORS: Record<FolderColor, string> = {
  blue: "#38bdf8",
  teal: "#2dd4bf",
  green: "#4ade80",
  yellow: "#fbbf24",
  orange: "#fb923c",
  red: "#f87171",
  pink: "#f472b6",
  purple: "#a78bfa",
  gray: "#94a3b8",
};

export const HUD_COLOR_ORDER: FolderColor[] = [
  "blue", "teal", "green", "yellow", "orange", "red", "pink", "purple", "gray",
];

export function hudColor(color?: FolderColor): string {
  return HUD_COLORS[color ?? "blue"];
}
