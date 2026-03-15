import type { Legend } from "./types";

export const DEFAULT_LEGENDS: Legend[] = [
  { id: "agree",      label: "Agree",      hex: "#86efac", borderHex: "#22c55e" }, // green
  { id: "disagree",   label: "Disagree",   hex: "#fca5a5", borderHex: "#ef4444" }, // red
  { id: "comment",    label: "Comment",    hex: "#93c5fd", borderHex: "#3b82f6" }, // blue
  { id: "question",   label: "Question",   hex: "#f9a8d4", borderHex: "#ec4899" }, // pink
  { id: "definition", label: "Definition", hex: "#fdba74", borderHex: "#f97316" }, // orange
  { id: "other",      label: "Other",      hex: "#d8b4fe", borderHex: "#9333ea" }, // purple
];

const STORAGE_KEY = "docent:legends";

export function loadLegends(): Legend[] {
  if (typeof window === "undefined") return DEFAULT_LEGENDS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_LEGENDS;
    const parsed = JSON.parse(raw) as Legend[];
    if (!Array.isArray(parsed) || parsed.length === 0) return DEFAULT_LEGENDS;
    return parsed;
  } catch {
    return DEFAULT_LEGENDS;
  }
}

export function saveLegends(legends: Legend[]): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(legends));
}

export function getLegend(legends: Legend[], id: string): Legend | undefined {
  return legends.find((l) => l.id === id);
}

/** Semi-transparent fill for the highlight div */
export function legendFill(hex: string, alpha = 0.35): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}
