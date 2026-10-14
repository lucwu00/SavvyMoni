import { addDays, addMonths, type ISODate } from './dates';
import type { Frequency } from './types';

/** The k-th occurrence of a schedule, computed from the anchor to avoid month-end drift. */
export function nthOccurrence(start: ISODate, freq: Frequency, k: number): ISODate {
  switch (freq) {
    case 'once':
      return start;
    case 'daily':
      return addDays(start, k);
    case 'weekly':
      return addDays(start, 7 * k);
    case 'fortnightly':
      return addDays(start, 14 * k);
    case 'monthly':
      return addMonths(start, k);
    case 'quarterly':
      return addMonths(start, 3 * k);
    case 'annual':
      return addMonths(start, 12 * k);
  }
}

/**
 * All occurrences from `start` up to and including `to`. Occurrences before
 * `start` never exist; occurrences already in the past (overdue) are included
 * and callers decide how to treat them.
 */
export function occurrencesUntil(start: ISODate, freq: Frequency, to: ISODate, max = 500): ISODate[] {
  const out: ISODate[] = [];
  if (freq === 'once') return start <= to ? [start] : [];
  for (let k = 0; k < max; k++) {
    const d = nthOccurrence(start, freq, k);
    if (d > to) break;
    out.push(d);
  }
  return out;
}

export const nextOccurrence = (current: ISODate, freq: Frequency): ISODate => nthOccurrence(current, freq, 1);

/** Multiplier converting one payment into an average monthly amount. */
export function monthlyFactor(freq: Frequency): number {
  switch (freq) {
    case 'daily':
      return 365 / 12;
    case 'weekly':
      return 52 / 12;
    case 'fortnightly':
      return 26 / 12;
    case 'monthly':
      return 1;
    case 'quarterly':
      return 1 / 3;
    case 'annual':
      return 1 / 12;
    case 'once':
      return 0;
  }
}

export const FREQUENCY_LABELS: Record<Frequency, string> = {
  once: 'One-off',
  daily: 'Daily',
  weekly: 'Weekly',
  fortnightly: 'Every 2 weeks',
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  annual: 'Yearly',
};
