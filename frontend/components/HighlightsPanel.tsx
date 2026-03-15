"use client";

import { useEffect, useRef } from "react";
import type { Highlight, Legend } from "@/lib/types";
import { highlightFill, highlightBorder, highlightLabel } from "@/lib/highlights";

interface Props {
  highlights: Highlight[];
  legends: Legend[];
  currentHighlightId?: string | null;
  onClose: () => void;
  onRemove: (id: string) => void;
  onNavigate: (page: number) => void;
}

export function HighlightsPanel({ highlights, legends, currentHighlightId, onClose, onRemove, onNavigate }: Props) {
  const activeRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key === "h") { e.preventDefault(); onClose(); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  useEffect(() => {
    if (currentHighlightId) activeRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [currentHighlightId]);

  return (
    <>
      <div style={{ position: "fixed", inset: 0, zIndex: 8000, background: "rgba(0,0,0,0.35)" }} onClick={onClose} />
      <div
        style={{
          position: "fixed", top: 0, right: 0, bottom: 0, zIndex: 8001,
          width: 280, display: "flex", flexDirection: "column",
          background: "var(--surface)", borderLeft: "1px solid var(--border)",
          boxShadow: "-8px 0 32px rgba(0,0,0,0.3)",
          fontFamily: "ui-monospace, 'Cascadia Code', 'Fira Code', monospace",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ padding: "12px 14px 10px", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>
              Highlights{highlights.length > 0 ? ` (${highlights.length})` : ""}
            </span>
            <span style={{ fontSize: 11, color: "var(--text-muted)" }}>h · Esc to close</span>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {legends.map((leg) => (
              <div key={leg.id} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <div style={{ width: 8, height: 8, borderRadius: "50%", background: leg.hex, border: `1px solid ${leg.borderHex}`, flexShrink: 0 }} />
                <span style={{ fontSize: 10, color: "var(--text-muted)" }}>{leg.label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* List */}
        <div style={{ flex: 1, overflowY: "auto", padding: 8 }}>
          {highlights.length === 0 ? (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 120 }}>
              <p style={{ fontSize: 11, color: "var(--text-muted)", textAlign: "center" }}>
                Select text then pick a color,<br />or use commands to annotate.
              </p>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {highlights.map((hl) => {
                const fill   = highlightFill(legends, hl.color);
                const border = highlightBorder(legends, hl.color);
                const label  = highlightLabel(legends, hl.color);
                const active = hl.id === currentHighlightId;
                return (
                  <div
                    key={hl.id}
                    ref={active ? activeRef : undefined}
                    style={{ borderRadius: 6, padding: "6px 8px", cursor: "pointer",
                      background: fill, border: `${active ? 2 : 1}px ${hl.source === "tour" ? "dashed" : "solid"} ${border}` }}
                    onClick={() => { onNavigate(hl.page); onClose(); }}
                  >
                    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 4 }}>
                      <span style={{ fontSize: 11, fontWeight: 600, color: "#1e293b" }}>
                        {active && <span style={{ marginRight: 3 }}>▶</span>}
                        {hl.source === "tour" && <span style={{ marginRight: 4, fontSize: 9, opacity: 0.7 }}>tour</span>}
                        p.{hl.page + 1} · {label}
                      </span>
                      <button
                        onClick={(e) => { e.stopPropagation(); onRemove(hl.id); }}
                        style={{ fontSize: 12, color: "#1e293b", background: "none", border: "none",
                          cursor: "pointer", flexShrink: 0, opacity: 0.4 }}
                        onMouseEnter={(e) => (e.currentTarget.style.opacity = "1")}
                        onMouseLeave={(e) => (e.currentTarget.style.opacity = "0.4")}
                      >×</button>
                    </div>
                    <p style={{ fontSize: 11, marginTop: 2, color: "#334155",
                      display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                      {hl.note || hl.text}
                    </p>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
