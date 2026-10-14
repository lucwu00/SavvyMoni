import { addDays, diffDays, maxDate, type ISODate } from './dates';
import { scaleCents, type Cents } from './money';
import { occurrencesUntil } from './recurrence';
import { estimateDailySpend, type SpendEstimate } from './spending';
import type { AppState, HealthBill, IncomeCertainty } from './types';

export type CashEventKind = 'income' | 'bill' | 'health' | 'everyday' | 'discretionary' | 'contribution';

export interface CashEvent {
  date: ISODate;
  /** Signed: positive inflow, negative outflow. Already adjusted for certainty. */
  amountCents: Cents;
  /** Unadjusted amount (income before haircut). */
  fullAmountCents: Cents;
  label: string;
  kind: CashEventKind;
  protected: boolean;
  certainty?: IncomeCertainty;
  refId?: string;
  overdue?: boolean;
}

export interface ExcludedIncome {
  date: ISODate;
  amountCents: Cents;
  label: string;
  reason: string;
  refId: string;
}

export interface ProjectionDay {
  date: ISODate;
  index: number;
  openingCents: Cents;
  inflowCents: Cents;
  outflowCents: Cents;
  closingCents: Cents;
  events: CashEvent[];
}

export interface ForecastOptions {
  horizonDays: number;
  incomeDelayDays: number;
  discretionaryReservePct: number;
}

export interface Forecast {
  today: ISODate;
  horizonEnd: ISODate;
  liquidCents: Cents;
  emergencyCents: Cents;
  events: CashEvent[];
  excludedIncome: ExcludedIncome[];
  spend: SpendEstimate;
  days: ProjectionDay[];
  warnings: string[];
}

export const outOfPocket = (b: HealthBill): Cents =>
  Math.max(0, b.billedCents - b.subsidyCents - b.insuranceCents - b.medisaveCents);

export const liquidBalance = (s: AppState): Cents =>
  s.accounts.filter((a) => a.role === 'spending').reduce((t, a) => t + a.balanceCents, 0);

export const emergencyBalance = (s: AppState): Cents =>
  s.accounts.filter((a) => a.role === 'emergency').reduce((t, a) => t + Math.max(0, a.balanceCents), 0);

/** Share of an income payment counted in the forecast. Uncertain income is excluded entirely. */
export function countedShare(certainty: IncomeCertainty, variability: number): number {
  if (certainty === 'confirmed') return 1;
  if (certainty === 'uncertain') return 0;
  const v = Math.min(0.9, Math.max(0, variability));
  return Math.max(0.1, 1 - v);
}

export function buildEvents(state: AppState, today: ISODate, opts: ForecastOptions): Omit<Forecast, 'days'> {
  const H = Math.max(7, Math.min(120, Math.round(opts.horizonDays)));
  const horizonEnd = addDays(today, H - 1);
  const events: CashEvent[] = [];
  const excluded: ExcludedIncome[] = [];
  const warnings: string[] = [];

  // Income
  for (const src of state.incomeSources) {
    if (!(src.netAmountCents > 0)) {
      warnings.push(`${src.name}: income amount is zero or negative, so it is not counted.`);
      continue;
    }
    for (const d of occurrencesUntil(src.nextDate, src.frequency, horizonEnd)) {
      const blackout = state.shocks.find(
        (sh) => sh.incomeSourceIds.includes(src.id) && sh.incomeLossDays > 0 && d >= sh.date && d < addDays(sh.date, sh.incomeLossDays),
      );
      if (blackout) {
        excluded.push({ date: d, amountCents: src.netAmountCents, label: src.name, reason: `Lost during "${blackout.label}"`, refId: src.id });
        continue;
      }
      const overdue = d < today;
      let arrival = overdue ? addDays(today, 1) : d;
      arrival = addDays(arrival, Math.max(0, opts.incomeDelayDays));
      if (arrival > horizonEnd) {
        excluded.push({ date: arrival, amountCents: src.netAmountCents, label: src.name, reason: 'Arrives after the planning horizon', refId: src.id });
        continue;
      }
      const counted = scaleCents(src.netAmountCents, countedShare(src.certainty, src.variability));
      if (src.certainty === 'uncertain') {
        excluded.push({ date: arrival, amountCents: src.netAmountCents, label: src.name, reason: 'Uncertain income is not counted', refId: src.id });
        continue;
      }
      events.push({
        date: arrival,
        amountCents: counted,
        fullAmountCents: src.netAmountCents,
        label: src.name,
        kind: 'income',
        protected: false,
        certainty: src.certainty,
        refId: src.id,
        overdue,
      });
    }
  }

  // Scheduled bills
  for (const b of state.bills) {
    if (b.amountCents <= 0) continue;
    if (b.frequency === 'once' && b.status === 'paid') continue;
    for (const d of occurrencesUntil(b.nextDue, b.frequency, horizonEnd)) {
      events.push({
        date: maxDate(d, today),
        amountCents: -b.amountCents,
        fullAmountCents: -b.amountCents,
        label: b.name,
        kind: 'bill',
        protected: b.priority !== 'discretionary',
        refId: b.id,
        overdue: d < today,
      });
    }
  }

  // Unpaid medical bills (out-of-pocket part only)
  for (const hb of state.healthBills) {
    if (hb.status !== 'unpaid') continue;
    const oop = outOfPocket(hb);
    if (oop <= 0) continue;
    const d = maxDate(hb.dueDate, today);
    if (d > horizonEnd) continue;
    events.push({
      date: d,
      amountCents: -oop,
      fullAmountCents: -oop,
      label: `${hb.provider} bill (out-of-pocket)`,
      kind: 'health',
      protected: true,
      refId: hb.id,
      overdue: hb.dueDate < today,
    });
  }

  // Everyday spending reserve
  const spend = estimateDailySpend(state, today);
  const discPerDay = Math.ceil((spend.dailyDiscretionaryCents * Math.min(100, Math.max(0, opts.discretionaryReservePct))) / 100);
  for (let i = 0; i < H; i++) {
    const d = addDays(today, i);
    if (spend.dailyEssentialCents > 0)
      events.push({ date: d, amountCents: -spend.dailyEssentialCents, fullAmountCents: -spend.dailyEssentialCents, label: 'Everyday essentials (estimated)', kind: 'everyday', protected: true });
    if (discPerDay > 0)
      events.push({ date: d, amountCents: -discPerDay, fullAmountCents: -discPerDay, label: 'Discretionary allowance (estimated)', kind: 'discretionary', protected: false });
  }

  return {
    today,
    horizonEnd,
    liquidCents: liquidBalance(state),
    emergencyCents: emergencyBalance(state),
    events: events.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)),
    excludedIncome: excluded,
    spend,
    warnings,
  };
}

/** Day-by-day running balance. A contribution made today reduces every day's balance. */
export function project(startCents: Cents, events: CashEvent[], today: ISODate, horizonEnd: ISODate, contributionCents = 0): ProjectionDay[] {
  const days: ProjectionDay[] = [];
  const n = diffDays(today, horizonEnd) + 1;
  let balance = startCents - contributionCents;
  let j = 0;
  const sorted = [...events].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  for (let i = 0; i < n; i++) {
    const date = addDays(today, i);
    const opening = balance;
    const dayEvents: CashEvent[] = [];
    while (j < sorted.length && sorted[j].date <= date) {
      dayEvents.push(sorted[j]);
      j++;
    }
    let inflow = 0;
    let outflow = 0;
    for (const e of dayEvents) {
      if (e.amountCents >= 0) inflow += e.amountCents;
      else outflow += -e.amountCents;
    }
    balance = opening + inflow - outflow;
    days.push({ date, index: i, openingCents: opening, inflowCents: inflow, outflowCents: outflow, closingCents: balance, events: dayEvents });
  }
  return days;
}

export interface SafeResult {
  maxSafeCents: Cents;
  minClosingCents: Cents;
  limitingDay: ProjectionDay | null;
}

/**
 * The core rule: the largest amount that can be set aside today while the
 * projected balance stays at or above the reserve on every day in the horizon.
 * Intraday ordering is conservative: outflows and inflows are netted per day,
 * and income is never assumed to arrive earlier than scheduled.
 */
export function maxSafeContribution(days: ProjectionDay[], floorCents: Cents): SafeResult {
  if (days.length === 0) return { maxSafeCents: 0, minClosingCents: 0, limitingDay: null };
  let min = Infinity;
  let limiting: ProjectionDay | null = null;
  for (const d of days) {
    // Check both the opening and closing balance of each day.
    const low = Math.min(d.closingCents, d.index === 0 ? d.openingCents : d.closingCents);
    if (low < min) {
      min = low;
      limiting = d;
    }
  }
  return { maxSafeCents: Math.max(0, Math.floor(min - floorCents)), minClosingCents: min, limitingDay: limiting };
}

/** Simplified flow version used by the benchmark: start balance + daily net flows. */
export function maxSafeFromFlows(startCents: Cents, dailyNetFlows: Cents[], floorCents: Cents): Cents {
  let bal = startCents;
  let min = startCents;
  for (const f of dailyNetFlows) {
    bal += f;
    if (bal < min) min = bal;
  }
  return Math.max(0, Math.floor(min - floorCents));
}
