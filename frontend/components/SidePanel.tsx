"use client";

import { useEffect, useRef, useState } from "react";
import type { Highlight, Legend, ParsedPaper, VoiceStatus } from "@/lib/types";
import { highlightFill, highlightBorder, highlightLabel } from "@/lib/highlights";

interface Props {
  paper: ParsedPaper;
  highlights: Highlight[];
  legends: Legend[];
  currentPage: number;
  pageCount: number;
  scale: number;
  currentHighlightId?: string | null;
  voiceStatus: VoiceStatus;
  transcript: string;
  voiceError: string | null;
  onVoiceToggle: () => void;
  onVoiceInterrupt: () => void;
  onRemoveHighlight: (id: string) => void;
  onExportObsidian: () => void;
  onNavigatePage: (page: number) => void;
  onOpenPreferences: () => void;
  onCloseDocument: () => void;
}

type Tab = "highlights" | "outline";

const STATUS_COLOR: Record<VoiceStatus, string> = {
  idle:        "var(--text-muted)",
  connecting:  "#94a3b8",
  listening:   "#4ade80",
  thinking:    "#fbbf24",
  speaking:    "#818cf8",
  interrupted: "#f87171",
};
const STATUS_LABEL: Record<VoiceStatus, string> = {
  idle: "", connecting: "connecting…", listening: "listening",
  thinking: "thinking…", speaking: "speaking", interrupted: "interrupted",
};

export function SidePanel({
  paper, highlights, legends, currentPage, pageCount, scale, currentHighlightId,
  voiceStatus, transcript, voiceError,
  onVoiceToggle, onVoiceInterrupt,
  onRemoveHighlight, onExportObsidian, onNavigatePage, onOpenPreferences, onCloseDocument,
}: Props) {
  const [tab, setTab] = useState<Tab>("highlights");

  useEffect(() => {
    if (currentHighlightId) setTab("highlights");
  }, [currentHighlightId]);

  const voiceActive = voiceStatus !== "idle";

  return (
    <div className="w-64 shrink-0 flex flex-col border-l"
      style={{ background: "var(--surface)", borderColor: "var(--border)" }}>

      {/* Header */}
      <div className="px-3 pt-3 pb-2 border-b shrink-0" style={{ borderColor: "var(--border)" }}>
        <div className="flex items-start gap-1.5 mb-1.5">
          <h2 className="flex-1 text-xs font-semibold leading-snug line-clamp-2 min-w-0"
            style={{ color: "var(--text)" }}>
            {paper.title}
          </h2>
          {/* Mic button */}
          <button onClick={onVoiceToggle}
            title={voiceActive ? "Stop voice session" : "Start voice session"}
            style={{
              position: "relative", flexShrink: 0, width: 28, height: 28, borderRadius: "50%",
              background: voiceActive ? "rgba(239,68,68,0.12)" : "var(--accent)",
              border: voiceActive ? "1.5px solid rgba(239,68,68,0.5)" : "1.5px solid transparent",
              display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer",
            }}>
            {voiceActive
              ? <span style={{ width: 8, height: 8, borderRadius: 2, background: "#f87171", display: "block" }} />
              : <MicIcon />}
            {voiceStatus === "listening" && (
              <span style={{
                position: "absolute", inset: 0, borderRadius: "50%",
                background: "rgba(99,102,241,0.25)",
                animation: "ppPing 1.2s cubic-bezier(0,0,0.2,1) infinite",
              }} />
            )}
          </button>
          {/* Prefs */}
          <button onClick={onOpenPreferences} title="Preferences"
            style={{ flexShrink: 0, width: 28, height: 28, borderRadius: 4, background: "none",
              border: "none", cursor: "pointer", color: "var(--text-muted)", fontSize: 14,
              display: "flex", alignItems: "center", justifyContent: "center" }}>
            ⚙
          </button>
          {/* Close document */}
          <button onClick={onCloseDocument} title="Close document"
            style={{ flexShrink: 0, width: 28, height: 28, borderRadius: 4, background: "none",
              border: "none", cursor: "pointer", color: "var(--text-muted)", fontSize: 16,
              display: "flex", alignItems: "center", justifyContent: "center" }}>
            ⏏
          </button>
        </div>

        {/* Status line: page · scale [· voice status] */}
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", fontSize: 11, color: "var(--text-muted)" }}>
          <span className="tabular-nums">p.{currentPage + 1}/{pageCount}</span>
          <span>·</span>
          <span className="tabular-nums">{Math.round(scale * 100)}%</span>
          {voiceActive && STATUS_LABEL[voiceStatus] && (
            <>
              <span>·</span>
              <span style={{ color: STATUS_COLOR[voiceStatus], fontWeight: 500 }}>{STATUS_LABEL[voiceStatus]}</span>
            </>
          )}
          {voiceStatus === "speaking" && (
            <button onClick={onVoiceInterrupt}
              style={{ fontSize: 10, padding: "1px 5px", borderRadius: 3,
                background: "rgba(239,68,68,0.12)", color: "#f87171",
                border: "1px solid rgba(239,68,68,0.3)", cursor: "pointer" }}>
              stop
            </button>
          )}
        </div>

        {voiceActive && transcript && (
          <p className="mt-1 line-clamp-2"
            style={{ fontSize: 11, color: "var(--text-muted)", fontStyle: "italic" }}>
            {transcript}
          </p>
        )}
        {voiceError && (
          <p className="mt-1" style={{ fontSize: 11, color: "#f87171" }}>{voiceError}</p>
        )}
      </div>

      {/* Legend swatches */}
      <div className="px-3 py-2 border-b flex flex-wrap gap-1.5" style={{ borderColor: "var(--border)" }}>
        {legends.map((leg) => (
          <div key={leg.id} className="flex items-center gap-1">
            <div style={{ width: 8, height: 8, borderRadius: "50%", background: leg.hex,
              border: `1px solid ${leg.borderHex}`, flexShrink: 0 }} />
            <span style={{ fontSize: 10, color: "var(--text-muted)" }}>{leg.label}</span>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex border-b shrink-0" style={{ borderColor: "var(--border)" }}>
        {(["highlights", "outline"] as Tab[]).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            style={{
              flex: 1, padding: "6px 0", fontSize: 11, fontWeight: 500,
              textTransform: "capitalize", background: "none", cursor: "pointer",
              color: tab === t ? "var(--accent)" : "var(--text-muted)",
              borderBottom: tab === t ? "2px solid var(--accent)" : "2px solid transparent",
              border: "none", borderBottomStyle: "solid",
            }}>
            {t}{t === "highlights" && highlights.length > 0 ? ` (${highlights.length})` : ""}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto">
        {tab === "highlights" && (
          <HighlightsTab highlights={highlights} legends={legends}
            currentHighlightId={currentHighlightId}
            onRemove={onRemoveHighlight} onNavigate={onNavigatePage} />
        )}
        {tab === "outline" && (
          <OutlineTab paper={paper} currentPage={currentPage} onNavigate={onNavigatePage} />
        )}
      </div>

      {/* Footer */}
      <div className="px-3 py-2 border-t shrink-0" style={{ borderColor: "var(--border)" }}>
        <button onClick={onExportObsidian} disabled={highlights.length === 0}
          style={{ width: "100%", padding: "5px 0", borderRadius: 6, fontSize: 11,
            fontWeight: 500, background: "var(--accent)", color: "white",
            border: "none", cursor: "pointer", opacity: highlights.length === 0 ? 0.3 : 1 }}>
          Export to Obsidian
        </button>
      </div>

      <style>{`@keyframes ppPing { 75%,100% { transform: scale(1.8); opacity: 0; } }`}</style>
    </div>
  );
}

function HighlightsTab({ highlights, legends, currentHighlightId, onRemove, onNavigate }: {
  highlights: Highlight[]; legends: Legend[]; currentHighlightId?: string | null;
  onRemove: (id: string) => void; onNavigate: (page: number) => void;
}) {
  const activeRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (currentHighlightId) activeRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [currentHighlightId]);

  if (highlights.length === 0) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 120, padding: "0 16px" }}>
        <p style={{ fontSize: 11, color: "var(--text-muted)", textAlign: "center" }}>
          Select text then pick a color, or use commands to annotate.
        </p>
      </div>
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, padding: 8 }}>
      {highlights.map((hl) => {
        const fill   = highlightFill(legends, hl.color);
        const border = highlightBorder(legends, hl.color);
        const label  = highlightLabel(legends, hl.color);
        const active = hl.id === currentHighlightId;
        return (
          <div key={hl.id} ref={active ? activeRef : undefined}
            className="group"
            style={{ borderRadius: 6, padding: "6px 8px", cursor: "pointer",
              background: fill, border: `${active ? 2 : 1}px solid ${border}` }}
            onClick={() => onNavigate(hl.page)}>
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 4 }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: "#1e293b" }}>
                {active && <span style={{ marginRight: 3 }}>▶</span>}
                p.{hl.page + 1} · {label}
              </span>
              <button onClick={(e) => { e.stopPropagation(); onRemove(hl.id); }}
                className="opacity-0 group-hover:opacity-60 transition-opacity"
                style={{ fontSize: 12, color: "#1e293b", background: "none", border: "none", cursor: "pointer", flexShrink: 0 }}>
                ×
              </button>
            </div>
            <p style={{ fontSize: 11, marginTop: 2, color: "#334155",
              display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
              {hl.note || hl.text}
            </p>
          </div>
        );
      })}
    </div>
  );
}

function OutlineTab({ paper, currentPage, onNavigate }: {
  paper: ParsedPaper; currentPage: number; onNavigate: (p: number) => void;
}) {
  const sections = paper.pages.filter((p) => p.section_title)
    .map((p) => ({ page: p.page, title: p.section_title! }));
  return (
    <div style={{ display: "flex", flexDirection: "column", padding: 8, gap: 2 }}>
      {sections.length === 0
        ? <p style={{ fontSize: 11, padding: "16px 8px", textAlign: "center", color: "var(--text-muted)" }}>No sections detected</p>
        : sections.map((s) => (
          <button key={s.page} onClick={() => onNavigate(s.page)}
            style={{
              textAlign: "left", padding: "5px 8px", borderRadius: 4, fontSize: 11,
              color: currentPage === s.page ? "var(--accent)" : "var(--text)",
              background: currentPage === s.page ? "rgba(99,102,241,0.1)" : "transparent",
              border: "none", cursor: "pointer",
            }}>
            <span style={{ color: "var(--text-muted)", marginRight: 4 }}>p.{s.page + 1}</span>
            {s.title}
          </button>
        ))}
    </div>
  );
}

function MicIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round">
      <rect x="9" y="2" width="6" height="11" rx="3" />
      <path d="M5 10a7 7 0 0 0 14 0" />
      <line x1="12" y1="19" x2="12" y2="22" />
      <line x1="9" y1="22" x2="15" y2="22" />
    </svg>
  );
}
