# PaperPal — Competition Plan
> Google Cloud AI Agent Hackathon · Category: **Live Agents 🗣️**  
> Timeline: 4 days · Stack: Next.js + Gemini Live API + Cloud Run

---

## 1. Elevator Pitch

PaperPal is a voice-native research paper companion. Upload a PDF, start talking — and the paper responds. Ask it to navigate pages, pop up figures, explain concepts with analogies, and annotate as you think out loud. It listens continuously, handles interruptions, and turns your verbal reactions into a structured highlight layer you can export to Obsidian.

---

## 2. Competition Fit

| Requirement | How PaperPal satisfies it |
|---|---|
| Multimodal inputs | Voice (Live API) + PDF/image (Gemini Vision) |
| Multimodal outputs | Audio response + visual highlight overlays + figure popups |
| Beyond text-in/text-out | Continuous voice stream → visual document mutations |
| Live API / ADK | Gemini Live API for real-time audio with interruption support |
| Hosted on Google Cloud | Deployed to Cloud Run |

---

## 3. Core Features (MVP — must ship)

### 3.1 PDF Viewer
- Render PDF in-browser (PDF.js)
- Page state managed in frontend
- Figure/table bounding box extraction on upload (Gemini Vision pass)

### 3.2 Gemini Live API Voice Loop
- Continuous microphone stream → Live API
- Interruptible: user can cut off mid-response
- System prompt gives Gemini full paper context (chunked text + figure index)
- Gemini responds with structured JSON actions + spoken audio simultaneously

### 3.3 Voice Command → Action Mapping

| Voice phrase (fuzzy) | Action |
|---|---|
| "next page" / "go back" | Page navigation |
| "show me figure 3" / "what's in figure 1" | Figure popup (bounding box crop) |
| "hmm, that's interesting" / "interesting" | Yellow highlight on current paragraph |
| "follow up on this" / "remind me later" | Purple highlight |
| "this is a definition" / "define" | Red highlight |
| "explain this" / "what does this mean" | Gemini explains current paragraph + analogy |
| "read this section" | TTS reading of current visible text |
| "summarize" | Section summary spoken aloud |

Intent parsing is done **inside** the Live API response — Gemini returns a JSON envelope:
```json
{
  "speech": "Sure, Figure 3 shows the attention mechanism...",
  "action": { "type": "SHOW_FIGURE", "figure_id": "fig3" }
}
```

### 3.4 Highlight Layer
- Highlights stored as: `{ page, paragraphIndex, color, text, timestamp }`
- Rendered as colored overlays on PDF canvas
- Persists in-session (localStorage fallback, ideally a lightweight DB)

### 3.5 Audio Reading Support
- Gemini Live API handles TTS natively
- "Read this aloud" command triggers reading of selected/visible text
- Interruptible mid-read

---

## 4. Stretch Features (ship if time allows, cut if not)

| Feature | Effort | Value |
|---|---|---|
| Obsidian export | Low (markdown formatter) | High (differentiator) |
| Analogy engine ("explain like I'm an undergrad") | Low (prompt tuning) | High |
| Cross-paper Q&A (multi-PDF upload) | High | Medium |
| Highlight timeline / session replay | Medium | Medium |
| Shareable highlight export (JSON/CSV) | Low | Medium |

**Obsidian export format:**
```markdown
## Highlights — {{paper_title}}
### 🟡 Interesting
- p.3: "The attention mechanism scales quadratically..."

### 🟣 Follow Up
- p.7: "See Vaswani et al. for proof of convergence..."

### 🔴 Definitions
- p.2: "Transformer: a model architecture relying solely on attention..."
```

---

## 5. Tech Stack

```
Frontend          Next.js 14 (App Router) + Tailwind
PDF Rendering     PDF.js (pdfjs-dist)
Voice             Gemini Live API (WebSocket stream from browser)
Vision/NLP        Gemini 1.5 Pro (PDF parsing pass on upload)
Backend           Next.js API routes (thin — most logic is client→Gemini)
Hosting           Google Cloud Run (containerized Next.js)
Auth              None for hackathon (single-user mode)
Storage           In-memory + localStorage (no DB needed for MVP)
```

---

## 6. Architecture

```
Browser
  ├── PDF.js viewer (canvas render)
  ├── Highlight overlay (SVG/canvas layer)
  ├── Figure popup modal
  └── Voice controller
        │
        ├──[mic stream]──→ Gemini Live API (WebSocket)
        │                        │
        │                   returns { speech, action }
        │                        │
        └──[action dispatcher]───┘
              ├── PAGE_NAV → update page state
              ├── SHOW_FIGURE → open popup with cropped image
              ├── HIGHLIGHT → add highlight to overlay
              └── SPEAK → audio plays via Live API TTS

Upload flow:
  PDF upload → /api/parse → Gemini Vision
    → extract: text chunks per page, figure bounding boxes, title/abstract
    → store in session context (fed to Live API system prompt)
```

---

## 7. Day-by-Day Schedule

### Day 1 — Foundation
- [ ] Scaffold Next.js project, Tailwind, folder structure
- [ ] PDF.js integration — render PDF, page navigation working
- [ ] Gemini Live API connection — mic → WebSocket → audio response in browser
- [ ] Basic voice loop: say anything, get spoken response about the paper
- [ ] Upload → Gemini Vision parse → store text chunks in context

**End of Day 1 goal:** Upload a PDF, ask "what's this paper about?", get a spoken answer.

### Day 2 — Voice Commands + Figures
- [ ] JSON action envelope in Live API system prompt
- [ ] Action dispatcher in frontend
- [ ] PAGE_NAV command working ("next page", "go to page 5")
- [ ] Figure bounding box extraction on upload
- [ ] SHOW_FIGURE command → popup with cropped figure image
- [ ] Interruption handling (cut off Gemini mid-sentence)

**End of Day 2 goal:** Navigate paper by voice, pop up figures by name.

### Day 3 — Highlights + Polish
- [ ] Paragraph detection per page (bounding box → index mapping)
- [ ] HIGHLIGHT action → colored overlay on correct paragraph
- [ ] All three highlight colors working (yellow/purple/red)
- [ ] "Read this aloud" TTS command
- [ ] "Explain this" with analogy prompt
- [ ] Basic UI polish (viewer layout, status indicator for listening state)

**End of Day 3 goal:** Full demo loop working end-to-end.

### Day 4 — Deploy + Demo
- [ ] Dockerize Next.js app
- [ ] Deploy to Cloud Run, test in production
- [ ] Obsidian export (stretch — markdown download button)
- [ ] Record demo video (3–5 min walkthrough with a real paper)
- [ ] Write README and submission copy
- [ ] Bugfix buffer

---

## 8. Key Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Gemini Live API latency makes voice feel laggy | Add "thinking" audio cue; show waveform animation |
| PDF figure bounding box extraction is inaccurate | Fall back to page-level figure crop if bbox fails |
| Action JSON parsing fails mid-stream | Wrap in try/catch; fall back to pure speech response |
| Cloud Run cold starts slow | Set min-instances=1 for demo |
| 4 days not enough for Obsidian | Cut it — highlights JSON export is sufficient |

---

## 9. Demo Script (for submission video)

1. Open app, upload a real ML paper (e.g., Attention is All You Need)
2. Ask: *"What's this paper about?"* → spoken summary
3. Say: *"Go to page 3"* → navigates
4. Say: *"Show me figure 1"* → attention diagram pops up
5. Say: *"Hmm, that's interesting"* → yellow highlight appears
6. Say: *"This is a definition"* on the Transformer definition → red highlight
7. Say: *"Explain the multi-head attention like I'm new to this"* → spoken analogy
8. Say: *"Follow up on this later"* → purple highlight
9. Download Obsidian export → show the markdown file

---

## 10. Judging Criteria Alignment

Most competitions in this space judge on: **technical complexity, creativity, usefulness, and polish.**

- **Technical**: Live API + Vision + real-time action dispatch is genuinely non-trivial
- **Creative**: Voice → highlight color mapping is novel and memorable
- **Useful**: Directly solves a real pain point for researchers and students
- **Polish**: A clean demo with a real paper > a flashy demo with fake data
