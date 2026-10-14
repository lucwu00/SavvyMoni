/**
 * Detect regular income and bills from a transaction history.
 *
 * Transactions are grouped by a normalised payee name. A group becomes a
 * candidate when its payments repeat at a steady interval (daily, weekly,
 * fortnightly or monthly) and the latest one is recent enough that the
 * pattern is probably still running. Every candidate is shown to the user
 * with its evidence; nothing is added without their confirmation.
 *
 * Conservative choices: bills use the highest recent amount, income uses the
 * median and is marked variable when amounts swing, and patterns seen only
 * twice are offered but not pre-selected for income.
 */
import type { MarketConfig } from '../config/markets';
import { defaultEssentiality } from '../domain/categories';
import { isSpending, normaliseMerchant } from '../domain/classifier';
import { addDays, diffDays, type ISODate } from '../domain/dates';
import { uid } from '../domain/ids';
import { formatMoney, type Cents } from '../domain/money';
import type { CategoryId, Frequency, IncomeCertainty, IncomeSource, RecurringBill, Transaction } from '../domain/types';

export interface Detected<T> {
  item: T;
  evidence: string;
  include: boolean;
  /** Ids of the history transactions that make up the pattern. */
  txIds: string[];
}

type Freq = 'daily' | 'weekly' | 'fortnightly' | 'monthly';

const BANDS: Array<{ freq: Freq; min: number; max: number; minCount: number; label: string }> = [
  { freq: 'daily', min: 1, max: 2, minCount: 8, label: 'about every day' },
  { freq: 'weekly', min: 6, max: 8, minCount: 3, label: 'about every week' },
  { freq: 'fortnightly', min: 13, max: 16, minCount: 2, label: 'about every 2 weeks' },
  { freq: 'monthly', min: 27, max: 33, minCount: 2, label: 'about every month' },
];
const STEP: Record<Freq, number> = { daily: 1, weekly: 7, fortnightly: 14, monthly: 30 };

/** Group key: payee words without reference numbers or dates. */
export function payeeKey(merchant: string): string {
  return normaliseMerchant(merchant)
    .replace(/\b\d[\d ]*\b/g, ' ')
    .replace(/\b(ref|txn|trx|no|inv|invoice|giro|fast|paynow|ibg|via|from|to|pmt|payment)\b/g, ' ')
    // Month names ("Rent September", "Sewa Oktober") change every time; drop them.
    .replace(/\b(jan(uary|uari)?|feb(ruary|ruari)?|mar(ch|et)?|apr(il)?|may|mei|jun(e|i)?|jul(y|i)?|aug(ust)?|agu(stus)?|sep(t|tember)?|oct(ober)?|okt(ober)?|nov(ember)?|dec(ember)?|des(ember)?|enero|pebrero|marso|abril|mayo|hunyo|hulyo|agosto|setyembre|oktubre|nobyembre|disyembre)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .slice(0, 3)
    .join(' ');
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
};

interface Pattern {
  freq: Freq;
  label: string;
  dates: ISODate[];
  amounts: Cents[];
  txIds: string[];
  name: string;
  last: ISODate;
  consistency: number;
}

/** Find a steady interval in one group, merging same-day payments. */
function findPattern(txns: Transaction[], today: ISODate): Pattern | null {
  const byDay = new Map<ISODate, { amount: Cents; ids: string[] }>();
  for (const t of txns) {
    const cur = byDay.get(t.date) ?? { amount: 0, ids: [] };
    cur.amount += Math.abs(t.amountCents);
    cur.ids.push(t.id);
    byDay.set(t.date, cur);
  }
  const dates = [...byDay.keys()].sort();
  if (dates.length < 2) return null;
  const gaps = dates.slice(1).map((d, i) => diffDays(dates[i], d));
  const med = median(gaps);
  const band = BANDS.find((b) => med >= b.min && med <= b.max);
  if (!band || dates.length < band.minCount) return null;
  // Daily patterns may skip a rest day; others must mostly land in the band.
  const fits = gaps.filter((g) => (band.freq === 'daily' ? g <= 3 : g >= band.min - 1 && g <= band.max + 1)).length;
  const consistency = fits / gaps.length;
  if (consistency < 0.6) return null;
  const last = dates[dates.length - 1];
  // Still running? The last payment should be within about 1.6 intervals.
  if (diffDays(last, today) > Math.ceil(STEP[band.freq] * 1.6) + 2) return null;
  const amounts = dates.map((d) => byDay.get(d)!.amount);
  const ids = dates.flatMap((d) => byDay.get(d)!.ids);
  const name = mostCommonName(txns);
  return { freq: band.freq, label: band.label, dates, amounts, txIds: ids, name, last, consistency };
}

function mostCommonName(txns: Transaction[]): string {
  const counts = new Map<string, number>();
  for (const t of txns) counts.set(t.merchant, (counts.get(t.merchant) ?? 0) + 1);
  const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? txns[0].merchant;
  // Drop trailing reference numbers so the name reads like a payee.
  return best.replace(/\s+[#]?\d[\d-]{3,}$/g, '').slice(0, 48);
}

function nextAfter(last: ISODate, freq: Freq, today: ISODate, allowOverdueDays: number): ISODate {
  let d = last;
  for (let i = 0; i < 1000; i++) {
    d = freq === 'monthly' ? addMonthsSafe(d, 1) : addDays(d, STEP[freq]);
    if (d >= today) return d;
    if (diffDays(d, today) <= allowOverdueDays) return d;
  }
  return today;
}

function addMonthsSafe(d: ISODate, n: number): ISODate {
  const [y, m, day] = d.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(Math.min(day, last)).padStart(2, '0')}`;
}

/**
 * Typical proportional swing between payments (0–0.6), measured as twice
 * the mean absolute deviation from the median. For evenly spread amounts
 * this matches the "± how much" a person would describe, and the engine
 * counts only (1 − variability) of the typical amount.
 */
function variabilityOf(amounts: Cents[]): number {
  const med = median(amounts);
  if (med <= 0) return 0.6;
  const mad = amounts.reduce((t, a) => t + Math.abs(a - med), 0) / amounts.length;
  return Math.min(0.6, Math.round(((2 * mad) / med) * 20) / 20);
}

function groupBy(txns: Transaction[]): Map<string, Transaction[]> {
  const g = new Map<string, Transaction[]>();
  for (const t of txns) {
    const k = payeeKey(t.merchant);
    if (!k) continue;
    const arr = g.get(k) ?? [];
    arr.push(t);
    g.set(k, arr);
  }
  return g;
}

const evidenceText = (p: Pattern, amountWord: string, amount: Cents, m: MarketConfig) =>
  `${p.dates.length} payments ${p.label} (${p.dates[0]} to ${p.last}), ${amountWord} ${formatMoney(amount, {}, m.currency)}`;

/* ------------------------------ Income ------------------------------ */

export function detectIncome(txns: Transaction[], today: ISODate, market: MarketConfig): Detected<IncomeSource>[] {
  const inflows = txns.filter((t) => t.amountCents > 0 && t.category === 'income');
  const out: Detected<IncomeSource>[] = [];
  for (const [, group] of groupBy(inflows)) {
    const p = findPattern(group, today);
    if (!p) continue;
    const variability = variabilityOf(p.amounts);
    const sub = group[0].subcategory;
    const kind: IncomeSource['kind'] =
      sub === 'salary' ? 'salary' : sub === 'gig-payout' ? 'gig' : sub === 'business-takings' ? 'business' : sub === 'allowance' ? 'allowance' : 'other';
    const certainty: IncomeCertainty =
      kind === 'salary' && variability <= 0.05 && p.dates.length >= 2 ? 'confirmed' : p.dates.length <= 2 || variability >= 0.4 || p.consistency < 0.8 ? 'uncertain' : 'expected';
    const amount = median(p.amounts);
    out.push({
      item: {
        id: uid('inc'),
        name: p.name,
        kind,
        earner: 'You',
        frequency: p.freq,
        netAmountCents: amount,
        nextDate: nextAfter(p.last, p.freq, today, 0),
        certainty,
        variability: certainty === 'confirmed' ? 0 : Math.max(0.1, variability),
        source: 'imported',
      },
      evidence: evidenceText(p, 'typically', amount, market) + (variability > 0.05 ? `, varies by about ${Math.round(variability * 100)}%` : ''),
      include: p.dates.length >= 3 || kind === 'salary',
      txIds: p.txIds,
    });
  }
  return out.sort((a, b) => b.item.netAmountCents * monthly(b.item.frequency) - a.item.netAmountCents * monthly(a.item.frequency));
}

/* ------------------------------- Bills ------------------------------- */

/** Everyday spending is estimated from history, so these are not treated as bills. */
const EVERYDAY: CategoryId[] = ['groceries', 'food'];
const EVERYDAY_TRANSPORT = new Set(['mrt', 'bus', 'simplygo', 'ezlink', 'grab-ride', 'taxi', 'petrol', 'parking', 'erp', 'jeepney', 'tricycle', 'line-car']);
const BILL_LIKE: CategoryId[] = ['housing', 'utilities', 'financial', 'family', 'business'];

export function detectBills(txns: Transaction[], today: ISODate, market: MarketConfig): Detected<RecurringBill>[] {
  const outflows = txns.filter((t) => isSpending(t) && !t.billId);
  const out: Detected<RecurringBill>[] = [];
  for (const [, group] of groupBy(outflows)) {
    const cat = group[0].category;
    const sub = group[0].subcategory;
    if (EVERYDAY.includes(cat)) continue;
    if (cat === 'transport' && EVERYDAY_TRANSPORT.has(sub)) continue;
    const p = findPattern(group, today);
    if (!p) continue;
    const variability = variabilityOf(p.amounts);
    const billLike = BILL_LIKE.includes(cat) || ['streaming', 'gym', 'insurance', 'medical-insurance', 'road-tax', 'motor-insurance'].includes(sub);
    // Daily outflows are usually everyday spending; only fixed fees (stall rent) count as bills.
    if (p.freq === 'daily' && !(billLike && variability <= 0.1)) continue;
    // Unknown payees only count when the amount is steady, like a subscription.
    if (!billLike && variability > 0.1) continue;
    const recent = p.amounts.slice(-3);
    const amount = Math.max(...recent);
    const base = defaultEssentiality(cat, sub);
    out.push({
      item: {
        id: uid('bill'),
        name: p.name,
        category: cat,
        subcategory: sub,
        amountCents: amount,
        nextDue: nextAfter(p.last, p.freq, today, 5),
        frequency: p.freq as Frequency,
        priority: base === 'review' ? 'essential' : (base as RecurringBill['priority']),
        status: 'unpaid',
        source: 'imported',
        confidence: p.dates.length >= 3 && variability <= 0.1 ? 'high' : 'medium',
      },
      evidence: evidenceText(p, variability > 0.02 ? 'up to' : 'each', amount, market) + (variability > 0.02 ? ' (the highest recent amount is protected)' : ''),
      include: billLike || p.dates.length >= 3,
      txIds: p.txIds,
    });
  }
  return out.sort((a, b) => b.item.amountCents * monthly(b.item.frequency) - a.item.amountCents * monthly(a.item.frequency));
}

function monthly(f: Frequency): number {
  return f === 'daily' ? 30 : f === 'weekly' ? 4.33 : f === 'fortnightly' ? 2.17 : f === 'monthly' ? 1 : 0.1;
}
