"""
Docent FastAPI backend.

Endpoints:
  POST /api/parse       — Upload PDF, parse with Gemini Vision
  POST /api/command     — Text command → Gemini → {speech, command}
  POST /api/tour/plan   — Pass 1: extract key passages → plan items
  POST /api/tour        — Pass 2: narration + timeline (uses plan if provided)
  GET  /api/health      — Health check
  WS   /ws/voice        — Gemini Live API proxy (STT only)
"""
from __future__ import annotations

import logging
import os
from contextlib import asynccontextmanager

from dotenv import load_dotenv
from fastapi import FastAPI, File, HTTPException, UploadFile, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

load_dotenv()

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

from parse import ParsedPaper, parse_pdf, build_system_prompt, run_command, generate_tour, generate_tour_plan  # noqa: E402
from voice_proxy import run_voice_session  # noqa: E402


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Docent backend starting up")
    yield
    logger.info("Docent backend shutting down")


app = FastAPI(title="Docent API", lifespan=lifespan)

cors_origins = os.getenv("CORS_ORIGINS", "http://localhost:3000").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in cors_origins],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class CommandRequest(BaseModel):
    user_message: str
    system_prompt: str
    current_page: int = 1
    page_count: int = 1


@app.get("/api/health")
async def health():
    return {"status": "ok"}


@app.post("/api/command")
async def command_endpoint(req: CommandRequest):
    """
    Send a text command to Gemini and get back speech + action.
    Same JSON envelope format as voice: {"speech": "...", "action": {...}}
    """
    try:
        return await run_command(
            req.user_message,
            req.system_prompt,
            req.current_page,
            req.page_count,
        )
    except Exception as exc:
        logger.exception("Command failed: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/parse")
async def parse_endpoint(file: UploadFile = File(...)):
    """
    Accepts a PDF upload, parses it with Gemini Vision, and returns:
    - title, abstract
    - per-page text chunks
    - figure bounding boxes
    - a pre-built system prompt for the Live API session
    """
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are accepted")

    content_type = file.content_type or ""
    if content_type not in ("application/pdf", "application/octet-stream", ""):
        if not content_type.startswith("application"):
            raise HTTPException(status_code=400, detail=f"Invalid content type: {content_type}")

    pdf_bytes = await file.read()
    if len(pdf_bytes) > 50 * 1024 * 1024:  # 50 MB limit
        raise HTTPException(status_code=413, detail="PDF too large (max 50 MB)")

    try:
        paper = await parse_pdf(pdf_bytes)
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("PDF parsing failed: %s", exc)
        raise HTTPException(status_code=500, detail="PDF parsing failed") from exc

    system_prompt = build_system_prompt(paper)

    return {
        "title": paper.title,
        "abstract": paper.abstract,
        "page_count": paper.page_count,
        "pages": [
            {
                "page": p.page,
                "text": p.text,
                "section_title": p.section_title,
            }
            for p in paper.pages
        ],
        "figures": [
            {
                "id": f.id,
                "label": f.label,
                "page": f.page,
                "bbox": f.bbox,
            }
            for f in paper.figures
        ],
        "system_prompt": system_prompt,
    }


class TourFigure(BaseModel):
    id: str
    label: str = ""
    page: int  # 0-based


class TourLink(BaseModel):
    id: str
    label: str = ""
    destPage: int  # 0-based


class TourPlanItem(BaseModel):
    page: int       # 1-indexed
    text: str       # verbatim quote
    type: str       # definition|core_claim|method|result|question
    note: str = ""


class TourPlanRequest(BaseModel):
    context: str                  # compact paper context built client-side
    figures: list[TourFigure] = []


class TourRequest(BaseModel):
    system_prompt: str
    duration: str = "1min"  # "1min" or "2min"
    figures: list[TourFigure] = []
    pdf_links: list[TourLink] = []
    plan_items: list[TourPlanItem] = []


@app.post("/api/tour")
async def tour_endpoint(req: TourRequest):
    """Generate a narrated guided tour: narration text + timed command timeline."""
    try:
        return await generate_tour(
            req.system_prompt,
            req.duration,
            [f.model_dump() for f in req.figures],
            [l.model_dump() for l in req.pdf_links],
            [p.model_dump() for p in req.plan_items] if req.plan_items else None,
        )
    except Exception as exc:
        logger.exception("Tour generation failed: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/tour/plan")
async def tour_plan_endpoint(req: TourPlanRequest):
    """Pass 1: Extract key passages from the paper for a guided tour."""
    try:
        return await generate_tour_plan(
            req.context,
            [f.model_dump() for f in req.figures],
        )
    except Exception as exc:
        logger.exception("Tour plan generation failed: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.websocket("/ws/voice")
async def voice_endpoint(websocket: WebSocket):
    """Bidirectional WebSocket proxy to Gemini Live API."""
    await websocket.accept()
    logger.info("Voice session started")
    try:
        await run_voice_session(websocket)
    except Exception as exc:
        logger.exception("Voice session error: %s", exc)
    finally:
        logger.info("Voice session ended")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=int(os.getenv("PORT", "8000")),
        reload=os.getenv("ENV", "production") == "development",
    )
