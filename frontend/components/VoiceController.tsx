"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { MicCapture, AudioPlayer } from "@/lib/audio";
import type { VoiceAction, VoiceStatus, WsMessage } from "@/lib/types";

interface Props {
  backendUrl: string;
  systemPrompt: string;
  onStatusChange: (status: VoiceStatus) => void;
  onTranscript: (text: string) => void;
  onAction: (action: VoiceAction) => void;
  onError?: (msg: string) => void;
}

export interface VoiceControllerHandle {
  toggle: () => void;
  interrupt: () => void;
}

export const VoiceController = forwardRef<VoiceControllerHandle, Props>(
  function VoiceController({ backendUrl, systemPrompt, onStatusChange, onTranscript, onAction, onError }, ref) {
    const wsRef    = useRef<WebSocket | null>(null);
    const micRef   = useRef<MicCapture | null>(null);
    const playerRef = useRef<AudioPlayer | null>(null);
    const [active, setActive] = useState(false);

    const wsUrl = backendUrl.replace(/^http/, "ws") + "/ws/voice";

    const stop = useCallback(() => {
      micRef.current?.stop();   micRef.current = null;
      playerRef.current?.close(); playerRef.current = null;
      wsRef.current?.close();   wsRef.current = null;
      setActive(false);
      onStatusChange("idle");
    }, [onStatusChange]);

    const start = useCallback(async () => {
      onStatusChange("connecting");
      try {
        const ws = new WebSocket(wsUrl);
        wsRef.current = ws;

        ws.onopen = () => {
          ws.send(JSON.stringify({ type: "setup", system_prompt: systemPrompt }));
        };
        ws.onmessage = (event) => {
          let msg: WsMessage;
          try { msg = JSON.parse(event.data); } catch { return; }
          switch (msg.type) {
            case "audio":      playerRef.current?.enqueue(msg.data); break;
            case "action":     onAction(msg.action); break;
            case "transcript": onTranscript(msg.text); break;
            case "status":     onStatusChange(msg.status); break;
            case "error":      onError?.(msg.message); stop(); break;
          }
        };
        ws.onerror = () => { onError?.("Connection to backend failed. Is the server running?"); stop(); };
        ws.onclose = () => { if (active) stop(); };

        await new Promise<void>((resolve, reject) => {
          ws.addEventListener("open",  () => resolve(), { once: true });
          ws.addEventListener("error", () => reject(new Error("WebSocket failed")), { once: true });
        });

        playerRef.current = new AudioPlayer();
        const mic = new MicCapture((pcmBase64) => {
          if (wsRef.current?.readyState === WebSocket.OPEN)
            wsRef.current.send(JSON.stringify({ type: "audio", data: pcmBase64 }));
        });
        await mic.start();
        micRef.current = mic;
        setActive(true);
      } catch (err) {
        onError?.(err instanceof Error ? err.message : "Failed to start voice session");
        stop();
      }
    }, [wsUrl, systemPrompt, onAction, onTranscript, onStatusChange, onError, stop, active]);

    const handleInterrupt = useCallback(() => {
      playerRef.current?.interrupt();
      if (wsRef.current?.readyState === WebSocket.OPEN)
        wsRef.current.send(JSON.stringify({ type: "interrupt" }));
      onStatusChange("listening");
    }, [onStatusChange]);

    useImperativeHandle(ref, () => ({
      toggle:    () => { if (active) stop(); else start(); },
      interrupt: handleInterrupt,
    }), [active, stop, start, handleInterrupt]);

    useEffect(() => () => stop(), [stop]);

    return null;
  }
);
