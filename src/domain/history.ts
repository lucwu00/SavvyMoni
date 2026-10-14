/**
 * Emergency-savings history for the trend chart, built only from evidence.
 *
 * The app knows today's balance. Earlier balances are worked out backwards
 * from things that actually moved money into or out of savings:
 *  - savings recorded in the app (contributions and withdrawals), and
 *  - transfers to or from an emergency account found in imported
 *    transactions ("Transfer to GXS Saving Pocket").
 * Before the earliest date with evidence the balance is unknown, so the chart
 * starts there instead of copying today's figure backwards.
 */
import { addDays, diffDays, type ISODate } from './dates';
import { emergencyBalance } from './forecast';
import type { Cents } from './money';
import type { AppState, Transaction } from './types';

export interface SavingsHistory {
  /** First date the balance is known. */
  knownFrom: ISODate;
  /** How the history was worked out. */
  basis: 'transfers' | 'since-setup';
  points: Array<{ date: ISODate; cents: Cents }>;
  /** Transfers found in imported transactions. */
  transfersFound: number;
}

/** Does this transaction move money between spending and an emergency account? Returns the change to savings. */
export function savingsChange(t: Transaction, emergencyIds: Set<string>, emergencyNames: string[]): Cents {
  if (t.accountId && emergencyIds.has(t.accountId)) return t.amountCents; // recorded on the savings account itself
  if (t.category !== 'transfer') return 0;
  const text = `${t.merchant} ${t.description}`.toLowerCase();
  const toSavings = t.subcategory === 'savings' || emergencyNames.some((n) => n && text.includes(n));
  return toSavings ? -t.amountCents : 0; // money out of spending = money into savings
}

export function emergencyHistory(state: AppState, today: ISODate, maxDays = 90, step = 3): SavingsHistory {
  const emergency = state.accounts.filter((a) => a.role === 'emergency');
  const ids = new Set(emergency.map((a) => a.id));
  const names = emergency.map((a) => a.name.toLowerCase());
  const changes: Array<{ date: ISODate; cents: Cents }> = [];
  const contributionKeys = new Set(state.contributions.map((c) => `${c.date}|${Math.abs(c.amountCents)}`));
  let transfersFound = 0;
  for (const t of state.transactions) {
    const c = savingsChange(t, ids, names);
    if (!c) continue;
    // Skip a transfer already recorded as a contribution (same day and amount).
    if (contributionKeys.has(`${t.date}|${Math.abs(c)}`)) continue;
    transfersFound++;
    changes.push({ date: t.date, cents: c });
  }
  for (const c of state.contributions) changes.push({ date: c.date, cents: c.amountCents });

  const setup = state.createdAt.slice(0, 10) <= today ? state.createdAt.slice(0, 10) : today;
  const imported = state.transactions.filter((t) => t.source === 'imported').map((t) => t.date).sort();
  // With transfers in an imported statement, the balance is known back to the start of that statement.
  const statementStart = imported[0];
  const basis: SavingsHistory['basis'] = transfersFound > 0 && statementStart ? 'transfers' : 'since-setup';
  let knownFrom = basis === 'transfers' ? statementStart : setup;
  const earliest = addDays(today, -maxDays);
  if (knownFrom < earliest) knownFrom = earliest;

  const now = emergencyBalance(state);
  const points: SavingsHistory['points'] = [];
  const span = diffDays(knownFrom, today);
  for (let i = span; i >= 0; i -= step) {
    const d = addDays(today, -i);
    const later = changes.filter((c) => c.date > d).reduce((t, c) => t + c.cents, 0);
    points.push({ date: d, cents: Math.max(0, now - later) });
  }
  if (!points.length || points[points.length - 1].date !== today) points.push({ date: today, cents: now });
  return { knownFrom, basis, points, transfersFound };
}
