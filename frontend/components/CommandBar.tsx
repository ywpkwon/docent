"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { COMMAND_REGISTRY, matchingDef } from "@/lib/commands";
import type { Highlight, Legend, ParsedPaper, PdfLink } from "@/lib/types";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (text: string) => Promise<{ speech: string } | null>;
  paper: ParsedPaper | null;
  legends: Legend[];
  highlights: Highlight[];
  pdfLinks?: PdfLink[];
}

type Phase = "input" | "thinking" | "response";

interface CompletionItem {
  /** Full command string that will be submitted */
  value: string;
  /** Primary label (id / page number) */
  label: string;
  /** Secondary description */
  detail: string;
  /** Right-side badge (e.g. "p.3") */
  badge?: string;
  /** Swatch color (for highlight completions) */
  swatch?: string;
}

/** Returns -1 if no match, otherwise a score (higher = better match). */
function fuzzyScore(haystack: string, needle: string): number {
  if (!needle) return 0;
  const h = haystack.toLowerCase();
  const n = needle.toLowerCase();
  let score = 0, hi = 0, consecutive = 0, firstIdx = -1;
  for (let ni = 0; ni < n.length; ni++) {
    const idx = h.indexOf(n[ni], hi);
    if (idx === -1) return -1;
    if (firstIdx === -1) firstIdx = idx;
    if (idx === hi) { consecutive++; score += consecutive * 3; } // consecutive run bonus
    else { consecutive = 0; score += 1; }
    if (idx === 0 || /[\s\-_.]/.test(h[idx - 1])) score += 4; // word-start bonus
    hi = idx + 1;
  }
  score -= firstIdx * 0.5; // penalise late first match
  return score;
}

function getCompletions(
  input: string,
  paper: ParsedPaper | null,
  legends: Legend[],
  highlights: Highlight[],
  pdfLinks: PdfLink[],
): CompletionItem[] {
  const lower = input.toLowerCase();

  // ── show_link ─────────────────────────────────────────────────────────────
  if (lower === "show_link" || lower.startsWith("show_link ")) {
    const query = lower.startsWith("show_link ") ? lower.slice(10) : "";
    // ID match is primary (×10), label match is a tiebreaker only.
    // This prevents long captions with scattered r/e/f chars from outranking "ref13".
    const showLinkScore = (id: string, label: string) => {
      const idS = fuzzyScore(id, query);
      const lblS = fuzzyScore(label, query);
      if (idS >= 0) return idS * 10 + Math.max(0, lblS);
      return lblS; // label-only match gets a low score
    };

    const items = [
      ...(paper?.figures ?? []).map((f) => ({
        score: showLinkScore(f.id, f.label ?? ""),
        item: { value: `show_link ${f.id}`, label: f.id, detail: f.label || "(figure/table)", badge: `p.${f.page + 1}` } as CompletionItem,
      })),
      ...pdfLinks.map((l) => ({
        score: showLinkScore(l.id, l.label),
        item: { value: `show_link ${l.id}`, label: l.id, detail: l.label ? `${l.label} → p.${l.destPage + 1}` : `→ p.${l.destPage + 1}`, badge: `p.${l.destPage + 1}` } as CompletionItem,
      })),
    ].filter((x) => x.score >= 0).sort((a, b) => b.score - a.score).map((x) => x.item);
    if (items.length > 0) return items;
    // No items — fall through to command prefix completions
  }

  // ── highlight ─────────────────────────────────────────────────────────────
  if (lower === "highlight" || lower.startsWith("highlight ")) {
    const query = lower.startsWith("highlight ") ? lower.slice(10) : "";
    return legends
      .map((l) => ({ l, score: Math.max(fuzzyScore(l.id, query), fuzzyScore(l.label, query)) }))
      .filter((x) => x.score >= 0).sort((a, b) => b.score - a.score)
      .map(({ l }) => ({ value: `highlight ${l.id}`, label: l.id, detail: l.label, swatch: l.hex }));
  }

  // ── next_highlight / prev_highlight ──────────────────────────────────────
  if (lower === "next_highlight" || lower.startsWith("next_highlight ") ||
      lower === "prev_highlight" || lower.startsWith("prev_highlight ")) {
    const cmd   = lower.startsWith("next") ? "next_highlight" : "prev_highlight";
    const query = lower.slice(cmd.length + 1);
    const counts = new Map<string, number>();
    for (const h of highlights) counts.set(h.color, (counts.get(h.color) ?? 0) + 1);
    const items = legends
      .filter((l) => counts.has(l.id))
      .map((l) => ({ l, score: Math.max(fuzzyScore(l.id, query), fuzzyScore(l.label, query)) }))
      .filter((x) => x.score >= 0).sort((a, b) => b.score - a.score)
      .map(({ l }) => ({ value: `${cmd} ${l.id}`, label: l.id, detail: l.label, badge: `${counts.get(l.id)} hl`, swatch: l.hex }));
    if (items.length > 0) return items;
  }

  // ── change_highlight ──────────────────────────────────────────────────────
  if (lower === "change_highlight" || lower.startsWith("change_highlight ")) {
    const query = lower.startsWith("change_highlight ") ? lower.slice(17) : "";
    return legends
      .map((l) => ({ l, score: Math.max(fuzzyScore(l.id, query), fuzzyScore(l.label, query)) }))
      .filter((x) => x.score >= 0).sort((a, b) => b.score - a.score)
      .map(({ l }) => ({ value: `change_highlight ${l.id}`, label: l.id, detail: l.label, swatch: l.hex }));
  }

  // ── go_page: show sections ────────────────────────────────────────────────
  if (lower === "go_page" || lower.startsWith("go_page ")) {
    const query = lower.startsWith("go_page ") ? lower.slice(8) : "";
    return (paper?.pages ?? [])
      .map((p) => ({ p, score: Math.max(fuzzyScore(String(p.page + 1), query), fuzzyScore(p.section_title ?? "", query)) }))
      .filter((x) => x.score >= 0).sort((a, b) => b.score - a.score)
      .slice(0, 20)
      .map(({ p }) => ({ value: `go_page ${p.page + 1}`, label: `p.${p.page + 1}`, detail: p.section_title ?? "(no section title)" }));
  }

  // ── command-name prefix completions ───────────────────────────────────────
  if (lower) {
    return COMMAND_REGISTRY
      .filter((c) => c.name !== "none")
      .map((c) => ({ c, score: fuzzyScore(c.name, lower) }))
      .filter((x) => x.score >= 0).sort((a, b) => b.score - a.score)
      .map(({ c }) => ({ value: c.name, label: c.name, detail: c.description }));
  }

  return [];
}

const HINT_CMDS = COMMAND_REGISTRY.filter((c) => c.name !== "none")
  .map((c) => c.syntax)
  .join("  ·  ");

export function CommandBar({ isOpen, onClose, onSubmit, paper, legends, highlights, pdfLinks = [] }: Props) {
  const [input, setInput]         = useState("");
  const [phase, setPhase]         = useState<Phase>("input");
  const [response, setResponse]   = useState("");
  const [selectedIdx, setSelected] = useState(0);

  const inputRef   = useRef<HTMLInputElement>(null);
  const listRef    = useRef<HTMLDivElement>(null);
  const dismissRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const completions = useMemo(
    () => getCompletions(input, paper, legends, highlights, pdfLinks),
    [input, paper, legends, highlights, pdfLinks],
  );
  const hint = useMemo(
    () => (completions.length === 0 ? matchingDef(input) : null),
    [completions.length, input],
  );

  // Reset selected index when completion list changes
  useEffect(() => { setSelected(0); }, [completions.length]);

  // Scroll selected item into view
  useEffect(() => {
    const el = listRef.current?.children[selectedIdx] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest" });
  }, [selectedIdx]);

  // Focus on open
  useEffect(() => {
    if (!isOpen) return;
    setInput(""); setPhase("input"); setResponse("");
    const t = setTimeout(() => inputRef.current?.focus(), 30);
    return () => clearTimeout(t);
  }, [isOpen]);

  useEffect(() => {
    return () => { if (dismissRef.current) clearTimeout(dismissRef.current); };
  }, []);

  const close = useCallback(() => {
    if (dismissRef.current) clearTimeout(dismissRef.current);
    onClose();
  }, [onClose]);

  // Core submit logic — separated so completions can call it directly
  const submitText = useCallback(async (text: string) => {
    text = text.trim();
    if (!text) { close(); return; }
    setInput(text);
    setPhase("thinking");
    const result = await onSubmit(text);
    if (!result) { close(); return; }
    if (!result.speech) {
      close(); // direct command: instant
    } else {
      setResponse(result.speech);
      setPhase("response");
      dismissRef.current = setTimeout(close, 4000);
    }
  }, [close, onSubmit]);

  const handleFormSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    if (completions.length > 0) {
      submitText(completions[selectedIdx]?.value ?? input);
    } else {
      submitText(input);
    }
  }, [completions, selectedIdx, input, submitText]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") { e.preventDefault(); close(); return; }

    if (completions.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelected((i) => Math.min(i + 1, completions.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelected((i) => Math.max(i - 1, 0));
      } else if (e.key === "Tab") {
        // Tab: fill input with selected completion without submitting.
        // If the value is a bare command name (no space), append a space so
        // the user can immediately type the argument (e.g. "show_link ").
        e.preventDefault();
        const item = completions[selectedIdx];
        if (item) setInput(item.value.includes(" ") ? item.value : item.value + " ");
      }
      // Enter is handled by form onSubmit
    }
  }, [completions, selectedIdx, close]);

  if (!isOpen) return null;

  return (
    <>
      {/* Completions list — floats above the bar */}
      {phase === "input" && completions.length > 0 && (
        <div
          ref={listRef}
          style={{
            position: "fixed",
            bottom: 45, // sits just above the bar
            left: 0,
            right: 0,
            zIndex: 9998,
            maxHeight: 260,
            overflowY: "auto",
            background: "var(--surface-2)",
            borderTop: "1px solid var(--border)",
            borderBottom: "none",
            fontFamily: "ui-monospace, 'Cascadia Code', 'Fira Code', monospace",
            fontSize: 12,
          }}
        >
          {completions.map((item, i) => (
            <div
              key={item.value}
              onMouseDown={(e) => { e.preventDefault(); submitText(item.value); }}
              onMouseEnter={() => setSelected(i)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "7px 16px",
                cursor: "pointer",
                background: i === selectedIdx ? "var(--accent)" : "transparent",
                color: i === selectedIdx ? "#fff" : "var(--text)",
                transition: "background 0.08s",
              }}
            >
              {/* Color swatch for highlight completions */}
              {item.swatch && (
                <span style={{
                  display: "inline-block",
                  width: 10, height: 10,
                  borderRadius: "50%",
                  background: item.swatch,
                  flexShrink: 0,
                }} />
              )}

              {/* Primary label */}
              <span style={{
                fontWeight: 600,
                color: i === selectedIdx ? "#fff" : "var(--accent)",
                minWidth: 80,
                flexShrink: 0,
              }}>
                {item.label}
              </span>

              {/* Detail */}
              <span style={{
                flex: 1,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                color: i === selectedIdx ? "rgba(255,255,255,0.85)" : "var(--text-muted)",
              }}>
                {item.detail}
              </span>

              {/* Badge (page number) */}
              {item.badge && (
                <span style={{
                  flexShrink: 0,
                  fontSize: 11,
                  color: i === selectedIdx ? "rgba(255,255,255,0.7)" : "var(--text-muted)",
                }}>
                  {item.badge}
                </span>
              )}
            </div>
          ))}

          {/* Navigation hint */}
          <div style={{
            padding: "4px 16px",
            fontSize: 10,
            color: "var(--text-muted)",
            borderTop: "1px solid var(--border)",
            display: "flex",
            gap: 12,
          }}>
            <span>↑↓ navigate</span>
            <span>Enter select</span>
            <span>Tab fill</span>
            <span>Esc close</span>
          </div>
        </div>
      )}

      {/* Command bar */}
      <div
        style={{
          position: "fixed",
          bottom: 0, left: 0, right: 0,
          zIndex: 9999,
          borderTop: "1px solid var(--border)",
          background: "var(--surface-2)",
          padding: "0 16px",
          display: "flex",
          flexDirection: "column",
          fontFamily: "ui-monospace, 'Cascadia Code', 'Fira Code', monospace",
          fontSize: 13,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, minHeight: 44 }}>

          {phase === "input" && (
            <>
              <span style={{ color: "var(--accent)", fontWeight: 700, fontSize: 16, userSelect: "none" }}>:</span>
              <form onSubmit={handleFormSubmit} style={{ flex: 1, display: "flex", alignItems: "center", gap: 8 }}>
                <input
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="next_page  ·  go_page 5  ·  show_link  ·  highlight  ·  or plain English…"
                  autoComplete="off" spellCheck={false}
                  style={{
                    flex: 1, background: "transparent", border: "none",
                    outline: "none", color: "var(--text)", fontSize: 13, fontFamily: "inherit",
                  }}
                />
                {hint && (
                  <span style={{ color: "var(--text-muted)", fontSize: 11, whiteSpace: "nowrap", flexShrink: 0 }}>
                    {hint.syntax}
                  </span>
                )}
              </form>
              <span style={{ color: "var(--text-muted)", fontSize: 11, whiteSpace: "nowrap" }}>
                Enter ↵ &nbsp;·&nbsp; Esc
              </span>
            </>
          )}

          {phase === "thinking" && (
            <>
              <span style={{ color: "var(--accent)", fontWeight: 700, fontSize: 16, userSelect: "none" }}>:</span>
              <span style={{ color: "var(--text-muted)", flex: 1 }}>{input}</span>
              <span style={{ color: "var(--text-muted)", fontSize: 12, display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{
                  display: "inline-block", width: 10, height: 10, borderRadius: "50%",
                  border: "2px solid var(--accent)", borderTopColor: "transparent",
                  animation: "spin 0.7s linear infinite",
                }} />
                thinking…
              </span>
            </>
          )}

          {phase === "response" && (
            <>
              <span style={{ color: "var(--accent)", fontWeight: 700, userSelect: "none" }}>PaperPal</span>
              <span style={{ color: "var(--text-muted)" }}>→</span>
              <span style={{ flex: 1, color: "var(--text)" }}>{response}</span>
              <span style={{ color: "var(--text-muted)", fontSize: 11, whiteSpace: "nowrap" }}>
                auto-close · Esc
              </span>
            </>
          )}
        </div>

        {/* Command reference strip — shown only when input is empty */}
        {phase === "input" && !input && (
          <div style={{
            borderTop: "1px solid var(--border)",
            padding: "5px 0 6px",
            color: "var(--text-muted)",
            fontSize: 11,
            overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis",
          }}>
            <span style={{ marginRight: 8, opacity: 0.7 }}>commands:</span>
            {HINT_CMDS}
          </div>
        )}

        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    </>
  );
}
