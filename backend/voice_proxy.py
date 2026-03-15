"""
WebSocket proxy between the browser and Gemini Live API.

Browser protocol (JSON frames):
  → {"type": "setup", "system_prompt": "...", "paper_meta": {...}}
  → {"type": "audio", "data": "<base64 PCM 16kHz mono int16>"}
  → {"type": "interrupt"}

  ← {"type": "audio", "data": "<base64 PCM 24kHz mono int16>"}
  ← {"type": "action", "action": {"type": "...", ...}}
  ← {"type": "transcript", "text": "..."}
  ← {"type": "status", "status": "listening|thinking|speaking|interrupted"}
  ← {"type": "error", "message": "..."}
"""
from __future__ import annotations

import asyncio
import base64
import json
import logging
import os
from typing import Any

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
                "response_modalities": ["AUDIO"],
                "speech_config": {
                    "voice_config": {
                        "prebuilt_voice_config": {"voice_name": "Puck"}
                    }
                },
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


def _command_str_to_action(command: str) -> dict | None:
    """Convert a canonical command string (e.g. 'go_page 5') to a VoiceAction dict."""
    parts = command.strip().split()
    if not parts:
        return None
    name, args = parts[0], parts[1:]
    if name == "next_page":
        return {"type": "PAGE_RELATIVE", "delta": 1}
    if name == "prev_page":
        return {"type": "PAGE_RELATIVE", "delta": -1}
    if name == "go_page" and args:
        try:
            return {"type": "PAGE_NAV", "page": int(args[0])}
        except ValueError:
            return None
    if name in ("show_fig", "show_link") and args:
        return {"type": "SHOW_FIGURE", "figure_id": args[0]}
    if name == "highlight" and args:
        return {"type": "HIGHLIGHT", "color": args[0], "note": ""}
    return None


def _extract_action_from_text(text: str) -> tuple[str, dict | None]:
    """
    Parse the JSON envelope from Gemini's text response.
    Supports both formats:
      New: { "speech": "...", "command": "go_page 5" }
      Old: { "speech": "...", "action": { "type": "PAGE_NAV", ... } }
    Returns (speech_text, action_dict_or_none).
    """
    text = text.strip()
    if text.startswith("```"):
        lines = text.split("\n")
        text = "\n".join(lines[1:-1]) if len(lines) > 2 else text

    try:
        envelope = json.loads(text)
        speech = envelope.get("speech", "")

        # New format: command string
        command = envelope.get("command")
        if command and command != "none":
            return speech, _command_str_to_action(command)

        # Old format: action object (backward compat)
        action = envelope.get("action")
        if action and action.get("type") == "NONE":
            action = None
        return speech, action
    except (json.JSONDecodeError, AttributeError):
        return text, None


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
                accumulated_text: list[str] = []
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

                        # Server content (audio + text)
                        server_content = msg.get("serverContent") or msg.get("server_content")
                        if server_content:
                            model_turn = server_content.get("modelTurn") or server_content.get("model_turn", {})
                            parts = model_turn.get("parts", [])

                            for part in parts:
                                # Audio chunk
                                inline = part.get("inlineData") or part.get("inline_data")
                                if inline:
                                    await browser_ws.send_json({
                                        "type": "audio",
                                        "data": inline.get("data", ""),
                                    })
                                    await browser_ws.send_json({"type": "status", "status": "speaking"})

                                # Text chunk (our JSON envelope)
                                text = part.get("text")
                                if text:
                                    accumulated_text.append(text)

                            turn_complete = server_content.get("turnComplete") or server_content.get("turn_complete")
                            if turn_complete:
                                # Process accumulated text for action
                                if accumulated_text:
                                    full_text = "".join(accumulated_text)
                                    speech, action = _extract_action_from_text(full_text)
                                    if speech:
                                        await browser_ws.send_json({"type": "transcript", "text": speech})
                                    if action:
                                        await browser_ws.send_json({"type": "action", "action": action})
                                    accumulated_text.clear()

                                await browser_ws.send_json({"type": "status", "status": "listening"})

                        # Tool call (function calling)
                        tool_call = msg.get("toolCall") or msg.get("tool_call")
                        if tool_call:
                            fn_calls = tool_call.get("functionCalls") or tool_call.get("function_calls", [])
                            for fn in fn_calls:
                                call_id = fn.get("id", "")
                                name = fn.get("name", "")
                                args = fn.get("args", {})

                                action = _fn_call_to_action(name, args)
                                if action:
                                    await browser_ws.send_json({"type": "action", "action": action})

                                # Acknowledge tool call
                                await gemini_ws.send(json.dumps(_make_tool_response(call_id)))

                        # Interrupted
                        if msg.get("interrupted"):
                            accumulated_text.clear()
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


def _fn_call_to_action(name: str, args: dict[str, Any]) -> dict | None:
    """Convert a Gemini function call to our action format."""
    mapping = {
        "navigate_page": lambda a: {"type": "PAGE_NAV", "page": a.get("page_number", 1)},
        "navigate_relative": lambda a: {"type": "PAGE_RELATIVE", "delta": a.get("delta", 0)},
        "show_figure": lambda a: {"type": "SHOW_FIGURE", "figure_id": a.get("figure_id", "")},
        "add_highlight": lambda a: {
            "type": "HIGHLIGHT",
            "color": a.get("color", "yellow"),
            "note": a.get("note", ""),
        },
    }
    fn = mapping.get(name)
    return fn(args) if fn else None
