/**
 * Post-process raw DOMRects from a text selection range.
 *
 * Problems with PDF.js text layers and getClientRects():
 *   - One rect per span fragment (each word/token is its own <span>)
 *   - "markedContent" nested spans without --scale-factor produce garbage rects at 0,0
 *   - Subscript/superscript spans have different heights than body text
 *   - Whitespace-only spans produce hairline rects between lines
 *
 * Strategy:
 *   1. Filter: drop rects that are obviously noise (too thin, or outside the page)
 *   2. Detect "body" line height via the 60th-percentile height
 *   3. Filter: drop rects shorter than 35% of body height (whitespace/artifact spans)
 *   4. Group into lines: anchor each group on its first rect's midpoint;
 *      subsequent rects join the group if their midpoint is within ±55% of the anchor height
 *   5. Merge each group into one bounding rect
 */
export function mergeSelectionRects(
  rawRects: DOMRectList | DOMRect[],
  pageRect?: DOMRect   // optional: clip to page bounds
): DOMRect[] {
  const all = Array.from(rawRects);

  // Step 1 — basic noise filter
  let valid = all.filter((r) => r.width > 1 && r.height > 2);

  // Clip to page bounds if provided (removes phantom rects from mis-positioned spans)
  if (pageRect) {
    valid = valid.filter(
      (r) =>
        r.right  > pageRect.left &&
        r.left   < pageRect.right &&
        r.bottom > pageRect.top  &&
        r.top    < pageRect.bottom
    );
  }

  if (valid.length === 0) return [];

  // Step 2 — body line height: 60th-percentile height
  const heights = valid.map((r) => r.height).sort((a, b) => a - b);
  const p60idx  = Math.min(Math.floor(heights.length * 0.6), heights.length - 1);
  const bodyH   = heights[p60idx];

  // Step 3 — drop rects far shorter than body text (subscript artifacts, hairlines)
  const MIN_RATIO = 0.35;
  const filtered = valid.filter((r) => r.height >= bodyH * MIN_RATIO);
  if (filtered.length === 0) return valid.slice(0, 1); // ultimate fallback

  // Step 4 — sort top-to-bottom, left-to-right, then group into lines
  const sorted = [...filtered].sort((a, b) => a.top - b.top || a.left - b.left);

  type Group = { anchorMid: number; anchorH: number; rects: DOMRect[] };
  const groups: Group[] = [];

  for (const rect of sorted) {
    const mid = (rect.top + rect.bottom) / 2;

    // Find a group whose anchor midpoint is within ±55% of the anchor height
    const match = groups.find(
      (g) => Math.abs(mid - g.anchorMid) <= g.anchorH * 0.55
    );

    if (match) {
      match.rects.push(rect);
      // Optionally widen the anchor slightly to absorb slight vertical drift
      match.anchorMid = match.rects.reduce((s, r) => s + (r.top + r.bottom) / 2, 0) / match.rects.length;
    } else {
      groups.push({ anchorMid: mid, anchorH: rect.height, rects: [rect] });
    }
  }

  // Step 5 — merge each group into one bounding rect
  return groups.map(({ rects }) => {
    const top    = Math.min(...rects.map((r) => r.top));
    const bottom = Math.max(...rects.map((r) => r.bottom));
    const left   = Math.min(...rects.map((r) => r.left));
    const right  = Math.max(...rects.map((r) => r.right));
    return new DOMRect(left, top, right - left, bottom - top);
  });
}
