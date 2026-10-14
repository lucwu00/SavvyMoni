import { formatMoney, type Cents } from './money';
import { marketFor, minor } from '../config/markets';
import { monthlyFactor } from './recurrence';
import type { AppState, MilestoneId } from './types';

export interface Milestone {
  id: MilestoneId;
  label: string;
  short: string;
  targetCents: Cents;
}

export const DAYS_PER_MONTH = 30.42;

/** Average monthly cost of protected obligations: bills + everyday essentials. */
export function monthlyEssentialCents(state: AppState, dailyEssentialCents: Cents): Cents {
  const bills = state.bills
    .filter((b) => b.priority !== 'discretionary' && b.frequency !== 'once')
    .reduce((t, b) => t + b.amountCents * monthlyFactor(b.frequency), 0);
  return Math.round(bills + dailyEssentialCents * DAYS_PER_MONTH);
}

export function milestones(state: AppState, monthlyEssential: Cents): Milestone[] {
  // Early milestones come from the country configuration (S$100, ₱500, Rp100.000, ...).
  const market = marketFor(state.marketCode);
  const ids: MilestoneId[] = ['first100', 'first500', 'first1000'];
  const list: Milestone[] = market.milestonesMajor.slice(0, 3).map((major, i) => {
    const target = minor(market, major);
    return { id: ids[i], label: `First ${formatMoney(target, {}, market.currency)}`, short: formatMoney(target, { compact: true }, market.currency), targetCents: target };
  });
  list.push(
    { id: 'week', label: 'One week of essentials', short: '1 week', targetCents: Math.round((monthlyEssential * 7) / DAYS_PER_MONTH) },
    { id: 'month', label: 'One month of essentials', short: '1 month', targetCents: monthlyEssential },
    { id: 'three', label: 'Three months of essentials', short: '3 months', targetCents: monthlyEssential * 3 },
  );
  list.sort((a, b) => a.targetCents - b.targetCents);
  if (state.goal.customTargetCents > 0) {
    list.push({ id: 'custom', label: 'My own goal', short: 'Custom', targetCents: state.goal.customTargetCents });
  }
  return list;
}

export interface ActiveGoal {
  milestone: Milestone;
  progress: number; // 0..1
  remainingCents: Cents;
  reachedAll: boolean;
}

export function activeGoal(state: AppState, emergencyCents: Cents, monthlyEssential: Cents): ActiveGoal {
  const list = milestones(state, monthlyEssential);
  let m: Milestone | undefined;
  if (state.goal.selected !== 'auto') m = list.find((x) => x.id === state.goal.selected);
  let reachedAll = false;
  if (!m) {
    const ladder = list.filter((x) => x.id !== 'custom');
    m = ladder.find((x) => x.targetCents > emergencyCents);
    if (!m) {
      m = ladder[ladder.length - 1];
      reachedAll = true;
    }
  }
  const progress = m.targetCents > 0 ? Math.min(1, emergencyCents / m.targetCents) : 1;
  return { milestone: m, progress, remainingCents: Math.max(0, m.targetCents - emergencyCents), reachedAll };
}

/** Months of essential spending that emergency savings would cover. */
export function coverageMonths(emergencyCents: Cents, monthlyEssential: Cents): number {
  if (monthlyEssential <= 0) return 0;
  return emergencyCents / monthlyEssential;
}

export function describeCoverage(months: number): string {
  if (months <= 0) return 'No cover yet';
  const days = Math.round(months * DAYS_PER_MONTH);
  if (days < 14) return `${days} day${days === 1 ? '' : 's'}`;
  if (months < 1.5) return `${Math.round(days / 7)} weeks`;
  return `${(Math.round(months * 10) / 10).toFixed(1)} months`;
}
