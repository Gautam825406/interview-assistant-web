# Interview Assistant — Real-Time AI Interview Helper (Web)

Parakeet-style real-time AI interview assistant as a **standalone static website**.
No backend, no database, no API key required. All data lives in the visitor's
browser (`localStorage`).

## What it does

- **Landing / hero** like Parakeet: real-time AI interview assistant, features,
  display-only pricing (Weekly $78, Monthly $149.90, Yearly $49.99/mo), FAQ
- **Dashboard** — Call Sessions with search and All / Interview / Regular / Mock filters
- **Create session** — Interview / Regular-call mode, company, role, language,
  resume (paste text, or upload `.txt` / `.pdf` — PDF text is extracted in the
  browser with pdf.js), job description / instructions up to 20,000 chars
- **Live session** — mic via browser SpeechRecognition (Chrome best) with live
  transcript, typed-question fallback, automatic question detection
  (`?` / interrogative start), Auto Answer with a short speakable answer +
  bullets and a longer version, code help, system-design help, floating
  discreet panel (minimise / small text), timer, End & Save Notes
- **Mock Interview** — AI interviewer from a local question bank tailored by
  topic, per-answer feedback, scored AI notes at the end
- **Saved sessions + AI Notes** — summary, key points, action items, 0–100 score
- **Question Bank** — company-wise (Google, Amazon, Microsoft, Flipkart,
  TCS/Infosys, GenAI roles); tap a question to send it to the Live session
- **Settings** — optional Groq key for real answers via `openai/gpt-oss-120b`
  (stored only in localStorage, never committed), plus saved resume/documents

Answers use a local demo answer bank (DSA, GenAI/RAG/LangChain, HR, system
design, SQL, Python/FastAPI) and cite facts only when they are present in the
pasted resume — experience is never invented.

> **Honest note (also shown in the live screen):** this web version is
> **NOT invisible** in screen-share — sharing the whole screen or this browser
> window will show it. Only a native desktop app can hide from screen-share.
> Use live help only where it is permitted.

## Run locally

```bash
npm install
npm run dev      # http://localhost:5173
```

## Build

```bash
npm install
npm run build    # produces dist/ — dist/index.html is the entry point
npm run preview  # preview the production build locally
```

## Deploy to Vercel (no tokens needed from the assistant)

1. Push this folder to a GitHub repo (see “Files to push” below).
2. In Vercel: **Add New → Project → Import** the repo.
3. Vercel detects Vite automatically (`vercel.json` also sets it):
   - Framework Preset: **Vite**
   - Build Command: `npm run build`
   - Output Directory: `dist`
   - Install Command: `npm install`
4. Click **Deploy**. No environment variables are required.
   (Optional: none — the Groq key is entered by each user in Settings, in
   their own browser, and is never stored on the server.)

## Files to push to GitHub

Push the whole folder **except** `node_modules/` and `dist/` (both are in
`.gitignore` — Vercel builds them fresh):

```
interview-assistant-web/
├── package.json
├── vite.config.js
├── vercel.json
├── .gitignore
├── README.md
├── index.html
└── src/
    ├── main.js
    ├── demo-bank.js
    └── style.css
```

Do **not** push `node_modules/` or `dist/`.

## Stack

- Vite 6 + vanilla JS (ES modules), no framework, no backend
- `pdfjs-dist` for in-browser PDF text extraction
- `localStorage` for sessions, resume, documents and settings

## Limits

- Live speech recognition needs Chrome (desktop) and a microphone; typed
  questions always work as a fallback.
- Browser tab-audio capture (Meet/Zoom in the browser) shows a live level
  meter; the browser cannot transcribe another tab's audio directly, so the
  mic / typed question is the reliable path.
- True system-audio capture from the Zoom desktop app needs a virtual audio
  driver and a desktop app — out of scope for this static site.
- Not affiliated with Parakeet AI.
