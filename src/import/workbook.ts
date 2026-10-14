/**
 * Spreadsheet import: turns a workbook (.xlsx) or a CSV export into an
 * ImportDraft that the user reviews before anything is saved.
 *
 * Workbook layout (all sheets except Transactions are optional):
 *   Transactions  Date | Description | Amount (− = money out) | Category | Account
 *                 (or Money out / Money in columns instead of Amount)
 *   Income        Source | Type | Amount | Frequency | Next date | Certainty
 *   Bills         Bill | Category | Amount | Frequency | Next due | Priority | Auto-debit
 *   Balances      Account | Type | Role | Balance
 *
 * When Income or Bills are not provided, regular payments are detected from
 * the transaction history (see detect.ts) and shown for the user to confirm.
 * Nothing is evaluated: formulas, macros and links in the file are ignored.
 */
import type { MarketConfig } from '../config/markets';
import { CATEGORIES, defaultEssentiality, subcategoryDef } from '../domain/categories';
import { classify, isSpending } from '../domain/classifier';
import { findDuplicates, parseCSV, sanitiseText, type RowError } from '../domain/csv';
import { addDays, diffDays, parseLooseDate, type ISODate } from '../domain/dates';
import { uid } from '../domain/ids';
import { formatMoney, parseMoney, type Cents, type Currency } from '../domain/money';
import { monthlyFactor } from '../domain/recurrence';
import type { Account, CategoryId, Essentiality, Frequency, IncomeCertainty, IncomeSource, RecurringBill, Transaction, UserRule } from '../domain/types';
import { detectBills, detectIncome } from './detect';
import { excelSerialToISO, readXlsx, type Cell, type Sheets } from './xlsx';

export const MAX_IMPORT_BYTES = 5_000_000;
export const MAX_IMPORT_ROWS = 10_000;

export interface SheetError extends RowError {
  sheet: string;
}

export interface DraftItem<T> {
  item: T;
  origin: 'sheet' | 'detected';
  /** Why it was detected, e.g. "4 payments, about every 7 days". */
  evidence?: string;
  include: boolean;
  /** History transactions that make up a detected pattern (linked on save). */
  txIds?: string[];
}

export interface DraftAccount {
  key: string;
  name: string;
  kind: Account['kind'];
  role: Account['role'];
  /** Null when the workbook did not give a balance: the user must enter one. */
  balanceCents: Cents | null;
  fromSheet: boolean;
}

export interface ImportDraft {
  fileName: string;
  format: 'xlsx' | 'csv';
  sheetsFound: string[];
  transactionSheet: string;
  transactions: Transaction[];
  duplicates: number;
  totalRows: number;
  errors: SheetError[];
  warnings: string[];
  income: DraftItem<IncomeSource>[];
  bills: DraftItem<RecurringBill>[];
  accounts: DraftAccount[];
  incomeFromSheet: boolean;
  billsFromSheet: boolean;
  history: { from: ISODate | null; to: ISODate | null; days: number };
  /** Average daily spending in the file (bills excluded), for the review screen. */
  dailyEssentialCents: Cents;
  dailyDiscretionaryCents: Cents;
  columns: { date: string; description: string; amount: string; category?: string; account?: string };
}

export interface ImportContext {
  market: MarketConfig;
  today: ISODate;
  rules: UserRule[];
  existing: Transaction[];
}

/* ------------------------------ Helpers ------------------------------ */

const norm = (v: Cell | undefined) =>
  String(v ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const text = (v: Cell | undefined) => (typeof v === 'number' ? String(v) : String(v ?? '')).trim();

function findCol(headers: string[], names: string[], prefix = false): number {
  const exact = headers.findIndex((h) => names.includes(h));
  if (exact >= 0 || !prefix) return exact;
  return headers.findIndex((h) => names.some((n) => h.startsWith(n + ' ')));
}

/** Read an amount cell. Numbers from .xlsx are exact; text uses the country's format. */
export function cellMoney(v: Cell | undefined, c: Currency): Cents | null {
  if (v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? Math.round(v * 10 ** c.minorUnits) : null;
  let s = v.trim();
  let sign = 1;
  const crdr = s.match(/\s*(cr|dr)\.?$/i);
  if (crdr) {
    sign = crdr[1].toLowerCase() === 'dr' ? -1 : 1;
    s = s.slice(0, crdr.index).trim();
  }
  s = s.replace(/^(rp|php|sgd|s\$|₱)\s*/i, '').replace(/\s+/g, c.minorUnits === 0 ? '' : '');
  if (s.endsWith('-') && !s.startsWith('-')) s = '-' + s.slice(0, -1);
  const m = parseMoney(s, c);
  return m === null ? null : m * sign;
}

export function cellDate(v: Cell | undefined): ISODate | null {
  if (v === undefined || v === '') return null;
  if (typeof v === 'number') return excelSerialToISO(v);
  return parseLooseDate(v);
}

/* --------------------------- Category text --------------------------- */

const CATEGORY_WORDS: Array<[RegExp, CategoryId]> = [
  [/\b(?:rent|housing|mortgage|hdb|sewa rumah|upa\b|boarding|hostel|conservancy)/, 'housing'],
  [/\b(?:grocer|supermarket|market|pasar|palengke|sari sari|zay\b)/, 'groceries'],
  [/\b(?:food|meal|dining|hawker|eat\b|makan|kain\b|drink|coffee|cafe|restaurant)/, 'food'],
  [/\b(?:transport|travel to work|commute|mrt|bus|fare|jeep|line car|ferry|grab ride|taxi|petrol|fuel|gas station|parking)/, 'transport'],
  [/\b(?:health|medical|clinic|doctor|dental|pharmacy|medicine|obat|gamot|hospital)/, 'healthcare'],
  [/\b(?:utilit|electric|water|gas bill|phone|mobile|internet|broadband|top up phone|load\b|elektrik|generator)/, 'utilities'],
  [/\b(?:family|child|school|tuition|education|remit|padala|kiriman|parents|elderly)/, 'family'],
  [/\b(?:insurance|loan|debt|credit card|instal|bnpl|tax\b|hutang|ansuran)/, 'financial'],
  [/\b(?:shopping|entertain|lifestyle|leisure|subscription|stream|gym|hobby|holiday|beauty|personal)/, 'lifestyle'],
  [/\b(?:business|stock|supplies|stall|modal|restock|work tools|platform fee)/, 'business'],
  [/\b(?:income|salary|wage|pay\b|earning|payout|tips|sales|takings|gaji|sahod|overtime|allowance)/, 'income'],
  [/\b(?:transfer|savings|top up|top-up|pindah)/, 'transfer'],
];

/** Map a user's own category text ("Groceries", "Makan", "Rent") to a SavvyMoni category. */
export function categoryFromText(raw: string): CategoryId | null {
  const s = norm(raw);
  if (!s) return null;
  const byLabel = CATEGORIES.find((c) => norm(c.label) === s || c.id === s);
  if (byLabel) return byLabel.id;
  for (const [re, id] of CATEGORY_WORDS) if (re.test(s)) return id;
  return null;
}

export const GENERIC_SUB: Record<CategoryId, string> = {
  housing: 'room-rental',
  groceries: 'minimart',
  food: 'food-court',
  transport: 'bus',
  healthcare: 'out-of-pocket',
  utilities: 'electricity',
  family: 'dependent-care',
  financial: 'mandatory',
  lifestyle: 'nonessential',
  business: 'restock',
  income: 'other-income',
  transfer: 'own-account',
  uncategorised: 'unknown',
};

/**
 * Categorise one row. The user's own category column wins over merchant
 * rules; the merchant still picks a more specific subcategory when it agrees.
 */
function categorise(desc: string, amount: Cents, categoryText: string, rules: UserRule[]) {
  const auto = classify(desc, desc, amount, rules);
  const given = categoryFromText(categoryText);
  if (!given || auto.matchedBy === 'user-rule') return { ...auto, givenCategory: false };
  // A positive amount labelled as spending is a refund: keep it as income-like inflow only if labelled so.
  if (given === auto.category) return { ...auto, confidence: 'high' as const, givenCategory: true };
  const sub = GENERIC_SUB[given];
  const essentiality: Essentiality = given === 'income' || given === 'transfer' ? 'review' : defaultEssentiality(given, sub);
  return { category: given, subcategory: sub, essentiality, confidence: 'high' as const, matchedBy: 'merchant-rule' as const, givenCategory: true };
}

/* ------------------------------ Sheets ------------------------------ */

const SHEET_NAMES = {
  transactions: /^(transactions?|spending|expenses?|money in (and|&) out|cash ?book|ledger|statement|transaksi|pengeluaran|gastos|catatan)/i,
  income: /^(income|earnings|pemasukan|pendapatan|kita|kita at sahod)/i,
  bills: /^(bills?|regular (bills|payments)|tagihan|bayarin|bayaran)/i,
  balances: /^(balances?|accounts?|saldo|wallets?)/i,
};

interface Header {
  row: number;
  cols: Record<string, number>;
  labels: string[];
}

/** Required columns are stored under the first name in each list (e.g. 'date', 'out'). */
function findHeader(rows: Cell[][], required: string[][], optional: Record<string, string[]> = {}, scan = 20): Header | null {
  for (let r = 0; r < Math.min(rows.length, scan); r++) {
    const headers = (rows[r] ?? []).map(norm);
    if (headers.filter(Boolean).length < 2) continue;
    const cols: Record<string, number> = {};
    let ok = true;
    for (const names of required) {
      const i = findCol(headers, names, true);
      if (i < 0) {
        ok = false;
        break;
      }
      cols[names[0]] = i;
    }
    if (!ok) continue;
    for (const [k, names] of Object.entries(optional)) {
      const i = findCol(headers, names, true);
      if (i >= 0) cols[k] = i;
    }
    return { row: r, cols, labels: (rows[r] ?? []).map(text) };
  }
  return null;
}

const DATE = ['date', 'transaction date', 'posting date', 'value date', 'txn date', 'tanggal', 'petsa', 'tarikh'];
const DESC = ['description', 'merchant', 'details', 'transaction details', 'payee', 'reference', 'item', 'particulars', 'narration', 'keterangan', 'deskripsi', 'uraian', 'paglalarawan', 'detalye'];
const AMOUNT = ['amount', 'transaction amount', 'jumlah', 'nominal', 'halaga', 'value'];
const OUT = ['out', 'money out', 'debit', 'debits', 'withdrawal', 'withdrawals', 'debit amount', 'spent', 'paid out', 'keluar', 'wang keluar', 'perbelanjaan', 'gastos', 'labas'];
const IN = ['in', 'money in', 'credit', 'credits', 'deposit', 'deposits', 'credit amount', 'received', 'masuk', 'wang masuk', 'pendapatan', 'pasok', 'kita'];
const CATEGORY = ['category', 'kategori', 'kategorya', 'type of spending'];
const ACCOUNT = ['account', 'account name', 'wallet', 'paid from', 'source', 'akun', 'rekening', 'dompet'];
const DIRECTION = ['type', 'direction', 'in out', 'jenis'];

function transactionHeader(rows: Cell[][]): Header | null {
  const opt = { category: CATEGORY, account: ACCOUNT, direction: DIRECTION };
  return (
    findHeader(rows, [DATE, DESC, AMOUNT], { ...opt, out: OUT, in: IN }) ??
    findHeader(rows, [DATE, DESC, OUT], { ...opt, in: IN }) ??
    findHeader(rows, [DATE, DESC, IN], { ...opt, out: OUT })
  );
}

function pickSheet(sheets: Sheets, re: RegExp): string | undefined {
  return Object.keys(sheets).find((n) => re.test(n.trim()));
}

/* ------------------------- Transactions sheet ------------------------- */

function parseTransactions(sheet: string, rows: Cell[][], ctx: ImportContext, errors: SheetError[]) {
  const h = transactionHeader(rows);
  if (!h) {
    errors.push({
      sheet,
      line: 1,
      message: `Couldn't find the column headings. The ${sheet} sheet needs Date, Description and Amount columns (or Money out / Money in). Found: ${(rows[0] ?? []).map(text).filter(Boolean).slice(0, 8).join(', ') || 'nothing'}.`,
    });
    return { parsed: [] as Transaction[], total: 0, header: null as Header | null, accountNames: [] as string[] };
  }
  const c = h.cols;
  const cur = ctx.market.currency;
  const maxAmount = ctx.market.maxImportMajor * 10 ** cur.minorUnits;
  const data = rows.slice(h.row + 1);
  if (data.length > MAX_IMPORT_ROWS) errors.push({ sheet, line: h.row + MAX_IMPORT_ROWS + 2, message: `Only the first ${MAX_IMPORT_ROWS.toLocaleString()} rows were read.` });
  const parsed: Transaction[] = [];
  const accountNames = new Set<string>();
  let total = 0;
  data.slice(0, MAX_IMPORT_ROWS).forEach((r, idx) => {
    const line = h.row + idx + 2;
    if (!r || r.every((v) => text(v) === '')) return;
    total++;
    const rawDate = r[c.date];
    const date = cellDate(rawDate);
    const desc = sanitiseText(text(r[c.description]));
    // Skip "Total" / "Balance carried forward" style summary rows silently.
    if (!date && /^(total|balance|opening|closing|subtotal|jumlah|saldo)/i.test(desc || text(rawDate))) {
      total--;
      return;
    }
    if (!date) return errors.push({ sheet, line, message: `Unreadable date "${text(rawDate).slice(0, 20)}". Use YYYY-MM-DD or DD/MM/YYYY.` });
    if (date > ctx.today) return errors.push({ sheet, line, message: `Date ${date} is in the future; skipped.` });
    if (!desc) return errors.push({ sheet, line, message: 'Description is empty.' });
    let amount: Cents | null = null;
    if (c.amount !== undefined && text(r[c.amount]) !== '') {
      amount = cellMoney(r[c.amount], cur);
      if (amount !== null && c.direction !== undefined) {
        const dir = norm(r[c.direction]);
        if (/^(out|expense|spend|spending|debit|dr|keluar|pengeluaran|gastos|labas)/.test(dir)) amount = -Math.abs(amount);
        else if (/^(in|income|credit|cr|masuk|pemasukan|kita|pasok)/.test(dir)) amount = Math.abs(amount);
      }
    } else {
      const out = c.out !== undefined ? cellMoney(r[c.out], cur) : null;
      const inn = c.in !== undefined ? cellMoney(r[c.in], cur) : null;
      const badOut = c.out !== undefined && text(r[c.out]) !== '' && out === null;
      const badIn = c.in !== undefined && text(r[c.in]) !== '' && inn === null;
      amount = badOut || badIn ? null : (inn ?? 0) - Math.abs(out ?? 0);
    }
    if (amount === null) return errors.push({ sheet, line, message: 'Unreadable amount on this row.' });
    if (amount === 0) return errors.push({ sheet, line, message: 'Amount is zero; row skipped.' });
    if (Math.abs(amount) > maxAmount) return errors.push({ sheet, line, message: `Amount over ${formatMoney(maxAmount, {}, cur)}; skipped for safety. Add it by hand if it is right.` });
    const catText = c.category !== undefined ? text(r[c.category]) : '';
    const cl = categorise(desc, amount, catText, ctx.rules);
    // Spending labelled as income (or the reverse) by sign: trust the sign, flag for review.
    let category = cl.category;
    let subcategory = cl.subcategory;
    let essentiality = cl.essentiality;
    if (amount < 0 && category === 'income') {
      category = 'uncategorised';
      subcategory = 'unknown';
      essentiality = 'review';
    }
    if (amount > 0 && category !== 'income' && category !== 'transfer') {
      // A positive amount in a spending category is a refund or reimbursement.
      category = 'income';
      subcategory = 'other-income';
      essentiality = 'review';
    }
    const account = c.account !== undefined ? sanitiseText(text(r[c.account])).slice(0, 40) : '';
    if (account) accountNames.add(account);
    parsed.push({
      id: uid('tx'),
      date,
      merchant: desc,
      description: desc,
      amountCents: amount,
      category,
      subcategory: subcategoryDef(category, subcategory) ? subcategory : GENERIC_SUB[category],
      essentiality,
      source: 'imported',
      providerId: 'spreadsheet',
      accountId: account ? `acct:${account.toLowerCase()}` : undefined,
      confidence: cl.confidence,
      flags: essentiality === 'review' && amount < 0 ? ['review'] : undefined,
    });
  });
  return { parsed, total, header: h, accountNames: [...accountNames] };
}

/* --------------------------- Income sheet --------------------------- */

const FREQ_WORDS: Array<[RegExp, Frequency]> = [
  [/^(daily|every day|day|harian|araw araw|araw)/, 'daily'],
  [/^(fortnight|biweekly|bi weekly|every 2 weeks|every two weeks|2 weeks|dua minggu|kada 2 linggo)/, 'fortnightly'],
  [/^(weekly|every week|week|mingguan|lingguhan)/, 'weekly'],
  [/^(monthly|every month|month|bulanan|buwanan)/, 'monthly'],
  [/^(quarter|every 3 months|3 months)/, 'quarterly'],
  [/^(annual|yearly|every year|tahunan|taunan)/, 'annual'],
  [/^(once|one off|one time|sekali|isang beses)/, 'once'],
];
export function frequencyFromText(v: Cell | undefined): Frequency | null {
  const s = norm(v);
  for (const [re, f] of FREQ_WORDS) if (re.test(s)) return f;
  return null;
}

function parseIncomeSheet(sheet: string, rows: Cell[][], ctx: ImportContext, errors: SheetError[]): IncomeSource[] {
  const h = findHeader(rows, [['source', 'income', 'name', 'description', 'sumber', 'pinagmulan'], AMOUNT], {
    type: ['type', 'kind', 'jenis', 'uri'],
    frequency: ['frequency', 'how often', 'every', 'frekuensi', 'gaano kadalas'],
    next: ['next date', 'next payment', 'next pay date', 'next', 'date', 'tanggal berikutnya'],
    certainty: ['certainty', 'how sure', 'confidence', 'kepastian'],
    earner: ['earner', 'who', 'person', 'siapa', 'sino'],
    varies: ['varies by', 'varies by %', 'variability', 'swing', 'varies'],
  });
  if (!h) {
    if (rows.some((r) => r.some((v) => text(v)))) errors.push({ sheet, line: 1, message: 'Income sheet needs at least Source and Amount columns; it was skipped.' });
    return [];
  }
  const c = h.cols;
  const out: IncomeSource[] = [];
  rows.slice(h.row + 1).forEach((r, idx) => {
    const line = h.row + idx + 2;
    if (!r || r.every((v) => text(v) === '')) return;
    const name = sanitiseText(text(r[c.source]));
    const amount = cellMoney(r[c.amount], ctx.market.currency);
    if (!name) return errors.push({ sheet, line, message: 'Income source has no name; skipped.' });
    if (amount === null || amount <= 0) return errors.push({ sheet, line, message: `Income "${name}" needs a positive amount; skipped.` });
    let freq = c.frequency !== undefined ? frequencyFromText(r[c.frequency]) : 'monthly';
    if (!freq || freq === 'once' || freq === 'quarterly' || freq === 'annual') {
      errors.push({ sheet, line, message: `Income "${name}": frequency should be daily, weekly, fortnightly or monthly. Monthly was assumed.` });
      freq = 'monthly';
    }
    let next = c.next !== undefined ? cellDate(r[c.next]) : null;
    if (!next || next < ctx.today) next = rollForward(next ?? ctx.today, freq, ctx.today);
    const kindText = c.type !== undefined ? norm(r[c.type]) : '';
    const kind: IncomeSource['kind'] = /salary|wage|gaji|sahod/.test(kindText)
      ? 'salary'
      : /gig|deliver|ride|driver|platform/.test(kindText)
        ? 'gig'
        : /part/.test(kindText)
          ? 'parttime'
          : /allowance|elaun|baon/.test(kindText)
            ? 'allowance'
            : /business|sales|stall|shop|usaha|jualan|negosyo/.test(kindText)
              ? 'business'
              : 'other';
    const certText = c.certainty !== undefined ? norm(r[c.certainty]) : '';
    const certainty: IncomeCertainty = /^(confirmed|fixed|certain|sure|pasti|sigurado)/.test(certText)
      ? 'confirmed'
      : /^(uncertain|unsure|maybe|occasional|tidak pasti|hindi sigurado)/.test(certText)
        ? 'uncertain'
        : kind === 'salary'
          ? 'confirmed'
          : 'expected';
    out.push({
      id: uid('inc'),
      name,
      kind,
      earner: c.earner !== undefined ? sanitiseText(text(r[c.earner])) || 'You' : 'You',
      frequency: freq as IncomeSource['frequency'],
      netAmountCents: amount,
      nextDate: next,
      certainty,
      variability: variesOf(c.varies !== undefined ? r[c.varies] : undefined, certainty),
      source: 'imported',
    });
  });
  return out;
}

function variesOf(v: Cell | undefined, certainty: IncomeCertainty): number {
  const n = typeof v === 'number' ? v : Number(String(v ?? '').replace('%', '').trim());
  if (String(v ?? '').trim() !== '' && Number.isFinite(n) && n >= 0) return Math.min(0.6, n > 1 ? n / 100 : n);
  return certainty === 'confirmed' ? 0 : certainty === 'expected' ? 0.2 : 0.4;
}

/* ---------------------------- Bills sheet ---------------------------- */

function parseBillsSheet(sheet: string, rows: Cell[][], ctx: ImportContext, errors: SheetError[]): RecurringBill[] {
  const h = findHeader(rows, [['bill', 'name', 'description', 'payee', 'tagihan', 'bayarin'], AMOUNT], {
    category: CATEGORY,
    frequency: ['frequency', 'how often', 'every', 'frekuensi'],
    next: ['next due', 'due date', 'next date', 'due', 'date', 'jatuh tempo', 'takdang petsa'],
    priority: ['priority', 'importance', 'essential', 'prioritas'],
    auto: ['auto debit', 'autodebit', 'giro', 'auto pay', 'autopay'],
  });
  if (!h) {
    if (rows.some((r) => r.some((v) => text(v)))) errors.push({ sheet, line: 1, message: 'Bills sheet needs at least Bill and Amount columns; it was skipped.' });
    return [];
  }
  const c = h.cols;
  const out: RecurringBill[] = [];
  rows.slice(h.row + 1).forEach((r, idx) => {
    const line = h.row + idx + 2;
    if (!r || r.every((v) => text(v) === '')) return;
    const name = sanitiseText(text(r[c.bill]));
    const raw = cellMoney(r[c.amount], ctx.market.currency);
    if (!name) return errors.push({ sheet, line, message: 'Bill has no name; skipped.' });
    if (raw === null || raw === 0) return errors.push({ sheet, line, message: `Bill "${name}" needs an amount; skipped.` });
    const amount = Math.abs(raw);
    const freq = (c.frequency !== undefined ? frequencyFromText(r[c.frequency]) : null) ?? 'monthly';
    let due = c.next !== undefined ? cellDate(r[c.next]) : null;
    if (!due) {
      errors.push({ sheet, line, message: `Bill "${name}" has no next due date; assumed due today so it stays protected.` });
      due = ctx.today;
    } else if (due < ctx.today && freq !== 'once') {
      // Overdue by a few days stays overdue (protected now); older dates roll forward.
      if (diffDays(due, ctx.today) > 7) due = rollForward(due, freq, ctx.today);
    }
    const cl = categorise(name, -amount, c.category !== undefined ? text(r[c.category]) : '', ctx.rules);
    const category: CategoryId = cl.category === 'income' || cl.category === 'transfer' ? 'uncategorised' : cl.category;
    const subcategory = category === cl.category ? cl.subcategory : 'unknown';
    const prText = c.priority !== undefined ? norm(r[c.priority]) : '';
    const base = defaultEssentiality(category, subcategory);
    const priority: RecurringBill['priority'] = /^(debt|loan|contract|obligation|must)/.test(prText)
      ? 'obligation'
      : /^(essential|need|important|penting|kailangan)/.test(prText)
        ? 'essential'
        : /^(adjust|flexible|can reduce)/.test(prText)
          ? 'adjustable'
          : /^(optional|nice|want|discretionary|luxury)/.test(prText)
            ? 'discretionary'
            : base === 'review'
              ? 'essential'
              : (base as RecurringBill['priority']);
    out.push({
      id: uid('bill'),
      name,
      category,
      subcategory,
      amountCents: amount,
      nextDue: due,
      frequency: freq,
      priority,
      status: 'unpaid',
      source: 'imported',
      confidence: 'high',
      autoDebit: c.auto !== undefined ? /^(y|yes|true|1|ya|oo)/.test(norm(r[c.auto])) : false,
    });
  });
  return out;
}

/* --------------------------- Balances sheet --------------------------- */

function parseBalancesSheet(sheet: string, rows: Cell[][], ctx: ImportContext, errors: SheetError[]): DraftAccount[] {
  const h = findHeader(rows, [['account', 'account name', 'name', 'wallet', 'akun', 'rekening'], ['balance', 'amount', 'saldo', 'current balance', 'available balance']], {
    type: ['type', 'kind', 'jenis'],
    role: ['role', 'use', 'purpose', 'for', 'kegunaan', 'gamit'],
  });
  if (!h) {
    if (rows.some((r) => r.some((v) => text(v)))) errors.push({ sheet, line: 1, message: 'Balances sheet needs Account and Balance columns; it was skipped.' });
    return [];
  }
  const c = h.cols;
  const out: DraftAccount[] = [];
  rows.slice(h.row + 1).forEach((r, idx) => {
    const line = h.row + idx + 2;
    if (!r || r.every((v) => text(v) === '')) return;
    const name = sanitiseText(text(r[c.account])).slice(0, 40);
    const bal = cellMoney(r[c.balance], ctx.market.currency);
    if (!name) return errors.push({ sheet, line, message: 'Account has no name; skipped.' });
    if (bal === null) return errors.push({ sheet, line, message: `Account "${name}" has an unreadable balance; enter it on the review screen.` });
    const typeText = c.type !== undefined ? norm(r[c.type]) : norm(name);
    const kind: Account['kind'] = /cash|tunai|pera|box|tin\b|wallet cash/.test(typeText) ? 'cash' : /e ?wallet|gcash|maya|kbzpay|wavepay|aya pay|grabpay|shopeepay|paylah|wallet/.test(typeText) ? 'ewallet' : 'bank';
    const roleText = c.role !== undefined ? norm(r[c.role]) : norm(name);
    const role: Account['role'] = /emergency|rainy|darurat|ipon|buffer|safety/.test(roleText) ? 'emergency' : 'spending';
    out.push({ key: `acct:${name.toLowerCase()}`, name, kind, role, balanceCents: bal, fromSheet: true });
  });
  return out;
}

/* ------------------------------ Draft ------------------------------ */

export function rollForward(from: ISODate, freq: Frequency, today: ISODate): ISODate {
  if (freq === 'once') return from < today ? today : from;
  let d = from;
  const step = (x: ISODate): ISODate => {
    switch (freq) {
      case 'daily':
        return addDays(x, 1);
      case 'weekly':
        return addDays(x, 7);
      case 'fortnightly':
        return addDays(x, 14);
      case 'monthly': {
        const [y, m, dd] = x.split('-').map(Number);
        const t = new Date(Date.UTC(y, m, 1));
        const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
        return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(Math.min(dd, last)).padStart(2, '0')}`;
      }
      case 'quarterly':
        return step3(x, 3);
      case 'annual':
        return step3(x, 12);
    }
    return addDays(x, 30);
  };
  const step3 = (x: ISODate, months: number): ISODate => {
    const [y, m, dd] = x.split('-').map(Number);
    const t = new Date(Date.UTC(y, m - 1 + months, 1));
    const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
    return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(Math.min(dd, last)).padStart(2, '0')}`;
  };
  for (let i = 0; i < 2000 && d < today; i++) d = step(d);
  return d;
}

/** Turn already-read sheets into a draft for review. */
export function draftFromSheets(sheets: Sheets, fileName: string, format: 'xlsx' | 'csv', ctx: ImportContext): ImportDraft {
  const errors: SheetError[] = [];
  const warnings: string[] = [];
  const names = Object.keys(sheets);
  let txSheet = pickSheet(sheets, SHEET_NAMES.transactions);
  if (!txSheet || !transactionHeader(sheets[txSheet])) {
    // Fall back to the first sheet that looks like a transaction list.
    txSheet = names.find((n) => transactionHeader(sheets[n])) ?? txSheet ?? names[0];
  }
  const tx = txSheet ? parseTransactions(txSheet, sheets[txSheet] ?? [], ctx, errors) : { parsed: [], total: 0, header: null, accountNames: [] };
  const { fresh, duplicates } = findDuplicates(ctx.existing, tx.parsed);

  const incomeSheet = pickSheet(sheets, SHEET_NAMES.income);
  const billSheet = pickSheet(sheets, SHEET_NAMES.bills);
  const balanceSheet = pickSheet(sheets, SHEET_NAMES.balances);
  const sheetIncome = incomeSheet && incomeSheet !== txSheet ? parseIncomeSheet(incomeSheet, sheets[incomeSheet], ctx, errors) : [];
  const sheetBills = billSheet && billSheet !== txSheet ? parseBillsSheet(billSheet, sheets[billSheet], ctx, errors) : [];
  const sheetAccounts = balanceSheet && balanceSheet !== txSheet ? parseBalancesSheet(balanceSheet, sheets[balanceSheet], ctx, errors) : [];

  const all = [...fresh, ...ctx.existing];
  // Only offer patterns the new file contributes to; ones built purely from existing records are already known.
  const freshIds = new Set(fresh.map((t) => t.id));
  const touchesFile = (d: { txIds: string[] }) => d.txIds.some((id) => freshIds.has(id));
  const income: DraftItem<IncomeSource>[] = sheetIncome.length
    ? sheetIncome.map((item) => ({ item, origin: 'sheet' as const, include: true }))
    : detectIncome(all, ctx.today, ctx.market).filter(touchesFile).map((d) => ({ item: d.item, origin: 'detected' as const, evidence: d.evidence, include: d.include, txIds: d.txIds }));
  const bills: DraftItem<RecurringBill>[] = sheetBills.length
    ? sheetBills.map((item) => ({ item, origin: 'sheet' as const, include: true }))
    : detectBills(all, ctx.today, ctx.market).filter(touchesFile).map((d) => ({ item: d.item, origin: 'detected' as const, evidence: d.evidence, include: d.include, txIds: d.txIds }));

  // Accounts: those from the Balances sheet, plus any named only in transactions.
  const accounts: DraftAccount[] = [...sheetAccounts];
  for (const n of tx.accountNames) {
    const key = `acct:${n.toLowerCase()}`;
    if (!accounts.some((a) => a.key === key)) {
      const lower = n.toLowerCase();
      accounts.push({
        key,
        name: n,
        kind: /cash|tunai|pera/.test(lower) ? 'cash' : /wallet|gcash|maya|kbzpay|wavepay|aya pay|grabpay|paylah/.test(lower) ? 'ewallet' : 'bank',
        role: /emergency|darurat|ipon/.test(lower) ? 'emergency' : 'spending',
        balanceCents: null,
        fromSheet: false,
      });
    }
  }

  const dates = fresh.map((t) => t.date).sort();
  const from = dates[0] ?? null;
  const to = dates[dates.length - 1] ?? null;
  const days = from && to ? diffDays(from, to) + 1 : 0;
  if (fresh.length && days < 21) warnings.push(`The file covers ${days} day${days === 1 ? '' : 's'}. Four weeks or more gives a steadier estimate of everyday spending; until then SavvyMoni uses the daily amount you confirm.`);
  if (fresh.length && to && diffDays(to, ctx.today) > 14) warnings.push(`The newest transaction is from ${to}. Spending since then is not known, so the estimate may be out of date.`);
  if (!sheetAccounts.length) warnings.push('No Balances sheet was found. Enter what each account holds today on the next step.');
  const reviewCount = fresh.filter((t) => t.flags?.includes('review')).length;
  if (reviewCount) warnings.push(`${reviewCount} transaction${reviewCount === 1 ? '' : 's'} could not be categorised and will be treated as essential until you review them.`);

  const est = estimateDaily(fresh, bills.filter((b) => b.include).map((b) => b.item), days);

  const h = tx.header;
  return {
    fileName,
    format,
    sheetsFound: names,
    transactionSheet: txSheet ?? '',
    transactions: fresh,
    duplicates: duplicates.length,
    totalRows: tx.total,
    errors,
    warnings,
    income,
    bills,
    accounts,
    incomeFromSheet: sheetIncome.length > 0,
    billsFromSheet: sheetBills.length > 0,
    history: { from, to, days },
    dailyEssentialCents: est.essential,
    dailyDiscretionaryCents: est.discretionary,
    columns: h
      ? {
          date: h.labels[h.cols.date] ?? '',
          description: h.labels[h.cols.description] ?? '',
          amount: h.cols.amount !== undefined ? h.labels[h.cols.amount] : [h.cols.out, h.cols.in].filter((x) => x !== undefined).map((i) => h.labels[i!]).join(' / '),
          category: h.cols.category !== undefined ? h.labels[h.cols.category] : undefined,
          account: h.cols.account !== undefined ? h.labels[h.cols.account] : undefined,
        }
      : { date: '', description: '', amount: '' },
  };
}

/** Average daily spending over the file, leaving out payments of the listed bills. */
export function estimateDaily(txns: Transaction[], bills: RecurringBill[], days: number): { essential: Cents; discretionary: Cents } {
  if (days <= 0) return { essential: 0, discretionary: 0 };
  let ess = 0;
  let disc = 0;
  for (const t of txns) {
    if (!isSpending(t) || t.billId) continue;
    const amt = Math.abs(t.amountCents);
    const isBill = bills.some((b) => b.frequency !== 'once' && Math.abs(amt - b.amountCents) <= Math.max(100, b.amountCents * 0.05) && t.merchant.toLowerCase().includes(b.name.toLowerCase().split(' ')[0]));
    if (isBill) continue;
    if (t.essentiality === 'discretionary') disc += amt;
    else ess += amt;
  }
  return { essential: Math.round(ess / days), discretionary: Math.round(disc / days) };
}

export interface FileCheck {
  ok: boolean;
  error?: string;
  format?: 'xlsx' | 'csv';
}

export function checkImportFile(name: string, size: number): FileCheck {
  const ext = name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? '';
  if (ext === 'xls') return { ok: false, error: 'Older .xls files are not supported. In Excel choose File → Save As → Excel Workbook (.xlsx), or CSV.' };
  if (ext === 'xlsm') return { ok: false, error: 'Macro-enabled workbooks (.xlsm) are not accepted. Save a copy as .xlsx without macros.' };
  if (ext !== 'xlsx' && ext !== 'csv') return { ok: false, error: 'Choose an Excel workbook (.xlsx) or a CSV file. PDF statements need to be exported as CSV or Excel from your bank first.' };
  if (size === 0) return { ok: false, error: 'The file is empty.' };
  if (size > MAX_IMPORT_BYTES) return { ok: false, error: `The file is ${(size / 1_000_000).toFixed(1)} MB. The limit is ${MAX_IMPORT_BYTES / 1_000_000} MB; export a shorter date range.` };
  return { ok: true, format: ext as 'xlsx' | 'csv' };
}

/** Read a file's bytes into a draft. Everything happens on this device. */
export async function draftFromFile(name: string, bytes: ArrayBuffer | Uint8Array, ctx: ImportContext): Promise<ImportDraft> {
  const check = checkImportFile(name, bytes.byteLength);
  if (!check.ok) throw new Error(check.error);
  let sheets: Sheets;
  if (check.format === 'xlsx') sheets = await readXlsx(bytes, MAX_IMPORT_ROWS + 50);
  else {
    const textContent = new TextDecoder('utf-8').decode(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
    sheets = { Transactions: parseCSV(textContent) };
  }
  if (!Object.keys(sheets).length) throw new Error('The workbook has no sheets.');
  return draftFromSheets(sheets, name, check.format!, ctx);
}

/** Monthly totals of included income and bills, for the review screen. */
export function draftMonthly(d: Pick<ImportDraft, 'income' | 'bills'>): { income: Cents; bills: Cents } {
  const inc = d.income.filter((x) => x.include).reduce((t, x) => t + x.item.netAmountCents * monthlyFactor(x.item.frequency), 0);
  const bil = d.bills.filter((x) => x.include && x.item.frequency !== 'once').reduce((t, x) => t + x.item.amountCents * monthlyFactor(x.item.frequency), 0);
  return { income: Math.round(inc), bills: Math.round(bil) };
}
