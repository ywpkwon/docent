"use client";

import { forwardRef, useCallback, useEffect, useRef, useState } from "react";
import type { FigureBBox, Highlight, HighlightColor, HighlightRect, Legend, PdfLink } from "@/lib/types";
import { highlightFill, highlightBorder } from "@/lib/highlights";
import { mergeSelectionRects } from "@/lib/rect-utils";
import { SelectionToolbar } from "./SelectionToolbar";
import { PagePreviewPopup } from "./PagePreviewPopup";

let pdfjsLib: typeof import("pdfjs-dist") | null = null;
async function getPdfjs() {
  if (!pdfjsLib) {
    pdfjsLib = await import("pdfjs-dist");
    pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;
  }
  return pdfjsLib;
}

interface PendingSelection {
  viewportX: number; viewportY: number; text: string; rects: HighlightRect[];
}
interface PageDims { cssW: number; cssH: number }
interface LinkAnnotation {
  id: string; cssLeft: number; cssTop: number; cssWidth: number; cssHeight: number;
  destPage: number; destPdfX?: number; destPdfY?: number; url?: string;
}
interface PreviewPopup {
  destPage: number; destPdfX?: number; destPdfY?: number; anchorY: number;
}
interface ZoomAnchor {
  pageNum: number;
  pageXRatio: number;
  pageYRatio: number;
  viewportX: number;
  viewportY: number;
  baseScale: number;
}
interface PageMetric {
  width: number;
  height: number;
}
interface SurfaceState {
  pageDims: PageDims | null;
  linkAnnotations: LinkAnnotation[];
}

const PAGE_GAP = 20;
const PAGE_PADDING_Y = 28;
const DEFAULT_PAGE_METRIC: PageMetric = { width: 612, height: 792 };

// ─── PageView — renders one PDF page with all overlays ────────────────────────
interface PageViewProps {
  pdf: import("pdfjs-dist").PDFDocumentProxy;
  pageNum: number;
  renderScale: number;
  displayScale: number;
  overlaysVisible: boolean;
  interactiveLayersEnabled: boolean;
  highlights: Highlight[];
  figures: FigureBBox[];
  legends: Legend[];
  onTextChange?: (text: string) => void;
  onHighlight: (text: string, rects: HighlightRect[], color: HighlightColor, page: number) => void;
  navigateTo: (page: number, saveHistory?: boolean) => void;
  onFigurePopup: (fig: FigureBBox, clientY: number) => void;
  onPreviewPopup: (popup: PreviewPopup) => void;
  onRenderComplete?: (pageNum: number) => void;
  showROI: boolean;
  onFigureChange?: (fig: FigureBBox) => void;
}

const PageView = forwardRef<HTMLDivElement, PageViewProps>(function PageView(
  { pdf, pageNum, renderScale, displayScale, overlaysVisible, interactiveLayersEnabled, highlights, figures, legends,
    onTextChange, onHighlight, navigateTo, onFigurePopup, onPreviewPopup, onRenderComplete, showROI, onFigureChange },
  ref
) {
  const canvasRefs    = useRef<Array<HTMLCanvasElement | null>>([null, null]);
  const figCanvasRefs = useRef<Array<HTMLCanvasElement | null>>([null, null]);
  const textLayerRefs = useRef<Array<HTMLDivElement | null>>([null, null]);
  const renderTaskRef = useRef<import("pdfjs-dist").RenderTask | null>(null);
  const cachedTextRef = useRef(["", ""]);
  const latestRenderRef = useRef(0);
  const activeSurfaceRef = useRef(0);

  const [activeSurface, setActiveSurface] = useState(0);
  const [surfaceStates, setSurfaceStates] = useState<SurfaceState[]>([
    { pageDims: null, linkAnnotations: [] },
    { pageDims: null, linkAnnotations: [] },
  ]);
  const [pendingSel, setPendingSel]       = useState<PendingSelection | null>(null);
  const [hoveredHl, setHoveredHl]         = useState<string | null>(null);
  const [dragOverride, setDragOverride] = useState<{ figId: string; bbox: { x: number; y: number; w: number; h: number } } | null>(null);
  const activeState = surfaceStates[activeSurface];
  const activeCanvas = canvasRefs.current[activeSurface];
  const activePageDims = activeState.pageDims;

  useEffect(() => {
    activeSurfaceRef.current = activeSurface;
  }, [activeSurface]);


  // ── Render page ─────────────────────────────────────────────────────────
  useEffect(() => {
    const targetSurface = activeSurfaceRef.current === 0 ? 1 : 0;
    const canvas = canvasRefs.current[targetSurface];
    const tl = textLayerRefs.current[targetSurface];
    if (!canvas || !tl) return;
    if (renderTaskRef.current) { renderTaskRef.current.cancel(); renderTaskRef.current = null; }

    let cancelled = false;
    const renderId = ++latestRenderRef.current;
    (async () => {
      try {
        const lib = await getPdfjs();
        const page = await pdf.getPage(pageNum + 1);
        if (cancelled) return;

        const dpr        = window.devicePixelRatio || 1;
        const logicalVP  = page.getViewport({ scale: renderScale });
        const physicalVP = page.getViewport({ scale: renderScale * dpr });
        const displayVP  = page.getViewport({ scale: displayScale });
        const cssW = displayVP.width, cssH = displayVP.height;
        const displayRatio = renderScale === 0 ? 1 : displayScale / renderScale;

        // Render to off-screen canvas — the visible canvas stays intact during rendering
        const offscreen = document.createElement("canvas");
        offscreen.width  = physicalVP.width;
        offscreen.height = physicalVP.height;
        const task = page.render({ canvasContext: offscreen.getContext("2d")!, viewport: physicalVP });
        renderTaskRef.current = task;
        try { await task.promise; }
        catch (e: unknown) {
          if (e instanceof Error && e.name === "RenderingCancelledException") return;
          throw e;
        }
        if (cancelled) return;

        // Atomic swap: resize + blit in one step — canvas never shows a blank frame
        canvas.width  = physicalVP.width;  canvas.height  = physicalVP.height;
        canvas.style.width = `${cssW}px`;  canvas.style.height = `${cssH}px`;
        (canvas.getContext("2d") as CanvasRenderingContext2D).drawImage(offscreen, 0, 0);

        let links: LinkAnnotation[] = [];

        if (!cancelled) {
          setSurfaceStates((prev) => {
            const next = [...prev];
            next[targetSurface] = { pageDims: { cssW, cssH }, linkAnnotations: [] };
            return next;
          });
          setActiveSurface(targetSurface);
          onRenderComplete?.(pageNum);
        }

        if (cancelled || renderId !== latestRenderRef.current || !interactiveLayersEnabled) return;

        // Text layer
        if (tl) {
          tl.innerHTML = "";
          tl.style.width = `${cssW}px`;
          tl.style.height = `${cssH}px`;
          tl.style.setProperty("--scale-factor", String(renderScale));
          const textContent = await page.getTextContent();
          const text = textContent.items.map((i) => ("str" in i ? i.str : "")).join(" ");
          cachedTextRef.current[targetSurface] = text;
          const textLayer = new lib.TextLayer({
            textContentSource: page.streamTextContent(), container: tl, viewport: logicalVP,
          });
          await textLayer.render();
          if (displayRatio !== 1) {
            tl.style.transform = `scale(${displayRatio})`;
            tl.style.transformOrigin = "0 0";
          } else {
            tl.style.transform = "";
          }
        }

        // Link annotations
        if (!cancelled) {
          try {
            const annotations = await page.getAnnotations();
            for (let i = 0; i < annotations.length; i++) {
              const ann = annotations[i];
              if (ann.subtype !== "Link") continue;
              const vr = logicalVP.convertToViewportRectangle(ann.rect);
              const cssLeft = Math.min(vr[0], vr[2]) * displayRatio;
              const cssTop = Math.min(vr[1], vr[3]) * displayRatio;
              const cssWidth = Math.abs(vr[2] - vr[0]) * displayRatio;
              const cssHeight = Math.abs(vr[3] - vr[1]) * displayRatio;
              if (cssWidth < 2 || cssHeight < 2) continue;

              if (ann.url) {
                links.push({ id: `lnk-${pageNum}-${i}`, cssLeft, cssTop, cssWidth, cssHeight, destPage: -1, url: ann.url });
                continue;
              }
              if (!ann.dest) continue;
              try {
                const destRaw = typeof ann.dest === "string"
                  ? await pdf.getDestination(ann.dest) : ann.dest as unknown[];
                const dest = destRaw as unknown[];
                if (!dest || dest.length === 0) continue;
                const destPage = await pdf.getPageIndex(
                  dest[0] as import("pdfjs-dist/types/src/display/api").RefProxy
                );
                const fitType = dest[1] as { name: string } | null;
                let destPdfX: number | undefined, destPdfY: number | undefined;
                if (fitType?.name === "XYZ") {
                  if (dest[2] != null) destPdfX = dest[2] as number;
                  if (dest[3] != null) destPdfY = dest[3] as number;
                } else if (fitType?.name === "FitH" || fitType?.name === "FitBH") {
                  if (dest[2] != null) destPdfY = dest[2] as number;
                } else if (fitType?.name === "FitR") {
                  if (dest[2] != null && dest[5] != null) {
                    destPdfX = ((dest[2] as number) + (dest[4] as number)) / 2;
                    destPdfY = ((dest[3] as number) + (dest[5] as number)) / 2;
                  }
                }
                links.push({ id: `lnk-${pageNum}-${i}`, cssLeft, cssTop, cssWidth, cssHeight, destPage, destPdfX, destPdfY });
              } catch { /* skip malformed */ }
            }
          } catch { /* not critical */ }
        }

        if (cancelled || renderId !== latestRenderRef.current) return;
        setSurfaceStates((prev) => {
          const next = [...prev];
          next[targetSurface] = { pageDims: { cssW, cssH }, linkAnnotations: interactiveLayersEnabled ? links : [] };
          return next;
        });
        if (onTextChange) onTextChange(cachedTextRef.current[targetSurface]);
      } catch { /* render error */ }
    })();

    return () => {
      cancelled = true;
      if (renderTaskRef.current) { renderTaskRef.current.cancel(); renderTaskRef.current = null; }
    };
  }, [displayScale, interactiveLayersEnabled, onRenderComplete, onTextChange, pageNum, pdf, renderScale]);

  // When this page becomes "current" (onTextChange appears), send cached text immediately
  useEffect(() => {
    const text = cachedTextRef.current[activeSurface];
    if (onTextChange && text) onTextChange(text);
  }, [activeSurface, onTextChange]);

  // ── Text selection → highlight ──────────────────────────────────────────
  const handleMouseUp = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest("[data-toolbar]")) return;
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) { setPendingSel(null); return; }
    const text = sel.toString().trim();
    if (!text) { setPendingSel(null); return; }
    const pageRect = activeCanvas?.getBoundingClientRect();
    if (!pageRect || !activeState.pageDims) { setPendingSel(null); return; }
    const merged = mergeSelectionRects(sel.getRangeAt(0).getClientRects(), pageRect);
    const rects: HighlightRect[] = merged.map((r) => ({
      x: (r.left - pageRect.left) / pageRect.width, y: (r.top - pageRect.top) / pageRect.height,
      w: r.width / pageRect.width, h: r.height / pageRect.height,
    })).filter((r) => r.w > 0.002 && r.h > 0.001);
    if (rects.length === 0) { setPendingSel(null); return; }
    const last = merged[merged.length - 1];
    setPendingSel({ viewportX: last.right, viewportY: last.bottom, text, rects });
  }, [activeCanvas, activeState.pageDims]);

  const handleColorPick = useCallback((color: HighlightColor) => {
    if (!pendingSel) return;
    onHighlight(pendingSel.text, pendingSel.rects, color, pageNum);
    window.getSelection()?.removeAllRanges();
    setPendingSel(null);
  }, [pendingSel, onHighlight, pageNum]);

  const dismissToolbar = useCallback(() => {
    setPendingSel(null); window.getSelection()?.removeAllRanges();
  }, []);

  function startCornerDrag(
    e: React.MouseEvent,
    fig: FigureBBox,
    bbox: { x: number; y: number; w: number; h: number },
    corner: "tl" | "tr" | "bl" | "br"
  ) {
    e.preventDefault();
    e.stopPropagation();
    let latestBbox = bbox;
    const onMove = (me: MouseEvent) => {
      const canvas = canvasRefs.current[activeSurfaceRef.current];
      const rect = canvas?.getBoundingClientRect();
      if (!rect) return;
      const fx = Math.max(0, Math.min(1, (me.clientX - rect.left) / rect.width));
      const fy = Math.max(0, Math.min(1, (me.clientY - rect.top) / rect.height));
      const { x, y, w, h } = bbox;
      const MIN = 0.01;
      let nb: typeof bbox;
      if (corner === "tl") { const nx = Math.min(fx, x + w - MIN), ny = Math.min(fy, y + h - MIN); nb = { x: nx, y: ny, w: x + w - nx, h: y + h - ny }; }
      else if (corner === "tr") { const ny = Math.min(fy, y + h - MIN); nb = { x, y: ny, w: Math.max(MIN, fx - x), h: y + h - ny }; }
      else if (corner === "bl") { const nx = Math.min(fx, x + w - MIN); nb = { x: nx, y, w: x + w - nx, h: Math.max(MIN, fy - y) }; }
      else { nb = { x, y, w: Math.max(MIN, fx - x), h: Math.max(MIN, fy - y) }; }
      latestBbox = nb;
      setDragOverride({ figId: fig.id, bbox: nb });
    };
    const onUp = () => {
      onFigureChange?.({ ...fig, bbox: latestBbox });
      setDragOverride(null);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  return (
    <div ref={ref} data-page={pageNum} style={{ width: "100%", height: "100%" }}>
      <div
        className="pdf-page-wrapper shadow-2xl"
        style={{ position: "relative", width: "100%", height: "100%", borderRadius: 4, userSelect: "text", overflow: "hidden" }}
        onMouseUp={handleMouseUp}
      >
        {[0, 1].map((surfaceIndex) => (
          <div
            key={surfaceIndex}
            style={{
              position: "absolute",
              inset: 0,
              visibility: surfaceIndex === activeSurface ? "visible" : "hidden",
              pointerEvents: surfaceIndex === activeSurface ? "auto" : "none",
            }}
          >
            <canvas
              ref={(el) => { canvasRefs.current[surfaceIndex] = el; }}
              style={{ display: "block" }}
            />
            <div
              ref={(el) => { textLayerRefs.current[surfaceIndex] = el; }}
              className="textLayer"
              style={{ zIndex: 5, visibility: overlaysVisible ? "visible" : "hidden" }}
            />
            <canvas
              ref={(el) => { figCanvasRefs.current[surfaceIndex] = el; }}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                pointerEvents: "none",
                zIndex: 6,
                visibility: "hidden",
              }}
            />
          </div>
        ))}

        {activePageDims && overlaysVisible && highlights.map((hl) =>
          hl.rects ? hl.rects.map((rect, i) => (
            <HighlightDiv key={`${hl.id}-${i}`} rect={rect} legends={legends} color={hl.color}
              dims={activePageDims} hovered={hoveredHl === hl.id} zIndex={10 + i}
              onHover={(on) => setHoveredHl(on ? hl.id : null)} />
          )) : (
            <div key={hl.id} style={{
              position: "absolute", left: 0, top: 0, width: 4, height: activePageDims.cssH,
              background: highlightFill(legends, hl.color),
              borderRight: `2px solid ${highlightBorder(legends, hl.color)}`,
              pointerEvents: "none", zIndex: 10,
            }} />
          )
        )}

        {activePageDims && overlaysVisible && figures.map((fig) => {
          const bbox = dragOverride?.figId === fig.id ? dragOverride.bbox : fig.bbox;
          const left = bbox.x * activePageDims.cssW;
          const top = bbox.y * activePageDims.cssH;
          const width = bbox.w * activePageDims.cssW;
          const height = bbox.h * activePageDims.cssH;
          if (showROI) {
            return (
              <div key={fig.id} style={{
                position: "absolute", left, top, width, height, zIndex: 11,
                border: "1.5px dashed rgba(99,102,241,0.7)", boxSizing: "border-box",
                pointerEvents: "none",
              }}>
                <div style={{
                  position: "absolute", top: 0, left: 0, background: "rgba(99,102,241,0.9)",
                  color: "white", fontSize: 10, fontWeight: "bold", padding: "1px 5px",
                  lineHeight: "16px", userSelect: "none", pointerEvents: "none",
                }}>
                  {fig.id.toUpperCase()}
                </div>
                {(["tl", "tr", "bl", "br"] as const).map((corner) => (
                  <div key={corner} style={{
                    position: "absolute",
                    ...(corner === "tl" ? { left: -4, top: -4 }
                      : corner === "tr" ? { right: -4, top: -4 }
                      : corner === "bl" ? { left: -4, bottom: -4 }
                      : { right: -4, bottom: -4 }),
                    width: 8, height: 8,
                    background: "white", border: "1.5px solid rgba(99,102,241,0.9)",
                    borderRadius: 1, cursor: corner === "tl" || corner === "br" ? "nwse-resize" : "nesw-resize",
                    pointerEvents: "auto",
                  }}
                  onMouseDown={(e) => startCornerDrag(e, fig, bbox, corner)}
                  />
                ))}
              </div>
            );
          }
          return (
            <div key={fig.id}
              title={`${fig.id}${fig.label ? ` — ${fig.label}` : ""}\nClick: navigate · Shift+click: popup`}
              style={{ position: "absolute", left, top, width, height, cursor: "pointer", zIndex: 11 }}
              onMouseDown={(e) => { if (e.shiftKey) e.preventDefault(); }}
              onClick={(e) => {
                e.stopPropagation();
                if (e.shiftKey) { onFigurePopup(fig, e.clientY); } else { navigateTo(fig.page, true); }
              }}
            />
          );
        })}

        {overlaysVisible && activeState.linkAnnotations.map((link) => (
          <div key={link.id}
            title={link.url ? link.url : "Click: navigate · Shift+click: preview"}
            style={{
              position: "absolute", left: link.cssLeft, top: link.cssTop,
              width: link.cssWidth, height: link.cssHeight,
              cursor: "pointer", zIndex: 12, borderRadius: 2, transition: "background 0.1s",
            }}
            onMouseDown={(e) => { if (e.shiftKey) e.preventDefault(); }}
            onClick={(e) => {
              e.stopPropagation();
              if (link.url) { window.open(link.url, "_blank", "noopener"); return; }
              if (e.shiftKey) {
                onPreviewPopup({ destPage: link.destPage, destPdfX: link.destPdfX, destPdfY: link.destPdfY, anchorY: e.clientY });
              } else { navigateTo(link.destPage, true); }
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLDivElement).style.background = "rgba(59,130,246,0.15)";
              (e.currentTarget as HTMLDivElement).style.borderBottom = "1px solid rgba(59,130,246,0.55)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLDivElement).style.background = "transparent";
              (e.currentTarget as HTMLDivElement).style.borderBottom = "none";
            }}
          />
        ))}
      </div>

      {pendingSel && (
        <SelectionToolbar x={pendingSel.viewportX} y={pendingSel.viewportY}
          legends={legends} onPick={handleColorPick} onDismiss={dismissToolbar} />
      )}
    </div>
  );
});

// ─── Link extraction helpers ──────────────────────────────────────────────────
type TextItem = { str: string; transform: number[]; width: number; height: number };

/** Find a [N] reference label near destPdfY on the destination page.
 *  Looks at text items on the DESTINATION page rather than the source annotation,
 *  which is more reliable for LaTeX-compiled PDFs where annotation rects may not
 *  align precisely with the text layer. */
function getDestLabel(
  destPdfY: number | undefined,
  textItems: TextItem[],
  destPdfX?: number,
  pageWidth?: number,
): string {
  if (destPdfY == null || textItems.length === 0) return "";
  let nearby = textItems.filter((it) => {
    const y = it.transform[5];
    return y <= destPdfY + 8 && y >= destPdfY - 40;
  });
  // If column is known (XYZ destination), restrict to the same column's text so
  // a left-column [5] label doesn't shadow a right-column [15] at the same Y.
  if (destPdfX !== undefined && pageWidth !== undefined) {
    const midX = pageWidth / 2;
    const isRight = destPdfX >= midX;
    nearby = nearby.filter((it) => (isRight ? it.transform[4] >= midX : it.transform[4] < midX));
  }
  nearby.sort((a, b) => a.transform[4] - b.transform[4]); // left → right
  const combined = nearby.map((it) => it.str).join("");
  const match = combined.match(/\[(\d+)\]/);
  return match ? match[0] : ""; // return "[10]" — labelToLinkId converts to "ref10"
}

/** Convert annotation label text to a stable command ID.
 *  Only produces an ID for numeric citation labels like [13] or [13,14].
 *  Everything else (DOI links, titles, section headings) returns "" → skipped. */
function labelToLinkId(label: string): string {
  // Skip figure/table labels — handled by ROI figures
  const lower = label.toLowerCase().replace(/[\s.]/g, "");
  if (/^(fig(ure)?|table|tab)\d/.test(lower)) return "";
  // Strip brackets/parens/spaces, then require a leading number
  const stripped = label.replace(/[\[\]\(\)\s]/g, "");
  const num = stripped.match(/^(\d+)/);
  return num ? `ref${num[1]}` : "";
}

// ─── PDFViewer — orchestrates the page window and scroll ─────────────────────
interface Props {
  pdfUrl: string;
  currentPage: number;
  pageCount: number;
  highlights: Highlight[];
  figures: FigureBBox[];
  legends: Legend[];
  onPageChange: (page: number) => void;
  onFigurePopup: (fig: FigureBBox, clientY: number) => void;
  onHighlight: (text: string, rects: HighlightRect[], color: HighlightColor, page: number) => void;
  onCurrentTextChange: (text: string) => void;
  onFiguresChange: (figs: FigureBBox[]) => void;
  onScaleChange?: (scale: number) => void;
  onLinksReady?: (links: PdfLink[]) => void;
}

export function PDFViewer({
  pdfUrl, currentPage, pageCount, highlights, figures, legends,
  onPageChange, onFigurePopup, onHighlight, onCurrentTextChange, onFiguresChange, onScaleChange, onLinksReady,
}: Props) {
  const scrollContainerRef  = useRef<HTMLDivElement>(null);
  const snapshotHostRef     = useRef<HTMLDivElement>(null);
  const snapshotContentRef  = useRef<HTMLDivElement | null>(null);
  const pageRefsMap         = useRef<Map<number, HTMLDivElement>>(new Map());
  const pdfRef              = useRef<import("pdfjs-dist").PDFDocumentProxy | null>(null);

  const historyRef           = useRef<number[]>([]);
  const currentPageRef       = useRef(currentPage);
  const pageCountRef         = useRef(pageCount);
  const onPageChangeRef      = useRef(onPageChange);
  const programmaticRef      = useRef(false); // true while we're doing a programmatic scroll
  const scrollDrivenPageChangeRef = useRef(false);
  const pageLayoutsRef       = useRef<Array<{ pageNum: number; width: number; height: number; top: number; bottom: number }>>([]);
  const effectiveRenderedPagesRef = useRef<Set<number>>(new Set());

  const onLinksReadyRef = useRef(onLinksReady);
  useEffect(() => { onLinksReadyRef.current = onLinksReady; }, [onLinksReady]);

  useEffect(() => { currentPageRef.current = currentPage; }, [currentPage]);
  useEffect(() => { pageCountRef.current = pageCount; }, [pageCount]);
  useEffect(() => { onPageChangeRef.current = onPageChange; }, [onPageChange]);

  const [loading, setLoading] = useState(true);
  const [showROI, setShowROI] = useState(false);
  const [scale, setScale]     = useState(1.5);
  const [layoutScale, setLayoutScale] = useState(1.5);
  const [displayedScale, setDisplayedScale] = useState(1.5);
  const [overlaysVisible, setOverlaysVisible] = useState(true);
  const [interactiveLayersEnabled, setInteractiveLayersEnabled] = useState(true);
  const [snapshotVisible, setSnapshotVisible] = useState(false);
  const [previewPopup, setPreviewPopup] = useState<PreviewPopup | null>(null);
  const [pageMetrics, setPageMetrics] = useState<PageMetric[]>([]);
  const [viewportState, setViewportState] = useState({ top: 0, height: 0 });

  // ── Smooth zoom: CSS transform during gesture, deferred PDF.js re-render ──
  const pagesWrapperRef      = useRef<HTMLDivElement>(null);
  const renderScaleRef       = useRef(1.5); // mirrors `scale` state — readable from stable closures
  const visualScaleRef       = useRef(1.5); // current user-facing scale (may differ during gesture)
  const gestureActiveRef     = useRef(false);
  const zoomAnchorRef        = useRef<ZoomAnchor | null>(null);
  const gestureTimerRef      = useRef<ReturnType<typeof setTimeout> | null>(null);
  const interactiveLayersTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const snapshotScrollRef    = useRef({ left: 0, top: 0 });
  const pendingCorrectionRef = useRef<ZoomAnchor | null>(null);
  const pendingRenderPagesRef = useRef<Set<number> | null>(null);
  const zoomCommitActiveRef  = useRef(false);
  const deferredLayoutPromotionRef = useRef(false);
  const [frozenRenderedPages, setFrozenRenderedPages] = useState<Set<number> | null>(null);

  useEffect(() => { renderScaleRef.current = scale; }, [scale]);
  useEffect(() => { onScaleChange?.(scale); }, [scale, onScaleChange]);

  const commitScale = useCallback((nextScale: number) => {
    renderScaleRef.current = nextScale;
    visualScaleRef.current = nextScale;
    setScale(nextScale);
    setDisplayedScale(nextScale);
  }, []);

  const showSnapshotOverlay = useCallback(() => {
    const host = snapshotHostRef.current;
    const wrapper = pagesWrapperRef.current;
    const sc = scrollContainerRef.current;
    if (!host || !wrapper || !sc) return;

    const clone = wrapper.cloneNode(true) as HTMLDivElement;
    clone.style.pointerEvents = "none";
    clone.style.margin = "0";
    snapshotScrollRef.current = { left: sc.scrollLeft, top: sc.scrollTop };
    clone.style.transform = `translate(${-sc.scrollLeft}px, ${-sc.scrollTop}px)`;
    clone.style.transformOrigin = "0 0";

    const sourceCanvases = wrapper.querySelectorAll("canvas");
    const clonedCanvases = clone.querySelectorAll("canvas");
    sourceCanvases.forEach((sourceCanvas, index) => {
      const clonedCanvas = clonedCanvases[index];
      if (!clonedCanvas) return;
      clonedCanvas.width = sourceCanvas.width;
      clonedCanvas.height = sourceCanvas.height;
      clonedCanvas.style.width = sourceCanvas.style.width;
      clonedCanvas.style.height = sourceCanvas.style.height;
      const ctx = clonedCanvas.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(sourceCanvas, 0, 0);
    });

    host.innerHTML = "";
    host.appendChild(clone);
    snapshotContentRef.current = clone;
    setSnapshotVisible(true);
  }, []);

  const hideSnapshotOverlay = useCallback(() => {
    const host = snapshotHostRef.current;
    if (host) host.innerHTML = "";
    snapshotContentRef.current = null;
    setSnapshotVisible(false);
  }, []);

  const updateSnapshotTransform = useCallback((scaleRatio: number, originX: number, originY: number) => {
    const snapshot = snapshotContentRef.current;
    const { left, top } = snapshotScrollRef.current;
    if (!snapshot) return;
    snapshot.style.transformOrigin = `${originX}px ${originY}px`;
    snapshot.style.transform = `translate(${-left}px, ${-top}px) scale(${scaleRatio})`;
  }, []);

  const createZoomAnchor = useCallback((viewportX: number, viewportY: number): ZoomAnchor | null => {
    const sc = scrollContainerRef.current;
    if (!sc) return null;
    const scRect = sc.getBoundingClientRect();
    const pointerX = scRect.left + viewportX;
    const pointerY = scRect.top + viewportY;
    let targetPageNum = currentPageRef.current;
    let targetPageEl = pageRefsMap.current.get(targetPageNum) ?? null;

    pageRefsMap.current.forEach((candidate, pageNum) => {
      const rect = candidate.getBoundingClientRect();
      if (
        pointerX >= rect.left &&
        pointerX <= rect.right &&
        pointerY >= rect.top &&
        pointerY <= rect.bottom
      ) {
        targetPageNum = pageNum;
        targetPageEl = candidate;
      }
    });

    if (!targetPageEl) return null;
    const pageRect = targetPageEl.getBoundingClientRect();
    const localX = Math.max(0, Math.min(pageRect.width, pointerX - pageRect.left));
    const localY = Math.max(0, Math.min(pageRect.height, pointerY - pageRect.top));
    const pageWidth = targetPageEl.offsetWidth;

    return {
      pageNum: targetPageNum,
      pageXRatio: pageRect.width > 0 ? localX / pageRect.width : 0.5,
      pageYRatio: pageRect.height > 0 ? localY / pageRect.height : 0.5,
      viewportX,
      viewportY,
      baseScale: renderScaleRef.current,
    };
  }, []);

  const applyPendingScrollCorrection = useCallback((sc: HTMLDivElement, pending: ZoomAnchor) => {
    const layout = pageLayoutsRef.current.find((entry) => entry.pageNum === pending.pageNum);
    if (!layout) return;
    const pageEl = pageRefsMap.current.get(pending.pageNum);
    const slotLeft = pageEl?.offsetLeft ?? 0;
    const pageWidth = pageEl?.offsetWidth ?? layout.width;
    const localX = pending.pageXRatio * pageWidth;
    const localY = pending.pageYRatio * layout.height;
    const nextScrollTop = layout.top + localY - pending.viewportY;
    const shouldCenterHorizontally = pageWidth <= sc.clientWidth;
    const unclampedScrollLeft = shouldCenterHorizontally
      ? Math.max(0, slotLeft + pageWidth / 2 - sc.clientWidth / 2)
      : Math.max(0, slotLeft + localX - pending.viewportX);
    const minScrollLeft = shouldCenterHorizontally ? 0 : Math.max(0, slotLeft);
    const maxScrollLeft = shouldCenterHorizontally
      ? Math.max(0, sc.scrollWidth - sc.clientWidth)
      : Math.max(minScrollLeft, slotLeft + pageWidth - sc.clientWidth);
    const nextScrollLeft = Math.min(maxScrollLeft, Math.max(minScrollLeft, unclampedScrollLeft));

    sc.scrollLeft = Math.max(0, nextScrollLeft);
    sc.scrollTop = Math.max(0, nextScrollTop);
  }, []);

  const beginZoomSession = useCallback((viewportX: number, viewportY: number) => {
    const el = scrollContainerRef.current;
    if (!el) return null;
    const anchor = createZoomAnchor(viewportX, viewportY);
    if (!anchor) return null;
    const pageEl = pageRefsMap.current.get(anchor.pageNum);
    if (!pageEl) return null;

    showSnapshotOverlay();
    gestureActiveRef.current = true;
    zoomAnchorRef.current = anchor;
    if (interactiveLayersTimerRef.current) clearTimeout(interactiveLayersTimerRef.current);
    setInteractiveLayersEnabled(false);
    setOverlaysVisible(false);

    const shouldCenterHorizontally = pageEl.offsetWidth <= el.clientWidth;
    const originX = shouldCenterHorizontally
      ? pageEl.offsetLeft + pageEl.offsetWidth / 2
      : pageEl.offsetLeft + anchor.pageXRatio * pageEl.offsetWidth;
    const originY = pageEl.offsetTop + anchor.pageYRatio * pageEl.offsetHeight;
    updateSnapshotTransform(1, originX, originY);
    return { anchor, originX, originY };
  }, [createZoomAnchor, showSnapshotOverlay, updateSnapshotTransform]);

  const updateZoomSession = useCallback((nextVisual: number) => {
    const el = scrollContainerRef.current;
    const anchor = zoomAnchorRef.current;
    if (!el || !anchor) return;
    const pageEl = pageRefsMap.current.get(anchor.pageNum);
    if (!pageEl) return;

    const clamped = Math.max(0.5, Math.min(3.0, nextVisual));
    visualScaleRef.current = clamped;
    setDisplayedScale(clamped);

    const shouldCenterHorizontally = pageEl.offsetWidth <= el.clientWidth;
    const originX = shouldCenterHorizontally
      ? pageEl.offsetLeft + pageEl.offsetWidth / 2
      : pageEl.offsetLeft + anchor.pageXRatio * pageEl.offsetWidth;
    const originY = pageEl.offsetTop + anchor.pageYRatio * pageEl.offsetHeight;
    updateSnapshotTransform(clamped / anchor.baseScale, originX, originY);
  }, [updateSnapshotTransform]);

  const commitZoomSession = useCallback(() => {
    gestureActiveRef.current = false;
    const target = Math.max(0.5, Math.min(3.0, visualScaleRef.current));
    pendingCorrectionRef.current = zoomAnchorRef.current;
    pendingRenderPagesRef.current = new Set(effectiveRenderedPagesRef.current);
    zoomCommitActiveRef.current = true;
    setFrozenRenderedPages(new Set(effectiveRenderedPagesRef.current));
    deferredLayoutPromotionRef.current = true;
    showSnapshotOverlay();
    if (Math.abs(target - renderScaleRef.current) < 0.001) {
      pendingCorrectionRef.current = null;
      pendingRenderPagesRef.current = null;
      zoomAnchorRef.current = null;
      zoomCommitActiveRef.current = false;
      setFrozenRenderedPages(null);
      deferredLayoutPromotionRef.current = false;
      visualScaleRef.current = renderScaleRef.current;
      setDisplayedScale(renderScaleRef.current);
      setOverlaysVisible(true);
      hideSnapshotOverlay();
      if (interactiveLayersTimerRef.current) clearTimeout(interactiveLayersTimerRef.current);
      interactiveLayersTimerRef.current = setTimeout(() => setInteractiveLayersEnabled(true), 60);
      return;
    }
    commitScale(target);
  }, [commitScale, hideSnapshotOverlay, showSnapshotOverlay]);

  const onPageRenderComplete = useCallback((pageNum: number) => {
    if (gestureActiveRef.current) return; // gesture still running — don't interfere
    const pending = pendingCorrectionRef.current;
    if (!pending) return;
    const waitingOn = pendingRenderPagesRef.current;
    if (waitingOn) {
      waitingOn.delete(pageNum);
      if (waitingOn.size > 0) return;
      pendingRenderPagesRef.current = null;
    } else if (pageNum !== currentPageRef.current) {
      return;
    }
    pendingCorrectionRef.current = null;
    const wrapper = pagesWrapperRef.current;
    const sc      = scrollContainerRef.current;
    if (!sc) return;
    const nextScale = renderScaleRef.current;
    const finalize = () => {
      visualScaleRef.current = nextScale; // re-sync after re-render
      setDisplayedScale(nextScale);
      zoomAnchorRef.current = null;
      applyPendingScrollCorrection(sc, pending);
      setOverlaysVisible(true);
      zoomCommitActiveRef.current = false;
      setFrozenRenderedPages(null);
      deferredLayoutPromotionRef.current = false;
      hideSnapshotOverlay();
      if (interactiveLayersTimerRef.current) clearTimeout(interactiveLayersTimerRef.current);
      interactiveLayersTimerRef.current = setTimeout(() => setInteractiveLayersEnabled(true), 60);
    };
    if (deferredLayoutPromotionRef.current) {
      setLayoutScale(nextScale);
      requestAnimationFrame(() => {
        requestAnimationFrame(finalize);
      });
      return;
    }
    finalize();
  }, [applyPendingScrollCorrection]);

  // +/- buttons: immediate setScale, scroll correction via onRenderComplete
  const applyZoom = useCallback((updater: (prev: number) => number) => {
    const el = scrollContainerRef.current;
    if (!el) { setScale(updater); return; }
    const viewportX = el.clientWidth / 2;
    const viewportY = el.clientHeight / 2;
    const anchor = createZoomAnchor(viewportX, viewportY);
    showSnapshotOverlay();
    if (interactiveLayersTimerRef.current) clearTimeout(interactiveLayersTimerRef.current);
    setInteractiveLayersEnabled(false);
    setScale((prev) => {
      const next = updater(prev);
      if (next === prev) return prev;
      renderScaleRef.current = next;
      visualScaleRef.current = next;
      setDisplayedScale(next);
      setLayoutScale(next);
      pendingCorrectionRef.current = anchor;
      deferredLayoutPromotionRef.current = false;
      return next;
    });
  }, [createZoomAnchor, showSnapshotOverlay]);

  const navigateTo = useCallback((page: number, saveHistory = false) => {
    if (saveHistory) historyRef.current.push(currentPageRef.current);
    onPageChangeRef.current(page);
  }, []);

  // Load PDF
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const lib = await getPdfjs();
      const pdf = await lib.getDocument(pdfUrl).promise;
      if (cancelled) return;
      pdfRef.current = pdf;

      // Fetch metrics + annotations + text content per page in one parallel pass
      const allPageData = await Promise.all(
        Array.from({ length: pdf.numPages }, async (_, index) => {
          const page = await pdf.getPage(index + 1);
          const viewport = page.getViewport({ scale: 1 });
          const metric = { width: viewport.width, height: viewport.height };
          try {
            const [annotations, textContent] = await Promise.all([
              page.getAnnotations(),
              page.getTextContent(),
            ]);
            const textItems: TextItem[] = textContent.items
              .filter((it) => "str" in it)
              .map((it) => {
                const i = it as { str: string; transform: number[]; width: number; height: number };
                return { str: i.str, transform: i.transform, width: i.width, height: i.height };
              });
            return { metric, annotations, textItems };
          } catch {
            return { metric, annotations: [], textItems: [] as TextItem[] };
          }
        })
      );

      if (!cancelled) {
        setPageMetrics(allPageData.map((d) => d.metric));
        setLoading(false);
      }

      // Preextract unique link destinations with human-readable IDs derived from annotation text
      if (!cancelled && onLinksReadyRef.current) {
        // destMap key = "destPage:yBucket" → unique destination
        const destMap = new Map<string, { destPage: number; destPdfX?: number; destPdfY?: number; label: string }>();
        const namedDestCache = new Map<string, unknown[]>();

        for (const { annotations, textItems } of allPageData) {
          if (cancelled) break;
          for (const ann of annotations) {
            if (ann.subtype !== "Link" || !ann.dest) continue;
            if (cancelled) break;
            try {
              let destArr: unknown[];
              if (typeof ann.dest === "string") {
                if (!namedDestCache.has(ann.dest)) {
                  const resolved = await pdf.getDestination(ann.dest);
                  if (!resolved) continue;
                  namedDestCache.set(ann.dest, resolved as unknown[]);
                }
                destArr = namedDestCache.get(ann.dest)!;
              } else {
                destArr = ann.dest as unknown[];
              }
              if (!destArr || destArr.length === 0) continue;
              const destPage = await pdf.getPageIndex(
                destArr[0] as import("pdfjs-dist/types/src/display/api").RefProxy
              );
              const fitType = destArr[1] as { name: string } | null;
              let destPdfX: number | undefined, destPdfY: number | undefined;
              if (fitType?.name === "XYZ") {
                if (destArr[2] != null) destPdfX = destArr[2] as number;
                if (destArr[3] != null) destPdfY = destArr[3] as number;
              } else if (fitType?.name === "FitH" || fitType?.name === "FitBH") {
                if (destArr[2] != null) destPdfY = destArr[2] as number;
              } else if (fitType?.name === "FitR") {
                if (destArr[2] != null && destArr[4] != null) {
                  destPdfX = ((destArr[2] as number) + (destArr[4] as number)) / 2;
                  destPdfY = ((destArr[3] as number) + (destArr[5] as number)) / 2;
                }
              }
              const pageW = allPageData[destPage]?.metric.width ?? 612;
              const colTag = destPdfX !== undefined ? (destPdfX < pageW / 2 ? "L" : "R") : "C";
              const yBucket = destPdfY != null ? Math.round(destPdfY) : -1; // 1pt bucket — never merges adjacent refs
              const key = `${destPage}:${colTag}:${yBucket}`;
              if (!destMap.has(key)) {
                const destTextItems = allPageData[destPage]?.textItems ?? [];
                const label = getDestLabel(destPdfY, destTextItems, destPdfX, pageW);
                destMap.set(key, { destPage, destPdfX, destPdfY, label });
              }
            } catch { /* skip malformed */ }
          }
        }

        if (!cancelled) {
          // Identify "reference pages": pages that receive many distinct citation links.
          // Body/figure pages receive ≤ a handful; bibliography pages receive dozens.
          const destPageCounts = new Map<number, number>();
          for (const { destPage } of Array.from(destMap.values()))
            destPageCounts.set(destPage, (destPageCounts.get(destPage) ?? 0) + 1);
          const maxCount = Math.max(0, ...Array.from(destPageCounts.values()));
          const refPages = new Set(
            Array.from(destPageCounts.entries())
              .filter(([, c]) => c >= 5 && c >= maxCount * 0.25)
              .map(([p]) => p)
          );

          // Deduplicate by (destPage, label): same [8] via different fit types → one entry.
          // Keep the first occurrence (earliest page processed).
          const labelDedup = new Map<string, typeof destMap extends Map<string, infer V> ? V : never>();
          for (const entry of Array.from(destMap.values())) {
            if (!refPages.has(entry.destPage)) continue;
            const labelId = labelToLinkId(entry.label);
            const dedupKey = labelId ? `${entry.destPage}:${labelId}` : `${entry.destPage}:${Math.round(entry.destPdfY ?? 0)}`;
            if (!labelDedup.has(dedupKey)) labelDedup.set(dedupKey, entry);
          }

          const usedIds = new Set<string>();
          const SUFFIX = "abcdefghijklmnopqrstuvwxyz";
          const links: PdfLink[] = [];
          for (const { destPage, destPdfX, destPdfY, label } of Array.from(labelDedup.values())) {
            let baseId = labelToLinkId(label) || `p${destPage + 1}`;
            let id = baseId, si = 0;
            while (usedIds.has(id)) {
              id = `${baseId}${si < SUFFIX.length ? SUFFIX[si] : si}`;
              si++;
            }
            usedIds.add(id);
            links.push({ id, label, destPage, destPdfX, destPdfY });
          }

          // Debug
          console.log(
            `[PaperPal] ${links.length} citation links on ref pages:`,
            Array.from(refPages).sort((a, b) => a - b).map(p => `p.${p + 1}`).join(', ')
          );
          console.log('[PaperPal] links:', links.map(l => `${l.id}(${l.label})→p.${l.destPage + 1}`).join('  '));

          onLinksReadyRef.current(links);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [pdfUrl]);

  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;

    const updateViewport = () => {
      setViewportState((prev) => {
        const next = { top: el.scrollTop, height: el.clientHeight };
        return prev.top === next.top && prev.height === next.height ? prev : next;
      });
    };

    updateViewport();
    const resizeObserver = new ResizeObserver(updateViewport);
    resizeObserver.observe(el);
    return () => { resizeObserver.disconnect(); };
  }, []);

  const overscanPx = Math.max(viewportState.height * 1.5, 1200);
  const rangeTop = Math.max(0, viewportState.top - overscanPx);
  const rangeBottom = viewportState.top + viewportState.height + overscanPx;

  const pageLayouts: Array<{ pageNum: number; width: number; height: number; top: number; bottom: number }> = [];
  let cursorY = PAGE_PADDING_Y;
  for (let pageNum = 0; pageNum < pageCount; pageNum++) {
    const metric = pageMetrics[pageNum] ?? pageMetrics[0] ?? DEFAULT_PAGE_METRIC;
    const width = metric.width * layoutScale;
    const height = metric.height * layoutScale;
    pageLayouts.push({ pageNum, width, height, top: cursorY, bottom: cursorY + height });
    cursorY += height + PAGE_GAP;
  }
  const renderedPages = new Set(
    pageLayouts
      .filter((layout) => layout.bottom >= rangeTop && layout.top <= rangeBottom)
      .map((layout) => layout.pageNum)
  );
  const effectiveRenderedPages = frozenRenderedPages ?? renderedPages;
  effectiveRenderedPagesRef.current = effectiveRenderedPages;
  pageLayoutsRef.current = pageLayouts;

  // ── Scroll to currentPage when it changes via external navigation ────────
  const prevCurrentPage = useRef(currentPage);
  useEffect(() => {
    if (prevCurrentPage.current === currentPage) return;
    prevCurrentPage.current = currentPage;
    if (scrollDrivenPageChangeRef.current) {
      scrollDrivenPageChangeRef.current = false;
      return;
    }
    requestAnimationFrame(() => {
      const pageEl = pageRefsMap.current.get(currentPage);
      if (!pageEl || !scrollContainerRef.current) return;
      programmaticRef.current = true;
      pageEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
      setTimeout(() => { programmaticRef.current = false; }, 900);
    });
  }, [currentPage]);

  // ── Scroll detection: update currentPage based on viewport overlap ────────
  useEffect(() => {
    const scrollEl = scrollContainerRef.current;
    if (!scrollEl) return;
    let rafId = 0;
    const handler = () => {
      if (programmaticRef.current || gestureActiveRef.current || zoomCommitActiveRef.current) return;
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        const viewTop    = scrollEl.scrollTop;
        const viewBottom = viewTop + scrollEl.clientHeight;
        let maxOverlap = 0, bestPage = currentPageRef.current;
        setViewportState((prev) => (
          prev.top === viewTop && prev.height === scrollEl.clientHeight
            ? prev
            : { top: viewTop, height: scrollEl.clientHeight }
        ));
        for (const layout of pageLayoutsRef.current) {
          const overlap = Math.max(0, Math.min(viewBottom, layout.bottom) - Math.max(viewTop, layout.top));
          if (overlap > maxOverlap) { maxOverlap = overlap; bestPage = layout.pageNum; }
        }
        if (bestPage !== currentPageRef.current) {
          scrollDrivenPageChangeRef.current = true;
          onPageChangeRef.current(bestPage);
        }
      });
    };
    scrollEl.addEventListener("scroll", handler, { passive: true });
    return () => { scrollEl.removeEventListener("scroll", handler); cancelAnimationFrame(rafId); };
  }, []); // stable — uses refs only

  // ── Wheel: CSS transform for instant visual feedback, debounced re-render ─
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      const scRect = el.getBoundingClientRect();
      const viewportX = e.clientX - scRect.left;
      const viewportY = e.clientY - scRect.top;

      const factor    = Math.exp(-e.deltaY / 200);
      const newVisual = Math.max(0.5, Math.min(3.0, visualScaleRef.current * factor));

      // Lock transform-origin to the actual gesture focal point at gesture start.
      if (!gestureActiveRef.current) {
        if (!beginZoomSession(viewportX, viewportY)) return;
      }

      updateZoomSession(newVisual);

      // Debounce actual re-render until gesture settles
      if (gestureTimerRef.current) clearTimeout(gestureTimerRef.current);
      gestureTimerRef.current = setTimeout(() => {
        commitZoomSession();
      }, 400);
    };
    el.addEventListener("wheel", handler, { passive: false });
    return () => {
      el.removeEventListener("wheel", handler);
      if (gestureTimerRef.current) clearTimeout(gestureTimerRef.current);
      if (interactiveLayersTimerRef.current) clearTimeout(interactiveLayersTimerRef.current);
      gestureActiveRef.current = false;
      pendingCorrectionRef.current = null;
      pendingRenderPagesRef.current = null;
      zoomAnchorRef.current = null;
      zoomCommitActiveRef.current = false;
      setFrozenRenderedPages(null);
      deferredLayoutPromotionRef.current = false;
      setOverlaysVisible(true);
      hideSnapshotOverlay();
      if (interactiveLayersTimerRef.current) clearTimeout(interactiveLayersTimerRef.current);
      setInteractiveLayersEnabled(true);
    };
  }, [beginZoomSession, commitZoomSession, updateZoomSession]); // stable via refs + snapshot helpers

  useEffect(() => {
    return () => {
      if (interactiveLayersTimerRef.current) clearTimeout(interactiveLayersTimerRef.current);
    };
  }, []);

  // ── Keyboard ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Backspace") {
        if ((e.target as HTMLElement).closest("input, textarea, [contenteditable]")) return;
        const prev = historyRef.current.pop();
        if (prev !== undefined) { e.preventDefault(); onPageChangeRef.current(prev); }
        return;
      }
      if (e.key === "d" && !e.metaKey && !e.ctrlKey) {
        if ((e.target as HTMLElement).closest("input, textarea, [contenteditable]")) return;
        e.preventDefault();
        setShowROI((v) => !v);
        return;
      }
      if ((e.metaKey || e.ctrlKey) && (e.key === "=" || e.key === "+")) {
        e.preventDefault();
        applyZoom((s) => Math.min(3, s + 0.25));
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "-") {
        e.preventDefault();
        applyZoom((s) => Math.max(0.5, s - 0.25));
        return;
      }
      if ((e.target as HTMLElement).closest("input, textarea, [contenteditable]")) return;
      if (e.key === "ArrowRight" || e.key === "ArrowDown") onPageChange(Math.min(pageCount - 1, currentPage + 1));
      if (e.key === "ArrowLeft"  || e.key === "ArrowUp")   onPageChange(Math.max(0, currentPage - 1));
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [applyZoom, currentPage, pageCount, onPageChange, setShowROI]);

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Full-height scroll area — toolbar removed; use keyboard shortcuts (? for help) */}
      <div className="relative flex-1 min-h-0">
      <div ref={scrollContainerRef}
        className="h-full overflow-auto"
        style={{ background: "var(--bg)" }}
      >
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <div className="w-8 h-8 rounded-full border-2 animate-spin"
              style={{ borderColor: "var(--accent)", borderTopColor: "transparent" }} />
          </div>
        ) : (
          <div ref={pagesWrapperRef} style={{
            display: "flex", flexDirection: "column", alignItems: "center",
            gap: PAGE_GAP, padding: `${PAGE_PADDING_Y}px 0`, minWidth: "max-content",
          }}>
            {pdfRef.current && pageLayouts.map(({ pageNum, width, height }) => (
              <div
                key={pageNum}
                ref={(el) => {
                  if (el) pageRefsMap.current.set(pageNum, el);
                  else pageRefsMap.current.delete(pageNum);
                }}
                data-page-slot={pageNum}
                style={{
                  width,
                  height,
                  display: "flex",
                  alignItems: "flex-start",
                  justifyContent: "center",
                }}
              >
                {effectiveRenderedPages.has(pageNum) ? (
                  <PageView
                    pdf={pdfRef.current!}
                    pageNum={pageNum}
                    renderScale={scale}
                    displayScale={layoutScale}
                    overlaysVisible={overlaysVisible}
                    interactiveLayersEnabled={interactiveLayersEnabled}
                    highlights={highlights.filter((h) => h.page === pageNum)}
                    figures={figures.filter((f) => f.page === pageNum)}
                    legends={legends}
                    onTextChange={pageNum === currentPage ? onCurrentTextChange : undefined}
                    onRenderComplete={onPageRenderComplete}
                    onHighlight={onHighlight}
                    navigateTo={navigateTo}
                    onFigurePopup={onFigurePopup}
                    onPreviewPopup={setPreviewPopup}
                    showROI={showROI}
                    onFigureChange={(fig) => onFiguresChange(figures.map((f) => f.id === fig.id ? fig : f))}
                  />
                ) : (
                  <div
                    aria-hidden="true"
                    className="shadow-2xl"
                    style={{
                      width,
                      height,
                      borderRadius: 4,
                      background: "linear-gradient(180deg, rgba(255,255,255,0.92), rgba(241,245,249,0.92))",
                    }}
                  />
                )}
              </div>
            ))}
          </div>
        )}
      </div>
      <div
        ref={snapshotHostRef}
        style={{
          position: "absolute",
          inset: 0,
          overflow: "hidden",
          pointerEvents: "none",
          opacity: snapshotVisible ? 1 : 0,
          transition: "opacity 90ms linear",
          zIndex: snapshotVisible ? 20 : -1,
        }}
      />
      {showROI && (
        <div style={{
          position: "absolute", bottom: 12, left: "50%", transform: "translateX(-50%)",
          background: "rgba(99,102,241,0.9)", color: "white",
          fontSize: 11, fontWeight: 600, padding: "3px 10px", borderRadius: 4,
          pointerEvents: "none", zIndex: 30, letterSpacing: "0.02em",
        }}>
          ROI edit · d to exit
        </div>
      )}
      </div>

      {previewPopup && (
        <PagePreviewPopup
          pdfUrl={pdfUrl}
          destPage={previewPopup.destPage}
          destPdfX={previewPopup.destPdfX}
          destPdfY={previewPopup.destPdfY}
          anchorY={previewPopup.anchorY}
          onClose={() => setPreviewPopup(null)}
        />
      )}
    </div>
  );
}

function HighlightDiv({ rect, color, legends, dims, hovered, zIndex, onHover }: {
  rect: HighlightRect; color: string; legends: Legend[]; dims: PageDims;
  hovered: boolean; zIndex: number; onHover: (on: boolean) => void;
}) {
  const fill = highlightFill(legends, color), border = highlightBorder(legends, color);
  return (
    <div onMouseEnter={() => onHover(true)} onMouseLeave={() => onHover(false)}
      style={{
        position: "absolute",
        left: rect.x * dims.cssW, top: rect.y * dims.cssH,
        width: rect.w * dims.cssW, height: rect.h * dims.cssH,
        background: fill, outline: hovered ? `2px solid ${border}` : "none",
        borderRadius: 2, zIndex, pointerEvents: "auto",
        mixBlendMode: "multiply", transition: "outline 0.1s",
      }}
    />
  );
}
