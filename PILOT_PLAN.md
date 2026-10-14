# Singapore pilot plan (proposal)

**Status:** proposed. No pilot has run and no results exist. The prototype's sample workbooks are synthetic.

## Goal

Test whether adaptive, explainable safe-to-save guidance helps people with irregular or low incomes build and keep an emergency buffer **without** more missed essential payments, compared with a basic fixed-savings plan.

## Design

- **Duration:** 10 weeks (2 weeks onboarding and baseline, 8 weeks active use). Can flex between 8 and 12 weeks.
- **Participants:** 80–120 adults in Singapore, recruited across four groups: gig and platform workers, part-time workers, lower-income households, and young workers with limited savings.
- **Arms:** randomised to (A) SavvyMoni adaptive recommendations or (B) the same app showing a fixed weekly savings suggestion chosen at onboarding. Both arms get the same bill tracking and reminders, so the comparison isolates the recommendation logic.
- **Data:** spreadsheet exports (.xlsx or .csv) and manual entry only (no provider APIs). Participants keep their emergency savings in their own bank account; the app never moves money.

## Recruitment

- Through community partners, social service offices, worker associations for platform workers, and polytechnic or ITE student services.
- Inclusion: 18+, Singapore resident or work pass holder, has a smartphone, self-reports less than one month of essential expenses in savings.
- Exclusion: people in active debt-management programmes are referred to their existing counsellors rather than enrolled.
- Compensation: a fixed participation payment not tied to savings outcomes, so it does not distort the savings measure.

## Consent

- Plain-English (and translated) consent covering: what data is collected, that it stays on the participant's device except for the anonymised study export they choose to send (and, only if they switch on the AI assistant, the questions and records it looks up, which are sent to Anthropic's Claude), the right to withdraw and delete at any time, and that SavvyMoni is not financial advice.
- No NRIC, Singpass, bank passwords or health records are collected. Participant IDs are random.
- Ethics review through a partner institution before recruitment.

## Baseline assessment (weeks 1–2)

- Short survey: income pattern, essential costs, existing savings, recent financial shocks, financial stress (validated scale), confidence managing money.
- Two to twelve weeks of past transactions via a bank or e-wallet export, or two weeks of cash-book entries, to calibrate everyday-spending estimates and detect regular income and bills.

## Measures

| Area | Measure |
|---|---|
| Savings accumulation | Change in emergency savings balance (participant-reported, verified against statement screenshots at weeks 0, 5, 10) |
| Financial safety | Self-reported missed or late essential payments; times savings had to be withdrawn for essentials not caused by a shock; any new high-cost borrowing |
| Emergency readiness | Weeks of essential expenses covered by savings at weeks 0 and 10; share of participants reaching their first milestone |
| Shock resilience | For participants who report a shock: whether it was paid without new borrowing; time to rebuild |
| Engagement | Weekly active use, recommendations viewed, contributions recorded, pauses used, drop-off |
| Understanding and trust | Can the participant explain why this week's amount is what it is? Trust in the number (survey) |
| Wellbeing | Change in financial stress score |
| Usability and accessibility | System Usability Scale, task success in moderated sessions, WCAG 2.2 AA checks, testing with screen readers and large text, older and lower-literacy participants included |

## User testing methodology

- Moderated sessions with 8–12 participants in week 2 and week 8: think-aloud on the planner, simulator and recovery planner.
- Weekly in-app one-question pulse ("Was this week's amount realistic?").
- Exit interviews with a sample from each group, including people who stopped using the app.

## Analysis

- Primary comparison: change in emergency savings and number of non-shock essential shortfalls, arm A vs arm B, reported with confidence intervals. The study is exploratory and not powered for small effects.
- Pre-registered success thresholds, for example: no increase in missed essential payments in arm A, and a higher share of arm A reaching their first milestone.
- Results published whatever the direction, including where the fixed plan performed better.

## Risks and safeguards

- Participants in hardship: the app recommends S$0 and shows support resources; facilitators can refer to social services.
- Data errors: estimates show confidence levels and ask for more information rather than guessing.
- Over-reliance: copy makes clear the number is a guide based on stated assumptions.

## After the pilot

Use findings to tune defaults (reserve, share by confidence, horizon), prioritise integrations users asked for, and prepare a partner pilot embedded in a bank, wallet or gig platform.
