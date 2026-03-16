"use client";

import { useEffect } from "react";
import { COMMAND_REGISTRY } from "@/lib/commands";

interface Props {
  onClose: () => void;
}

const KEYBINDS: { key: string; description: string }[] = [
  { key: "h",   description: "Highlights panel" },
  { key: "H",   description: "Highlight types & colors" },
  { key: "e",   description: "Export to Obsidian" },
  { key: "c",   description: "Close document" },
  { key: "m",   description: "Mic toggle" },
  { key: "p",   description: "Preferences" },
  { key: "f",   description: "Quick link browser (FZF)" },
  { key: "T",   description: "Analyze paper — extract key passages (Pass 1)" },
  { key: "t",   description: "Build guided tour from plan (Pass 2, pick duration)" },
  { key: "`",   description: "Tour plan / script view" },
  { key: ":",   description: "Command bar" },
  { key: "?",   description: "This help" },
];

export function CommandHelp({ onClose }: Props) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key === "?") { e.preventDefault(); onClose(); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const visible = COMMAND_REGISTRY.filter((c) => c.name !== "none");

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 10000,
        background: "rgba(0,0,0,0.45)", backdropFilter: "blur(2px)",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--surface-2)",
          border: "1px solid var(--border)",
          borderRadius: 10,
          padding: "24px 28px",
          width: 560,
          maxWidth: "90vw",
          maxHeight: "85vh",
          overflowY: "auto",
          boxShadow: "0 20px 60px rgba(0,0,0,0.4)",
          fontFamily: "ui-monospace, 'Cascadia Code', 'Fira Code', monospace",
        }}
      >
        {/* Header */}
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 18 }}>
          <span style={{ fontWeight: 700, fontSize: 15, color: "var(--text)" }}>Help</span>
          <span style={{ fontSize: 11, color: "var(--text-muted)" }}>Esc or ? to close</span>
        </div>

        {/* Keybinds */}
        <div style={{ marginBottom: 18 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase",
            letterSpacing: "0.08em", marginBottom: 8 }}>
            Keybinds
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <tbody>
              {KEYBINDS.map(({ key, description }) => (
                <tr key={key} style={{ borderBottom: "1px solid var(--border)" }}>
                  <td style={{ padding: "6px 12px 6px 0", whiteSpace: "nowrap", verticalAlign: "top" }}>
                    <kbd style={{
                      display: "inline-block", padding: "1px 6px", borderRadius: 4,
                      background: "var(--surface)", border: "1px solid var(--border)",
                      fontSize: 11, fontWeight: 700, color: "var(--accent)",
                      fontFamily: "inherit",
                    }}>{key}</kbd>
                  </td>
                  <td style={{ padding: "6px 0 6px 4px", color: "var(--text-muted)", lineHeight: 1.5 }}>
                    {description}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Commands */}
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase",
            letterSpacing: "0.08em", marginBottom: 8 }}>
            Commands <span style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>(via : bar or voice)</span>
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <tbody>
              {visible.map((cmd) => (
                <tr key={cmd.name} style={{ borderBottom: "1px solid var(--border)" }}>
                  <td style={{ padding: "7px 12px 7px 0", color: "var(--accent)", whiteSpace: "nowrap",
                    verticalAlign: "top", fontWeight: 600 }}>
                    {cmd.syntax}
                  </td>
                  <td style={{ padding: "7px 0 7px 12px", color: "var(--text-muted)", lineHeight: 1.5 }}>
                    {cmd.description}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Usage note */}
        <div style={{
          padding: "10px 12px", borderRadius: 6, background: "var(--surface)",
          fontSize: 11, color: "var(--text-muted)", lineHeight: 1.6,
        }}>
          <span style={{ color: "var(--accent)", fontWeight: 600 }}>:</span>
          {" "}opens the command bar &nbsp;·&nbsp;
          type a command directly <em>or</em> plain English — Gemini translates
        </div>
      </div>
    </div>
  );
}
