# ASEAN scalability and financial inclusion

**Status:** prototype. Singapore, Philippines and Myanmar environments run on the user's own imported or hand-entered records; each country also has a synthetic sample workbook for demonstration. No institutional integrations, user traction or financial impact have been achieved or measured. Philippine and Myanmar settings are reasoned defaults for demonstration and need local validation.

## 1. What makes SavvyMoni portable

SavvyMoni is an emergency-savings **decision-support system**, not a Singapore budgeting app. One engine answers the same question everywhere: *how much can be set aside today without any projected day falling below a protected cash reserve?*

| Layer | Same in every country | Configured per country (`src/config/markets.ts`) |
|---|---|---|
| Money | Integer minor-unit arithmetic (`domain/money.ts`) | Currency, minor units (SGD/PHP 2, MMK 0), symbol, separators |
| Forecast | Daily projection of income, bills, everyday essentials and a discretionary allowance (`forecast.ts`) | Income rhythms offered (daily for vendors and riders) |
| Engine | Safe maximum = lowest projected balance − reserve; certainty-weighted income; confidence; statuses; limiting factor (`engine.ts`) | Rounding step, minimum actionable amount, default reserve |
| Goals | Expense-based milestones (1 week, 1 month, 3 months) | First milestones (S$100 / ₱500 / K50,000 …) |
| Shocks & recovery | Shock accounting, recovery scenarios, benchmark (`shock.ts`, `recovery.ts`, `benchmark.ts`) | Typical emergencies, public-assistance references |
| Categories | Ten top-level categories plus "Work & business costs" | Local subcategories and merchant rules (sari-sari, palengke, jeepney, warung, pasar, arisan, kontrakan, pulsa …) |
| Data in | Connector interface, spreadsheet import with income/bill detection, cash book, persistence | Payment providers and their honest statuses; quick-pick categories; import header words and number formats (e.g. `25,000` kyat) |
| Health bills | Out-of-pocket = billed − subsidy − insurance − public scheme | Labels: MediSave / PhilHealth / BPJS Kesehatan |
| UI | All pages | Languages offered per country (Singapore: English, Chinese, Malay, Tamil; Philippines: English, Filipino; Myanmar: English, Burmese; non-English strings are drafts), simple mode default |
| Compliance | Local-only storage, no credentials or ID numbers | Data protection law and regulator engagement |

**Consistency is tested.** `tests/asean.test.ts` runs the same scenario in SGD, PHP and MMK (amounts scaled) and checks that the safe maximum scales exactly and the limiting date and confidence are identical; recommendations differ only by each country's rounding step. Switching country never converts records: each country keeps its own saved state in its own currency.

## 2. Demonstration environments

| | Singapore | Philippines | Myanmar |
|---|---|---|---|
| Income level | High income | Upper-middle income | UN least developed country |
| Sample workbook (synthetic) | Polytechnic student with shift work | Motorcycle delivery rider, Quezon City | Garment factory worker, Yangon industrial zone |
| Currency | SGD | PHP | MMK (whole kyat) |
| Income found by the importer | Fortnightly shift pay (expected, varies about 20%); monthly tutoring seen twice (offered, unticked) | Weekly e-wallet cash-out (expected, varies about 25%) | Wages twice a month (varies about 10%); weekly overtime (uncertain, varies about 55%) |
| Money held in | Bank account, digital-bank savings pocket | Cash on hand, e-wallet, alkansya (coin bank) | Cash on hand, mobile wallet, savings tin at home; no bank account |
| Bills found by the importer | Room rental, mobile plan, music streaming (monthly) | Boarding house, motorcycle loan, padala, electricity (monthly); prepaid load (weekly) | Hostel room share, line car, money sent home, generator share (monthly); phone top-up (weekly) |
| Day-to-day records | Bank export | Cash book or e-wallet history | Cash book |
| Example shocks | Dental bill, laptop, medical out-of-pocket | Motorcycle repair, typhoon week, hospital bill, lost phone | Power cuts close the factory, clinic visit, family emergency in the village, lost phone, food price jump |
| Languages | English, Chinese, Malay, Tamil | English, Filipino | English, Burmese |
| Default view | Full | Full | Simple mode |

The **ASEAN comparison** page (`#asean`) applies one country-specific shock in all three countries at once, with shared severity and timing controls, and shows safe-to-save, status, savings used, cash used, income lost, shortfall, coverage and a rebuilding estimate in local currency. It uses the user's own records in each country they have set up; for any other country it imports that country's sample workbook through the normal import path, labelled synthetic.

## 3. Offline and cash-first design (implemented and tested)

- **Bank integration is optional.** The Myanmar demo has no bank account at all.
- **Cash book** (`#cashbook`): money in / money out, large buttons, common-amount chips, plain-language quick categories, choice of cash or e-wallet, optional note and date. Recording sales against an income source advances that income's schedule so it is never counted twice. Entries can be undone, which also reverses the balance change.
- **Daily and weekly views** of money in, money out and what is left.
- **"Money you have now"** lets people correct their counted cash at any time.
- **Offline-capable core.** All calculations run in the browser with no network calls. The Vite build includes a service worker (`public/sw.js`) that caches the app shell on first visit; the app then reloads and works without a connection. This is verified in `scripts/e2e.mjs` (flow M): the page is loaded once, the network is switched off, the page is reloaded, the Myanmar demo is opened and a cash entry is saved and recalculated. A connectivity badge shows Online/Offline and whether the device copy is offline-ready.
- **Limits:** the hosted single-file demo (claude.ai artifact) cannot register a service worker, so it calculates offline once open but cannot be reopened offline. Web fonts fall back to system fonts offline. Data is in browser storage, which users can clear.

## 4. Financial inclusion design choices

| User situation | Design response in the prototype |
|---|---|
| Irregular income | Daily/weekly income schedules; expected income counted below its average; uncertain income never relied on; pausing is normal and unpunished |
| Limited savings | First milestones sized to local amounts; S$0/₱0/K0 recommended without shaming when there is no room |
| No bank account | Cash and cash-box accounts; cash book as the primary data source |
| Cash transactions | Quick cash entries with local categories; business costs (stock, stall rent, fuel) treated as protected essentials |
| Limited digital literacy | Simple mode (bigger text, fewer pages), plain words, one decision per control, translated menus and cash book |
| Low-cost phones | One page app (~465 KB minified JS, no heavy chart library), works at 390 px width with no horizontal scrolling, minimal animation |
| Unreliable connectivity | Offline after first load; no API calls in the core |

Each country offers its own languages from a drop-down: Singapore English, Chinese, Malay and Tamil; the Philippines English and Filipino; Myanmar English and Burmese (Myanmar Unicode). Translations cover the start page, navigation, the hero card, statuses and the cash book. They are drafts and must be reviewed by native speakers; engine explanations remain in English in this prototype.

## 5. Singapore pilot strategy

Singapore remains the first technical pilot (see `PILOT_PLAN.md`): strong digital infrastructure, bank exports for testing data import, and a regulatory environment suited to a sandboxed study. The pilot validates the engine's core claim (fewer essential payments missed because of saving) before cash-first deployments.

## 6. Philippines localisation requirements

- **Context.** Account ownership among Filipino adults rose from 29% in 2019 to 56% in 2021, with e-money accounts the most common type (36% of adults), and about 34.3 million adults still unbanked ([GMA News, reporting the BSP 2021 Financial Inclusion Survey](https://gmanetwork.com/news/money/economy/842357/bsp-financial-account-ownership-among-adult-filipinos-rose-to-56-in-2021/story)). The same survey coverage reports that 37% started saving more for emergencies after the pandemic.
- **Needed:** e-wallet statement formats and any partnership-based access; local subcategories validated with riders and households; typical shock costs (motorcycle repair, typhoon disruption, hospital bills) from local sources; PhilHealth and HMO bill structures; Filipino and regional-language review; remittance (padala) and family obligations modelled as adjustable or essential with user input; typhoon-season income patterns.
- **Regulatory:** Data Privacy Act of 2012 and National Privacy Commission guidance; BSP engagement if delivered with a supervised institution.

## 7. Myanmar localisation requirements

- **Context.** Myanmar is on the UN list of Least Developed Countries ([UN DESA LDC profile](https://policy.desa.un.org/sites/default/files/2025-06/ldc_profile_myanmar.pdf)). Power cuts, connectivity interruptions and fast-moving prices make an offline, cash-first tool with a cautious cushion especially relevant, and also make a pilot harder to run.
- **Needed:** Burmese review by native speakers (Myanmar Unicode only, never Zawgyi); mobile-wallet history formats where users can download them; wage, overtime and remittance patterns validated with workers; typical shock costs from local sources; Social Security Board bill handling for registered workers; low-end Android and intermittent-connectivity testing.
- **Regulatory:** no comprehensive data protection law; the Law Protecting the Privacy and Security of Citizens (2017) applies in part. Any pilot would go through a partner and needs a review of sanctions and operating constraints.

## 8. Technical scalability

- **Client-first.** The core runs on the device: no per-user server cost, works offline, scales with users' own devices.
- **Configuration over code.** A new country is a `MarketConfig` entry, a subcategory list, merchant rules, header words for the importer, shock presets, translated strings and a sample workbook for testing. The engine and pages do not change.
- **Optional sync (P2).** A later backend would sync encrypted state across devices and host partner connectors server-side, behind the existing `FinancialDataConnector` interface.
- **Performance.** Daily projection over 35 days with daily income is a few hundred events; recalculation is effectively instant on low-end devices.
- **Testing.** Unit tests per country, cross-country consistency tests and browser flows (J country switching, K cash book, L ASEAN demo, M offline, N language and simple mode).

## 9. Potential institutional partners (none engaged)

| Country | Potential partners | Why |
|---|---|---|
| Singapore | Digital banks, employers, gig platforms, community organisations | Embedded resilience tool; worker welfare |
| Philippines | E-wallet and digital-bank providers, rider and transport associations, cooperatives, LGU social-welfare offices | Reach riders and unbanked users where they already transact |
| Myanmar | Microfinance institutions, mobile-wallet providers, garment-sector worker organisations, community donation (parahita) groups | Cash-first workers reached through trusted local intermediaries |

Listing an organisation here means it could be approached, not that any relationship exists. The challenge's own Financial Health Champions are listed on the [GFTN challenge page](https://gftn.co/asean-financial-health-challenge).

## 10. Data privacy and regulatory dependencies

| Country | Law | Dependencies before a pilot |
|---|---|---|
| Singapore | Personal Data Protection Act 2012 | PDPA consent and breach processes; MAS review of service classification if with a bank partner |
| Philippines | Data Privacy Act of 2012 | NPC registration where required; consent in Filipino and English; BSP engagement through a partner |
| Myanmar | No comprehensive law; Law Protecting the Privacy and Security of Citizens (2017) applies in part | Consent in Burmese; local storage only; sanctions and operating-constraint review; central bank engagement only through a partner |

Across all: no national ID numbers, bank passwords or health records; local storage by default; explicit, revocable consent for any future connector; no sale of data; no lending or credit products.

## 11. Localisation risks

- **Wrong defaults.** Shock sizes, milestones and rounding in PH/ID are prototype assumptions; wrong values would make advice feel irrelevant.
- **Category mismatch.** Treating a business cost (stock, fuel) as discretionary would understate protected needs; the prototype treats them as essential by default.
- **Translation quality.** Draft strings could mislead; native review is required.
- **Data entry burden.** Cash book use may drop off; needs testing of reminders that are helpful, not nagging.
- **Shared phones and devices.** Local storage on a shared phone is a privacy risk; a PIN lock would be needed before a pilot.
- **Cultural obligations.** Remittances and community savings (arisan) may be non-negotiable; users must be able to mark them protected.
- **Regulatory interpretation.** Whether recommendations count as financial advice differs by country.

## 12. Proposed pilot metrics (all countries)

- Share of participants with a positive emergency balance at weeks 4, 8 and 12.
- Essential payments missed or late (self-reported), compared with a fixed-savings arm.
- Shocks absorbed without new high-cost borrowing.
- Weeks of essentials covered by savings.
- Cash book retention: entries per active week, drop-off by week 4.
- Understanding: can the participant explain this week's amount?
- Offline use: share of sessions without connectivity; data-loss incidents.
- Usability on low-end devices: task success, load time on 3G-class connections.

## 13. Limitations requiring real-world validation

- No real users in any country; the sample workbooks, shock amounts and defaults are synthetic.
- The importer has been tested on generated workbooks, an openpyxl workbook and a LibreOffice re-save, not yet on real bank or e-wallet exports from each country.
- PH/ID configuration values have not been validated with local partners.
- Translations are drafts.
- Offline support is verified in an automated browser test, not on a range of real low-cost devices.
- The engine's conservative counting of variable income may recommend less than people can actually save; pilots must test whether this protects or discourages users.
- No partner, regulator or institution has reviewed or endorsed SavvyMoni.

## Sources

- [GFTN – ASEAN Financial Health Challenge](https://gftn.co/asean-financial-health-challenge)
- [GMA News – BSP: account ownership among adult Filipinos rose to 56% in 2021](https://gmanetwork.com/news/money/economy/842357/bsp-financial-account-ownership-among-adult-filipinos-rose-to-56-in-2021/story)
- [Kontan – SNLIK 2025: literacy index 66.46%, inclusion index 80.51%](https://keuangan.kontan.co.id/news/hasil-snlik-2025-indeks-literasi-keuangan-6646-dan-inklusi-keuangan-8051)
