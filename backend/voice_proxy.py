"""
WebSocket proxy between the browser and Gemini Live API.

Used purely as a speech-to-text layer: user audio → Gemini Live input
transcription → transcript string sent to browser → browser runs the
transcript through the same parseNaturalCommand / handleCommand pipeline
as typed text commands.

Browser protocol (JSON frames):
  → {"type": "setup", "system_prompt": "...", "paper_meta": {...}}
  → {"type": "audio", "data": "<base64 PCM 16kHz mono int16>"}
  → {"type": "interrupt"}

  ← {"type": "transcript", "text": "<user's spoken words>"}
  ← {"type": "status", "status": "listening|thinking|interrupted"}
  ← {"type": "error", "message": "..."}
"""
from __future__ import annotations

import asyncio
import base64
import json
import logging
import os
import websockets
from fastapi import WebSocket, WebSocketDisconnect

logger = logging.getLogger(__name__)

LIVE_MODEL = os.getenv("LIVE_MODEL", "gemini-2.0-flash-live-001")
GEMINI_WS_URL = (
    "wss://generativelanguage.googleapis.com/ws/"
    "google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent"
)


def _make_setup_msg(system_prompt: str) -> dict:
    return {
        "setup": {
            "model": f"models/{LIVE_MODEL}",
            "generation_config": {
                # Text-only responses — we use the live model purely for STT.
                # Commands are routed through the text pipeline on the frontend.
                "response_modalities": ["TEXT"],
                "input_audio_transcription": {},
            },
            "system_instruction": {
                "parts": [{"text": system_prompt}]
            },
        }
    }


def _make_audio_msg(pcm_b64: str) -> dict:
    return {
        "realtime_input": {
            "media_chunks": [
                {"data": pcm_b64, "mime_type": "audio/pcm;rate=16000"}
            ]
        }
    }


def _make_tool_response(call_id: str, output: str = "ok") -> dict:
    return {
        "tool_response": {
            "function_responses": [
                {"id": call_id, "response": {"output": output}}
            ]
        }
    }



async def run_voice_session(browser_ws: WebSocket) -> None:
    """
    Manages a single voice session: bridges browser WebSocket ↔ Gemini Live API.
    """
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        await browser_ws.send_json({"type": "error", "message": "GEMINI_API_KEY not configured"})
        return

    gemini_url = f"{GEMINI_WS_URL}?key={api_key}"

    # Wait for setup message from browser
    try:
        setup_raw = await asyncio.wait_for(browser_ws.receive_json(), timeout=10.0)
    except asyncio.TimeoutError:
        await browser_ws.send_json({"type": "error", "message": "Setup timeout"})
        return

    if setup_raw.get("type") != "setup":
        await browser_ws.send_json({"type": "error", "message": "Expected setup message first"})
        return

    system_prompt = setup_raw.get("system_prompt", "You are a helpful research assistant.")

    try:
        async with websockets.connect(
            gemini_url,
            additional_headers={"Content-Type": "application/json"},
            max_size=20 * 1024 * 1024,  # 20 MB
        ) as gemini_ws:
            # Send setup to Gemini
            await gemini_ws.send(json.dumps(_make_setup_msg(system_prompt)))

            # Wait for setup complete acknowledgement
            try:
                ack = await asyncio.wait_for(gemini_ws.recv(), timeout=10.0)
                logger.debug("Gemini setup ack: %s", ack[:200] if isinstance(ack, str) else ack[:200])
            except asyncio.TimeoutError:
                await browser_ws.send_json({"type": "error", "message": "Gemini setup timeout"})
                return

            await browser_ws.send_json({"type": "status", "status": "listening"})

            # Bidirectional proxy
            async def browser_to_gemini() -> None:
                try:
                    while True:
                        msg = await browser_ws.receive_json()
                        msg_type = msg.get("type")

                        if msg_type == "audio":
                            await gemini_ws.send(json.dumps(_make_audio_msg(msg["data"])))

                        elif msg_type == "interrupt":
                            # Send end-of-turn signal
                            await gemini_ws.send(json.dumps({
                                "client_content": {"turn_complete": True}
                            }))
                            await browser_ws.send_json({"type": "status", "status": "listening"})

                except (WebSocketDisconnect, websockets.exceptions.ConnectionClosed):
                    pass
                except Exception as exc:
                    logger.exception("browser_to_gemini error: %s", exc)

            async def gemini_to_browser() -> None:
                try:
                    async for raw in gemini_ws:
                        if isinstance(raw, bytes):
                            raw = raw.decode("utf-8")

                        try:
                            msg = json.loads(raw)
                        except json.JSONDecodeError:
                            continue

                        # Setup complete
                        if "setupComplete" in msg:
                            continue

                        # Input transcription — user's spoken words → send to browser
                        # as a transcript so the frontend can run it through the same
                        # text-command pipeline (exact → NLP regex → /api/command).
                        input_trans = msg.get("inputTranscription") or msg.get("input_transcription")
                        if input_trans:
                            text = (input_trans.get("text") or "").strip()
                            finished = input_trans.get("finished", False)
                            if finished and text:
                                logger.debug("STT transcript: %r", text)
                                await browser_ws.send_json({"type": "transcript", "text": text})

                        # Turn complete → go back to listening
                        server_content = msg.get("serverContent") or msg.get("server_content")
                        if server_content:
                            turn_complete = server_content.get("turnComplete") or server_content.get("turn_complete")
                            if turn_complete:
                                await browser_ws.send_json({"type": "status", "status": "listening"})

                        # Interrupted
                        if msg.get("interrupted"):
                            await browser_ws.send_json({"type": "status", "status": "interrupted"})

                except (WebSocketDisconnect, websockets.exceptions.ConnectionClosed):
                    pass
                except Exception as exc:
                    logger.exception("gemini_to_browser error: %s", exc)

            await asyncio.gather(
                browser_to_gemini(),
                gemini_to_browser(),
            )

    except (websockets.exceptions.WebSocketException, OSError) as exc:
        logger.error("Failed to connect to Gemini Live API: %s", exc)
        try:
            await browser_ws.send_json({"type": "error", "message": f"Gemini connection failed: {exc}"})
        except Exception:
            pass
