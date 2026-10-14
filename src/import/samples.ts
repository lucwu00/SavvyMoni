/**
 * Workbooks the app can hand out: a blank template, synthetic sample files
 * (one per demo country), and an export of the user's own data. All use the
 * layout that the importer reads, so any of them can be edited in Excel,
 * Google Sheets or Numbers and imported again.
 */
import { marketFor, type MarketConfig } from '../config/markets';
import { buildPersonaState, DEFAULT_PERSONA, type PersonaId } from '../data/personas';
import { categoryLabel } from '../domain/categories';
import type { ISODate } from '../domain/dates';
import { addDays } from '../domain/dates';
import type { AppState, Transaction } from '../domain/types';
import { applyImport, emptyState } from './build';
import { draftFromSheets } from './workbook';
import { readXlsx, writeXlsx, type SheetSpec } from './xlsx';

const major = (minorAmount: number, m: MarketConfig) => minorAmount / 10 ** m.currency.minorUnits;

export const TX_HEADERS = ['Date', 'Description', 'Amount', 'Category', 'Account'];
export const INCOME_HEADERS = ['Source', 'Type', 'Amount', 'Frequency', 'Next date', 'Certainty', 'Varies by %'];
export const BILL_HEADERS = ['Bill', 'Category', 'Amount', 'Frequency', 'Next due', 'Priority', 'Auto-debit'];
export const BALANCE_HEADERS = ['Account', 'Type', 'Role', 'Balance'];

function readMe(m: MarketConfig, kind: 'template' | 'sample' | 'export', extra: string[] = []): SheetSpec {
  const cur = m.currency.code;
  const lines: string[][] = [
    ['SavvyMoni workbook'],
    [kind === 'sample' ? 'SAMPLE FILE: every number here is synthetic and describes no real person.' : kind === 'export' ? 'Your data exported from SavvyMoni on this device.' : 'Fill in the sheets, save as .xlsx (or export one sheet as .csv) and import it in SavvyMoni.'],
    [''],
    ['Sheet', 'What to put there'],
    ['Transactions (required)', `One row per payment or receipt. Amount in ${cur}: negative for money out, positive for money in. Or use two columns, "Money out" and "Money in". Category and Account are optional.`],
    ['Income (optional)', 'Regular income: Amount is take-home per payment. Frequency: daily, weekly, fortnightly or monthly. Certainty: confirmed, expected or uncertain. "Varies by %" (optional): how much a payment usually swings, e.g. 20. If you leave this sheet out, SavvyMoni looks for regular income in your transactions and asks you to confirm.'],
    ['Bills (optional)', 'Regular payments to protect: rent, utilities, phone, loans, insurance, school fees. Priority: essential, obligation (debt or contract), adjustable or discretionary. If you leave this sheet out, SavvyMoni detects repeating payments and asks you to confirm.'],
    ['Balances (optional)', 'What each account, e-wallet or cash box holds today. Role: spending or emergency. If you leave it out, you enter balances during import.'],
    [''],
    ['Dates', 'YYYY-MM-DD, DD/MM/YYYY or real Excel dates all work.'],
    ['Categories', 'Housing, Groceries, Food & drinks, Transport, Healthcare, Utilities, Family, Financial, Lifestyle, Business, Income, Transfer. Your own words work too ("Rent", "Makan", "Load"); anything unrecognised is sorted by the description.'],
    ['Privacy', 'Never put account numbers, card numbers, passwords, NRIC or other ID numbers, or medical details in this file. SavvyMoni reads the file on your device only.'],
    ['Formulas', 'Only the values shown in cells are read. Formulas, macros and links are ignored.'],
    ...extra.map((e) => ['', e]),
  ];
  return { name: 'Read me', rows: lines, widths: [26, 110] };
}

function accountFor(t: Transaction, s: AppState): string {
  if (t.accountId) {
    const a = s.accounts.find((x) => x.id === t.accountId);
    if (a) return a.name;
  }
  const spending = s.accounts.filter((a) => a.role === 'spending');
  if (t.providerId === 'cash-ledger') return (spending.find((a) => a.kind === 'cash') ?? spending[0])?.name ?? '';
  if (t.providerId === 'gcash' || t.providerId === 'ewallet') return (spending.find((a) => a.kind === 'ewallet') ?? spending[0])?.name ?? '';
  return (spending.find((a) => a.kind !== 'cash') ?? spending[0])?.name ?? '';
}

function transactionsSheet(s: AppState, m: MarketConfig): SheetSpec {
  type Row = { date: string; cells: Array<string | number | { date: string }> };
  const rows: Row[] = s.transactions.map((t) => ({ date: t.date, cells: [{ date: t.date }, t.merchant, major(t.amountCents, m), categoryLabel(t.category), accountFor(t, s)] }));
  // Savings moved in the app are written as transfers from spending money, so the
  // savings history can be worked out again after re-importing.
  const saving = s.accounts.find((a) => a.role === 'emergency')?.name ?? 'emergency savings';
  const spending = (s.accounts.find((a) => a.role === 'spending' && a.kind !== 'cash') ?? s.accounts.find((a) => a.role === 'spending'))?.name ?? '';
  for (const c of s.contributions) {
    const desc = c.amountCents >= 0 ? `Transfer to ${saving}` : `Transfer from ${saving}`;
    rows.push({ date: c.date, cells: [{ date: c.date }, desc, major(-c.amountCents, m), 'Transfer', spending] });
  }
  rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return { name: 'Transactions', rows: [TX_HEADERS, ...rows.map((r) => r.cells)], widths: [12, 40, 12, 18, 22] };
}

function balancesSheet(s: AppState, m: MarketConfig): SheetSpec {
  const kind = { bank: 'Bank', ewallet: 'E-wallet', cash: 'Cash' } as const;
  return {
    name: 'Balances',
    rows: [BALANCE_HEADERS, ...s.accounts.map((a) => [a.name, kind[a.kind], a.role === 'emergency' ? 'Emergency' : 'Spending', major(a.balanceCents, m)])],
    widths: [28, 12, 12, 14],
  };
}

/** Example rows shown in each country's Read me (not in the sheets, so they are never imported by mistake). */
const EXAMPLES: Record<string, { tx: Array<[string, string, number, string, string]>; income: string; bill: string; balance: string }> = {
  SG: {
    tx: [
      ['2026-10-01', 'Hawker lunch', -5.5, 'Food & drinks', 'POSB account'],
      ['2026-10-02', 'FairPrice groceries', -42.3, 'Groceries', 'POSB account'],
      ['2026-10-03', 'Bus and MRT', -3.2, 'Transport', 'POSB account'],
      ['2026-10-05', 'Shift pay', 800, 'Income', 'POSB account'],
    ],
    income: 'Shift pay | Part-time | 800 | Fortnightly | 2026-10-19 | Expected | 20',
    bill: 'Room rent | Housing | 650 | Monthly | 2026-11-01 | Essential | No',
    balance: 'POSB account | Bank | Spending | 1040.40',
  },
  PH: {
    tx: [
      ['2026-10-01', 'Carinderia lunch', -85, 'Food & drinks', 'Cash'],
      ['2026-10-01', 'Load', -50, 'Utilities & connectivity', 'GCash'],
      ['2026-10-02', 'Gasolina', -200, 'Work & business costs', 'Cash'],
      ['2026-10-04', 'Delivery payout', 7000, 'Income', 'GCash'],
    ],
    income: 'Delivery payout | Gig | 7000 | Weekly | 2026-10-11 | Expected | 20',
    bill: 'Boarding house rent | Housing | 3000 | Monthly | 2026-10-18 | Essential | No',
    balance: 'Cash | Cash | Spending | 2600',
  },
  MM: {
    tx: [
      ['2026-10-01', 'Tea shop lunch', -2000, 'Food & drinks', 'Cash'],
      ['2026-10-02', 'Rice and oil at the zay', -7000, 'Groceries', 'Cash'],
      ['2026-10-03', 'Phone top-up', -3000, 'Utilities & connectivity', 'Mobile wallet'],
      ['2026-10-05', 'Factory wages', 110000, 'Income', 'Cash'],
    ],
    income: 'Factory wages | Salary | 110000 | Fortnightly | 2026-10-19 | Expected | 10',
    bill: 'Hostel room share | Housing | 40000 | Monthly | 2026-10-22 | Essential | No',
    balance: 'Cash on hand | Cash | Spending | 90000',
  },
};

const CATEGORY_LIST = ['Housing', 'Groceries', 'Food & drinks', 'Transport', 'Healthcare', 'Utilities & connectivity', 'Family & education', 'Financial commitments', 'Lifestyle', 'Work & business costs', 'Income', 'Transfers'];

/** Blank template for one country: headings, drop-down lists and local examples in the Read me. */
export function templateWorkbook(marketCode: string): Uint8Array {
  const m = marketFor(marketCode);
  const ex = EXAMPLES[marketCode] ?? EXAMPLES.SG;
  const whole = m.currency.minorUnits === 0 ? ' Kyat amounts are whole numbers: write 25000 or 25,000.' : '';
  const notes = [
    `Country: ${m.name}. Amounts in ${m.currency.code}.${whole}`,
    '',
    'Example rows for the Transactions sheet (Date | Description | Amount | Category | Account):',
    ...ex.tx.map((r) => r.join(' | ')),
    '',
    `Example Income row: ${ex.income}`,
    `Example Bills row: ${ex.bill}`,
    `Example Balances row: ${ex.balance}`,
    '',
    'Columns with a small arrow have a drop-down list. You can also type your own category words.',
  ];
  return writeXlsx([
    readMe(m, 'template', notes),
    { name: 'Transactions', rows: [TX_HEADERS], widths: [12, 40, 12, 24, 22], lists: [{ col: 3, values: CATEGORY_LIST, strict: false }] },
    {
      name: 'Income',
      rows: [INCOME_HEADERS],
      widths: [28, 12, 12, 14, 12, 12, 12],
      lists: [
        { col: 1, values: ['Salary', 'Gig', 'Part-time', 'Allowance', 'Business', 'Other'] },
        { col: 3, values: ['Daily', 'Weekly', 'Fortnightly', 'Monthly'] },
        { col: 5, values: ['Confirmed', 'Expected', 'Uncertain'] },
      ],
    },
    {
      name: 'Bills',
      rows: [BILL_HEADERS],
      widths: [28, 24, 12, 14, 12, 14, 10],
      lists: [
        { col: 1, values: CATEGORY_LIST.filter((c) => c !== 'Income' && c !== 'Transfers'), strict: false },
        { col: 3, values: ['Daily', 'Weekly', 'Fortnightly', 'Monthly', 'Quarterly', 'Annual', 'Once'] },
        { col: 5, values: ['Essential', 'Obligation', 'Adjustable', 'Discretionary'] },
        { col: 6, values: ['Yes', 'No'] },
      ],
    },
    { name: 'Balances', rows: [BALANCE_HEADERS], widths: [28, 12, 14, 14], lists: [{ col: 1, values: ['Bank', 'E-wallet', 'Cash'] }, { col: 2, values: ['Spending', 'Emergency'] }] },
  ]);
}

/** The synthetic person behind each country's sample file. */
export const SAMPLE_PERSONA: Record<'SG' | 'PH' | 'MM', PersonaId> = DEFAULT_PERSONA;

export function sampleState(marketCode: 'SG' | 'PH' | 'MM', today: ISODate, personaId: PersonaId = SAMPLE_PERSONA[marketCode]): AppState {
  // History ends yesterday so every row is in the past on import day.
  return buildPersonaState(personaId, today, new Date().toISOString(), 90);
}

/**
 * Synthetic sample workbook: 90 days of transactions plus balances. Income
 * and Bills sheets are left out on purpose so the import shows how regular
 * payments are detected from history.
 */
export function sampleWorkbook(marketCode: 'SG' | 'PH' | 'MM', today: ISODate, personaId?: PersonaId): Uint8Array {
  const m = marketFor(marketCode);
  const s = sampleState(marketCode, today, personaId);
  return writeXlsx([
    readMe(m, 'sample', [`Sample person: ${s.profile.displayName}, ${s.profile.personaLabel}. ${s.profile.incomePattern}.`, `Generated for ${addDays(today, -90)} to ${addDays(today, -1)}.`]),
    transactionsSheet(s, m),
    balancesSheet(s, m),
  ]);
}

const FREQ = { daily: 'Daily', weekly: 'Weekly', fortnightly: 'Fortnightly', monthly: 'Monthly', quarterly: 'Quarterly', annual: 'Annual', once: 'Once' } as const;

/** Everything the user has, in the same layout, so it can be kept, edited and re-imported. */
export function exportWorkbook(s: AppState, kind: 'export' | 'sample' = 'export', notes: string[] = []): Uint8Array {
  const m = marketFor(s.marketCode);
  const typeOf: Record<string, string> = { salary: 'Salary', gig: 'Gig', parttime: 'Part-time', allowance: 'Allowance', business: 'Business', other: 'Other' };
  const priority: Record<string, string> = { essential: 'Essential', obligation: 'Obligation', adjustable: 'Adjustable', discretionary: 'Discretionary' };
  return writeXlsx([
    readMe(m, kind, notes),
    transactionsSheet(s, m),
    {
      name: 'Income',
      rows: [INCOME_HEADERS, ...s.incomeSources.map((i) => [i.name, typeOf[i.kind] ?? 'Other', major(i.netAmountCents, m), FREQ[i.frequency], { date: i.nextDate }, i.certainty[0].toUpperCase() + i.certainty.slice(1), Math.round(i.variability * 100)])],
      widths: [28, 12, 12, 14, 12, 12, 12],
    },
    {
      name: 'Bills',
      rows: [
        BILL_HEADERS,
        ...s.bills.filter((b) => b.status === 'unpaid').map((b) => [b.name, categoryLabel(b.category), major(b.amountCents, m), FREQ[b.frequency], { date: b.nextDue }, priority[b.priority], b.autoDebit ? 'Yes' : 'No']),
      ],
      widths: [28, 16, 12, 14, 12, 12, 10],
    },
    balancesSheet(s, m),
  ]);
}

const sampleCache = new Map<string, Promise<AppState>>();

/**
 * A plan built from the sample workbook through the normal import path:
 * write the .xlsx, read it back, detect income and bills, apply. Used where
 * the app compares countries and the user has no records of their own there.
 */
export function samplePlan(marketCode: 'SG' | 'PH' | 'MM', today: ISODate): Promise<AppState> {
  const key = `${marketCode}:${today}`;
  let p = sampleCache.get(key);
  if (!p) {
    p = (async () => {
      const m = marketFor(marketCode);
      const sheets = await readXlsx(sampleWorkbook(marketCode, today));
      const draft = draftFromSheets(sheets, `SavvyMoni-sample-${marketCode}.xlsx`, 'xlsx', { market: m, today, rules: [], existing: [] });
      const s = applyImport(
        emptyState(marketCode, today),
        draft,
        { displayName: SAMPLE_NAMES[marketCode], accounts: draft.accounts.map((a) => ({ ...a, balanceCents: a.balanceCents ?? 0 })), dailyEssentialCents: draft.dailyEssentialCents, dailyDiscretionaryCents: draft.dailyDiscretionaryCents },
        today,
      );
      return { ...s, profile: { ...s.profile, personaLabel: 'Sample workbook (synthetic)' } };
    })();
    sampleCache.set(key, p);
  }
  return p;
}

const SAMPLE_NAMES: Record<'SG' | 'PH' | 'MM', string> = { SG: 'Sample: student worker', PH: 'Sample: delivery rider', MM: 'Sample: garment worker' };
