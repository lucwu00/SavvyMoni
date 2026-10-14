/** State-level versions of the nine required demo flows. The browser versions live in scripts/e2e.mjs. */
import { describe, expect, it } from 'vitest';
import { buildPersonaState } from '../src/data/personas';
import { benchmarkBaseFromState, defaultBenchmarkConfig, runBenchmark } from '../src/domain/benchmark';
import { parseCSV } from '../src/domain/csv';
import { marketFor } from '../src/config/markets';
import { emptyState } from '../src/import/build';
import { sampleWorkbook } from '../src/import/samples';
import { draftFromSheets } from '../src/import/workbook';
import { readXlsx } from '../src/import/xlsx';
import { addDays } from '../src/domain/dates';
import { computeRecommendation } from '../src/domain/engine';
import { liquidBalance } from '../src/domain/forecast';
import { toCents } from '../src/domain/money';
import { planRecovery } from '../src/domain/recovery';
import { defaultShockInput, SHOCK_PRESETS } from '../src/domain/shock';
import { loadState, MemoryStorage, saveState } from '../src/state/persistence';
import { manualTransaction, reducer } from '../src/state/reducer';
import { bankCsv, TODAY } from './helpers';

/** Persona fixtures stand in for a user who has already imported their records. */
const start = (id: Parameters<typeof buildPersonaState>[0]) => ({ ...buildPersonaState(id, TODAY), onboarded: true });

describe('Demo flows', () => {
  it('A: importing a workbook during setup produces a full assessment', async () => {
    const sheets = await readXlsx(sampleWorkbook('SG', TODAY, 'household'));
    const draft = draftFromSheets(sheets, 'household.xlsx', 'xlsx', { market: marketFor('SG'), today: TODAY, rules: [], existing: [] });
    expect(draft.income.filter((i) => i.include).length).toBeGreaterThan(0);
    expect(draft.bills.filter((b) => b.include).length).toBeGreaterThan(3);
    const s = reducer(
      emptyState('SG', TODAY),
      { type: 'IMPORT_DRAFT', draft, choices: { displayName: 'Mei', accounts: draft.accounts.map((a) => ({ ...a, balanceCents: a.balanceCents ?? 0 })), dailyEssentialCents: draft.dailyEssentialCents, dailyDiscretionaryCents: 0 } },
      TODAY,
    );
    expect(s.onboarded).toBe(true);
    expect(s.profile.displayName).toBe('Mei');
    const r = computeRecommendation(s, TODAY);
    expect(r.status).not.toBe('insufficient');
    expect(r.protectedItems.length).toBeGreaterThan(5);
    expect(r.explanation.length).toBeGreaterThan(5);
    expect(r.spend.source).toBe('history');
    expect(s.history.length).toBe(1);
  });

  it('B: a new FairPrice purchase lowers cash and updates the recommendation', () => {
    let s = start('student');
    expect(s.transactions.filter((t) => t.providerId === 'fairprice').length).toBeGreaterThan(4);
    const before = computeRecommendation(s, TODAY);
    const t = manualTransaction('FairPrice Tampines Hub', -toCents(60), TODAY, s.rules, undefined, 'fairprice');
    s = reducer(s, { type: 'ADD_TRANSACTION', tx: t, affectBalance: true }, TODAY);
    const after = computeRecommendation(s, TODAY);
    expect(after.liquidCents).toBe(before.liquidCents - toCents(60));
    expect(after.maxSafeCents).toBeLessThan(before.maxSafeCents);
    expect(s.history[s.history.length - 1].reason).toContain('FairPrice');
  });

  it('C: an unexpected S$400 dental bill changes emergency readiness', () => {
    let s = start('earlycareer');
    const before = computeRecommendation(s, TODAY);
    s = reducer(
      s,
      {
        type: 'ADD_HEALTH_BILL',
        bill: { id: 'dent', provider: 'Dental clinic', providerType: 'dental', visitDate: TODAY, dueDate: addDays(TODAY, 7), billedCents: toCents(400), subsidyCents: 0, insuranceCents: 0, medisaveCents: 0, status: 'unpaid', source: 'user' },
      },
      TODAY,
    );
    const withBill = computeRecommendation(s, TODAY);
    expect(withBill.maxSafeCents).toBe(before.maxSafeCents - toCents(400));
    s = reducer(s, { type: 'APPLY_SHOCK', input: defaultShockInput(SHOCK_PRESETS.find((p) => p.id === 'dental')!, s) }, TODAY);
    const afterShock = computeRecommendation(s, TODAY);
    expect(afterShock.coverageMonths).toBeLessThan(before.coverageMonths);
    expect(afterShock.status).toBe('rebuild');
  });

  it('D: lower gig income reduces or pauses contributions', () => {
    let s = start('rider');
    const before = computeRecommendation(s, TODAY);
    s = reducer(s, { type: 'UPDATE_INCOME', id: 'i-payout', patch: { netAmountCents: toCents(300) } }, TODAY);
    const after = computeRecommendation(s, TODAY);
    expect(after.maxSafeCents).toBeLessThan(before.maxSafeCents);
    expect(after.recommendedCents).toBeLessThan(before.recommendedCents);
    expect(s.history[s.history.length - 1].reason).toContain('Delivery payouts');
    s = reducer(s, { type: 'UPDATE_INCOME', id: 'i-payout', patch: { netAmountCents: toCents(150) } }, TODAY);
    expect(computeRecommendation(s, TODAY).status).toBe('pause');
  });

  it('E: a withdrawal produces a rebuilding plan with three scenarios', () => {
    let s = start('household');
    s = reducer(s, { type: 'APPLY_SHOCK', input: defaultShockInput(SHOCK_PRESETS.find((p) => p.id === 'repair')!, s) }, TODAY);
    const r = computeRecommendation(s, TODAY);
    const plan = planRecovery(s, r, { targetCents: s.peakEmergencyCents, pauseWeeks: 2 });
    expect(plan.gapCents).toBeGreaterThan(0);
    expect(plan.scenarios.map((x) => x.id)).toEqual(['conservative', 'balanced', 'optimistic']);
    const bal = plan.scenarios[1];
    expect(bal.schedule[0].contributionCents).toBe(0);
    expect(bal.schedule[2].contributionCents).toBeLessThanOrEqual(r.maxSafeCents);
    expect(plan.scenarios.some((x) => x.weeksToTarget !== null)).toBe(true);
  });

  it('F: strategies run on identical histories and the adaptive plan reacts to an income drop', () => {
    const s = start('rider');
    const r = computeRecommendation(s, TODAY);
    const base = benchmarkBaseFromState(s, r);
    const cfg = defaultBenchmarkConfig(base, s.settings.minCashReserveCents);
    const normal = runBenchmark(base, cfg);
    expect(normal.results.every((x) => x.weeks.length === 26)).toBe(true);
    const dropped = runBenchmark(base, { ...cfg, incomeChange: -0.6, medicalBillCents: toCents(1500) });
    const a0 = normal.results.find((x) => x.id === 'adaptive')!;
    const a1 = dropped.results.find((x) => x.id === 'adaptive')!;
    expect(a1.metrics.pausedWeeks).toBeGreaterThan(a0.metrics.pausedWeeks);
    // Fixed strategies keep contributing regardless; their contributions don't adapt to need.
    const w1 = dropped.results.find((x) => x.id === 'fixedWeekly')!;
    expect(w1.metrics.pausedWeeks).toBeLessThan(a1.metrics.pausedWeeks);
  });

  it('G: importing a CSV categorises transactions and records the import', () => {
    let s = start('student');
    const n = s.transactions.length;
    const draft = draftFromSheets({ Transactions: parseCSV(bankCsv()) }, 'export.csv', 'csv', { market: marketFor('SG'), today: TODAY, rules: s.rules, existing: s.transactions });
    s = reducer(s, { type: 'IMPORT_DRAFT', draft, choices: { accounts: [], dailyEssentialCents: 0, dailyDiscretionaryCents: 0 } }, TODAY);
    expect(s.transactions.length).toBe(n + 13);
    expect(s.connectors.spreadsheet.recordCount).toBe(13);
    expect(s.transactions.find((t) => t.merchant.includes('SHENG SIONG'))?.category).toBe('groceries');
    s = reducer(s, { type: 'DELETE_IMPORTED' }, TODAY);
    expect(s.transactions.length).toBe(n);
  });

  it('H: changes persist across a reload', () => {
    const storage = new MemoryStorage();
    let s = start('student');
    s = reducer(s, { type: 'RECORD_CONTRIBUTION', amountCents: toCents(20), kind: 'deposit' }, TODAY);
    saveState(storage, s);
    const reloaded = loadState(storage)!;
    expect(liquidBalance(reloaded)).toBe(liquidBalance(s));
    expect(reloaded.contributions.length).toBe(s.contributions.length);
  });

  it('I: start again removes every record', () => {
    let s = reducer(start('student'), { type: 'PAY_BILL', id: 'b-rent' }, TODAY);
    s = reducer(s, { type: 'RESET' }, TODAY);
    expect(s.onboarded).toBe(false);
    expect(liquidBalance(s)).toBe(0);
    expect(s.bills.length + s.transactions.length).toBe(0);
  });
});

describe('Paying a bill is never double counted', () => {
  it('lowers cash and removes that occurrence from the forecast', () => {
    const s0 = start('student');
    const r0 = computeRecommendation(s0, TODAY);
    const s1 = reducer(s0, { type: 'PAY_BILL', id: 'b-rent' }, TODAY);
    const r1 = computeRecommendation(s1, TODAY);
    expect(r1.liquidCents).toBe(r0.liquidCents - toCents(650));
    expect(r1.protectedItems.filter((p) => p.label === 'Room rental').length).toBe(r0.protectedItems.filter((p) => p.label === 'Room rental').length - 1);
    // Paying early shouldn't make the plan look worse than waiting.
    expect(r1.maxSafeCents).toBeGreaterThanOrEqual(r0.maxSafeCents - 1);
  });
});
