"use client";

import { useEffect, useRef, useState } from "react";
import type { TourEvent } from "@/lib/types";

interface Props {
  narration: string;
  timeline: TourEvent[];
  duration: "1min" | "2min";
  onCommand: (rawCmd: string) => void;
  onClose: () => void;
}

export function TourPlayer({ narration, timeline, duration, onCommand, onClose }: Props) {
  const [progress, setProgress] = useState(0);
  const [paused, setPaused] = useState(false);
  const [done, setDone] = useState(false);
  const [currentChar, setCurrentChar] = useState(0);
  const nextIdxRef = useRef(0);
  const pausedRef = useRef(false);

  const sorted = [...timeline].sort((a, b) => a.at_char - b.at_char);

  useEffect(() => {
    const utter = new SpeechSynthesisUtterance(narration);
    utter.rate = 0.95;
    nextIdxRef.current = 0;

    utter.onboundary = (e) => {
      const charIdx = e.charIndex;
      setCurrentChar(charIdx);
      setProgress(charIdx / narration.length);
      if (!pausedRef.current) {
        while (nextIdxRef.current < sorted.length && sorted[nextIdxRef.current].at_char <= charIdx) {
          onCommand(sorted[nextIdxRef.current].cmd);
          nextIdxRef.current++;
        }
      }
    };

    utter.onend = () => {
      // Fire any remaining commands
      while (nextIdxRef.current < sorted.length) {
        onCommand(sorted[nextIdxRef.current].cmd);
        nextIdxRef.current++;
      }
      setProgress(1);
      setCurrentChar(narration.length);
      setDone(true);
    };

    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utter);

    // Chrome workaround: keep speech alive (pauses/resumes every 10s)
    const keepAlive = setInterval(() => {
      if (window.speechSynthesis.speaking && !window.speechSynthesis.paused) {
        window.speechSynthesis.pause();
        window.speechSynthesis.resume();
      }
    }, 10000);

    return () => {
      clearInterval(keepAlive);
      window.speechSynthesis.cancel();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handlePause = () => {
    if (paused) {
      pausedRef.current = false;
      window.speechSynthesis.resume();
    } else {
      pausedRef.current = true;
      window.speechSynthesis.pause();
    }
    setPaused((p) => !p);
  };

  const handleStop = () => {
    window.speechSynthesis.cancel();
    onClose();
  };

  // Show a sliding window of narration text around current position
  const snippetStart = Math.max(0, currentChar - 10);
  const snippet = narration.slice(snippetStart, snippetStart + 160);
  const cursorInSnippet = Math.min(10, currentChar);

  return (
    <div style={{
      position: "fixed", bottom: 20, left: "50%", transform: "translateX(-50%)",
      zIndex: 8500,
      display: "flex", flexDirection: "column", gap: 8,
      background: "var(--surface-2)", border: "1px solid var(--border)",
      borderRadius: 10, padding: "12px 16px",
      boxShadow: "0 8px 32px rgba(0,0,0,0.45)",
      fontFamily: "ui-monospace, 'Cascadia Code', monospace",
      width: "min(560px, 90vw)",
    }}>
      {/* Header row */}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div style={{
          width: 8, height: 8, borderRadius: "50%", flexShrink: 0,
          background: done ? "var(--text-muted)" : paused ? "#fbbf24" : "var(--accent)",
          animation: !done && !paused ? "tp-pulse 1.5s ease-in-out infinite" : "none",
        }} />
        <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text)", flex: 1 }}>
          {done ? "Tour complete" : paused ? "Paused" : `${duration} guided tour`}
        </span>
        <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
          {Math.round(progress * 100)}%
        </span>
        <button
          onClick={handlePause}
          disabled={done}
          style={{
            fontSize: 11, padding: "2px 8px", borderRadius: 4,
            background: "var(--surface)", border: "1px solid var(--border)",
            color: "var(--text)", cursor: done ? "default" : "pointer",
            opacity: done ? 0.4 : 1,
          }}
        >
          {paused ? "▶ Resume" : "⏸ Pause"}
        </button>
        <button
          onClick={handleStop}
          style={{
            fontSize: 11, padding: "2px 8px", borderRadius: 4,
            background: done ? "var(--accent)" : "rgba(239,68,68,0.1)",
            border: done ? "none" : "1px solid rgba(239,68,68,0.3)",
            color: done ? "white" : "#f87171",
            cursor: "pointer",
          }}
        >
          {done ? "✓ Done" : "⏹ Stop"}
        </button>
      </div>

      {/* Progress bar */}
      <div style={{ height: 3, background: "var(--surface)", borderRadius: 2, overflow: "hidden" }}>
        <div style={{
          height: "100%", background: "var(--accent)", borderRadius: 2,
          width: `${Math.round(progress * 100)}%`,
          transition: "width 0.4s ease",
        }} />
      </div>

      {/* Narration snippet */}
      {!done && (
        <div style={{
          fontSize: 11, color: "var(--text-muted)", lineHeight: 1.6,
          maxHeight: 44, overflow: "hidden",
        }}>
          <span style={{ color: "var(--text-muted)", opacity: 0.5 }}>
            {snippet.slice(0, cursorInSnippet)}
          </span>
          <span style={{ color: "var(--text)", fontWeight: 500 }}>
            {snippet.slice(cursorInSnippet, cursorInSnippet + 1)}
          </span>
          <span style={{ color: "var(--text-muted)" }}>
            {snippet.slice(cursorInSnippet + 1)}
          </span>
        </div>
      )}
      {done && (
        <div style={{ fontSize: 11, color: "var(--text-muted)", lineHeight: 1.5 }}>
          Tour highlights added — open <kbd style={{ padding: "0 4px", borderRadius: 3, border: "1px solid var(--border)", background: "var(--surface)", fontSize: 10 }}>h</kbd> to review and adjust.
        </div>
      )}

      <style>{`@keyframes tp-pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }`}</style>
    </div>
  );
}
