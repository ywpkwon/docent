"use client";

import { useCallback, useRef, useState } from "react";

interface Props {
  onUpload: (file: File) => void;
  uploading: boolean;
  error: string | null;
}

export function UploadZone({ onUpload, uploading, error }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const handleFile = useCallback(
    (file: File) => {
      if (!file.name.toLowerCase().endsWith(".pdf")) return;
      onUpload(file);
    },
    [onUpload]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  return (
    <div className="flex items-center justify-center h-screen" style={{ background: "var(--bg)" }}>
      <div className="flex flex-col items-center gap-6 max-w-lg w-full px-6">
        {/* Logo / title */}
        <div className="text-center">
          <h1 className="text-4xl font-bold mb-2" style={{ color: "var(--text)" }}>
            Paper<span style={{ color: "var(--accent)" }}>Pal</span>
          </h1>
          <p style={{ color: "var(--text-muted)" }} className="text-sm">
            Upload a PDF. Start talking. Your paper responds.
          </p>
        </div>

        {/* Drop zone */}
        <div
          onClick={() => !uploading && inputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          className="w-full rounded-2xl border-2 border-dashed transition-all cursor-pointer flex flex-col items-center justify-center gap-3 py-14 px-8"
          style={{
            borderColor: dragging ? "var(--accent)" : "var(--border)",
            background: dragging ? "rgba(99,102,241,0.07)" : "var(--surface)",
          }}
        >
          {uploading ? (
            <>
              <div className="w-10 h-10 rounded-full border-2 border-t-transparent animate-spin"
                style={{ borderColor: "var(--accent)", borderTopColor: "transparent" }} />
              <p style={{ color: "var(--text-muted)" }} className="text-sm">
                Analyzing paper with Gemini Vision...
              </p>
            </>
          ) : (
            <>
              <div className="text-4xl select-none">📄</div>
              <p style={{ color: "var(--text)" }} className="font-medium">
                Drop a PDF here
              </p>
              <p style={{ color: "var(--text-muted)" }} className="text-sm">
                or click to browse
              </p>
            </>
          )}
        </div>

        {error && (
          <div className="w-full rounded-lg px-4 py-3 text-sm"
            style={{ background: "rgba(239,68,68,0.1)", color: "#f87171", border: "1px solid rgba(239,68,68,0.3)" }}>
            {error}
          </div>
        )}

        <input
          ref={inputRef}
          type="file"
          accept=".pdf,application/pdf"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
            e.target.value = "";
          }}
        />

        <p style={{ color: "var(--text-muted)" }} className="text-xs text-center">
          Powered by Gemini Live API · Voice-native · No sign-in required
        </p>
      </div>
    </div>
  );
}
