/**
 * Benchmark Lab: run three savings strategies against the same synthetic
 * 26-week income and spending history and report trade-offs honestly.
 * The adaptive strategy uses the same "lowest projected balance above the
 * reserve" rule as the engine, on a weekly grid.
 */
import type { Recommendation } from './engine';
import { maxSafeFromFlows } from './forecast';
import { rng } from './ids';
import { roundDownTo, type Cents } from './money';
import { marketFor, minor } from '../config/markets';
import { monthlyFactor } from './recurrence';
import type { AppState } from './types';

export type StrategyId = 'adaptive' | 'fixed10' | 'fixedWeekly';

export const STRATEGY_LABELS: Record<StrategyId, string> = {
  adaptive: 'SavvyMoni adaptive',
  fixed10: 'Fixed 10% of income',
  fixedWeekly: 'Fixed weekly amount',
};

export interface BenchmarkConfig {
  weeks: number;
  seed: number;
  /** Change to income from `incomeChangeWeek` onwards, e.g. -0.4 = 40% less. */
  incomeChange: number;
  incomeChangeWeek: number;
  /** Extra medical bill injected by the user. 0 = none. */
  medicalBillCents: Cents;
  medicalWeek: number;
  volatility: number;
  fixedWeeklyCents: Cents;
  floorCents: Cents;
}

export interface BenchmarkBase {
  /** Country rounding and shock size, so the same rules apply in every currency. */
  stepCents: Cents;
  minActionableCents: Cents;
  shockCents: Cents;
  monthlyIncomeCents: Cents;
  payFrequency: 'weekly' | 'fortnightly' | 'monthly';
  weeklyEssentialCents: Cents;
  weeklyDiscretionaryCents: Cents;
  monthlyBillsCents: Cents;
  startingCashCents: Cents;
  startingSavingsCents: Cents;
  baseVolatility: number;
  variableIncome: boolean;
}

export interface WeekInput {
  week: number;
  incomeCents: Cents;
  expectedIncomeCents: Cents;
  essentialCents: Cents;
  discretionaryCents: Cents;
  billsCents: Cents;
  shockCents: Cents;
  shockLabel?: string;
}

export interface WeekResult {
  week: number;
  contributionCents: Cents;
  withdrawalCents: Cents;
  savingsCents: Cents;
  cashCents: Cents;
  unmetCents: Cents;
  rescued: boolean;
}

export interface StrategyMetrics {
  finalSavingsCents: Cents;
  totalContributedCents: Cents;
  totalWithdrawnCents: Cents;
  rescueWeeks: number;
  /** Rescues in weeks without a shock: the savings plan itself caused the squeeze. */
  squeezeWeeks: number;
  unmetCents: Cents;
  lowCashWeeks: number;
  shocksAbsorbed: number;
  shocksTotal: number;
  contributionStdDevCents: Cents;
  pausedWeeks: number;
  rebuildWeeks: number | null;
  lowestSavingsCents: Cents;
}

export interface StrategyResult {
  id: StrategyId;
  label: string;
  weeks: WeekResult[];
  metrics: StrategyMetrics;
}

export function benchmarkBaseFromState(state: AppState, rec: Recommendation): BenchmarkBase {
  const sources = state.incomeSources.filter((s) => s.netAmountCents > 0);
  const monthlyIncome = sources.reduce((t, s) => t + s.netAmountCents * monthlyFactor(s.frequency) * (s.certainty === 'uncertain' ? 0.5 : 1), 0);
  const main = [...sources].sort((a, b) => b.netAmountCents * monthlyFactor(b.frequency) - a.netAmountCents * monthlyFactor(a.frequency))[0];
  const totalW = sources.reduce((t, s) => t + s.netAmountCents, 0);
  const vol = totalW > 0 ? sources.reduce((t, s) => t + s.netAmountCents * (s.certainty === 'uncertain' ? 0.5 : s.variability), 0) / totalW : 0.2;
  const monthlyBills = state.bills.filter((b) => b.frequency !== 'once').reduce((t, b) => t + b.amountCents * monthlyFactor(b.frequency), 0);
  const market = marketFor(state.marketCode);
  return {
    stepCents: minor(market, market.rounding.stepMajor),
    minActionableCents: minor(market, market.rounding.minActionableMajor),
    shockCents: minor(market, market.benchmarkShockMajor),
    monthlyIncomeCents: Math.round(monthlyIncome),
    // Daily earnings are summed into the weekly grid.
    payFrequency: main ? (main.frequency === 'daily' ? 'weekly' : (main.frequency as BenchmarkBase['payFrequency'])) : 'monthly',
    weeklyEssentialCents: rec.spend.dailyEssentialCents * 7,
    weeklyDiscretionaryCents: rec.spend.dailyDiscretionaryCents * 7,
    monthlyBillsCents: Math.round(monthlyBills),
    startingCashCents: rec.liquidCents,
    startingSavingsCents: rec.emergencyCents,
    baseVolatility: Math.round(vol * 100) / 100,
    variableIncome: sources.some((s) => s.kind === 'gig' || s.kind === 'parttime' || s.kind === 'business'),
  };
}

export function defaultBenchmarkConfig(base: BenchmarkBase, floorCents: Cents): BenchmarkConfig {
  return {
    weeks: 26,
    seed: 2026,
    incomeChange: 0,
    incomeChangeWeek: 13,
    medicalBillCents: 0,
    medicalWeek: 18,
    volatility: base.baseVolatility,
    fixedWeeklyCents: Math.max(base.minActionableCents, roundDownTo(Math.round(((base.monthlyIncomeCents * 0.1) * 12) / 52), base.minActionableCents)),
    floorCents,
  };
}

const monthStartWeek = (w: number) => Math.floor((w * 7) / 30.42) !== Math.floor(((w - 1) * 7) / 30.42) || w === 0;

/** The synthetic history, identical for every strategy. */
export function generateHistory(base: BenchmarkBase, cfg: BenchmarkConfig): WeekInput[] {
  const r = rng(cfg.seed);
  const out: WeekInput[] = [];
  const perPayment =
    base.payFrequency === 'weekly' ? (base.monthlyIncomeCents * 12) / 52 : base.payFrequency === 'fortnightly' ? (base.monthlyIncomeCents * 12) / 26 : base.monthlyIncomeCents;
  for (let w = 0; w < cfg.weeks; w++) {
    const paid =
      base.payFrequency === 'weekly' ? true : base.payFrequency === 'fortnightly' ? w % 2 === 1 : monthStartWeek(w + 1) && w > 0 ? true : false;
    // Monthly pay lands in the last week of each month; rent lands in the first.
    let factor = 1 + (r() * 2 - 1) * cfg.volatility;
    if (w >= cfg.incomeChangeWeek) factor *= 1 + cfg.incomeChange;
    // Built-in income dip for variable earners (weeks 15-16).
    if (base.variableIncome && (w === 15 || w === 16)) factor *= 0.4;
    const income = paid ? Math.max(0, Math.round(perPayment * factor)) : 0;
    // Scheduled amount before any change: the adaptive rule only learns about an income change once it has happened.
    const expected = paid ? Math.round(perPayment) : 0;
    const essential = Math.round(base.weeklyEssentialCents * (0.9 + r() * 0.2));
    const discretionary = Math.round(base.weeklyDiscretionaryCents * (0.75 + r() * 0.5));
    const bills = monthStartWeek(w) ? base.monthlyBillsCents : 0;
    let shock = 0;
    let shockLabel: string | undefined;
    if (w === 8) {
      shock = base.shockCents;
      shockLabel = 'Unexpected bill';
    }
    if (!base.variableIncome && w === 19) {
      shock = base.shockCents * 2;
      shockLabel = 'Urgent family support';
    }
    if (cfg.medicalBillCents > 0 && w === cfg.medicalWeek) {
      shock += cfg.medicalBillCents;
      shockLabel = shockLabel ? `${shockLabel} + medical bill` : 'Medical bill';
    }
    out.push({ week: w, incomeCents: income, expectedIncomeCents: expected, essentialCents: essential, discretionaryCents: discretionary, billsCents: bills, shockCents: shock, shockLabel });
  }
  return out;
}

function decide(id: StrategyId, w: WeekInput, i: number, history: WeekInput[], cash: Cents, base: BenchmarkBase, cfg: BenchmarkConfig, recentEssential: Cents): Cents {
  if (id === 'fixed10') return Math.round(w.incomeCents * 0.1);
  if (id === 'fixedWeekly') return cfg.fixedWeeklyCents;
  // Adaptive: look ahead five weeks using only what is known in advance:
  // scheduled bills, the recent essential average, the usual discretionary
  // spending, and expected income reduced by its volatility.
  const flows: Cents[] = [];
  for (let k = 0; k < 5; k++) {
    const f = history[i + k];
    if (!f) break;
    const known = i >= cfg.incomeChangeWeek ? 1 + cfg.incomeChange : 1;
    const inflow = k === 0 ? 0 : Math.floor(f.expectedIncomeCents * known * Math.max(0.1, 1 - cfg.volatility - 0.1));
    flows.push(inflow - f.billsCents - recentEssential - base.weeklyDiscretionaryCents);
  }
  const safe = maxSafeFromFlows(cash, flows, cfg.floorCents);
  if (safe < base.minActionableCents) return 0;
  return Math.max(base.stepCents, roundDownTo(Math.floor(safe * 0.6), base.stepCents));
}

export function runStrategy(id: StrategyId, history: WeekInput[], base: BenchmarkBase, cfg: BenchmarkConfig): StrategyResult {
  let cash = base.startingCashCents;
  let savings = base.startingSavingsCents;
  const weeks: WeekResult[] = [];
  let shocksAbsorbed = 0;
  let shocksTotal = 0;
  const essentialsSeen: Cents[] = [];
  for (let i = 0; i < history.length; i++) {
    const w = history[i];
    cash += w.incomeCents;
    const recentEssential = essentialsSeen.length
      ? Math.round(essentialsSeen.slice(-4).reduce((a, b) => a + b, 0) / Math.min(4, essentialsSeen.length))
      : base.weeklyEssentialCents;
    const wanted = decide(id, w, i, history, cash, base, cfg, recentEssential);
    const contribution = Math.max(0, Math.min(wanted, Math.max(0, cash)));
    cash -= contribution;
    savings += contribution;
    cash -= w.billsCents + w.essentialCents + w.discretionaryCents + w.shockCents;
    let withdrawal = 0;
    let unmet = 0;
    const rescued = cash < 0;
    if (cash < 0) {
      withdrawal = Math.min(savings, -cash);
      savings -= withdrawal;
      cash += withdrawal;
      if (cash < 0) {
        unmet = -cash;
        cash = 0;
      }
    }
    if (w.shockCents > 0) {
      shocksTotal++;
      if (unmet === 0) shocksAbsorbed++;
    }
    essentialsSeen.push(w.essentialCents);
    weeks.push({ week: w.week, contributionCents: contribution, withdrawalCents: withdrawal, savingsCents: savings, cashCents: cash, unmetCents: unmet, rescued });
  }
  const contribs = weeks.map((x) => x.contributionCents);
  const mean = contribs.reduce((a, b) => a + b, 0) / Math.max(1, contribs.length);
  const sd = Math.sqrt(contribs.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, contribs.length));

  // Time to rebuild after the largest withdrawal.
  let rebuildWeeks: number | null = null;
  let biggest = -1;
  weeks.forEach((x, i) => {
    if (x.withdrawalCents > 0 && (biggest < 0 || x.withdrawalCents > weeks[biggest].withdrawalCents)) biggest = i;
  });
  if (biggest >= 0) {
    const pre = biggest === 0 ? base.startingSavingsCents : weeks[biggest - 1].savingsCents;
    for (let j = biggest + 1; j < weeks.length; j++) {
      if (weeks[j].savingsCents >= pre) {
        rebuildWeeks = j - biggest;
        break;
      }
    }
  } else {
    rebuildWeeks = 0;
  }

  return {
    id,
    label: STRATEGY_LABELS[id],
    weeks,
    metrics: {
      finalSavingsCents: savings,
      totalContributedCents: contribs.reduce((a, b) => a + b, 0),
      totalWithdrawnCents: weeks.reduce((t, x) => t + x.withdrawalCents, 0),
      rescueWeeks: weeks.filter((x) => x.rescued).length,
      squeezeWeeks: weeks.filter((x, i) => x.rescued && history[i].shockCents === 0).length,
      unmetCents: weeks.reduce((t, x) => t + x.unmetCents, 0),
      lowCashWeeks: weeks.filter((x) => x.cashCents < cfg.floorCents).length,
      shocksAbsorbed,
      shocksTotal,
      contributionStdDevCents: Math.round(sd),
      pausedWeeks: contribs.filter((c) => c === 0).length,
      rebuildWeeks,
      lowestSavingsCents: Math.min(...weeks.map((x) => x.savingsCents)),
    },
  };
}

export function runBenchmark(base: BenchmarkBase, cfg: BenchmarkConfig): { history: WeekInput[]; results: StrategyResult[] } {
  const history = generateHistory(base, cfg);
  const results = (['adaptive', 'fixed10', 'fixedWeekly'] as StrategyId[]).map((id) => runStrategy(id, history, base, cfg));
  return { history, results };
}
