/**
 * Docent canonical command vocabulary.
 *
 * Both Gemini (text/voice) and users typing directly target these commands.
 * To add a new command:
 *   1. Add an entry to COMMAND_REGISTRY below.
 *   2. Handle it in executeCommand() in page.tsx.
 *   3. The system prompt is rebuilt from this registry automatically.
 */

export interface CommandDef {
  name: string;
  /** Display syntax shown in hints and the system prompt sent to Gemini */
  syntax: string;
  /** One-line description for Gemini's system prompt */
  description: string;
}

export const COMMAND_REGISTRY: CommandDef[] = [
  {
    name: "next_page",
    syntax: "next_page",
    description: "Go to next page",
  },
  {
    name: "prev_page",
    syntax: "prev_page",
    description: "Go to previous page",
  },
  {
    name: "go_page",
    syntax: "go_page <n>",
    description: "Jump to page n (1-indexed, e.g. go_page 5)",
  },
  {
    name: "show_link",
    syntax: "show_link <id>",
    description: "Preview a figure, table, or PDF link destination (e.g. show_link fig1  or  show_link p12)",
  },
  {
    name: "highlight",
    syntax: "highlight <color>",
    description:
      "Add highlight to current page/selection — color must be one of: agree | disagree | comment | question | definition | other",
  },
  {
    name: "next_highlight",
    syntax: "next_highlight [color]",
    description: "Jump to next highlight, optionally filtered by legend color (e.g. next_highlight question)",
  },
  {
    name: "prev_highlight",
    syntax: "prev_highlight [color]",
    description: "Jump to previous highlight, optionally filtered by legend color",
  },
  {
    name: "change_highlight",
    syntax: "change_highlight <color>",
    description: "Change the current highlight's legend color (e.g. change_highlight agree)",
  },
  {
    name: "none",
    syntax: "none",
    description: "No navigation action needed",
  },
  // ── Future commands (add handler in executeCommand when ready) ─────────────
  // { name: "jump_to_ref",   syntax: "jump_to_ref <n>",   description: "Navigate to reference [n]" },
  // { name: "preview_ref",   syntax: "preview_ref <n>",   description: "Floating preview of reference [n]" },
  // { name: "preview_fig",   syntax: "preview_fig <id>",  description: "Floating preview of figure (no popup)" },
  // { name: "zoom_in",       syntax: "zoom_in",           description: "Increase zoom level" },
  // { name: "zoom_out",      syntax: "zoom_out",          description: "Decrease zoom level" },
  // { name: "back",          syntax: "back",              description: "Go back in navigation history" },
];

// ── Parsing ───────────────────────────────────────────────────────────────────

export interface ParsedCommand {
  name: string;
  args: string[];
  raw: string;
}

/**
 * Parse a raw command string (e.g. "go_page 5") into a ParsedCommand.
 * Returns null if the command name is not in the registry.
 */
export function parseCommand(input: string): ParsedCommand | null {
  const trimmed = input.trim();
  const parts = trimmed.split(/\s+/);
  if (!parts[0]) return null;
  const name = parts[0].toLowerCase();
  if (!COMMAND_REGISTRY.find((c) => c.name === name)) return null;
  return { name, args: parts.slice(1), raw: trimmed };
}

const COLORS = ["agree", "disagree", "comment", "question", "definition", "other"];

/**
 * Local natural-language → command mapping.
 * Handles common spoken/typed phrases without an API round-trip.
 * Returns null when no pattern matches (caller should fall back to Gemini).
 */
export function parseNaturalCommand(input: string): ParsedCommand | null {
  const s = input.trim().toLowerCase();
  const cmd = (name: string, args: string[]): ParsedCommand => ({ name, args, raw: input });

  // ── Page navigation ──────────────────────────────────────────────────────
  if (/\b(next page|go forward|forward|next)\b/.test(s))
    return cmd("next_page", []);
  if (/\b(prev(ious)? page|go back(ward)?|previous|back)\b/.test(s))
    return cmd("prev_page", []);

  let m: RegExpMatchArray | null;
  if ((m = s.match(/\b(?:go\s+to\s+)?page\s+(\d+)\b/)) ||
      (m = s.match(/\bjump\s+to\s+(?:page\s+)?(\d+)\b/)))
    return cmd("go_page", [m[1]]);

  // ── Show figure / table / algorithm ─────────────────────────────────────
  if ((m = s.match(/\b(?:show|open|display|preview)\s+fig(?:ure)?\s*(\d+)\b/)) ||
      (m = s.match(/\bfig(?:ure)?\s*(\d+)\b/)))
    return cmd("show_link", [`fig${m[1]}`]);

  if ((m = s.match(/\b(?:show|open|display|preview)\s+table\s*(\d+)\b/)) ||
      (m = s.match(/\btable\s*(\d+)\b/)))
    return cmd("show_link", [`table${m[1]}`]);

  if ((m = s.match(/\b(?:show|open|display|preview)\s+alg(?:orithm)?\s*(\d+)\b/)))
    return cmd("show_link", [`alg${m[1]}`]);

  // ── Show reference / citation ────────────────────────────────────────────
  if ((m = s.match(/\b(?:show|open|display|preview)\s+ref(?:erence)?\s*(\d+)\b/)) ||
      (m = s.match(/\bref(?:erence)?\s*(\d+)\b/)) ||
      (m = s.match(/\bcitation\s*(\d+)\b/)) ||
      (m = s.match(/\[(\d+)\]/)))
    return cmd("show_link", [`ref${m[1]}`]);

  // ── Highlight ────────────────────────────────────────────────────────────
  if ((m = s.match(/\b(?:highlight|mark|annotate)\b.*\b(agree|disagree|comment|question|definition|other)\b/)) ||
      (m = s.match(/\b(agree|disagree|comment|question|definition|other)\b.*\b(?:highlight|mark)\b/)))
    return cmd("highlight", [m[1]]);

  // ── Highlight navigation ─────────────────────────────────────────────────
  const colorPat = COLORS.join("|");
  if ((m = s.match(new RegExp(`\\bnext\\s+highlight(?:\\s+(${colorPat}))?\\b`))))
    return cmd("next_highlight", m[1] ? [m[1]] : []);
  if ((m = s.match(new RegExp(`\\bprev(?:ious)?\\s+highlight(?:\\s+(${colorPat}))?\\b`))))
    return cmd("prev_highlight", m[1] ? [m[1]] : []);

  return null;
}

/**
 * Find the CommandDef whose name matches the beginning of the user's input.
 * Used for inline syntax hints in the command bar.
 */
export function matchingDef(input: string): CommandDef | null {
  const name = input.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
  return COMMAND_REGISTRY.find((c) => c.name === name) ?? null;
}
