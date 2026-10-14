import { addDays, diffDays, type ISODate } from './dates';
import { isSpending } from './classifier';
import type { AppState, CategoryId, Essentiality, RecurringBill, Transaction } from './types';
import type { Cents } from './money';

export interface SpendItem {
  date: ISODate;
  category: CategoryId;
  subcategory: string;
  essentiality: Essentiality;
  amountCents: Cents; // positive
  merchant: string;
  txId: string;
}

/** Expand a transaction into spend items, honouring mixed-category receipt lines. */
export function spendItems(t: Transaction): SpendItem[] {
  if (!isSpending(t)) return [];
  if (t.lines && t.lines.length > 0) {
    return t.lines.map((l) => ({
      date: t.date,
      category: l.category,
      subcategory: l.subcategory,
      essentiality: l.essentiality,
      amountCents: Math.abs(l.amountCents),
      merchant: t.merchant,
      txId: t.id,
    }));
  }
  return [
    {
      date: t.date,
      category: t.category,
      subcategory: t.subcategory,
      essentiality: t.essentiality,
      amountCents: Math.abs(t.amountCents),
      merchant: t.merchant,
      txId: t.id,
    },
  ];
}

/**
 * Recurring payment detection: does this transaction look like a payment of a
 * tracked bill? Used so variable-spending estimates don't double count bills.
 */
export function matchesBill(t: Transaction, bills: RecurringBill[]): RecurringBill | undefined {
  if (t.billId) return bills.find((b) => b.id === t.billId);
  if (!isSpending(t)) return undefined;
  const amt = Math.abs(t.amountCents);
  return bills.find((b) => {
    if (b.frequency === 'once') return false;
    const close = Math.abs(amt - b.amountCents) <= Math.max(100, b.amountCents * 0.05);
    const sameCat = b.category === t.category && b.subcategory === t.subcategory;
    const nameHit = t.merchant.toLowerCase().includes(b.name.toLowerCase().split(' ')[0]);
    return close && (sameCat || nameHit);
  });
}

export const isEssentialBucket = (e: Essentiality) => e !== 'discretionary';

export interface SpendEstimate {
  dailyEssentialCents: Cents;
  dailyDiscretionaryCents: Cents;
  windowDays: number;
  coverageDays: number;
  txnCount: number;
  source: 'history' | 'estimated';
  reason: string;
}

/**
 * Average daily variable spending (not counting tracked bills) over a
 * trailing window. Falls back to the profile's estimate when history is thin.
 * Unknown ("needs review") spending is treated as essential: conservative.
 */
export function estimateDailySpend(state: AppState, today: ISODate, windowDays = 28): SpendEstimate {
  const from = addDays(today, -windowDays);
  const txns = state.transactions.filter((t) => t.date >= from && t.date < today && isSpending(t) && !matchesBill(t, state.bills));
  let ess = 0;
  let disc = 0;
  let earliest: ISODate | null = null;
  for (const t of txns) {
    if (!earliest || t.date < earliest) earliest = t.date;
    for (const i of spendItems(t)) {
      if (isEssentialBucket(i.essentiality)) ess += i.amountCents;
      else disc += i.amountCents;
    }
  }
  const coverageDays = earliest ? diffDays(earliest, today) : 0;
  if (txns.length < 5 || coverageDays < 14) {
    return {
      dailyEssentialCents: state.profile.fallbackDailyEssentialCents,
      dailyDiscretionaryCents: state.profile.fallbackDailyDiscretionaryCents,
      windowDays,
      coverageDays,
      txnCount: txns.length,
      source: 'estimated',
      reason:
        txns.length === 0
          ? 'No recent transactions, so everyday spending uses your profile estimate.'
          : `Only ${coverageDays} days of recent transactions, so everyday spending uses your profile estimate.`,
    };
  }
  const days = Math.max(coverageDays, 14);
  const denom = Math.min(days, windowDays);
  return {
    dailyEssentialCents: Math.ceil(ess / denom),
    dailyDiscretionaryCents: Math.ceil(disc / denom),
    windowDays,
    coverageDays,
    txnCount: txns.length,
    source: 'history',
    reason: `Based on ${txns.length} transactions over the last ${denom} days.`,
  };
}

export interface CategoryTotal {
  category: CategoryId;
  essentialCents: Cents;
  discretionaryCents: Cents;
  totalCents: Cents;
}

/** Spending by category in [from, to). Includes bill payments that appear as transactions. */
export function spendByCategory(txns: Transaction[], from: ISODate, to: ISODate): CategoryTotal[] {
  const map = new Map<CategoryId, CategoryTotal>();
  for (const t of txns) {
    if (t.date < from || t.date >= to) continue;
    for (const i of spendItems(t)) {
      const row = map.get(i.category) ?? { category: i.category, essentialCents: 0, discretionaryCents: 0, totalCents: 0 };
      if (isEssentialBucket(i.essentiality)) row.essentialCents += i.amountCents;
      else row.discretionaryCents += i.amountCents;
      row.totalCents += i.amountCents;
      map.set(i.category, row);
    }
  }
  return [...map.values()].sort((a, b) => b.totalCents - a.totalCents);
}
