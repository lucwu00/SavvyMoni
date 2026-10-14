# SavvyMoni: submission

## 1. Project title
**SavvyMoni: adaptive emergency savings and financial resilience intelligence.** *Save steadily for the known to stand strongly against the unknown.*

## 2. Team
Savvymoni3s. Technical Product track.

## 3. Problem statement
**PS2 – Emergency Savings.** "How might we help individuals build and maintain an accessible emergency savings buffer that works with their income and spending patterns and enables them to withstand financial shocks?" The challenge is co-organised by Bangko Sentral ng Pilipinas and GFTN ([GFTN](https://gftn.co/asean-financial-health-challenge)).

## 4. Executive summary
Most savings tools encourage people to save more. For people whose income moves week to week, saving the wrong amount in the wrong week can mean a missed rent payment or a high-interest loan. SavvyMoni answers a narrower, more useful question: **how much can I safely save today without risking my essentials tomorrow?**

A deterministic engine projects cash day by day over five weeks, protects every essential bill and everyday cost, counts confirmed, expected and uncertain income differently, and recommends the largest safe amount, often zero, with the full working shown. It supports the whole emergency lifecycle: prepare, save, absorb a shock, withdraw, recover and rebuild. The working MVP has no built-in records: people import a spreadsheet (a bank or e-wallet export, or the SavvyMoni template) or keep a cash book. The importer finds regular income and bills in the history and asks the person to confirm them. An AI assistant (Claude) answers questions by calling read-only tools that run the same engine on the person's live data, and a benchmark lab compares adaptive saving with fixed rules on the same simulated future.

## 5. Target beneficiaries
- Part-time student workers with fluctuating shift pay.
- Gig and platform workers (Singapore has about 70,500 platform workers, now covered by the Platform Workers Act from 1 January 2025 ([Asia News Network](https://asianews.network/singapore-passes-landmark-bill-recognising-ride-hail-delivery-gig-workers-as-distinct-labour-class/))).
- Lower-income households balancing childcare, elderly support and HDB costs.
- Early-career workers with loans and family remittances.

## 6. Singapore-specific problem analysis
- **Buffers are thin even among working households.** OCBC's Financial Wellness Index 2024 reports that only 50% of parents and 58% of dual-income couples without children have at least six months of salary saved for a crisis ([OCBC FWI 2024](https://ocbc.com/iwov-resources/sg/ocbc/gbc/pdf/campaign/financial-wellness-index/fwi2024-report.pdf)). Lower-income and variable-income workers are likely to be further behind.
- **Obligations are dated and lumpy.** Rent, S&CC, SP Group utilities, childcare, insurance premiums and loan instalments fall on fixed dates, while gig payouts are weekly and variable, and part-time pay is fortnightly. Monthly averages hide the week when rent and a dental bill collide.
- **Healthcare costs have layers.** A bill's billed amount, subsidy, insurance and MediSave portions differ by person and scheme; only the out-of-pocket part hits cash, and it cannot be assumed.
- **Financial lives are fragmented** across banks, PayNow, wallets, FairPrice receipts, SimplyGo fares and medical bills. There is no consumer API for PayNow or SGQR history.

## 7. Proposed solution
A bank-agnostic financial intelligence layer, delivered first as a web app, that:
1. Brings together balances, income, bills, receipts and medical bills from a spreadsheet import (.xlsx or .csv, read on the device), a cash book and manual entry, and detects regular income and bills in the history for the person to confirm.
2. Classifies spending with a Singapore taxonomy into essential, adjustable essential, discretionary, debt/contractual and needs-review, with line-level splits for mixed receipts.
3. Recommends a safe contribution and explains it.
4. Simulates emergencies and plans recovery.
5. Shows, honestly, how adaptive saving compares with fixed rules.
6. Answers questions in plain language through an AI assistant that reads the person's live records via the engine and cannot invent numbers or exceed the safe amount.

## 8. Core innovation
- **Date-aware safety constraint:** contribution ≤ (lowest projected daily balance − reserve) over the horizon. This is checked on 400 randomised scenarios in the test suite.
- **Certainty-weighted income:** confirmed 100%, expected discounted by its own variability, uncertain 0%.
- **Explainability by construction:** the limiting factor names the bill, date and next payday that bind the recommendation; every change is logged with its cause.
- **One accounting path for shocks:** simulation and application use the same function, so savings used and costs incurred are never double counted.
- **Detect, then confirm:** income and bill rhythms (daily, weekly, fortnightly, monthly) are inferred from payment history with visible evidence; bills are protected at their highest recent amount and their past payments are linked so everyday spending is not counted twice.
- **Grounded AI:** the assistant's facts come only from tool calls into the deterministic engine, made at the moment of the question.

## 9. Competitive differentiation
Rule-based savers (for example Qapital's rules) and digital-bank pockets (GXS, Trust) help people *hold* or *automate* savings; budgeting apps such as YNAB rely on users to decide what is safe. SavvyMoni decides how much is safe, week by week, for variable incomes, and is complementary to wherever the money is kept. See [COMPETITIVE_ANALYSIS.md](COMPETITIVE_ANALYSIS.md).

## 10. Main features
Setup by spreadsheet import (with review) or cash book · Downloadable template, synthetic sample workbook and Excel export · Overview dashboard · Safe-to-Save planner with calculation waterfall · Bills calendar with protected priorities · Transactions with overrides, merchant rules and mixed-receipt lines · Emergency simulator (nine Singapore scenarios, custom amount, timing and income loss) · Recovery planner (three scenarios, pause weeks) · Grocery, transport and healthcare insights · Import hub with honest provider statuses · Validation, duplicate detection and row-level error reporting · Benchmark lab · AI assistant (Claude) with read-only tools and explicit consent · Goals ladder from S$100 to three months · Persistence, export, deletion and reset.

## 11. Financial decision methodology
Summarised here; full detail in [ARCHITECTURE.md](ARCHITECTURE.md).
1. Build dated events for 35 days: counted income, unpaid bills (overdue = today), medical out-of-pocket, everyday essentials measured from the last 28 days (excluding bill payments), and a discretionary allowance.
2. Project daily balances from spendable cash (emergency savings excluded).
3. Safe maximum = lowest projected balance − minimum reserve, floored at zero.
4. Recommend 80/60/50% of the safe maximum by confidence, rounded down to S$5; zero below S$10, when paused, or when information is insufficient. The rest is shown as a cushion (not spare money) and offered for saving at the next check-in if it wasn't needed.
5. Status, limiting factor, assumptions, confidence reasons and next review date are returned with every recommendation.

## 12. Technology architecture
React + TypeScript + Vite single-page app; pure-TypeScript domain core; dependency-free .xlsx reader/writer; Vitest unit and journey tests; Playwright end-to-end script; localStorage persistence; Vercel deployment with one server function (`api/chat.ts`) that holds the Anthropic API key for the assistant. No database: records stay on the device.

## 13. Integration strategy
Modular `FinancialDataConnector` interface (metadata, status, import, normalise, validate, disconnect). Today: spreadsheet import (.xlsx and .csv, including bank exports with title rows and Money out / Money in columns) and manual entry. No provider is simulated or shown as connected. Next: column presets for the main bank exports and on-device receipt parsing; then partner integrations (banks, SGFinDex participation via an authorised route, opt-in grocery e-receipts, billing-only healthcare data). See [INTEGRATION_ROADMAP.md](INTEGRATION_ROADMAP.md).

## 14. Expected financial-health impact
Hypotheses to test in the pilot (none measured yet):
- Fewer essential payments missed because of saving, compared with fixed plans.
- More participants reach a first milestone (S$100–S$1,000), which matters more than a six-month target for people starting from zero.
- Shocks absorbed without new high-cost borrowing, and faster, planned rebuilding.
- Lower financial stress through clear "it's safe to pause" guidance.

In the benchmark, results vary with the person's data: adaptive saving sometimes accumulates more and sometimes less than fixed rules. The lab shows both.

## 15. Business sustainability
**Model:** B2B2C. Individuals get core protection features free. Revenue comes from institutions that want their customers or workers to be more resilient.

| Customer | Value to them | Possible revenue |
|---|---|---|
| Banks and digital wallets | Engagement, deposits, fewer delinquencies, financial-health commitments | Software licence or per-active-user fee for an embedded module |
| Employers | Workforce wellbeing, fewer salary-advance requests | Per-employee financial wellness subscription |
| Gig platforms | Worker retention and welfare alongside new CPF and injury obligations | Platform licence, co-branded worker benefit |
| Cooperatives, social service and inclusion organisations | Case support tools | Grant- or partner-funded deployment |
| Aggregated insights | Research on resilience trends | Only properly aggregated, privacy-preserving reports with consent |

**Never:** selling identifiable data, lending, overdraft or high-cost credit commissions.

**Acquisition:** through partners' existing channels (banking apps, worker apps, HR portals, community organisations), so customer acquisition cost sits mostly with distribution partners.
**Implementation cost:** low for an embedded front end; the main cost per partner is data integration and compliance review.
**Ongoing support:** engine updates, localisation of categories and merchant rules, partner success, and security operations.
**Partner incentive:** customers who keep a buffer are less likely to fall into arrears and more likely to stay, and the partner meets financial-health goals with an explainable, auditable tool.

Pricing levels are to be set after the pilot; no figures are assumed here.

## 16. Adoption and pilot strategy
A 10-week randomised pilot with 80–120 Singapore participants across gig, part-time, lower-income household and early-career groups, comparing adaptive recommendations with a fixed-savings version of the same app. Measures cover savings, missed essential payments, shock resilience, engagement, trust, stress, usability and accessibility. See [PILOT_PLAN.md](PILOT_PLAN.md). **No traction or user results are claimed.**

## 17. ASEAN scalability
SavvyMoni is Singapore-first and ASEAN-ready, and the prototype already runs three environments on one shared engine and one importer. Each country has a synthetic sample workbook that goes through the same import as a person's own file:
- **Singapore (SGD):** a student worker with a bank account, fortnightly shift pay and monthly rent.
- **Philippines (PHP):** a delivery rider with irregular weekly e-wallet cash-outs, cash spending, a motorcycle loan, and vehicle-repair and typhoon shocks.
- **Myanmar (MMK):** a garment worker with wages twice a month, overtime that comes and goes, cash, a mobile wallet and a simple-mode interface; the importer separates wages from overtime.

Everything that differs (currency and minor units, rounding, milestones, income rhythms, categories, payment providers, shocks, health-bill labels, language, data protection law) is configuration in `src/config/markets.ts`. Tests confirm the same scenario gives proportionally identical results in all three currencies, and switching country never converts records. The cash book and calculations work without a bank account and, once installed, without internet (tested with the network switched off). The ASEAN comparison page applies three country-specific shocks through the same engine side by side, using the person's own records where they exist. Details, localisation requirements, partners, risks and metrics are in [ASEAN_SCALABILITY.md](ASEAN_SCALABILITY.md).

## 18. Privacy and regulatory considerations
No built-in records; imported files are read on the device and never uploaded; no passwords, Singpass, NRIC, card codes or health records; export and deletion. The AI assistant is off until the person switches it on after being told exactly what is sent to Claude (the question and the records it looks up); each answer lists the data it used, and the API key stays on the server. Production would require PDPA compliance, MAS review of the service's classification, provider agreements, consent management, encryption, strong authentication, access controls, retention rules, incident response and secure deployment. Details in [ARCHITECTURE.md](ARCHITECTURE.md).

## 19. Prototype capabilities
The demo flows work and are tested in a browser:
A setup from an imported spreadsheet · B grocery purchase updates the recommendation · C S$400 dental bill changes readiness · D lower income reduces or pauses saving · E withdrawal and rebuilding plan · F fixed vs adaptive benchmark · G importing a workbook produced by another program (openpyxl) · H persistence after reload · I start again.
Plus: J country switching without conversion (each country set up from its own file or cash book) · K Myanmar cash book (no bank) · L three-country shock comparison · M offline reload with the network disabled · N Singapore's four languages from the corner drop-down · Q Filipino and Burmese, with English when a country does not offer the current language · O the assistant's tool loop (with a scripted stand-in for Claude, since the test environment has no API key).
Test results: 87 Vitest-style tests pass (engine, import and detection, xlsx compatibility, assistant tools and proxy, journeys, cross-country); the browser script passes flows A–O with no console errors and no horizontal overflow at 390 px. Workbooks written by SavvyMoni open in openpyxl and LibreOffice, and a LibreOffice-saved copy imports back unchanged.

## 20. Honest limitations
- No real provider connections; data arrives by spreadsheet or by hand. No real users yet.
- Income and bill detection needs at least two occurrences (three for weekly); short or irregular histories are offered unticked or not found, and the person must add them.
- Everyday-spending estimate is a trailing average; it does not yet model seasonality (school terms, festive periods).
- Income variability is measured from the imported history or set by the person; it is not forecast.
- The benchmark uses a weekly simplification of the daily engine.
- localStorage is not encrypted; not suitable for real financial data on shared devices.
- The assistant's live answers depend on Claude and were exercised only with a scripted stand-in in automated tests; answers can still be wrong, so the app tells people to check numbers on the Planner page. Questions and looked-up records are sent to Anthropic when the assistant is used.
- Accessibility follows good practice (labels, focus states, contrast, reduced motion) but has not been formally audited.
- Charts are custom SVG, not Recharts, because the build environment had no package registry access.
- Philippine and Myanmar settings, shocks and sample workbooks are reasoned defaults, not locally validated; Chinese, Malay, Tamil, Filipino and Burmese strings are drafts; engine explanations are English only.
- Offline support needs the installed (service-worker) build; the hosted single-file demo cannot be reopened offline.

## 21. Three-minute demo script

| Time | Screen | Say and do |
|---|---|---|
| 0:00 | Setup | "Most apps tell you to save more. SavvyMoni tells you how much is *safe*. There's no demo data: it works from your own records." Singapore → **Import a spreadsheet** → drop a bank export (or **Try the sample file**). |
| 0:20 | Import review | 310 transactions read, rows with problems listed. "It found shift pay every two weeks, varying by about 20%, and three monthly bills, with the evidence." Untick nothing, enter a name, **Build my plan**. |
| 0:40 | Overview / Planner | Safe to save this week, status, confidence, limiting factor (rent due before the next counted pay). Scroll the waterfall: income counted conservatively, protected bills, everyday essentials measured from the file. "Every number is traceable." |
| 1:05 | My finances → Income | Cut shift pay and save. The live banner drops to S$0 and **Pause savings**. "Protecting essentials is the right call." |
| 1:20 | Ask SavvyMoni | Switch on (show what is sent). Ask "What happens if I need S$900 for a laptop next week?" Claude looks up the plan and runs the emergency simulation; the answer quotes the engine and lists the data it used. |
| 1:50 | Simulator → Recovery | Apply a dental bill; three rebuild scenarios with weekly amounts, labelled as simulations. |
| 2:10 | Benchmark lab | **Cut income 50%** and **Add a medical bill**. Fixed plans keep transferring; SavvyMoni pauses when cash is tight. "Another random history" shows cases where a fixed rule saves more. "We show the trade-off honestly." |
| 2:30 | ASEAN comparison | Switch to the Philippines and Myanmar (import the sample file, or start a cash book). The same engine and importer in ₱ and K side by side; the Myanmar cash book works without a bank or internet. |
| 2:55 | Close | "Safe, explainable, adaptive savings for people whose income doesn't wait for payday. Ready for a Singapore pilot and built for ASEAN." |

## Sources
- [GFTN – ASEAN Financial Health Challenge](https://gftn.co/asean-financial-health-challenge)
- [OCBC Financial Wellness Index 2024 report](https://ocbc.com/iwov-resources/sg/ocbc/gbc/pdf/campaign/financial-wellness-index/fwi2024-report.pdf)
- [Asia News Network – Platform Workers Bill passed](https://asianews.network/singapore-passes-landmark-bill-recognising-ride-hail-delivery-gig-workers-as-distinct-labour-class/)
- [ABS – SGFinDex](https://www.abs.org.sg/consumer-banking/sgfindex)
- Competitor sources are listed in [COMPETITIVE_ANALYSIS.md](COMPETITIVE_ANALYSIS.md).
