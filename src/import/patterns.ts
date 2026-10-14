/**
 * Find regular income and bills in records the user has already kept, such
 * as weeks of cash book entries. This is the same detection a spreadsheet
 * import runs, applied to the records on this device, so people who record by
 * hand get the same help as people who upload a bank export.
 *
 * Nothing is added automatically: the cash book shows each suggestion with its
 * evidence and the user picks what to keep.
 */
import { marketFor } from '../config/markets';
import type { ISODate } from '../domain/dates';
import type { AppState, IncomeSource, RecurringBill } from '../domain/types';
import { detectBills, detectIncome, payeeKey, type Detected } from './detect';

export interface PatternSuggestions {
  income: Detected<IncomeSource>[];
  bills: Detected<RecurringBill>[];
}

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase() || (payeeKey(a) !== '' && payeeKey(a) === payeeKey(b));

export function findPatterns(state: AppState, today: ISODate): PatternSuggestions {
  const market = marketFor(state.marketCode);
  const past = state.transactions.filter((t) => t.date <= today);
  const income = detectIncome(past, today, market)
    .filter((d) => !state.incomeSources.some((i) => same(i.name, d.item.name)))
    .map((d) => ({ ...d, item: { ...d.item, source: 'user' as const } }));
  const bills = detectBills(past, today, market)
    .filter((d) => !state.bills.some((b) => same(b.name, d.item.name)))
    .map((d) => ({ ...d, item: { ...d.item, source: 'user' as const } }));
  return { income, bills };
}
