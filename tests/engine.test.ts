import { describe, expect, it } from 'vitest';
import { addDays, addMonths } from '../src/domain/dates';
import { computeRecommendation } from '../src/domain/engine';
import { rng } from '../src/domain/ids';
import { formatSGD, parseMoney, roundDownTo, sumCents, toCents } from '../src/domain/money';
import { occurrencesUntil } from '../src/domain/recurrence';
import type { AppState, Frequency, IncomeCertainty } from '../src/domain/types';
import { bill, blankState, salary, TODAY } from './helpers';

describe('Safe-to-Save engine: core cases', () => {
  it('zero income and no other data is "insufficient information" with S$0', () => {
    const r = computeRecommendation(blankState(), TODAY);
    expect(r.status).toBe('insufficient');
    expect(r.recommendedCents).toBe(0);
    expect(r.missingInfo.length).toBeGreaterThan(0);
  });

  it('zero income with known bills still protects bills and lowers confidence', () => {
    const s = blankState({ bills: [bill('Rent', 500, 10)] });
    const r = computeRecommendation(s, TODAY);
    // 2000 - 35 days x S$20 - 500 rent = 800 lowest; minus S$100 reserve
    expect(r.maxSafeCents).toBe(toCents(700));
    expect(r.confidence).toBe('low');
    expect(r.recommendedCents).toBeLessThanOrEqual(r.maxSafeCents);
  });

  it('ignores negative income amounts and warns', () => {
    const s = blankState({ bills: [bill('Rent', 500, 10)], incomeSources: [salary(-3000, 5)] });
    const r = computeRecommendation(s, TODAY);
    expect(r.countedIncomeCents).toBe(0);
    expect(r.warnings.join(' ')).toContain('zero or negative');
    expect(r.maxSafeCents).toBe(toCents(700));
  });

  it('zero expenses with no history asks for more information', () => {
    const s = blankState({ incomeSources: [salary(3000, 20)] });
    s.profile.fallbackDailyEssentialCents = 0;
    const r = computeRecommendation(s, TODAY);
    expect(r.status).toBe('insufficient');
    expect(r.recommendedCents).toBe(0);
  });

  it('zero everyday expenses but a known bill gives a precise safe maximum', () => {
    const s = blankState({ incomeSources: [salary(3000, 20)], bills: [bill('Phone', 100, 5)] });
    s.profile.fallbackDailyEssentialCents = 0;
    const r = computeRecommendation(s, TODAY);
    expect(r.maxSafeCents).toBe(toCents(1800));
  });

  it('protects rent due before payday', () => {
    const s = blankState({ incomeSources: [salary(3000, 10)], bills: [bill('Rent', 1500, 3)] });
    const r = computeRecommendation(s, TODAY);
    // Lowest point: day 9 = 2000 - 10x20 - 1500 = 300; minus reserve 100
    expect(r.maxSafeCents).toBe(toCents(200));
    expect(r.limitingFactor?.text).toContain('Rent');
    expect(r.protectedItems.some((p) => p.label === 'Rent')).toBe(true);
  });

  it('expenses greater than income: pauses and reports the shortfall', () => {
    const s = blankState({
      accounts: [{ id: 'spend', name: 'S', institution: 'B', kind: 'bank', role: 'spending', balanceCents: toCents(200), asOf: TODAY, source: 'user' }],
      incomeSources: [salary(1000, 5)],
      bills: [bill('Rent', 1500, 3)],
    });
    const r = computeRecommendation(s, TODAY);
    expect(r.status).toBe('pause');
    expect(r.recommendedCents).toBe(0);
    expect(r.shortfallCents).toBeGreaterThan(0);
    expect(r.message).not.toMatch(/fail|bad|irresponsible|should have/i);
  });

  it('late salary assumption lowers the safe amount', () => {
    const s = blankState({ incomeSources: [salary(3000, 10)], bills: [bill('Rent', 1500, 3)] });
    const onTime = computeRecommendation(s, TODAY);
    const late = computeRecommendation({ ...s, settings: { ...s.settings, incomeDelayDays: 3 } }, TODAY);
    expect(late.maxSafeCents).toBe(toCents(140));
    expect(late.maxSafeCents).toBeLessThan(onTime.maxSafeCents);
  });

  it('overdue salary is assumed to arrive tomorrow, not today', () => {
    const s = blankState({ incomeSources: [salary(3000, -2)], bills: [bill('Rent', 1900, 0)] });
    const r = computeRecommendation(s, TODAY);
    const income = r.projection.find((d) => d.events.some((e) => e.kind === 'income'));
    expect(income?.date).toBe(addDays(TODAY, 1));
  });

  it('an unpaid medical bill is protected; MediSave is only counted when stated', () => {
    const base = blankState({ incomeSources: [salary(3000, 10)], bills: [bill('Rent', 1500, 3)] });
    const hb = {
      id: 'hb1',
      provider: 'Dental clinic',
      providerType: 'dental' as const,
      visitDate: TODAY,
      dueDate: addDays(TODAY, 5),
      billedCents: toCents(400),
      subsidyCents: 0,
      insuranceCents: 0,
      medisaveCents: 0,
      status: 'unpaid' as const,
      source: 'user' as const,
    };
    const noCover = computeRecommendation({ ...base, healthBills: [hb] }, TODAY);
    expect(noCover.maxSafeCents).toBe(0);
    expect(noCover.status).toBe('pause');
    expect(noCover.shortfallCents).toBe(toCents(100));
    const withMedisave = computeRecommendation({ ...base, healthBills: [{ ...hb, medisaveCents: toCents(300) }] }, TODAY);
    expect(withMedisave.maxSafeCents).toBe(toCents(100));
  });

  it('insufficient liquid cash never yields a positive recommendation', () => {
    const s = blankState({
      accounts: [{ id: 'spend', name: 'S', institution: 'B', kind: 'bank', role: 'spending', balanceCents: toCents(150), asOf: TODAY, source: 'user' }],
      incomeSources: [salary(3000, 30)],
      bills: [bill('Phone', 30, 2)],
    });
    const r = computeRecommendation(s, TODAY);
    expect(r.recommendedCents).toBe(0);
    expect(r.status).toBe('pause');
  });

  it('income volatility reduces how much expected income is counted', () => {
    const mk = (v: number): AppState =>
      blankState({
        accounts: [{ id: 'spend', name: 'S', institution: 'B', kind: 'bank', role: 'spending', balanceCents: toCents(1000), asOf: TODAY, source: 'user' }],
        incomeSources: [salary(1000, 2, { kind: 'gig', certainty: 'expected', variability: v })],
        bills: [bill('Rent', 1200, 5)],
        settings: { ...blankState().settings, horizonDays: 7 },
      });
    const low = computeRecommendation(mk(0.1), TODAY);
    const high = computeRecommendation(mk(0.5), TODAY);
    expect(low.maxSafeCents).toBe(toCents(460));
    expect(high.maxSafeCents).toBe(toCents(60));
  });

  it('uncertain income is never relied on', () => {
    const s = blankState({ incomeSources: [salary(800, 3, { certainty: 'uncertain', variability: 0.4 })], bills: [bill('Rent', 500, 10)] });
    const r = computeRecommendation(s, TODAY);
    expect(r.countedIncomeCents).toBe(0);
    expect(r.excludedIncome.some((x) => x.reason.startsWith('Uncertain'))).toBe(true);
  });

  it('counts overlapping recurring bills on the same and different days', () => {
    const s = blankState({
      incomeSources: [salary(3000, 20)],
      bills: [
        bill('Rent', 300, 5, { id: 'a' }),
        bill('Utilities', 200, 5, { id: 'b' }),
        bill('Allowance', 50, 1, { id: 'c', frequency: 'weekly', category: 'family', subcategory: 'school-fees' }),
      ],
    });
    const r = computeRecommendation(s, TODAY);
    expect(r.protectedItems.length).toBe(7);
    expect(sumCents(r.protectedItems.map((p) => p.amountCents))).toBe(toCents(750));
  });

  it('monthly schedules do not drift after short months', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(occurrencesUntil('2026-01-31', 'monthly', '2026-04-30')).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
  });

  it('a paused plan recommends nothing, without judgement', () => {
    const s = blankState({ incomeSources: [salary(3000, 10)], bills: [bill('Rent', 500, 3)] });
    const r = computeRecommendation({ ...s, settings: { ...s.settings, pauseUntil: addDays(TODAY, 14) } }, TODAY);
    expect(r.status).toBe('pause');
    expect(r.recommendedCents).toBe(0);
    expect(r.headline).toBe('Savings are paused');
  });

  it('a weekly target that is not safe becomes "reduce contribution"', () => {
    const s = blankState({ incomeSources: [salary(3000, 10)], bills: [bill('Rent', 1500, 3)] });
    const r = computeRecommendation({ ...s, goal: { ...s.goal, weeklyTargetCents: toCents(500) } }, TODAY);
    expect(r.status).toBe('reduce');
    expect(r.recommendedCents).toBeLessThan(toCents(500));
  });
});

describe('Core invariant (randomised)', () => {
  it('never recommends a positive amount that pushes any projected day below the reserve', () => {
    const r = rng(42);
    const pick = <T,>(xs: T[]) => xs[Math.floor(r() * xs.length)];
    let positives = 0;
    for (let n = 0; n < 400; n++) {
      const incomes = Array.from({ length: Math.floor(r() * 3) }, (_, i) =>
        salary(Math.round(r() * 4000) - 200, Math.floor(r() * 34) - 3, {
          id: `i${i}`,
          frequency: pick<'weekly' | 'fortnightly' | 'monthly'>(['weekly', 'fortnightly', 'monthly']),
          certainty: pick<IncomeCertainty>(['confirmed', 'expected', 'uncertain']),
          variability: Math.round(r() * 60) / 100,
        }),
      );
      const bills = Array.from({ length: Math.floor(r() * 7) }, (_, i) =>
        bill(`B${i}`, Math.round(r() * 1500), Math.floor(r() * 40) - 3, {
          id: `b${i}`,
          frequency: pick<Frequency>(['once', 'weekly', 'fortnightly', 'monthly', 'quarterly']),
          priority: pick(['essential', 'adjustable', 'obligation', 'discretionary'] as const),
        }),
      );
      const s = blankState({
        accounts: [
          { id: 'spend', name: 'S', institution: 'B', kind: 'bank', role: 'spending', balanceCents: Math.round(r() * 600_000) - 20_000, asOf: TODAY, source: 'user' },
          { id: 'em', name: 'E', institution: 'B', kind: 'bank', role: 'emergency', balanceCents: Math.round(r() * 300_000), asOf: TODAY, source: 'user' },
        ],
        incomeSources: incomes,
        bills,
        settings: {
          ...blankState().settings,
          minCashReserveCents: Math.round(r() * 50_000),
          horizonDays: 14 + Math.floor(r() * 46),
          incomeDelayDays: Math.floor(r() * 4),
          discretionaryReservePct: Math.floor(r() * 101),
        },
      });
      s.profile.fallbackDailyEssentialCents = Math.round(r() * 6000);
      s.profile.fallbackDailyDiscretionaryCents = Math.round(r() * 2000);
      const rec = computeRecommendation(s, TODAY);
      expect(rec.recommendedCents).toBeGreaterThanOrEqual(0);
      expect(rec.recommendedCents).toBeLessThanOrEqual(rec.maxSafeCents);
      const baselineMin = Math.min(...rec.projection.map((d) => d.closingCents), rec.liquidCents);
      if (baselineMin < rec.floorCents) expect(rec.recommendedCents).toBe(0);
      if (rec.recommendedCents > 0) {
        positives++;
        for (const d of rec.projectionAfter) expect(d.closingCents).toBeGreaterThanOrEqual(rec.floorCents);
      }
    }
    expect(positives).toBeGreaterThan(20);
  });
});

describe('Currency precision', () => {
  it('parses money strings without floating point', () => {
    expect(parseMoney('S$1,234.56')).toBe(123456);
    expect(parseMoney('0.1')).toBe(10);
    expect(parseMoney('.5')).toBe(50);
    expect(parseMoney('(12.50)')).toBe(-1250);
    expect(parseMoney('-7')).toBe(-700);
    expect(parseMoney('12.345')).toBe(null);
    expect(parseMoney('abc')).toBe(null);
    expect(parseMoney('')).toBe(null);
  });
  it('adds many small amounts exactly', () => {
    const tenCents = Array.from({ length: 1000 }, () => parseMoney('0.10')!);
    expect(sumCents(tenCents)).toBe(10000);
    expect(parseMoney('0.1')! + parseMoney('0.2')!).toBe(parseMoney('0.3'));
  });
  it('formats SGD consistently', () => {
    expect(formatSGD(123456)).toBe('S$1,234.56');
    expect(formatSGD(-500)).toBe('−S$5');
    expect(formatSGD(500, { decimals: true })).toBe('S$5.00');
    expect(formatSGD(250000, { compact: true })).toBe('S$2.5k');
    expect(roundDownTo(1999, 500)).toBe(1500);
    expect(roundDownTo(-10, 500)).toBe(0);
  });
});
