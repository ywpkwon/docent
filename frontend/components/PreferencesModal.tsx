"use client";

import { useEffect, useRef, useState } from "react";
import type { Legend } from "@/lib/types";
import { DEFAULT_LEGENDS } from "@/lib/legends";

interface Props {
  legends: Legend[];
  onChange: (legends: Legend[]) => void;
  onClose: () => void;
}

function hexToRgb(hex: string) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return { r, g, b };
}

/** Darken a hex color by ~30% for the border */
function darken(hex: string): string {
  const { r, g, b } = hexToRgb(hex);
  return `#${[r, g, b].map((c) => Math.max(0, Math.floor(c * 0.65)).toString(16).padStart(2, "0")).join("")}`;
}

function isValidHex(hex: string) {
  return /^#[0-9a-fA-F]{6}$/.test(hex);
}

let _id = 0;
const uid = () => `legend-${Date.now()}-${_id++}`;

export function PreferencesModal({ legends, onChange, onClose }: Props) {
  const [draft, setDraft] = useState<Legend[]>(() => JSON.parse(JSON.stringify(legends)));
  const backdropRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const update = (index: number, patch: Partial<Legend>) => {
    setDraft((prev) => prev.map((l, i) => {
      if (i !== index) return l;
      const updated = { ...l, ...patch };
      // Auto-compute borderHex when hex changes
      if (patch.hex && isValidHex(patch.hex)) {
        updated.borderHex = darken(patch.hex);
      }
      return updated;
    }));
  };

  const addLegend = () => {
    setDraft((prev) => [...prev, { id: uid(), label: "New", hex: "#d1d5db", borderHex: "#9ca3af" }]);
  };

  const removeLegend = (index: number) => {
    setDraft((prev) => prev.filter((_, i) => i !== index));
  };

  const save = () => {
    const valid = draft.filter((l) => l.label.trim() && isValidHex(l.hex));
    onChange(valid);
    onClose();
  };

  const reset = () => setDraft(JSON.parse(JSON.stringify(DEFAULT_LEGENDS)));

  return (
    <div
      ref={backdropRef}
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.6)" }}
      onClick={(e) => { if (e.target === backdropRef.current) onClose(); }}
    >
      <div
        className="flex flex-col rounded-2xl shadow-2xl overflow-hidden"
        style={{
          background: "var(--surface)",
          border: "1px solid var(--border)",
          width: 480,
          maxHeight: "80vh",
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b shrink-0"
          style={{ borderColor: "var(--border)" }}>
          <div>
            <h2 className="font-semibold" style={{ color: "var(--text)" }}>Annotation Legends</h2>
            <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
              Customize highlight colors and labels. Changes are saved locally.
            </p>
          </div>
          <button onClick={onClose} style={{ color: "var(--text-muted)", fontSize: 20, lineHeight: 1 }}>×</button>
        </div>

        {/* Legend list */}
        <div className="flex-1 overflow-y-auto px-5 py-3 flex flex-col gap-2">
          {draft.map((leg, i) => (
            <div
              key={leg.id}
              className="flex items-center gap-3 rounded-lg px-3 py-2"
              style={{ background: "var(--surface-2)", border: "1px solid var(--border)" }}
            >
              {/* Color swatch + picker */}
              <div style={{ position: "relative", flexShrink: 0 }}>
                <div
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: "50%",
                    background: isValidHex(leg.hex) ? leg.hex : "#ccc",
                    border: `2px solid ${isValidHex(leg.borderHex) ? leg.borderHex : "#aaa"}`,
                    cursor: "pointer",
                    overflow: "hidden",
                  }}
                >
                  <input
                    type="color"
                    value={isValidHex(leg.hex) ? leg.hex : "#cccccc"}
                    onChange={(e) => update(i, { hex: e.target.value })}
                    style={{
                      opacity: 0,
                      position: "absolute",
                      inset: 0,
                      width: "100%",
                      height: "100%",
                      cursor: "pointer",
                      border: "none",
                      padding: 0,
                    }}
                    title="Pick color"
                  />
                </div>
              </div>

              {/* Hex input */}
              <input
                type="text"
                value={leg.hex}
                maxLength={7}
                onChange={(e) => update(i, { hex: e.target.value })}
                style={{
                  width: 76,
                  fontSize: 12,
                  fontFamily: "monospace",
                  padding: "3px 6px",
                  borderRadius: 6,
                  background: "var(--bg)",
                  color: isValidHex(leg.hex) ? "var(--text)" : "#f87171",
                  border: `1px solid ${isValidHex(leg.hex) ? "var(--border)" : "#f87171"}`,
                  outline: "none",
                  flexShrink: 0,
                }}
              />

              {/* Label */}
              <input
                type="text"
                value={leg.label}
                onChange={(e) => update(i, { label: e.target.value })}
                placeholder="Label"
                style={{
                  flex: 1,
                  fontSize: 13,
                  padding: "4px 8px",
                  borderRadius: 6,
                  background: "var(--bg)",
                  color: "var(--text)",
                  border: "1px solid var(--border)",
                  outline: "none",
                }}
              />

              {/* Remove */}
              <button
                onClick={() => removeLegend(i)}
                disabled={draft.length <= 1}
                style={{
                  color: "#f87171",
                  fontSize: 16,
                  background: "none",
                  border: "none",
                  cursor: draft.length > 1 ? "pointer" : "not-allowed",
                  opacity: draft.length <= 1 ? 0.3 : 0.7,
                  padding: "0 2px",
                }}
                title="Remove"
              >
                ×
              </button>
            </div>
          ))}

          <button
            onClick={addLegend}
            className="flex items-center justify-center gap-2 rounded-lg py-2 text-sm mt-1"
            style={{
              border: "1px dashed var(--border)",
              color: "var(--text-muted)",
              background: "none",
              cursor: "pointer",
            }}
          >
            + Add legend
          </button>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-3 border-t shrink-0"
          style={{ borderColor: "var(--border)" }}>
          <button
            onClick={reset}
            className="text-sm px-3 py-1.5 rounded-lg"
            style={{ color: "var(--text-muted)", background: "var(--surface-2)", border: "1px solid var(--border)" }}
          >
            Reset to defaults
          </button>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="text-sm px-4 py-1.5 rounded-lg"
              style={{ color: "var(--text-muted)", background: "var(--surface-2)", border: "1px solid var(--border)" }}
            >
              Cancel
            </button>
            <button
              onClick={save}
              className="text-sm px-4 py-1.5 rounded-lg font-medium"
              style={{ background: "var(--accent)", color: "white", border: "none" }}
            >
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
