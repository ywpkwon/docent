#!/usr/bin/env python3
"""
Render detected figure bboxes onto page thumbnails + save individual crops.

Usage:
    python dump_figures.py ~/Downloads/i-jepa.pdf
    python dump_figures.py ~/Downloads/i-jepa.pdf --no-gemini   # skip Gemini, use text fallback only
    python dump_figures.py ~/Downloads/i-jepa.pdf --out /tmp/figs
"""
from __future__ import annotations

import argparse
import asyncio
import os
import sys
from pathlib import Path

import fitz
from dotenv import load_dotenv
from PIL import Image, ImageDraw, ImageFont

load_dotenv()

sys.path.insert(0, str(Path(__file__).parent))


def render(pdf_path: str, use_gemini: bool, out_dir: str) -> None:
    from parse import FigureBBox, _extract_figures_from_text, _refine_bboxes_with_images

    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)

    pdf_bytes = Path(pdf_path).expanduser().read_bytes()
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")

    figures: list[FigureBBox] = []

    if use_gemini and os.getenv("GEMINI_API_KEY"):
        print("Running Gemini Vision figure extraction …")
        from parse import parse_pdf
        paper = asyncio.run(parse_pdf(pdf_bytes))
        figures = paper.figures
        print(f"  Gemini found {len(figures)} figure(s)")
    else:
        print("Skipping Gemini (--no-gemini or no API key)")

    if not figures:
        print("Running text-based caption fallback …")
        figures = _extract_figures_from_text(doc)
        print(f"  Caption fallback found {len(figures)} figure(s)")

    print("Refining bboxes with PyMuPDF image rects …")
    _refine_bboxes_with_images(doc, figures)

    # ── per-page overlay images ────────────────────────────────────────────
    SCALE = 1.5
    COLORS = ["#e74c3c", "#2ecc71", "#3498db", "#f39c12", "#9b59b6",
              "#1abc9c", "#e67e22", "#e91e63"]

    # group figures by page
    by_page: dict[int, list[FigureBBox]] = {}
    for fig in figures:
        by_page.setdefault(fig.page, []).append(fig)

    for page_num in range(len(doc)):
        page = doc[page_num]
        mat = fitz.Matrix(SCALE, SCALE)
        pix = page.get_pixmap(matrix=mat)
        img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
        draw = ImageDraw.Draw(img)

        for i, fig in enumerate(by_page.get(page_num, [])):
            color = COLORS[i % len(COLORS)]
            x0 = fig.bbox["x"] * pix.width
            y0 = fig.bbox["y"] * pix.height
            x1 = (fig.bbox["x"] + fig.bbox["w"]) * pix.width
            y1 = (fig.bbox["y"] + fig.bbox["h"]) * pix.height
            draw.rectangle([x0, y0, x1, y1], outline=color, width=3)
            draw.rectangle([x0, y0, x0 + 6 * len(fig.id) + 8, y0 + 18], fill=color)
            draw.text((x0 + 4, y0 + 2), fig.id, fill="white")

        page_out = out / f"page_{page_num + 1:02d}_overlay.png"
        img.save(page_out)
        if page_num in by_page:
            print(f"  p.{page_num+1}: {[f.id for f in by_page[page_num]]}  → {page_out}")

    # ── individual crops ───────────────────────────────────────────────────
    crops_dir = out / "crops"
    crops_dir.mkdir(exist_ok=True)
    for fig in figures:
        page = doc[fig.page]
        pw, ph = page.rect.width, page.rect.height
        clip = fitz.Rect(
            fig.bbox["x"] * pw,
            fig.bbox["y"] * ph,
            (fig.bbox["x"] + fig.bbox["w"]) * pw,
            (fig.bbox["y"] + fig.bbox["h"]) * ph,
        ).intersect(page.rect)
        if clip.is_empty:
            print(f"  WARNING: {fig.id} on p.{fig.page+1} has empty/off-page bbox {fig.bbox}")
            continue
        mat = fitz.Matrix(2, 2)
        pix = page.get_pixmap(matrix=mat, clip=clip)
        crop_path = crops_dir / f"p{fig.page + 1:02d}_{fig.id}.png"
        pix.save(str(crop_path))

    doc.close()
    print(f"\nDone. {len(figures)} figure(s) written to {out}/")
    print(f"  Overlays : {out}/page_NN_overlay.png")
    print(f"  Crops    : {out}/crops/")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("pdf", help="Path to PDF file")
    ap.add_argument("--no-gemini", action="store_true", help="Skip Gemini, use text fallback only")
    ap.add_argument("--out", default="/tmp/paperpal_figures", help="Output directory")
    args = ap.parse_args()
    render(args.pdf, use_gemini=not args.no_gemini, out_dir=args.out)
