# SavvyMoni

**Save steadily for the known to stand strongly against the unknown.**

SavvyMoni is an adaptive emergency-savings and financial-resilience MVP built for the **ASEAN Financial Health Challenge 2026**, Problem Statement 2 (Emergency Savings), Technical Product track, by team **Savvymoni3s**. Singapore is the pilot market.

It answers one question: *how much can I safely save today without risking my ability to pay for essentials tomorrow?* A deterministic engine projects cash day by day, protects every essential bill and everyday cost, counts uncertain income conservatively, and explains every number.

> **Prototype status.** SavvyMoni has no built-in records: it works from a spreadsheet you import or a cash book you keep. It does not move money, is not a bank or financial adviser, and has no live provider connections. Nothing here has been validated with real users yet.

## How data gets in

There is no direct connection to DBS, FairPrice or any other provider (none exists without a partnership). Instead:

1. **Import a spreadsheet** (`.xlsx` or `.csv`): a bank or e-wallet export as downloaded, or the SavvyMoni template. Only the **Transactions** sheet is required (Date, Description, Amount; or Money out / Money in columns). Optional **Income**, **Bills** and **Balances** sheets are used when present.
2. **Review before saving.** SavvyMoni shows what it read, which rows it skipped and why, the regular income and bills it found in your history (with the evidence, e.g. "6 payments about every 2 weeks"), and the balances it will start from. Nothing is saved until you confirm.
3. **Or start a cash book**: count your cash, say roughly what a normal day costs, and record money in and out as it happens. Works offline.

Files are read on the device by a small built-in `.xlsx` reader (no formulas, macros or links are evaluated) and never uploaded. A blank template and a **synthetic sample workbook** per country can be downloaded from the import screen; the sample goes through exactly the same import and review as your own file. Your records can be exported back to Excel from Settings, edited, and imported again.

## The AI assistant

**Ask SavvyMoni** is Claude, reading your records as they are at the moment you ask. It has no pre-written answers. It calls read-only tools that run SavvyMoni's own engine on your live data: plan summary, accounts, income, bills, transaction search, spending summary, cash projection, emergency and what-if simulations, and rebuilding plans. It can explain and simulate, but it cannot change records or recommend saving more than the engine's safe amount.

- **Opened as a Claude artifact:** the assistant runs on the viewer's own Claude account after they allow the page to use Claude.
- **Deployed app:** `api/chat.ts` is a small server function that holds `ANTHROPIC_API_KEY` and forwards requests to the Claude API. The browser runs the tools locally and sends back only the results Claude asked for.
- **Neither available, or offline:** the assistant says it is not connected. Everything else keeps working.

Before the first question, the user is told exactly what is sent (the question, earlier messages, and the records the assistant looks up) and must switch the assistant on. Each answer lists the data it looked at. The assistant can be switched off in Settings.

## Quick start

```bash
npm install
npm run dev          # http://localhost:5173 (also serves /api/chat if .env has a key)
npm test             # Vitest: engine, import, AI plumbing, journeys, cross-country
npm run build        # production build to dist/
npm run typecheck    # strict TypeScript check
```

Requires Node 18+. For the assistant in development, copy `.env.example` to `.env` and set `ANTHROPIC_API_KEY` (server-side only; never prefix it with `VITE_`).

### End-to-end check (optional)

```bash
npm run build && npx vite preview --port 4173 &
npm i -D playwright && npx playwright install chromium
npm run e2e -- http://localhost:4173 ./e2e-shots
```

`scripts/e2e.mjs` drives the demo flows in Chromium: setup from a spreadsheet, a grocery purchase, a medical bill and emergency, an income cut, the benchmark, importing a workbook produced by another program (`tests/fixtures/openpyxl-statement.xlsx`), persistence, three countries, the cash book, the assistant (with a scripted stand-in for Claude, since the test has no API key), start again, mobile width and offline reload. It fails on any console error.

## Deploy to Vercel

1. Push this folder to a GitHub repository.
2. In Vercel, **Add New → Project**, import the repository. The framework is detected as Vite; `vercel.json` sets `npm run build` and the `dist` output. Files in `api/` become server functions.
3. Under **Settings → Environment Variables**, add `ANTHROPIC_API_KEY`. Optional: `ANTHROPIC_MODEL` (default `claude-sonnet-5-5`) and `ALLOWED_ORIGINS` (comma-separated) to restrict who can call `/api/chat`.
4. Deploy. Routing uses URL hashes (`#planner`), so no rewrite rules are needed.

The proxy fixes the model and token limit, accepts only SavvyMoni's own tool names, caps request size and applies a best-effort per-IP rate limit. It stores nothing. For anything beyond a demo, put it behind real authentication.

## What's inside

| Page | What it does |
|---|---|
| Setup | Choose Singapore, the Philippines or Myanmar; import a spreadsheet and review it, or start a cash book |
| Overview | Safe-to-save amount, status, confidence, goal progress, 5-week cash projection, upcoming bills, spending, income forecast, change log |
| Cash book | Money in / money out for cash and e-wallet users, daily and weekly views, cash count correction |
| Safe-to-Save planner | Full calculation waterfall, protected expenses, confidence reasons, goals ladder, assumptions you control, pause/resume, record transfers |
| My finances | Accounts, income, bills calendar, transactions (reclassify, split mixed receipts, apply-to-merchant rules) |
| Emergency simulator | Country-specific emergencies, custom cost, timing and income loss; before/after; apply to plan |
| Recovery planner | Conservative/balanced/optimistic rebuild schedules, pause weeks, risk assessment |
| Spending insights | Categories, weekly trends, groceries (split receipts), transport, healthcare bills with subsidy/insurance/scheme split |
| Import & integrations | Spreadsheet import for later files, data counts and deletion, honest status of every provider |
| Benchmark lab | Fixed 10%, fixed weekly and adaptive saving on the same simulated future built from your data, with stress controls |
| ASEAN comparison | One engine across three countries, using your records where you have them and each country's sample workbook otherwise |
| Ask SavvyMoni (AI) | Claude with read-only tools over your live data (see above) |
| Settings & data | Name, country, language (per country: English, Chinese, Malay, Tamil / English, Filipino / English, Burmese; drafts), simple mode, Excel/JSON export, assistant on/off, delete everything |

Data persists in `localStorage`. Each country keeps its own records in its own currency; switching country never converts amounts, and a country you have not set up starts empty.

## Countries and offline use

All country differences live in `src/config/markets.ts`; the engine and the importer are shared. See [ASEAN_SCALABILITY.md](ASEAN_SCALABILITY.md).

**Offline:** the production build registers `public/sw.js`, which caches the app on first visit. After that the app reloads and works with no connection: import, cash book and every calculation run on the device. Only the AI assistant needs the network. Tested by flow M in `scripts/e2e.mjs`.

## Project layout

```
api/chat.ts      server function: Claude API proxy for the assistant (key stays server-side)
src/
  domain/        pure TypeScript: money, dates, categories, classifier, spending,
                 forecast, engine, goals, shock, recovery, benchmark, CSV parsing
  import/        .xlsx reader/writer, workbook import, regular-payment detection,
                 applying a reviewed import, template/sample/export workbooks
  ai/            assistant tools over live data, prompt, Claude providers and tool loop
  connectors/    FinancialDataConnector interface, provider catalogue with honest statuses
  data/          synthetic persona generator used only for sample workbooks and tests
  config/        ASEAN market configuration
  state/         reducer (all money-changing actions), persistence, React store and router
  ui/            components, dependency-free SVG charts, safe Markdown, downloads
  pages/         app pages, setup and the import review
tests/           Vitest suites and a workbook fixture made with openpyxl
scripts/e2e.mjs  browser test of the demo flows
```

## Stack notes

React 19 + TypeScript + Vite, Lucide icons (via `react-icons/lu`), Vitest. Charts are hand-built SVG, the `.xlsx` reader/writer is about 300 lines with no dependency (it uses the browser's `DecompressionStream`), and styling uses CSS design tokens. Keeping dependencies to React and an icon set meant every part could be built and tested in an environment without registry access.

## Documents

- [SUBMISSION.md](SUBMISSION.md): judging submission and 3-minute demo script
- [ARCHITECTURE.md](ARCHITECTURE.md): engine method, import, assistant, data model, security and regulatory notes
- [COMPETITIVE_ANALYSIS.md](COMPETITIVE_ANALYSIS.md)
- [INTEGRATION_ROADMAP.md](INTEGRATION_ROADMAP.md)
- [PILOT_PLAN.md](PILOT_PLAN.md)
- [ASEAN_SCALABILITY.md](ASEAN_SCALABILITY.md)

## Screenshots

`docs/screenshots/` contains captures from the end-to-end run: the import review, overview, planner, simulator, benchmark, the assistant, mobile, dark mode, the ASEAN comparison, the Philippine overview, the Myanmar cash book, Chinese, Tamil and Burmese simple mode, and the app reloaded offline.
