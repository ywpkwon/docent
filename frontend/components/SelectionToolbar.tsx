"use client";

import { useEffect, useRef } from "react";
import type { HighlightColor, Legend } from "@/lib/types";

interface Props {
  x: number; // viewport px — right edge of last selection line
  y: number; // viewport px — bottom of last selection line
  legends: Legend[];
  onPick: (color: HighlightColor) => void;
  onDismiss: () => void;
}

const PILL_W  = 148; // px — all pills same width
const PILL_H  = 30;  // px per legend
const PAD     = 6;   // inner padding

export function SelectionToolbar({ x, y, legends, onPick, onDismiss }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  // Dismiss on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onDismiss();
    };
    const id = setTimeout(() => document.addEventListener("mousedown", handler), 60);
    return () => { clearTimeout(id); document.removeEventListener("mousedown", handler); };
  }, [onDismiss]);

  // Dismiss on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onDismiss(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onDismiss]);

  const totalH = legends.length * PILL_H + PAD * 2 + 8; // 8 = cancel row
  // Position below selection; shift left if near right edge
  const left = Math.min(x, window.innerWidth  - PILL_W - 16);
  const top  = Math.min(y + 8,   window.innerHeight - totalH - 16);

  return (
    <div
      ref={ref}
      data-toolbar="true"
      onMouseDown={(e) => e.preventDefault()} // keep text selection alive
      style={{
        position: "fixed",
        left,
        top,
        zIndex: 1000,
        background: "var(--surface-2)",
        border: "1px solid var(--border)",
        borderRadius: 12,
        boxShadow: "0 10px 30px rgba(0,0,0,0.5)",
        padding: PAD,
        display: "flex",
        flexDirection: "column",
        gap: 3,
        width: PILL_W + PAD * 2,
      }}
    >
      {legends.map((leg) => (
        <button
          key={leg.id}
          onClick={() => onPick(leg.id)}
          style={{
            width: PILL_W,
            height: PILL_H,
            borderRadius: 8,
            background: leg.hex,
            border: `1.5px solid ${leg.borderHex}`,
            color: readableTextColor(leg.hex),
            fontSize: 12,
            fontWeight: 600,
            cursor: "pointer",
            letterSpacing: "0.01em",
            transition: "filter 0.1s, transform 0.1s",
            textAlign: "center",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            padding: "0 8px",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.filter = "brightness(0.92)";
            e.currentTarget.style.transform = "translateX(2px)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.filter = "none";
            e.currentTarget.style.transform = "none";
          }}
        >
          {leg.label}
        </button>
      ))}

      {/* Divider + cancel */}
      <div style={{ height: 1, background: "var(--border)", margin: "2px 0" }} />
      <button
        onClick={onDismiss}
        style={{
          width: PILL_W,
          height: 24,
          borderRadius: 6,
          background: "none",
          border: "none",
          color: "var(--text-muted)",
          fontSize: 11,
          cursor: "pointer",
          textAlign: "center",
        }}
        onMouseEnter={(e) => { e.currentTarget.style.color = "var(--text)"; }}
        onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-muted)"; }}
      >
        Cancel
      </button>
    </div>
  );
}

/** Pick black or dark-gray text based on background luminance */
function readableTextColor(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  // Perceived luminance (WCAG formula)
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.55 ? "#1e293b" : "#f8fafc";
}
