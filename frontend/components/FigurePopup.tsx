"use client";

import { useEffect, useRef, useState } from "react";
import type { FigureBBox } from "@/lib/types";

interface Props {
  pdfUrl: string;
  figure: FigureBBox;
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

export function FigurePopup({ pdfUrl, figure, onClose }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const lib = await getPdfjs();
        const pdf = await lib.getDocument(pdfUrl).promise;
        const page = await pdf.getPage(figure.page + 1);
        const viewport = page.getViewport({ scale: 2 });
        const canvas = canvasRef.current;
        if (!canvas || cancelled) return;

        canvas.width = viewport.width;
        canvas.height = viewport.height;
        await page.render({ canvasContext: canvas.getContext("2d")!, viewport }).promise;
        if (cancelled) return;

        const { x, y, w, h } = figure.bbox;
        const px = x * viewport.width;
        const py = y * viewport.height;
        const pw = w * viewport.width;
        const ph = h * viewport.height;

        const cropped = document.createElement("canvas");
        const PAD = 14;
        cropped.width  = pw + PAD * 2;
        cropped.height = ph + PAD * 2;
        const cCtx = cropped.getContext("2d")!;
        cCtx.fillStyle = "white";
        cCtx.fillRect(0, 0, cropped.width, cropped.height);
        cCtx.drawImage(canvas, px - PAD, py - PAD, cropped.width, cropped.height, 0, 0, cropped.width, cropped.height);
        canvas.width  = cropped.width;
        canvas.height = cropped.height;
        canvas.getContext("2d")!.drawImage(cropped, 0, 0);
        setLoading(false);
      } catch {
        if (!cancelled) setError(true);
      }
    })();
    return () => { cancelled = true; };
  }, [pdfUrl, figure]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 1000,
        background: "rgba(0,0,0,0.72)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: 20,
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        style={{
          background: "#fff",
          borderRadius: 6,
          overflow: "auto",
          maxWidth: "min(92vw, 1100px)",
          maxHeight: "90vh",
          boxShadow: "0 24px 80px rgba(0,0,0,0.65)",
          padding: 0,
          lineHeight: 0,
        }}
      >
        {(loading && !error) && (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 280, height: 180 }}>
            <div style={{
              width: 24, height: 24, borderRadius: "50%",
              border: "2px solid var(--accent)", borderTopColor: "transparent",
              animation: "spin 0.8s linear infinite",
            }} />
          </div>
        )}
        {error && (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 280, height: 180, fontSize: 13, color: "#f87171" }}>
            Could not render figure
          </div>
        )}
        <canvas
          ref={canvasRef}
          style={{
            display: loading || error ? "none" : "block",
            maxWidth: "100%",
            height: "auto",
          }}
        />
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
