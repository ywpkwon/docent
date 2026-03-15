/** Legend id (e.g. "agree", "disagree") — user-configurable */
export type HighlightColor = string;

export interface Legend {
  id: string;
  label: string;
  hex: string;       // background color (full opacity)
  borderHex: string; // border / accent color
}

export interface HighlightRect {
  x: number; y: number; w: number; h: number; // fractional (0–1) relative to page
}

export interface Highlight {
  id: string;
  page: number; // 0-based
  color: HighlightColor; // legend id
  text: string;
  note: string;
  timestamp: number;
  rects?: HighlightRect[];
  source?: "tour";
}

export interface FigureBBox {
  id: string;
  label: string;
  page: number; // 0-based
  bbox: { x: number; y: number; w: number; h: number };
}

/** A unique internal link destination extracted from PDF annotations */
export interface PdfLink {
  id: string;       // e.g., "ref13", "refattention", "p12" (fallback)
  label: string;    // original annotation text, e.g., "[13]", "§3.2"
  destPage: number; // 0-based
  destPdfX?: number;
  destPdfY?: number;
}

export interface PageChunk {
  page: number;
  text: string;
  section_title: string | null;
}

export interface ParsedPaper {
  title: string;
  abstract: string;
  page_count: number;
  pages: PageChunk[];
  figures: FigureBBox[];
  system_prompt: string;
}

// Actions dispatched by the voice layer
export type VoiceAction =
  | { type: "PAGE_NAV"; page: number }
  | { type: "PAGE_RELATIVE"; delta: number }
  | { type: "SHOW_FIGURE"; figure_id: string }
  | { type: "HIGHLIGHT"; color: HighlightColor; note: string }
  | { type: "NONE" };

// Messages from the backend WebSocket
export type WsMessage =
  | { type: "audio"; data: string }
  | { type: "action"; action: VoiceAction }
  | { type: "transcript"; text: string }
  | { type: "status"; status: VoiceStatus }
  | { type: "error"; message: string };

export type VoiceStatus = "idle" | "listening" | "thinking" | "speaking" | "interrupted" | "connecting";

export interface TourEvent {
  at_char: number;
  cmd: string;
}
