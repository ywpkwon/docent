"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Highlight, Legend } from "@/lib/types";
import { highlightBorder, highlightFill, highlightLabel } from "@/lib/highlights";

const PAD = 10;
const PREVIEW_SCALE = 1.8;
const DEBOUNCE_MS = 150;

let pdfjsLib: typeof import("pdfjs-dist") | null = null;
async function getPdfjs() {
  if (!pdfjsLib) {
    pdfjsLib = await import("pdfjs-dist");
    pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;
  }
  return pdfjsLib;
}

interface HLItem {
  hl: Highlight;
  fracY?: number;  // rects[0].y — fractional top of first rect
  fracX?: number;  // rects[0].x
  label: string;
  fill: string;
  border: string;
}

function InlinePreview({ pdfUrl, item }: { pdfUrl: string; item: HLItem | null }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(false);

  // Render canvas when item changes
  useEffect(() => {
    if (!item) return;
    let cancelled = false;
    let renderTask: import("pdfjs-dist").RenderTask | null = null;
    setLoading(true);

    const timer = setTimeout(async () => {
      try {
        const lib = await getPdfjs();
        if (cancelled) return;
        const pdf = await lib.getDocument(pdfUrl).promise;
        if (cancelled) return;
        const pdfPage = await pdf.getPage(item.hl.page + 1);
        if (cancelled) return;

        const vp = pdfPage.getViewport({ scale: PREVIEW_SCALE });
        const canvas = canvasRef.current;
        if (!canvas || cancelled) return;

        const dpr = window.devicePixelRatio || 1;
        const physVP = pdfPage.getViewport({ scale: PREVIEW_SCALE * dpr });
        canvas.width = physVP.width;
        canvas.height = physVP.height;
        canvas.style.width = `${vp.width}px`;
        canvas.style.height = `${vp.height}px`;

        renderTask = pdfPage.render({ canvasContext: canvas.getContext("2d")!, viewport: physVP });
        await renderTask.promise;
        if (cancelled) return;

        setLoading(false);
      } catch {
        if (!cancelled) setLoading(false);
      }
    }, DEBOUNCE_MS);

    return () => { cancelled = true; clearTimeout(timer); renderTask?.cancel(); };
  }, [pdfUrl, item?.hl.id]);

  // Scroll to highlight — runs when loading finishes OR when fracY/fracX updates (rects resolved later)
  useLayoutEffect(() => {
    if (loading || !scrollRef.current || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const w = canvas.offsetWidth;
    const h = canvas.offsetHeight;
    const el = scrollRef.current;
    const fracY = item?.fracY;
    const fracX = item?.fracX;
    el.scrollLeft = fracX !== undefined
      ? Math.min(Math.max(0, fracX * w + PAD - 40), Math.max(0, el.scrollWidth - el.clientWidth))
      : 0;
    el.scrollTop = fracY !== undefined ? Math.max(0, fracY * h + PAD - 80) : 0;
  }, [loading, item?.fracY, item?.fracX]);

  return (
    <div ref={scrollRef} style={{ overflow: "auto", height: "100%", background: "#525659", position: "relative" }}>
      {!item && (
        <div style={{ display: "flex", height: "100%", alignItems: "center", justifyContent: "center" }}>
          <span style={{ color: "rgba(255,255,255,0.35)", fontSize: 13, fontFamily: "ui-monospace, monospace" }}>
            select a highlight to preview
          </span>
        </div>
      )}
      {item && loading && (
        <div style={{ position: "absolute", inset: 0, zIndex: 2, display: "flex", alignItems: "center", justifyContent: "center", background: "#525659" }}>
          <div style={{ width: 22, height: 22, borderRadius: "50%", border: "2px solid var(--accent)", borderTopColor: "transparent", animation: "hl-spin 0.8s linear infinite" }} />
        </div>
      )}
      <div style={{ padding: PAD, display: "inline-block", minWidth: "100%", boxSizing: "border-box", position: "relative" }}>
        <canvas ref={canvasRef} style={{ display: "block", opacity: loading ? 0 : 1, transition: "opacity 0.15s", boxShadow: "0 2px 12px rgba(0,0,0,0.4)", borderRadius: 2 }} />
        {!loading && item && item.fracY !== undefined && item.hl.rects && (
          <div style={{ position: "absolute", top: PAD, left: PAD, right: PAD, bottom: 0, pointerEvents: "none" }}>
            {item.hl.rects.map((r, i) => (
              <div key={i} style={{
                position: "absolute",
                left:   r.x * (canvasRef.current?.offsetWidth ?? 0),
                top:    r.y * (canvasRef.current?.offsetHeight ?? 0),
                width:  r.w * (canvasRef.current?.offsetWidth ?? 0),
                height: r.h * (canvasRef.current?.offsetHeight ?? 0),
                background: item.fill,
                border: `1px solid ${item.border}`,
                borderRadius: 2,
                mixBlendMode: "multiply",
              }} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

interface Props {
  highlights: Highlight[];
  legends: Legend[];
  currentHighlightId?: string | null;
  pdfUrl: string;
  onClose: () => void;
  onRemove: (id: string) => void;
  onNavigate: (page: number) => void;
}

export function HighlightsPanel({ highlights, legends, currentHighlightId, pdfUrl, onClose, onRemove, onNavigate }: Props) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const allItems = useMemo((): HLItem[] => {
    const sorted = [...highlights].sort((a, b) => {
      if (a.page !== b.page) return a.page - b.page;
      return (a.rects?.[0]?.y ?? 0) - (b.rects?.[0]?.y ?? 0);
    });
    return sorted.map((hl) => ({
      hl,
      fracY: hl.rects?.[0]?.y,
      fracX: hl.rects?.[0]?.x,
      label: highlightLabel(legends, hl.color),
      fill:  highlightFill(legends, hl.color),
      border: highlightBorder(legends, hl.color),
    }));
  }, [highlights, legends]);

  const items = useMemo(() => {
    if (!query.trim()) return allItems;
    const q = query.trim().toLowerCase();
    return allItems.filter((it) =>
      it.hl.text.toLowerCase().includes(q) ||
      it.hl.note.toLowerCase().includes(q) ||
      it.label.toLowerCase().includes(q) ||
      `p.${it.hl.page + 1}`.includes(q)
    );
  }, [allItems, query]);

  // Track selection by ID so re-sorting (when rects are resolved) doesn't silently change the item
  const initialId = useMemo(() => {
    if (currentHighlightId && items.find(it => it.hl.id === currentHighlightId)) return currentHighlightId;
    return items[0]?.hl.id ?? null;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const [selectedId, setSelectedId] = useState<string | null>(initialId);

  // Derive display index from ID
  const selectedIdx = useMemo(
    () => items.findIndex(it => it.hl.id === selectedId),
    [items, selectedId],
  );

  // If selected item disappears (removed or filtered out), snap to first in list
  useEffect(() => {
    if (items.length === 0) { setSelectedId(null); return; }
    if (selectedIdx === -1) setSelectedId(items[0].hl.id);
  }, [items, selectedIdx]);

  const selectedItem = selectedIdx >= 0 ? items[selectedIdx] : null;

  // Focus input on mount
  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 30);
    return () => clearTimeout(t);
  }, []);

  // Scroll selected row into view
  useEffect(() => {
    if (selectedIdx < 0) return;
    const el = listRef.current?.children[selectedIdx] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest" });
  }, [selectedIdx]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape" || e.key === "h") { e.preventDefault(); onClose(); return; }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      const next = items[Math.min(selectedIdx + 1, items.length - 1)];
      if (next) setSelectedId(next.hl.id);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      const prev = items[Math.max(selectedIdx - 1, 0)];
      if (prev) setSelectedId(prev.hl.id);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (selectedItem) { onNavigate(selectedItem.hl.page); onClose(); }
    } else if (e.key === "Delete" || e.key === "Backspace") {
      if (query === "" && selectedItem) {
        e.preventDefault();
        // Proactively pick next selection before item disappears from list
        const nextId = items[selectedIdx + 1]?.hl.id ?? items[selectedIdx - 1]?.hl.id ?? null;
        setSelectedId(nextId);
        onRemove(selectedItem.hl.id);
      }
    }
  }, [items, selectedIdx, selectedItem, onClose, onNavigate, onRemove, query]);

  // Global Escape + re-focus input when browser tab regains focus
  useEffect(() => {
    const onEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key === "h") { e.preventDefault(); onClose(); }
    };
    const onWindowFocus = () => inputRef.current?.focus();
    window.addEventListener("keydown", onEscape);
    window.addEventListener("focus", onWindowFocus);
    return () => {
      window.removeEventListener("keydown", onEscape);
      window.removeEventListener("focus", onWindowFocus);
    };
  }, [onClose]);

  return (
    <>
      <div style={{ position: "fixed", inset: 0, zIndex: 9000, background: "rgba(0,0,0,0.55)" }} onClick={onClose} />
      <div style={{
        position: "fixed", top: "50%", left: "50%", transform: "translate(-50%,-50%)",
        zIndex: 9001, width: "min(1100px, 90vw)", height: "min(680px, 80vh)",
        display: "flex", flexDirection: "column",
        background: "var(--surface)", border: "1px solid var(--border)",
        borderRadius: 8, boxShadow: "0 20px 60px rgba(0,0,0,0.5)", overflow: "hidden",
        fontFamily: "ui-monospace, 'Cascadia Code', 'Fira Code', monospace",
      }}>
        {/* Search bar */}
        <div style={{
          display: "flex", alignItems: "center", gap: 10,
          padding: "10px 14px", borderBottom: "1px solid var(--border)",
          background: "var(--surface-2)", flexShrink: 0,
        }}>
          <span style={{ color: "var(--accent)", fontSize: 14, fontWeight: 700 }}>h</span>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="filter highlights…"
            autoComplete="off" spellCheck={false}
            style={{
              flex: 1, background: "transparent", border: "none", outline: "none",
              color: "var(--text)", fontSize: 13, fontFamily: "inherit",
            }}
          />
          <span style={{ color: "var(--text-muted)", fontSize: 11, whiteSpace: "nowrap" }}>
            {items.length} · ↑↓ · Enter · Del · Esc
          </span>
        </div>

        {/* Body */}
        <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
          {/* List */}
          <div ref={listRef} style={{
            width: "38%", borderRight: "1px solid var(--border)",
            overflowY: "auto", flexShrink: 0,
          }}>
            {items.length === 0 && (
              <div style={{ padding: "24px 12px", textAlign: "center", color: "var(--text-muted)", fontSize: 12 }}>
                {highlights.length === 0 ? "no highlights yet" : "no matches"}
              </div>
            )}
            {items.map((item) => {
              const active = item.hl.id === selectedId;
              return (
                <div
                  key={item.hl.id}
                  onClick={() => setSelectedId(item.hl.id)}
                  onDoubleClick={() => { onNavigate(item.hl.page); onClose(); }}
                  style={{
                    padding: "7px 12px", cursor: "pointer", userSelect: "none",
                    background: active ? "var(--accent)" : "transparent",
                    borderLeft: `3px solid ${active ? "transparent" : item.border}`,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
                    <div style={{
                      width: 7, height: 7, borderRadius: "50%", flexShrink: 0,
                      background: item.border,
                      opacity: active ? 0.85 : 1,
                    }} />
                    <span style={{ fontSize: 10, fontWeight: 600, color: active ? "rgba(255,255,255,0.75)" : item.border, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                      {item.label}
                    </span>
                    {item.hl.source === "tour" && (
                      <span style={{ fontSize: 9, color: active ? "rgba(255,255,255,0.55)" : "var(--text-muted)", marginLeft: 2 }}>tour</span>
                    )}
                    <span style={{ marginLeft: "auto", fontSize: 10, color: active ? "rgba(255,255,255,0.6)" : "var(--text-muted)" }}>
                      p.{item.hl.page + 1}
                    </span>
                    <button
                      onClick={(e) => { e.stopPropagation(); onRemove(item.hl.id); }}
                      style={{
                        fontSize: 13, background: "none", border: "none",
                        color: active ? "rgba(255,255,255,0.6)" : "var(--text-muted)",
                        cursor: "pointer", flexShrink: 0, lineHeight: 1, padding: "0 2px",
                      }}
                      title="Remove (Del)"
                    >×</button>
                  </div>
                  <p style={{
                    fontSize: 11, margin: 0, lineHeight: 1.45,
                    color: active ? "rgba(255,255,255,0.9)" : "var(--text)",
                    display: "-webkit-box", WebkitLineClamp: 2,
                    WebkitBoxOrient: "vertical", overflow: "hidden",
                  }}>
                    {item.hl.text || item.hl.note || "(no text)"}
                  </p>
                  {item.hl.note && item.hl.text && (
                    <p style={{
                      fontSize: 10, margin: "2px 0 0", lineHeight: 1.35,
                      color: active ? "rgba(255,255,255,0.6)" : "var(--text-muted)",
                      display: "-webkit-box", WebkitLineClamp: 1,
                      WebkitBoxOrient: "vertical", overflow: "hidden",
                    }}>
                      {item.hl.note}
                    </p>
                  )}
                </div>
              );
            })}
          </div>

          {/* Preview */}
          <div style={{ flex: 1, overflow: "hidden" }}>
            <InlinePreview pdfUrl={pdfUrl} item={selectedItem} />
          </div>
        </div>
      </div>
      <style>{`@keyframes hl-spin { to { transform: rotate(360deg); } }`}</style>
    </>
  );
}
