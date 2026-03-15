"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { FigureBBox, PdfLink } from "@/lib/types";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (id: string) => void;
  pdfUrl: string;
  figures: FigureBBox[];
  pdfLinks: PdfLink[];
}

interface Item {
  id: string;
  label: string;
  detail: string;
  badge: string;
  destPage: number;
  destPdfX?: number;  // PDF-unit x (for ref links with XYZ destination)
  destPdfY?: number;
  destFracX?: number; // fractional x 0-1 (for figures)
  destFracY?: number;
}

function fuzzyScore(haystack: string, needle: string): number {
  if (!needle) return 0;
  const h = haystack.toLowerCase(), n = needle.toLowerCase();
  let score = 0, hi = 0, consecutive = 0, firstIdx = -1;
  for (let ni = 0; ni < n.length; ni++) {
    const idx = h.indexOf(n[ni], hi);
    if (idx === -1) return -1;
    if (firstIdx === -1) firstIdx = idx;
    if (idx === hi) { consecutive++; score += consecutive * 3; }
    else { consecutive = 0; score += 1; }
    if (idx === 0 || /[\s\-_.]/.test(h[idx - 1])) score += 4;
    hi = idx + 1;
  }
  score -= firstIdx * 0.5;
  return score;
}

let pdfjsLib: typeof import("pdfjs-dist") | null = null;
async function getPdfjs() {
  if (!pdfjsLib) {
    pdfjsLib = await import("pdfjs-dist");
    pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;
  }
  return pdfjsLib;
}

const PAD = 10;
const PREVIEW_SCALE = 1.8;
const DEBOUNCE_MS = 180;

function InlinePreview({ pdfUrl, item }: { pdfUrl: string; item: Item | null }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(false);
  const pendingScrollRef = useRef<((el: HTMLDivElement) => void) | null>(null);

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
        const page = await pdf.getPage(item.destPage + 1);
        if (cancelled) return;

        const vp = page.getViewport({ scale: PREVIEW_SCALE });
        const canvas = canvasRef.current;
        if (!canvas || cancelled) return;

        const dpr = window.devicePixelRatio || 1;
        const physVP = page.getViewport({ scale: PREVIEW_SCALE * dpr });
        canvas.width = physVP.width;
        canvas.height = physVP.height;
        canvas.style.width = `${vp.width}px`;
        canvas.style.height = `${vp.height}px`;

        renderTask = page.render({ canvasContext: canvas.getContext("2d")!, viewport: physVP });
        await renderTask.promise;
        if (cancelled) return;

        // Horizontal: scroll to target x with 40px left margin,
        // clamped to maxScrollLeft so we never show empty right space.
        const targetCssX =
          item.destPdfX !== undefined ? item.destPdfX * PREVIEW_SCALE + PAD
          : item.destFracX !== undefined ? item.destFracX * vp.width + PAD
          : undefined;

        // Vertical: show 60px of context above the target line.
        let targetCssY: number | undefined;
        if (item.destPdfY !== undefined) {
          const pageH1 = page.getViewport({ scale: 1 }).height;
          targetCssY = (pageH1 - item.destPdfY) * PREVIEW_SCALE + PAD;
        } else if (item.destFracY !== undefined) {
          targetCssY = item.destFracY * vp.height + PAD;
        }

        pendingScrollRef.current = (el) => {
          if (targetCssX !== undefined) {
            const maxLeft = Math.max(0, el.scrollWidth - el.clientWidth);
            el.scrollLeft = Math.min(Math.max(0, targetCssX - 40), maxLeft);
          } else {
            el.scrollLeft = 0;
          }
          if (targetCssY !== undefined) {
            el.scrollTop = Math.max(0, targetCssY - 60);
          }
        };

        setLoading(false);
      } catch {
        if (!cancelled) setLoading(false);
      }
    }, DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      renderTask?.cancel();
    };
  }, [pdfUrl, item?.id]);

  useLayoutEffect(() => {
    if (!loading && pendingScrollRef.current && scrollRef.current) {
      pendingScrollRef.current(scrollRef.current);
      pendingScrollRef.current = null;
    }
  }, [loading]);

  return (
    <div ref={scrollRef} style={{
      overflow: "auto", height: "100%", background: "#525659", position: "relative",
    }}>
      {!item && (
        <div style={{ display: "flex", height: "100%", alignItems: "center", justifyContent: "center" }}>
          <span style={{ color: "rgba(255,255,255,0.35)", fontSize: 13, fontFamily: "ui-monospace, monospace" }}>select an item to preview</span>
        </div>
      )}
      {item && loading && (
        <div style={{ position: "absolute", inset: 0, zIndex: 2, display: "flex", alignItems: "center", justifyContent: "center", background: "#525659" }}>
          <div style={{ width: 22, height: 22, borderRadius: "50%", border: "2px solid var(--accent)", borderTopColor: "transparent", animation: "ql-spin 0.8s linear infinite" }} />
        </div>
      )}
      <div style={{ padding: PAD, display: "inline-block", minWidth: "100%", boxSizing: "border-box" }}>
        <canvas ref={canvasRef} style={{ display: "block", opacity: loading ? 0 : 1, transition: "opacity 0.15s", boxShadow: "0 2px 12px rgba(0,0,0,0.4)", borderRadius: 2 }} />
      </div>
    </div>
  );
}

export function QuickLink({ isOpen, onClose, onSelect, pdfUrl, figures, pdfLinks }: Props) {
  const [query, setQuery] = useState("");
  const [selectedIdx, setSelectedIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const allItems = useMemo((): Item[] => [
    ...figures.map((f): Item => ({
      id: f.id, label: f.id,
      detail: f.label || "(figure/table)", badge: `p.${f.page + 1}`,
      destPage: f.page, destFracX: f.bbox.x, destFracY: f.bbox.y,
    })),
    ...pdfLinks.map((l): Item => ({
      id: l.id, label: l.id,
      detail: l.label ? `${l.label} → p.${l.destPage + 1}` : `→ p.${l.destPage + 1}`,
      badge: `p.${l.destPage + 1}`,
      destPage: l.destPage, destPdfX: l.destPdfX, destPdfY: l.destPdfY,
    })),
  ], [figures, pdfLinks]);

  const items = useMemo(() => {
    if (!query) return allItems;
    const score = (id: string, label: string) => {
      const idS = fuzzyScore(id, query);
      const lblS = fuzzyScore(label, query);
      if (idS >= 0) return idS * 10 + Math.max(0, lblS);
      return lblS;
    };
    return allItems
      .map((item) => ({ item, score: score(item.id, item.label) }))
      .filter((x) => x.score >= 0)
      .sort((a, b) => b.score - a.score)
      .map((x) => x.item);
  }, [allItems, query]);

  const selectedItem = items[selectedIdx] ?? null;

  useEffect(() => {
    if (!isOpen) return;
    setQuery(""); setSelectedIdx(0);
    const t = setTimeout(() => inputRef.current?.focus(), 30);
    return () => clearTimeout(t);
  }, [isOpen]);

  useEffect(() => { setSelectedIdx(0); }, [items.length]);

  useEffect(() => {
    const el = listRef.current?.children[selectedIdx] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest" });
  }, [selectedIdx]);

  // Global Escape
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isOpen, onClose]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") { e.preventDefault(); onClose(); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); setSelectedIdx((i) => Math.min(i + 1, items.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setSelectedIdx((i) => Math.max(i - 1, 0)); }
    else if (e.key === "Enter") {
      e.preventDefault();
      if (selectedItem) { onSelect(selectedItem.id); onClose(); }
    }
  }, [items.length, selectedItem, onSelect, onClose]);

  if (!isOpen) return null;

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
        {/* Search */}
        <div style={{
          display: "flex", alignItems: "center", gap: 10,
          padding: "10px 14px", borderBottom: "1px solid var(--border)",
          background: "var(--surface-2)", flexShrink: 0,
        }}>
          <span style={{ color: "var(--accent)", fontSize: 14, fontWeight: 700 }}>f</span>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="filter figures and references…"
            autoComplete="off" spellCheck={false}
            style={{
              flex: 1, background: "transparent", border: "none", outline: "none",
              color: "var(--text)", fontSize: 13, fontFamily: "inherit",
            }}
          />
          <span style={{ color: "var(--text-muted)", fontSize: 11, whiteSpace: "nowrap" }}>
            {items.length} items · ↑↓ · Enter · Esc
          </span>
        </div>

        {/* Body */}
        <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
          {/* List */}
          <div ref={listRef} style={{
            width: "36%", borderRight: "1px solid var(--border)",
            overflowY: "auto", flexShrink: 0,
          }}>
            {items.length === 0 && (
              <div style={{ padding: "24px 12px", textAlign: "center", color: "var(--text-muted)", fontSize: 12 }}>no matches</div>
            )}
            {items.map((item, i) => (
              <div
                key={item.id}
                onClick={() => setSelectedIdx(i)}
                onDoubleClick={() => { onSelect(item.id); onClose(); }}
                style={{
                  display: "flex", alignItems: "baseline", gap: 8,
                  padding: "6px 12px", cursor: "pointer", userSelect: "none",
                  background: i === selectedIdx ? "var(--accent)" : "transparent",
                  color: i === selectedIdx ? "#fff" : "var(--text)",
                }}
              >
                <span style={{
                  fontWeight: 600, minWidth: 64, flexShrink: 0, fontSize: 12,
                  color: i === selectedIdx ? "#fff" : "var(--accent)",
                }}>
                  {item.id}
                </span>
                <span style={{
                  flex: 1, fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  color: i === selectedIdx ? "rgba(255,255,255,0.8)" : "var(--text-muted)",
                }}>
                  {item.detail}
                </span>
                <span style={{
                  fontSize: 10, flexShrink: 0,
                  color: i === selectedIdx ? "rgba(255,255,255,0.6)" : "var(--text-muted)",
                }}>
                  {item.badge}
                </span>
              </div>
            ))}
          </div>

          {/* Preview */}
          <div style={{ flex: 1, overflow: "hidden" }}>
            <InlinePreview pdfUrl={pdfUrl} item={selectedItem} />
          </div>
        </div>
      </div>
      <style>{`@keyframes ql-spin { to { transform: rotate(360deg); } }`}</style>
    </>
  );
}
