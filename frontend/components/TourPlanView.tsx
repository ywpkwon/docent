"use client";

import type { Legend, TourEvent, TourPlanItem } from "@/lib/types";
import { highlightBorder, highlightLabel } from "@/lib/highlights";

interface Props {
  plan: TourPlanItem[] | null;
  tourData: { narration: string; timeline: TourEvent[] } | null;
  planLoading: boolean;
  tourLoading: boolean;
  legends: Legend[];
  onClose: () => void;
  onStartPlan: () => void;
  onStartTour: () => void;
}

// Maps plan type → the legend color ID used when creating highlights
const TYPE_TO_LEGEND: Record<string, string> = {
  definition: "definition",
  core_claim: "comment",
  method:     "other",
  result:     "comment",
  question:   "question",
};

function cmdIcon(cmd: string): string {
  if (cmd.startsWith("go_page")) return "↗";
  if (cmd.startsWith("focus")) return "◉";
  if (cmd.startsWith("highlight")) return "⬡";
  if (cmd.startsWith("show_link")) return "⊞";
  return "·";
}

function cmdColor(cmd: string): string {
  if (cmd.startsWith("go_page")) return "#94a3b8";
  if (cmd.startsWith("focus")) return "rgba(251,191,36,0.9)";
  if (cmd.startsWith("highlight")) return "#818cf8";
  if (cmd.startsWith("show_link")) return "#60a5fa";
  return "var(--text-muted)";
}

interface ScriptLine {
  type: "narration" | "command";
  text: string;
}

function buildScript(narration: string, timeline: TourEvent[]): ScriptLine[] {
  const lines: ScriptLine[] = [];
  const sorted = [...timeline].sort((a, b) => a.at_char - b.at_char);
  let pos = 0;
  let i = 0;
  while (i < sorted.length) {
    const at = sorted[i].at_char;
    if (at > pos) {
      const seg = narration.slice(pos, at).trim();
      if (seg) lines.push({ type: "narration", text: seg });
    }
    while (i < sorted.length && sorted[i].at_char === at) {
      lines.push({ type: "command", text: sorted[i].cmd });
      i++;
    }
    pos = at;
  }
  const tail = narration.slice(pos).trim();
  if (tail) lines.push({ type: "narration", text: tail });
  return lines;
}

export function TourPlanView({ plan, tourData, planLoading, tourLoading, legends, onClose, onStartPlan, onStartTour }: Props) {
  const hasPlan = plan && plan.length > 0;
  const hasTour = tourData && tourData.narration;
  const script = hasTour ? buildScript(tourData.narration, tourData.timeline) : null;

  return (
    <div style={{
      position: "fixed", top: 0, right: 0, bottom: 0, width: 380, zIndex: 6000,
      background: "var(--surface-2)", borderLeft: "1px solid var(--border)",
      display: "flex", flexDirection: "column",
      fontFamily: "ui-monospace, 'Cascadia Code', monospace",
      boxShadow: "-8px 0 32px rgba(0,0,0,0.3)",
    }}>
      {/* Header */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "14px 16px", borderBottom: "1px solid var(--border)", flexShrink: 0,
      }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text)", letterSpacing: "0.05em" }}>
          {hasTour ? "TOUR SCRIPT" : "TOUR PLAN"}
        </div>
        <button onClick={onClose} style={{
          background: "none", border: "none", color: "var(--text-muted)",
          fontSize: 16, cursor: "pointer", padding: "2px 6px", lineHeight: 1,
        }}>×</button>
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflowY: "auto", padding: "12px 16px" }}>

        {/* Script view (tour ran) */}
        {script && (
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {script.map((line, idx) =>
              line.type === "narration" ? (
                <div key={idx} style={{
                  fontSize: 11, color: "var(--text)", lineHeight: 1.6,
                  padding: "4px 0", borderLeft: "2px solid var(--border)",
                  paddingLeft: 8, marginLeft: 2,
                }}>
                  {line.text}
                </div>
              ) : (
                <div key={idx} style={{
                  fontSize: 11, color: cmdColor(line.text),
                  display: "flex", alignItems: "flex-start", gap: 6, paddingLeft: 4,
                }}>
                  <span style={{ opacity: 0.7, flexShrink: 0 }}>{cmdIcon(line.text)}</span>
                  <span style={{ fontFamily: "ui-monospace, monospace", wordBreak: "break-all" }}>{line.text}</span>
                </div>
              )
            )}
          </div>
        )}

        {/* Plan-only view (T ran but not t) */}
        {!script && hasPlan && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {plan.map((item, idx) => {
              const legendId = TYPE_TO_LEGEND[item.type] ?? "other";
              const borderColor = highlightBorder(legends, legendId);
              const typeLabel = highlightLabel(legends, legendId);
              return (
                <div key={idx} style={{
                  borderLeft: `2px solid ${borderColor}`,
                  paddingLeft: 10, paddingTop: 2, paddingBottom: 2,
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
                    <span style={{
                      fontSize: 9, fontWeight: 700, letterSpacing: "0.08em",
                      color: borderColor, textTransform: "uppercase",
                    }}>{typeLabel}</span>
                    <span style={{ fontSize: 10, color: "var(--text-muted)" }}>p.{item.page}</span>
                  </div>
                  <div style={{ fontSize: 11, color: "var(--text)", fontStyle: "italic", marginBottom: 3 }}>
                    &ldquo;{item.text}&rdquo;
                  </div>
                  {item.note && (
                    <div style={{ fontSize: 10, color: "var(--text-muted)", lineHeight: 1.4 }}>
                      {item.note}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Empty state */}
        {!script && !hasPlan && !planLoading && (
          <div style={{ fontSize: 11, color: "var(--text-muted)", textAlign: "center", marginTop: 40, lineHeight: 1.8 }}>
            Press <kbd style={{ padding: "1px 5px", background: "var(--surface-3)", borderRadius: 3 }}>T</kbd> to analyze the paper<br />
            then <kbd style={{ padding: "1px 5px", background: "var(--surface-3)", borderRadius: 3 }}>t</kbd> to generate the tour
          </div>
        )}

        {/* Loading */}
        {(planLoading || tourLoading) && (
          <div style={{
            display: "flex", alignItems: "center", gap: 8,
            fontSize: 11, color: "var(--text-muted)", marginTop: 20,
          }}>
            <div style={{
              width: 12, height: 12, borderRadius: "50%",
              border: "2px solid var(--accent)", borderTopColor: "transparent",
              animation: "spin 0.8s linear infinite", flexShrink: 0,
            }} />
            {planLoading ? "Analyzing paper…" : "Building tour…"}
          </div>
        )}
      </div>

      {/* Footer actions */}
      <div style={{
        padding: "12px 16px", borderTop: "1px solid var(--border)",
        display: "flex", gap: 8, flexShrink: 0,
      }}>
        {!hasTour && (
          <button
            onClick={onStartPlan}
            disabled={planLoading || tourLoading}
            style={{
              flex: 1, padding: "7px 0", fontSize: 11, fontWeight: 600,
              background: hasPlan ? "var(--surface-3)" : "var(--accent)",
              color: hasPlan ? "var(--text-muted)" : "white",
              border: "1px solid var(--border)", borderRadius: 5, cursor: "pointer",
              opacity: planLoading || tourLoading ? 0.5 : 1,
            }}
          >
            {hasPlan ? "↺ Re-analyze (T)" : "Analyze paper (T)"}
          </button>
        )}
        {hasPlan && !hasTour && (
          <button
            onClick={onStartTour}
            disabled={planLoading || tourLoading}
            style={{
              flex: 1, padding: "7px 0", fontSize: 11, fontWeight: 600,
              background: "var(--accent)", color: "white",
              border: "none", borderRadius: 5, cursor: "pointer",
              opacity: planLoading || tourLoading ? 0.5 : 1,
            }}
          >
            Build tour (t)
          </button>
        )}
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
