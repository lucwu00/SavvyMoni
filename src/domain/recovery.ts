import { addDays, type ISODate } from './dates';
import type { Recommendation } from './engine';
import { DAYS_PER_MONTH } from './goals';
import { roundDownTo, type Cents } from './money';
import { marketFor, minor } from '../config/markets';
import { monthlyFactor } from './recurrence';
import type { AppState } from './types';

export type ScenarioId = 'conservative' | 'balanced' | 'optimistic';

export interface RecoveryWeek {
  week: number;
  date: ISODate;
  contributionCents: Cents;
  balanceCents: Cents;
}

export interface RecoveryScenario {
  id: ScenarioId;
  label: string;
  weeklyCents: Cents;
  firstWeekCents: Cents;
  weeksToTarget: number | null;
  reachDate: ISODate | null;
  schedule: RecoveryWeek[];
  assumptions: string[];
}

export interface RecoveryResult {
  currentCents: Cents;
  targetCents: Cents;
  gapCents: Cents;
  pauseWeeks: number;
  risk: 'low' | 'moderate' | 'high';
  riskReasons: string[];
  monthlySurplusCents: Record<ScenarioId, Cents>;
  scenarios: RecoveryScenario[];
}

const MAX_WEEKS = 156;

/** Average monthly take-home income under a scenario's view of certainty. */
function monthlyIncome(state: AppState, scenario: ScenarioId): Cents {
  return state.incomeSources.reduce((t, s) => {
    if (s.netAmountCents <= 0) return t;
    const monthly = s.netAmountCents * monthlyFactor(s.frequency);
    let share: number;
    if (s.certainty === 'confirmed') share = 1;
    else if (s.certainty === 'uncertain') share = scenario === 'optimistic' ? 0.5 : 0;
    else if (scenario === 'conservative') share = Math.max(0.1, 1 - s.variability * 1.5);
    else if (scenario === 'balanced') share = Math.max(0.1, 1 - s.variability / 2);
    else share = 1;
    return t + monthly * share;
  }, 0);
}

/**
 * Suggest rebuilding schedules after an emergency withdrawal. These are
 * simulations under stated assumptions, not promises. Week 1 is capped at
 * today's safe maximum so upcoming bills stay protected.
 */
export function planRecovery(
  state: AppState,
  rec: Recommendation,
  opts: { targetCents: Cents; pauseWeeks: number },
): RecoveryResult {
  const current = rec.emergencyCents;
  const target = Math.max(0, opts.targetCents);
  const gap = Math.max(0, target - current);
  const pauseWeeks = Math.max(0, Math.min(26, Math.round(opts.pauseWeeks)));

  const discretionaryBills = state.bills
    .filter((b) => b.priority === 'discretionary' && b.frequency !== 'once')
    .reduce((t, b) => t + b.amountCents * monthlyFactor(b.frequency), 0);
  const discretionaryDaily = (rec.spend.dailyDiscretionaryCents * state.settings.discretionaryReservePct) / 100;
  const outflow = rec.monthlyEssentialCents + discretionaryBills + discretionaryDaily * DAYS_PER_MONTH;

  const market = marketFor(state.marketCode);
  const step = minor(market, market.rounding.stepMajor);
  const shares: Record<ScenarioId, number> = { conservative: 0.5, balanced: 0.7, optimistic: 0.9 };
  const labels: Record<ScenarioId, string> = { conservative: 'Conservative', balanced: 'Balanced', optimistic: 'Optimistic' };
  const monthlySurplus = {} as Record<ScenarioId, Cents>;

  const scenarios: RecoveryScenario[] = (['conservative', 'balanced', 'optimistic'] as ScenarioId[]).map((id) => {
    const income = monthlyIncome(state, id);
    const surplus = Math.round(income - outflow);
    monthlySurplus[id] = surplus;
    const weekly = surplus > 0 ? roundDownTo(Math.floor(((surplus * 12) / 52) * shares[id]), step) : 0;
    const firstWeek = rec.status === 'pause' || rec.status === 'insufficient' ? 0 : Math.min(weekly, rec.maxSafeCents);
    const schedule: RecoveryWeek[] = [];
    let bal = current;
    let reached: number | null = gap === 0 ? 0 : null;
    for (let w = 1; w <= MAX_WEEKS && reached === null; w++) {
      let c = w <= pauseWeeks ? 0 : w === pauseWeeks + 1 ? firstWeek : weekly;
      c = Math.min(c, Math.max(0, target - bal));
      bal += c;
      schedule.push({ week: w, date: addDays(rec.today, (w - 1) * 7), contributionCents: c, balanceCents: bal });
      if (bal >= target) reached = w;
    }
    return {
      id,
      label: labels[id],
      weeklyCents: weekly,
      firstWeekCents: firstWeek,
      weeksToTarget: reached,
      reachDate: reached !== null && reached > 0 ? addDays(rec.today, (reached - 1) * 7) : reached === 0 ? rec.today : null,
      schedule,
      assumptions: [
        id === 'conservative'
          ? 'Expected income at the low end of its usual range; uncertain income ignored.'
          : id === 'balanced'
            ? 'Expected income at about its typical level; uncertain income ignored.'
            : 'All expected income arrives in full and half of uncertain income arrives.',
        `${Math.round(shares[id] * 100)}% of the estimated monthly surplus goes to rebuilding.`,
        pauseWeeks > 0 ? `Contributions paused for the first ${pauseWeeks} week(s).` : 'No pause weeks.',
        'First contribution capped at today’s safe maximum to protect upcoming bills.',
      ],
    };
  });

  const riskReasons: string[] = [];
  let risk: RecoveryResult['risk'] = 'low';
  if (rec.status === 'pause' || rec.shortfallCents > 0) {
    risk = 'high';
    riskReasons.push(rec.shortfallCents > 0 ? 'Upcoming essentials exceed available cash.' : 'There is no room to save right now.');
  }
  if (rec.coverageMonths < 0.25) {
    risk = 'high';
    riskReasons.push('Emergency savings cover less than a week of essentials.');
  } else if (rec.coverageMonths < 1) {
    if (risk === 'low') risk = 'moderate';
    riskReasons.push('Emergency savings cover less than a month of essentials.');
  }
  if (monthlySurplus.conservative <= 0) {
    if (risk === 'low') risk = 'moderate';
    riskReasons.push('In a low-income month, spending could match or exceed income.');
  }
  if (riskReasons.length === 0) riskReasons.push('Essentials are covered and there is a regular surplus to rebuild from.');

  return { currentCents: current, targetCents: target, gapCents: gap, pauseWeeks, risk, riskReasons, monthlySurplusCents: monthlySurplus, scenarios };
}
