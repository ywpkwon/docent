# FIXME

## Highlight rect height mismatch: analysis vs mouse-drag

**Symptom**: Tour plan highlights (created via `searchTextRects` in `PDFViewer.tsx`) have visibly different
height than manually dragged highlights. Drag rects appear taller; analysis rects appear tighter.

**What was tried**:
- Reduced PAD from page-fraction (was causing overlap between lines)
- Split into per-line rects (matching `getClientRects()` line-box behavior)
- Tuned ASCENT/DESCENT fractions (0.91 → 1.0)
- Added per-font `getAscentRatio()` via Canvas `measureText().fontBoundingBoxAscent` — same
  technique PDF.js TextLayer uses internally — to match span positioning exactly

**Theory**: PDF.js sets `line-height: 1` on `.textLayer`, so span height = `item.height`.
`getClientRects()` on a selection should return height = `item.height / pageH` (normalized),
same as our computation. Per-font ascentRatio should align the top. Analytically they should match.

**Why it still doesn't**: Unknown. Candidates:
- `TextLayer.fontFamilyMap` applies an additional font substitution that our Canvas measurement
  doesn't see (we use raw `textContent.styles[fontName].fontFamily`, PDF.js further remaps it)
- `textContent.items[i]` vs `streamTextContent()` stream ordering might differ slightly
- Some text items have `height = 0` and fall back to `|| 10` — investigate actual values
- Browser DPR / subpixel rounding accumulation
- `mergeSelectionRects` 60th-percentile `bodyH` filter produces different grouping than our
  `LINE_THRESH=4` baseline grouping

**Cleanest fix to try next**: After `textLayer.render()` in `PageView`, iterate `tl.querySelectorAll('span')`
and record each span's `getBoundingClientRect()` relative to the text layer container as fractional
`{top, height}`. Store alongside text items in `allPageTextRef`. Use these actual DOM-measured bounds
in `searchTextRects` instead of computing from `item.height`. This would be pixel-identical to
`getClientRects()` on a selection — same data source.

**Files**: `frontend/components/PDFViewer.tsx` — `searchTextRects()`, `getAscentRatio()`, text item
extraction in the PDF load effect (~line 960).
