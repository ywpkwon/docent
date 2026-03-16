<p align="center">
<img width="120" alt="docent" src="https://github.com/user-attachments/assets/5633c616-6567-42e6-983f-8224a85e74b0" />
</p>

# Docent

> Absorb a paper as fast as possible. Remember just enough of it.

Most of us aren't full-time researchers. We can't spend hours on careful literature reviews for every paper that drops. But we still need to stay current.

Docent is a PDF reader built for **skimming with intent** — quick absorption, minimal friction, and a direct path to your note system. It's keyboard-driven, voice-capable, and designed to integrate with Zotero and Obsidian.

<!-- screenshots here -->

---

## Why Docent

There are already good PDF readers. There are writing assistants. But most tools are built for deep reading or writing.

Docent is built around a different workflow: what if instead of highlighting for yourself, an agent does the first pass for you — like a labmate who's already read the paper and walks you through it?

A human labmate can freely reorganize a paper — new analogies, new structure, their own framing. That's powerful for learning, but it drifts from the source.

Docent takes a more grounded approach. It first identifies the core paragraphs worth your attention, then builds its guided tour from those passages directly. The narration stays anchored in the actual text — not a free paraphrase of the whole paper.

This is a deliberate constraint. The highlights you see during the tour correspond to real passages you can return to later — for quick skimming, for memory, for verification. It's less like a lecture and more like a curated read-along: someone pointing at the page and saying *"this part, and this part, and this part."*

---

## Features

- **Guided tour** — AI-narrated walkthrough that highlights core passages live as it reads, with figures popping up when referenced
- **Voice interaction** — interrupt the tour, ask about references, query any parsed element
- **Smart link previews** — Shift-click any link to open a floating preview without losing your place; Docent resolves opaque link IDs (e.g. `citeSEF`) to actual reference numbers and figure labels
- **Quick-link panel (`f`)** — every parsed element (figures, tables, sections, references) with live previews, queryable directly
- **Highlight panel (`h`)** — traversable list of all highlights; edit, recolor, or remove any of them
- **Region inspector (`d`)** — visualize parsed regions; manually adjust any detection that isn't quite right
- **Obsidian / Zotero export** — clean path from skimming to your note system
- **Keyboard-driven** — vim-style bindings and a command bar (`:`) throughout

---

## Getting Started

### Prerequisites

- Node.js 18+
- Python 3.11+
- A [Gemini API key](https://aistudio.google.com/app/apikey)

### Setup

```bash
git clone https://github.com/yourname/docent
cd docent

cp .env.example .env
# Add your GEMINI_API_KEY to .env

./start-dev.sh
```

Open [http://localhost:3000](http://localhost:3000).

### Environment variables

| Variable | Description |
|---|---|
| `GEMINI_API_KEY` | Required. Used for PDF parsing, tour generation, and voice |
| `TOUR_MODEL` | Optional. Defaults to `gemini-2.0-flash` |

---

## Usage

### Basic navigation

| Key | Action |
|---|---|
| `j` / `k` | Next / previous page |
| `g` + number | Go to page |
| Shift-click link | Floating link preview |
| Backspace | Navigate back |
| `c` | Close document |

### Guided tour

| Key | Action |
|---|---|
| `T` | Analyze paper — identifies core passages |
| `t` | Build and start guided tour (choose duration) |
| `` ` `` | Toggle tour plan panel |

### Highlights & notes

| Key | Action |
|---|---|
| `h` | Open highlight browser (filter, preview, navigate) |
| `H` or `p` | Preferences — color scheme, highlight settings |

### Document navigation

| Key | Action |
|---|---|
| `f` | Quick-link panel — figures, sections, references |
| `d` | Toggle parsed region overlay |
| `:` | Command bar |
| `m` | Toggle voice |

---

## Stack

- **Frontend** — Next.js 14 App Router, PDF.js
- **Backend** — Python FastAPI
- **AI** — Gemini 2.0 Flash (parsing + tour), Gemini Live API (voice)
- **Voice** — browser AudioWorklet → backend WebSocket → Gemini Live

---

## License

MIT
