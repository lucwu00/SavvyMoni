/** Country independence: one engine, three currencies, no conversion on switching. */
import { describe, expect, it } from 'vitest';
import { MARKETS, marketFor } from '../src/config/markets';
import { buildPersonaState } from '../src/data/personas';
import { parseCSV } from '../src/domain/csv';
import { draftFromSheets } from '../src/import/workbook';
import { addDays } from '../src/domain/dates';
import { computeRecommendation } from '../src/domain/engine';
import { liquidBalance } from '../src/domain/forecast';
import { milestones } from '../src/domain/goals';
import { formatMoney, MMK, parseMoney, PHP } from '../src/domain/money';
import { presetsFor, simulateShock, defaultShockInput } from '../src/domain/shock';
import type { AppState } from '../src/domain/types';
import { switchCountry } from '../src/state/country';
import { MemoryStorage } from '../src/state/persistence';
import { reducer } from '../src/state/reducer';
import { bill, blankState, salary, TODAY } from './helpers';

/** Scale every money field of a state by a factor and set its country. */
function inCountry(s: AppState, market: 'PH' | 'MM', factor: number): AppState {
  const k = (v: number) => v * factor;
  return {
    ...s,
    marketCode: market,
    accounts: s.accounts.map((a) => ({ ...a, balanceCents: k(a.balanceCents) })),
    incomeSources: s.incomeSources.map((i) => ({ ...i, netAmountCents: k(i.netAmountCents) })),
    bills: s.bills.map((b) => ({ ...b, amountCents: k(b.amountCents) })),
    profile: { ...s.profile, fallbackDailyEssentialCents: k(s.profile.fallbackDailyEssentialCents), fallbackDailyDiscretionaryCents: k(s.profile.fallbackDailyDiscretionaryCents) },
    settings: { ...s.settings, minCashReserveCents: k(s.settings.minCashReserveCents) },
    peakEmergencyCents: k(s.peakEmergencyCents),
  };
}

describe('Currency handling', () => {
  it('parses and formats kyat without minor units', () => {
    expect(parseMoney('25,000', MMK)).toBe(25000);
    expect(parseMoney('K25,000', MMK)).toBe(25000);
    expect(parseMoney('25000', MMK)).toBe(25000);
    expect(parseMoney('1,250,000', MMK)).toBe(1250000);
    expect(parseMoney('25.5', MMK)).toBe(null);
    expect(formatMoney(2500000, {}, MMK)).toBe('K2,500,000');
    expect(formatMoney(-1500, {}, MMK)).toBe('−K1,500');
  });

  it('parses and formats pesos with centavos', () => {
    expect(parseMoney('₱1,234.50', PHP)).toBe(123450);
    expect(parseMoney('80', PHP)).toBe(8000);
    expect(formatMoney(123450, {}, PHP)).toBe('₱1,234.50');
  });

  it('imports kyat amounts from CSV correctly', () => {
    const text = `Date,Description,Amount\n${addDays(TODAY, -2)},Hlaing Tharyar zay,-25000\n${addDays(TODAY, -1)},Overtime pay,18000`;
    const p = draftFromSheets({ Transactions: parseCSV(text) }, 'cash.csv', 'csv', { market: marketFor('MM'), today: TODAY, rules: [], existing: [] });
    expect(p.transactions.map((t) => t.amountCents)).toEqual([-25000, 18000]);
    expect(p.transactions[0].category).toBe('groceries');
    expect(p.transactions[1].subcategory).toBe('overtime');
  });
});

describe('One engine, consistent results in every country', () => {
  const sg = blankState({ incomeSources: [salary(3000, 10)], bills: [bill('Rent', 1500, 3)] });

  it('gives proportionally identical safe maximums in SGD, PHP and MMK', () => {
    const rSG = computeRecommendation(sg, TODAY);
    const rPH = computeRecommendation(inCountry(sg, 'PH', 40), TODAY);
    const rMM = computeRecommendation(inCountry(sg, 'MM', 30), TODAY);
    expect(rSG.maxSafeCents).toBe(20000);
    expect(rPH.maxSafeCents).toBe(rSG.maxSafeCents * 40);
    expect(rMM.maxSafeCents).toBe(rSG.maxSafeCents * 30);
    expect(rPH.limitingFactor?.date).toBe(rSG.limitingFactor?.date);
    expect(rMM.limitingFactor?.date).toBe(rSG.limitingFactor?.date);
    expect(rPH.confidence).toBe(rSG.confidence);
    expect(rMM.currency.code).toBe('MMK');
  });

  it('rounds recommendations to each country’s own step and never exceeds the safe maximum', () => {
    for (const [code, s] of [
      ['SG', sg],
      ['PH', inCountry(sg, 'PH', 40)],
      ['MM', inCountry(sg, 'MM', 30)],
    ] as const) {
      const r = computeRecommendation(s, TODAY);
      const m = MARKETS[code];
      const step = m.rounding.stepMajor * 10 ** m.currency.minorUnits;
      expect(r.recommendedCents).toBeLessThanOrEqual(r.maxSafeCents);
      expect(r.recommendedCents % step).toBe(0);
    }
  });

  it('handles daily income and daily bills', () => {
    const s = blankState({
      marketCode: 'MM',
      accounts: [{ id: 'cash', name: 'Cash', institution: 'Cash', kind: 'cash', role: 'spending', balanceCents: 300_000, asOf: TODAY, source: 'user' }],
      incomeSources: [salary(0, 0, { id: 'd', kind: 'business', frequency: 'daily', netAmountCents: 150_000, certainty: 'confirmed' })],
      bills: [bill('Stall', 0, 0, { id: 'st', frequency: 'daily', amountCents: 10_000, category: 'business', subcategory: 'stall-rent' })],
      settings: { ...blankState().settings, horizonDays: 7, minCashReserveCents: 50_000 },
    });
    s.profile.fallbackDailyEssentialCents = 100_000;
    const r = computeRecommendation(s, TODAY);
    expect(r.projection.flatMap((d) => d.events).filter((e) => e.kind === 'income').length).toBe(7);
    expect(r.protectedItems.length).toBe(7);
    // Each day nets +40k, so the lowest point is this morning's 300k (before today's sales), minus the 50k reserve.
    expect(r.maxSafeCents).toBe(250_000);
  });
});

describe('Country demos', () => {
  it('builds PH and MM personas in their own currency with integer amounts', () => {
    for (const id of ['ph-rider', 'mm-worker'] as const) {
      const s = buildPersonaState(id, TODAY);
      expect(s.marketCode).toBe(id === 'ph-rider' ? 'PH' : 'MM');
      expect(s.transactions.every((t) => Number.isInteger(t.amountCents))).toBe(true);
      const r = computeRecommendation(s, TODAY);
      expect(r.status).not.toBe('insufficient');
      expect(r.spend.source).toBe('history');
    }
    const mmState = buildPersonaState('mm-worker', TODAY);
    expect(mmState.accounts.some((a) => a.kind === 'bank')).toBe(false);
    expect(mmState.settings.simpleMode).toBe(true);
  });

  it('uses country-specific shocks, milestones and rounding', () => {
    expect(presetsFor('PH').find((p) => p.id === 'moto-repair')?.costCents).toBe(800_000);
    expect(presetsFor('MM').find((p) => p.id === 'clinic')?.costCents).toBe(80_000);
    const mm = buildPersonaState('mm-worker', TODAY);
    const r = computeRecommendation(mm, TODAY);
    expect(milestones(mm, r.monthlyEssentialCents)[0].label).toBe('First K50,000');
    const shock = simulateShock(mm, defaultShockInput(presetsFor('MM')[0], mm), TODAY);
    expect(shock.incomeLostCents).toBeGreaterThan(0);
    expect(shock.strategy.join(' ')).not.toContain('S$');
  });
});

describe('Switching country never converts records', () => {
  it('parks and restores each country’s own state', () => {
    const storage = new MemoryStorage();
    let sg = reducer({ ...buildPersonaState('household', TODAY), onboarded: true }, { type: 'RECORD_CONTRIBUTION', amountCents: 5000, kind: 'deposit' }, TODAY);
    const ph = switchCountry(sg, 'PH', storage, TODAY);
    // A country the user has not set up starts empty, at setup.
    expect(ph.marketCode).toBe('PH');
    expect(ph.onboarded).toBe(false);
    expect(ph.transactions.length + ph.accounts.length).toBe(0);
    const phEdited = reducer({ ...buildPersonaState('ph-rider', TODAY), onboarded: true }, { type: 'RECORD_CONTRIBUTION', amountCents: 10000, kind: 'deposit' }, TODAY);
    const mmState = switchCountry(phEdited, 'MM', storage, TODAY);
    expect(mmState.marketCode).toBe('MM');
    const backToSG = switchCountry(mmState, 'SG', storage, TODAY);
    expect(liquidBalance(backToSG)).toBe(liquidBalance(sg));
    expect(backToSG.contributions).toEqual(sg.contributions);
    const backToPH = switchCountry(backToSG, 'PH', storage, TODAY);
    expect(liquidBalance(backToPH)).toBe(liquidBalance(phEdited));
    sg = backToSG;
    expect(sg.marketCode).toBe('SG');
  });
});

describe('Cash book', () => {
  it('records cash in and out, advances daily income, and can undo an entry', () => {
    let s = buildPersonaState('mm-worker', TODAY);
    const start = liquidBalance(s);
    const next = s.incomeSources.find((i) => i.id === 'i-mm-ot')!.nextDate;
    s = reducer(s, { type: 'RECEIVE_INCOME', id: 'i-mm-ot', amountCents: 200_000, accountId: 'm-cash' }, TODAY);
    expect(liquidBalance(s)).toBe(start + 200_000);
    expect(s.incomeSources.find((i) => i.id === 'i-mm-ot')!.nextDate > next).toBe(true);
    s = reducer(
      s,
      {
        type: 'ADD_TRANSACTION',
        affectBalance: true,
        tx: { id: 'c1', date: TODAY, merchant: 'Rice and oil', description: 'Rice and oil', amountCents: -150_000, category: 'groceries', subcategory: 'zay', essentiality: 'essential', source: 'user', providerId: 'cash-ledger', accountId: 'm-cash', confidence: 'high' },
      },
      TODAY,
    );
    expect(liquidBalance(s)).toBe(start + 50_000);
    s = reducer(s, { type: 'DELETE_TRANSACTION', id: 'c1', revertBalance: true }, TODAY);
    expect(liquidBalance(s)).toBe(start + 200_000);
  });
});

describe('Myanmar and languages', () => {
  it('runs the same engine in whole kyat and keeps every bill covered', async () => {
    const { samplePlan } = await import('../src/import/samples');
    const s = await samplePlan('MM', TODAY);
    expect(s.marketCode).toBe('MM');
    const r = computeRecommendation(s, TODAY);
    expect(r.recommendedCents % 1000).toBe(0);
    const after = r.projection.map((d) => d.closingCents - r.recommendedCents);
    expect(Math.min(...after)).toBeGreaterThanOrEqual(r.floorCents);
    const shock = simulateShock(s, defaultShockInput(presetsFor('MM').find((p) => p.id === 'clinic')!, s), TODAY);
    expect(shock).toBeTruthy();
  });

  it('offers each country its own languages and falls back to English when switching', async () => {
    const lang = (c: string) => marketFor(c).languages.map((l) => l.code);
    expect(lang('SG')).toEqual(['en', 'zh', 'ms', 'ta']);
    expect(lang('PH')).toEqual(['en', 'fil']);
    expect(lang('MM')).toEqual(['en', 'my']);
    const storage = new MemoryStorage();
    const base = blankState();
    const sg: AppState = { ...base, marketCode: 'SG', settings: { ...base.settings, language: 'ta' } };
    const mm = switchCountry(sg, 'MM', storage, TODAY);
    expect(mm.marketCode).toBe('MM');
    expect(mm.settings.language).toBe('en');
  });

  it('translates the start page and cash book in every offered language', async () => {
    const { t } = await import('../src/ui/i18n');
    for (const code of ['zh', 'ms', 'ta', 'fil', 'my'] as const) {
      for (const key of ['onb.title', 'onb.cash', 'cash.in', 'cash.out', 'status.safe', 'nav.cashbook'] as const) expect(t(key, code)).not.toBe(t(key, 'en'));
    }
    expect(t('cs.sub', 'ta', { cur: 'SGD' })).toContain('SGD');
  });
});

describe('Patterns from a hand-kept cash book', () => {
  const cashOnly = (): AppState => {
    const s = buildPersonaState('mm-worker', TODAY);
    return { ...s, incomeSources: [], bills: [], transactions: s.transactions.map((t) => ({ ...t, billId: undefined, source: 'user' as const })) };
  };

  it('finds wages and rent in weeks of cash book entries and adds only what the user picks', async () => {
    const { findPatterns } = await import('../src/import/patterns');
    const s = cashOnly();
    const f = findPatterns(s, TODAY);
    const wages = f.income.find((d) => /wages/i.test(d.item.name))!;
    expect(wages.item.frequency).toBe('fortnightly');
    const room = f.bills.find((d) => d.item.category === 'housing')!;
    expect(room.item.frequency).toBe('monthly');
    expect(f.bills.some((d) => d.item.category === 'food' || d.item.category === 'groceries')).toBe(false);
    const next = reducer(s, { type: 'ADOPT_PATTERNS', income: [wages.item], bills: [{ bill: room.item, txIds: room.txIds }] }, TODAY);
    expect(next.incomeSources.map((i) => i.id)).toEqual([wages.item.id]);
    expect(next.bills.map((b) => b.id)).toEqual([room.item.id]);
    // Past rent payments are linked so they are not also counted as everyday spending.
    expect(next.transactions.filter((t) => t.billId === room.item.id).length).toBe(room.txIds.length);
    // Already-tracked items are not suggested again.
    const again = findPatterns(next, TODAY);
    expect(again.income.some((d) => /wages/i.test(d.item.name))).toBe(false);
    expect(again.bills.some((d) => d.item.category === 'housing')).toBe(false);
    // The plan now counts the wages.
    expect(computeRecommendation(next, TODAY).projection.flatMap((d) => d.events).some((e) => e.kind === 'income')).toBe(true);
  });

  it('suggests nothing from a few days of entries', async () => {
    const { findPatterns } = await import('../src/import/patterns');
    const s = cashOnly();
    const recent = { ...s, transactions: s.transactions.filter((t) => t.date >= addDays(TODAY, -6)) };
    const f = findPatterns(recent, TODAY);
    expect(f.income.length + f.bills.filter((d) => d.item.frequency !== 'daily' && d.item.frequency !== 'weekly').length).toBe(0);
  });
});
