# Competitive analysis

**Positioning:** SavvyMoni helps users make safer emergency savings decisions under real-world financial constraints, rather than simply encouraging them to save more.

This analysis compares product approaches, not company performance. Where a capability is not mentioned, that means we did not find evidence of it in the sources checked, not that it does not exist. All claims should be re-verified before external use; product features change often.

## Summary

| Product | Type | Core saving mechanism | Looks at upcoming bills before saving? | Income-volatility handling | Explains the amount? |
|---|---|---|---|---|---|
| Maya (Personal Goals) | Philippine digital bank | Goal accounts with tiered interest | Not found in sources checked | Not found | Not applicable |
| Qapital | US savings app | User-defined rules (round-ups, set-and-forget, % of deposits) | Not mentioned on its rules page | "Freelancer" rule saves a % of deposits | Rule is the explanation |
| YNAB | Budgeting app (subscription) | Zero-based budgeting: assign every dollar a job | Yes, through the user's own manual budgeting | Manual | User-driven |
| GXS Bank (Saving Pockets) | Singapore digital bank | Separate pockets with interest, no lock-in | Not found | Not found | Not applicable |
| Trust Bank | Singapore digital bank | Savings plans, up to five Savings Pots, Trust Lock | Not found | Not found | Not applicable |
| Traditional savings accounts | Banks | Manual transfers or standing instructions | No | No | No |
| **SavvyMoni** | Bank-agnostic layer | Daily cash projection; saves only what keeps every protected bill and essential covered | **Yes, automatically, date by date** | Counts expected pay at (1 − variability); ignores uncertain pay | **Yes, full waterfall and limiting factor** |

## Product notes

### Maya
Maya Bank's Personal Goals let customers hold up to five goal accounts, each running up to 180 days, with tiered interest by balance band; money returns to Maya Savings at the due date or when a goal is cancelled ([Maya Bank, Personal Goals](https://www.mayabank.ph/savings/personal-goals/)). Maya is also listed as a Financial Health Champion of this challenge ([GFTN](https://gftn.co/asean-financial-health-challenge)).
- **Strengths:** strong incentive (interest), large user base in the Philippines, goals separate from spending money.
- **Overlap:** goal-based savings, separation of buffer from spending.
- **Gap SavvyMoni addresses:** deciding *how much* is safe to move into a goal this week given bills and irregular income.
- **Relationship:** partner, not rival. SavvyMoni's engine could recommend safe amounts into Maya goals in a Philippine pilot.

### Qapital
Qapital automates saving through rules such as Set and Forget, Round Up, Guilty Pleasure, Spend Less, a Freelancer rule that moves a percentage of deposits, and a 52-week rule ([Qapital](https://www.qapital.com/blog/save-money-qapital-rules)). Its rules page does not describe checking upcoming bills or protecting a minimum balance.
- **Strengths:** behavioural design, low effort, habit formation.
- **Gap:** fixed rules can transfer money in a week when rent is due; SavvyMoni pauses or reduces instead.

### YNAB
YNAB is a paid budgeting app built around zero-based budgeting ("give every dollar a job") and planning for irregular expenses ahead of time (source: ynab.com; not re-fetched during this build, verify before submission).
- **Strengths:** deep methodology, very effective for engaged users.
- **Gap:** requires sustained manual effort and financial confidence; the user, not the software, decides what is safe. Subscription pricing is a barrier for lower-income users.

### Singapore digital banks (GXS, Trust, MariBank)
GXS offers Saving Pockets for separate goals with interest, no minimum balance and no lock-in ([Fintech News Singapore](https://fintechnews.sg/76676/digital-banking-news-singapore/gxs-bank-expands-access-to-savings-account-raises-deposit-cap-to-s75000/)). Trust Bank offers switchable savings plans, up to five Savings Pots and Trust Lock; it is a Standard Chartered and NTUC/FairPrice Group partnership with Linkpoints tied to FairPrice spending ([StashAway review](https://www.stashaway.sg/r/singapore-digital-bank-trust-bank-review)).
- **Strengths:** convenient places to *hold* an emergency fund, good rates, Singpass onboarding.
- **Gap:** pockets hold money; they do not decide how much can safely go in. SavvyMoni is complementary and bank-agnostic: the emergency fund stays wherever the user keeps it.

### Traditional savings accounts and budgeting apps
Reliable and insured, but saving is manual or a fixed standing instruction. Budgeting apps mostly look backward at categorised spending rather than forward at dated obligations.

### Automated savings tools in general
Rule-based automation increases saving, but for people with volatile income, a fixed transfer in a short week can cause missed bills, overdraft fees or borrowing. SavvyMoni's Benchmark Lab makes this trade-off visible, including the cases where a fixed rule saves more.

## Unmet needs SavvyMoni targets

1. A **safe** amount, not just a target, for people whose pay varies.
2. **Date awareness:** rent due on the 16th matters more than average monthly surplus.
3. **Explicit uncertainty:** expected vs confirmed vs uncertain income.
4. **Permission to pause** without guilt, and a plan to rebuild after using the fund.
5. **Singapore context:** hawker and FairPrice spending, SimplyGo fares, S&CC, SP Group, and medical bills that separate subsidy, insurance and MediSave.

## Adoption barriers

- Data entry effort while no authorised bank feeds exist (mitigated by spreadsheet import with automatic detection of regular income and bills, and the cash book; long-term by partnerships).
- Trust: users must believe the number. Mitigated by full explanations and conservative defaults.
- Engagement for people under stress: small, non-judgemental prompts, no streaks.
- Being one more app: B2B2C distribution inside banks, wallets and gig platforms avoids this.

## Competitive threats

- Banks and wallets adding "safe-to-save" logic natively. Response: partner with them; the engine and connector layer are designed to be embedded.
- Large budgeting apps adding forecasting. Response: focus on lower-income and variable-income users, Singapore and ASEAN context, and a free tier for individuals.

## Potential partnerships

Digital banks and wallets (as embedded feature), gig platforms (worker welfare benefit alongside new CPF arrangements for platform workers), employers (financial wellness programmes), community and social service organisations, and grocery or transport operators for receipt and fare data under authorised agreements.

## Long-term defensibility

- An explainable, tested engine tuned for volatile income and dated obligations.
- Local taxonomies and merchant rules per ASEAN market.
- Aggregated, privacy-preserving evidence from pilots on what keeps buffers intact.
- Trust earned by never pushing credit or selling data.
