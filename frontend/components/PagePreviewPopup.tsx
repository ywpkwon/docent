"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";

interface Props {
  pdfUrl: string;
  destPage: number;
  destPdfX?: number;
  destPdfY?: number;
  /** Fractional Y position (0–1 from top) for direct bbox-based scrolling */
  destFracY?: number;
  /** Client-Y of the triggering click — popup floats above or below */
  anchorY: number;
  onClose: () => void;
}

let pdfjsLib: typeof import("pdfjs-dist") | null = null;
async function getPdfjs() {
  if (!pdfjsLib) {
    pdfjsLib = await import("pdfjs-dist");
    pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;
  }
  return pdfjsLib;
}

const PAD        = 0;
const MARGIN     = 12;   // gap between click point and popup edge
const BASE_SCALE = 2.0;
const W_FRAC     = 0.80; // 80 % of viewport width
const H_FRAC     = 0.30; // 30 % of viewport height

export function PagePreviewPopup({ pdfUrl, destPage, destPdfX, destPdfY, destFracY, anchorY, onClose }: Props) {
  const canvasRef   = useRef<HTMLCanvasElement>(null);
  const scrollRef   = useRef<HTMLDivElement>(null);
  const popupRef    = useRef<HTMLDivElement>(null);

  const [loading, setLoading] = useState(true);
  const [renderScale, setRenderScale] = useState(BASE_SCALE);

  const baseDimsRef       = useRef<{ w: number; h: number } | null>(null);
  const cssMultiplierRef  = useRef(1.0);
  const reRenderTimer     = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isZoomRerender    = useRef(false);
  const pendingScrollRef  = useRef<((el: HTMLDivElement) => void) | null>(null);
  const zoomCenterFracRef = useRef<{ fx: number; fy: number } | null>(null);

  // ── Position: 80 vw wide, 30 vh tall, above or below click ───────────────
  const vw = typeof window !== "undefined" ? window.innerWidth  : 1200;
  const vh = typeof window !== "undefined" ? window.innerHeight : 800;
  const popupW = Math.round(vw * W_FRAC);
  const popupH = Math.round(vh * H_FRAC);
  const left   = Math.round((vw - popupW) / 2);
  const spaceBelow = vh - anchorY - MARGIN;
  const top = spaceBelow >= popupH
    ? anchorY + MARGIN                           // fits below
    : Math.max(8, anchorY - MARGIN - popupH);    // place above

  // ── Render page ─────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!isZoomRerender.current) setLoading(true);
      isZoomRerender.current = false;
      try {
        const lib  = await getPdfjs();
        const pdf  = await lib.getDocument(pdfUrl).promise;
        const page = await pdf.getPage(destPage + 1);
        if (cancelled) return;

        const vp     = page.getViewport({ scale: renderScale });
        const canvas = canvasRef.current;
        if (!canvas || cancelled) return;

        const dpr    = window.devicePixelRatio || 1;
        const physVP = page.getViewport({ scale: renderScale * dpr });
        canvas.width        = physVP.width;
        canvas.height       = physVP.height;
        canvas.style.width  = `${vp.width}px`;
        canvas.style.height = `${vp.height}px`;

        baseDimsRef.current      = { w: vp.width, h: vp.height };
        cssMultiplierRef.current = 1.0;

        await page.render({ canvasContext: canvas.getContext("2d")!, viewport: physVP }).promise;
        if (cancelled) return;

        if (zoomCenterFracRef.current) {
          const { fx, fy } = zoomCenterFracRef.current;
          zoomCenterFracRef.current = null;
          const totalW = vp.width + PAD * 2, totalH = vp.height + PAD * 2;
          pendingScrollRef.current = (el) => {
            el.scrollLeft = Math.max(0, fx * totalW - el.clientWidth  / 2);
            el.scrollTop  = Math.max(0, fy * totalH - el.clientHeight / 2);
          };
        } else if (destPdfX !== undefined && destPdfY !== undefined) {
          const [cx, cy] = vp.convertToViewportPoint(destPdfX, destPdfY);
          pendingScrollRef.current = (el) => {
            el.scrollLeft = Math.max(0, cx + PAD - MARGIN);
            el.scrollTop  = Math.max(0, cy + PAD - 60);
          };
        } else if (destPdfY !== undefined) {
          const pageH1 = page.getViewport({ scale: 1 }).height;
          const cssY   = (pageH1 - destPdfY) * renderScale;
          pendingScrollRef.current = (el) => {
            el.scrollLeft = 0;
            el.scrollTop  = Math.max(0, cssY + PAD - 60);
          };
        } else if (destFracY !== undefined) {
          const cssY = destFracY * vp.height;
          pendingScrollRef.current = (el) => {
            el.scrollLeft = 0;
            el.scrollTop  = Math.max(0, cssY + PAD - MARGIN);
          };
        }

        setLoading(false);
      } catch {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdfUrl, destPage, renderScale]);

  useLayoutEffect(() => {
    if (!loading && pendingScrollRef.current && scrollRef.current) {
      pendingScrollRef.current(scrollRef.current);
      pendingScrollRef.current = null;
    }
  }, [loading]);

  // ── Pinch zoom ───────────────────────────────────────────────────────────
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      e.stopPropagation();
      const canvas = canvasRef.current, base = baseDimsRef.current;
      if (!canvas || !base) return;
      const newMul = Math.max(0.35, Math.min(4.0, cssMultiplierRef.current * Math.exp(-e.deltaY / 200)));
      cssMultiplierRef.current = newMul;
      canvas.style.width  = `${base.w * newMul}px`;
      canvas.style.height = `${base.h * newMul}px`;
      zoomCenterFracRef.current = {
        fx: (el.scrollLeft + el.clientWidth  / 2) / el.scrollWidth,
        fy: (el.scrollTop  + el.clientHeight / 2) / el.scrollHeight,
      };
      requestAnimationFrame(() => {
        if (!scrollRef.current || !zoomCenterFracRef.current) return;
        const sc = scrollRef.current, { fx, fy } = zoomCenterFracRef.current;
        sc.scrollLeft = Math.max(0, fx * sc.scrollWidth  - sc.clientWidth  / 2);
        sc.scrollTop  = Math.max(0, fy * sc.scrollHeight - sc.clientHeight / 2);
      });
      if (reRenderTimer.current) clearTimeout(reRenderTimer.current);
      reRenderTimer.current = setTimeout(() => {
        isZoomRerender.current = true;
        setRenderScale(BASE_SCALE * cssMultiplierRef.current);
      }, 400);
    };
    el.addEventListener("wheel", handler, { passive: false });
    return () => {
      el.removeEventListener("wheel", handler);
      if (reRenderTimer.current) clearTimeout(reRenderTimer.current);
    };
  }, []);

  // ── Close handlers ───────────────────────────────────────────────────────
  useEffect(() => {
    const onKey  = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    const onDown = (e: MouseEvent) => {
      if (popupRef.current && !popupRef.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener("keydown", onKey);
    const id = setTimeout(() => document.addEventListener("mousedown", onDown), 50);
    return () => {
      window.removeEventListener("keydown", onKey);
      clearTimeout(id);
      document.removeEventListener("mousedown", onDown);
    };
  }, [onClose]);

  return (
    <div
      ref={popupRef}
      style={{
        position: "fixed",
        left, top,
        width: popupW,
        height: popupH,
        zIndex: 900,
        display: "flex",
        flexDirection: "column",
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: 6,
        boxShadow: "0 8px 32px rgba(0,0,0,0.45)",
        overflow: "hidden",
      }}
    >
      <div
        ref={scrollRef}
        className="pp-scroll"
        style={{
          overflow: "auto",
          flex: 1,
          position: "relative",
          userSelect: "none",
        }}
      >
        {loading && (
          <div style={{
            position: "absolute", inset: 0, zIndex: 2,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <div style={{
              width: 22, height: 22, borderRadius: "50%",
              border: "2px solid var(--accent)", borderTopColor: "transparent",
              animation: "spin 0.8s linear infinite",
            }} />
          </div>
        )}
        <canvas
          ref={canvasRef}
          style={{ display: "block", opacity: loading ? 0 : 1, transition: "opacity 0.12s" }}
        />
      </div>
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        .pp-scroll::-webkit-scrollbar { display: none; }
        .pp-scroll { scrollbar-width: none; }
      `}</style>
    </div>
  );
}
