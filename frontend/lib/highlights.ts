import type { Highlight, HighlightColor, HighlightRect, Legend } from "./types";
import { getLegend, legendFill, DEFAULT_LEGENDS } from "./legends";

let _idCounter = 0;
function newId(): string {
  return `hl-${Date.now()}-${_idCounter++}`;
}

export function createHighlight(
  page: number,
  color: HighlightColor,
  text: string,
  note = "",
  rects?: HighlightRect[]
): Highlight {
  return { id: newId(), page, color, text, note, timestamp: Date.now(), rects };
}

export function highlightFill(legends: Legend[], color: string): string {
  const l = getLegend(legends, color);
  return l ? legendFill(l.hex) : "rgba(200,200,200,0.35)";
}

export function highlightBorder(legends: Legend[], color: string): string {
  const l = getLegend(legends, color);
  return l ? l.borderHex : "#aaa";
}

export function highlightLabel(legends: Legend[], color: string): string {
  const l = getLegend(legends, color);
  return l ? l.label : color;
}

export function exportToObsidian(title: string, highlights: Highlight[], legends: Legend[]): string {
  if (highlights.length === 0) return `## Highlights — ${title}\n\n_No highlights yet._\n`;

  const grouped = new Map<string, Highlight[]>();
  for (const h of highlights) {
    if (!grouped.has(h.color)) grouped.set(h.color, []);
    grouped.get(h.color)!.push(h);
  }

  const lines: string[] = [`## Highlights — ${title}\n`];
  for (const [color, items] of Array.from(grouped.entries())) {
    const label = highlightLabel(legends, color);
    const leg = getLegend(legends, color);
    const swatch = leg ? `[${leg.hex}]` : "";
    lines.push(`### ${label} ${swatch}`);
    for (const h of items) {
      const page = h.page + 1;
      const note = h.note ? ` _(${h.note})_` : "";
      lines.push(`- p.${page}: "${h.text}"${note}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

// Re-export defaults so consumers don't need to import from legends directly
export { DEFAULT_LEGENDS };
