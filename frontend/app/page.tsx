"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { PDFViewer } from "@/components/PDFViewer";
import { VoiceController, type VoiceControllerHandle } from "@/components/VoiceController";
import { CommandBar } from "@/components/CommandBar";
import { CommandHelp } from "@/components/CommandHelp";
import { PagePreviewPopup } from "@/components/PagePreviewPopup";
import { HighlightsPanel } from "@/components/HighlightsPanel";
import { UploadZone } from "@/components/UploadZone";
import { PreferencesModal } from "@/components/PreferencesModal";
import { QuickLink } from "@/components/QuickLink";
import { TourPlayer } from "@/components/TourPlayer";
import { createHighlight, exportToObsidian } from "@/lib/highlights";
import { loadLegends, saveLegends } from "@/lib/legends";
import { parseCommand, type ParsedCommand } from "@/lib/commands";
import { clearSession, loadSession, saveSession } from "@/lib/db";
import type {
  FigureBBox,
  Highlight,
  HighlightColor,
  HighlightRect,
  Legend,
  ParsedPaper,
  PdfLink,
  TourEvent,
  VoiceAction,
  VoiceStatus,
} from "@/lib/types";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:8000";

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

export default function Home() {
  const [paper, setPaper]             = useState<ParsedPaper | null>(null);
  const [pdfUrl, setPdfUrl]           = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(0);
  const [highlights, setHighlights]   = useState<Highlight[]>([]);
  const [voiceStatus, setVoiceStatus] = useState<VoiceStatus>("idle");
  const [voiceError, setVoiceError]   = useState<string | null>(null);
  const [linkPopup, setLinkPopup] = useState<{ destPage: number; destPdfX?: number; destPdfY?: number; destFracY?: number; anchorY: number } | null>(null);
  const [pdfLinks, setPdfLinks] = useState<PdfLink[]>([]);
  const [currentHighlightId, setCurrentHighlightId] = useState<string | null>(null);
  const [figures, setFigures] = useState<FigureBBox[]>([]);
  const [uploading, setUploading]     = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [showPrefs, setShowPrefs]       = useState(false);
  const [commandBarOpen, setCommandBarOpen] = useState(false);
  const [helpOpen, setHelpOpen]             = useState(false);
  const [quickLinkOpen, setQuickLinkOpen] = useState(false);
  const [highlightsOpen, setHighlightsOpen] = useState(false);
  const [legends, setLegends]           = useState<Legend[]>(() => loadLegends());

  const [tourPicking, setTourPicking] = useState(false);
  const [tourLoading, setTourLoading] = useState(false);
  const [tourError, setTourError] = useState<string | null>(null);
  const [tourData, setTourData] = useState<{ narration: string; timeline: TourEvent[]; duration: "1min" | "2min" } | null>(null);

  const [restoring, setRestoring] = useState(true);

  const currentPageTextRef   = useRef<string>("");
  const currentHighlightRef  = useRef<string | null>(null);
  const pdfBlobRef           = useRef<Blob | null>(null);
  const fileMetaRef          = useRef<{ name: string; size: number } | null>(null);
  const voiceRef             = useRef<VoiceControllerHandle>(null);

  // Restore previous session on mount
  useEffect(() => {
    loadSession().then((s) => {
      if (s) {
        pdfBlobRef.current  = s.pdfBlob;
        fileMetaRef.current = { name: s.fileName, size: s.fileSize };
        setPaper(s.paper);
        setPdfUrl(URL.createObjectURL(s.pdfBlob));
        setHighlights(s.highlights);
        setFigures(s.figures);
      }
      setRestoring(false);
    }).catch(() => setRestoring(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-save highlights + figures whenever they change (debounced 800 ms)
  useEffect(() => {
    if (!paper || !pdfBlobRef.current || !fileMetaRef.current) return;
    const blob = pdfBlobRef.current, meta = fileMetaRef.current;
    const t = setTimeout(() => {
      saveSession({ fileName: meta.name, fileSize: meta.size, pdfBlob: blob, paper, highlights, figures });
    }, 800);
    return () => clearTimeout(t);
  }, [highlights, figures, paper]);

  // Persist legend changes
  const handleLegendsChange = useCallback((newLegends: Legend[]) => {
    setLegends(newLegends);
    saveLegends(newLegends);
  }, []);

  const handleUpload = useCallback(async (file: File) => {
    setUploading(true);
    setUploadError(null);
    const formData = new FormData();
    formData.append("file", file);
    try {
      const res = await fetch(`${BACKEND_URL}/api/parse`, { method: "POST", body: formData });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: "Unknown error" }));
        throw new Error(err.detail ?? `HTTP ${res.status}`);
      }
      const parsed: ParsedPaper = await res.json();
      setPaper(parsed);
      setPdfUrl(URL.createObjectURL(file));
      setCurrentPage(0);
      setHighlights([]);
      setCurrentHighlightId(null); currentHighlightRef.current = null;
      setFigures(parsed.figures);
      pdfBlobRef.current  = file;
      fileMetaRef.current = { name: file.name, size: file.size };
      saveSession({ fileName: file.name, fileSize: file.size, pdfBlob: file, paper: parsed, highlights: [], figures: parsed.figures });
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }, []);

  // Central command executor
  const executeCommand = useCallback((cmd: ParsedCommand) => {
    if (!paper) return;
    const { name, args } = cmd;
    switch (name) {
      case "next_page":
        setCurrentPage((p) => Math.min(paper.page_count - 1, p + 1));
        break;
      case "prev_page":
        setCurrentPage((p) => Math.max(0, p - 1));
        break;
      case "go_page": {
        const n = parseInt(args[0] ?? "", 10);
        if (!isNaN(n)) setCurrentPage(Math.max(0, Math.min(paper.page_count - 1, n - 1)));
        break;
      }
      case "show_link": {
        const id = args[0];
        const fig = figures.find((f) => f.id === id);
        if (fig) { setLinkPopup({ destPage: fig.page, destFracY: fig.bbox.y, anchorY: window.innerHeight / 2 }); break; }
        const link = pdfLinks.find((l) => l.id === id);
        // Omit destPdfX: PagePreviewPopup keeps scrollLeft=0 for ref links (XYZ x
        // often points to the wrong column for wrapped entries like [14]).
        if (link) setLinkPopup({ destPage: link.destPage, destPdfY: link.destPdfY, anchorY: window.innerHeight / 2 });
        break;
      }
      case "highlight": {
        const color = (args[0] ?? "agree") as HighlightColor;
        const text = currentPageTextRef.current.slice(0, 120) || "[current page]";
        setHighlights((prev) => [...prev, createHighlight(currentPage, color, text, "")]);
        break;
      }
      case "next_highlight":
      case "prev_highlight": {
        const filter = args[0]?.toLowerCase();
        const sorted = [...highlights].sort((a, b) => {
          if (a.page !== b.page) return a.page - b.page;
          return (a.rects?.[0]?.y ?? 0) - (b.rects?.[0]?.y ?? 0);
        });
        const filtered = filter
          ? sorted.filter((h) => {
              const leg = legends.find((l) => l.id === h.color);
              return h.color.includes(filter) || leg?.label.toLowerCase().includes(filter);
            })
          : sorted;
        if (filtered.length === 0) break;
        const curIdx = filtered.findIndex((h) => h.id === currentHighlightRef.current);
        const nextIdx = name === "next_highlight"
          ? (curIdx === -1 ? 0 : (curIdx + 1) % filtered.length)
          : (curIdx === -1 ? filtered.length - 1 : (curIdx - 1 + filtered.length) % filtered.length);
        const hl = filtered[nextIdx];
        if (hl) { currentHighlightRef.current = hl.id; setCurrentHighlightId(hl.id); setCurrentPage(hl.page); }
        break;
      }
      case "change_highlight": {
        const newColor = args[0];
        const hlId = currentHighlightRef.current;
        if (!newColor || !hlId) break;
        setHighlights((prev) => prev.map((h) => h.id === hlId ? { ...h, color: newColor } : h));
        break;
      }
      // "none" → no-op; future commands handled here
    }
  }, [paper, currentPage, highlights, legends, figures, pdfLinks]);

  // Adapter: convert legacy VoiceAction → executeCommand
  const handleAction = useCallback((action: VoiceAction) => {
    if (!paper) return;
    switch (action.type) {
      case "PAGE_NAV":
        executeCommand({ name: "go_page", args: [String(action.page)], raw: "" });
        break;
      case "PAGE_RELATIVE":
        executeCommand({ name: action.delta > 0 ? "next_page" : "prev_page", args: [], raw: "" });
        break;
      case "SHOW_FIGURE":
        executeCommand({ name: "show_link", args: [action.figure_id], raw: "" });
        break;
      case "HIGHLIGHT":
        executeCommand({ name: "highlight", args: [action.color], raw: "" });
        break;
    }
  }, [paper, executeCommand]);

  const handlePageChange = useCallback((page: number) => {
    setCurrentPage(page);
    if (paper) currentPageTextRef.current = paper.pages[page]?.text ?? "";
  }, [paper]);

  const handleHighlight = useCallback((text: string, rects: HighlightRect[], color: HighlightColor, page: number) => {
    setHighlights((prev) => [...prev, createHighlight(page, color, text, "", rects)]);
  }, []);

  const handleRemoveHighlight = useCallback((id: string) => {
    setHighlights((prev) => prev.filter((h) => h.id !== id));
  }, []);

  const handleExportObsidian = useCallback(() => {
    if (!paper) return;
    const md = exportToObsidian(paper.title, highlights, legends);
    const blob = new Blob([md], { type: "text/markdown" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${paper.title.replace(/[^a-z0-9]/gi, "_").toLowerCase()}_highlights.md`;
    a.click();
  }, [paper, highlights, legends]);

  const handleCloseDocument = useCallback(() => {
    clearSession();
    setPaper(null);
    setPdfUrl(null);
    setHighlights([]);
    setFigures([]);
    setPdfLinks([]);
    setCurrentPage(0);
    setLinkPopup(null);
    pdfBlobRef.current = null;
    fileMetaRef.current = null;
  }, []);

  const startTour = useCallback(async (duration: "1min" | "2min") => {
    if (!paper) return;
    setTourPicking(false);
    setTourLoading(true);
    setTourError(null);
    try {
      // Send a compact paper context instead of the full system_prompt to minimise token usage.
      const sectionLines = paper.pages
        .filter((p) => p.section_title)
        .map((p) => `  p.${p.page + 1}: ${p.section_title}`)
        .join("\n");
      const paperContext = [
        `Title: ${paper.title}`,
        `Abstract: ${paper.abstract.slice(0, 600)}`,
        sectionLines ? `Sections:\n${sectionLines}` : "",
      ].filter(Boolean).join("\n\n");

      const res = await fetch(`${BACKEND_URL}/api/tour`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          system_prompt: paperContext,
          duration,
          figures: figures.map((f) => ({ id: f.id, label: f.label, page: f.page })),
          pdf_links: pdfLinks.map((l) => ({ id: l.id, label: l.label, destPage: l.destPage })),
        }),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        const detail: string = errBody.detail ?? `HTTP ${res.status}`;
        const isQuota = detail.includes("429") || detail.includes("RESOURCE_EXHAUSTED");
        const isExhausted = isQuota && detail.includes("limit: 0");
        const msg = isExhausted
          ? "Gemini free-tier quota exhausted. Enable billing at ai.google.dev, or set TOUR_MODEL in .env to a model with remaining quota."
          : isQuota
          ? "Gemini rate limit — wait ~30s and try again."
          : detail.includes("API key") ? "Gemini API key not configured."
          : `Tour generation failed (${res.status}).`;
        throw new Error(msg);
      }
      const data = await res.json();
      if (!data.narration) throw new Error("Gemini returned an empty tour — try again.");
      setTourData({ narration: data.narration, timeline: data.timeline ?? [], duration });
    } catch (err) {
      setTourError(err instanceof Error ? err.message : "Tour generation failed.");
    } finally {
      setTourLoading(false);
    }
  }, [paper, figures, pdfLinks]);

  const handleTourCommand = useCallback((rawCmd: string) => {
    // highlight color "text" page  — our preferred format
    const m1 = rawCmd.match(/^highlight\s+(\w+)\s+"([^"]+)"\s+(\d+)$/);
    // highlight "text" color page  — Gemini sometimes swaps order
    const m2 = rawCmd.match(/^highlight\s+"([^"]+)"\s+(\w+)\s+(\d+)$/);
    const [color, text, pageStr] = m1
      ? [m1[1], m1[2], m1[3]]
      : m2 ? [m2[2], m2[1], m2[3]] : [];
    if (color && text && pageStr) {
      const page = parseInt(pageStr, 10) - 1;
      setHighlights((prev) => [
        ...prev,
        createHighlight(page, color as HighlightColor, text, "", undefined, "tour"),
      ]);
      return;
    }
    // Regular command (go_page, show_link, etc.)
    const cmd = parseCommand(rawCmd);
    if (cmd && cmd.name !== "none") {
      if (cmd.name === "go_page") setLinkPopup(null);
      executeCommand(cmd);
    }
  }, [executeCommand]);

  // Global keybinds
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (commandBarOpen || helpOpen || quickLinkOpen || highlightsOpen || showPrefs || tourPicking || tourLoading || !!tourData) return;
      if (e.key === "Escape" && tourError) { setTourError(null); return; }
      if ((e.target as HTMLElement).closest("input, textarea, [contenteditable]")) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === ":") { e.preventDefault(); setCommandBarOpen(true); }
      if (e.key === "?") { e.preventDefault(); setHelpOpen(true); }
      if (e.key === "f" && paper) { e.preventDefault(); setQuickLinkOpen(true); }
      if (e.key === "t" && paper) { e.preventDefault(); setTourPicking(true); }
      if (e.key === "h" && paper) { e.preventDefault(); setHighlightsOpen(true); }
      if (e.key === "H" && paper) { e.preventDefault(); setShowPrefs(true); }
      if (e.key === "p" && paper) { e.preventDefault(); setShowPrefs(true); }
      if (e.key === "e" && paper) { e.preventDefault(); handleExportObsidian(); }
      if (e.key === "c" && paper) { e.preventDefault(); handleCloseDocument(); }
      if (e.key === "m" && paper) { e.preventDefault(); voiceRef.current?.toggle(); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [commandBarOpen, helpOpen, quickLinkOpen, highlightsOpen, showPrefs, tourPicking, tourLoading, tourData, paper, handleExportObsidian, handleCloseDocument]);

  const handleCommand = useCallback(async (text: string): Promise<{ speech: string } | null> => {
    if (!paper) return null;

    const directCmd = parseCommand(text);
    if (directCmd && directCmd.name !== "none") {
      executeCommand(directCmd);
      return { speech: "" };
    }

    try {
      const res = await fetch(`${BACKEND_URL}/api/command`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_message: text,
          system_prompt: paper.system_prompt,
          current_page: currentPage + 1,
          page_count: paper.page_count,
        }),
      });
      if (!res.ok) return { speech: "Something went wrong. Try again." };
      const data = await res.json();
      const cmd = parseCommand(data.command ?? "none");
      if (cmd && cmd.name !== "none") executeCommand(cmd);
      return { speech: data.speech ?? "" };
    } catch {
      return { speech: "Network error — is the backend running?" };
    }
  }, [paper, currentPage, executeCommand]);

  if (restoring) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", background: "var(--bg)" }}>
        <div style={{ width: 28, height: 28, borderRadius: "50%", border: "3px solid var(--accent)", borderTopColor: "transparent", animation: "spin 0.8s linear infinite" }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  if (!paper || !pdfUrl) {
    return (
      <UploadZone onUpload={handleUpload} uploading={uploading} error={uploadError} />
    );
  }

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: "var(--bg)" }}>
      <PDFViewer
        pdfUrl={pdfUrl}
        currentPage={currentPage}
        pageCount={paper.page_count}
        highlights={highlights}
        figures={figures}
        legends={legends}
        onPageChange={handlePageChange}
        onFigurePopup={(fig, clientY) => setLinkPopup({ destPage: fig.page, destFracY: fig.bbox.y, anchorY: clientY })}
        onHighlight={handleHighlight}
        onCurrentTextChange={(text) => { currentPageTextRef.current = text; }}
        onFiguresChange={setFigures}
        onLinksReady={setPdfLinks}
      />
      <VoiceController
        ref={voiceRef}
        backendUrl={BACKEND_URL}
        systemPrompt={paper.system_prompt}
        onStatusChange={(s) => { setVoiceStatus(s); if (s !== "idle") setVoiceError(null); }}
        onTranscript={() => {}}
        onAction={handleAction}
        onError={setVoiceError}
      />

      {/* Voice status badge */}
      {voiceStatus !== "idle" && (
        <div style={{
          position: "fixed", bottom: 16, right: 16, zIndex: 500,
          display: "flex", alignItems: "center", gap: 6,
          background: "var(--surface-2)", border: "1px solid var(--border)",
          borderRadius: 20, padding: "5px 12px 5px 8px",
          fontSize: 11, color: STATUS_COLOR[voiceStatus],
          fontFamily: "ui-monospace, monospace",
          boxShadow: "0 2px 8px rgba(0,0,0,0.3)",
        }}>
          <div style={{
            width: 7, height: 7, borderRadius: "50%",
            background: STATUS_COLOR[voiceStatus],
            animation: voiceStatus === "listening" ? "vsPing 1.2s ease-in-out infinite" : "none",
          }} />
          {STATUS_LABEL[voiceStatus]}
          {voiceStatus === "speaking" && (
            <button
              onClick={() => voiceRef.current?.interrupt()}
              style={{ marginLeft: 4, fontSize: 10, padding: "1px 5px", borderRadius: 3,
                background: "rgba(239,68,68,0.12)", color: "#f87171",
                border: "1px solid rgba(239,68,68,0.3)", cursor: "pointer" }}
            >stop</button>
          )}
        </div>
      )}
      {voiceError && voiceStatus === "idle" && (
        <div style={{
          position: "fixed", bottom: 16, right: 16, zIndex: 500,
          background: "var(--surface-2)", border: "1px solid rgba(239,68,68,0.4)",
          borderRadius: 20, padding: "5px 12px",
          fontSize: 11, color: "#f87171",
          fontFamily: "ui-monospace, monospace",
          boxShadow: "0 2px 8px rgba(0,0,0,0.3)",
        }}>
          {voiceError}
        </div>
      )}

      {linkPopup && (
        <PagePreviewPopup
          pdfUrl={pdfUrl}
          destPage={linkPopup.destPage}
          destPdfX={linkPopup.destPdfX}
          destPdfY={linkPopup.destPdfY}
          destFracY={linkPopup.destFracY}
          anchorY={linkPopup.anchorY}
          onClose={() => setLinkPopup(null)}
        />
      )}

      {highlightsOpen && (
        <HighlightsPanel
          highlights={highlights}
          legends={legends}
          currentHighlightId={currentHighlightId}
          onClose={() => setHighlightsOpen(false)}
          onRemove={handleRemoveHighlight}
          onNavigate={setCurrentPage}
        />
      )}

      {showPrefs && (
        <PreferencesModal
          legends={legends}
          onChange={handleLegendsChange}
          onClose={() => setShowPrefs(false)}
        />
      )}

      <CommandBar
        isOpen={commandBarOpen}
        onClose={() => setCommandBarOpen(false)}
        onSubmit={handleCommand}
        paper={paper}
        legends={legends}
        highlights={highlights}
        pdfLinks={pdfLinks}
      />

      {helpOpen && <CommandHelp onClose={() => setHelpOpen(false)} />}

      <QuickLink
        isOpen={quickLinkOpen}
        onClose={() => setQuickLinkOpen(false)}
        onSelect={(id) => executeCommand({ name: "show_link", args: [id], raw: "" })}
        pdfUrl={pdfUrl}
        figures={figures}
        pdfLinks={pdfLinks}
      />

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes vsPing { 0%,100% { opacity: 1; } 50% { opacity: 0.3; } }
      `}</style>

      {/* Tour picker */}
      {tourPicking && (
        <div
          style={{ position: "fixed", inset: 0, zIndex: 9500, background: "rgba(0,0,0,0.5)",
            display: "flex", alignItems: "center", justifyContent: "center" }}
          onClick={() => setTourPicking(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "var(--surface-2)", border: "1px solid var(--border)",
              borderRadius: 10, padding: "24px 28px",
              boxShadow: "0 20px 60px rgba(0,0,0,0.4)",
              fontFamily: "ui-monospace, 'Cascadia Code', monospace",
              display: "flex", flexDirection: "column", gap: 16,
              minWidth: 280,
            }}
          >
            <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text)" }}>Guided tour</div>
            <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 }}>
              Docent narrates the paper, navigates pages, and<br />adds highlight suggestions as it talks.
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              {(["1min", "2min"] as const).map((d) => (
                <button
                  key={d}
                  onClick={() => startTour(d)}
                  style={{
                    flex: 1, padding: "10px 0", borderRadius: 6, fontSize: 13, fontWeight: 600,
                    background: "var(--accent)", color: "white", border: "none", cursor: "pointer",
                  }}
                >
                  {d === "1min" ? "1-min" : "2-min"} tour
                </button>
              ))}
            </div>
            <div style={{ fontSize: 10, color: "var(--text-muted)", textAlign: "center" }}>Esc to cancel</div>
          </div>
        </div>
      )}

      {/* Tour loading / error */}
      {(tourLoading || tourError) && (
        <div style={{
          position: "fixed", bottom: 20, left: "50%", transform: "translateX(-50%)",
          zIndex: 8500,
          display: "flex", alignItems: "center", gap: 10,
          background: "var(--surface-2)", border: `1px solid ${tourError ? "rgba(239,68,68,0.4)" : "var(--border)"}`,
          borderRadius: 10, padding: "12px 20px",
          boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
          fontFamily: "ui-monospace, monospace", fontSize: 12,
          color: tourError ? "#f87171" : "var(--text-muted)",
        }}>
          {tourLoading && (
            <div style={{
              width: 14, height: 14, borderRadius: "50%",
              border: "2px solid var(--accent)", borderTopColor: "transparent",
              animation: "spin 0.8s linear infinite", flexShrink: 0,
            }} />
          )}
          {tourError ? tourError : "Generating tour…"}
          {tourError && (
            <button onClick={() => setTourError(null)} style={{
              marginLeft: 8, fontSize: 13, background: "none", border: "none",
              color: "#f87171", cursor: "pointer", opacity: 0.7, lineHeight: 1,
            }}>×</button>
          )}
        </div>
      )}

      {/* Tour player */}
      {tourData && (
        <TourPlayer
          narration={tourData.narration}
          timeline={tourData.timeline}
          duration={tourData.duration}
          onCommand={handleTourCommand}
          onClose={() => setTourData(null)}
        />
      )}
    </div>
  );
}
