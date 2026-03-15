"""
PDF parsing via Gemini Vision.
Extracts per-page text chunks and figure bounding boxes.
"""
from __future__ import annotations

import asyncio
import io
import json
import logging
import os
from dataclasses import dataclass, field
from typing import Any

import re

import fitz  # PyMuPDF
from google import genai
from google.genai import types
from PIL import Image

_CAPTION_RE = re.compile(
    r"^(Figure|Fig\.?|Table|Algorithm|Alg\.?|Listing|Exhibit)\s*(\d+)",
    re.IGNORECASE,
)

logger = logging.getLogger(__name__)

PARSE_MODEL = os.getenv("PARSE_MODEL", "gemini-2.0-flash")
TOUR_MODEL  = os.getenv("TOUR_MODEL",  "gemini-2.0-flash")

# Prompt sent to Gemini Vision for each page
PAGE_PARSE_PROMPT = """\
You are analyzing a page from a research paper PDF. Return ONLY valid JSON — no markdown fences, no explanation.

JSON schema:
{
  "page_text": "<full readable text from this page, preserving paragraph breaks>",
  "figures": [
    {
      "id": "<short id derived from caption, e.g. fig1, fig2, table1, table2>",
      "label": "<full caption text, e.g. 'Figure 1: The proposed architecture...'>",
      "bbox": {"x": 0.0, "y": 0.0, "w": 0.0, "h": 0.0}
    }
  ],
  "section_title": "<title of the section starting on this page, or null>"
}

bbox values are fractional (0–1) relative to page width/height (x=left, y=top, w=width, h=height).

Detect ALL visual elements on this page: figures, plots, charts, diagrams, images, tables, and algorithms.
- Derive the id from its caption: "Figure 3" → "fig3", "Table 2" → "table2", "Algorithm 1" → "alg1".
- If no caption is visible, assign sequential ids: fig1, fig2, ...
- Include the full caption text in "label" (everything from "Figure N:" to the end of the caption sentence).
- Set bbox to cover the entire visual element including its caption.
- If this page has no figures or tables at all, return "figures": [].
"""

TITLE_ABSTRACT_PROMPT = """\
Given this text from the first page of a research paper, extract the title and abstract.
Return ONLY valid JSON:
{
  "title": "<paper title>",
  "abstract": "<abstract text, or first paragraph if no explicit abstract>"
}
"""


@dataclass
class FigureBBox:
    id: str
    label: str
    page: int
    bbox: dict[str, float]  # x, y, w, h in fractional coords


@dataclass
class PageChunk:
    page: int
    text: str
    section_title: str | None


@dataclass
class ParsedPaper:
    title: str
    abstract: str
    page_count: int
    pages: list[PageChunk]
    figures: list[FigureBBox]
    full_text: str = field(default="", init=False)

    def __post_init__(self) -> None:
        self.full_text = "\n\n".join(
            f"[Page {p.page + 1}]\n{p.text}" for p in self.pages
        )


def _page_to_png_bytes(page: fitz.Page, dpi: int = 150) -> bytes:
    mat = fitz.Matrix(dpi / 72, dpi / 72)
    pix = page.get_pixmap(matrix=mat, colorspace=fitz.csRGB)
    img = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def _call_gemini_vision(client: genai.Client, image_bytes: bytes, prompt: str) -> str:
    part = types.Part.from_bytes(data=image_bytes, mime_type="image/png")
    response = client.models.generate_content(
        model=PARSE_MODEL,
        contents=[prompt, part],
        config=types.GenerateContentConfig(
            temperature=0.0,
            response_mime_type="application/json",
        ),
    )
    return response.text or "{}"


def _parse_json_safe(text: str) -> dict[str, Any]:
    text = text.strip()
    if text.startswith("```"):
        lines = text.split("\n")
        text = "\n".join(lines[1:-1]) if len(lines) > 2 else text
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        logger.warning("Failed to parse JSON from Gemini response: %s", text[:200])
        return {}


def _extract_figures_from_text(doc: fitz.Document) -> list[FigureBBox]:
    """
    Fallback: scan text blocks for caption patterns like 'Figure 1:' / 'Table 2'.

    Column-aware: infers whether the figure is full-width, left-column, or right-column
    from the caption position, then scans upward to find where body text ends above
    the figure rather than using a fixed percentage offset.
    """
    seen: set[str] = set()
    figures: list[FigureBBox] = []

    for page_num in range(len(doc)):
        page = doc[page_num]
        pw, ph = page.rect.width, page.rect.height
        if pw == 0 or ph == 0:
            continue

        # Collect text blocks sorted top-to-bottom
        raw = page.get_text("blocks")
        text_blocks = sorted(
            [(b[0], b[1], b[2], b[3], b[4].strip()) for b in raw if b[6] == 0 and b[4].strip()],
            key=lambda b: b[1],
        )

        for idx, (cx0, cy0, cx1, cy1, text) in enumerate(text_blocks):
            m = _CAPTION_RE.match(text)
            if not m:
                continue

            prefix = m.group(1).lower().rstrip(".")
            num = m.group(2)
            if prefix in ("figure", "fig"):
                fid = f"fig{num}"
            elif prefix == "table":
                fid = f"table{num}"
            elif prefix in ("algorithm", "alg"):
                fid = f"alg{num}"
            else:
                fid = f"{prefix}{num}"

            if fid in seen:
                continue
            seen.add(fid)

            cap_cx = (cx0 + cx1) / 2
            cap_w  = cx1 - cx0

            # Determine column layout from caption position + width
            if cap_w > pw * 0.6:
                # Full-width caption → full-width figure
                col_x0, col_x1 = 0.0, float(pw)
            elif cap_cx < pw * 0.5:
                # Left column
                col_x0, col_x1 = 0.0, pw * 0.52
            else:
                # Right column
                col_x0, col_x1 = pw * 0.48, float(pw)

            # Estimate figure top: scan upward for the nearest wide body-text block
            # (body text spans ≥75% of the column; narrower blocks are figure labels).
            # Fall back to a generous 40% page-height offset so image/drawing
            # refinement can snap to the real top.
            col_w = col_x1 - col_x0
            fig_top = max(0.0, cy0 - ph * 0.40)
            for px0, py0, px1, py1, _ in reversed(text_blocks[:idx]):
                if py1 >= cy0:
                    continue  # not above caption
                p_cx = (px0 + px1) / 2
                # Skip blocks in the other column (for two-column layout)
                if cap_w <= pw * 0.6:
                    if cap_cx < pw * 0.5 and p_cx >= pw * 0.55:
                        continue
                    if cap_cx >= pw * 0.5 and p_cx <= pw * 0.45:
                        continue
                # Only stop at wide body-text blocks (≥75% of column width)
                if (px1 - px0) < col_w * 0.75:
                    continue
                fig_top = py1
                break

            figures.append(FigureBBox(
                id=fid,
                label=text[:300],
                page=page_num,
                bbox={
                    "x": col_x0 / pw,
                    "y": fig_top / ph,
                    "w": (col_x1 - col_x0) / pw,
                    "h": (cy1 - fig_top) / ph,
                },
            ))

    return figures


def _refine_bboxes_with_images(doc: fitz.Document, figures: list[FigureBBox]) -> None:
    """
    Refine figure bboxes using the union of all embedded raster images whose area
    overlaps significantly with the estimated column bbox.

    Unioning (instead of snapping to the best match) correctly handles figures that
    contain multiple small images (e.g. architecture diagrams with photo patches).
    Tiny images (< 20 pt in either dimension) are ignored to avoid logos/watermarks.
    The original bottom boundary is preserved so the caption stays included.
    """
    for fig in figures:
        page = doc[fig.page]
        pw, ph = page.rect.width, page.rect.height
        if pw == 0 or ph == 0:
            continue

        fx0 = fig.bbox["x"] * pw
        fy0 = fig.bbox["y"] * ph
        fx1 = (fig.bbox["x"] + fig.bbox["w"]) * pw
        fy1 = (fig.bbox["y"] + fig.bbox["h"]) * ph
        fig_rect = fitz.Rect(fx0, fy0, fx1, fy1)

        overlapping: list[fitz.Rect] = []
        for img_info in page.get_images(full=True):
            xref = img_info[0]
            try:
                for r in page.get_image_rects(xref):
                    if r.is_empty:
                        continue
                    # Ignore tiny images (icons, watermarks, bullet glyphs)
                    if (r.x1 - r.x0) < 20 or (r.y1 - r.y0) < 20:
                        continue
                    inter = fig_rect & r
                    if inter.is_empty:
                        continue
                    # Include if ≥15% of the image itself falls inside the figure region
                    if inter.get_area() / r.get_area() >= 0.15:
                        overlapping.append(r)
            except Exception:
                pass

        if not overlapping:
            continue

        ux0 = min(r.x0 for r in overlapping)
        uy0 = min(r.y0 for r in overlapping)
        ux1 = max(r.x1 for r in overlapping)
        uy1 = max(r.y1 for r in overlapping)

        fig.bbox = {
            "x": ux0 / pw,
            "y": uy0 / ph,
            "w": (ux1 - ux0) / pw,
            # extend bottom to include caption; never shrink below image union
            "h": (max(fy1, uy1) - uy0) / ph,
        }


def _refine_bboxes_with_drawings(doc: fitz.Document, figures: list[FigureBBox]) -> None:
    """
    Tighten the top (and optionally sides) of each figure bbox using vector drawing paths.
    This handles plots/diagrams that contain no raster images (pure PDF vector graphics).
    We only pull the top boundary upward — never shrink width or push bottom down —
    so this step is safe to run after image-based refinement.
    """
    for fig in figures:
        page = doc[fig.page]
        pw, ph = page.rect.width, page.rect.height
        if pw == 0 or ph == 0:
            continue

        fx0 = fig.bbox["x"] * pw
        fy0 = fig.bbox["y"] * ph
        fx1 = (fig.bbox["x"] + fig.bbox["w"]) * pw
        fy1 = (fig.bbox["y"] + fig.bbox["h"]) * ph
        fig_rect = fitz.Rect(fx0, fy0, fx1, fy1)

        top_candidates: list[float] = []
        for path in page.get_drawings():
            r = path.get("rect")
            if not r or r.is_empty:
                continue
            # Skip degenerate thin rules (column separators, underlines, table borders)
            if (r.x1 - r.x0) < 4 or (r.y1 - r.y0) < 4:
                continue
            inter = fig_rect & r
            if inter.is_empty:
                continue
            # Include path if ≥50% of it falls inside the figure region
            if inter.get_area() / r.get_area() >= 0.50:
                top_candidates.append(r.y0)

        if not top_candidates:
            continue

        new_top = min(top_candidates)
        if new_top < fy0:
            # Drawings extend above the current estimated top → pull bbox up
            fig.bbox["y"] = new_top / ph
            fig.bbox["h"] = (fy1 - new_top) / ph


def _parse_pdf_sync(pdf_bytes: bytes) -> ParsedPaper:
    """Synchronous PDF parsing — runs in a thread via asyncio.to_thread."""
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise RuntimeError("GEMINI_API_KEY not set")

    client = genai.Client(api_key=api_key)
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    page_count = len(doc)

    pages: list[PageChunk] = []
    figures: list[FigureBBox] = []
    title = "Untitled Paper"
    abstract = ""

    for page_num in range(page_count):
        page = doc[page_num]
        image_bytes = _page_to_png_bytes(page)

        try:
            raw = _call_gemini_vision(client, image_bytes, PAGE_PARSE_PROMPT)
            data = _parse_json_safe(raw)
        except Exception as exc:
            logger.warning("Gemini Vision failed for page %d: %s", page_num, exc)
            data = {"page_text": page.get_text(), "figures": [], "section_title": None}

        page_text = data.get("page_text") or page.get_text()
        section_title = data.get("section_title")
        pages.append(PageChunk(page=page_num, text=page_text, section_title=section_title))

        for fig in data.get("figures", []):
            figures.append(
                FigureBBox(
                    id=fig.get("id", f"fig{len(figures) + 1}"),
                    label=fig.get("label", ""),
                    page=page_num,
                    bbox=fig.get("bbox", {"x": 0, "y": 0, "w": 1, "h": 0.3}),
                )
            )

        # Extract title + abstract from first page
        if page_num == 0 and page_text:
            try:
                ta_raw = _call_gemini_vision(
                    client,
                    image_bytes,
                    TITLE_ABSTRACT_PROMPT + f"\n\nPage text:\n{page_text[:2000]}",
                )
                ta = _parse_json_safe(ta_raw)
                title = ta.get("title", title)
                abstract = ta.get("abstract", abstract)
            except Exception as exc:
                logger.warning("Title/abstract extraction failed: %s", exc)

    # If Gemini Vision found no figures, fall back to text-based caption detection
    if not figures:
        logger.info("Gemini found no figures; trying text-based caption fallback")
        figures = _extract_figures_from_text(doc)
        logger.info("Caption fallback found %d figures", len(figures))

    # Refine bboxes: raster images first, then vector drawing paths
    _refine_bboxes_with_images(doc, figures)
    _refine_bboxes_with_drawings(doc, figures)

    doc.close()
    return ParsedPaper(
        title=title,
        abstract=abstract,
        page_count=page_count,
        pages=pages,
        figures=figures,
    )


async def parse_pdf(pdf_bytes: bytes) -> ParsedPaper:
    """
    Parse a PDF and return structured page chunks + figure bounding boxes.
    Runs synchronous Gemini Vision calls in a thread pool to avoid blocking the event loop.
    """
    return await asyncio.to_thread(_parse_pdf_sync, pdf_bytes)


def build_system_prompt(paper: ParsedPaper) -> str:
    """Build the system prompt for Gemini Live API with paper context."""
    figure_index = "\n".join(
        f"- {f.id} (page {f.page + 1}): {f.label}" for f in paper.figures
    ) or "No figures detected."

    # Keep context under ~8k tokens — use abstract + truncated full text
    context_text = paper.full_text
    if len(context_text) > 20000:
        context_text = context_text[:20000] + "\n...[truncated]"

    return f"""\
You are PaperPal — a voice-native research paper companion. The user has uploaded a paper and is reading it while talking to you.

## Paper
Title: {paper.title}
Abstract: {abstract_snippet(paper.abstract)}

## Full Text (per page)
{context_text}

## Figure Index
{figure_index}

## Response Format
ALWAYS respond with a single JSON object — no markdown fences, no extra keys:
{{"speech": "<what you say aloud>", "command": "<command_string>"}}

## Available Commands
  next_page                    — Go to next page
  prev_page                    — Go to previous page
  go_page <n>                  — Jump to page n (1-indexed, e.g. go_page 5)
  show_link <id>               — Preview figure, table, or link destination (e.g. show_link fig1  or  show_link p12)
  highlight <color>            — Add highlight to current page/selection
                                 color must be one of: agree | disagree | comment | question | definition | other
  none                         — No navigation action needed

## Examples
User: "next page" → {{"speech": "Going to next page.", "command": "next_page"}}
User: "go to page 5" → {{"speech": "Jumping to page 5.", "command": "go_page 5"}}
User: "show figure 3" → {{"speech": "Here's figure 3.", "command": "show_link fig3"}}
User: "what's reference 13" → {{"speech": "Here's reference 13.", "command": "show_link ref13"}}
User: "highlight this as a definition" → {{"speech": "Highlighted.", "command": "highlight definition"}}
User: "mark as agree" → {{"speech": "Marked.", "command": "highlight agree"}}
User: "what does attention mean here?" → {{"speech": "Attention in transformers...", "command": "none"}}

## Intent Mapping (fuzzy — infer)
- "next / forward / continue" → next_page
- "back / previous / go back" → prev_page
- "page N / jump to N" → go_page N
- "figure N / table N" → show_link figN or show_link tableN
- "reference N / citation N / [N]" → show_link refN
- "interesting / agree / disagree / definition / question / comment / follow up" → highlight <matching color>
- Anything conversational → none

Be natural and concise — responses are heard, not read. Under 3 sentences unless explaining something complex.
"""


def abstract_snippet(abstract: str, max_chars: int = 500) -> str:
    if len(abstract) <= max_chars:
        return abstract
    return abstract[:max_chars] + "..."


# ── Text command endpoint ──────────────────────────────────────────────────


def _run_command_sync(
    user_message: str, system_prompt: str, current_page: int, page_count: int
) -> dict[str, Any]:
    """Call Gemini text API with the paper system prompt + user command."""
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        return {"speech": "API key not configured.", "action": {"type": "NONE"}}

    client = genai.Client(api_key=api_key)
    enriched = (
        f"[Context: user is on page {current_page} of {page_count}]\n"
        f"User: {user_message}"
    )

    response = client.models.generate_content(
        model=PARSE_MODEL,
        contents=system_prompt + "\n\n" + enriched,
        config=types.GenerateContentConfig(
            temperature=0.3,
            response_mime_type="application/json",
        ),
    )

    text = (response.text or "").strip()
    data = _parse_json_safe(text)
    return {
        "speech": data.get("speech") or "",
        "command": data.get("command") or "none",
    }


async def run_command(
    user_message: str, system_prompt: str, current_page: int, page_count: int
) -> dict[str, Any]:
    return await asyncio.to_thread(
        _run_command_sync, user_message, system_prompt, current_page, page_count
    )


# ── Tour generation ──────────────────────────────────────────────────────────

_TOUR_PROMPT = """\
{system_prompt}

---
You are creating a {duration} narrated guided tour of the paper above.

Generate a narration of approximately {word_count} words (≈{duration} at 150 words/minute) that covers:
1. The core problem and motivation (why does this paper exist?)
2. The key method or approach
3. Main results and takeaways
4. 1–2 notable figures (if available)

Also generate a timeline of viewer commands that fire as the narration plays.

Available figures:
{figure_list}

Available reference IDs: {link_list}

Output ONLY valid JSON — no markdown, no code fences:
{{
  "narration": "<full narration text, ~{word_count} words>",
  "timeline": [
    {{
      "at_char": 0,
      "cmd": "go_page 1"
    }}
  ]
}}

Timeline rules:
- at_char is the 0-based character index in narration where this command fires (must be ≥ 0 and < len(narration))
- Multiple commands at the same at_char are allowed (list them as separate objects)
- Available commands:
    go_page <n>                       — navigate to page n (1-indexed)
    show_link <id>                    — pop up a figure or reference preview (use figure IDs from list above)
    highlight <color> "<text>" <page> — suggest a highlight (page is 1-indexed)
      color must be one of: agree | disagree | comment | question | definition | other
      text should be a short phrase (3–8 words) from or about the paper
- Include 3–5 highlight suggestions spread across the narration
- Include show_link for 1–3 figures if they exist
- Navigate to relevant pages as you narrate them (start with go_page 1)
- Use "definition" for key terms/concepts, "comment" for interesting points, "question" for open questions, "agree" for strong results
- First event must be {{"at_char": 0, "cmd": "go_page 1"}}
"""


def _generate_tour_sync(
    system_prompt: str,
    duration: str,
    figures: list[dict],
    pdf_links: list[dict],
) -> dict[str, Any]:
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise RuntimeError("GEMINI_API_KEY not set")

    client = genai.Client(api_key=api_key)

    word_count = 150 if duration == "1min" else 300
    figure_list = "\n".join(
        f"  - {f['id']} (page {f['page'] + 1}): {str(f.get('label', ''))[:80]}"
        for f in figures[:20]
    ) or "  (none detected)"
    link_list = ", ".join(
        f"{l['id']} (p.{l['destPage'] + 1})" for l in pdf_links[:15]
    ) or "(none)"

    prompt = _TOUR_PROMPT.format(
        system_prompt=system_prompt,
        duration=duration,
        word_count=word_count,
        figure_list=figure_list,
        link_list=link_list,
    )

    response = client.models.generate_content(
        model=TOUR_MODEL,
        contents=prompt,
        config=types.GenerateContentConfig(
            temperature=0.5,
            response_mime_type="application/json",
        ),
    )

    data = _parse_json_safe((response.text or "").strip())
    narration: str = data.get("narration") or ""
    raw_timeline: list = data.get("timeline") or []

    # Validate and clamp at_char values
    n_len = max(1, len(narration))
    timeline = []
    for event in raw_timeline:
        at_char = event.get("at_char")
        cmd = str(event.get("cmd") or "").strip()
        if isinstance(at_char, (int, float)) and cmd:
            timeline.append({"at_char": max(0, min(int(at_char), n_len - 1)), "cmd": cmd})

    timeline.sort(key=lambda e: e["at_char"])
    return {"narration": narration, "timeline": timeline}


async def generate_tour(
    system_prompt: str,
    duration: str,
    figures: list[dict],
    pdf_links: list[dict],
) -> dict[str, Any]:
    return await asyncio.to_thread(
        _generate_tour_sync, system_prompt, duration, figures, pdf_links
    )
