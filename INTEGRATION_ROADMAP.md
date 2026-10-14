# Integration roadmap

No integration in the prototype is a live connection. This document explains what each real integration would require. Status labels used in the app:

| Status | Meaning |
|---|---|
| Connected through an authorised API | Live data under a provider agreement and explicit consent. **No provider has this status today.** |
| User-authorised import | The user imports their own spreadsheet (.xlsx or .csv) or types data in. |
| Planned integration | Requires a partnership or authorised access first. |
| Not available | No consumer data access exists or is assumed. |

## Current state

| Provider | Prototype status | How data gets in today |
|---|---|---|
| DBS/POSB, OCBC, UOB, Standard Chartered | User-authorised import | Internet-banking CSV or Excel export, or the SavvyMoni template |
| Trust, GXS, MariBank | User-authorised import | Manual balance, or an export where the app provides one |
| Credit/debit cards | User-authorised import | Statement export; card numbers never needed |
| PayNow, SGQR, NETS | Not available | Appear inside bank exports; no consumer payment-history API is assumed |
| DBS PayLah!, GrabPay | Planned | Via bank exports until a partnership exists |
| SGFinDex | Planned | Not accessed |
| FairPrice | User-authorised import | Bank or card export; receipts listed in the template or split by hand |
| Sheng Siong, Giant, Cold Storage | User-authorised import | Manual receipts or bank export |
| HealthHub | Planned | Not accessed; bill breakdowns are entered by hand |
| Polyclinics, GPs, hospitals, pharmacies | User-authorised import | Manual bill breakdown |
| SimplyGo | User-authorised import | Fares in card or bank exports; no public transaction API is assumed |
| EZ-Link, ride-hailing | User-authorised import | Manual / bank export |
| SP Group, town council, telcos, insurers, rent | User-authorised import | Bills entered once, recurring |

## Phase 1: pilot (no new provider access)

- Done in the prototype: `.xlsx`/`.csv` import with header detection, a template, and detection of regular income and bills with user review.
- Next: column-mapping presets for the main Singapore, Philippine and Myanmar bank and mobile-wallet exports, tested against real (redacted) sample files from pilot participants.
- Receipt photo capture with on-device OCR as an optional step; the user confirms every line.
- PDF statement and medical-bill parsing, done locally, with a review screen.

Complexity: low to medium. No regulatory dependency beyond the pilot's own consent process.

## Phase 2: partner integrations

### Banks and wallets

- **Path:** embed SavvyMoni as a feature inside a partner bank or wallet, or obtain read access under a bilateral API agreement.
- **SGFinDex:** a public digital infrastructure built on Singpass that lets individuals consent to view balances from participating banks, insurers, CDP and government agencies (CPF, IRAS, HDB) in one place; it does not store the data itself ([ABS, SGFinDex](https://www.abs.org.sg/consumer-banking/sgfindex)). Using it would require becoming an authorised participant or working through one.
- **Permission:** written agreement with each provider; explicit, granular customer consent per account; revocation that deletes data.
- **Authentication:** provider-hosted OAuth-style consent or Singpass via approved integration only. SavvyMoni never handles banking credentials.
- **Data security:** server-side token vault, encryption at rest, least-privilege scopes (balances and transactions only; no payment initiation).
- **Regulatory dependencies:** MAS review of the service's classification, technology risk management and outsourcing expectations of the partner bank, PDPA obligations.
- **Complexity:** high; months per provider.

### Groceries (FairPrice and others)

- **Path:** partnership for opt-in e-receipt export (for example via a loyalty app), not account scraping.
- **Value:** itemised baskets let essential and discretionary items be separated automatically.
- **Complexity:** medium; depends on the partner's receipt data model.

### Healthcare billing

- **Path:** only bill amounts, due dates and payer breakdown (subsidy, insurance, MediSave, out-of-pocket). Never clinical data, diagnoses or medical records.
- **Permission:** agreement with the billing owner and a narrowly scoped consent; health-sector data governance review.
- **Complexity:** high, mostly governance rather than engineering.

### Transport

- **Path:** opt-in fare history export via the operator or card issuer; until then, bank and card exports already capture top-ups and fares.
- **Complexity:** medium.

### Utilities and household

- **Path:** e-bill notifications (amount and due date) forwarded by the user or obtained through partners.
- **Complexity:** low to medium.

## Phase 3: actions

Moving money (for example a "save this amount" button that triggers a transfer) would be done only through a licensed partner's own payment initiation, with the partner holding the regulatory responsibility. SavvyMoni itself would remain an information and guidance layer.

## Engineering checklist for any real connector

1. Implement `FinancialDataConnector` server-side.
2. Map provider fields to `Transaction` with `source: 'imported'` (or a new `'api'` source) and `providerId`.
3. Validate, normalise and de-duplicate exactly as the spreadsheet importer does.
4. Store consent records (scope, time, expiry) and wire revocation to `disconnect()`, which deletes that provider's data.
5. Add monitoring for sync failures; show "last synced" in the Integrations hub.
6. Only then change the provider's status in `src/connectors/providers.ts` to `real-api`.
