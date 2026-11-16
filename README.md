# Interview Assistant — Real-Time AI Interview Helper (Web, SaaS storefront)

Parakeet-style real-time AI interview assistant as a **subscription service**.
This web app is the storefront + client for the SaaS backend
(`../interview-assistant-saas/`, FastAPI + Postgres). The backend holds all
provider API keys (Groq / OpenAI / Gemini / Claude) and proxies every AI call
— **no API key ever lives in this frontend**, and end users never enter one.

## What it does

- **Auth first** — Login / Signup tabs. JWT token in `localStorage`, sent as
  `Authorization: Bearer` on every call; 401 returns to the login screen.
  First registered user becomes the service admin.
- **Landing / hero** — glassmorphism redesign, live plans strip from the API
- **Pricing** — renders `GET /api/plans` from the backend. Subscribe →
  `POST /api/subscriptions/checkout` → Cashfree JS SDK (sandbox or prod script
  per the `mode` the backend returns) → payment verified via
  `GET /api/subscriptions/verify` and the plan activates. Amounts always come
  from the DB plan, never from the client.
- **Dashboard** — Call Sessions with search and All / Interview / Regular / Mock
  filters (stored per-user in `localStorage`)
- **Create session** — Interview / Regular-call mode, company, role, language,
  resume (paste text, or upload `.txt` / `.pdf` — PDF text is extracted in the
  browser with pdf.js), job description / instructions up to 20,000 chars
- **Live session** — starts with `POST /api/sessions/start` (free plan: 10
  sessions; 402 shows an upgrade prompt). Mic via browser SpeechRecognition
  (Chrome best), Meet/Zoom tab-audio capture transcribed by the service
  (`POST /api/ai/transcribe`, 5-second standalone audio chunks), screenshot
  reading via the service (`POST /api/ai/vision`), typed-question fallback,
  automatic question detection, Auto Answer via `POST /api/ai/chat` with the
  resume + JD as system context, code help, system-design help, floating
  discreet panel (minimise / small text), timer, End & Save Notes
- **Mock Interview** — starts with `POST /api/mocks/start` (free plan: 1 mock),
  then per-answer feedback + score from `POST /api/ai/chat`
- **Saved sessions + AI Notes** — summary, key points, action items, 0–100 score
- **Question Bank** — company-wise (Google, Amazon, Microsoft, Flipkart,
  TCS/Infosys, GenAI roles); tap a question to send it to the Live session
- **Settings** — account + plan + usage, AI service status, default language,
  saved resume/documents. No provider-key fields anywhere in the user UI.
- **Admin panel** (admin role only) — overview cards (users, paying users,
  revenue, AI calls), users table (change role, grant access), subscriptions
  and payments tables, plans editor (price, limits, features, active),
  AI provider keys form (password inputs, masked display, empty = unchanged).

> **Honest note (also shown in the live screen):** this web version is
> **NOT invisible** in screen-share — sharing the whole screen or this browser
> window will show it. Only a native desktop app can hide from screen-share.
> Use live help only where it is permitted.

## Run locally

```bash
npm install
# Point at a backend (defaults to https://interview-assistant-api.onrender.com):
cp .env.example .env        # then edit VITE_API_URL for a local backend
npm run dev      # http://localhost:5173
```

The backend must be running for login, plans, checkout and all AI features.
Without a backend the login screen shows a connection error.

## Build

```bash
npm install
npm run build    # produces dist/ — dist/index.html is the entry point
npm run preview  # preview the production build locally
```

## Deploy to Vercel

1. Push this folder to a GitHub repo (see “Files to push” below).
2. In Vercel: **Add New → Project → Import** the repo.
3. Vercel detects Vite automatically (`vercel.json` also sets it):
   - Framework Preset: **Vite**
   - Build Command: `npm run build`
   - Output Directory: `dist`
   - Install Command: `npm install`
4. Set the environment variable `VITE_API_URL` to the backend URL
   (e.g. `https://interview-assistant-api.onrender.com`). If unset, the app
   falls back to that same URL.
5. Click **Deploy**. No secrets are needed in the frontend — the backend holds
   the provider keys and the Cashfree keys.

## Files to push to GitHub

Push the whole folder **except** `node_modules/` and `dist/` (both are in
`.gitignore` — Vercel builds them fresh):

```
interview-assistant-web/
├── package.json
├── vite.config.js
├── vercel.json
├── .env.example
├── README.md
├── index.html
└── src/
    ├── api.js        # SaaS API client (auth, plans, checkout, AI proxy, admin)
    ├── main.js
    ├── questions.js  # question lists + question detection (no answer bank)
    └── style.css     # glassmorphism theme
```

Do **not** push `node_modules/` or `dist/`. Never put an API key in this repo.

## Stack

- Vite 6 + vanilla JS (ES modules), no framework
- `pdfjs-dist` for in-browser PDF text extraction
- `localStorage` for the JWT token + per-user sessions, resume, documents
- Cashfree JS SDK v2 loaded on demand (sandbox/prod per backend `mode`)

## Limits

- Live speech recognition needs Chrome (desktop) and a microphone; typed
  questions always work as a fallback.
- Browser tab-audio capture (Meet/Zoom in the browser) shows a live level
  meter; transcription runs on the service (Whisper).
- True system-audio capture from the Zoom desktop app needs a virtual audio
  driver and a desktop app — out of scope for this web client.
- Free plan limits are enforced server-side: 10 live sessions, 1 mock.
- Not affiliated with Parakeet AI.
