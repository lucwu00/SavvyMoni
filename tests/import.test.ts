/** Spreadsheet import: .xlsx reading/writing, column detection, regular-payment detection and applying a reviewed import. */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { marketFor } from '../src/config/markets';
import { parseCSV } from '../src/domain/csv';
import { addDays } from '../src/domain/dates';
import { computeRecommendation } from '../src/domain/engine';
import { estimateDailySpend } from '../src/domain/spending';
import { applyImport, emptyState, startCashBook } from '../src/import/build';
import { exportWorkbook, sampleWorkbook, samplePlan } from '../src/import/samples';
import { categoryFromText, draftFromFile, draftFromSheets, frequencyFromText, type ImportDraft } from '../src/import/workbook';
import { excelSerialToISO, isoToExcelSerial, readXlsx, writeXlsx } from '../src/import/xlsx';
import { reducer } from '../src/state/reducer';
import { TODAY } from './helpers';

const ctx = (code: 'SG' | 'PH' | 'MM') => ({ market: marketFor(code), today: TODAY, rules: [], existing: [] });
const choicesFor = (d: ImportDraft) => ({ accounts: d.accounts.map((a) => ({ ...a, balanceCents: a.balanceCents ?? 0 })), dailyEssentialCents: d.dailyEssentialCents, dailyDiscretionaryCents: d.dailyDiscretionaryCents });

describe('xlsx files', () => {
  it('writes a workbook and reads the same values back', async () => {
    const bytes = writeXlsx([
      { name: 'Transactions', rows: [['Date', 'Description', 'Amount'], [{ date: '2026-09-01' }, 'Tom & Jerry <café> "quoted"', -12.5], ['2026-09-02', 'Plain', 1000]] },
      { name: 'Balances', rows: [['Account', 'Balance'], ['Cash', 25000]] },
    ]);
    const sheets = await readXlsx(bytes);
    expect(Object.keys(sheets)).toEqual(['Transactions', 'Balances']);
    expect(sheets.Transactions[1]).toEqual([isoToExcelSerial('2026-09-01'), 'Tom & Jerry <café> "quoted"', -12.5]);
    expect(sheets.Transactions[2]).toEqual(['2026-09-02', 'Plain', 1000]);
    expect(sheets.Balances[1]).toEqual(['Cash', 25000]);
  });

  it('converts Excel serial dates', () => {
    expect(excelSerialToISO(46266)).toBe('2026-09-01');
    expect(isoToExcelSerial('2026-09-01')).toBe(46266);
    expect(excelSerialToISO(12.5)).toBe(null);
  });

  it('reads a compressed workbook saved by another program (openpyxl)', async () => {
    const bytes = readFileSync(new URL('./fixtures/openpyxl-statement.xlsx', import.meta.url));
    const d = await draftFromFile('statement.xlsx', new Uint8Array(bytes), ctx('SG'));
    // Header found below two title rows; Money Out / Money In columns; Total row ignored.
    expect(d.columns.date).toBe('Transaction Date');
    expect(d.columns.amount).toBe('Money Out / Money In');
    // The =HYPERLINK(...) cell is a formula with no stored value: it is not evaluated, so that row is reported, not imported.
    expect(d.transactions.length).toBe(6);
    expect(d.errors.map((e) => e.message)).toEqual(['Description is empty.']);
    const rent = d.transactions.find((t) => t.merchant === 'Landlord rent September')!;
    expect(rent.amountCents).toBe(-90000);
    expect(rent.category).toBe('housing');
    expect(d.transactions.find((t) => t.merchant.startsWith('Kopitiam'))?.category).toBe('food');
    expect(d.transactions.some((t) => t.merchant.includes('HYPERLINK'))).toBe(false);
    expect(d.accounts.map((a) => [a.name, a.role, a.balanceCents])).toEqual([
      ['Everyday account', 'spending', 123456],
      ['Rainy day', 'emergency', 30000],
    ]);
    // Two monthly salary credits and two rent payments are detected.
    expect(d.income[0].item.frequency).toBe('monthly');
    expect(d.income[0].item.netAmountCents).toBe(280000);
    expect(d.bills.some((b) => b.item.category === 'housing' && b.item.frequency === 'monthly' && b.item.amountCents === 90000)).toBe(true);
  });

  it('rejects files that are not workbooks', async () => {
    let msg = '';
    try {
      await draftFromFile('fake.xlsx', new TextEncoder().encode('not a zip'), ctx('SG'));
    } catch (e) {
      msg = (e as Error).message;
    }
    expect(msg).toContain('not a valid .xlsx');
  });
});

describe('Column and value detection', () => {
  it('reads Malay headings and kyat amounts', () => {
    const csv = `Buku tunai\nTarikh,Keterangan,Wang keluar,Wang masuk\n${addDays(TODAY, -2)},Zay rice and oil,"25,000",\n${addDays(TODAY, -1)},Factory wages,,"110,000"`;
    const d = draftFromSheets({ Transactions: parseCSV(csv) }, 'buku.csv', 'csv', ctx('MM'));
    expect(d.transactions.map((t) => t.amountCents).sort((a, b) => a - b)).toEqual([-25000, 110000]);
  });

  it('accepts a single Amount column with an In/Out type column', () => {
    const csv = `Date,Item,Amount,Type\n${addDays(TODAY, -1)},Load,50,Out\n${addDays(TODAY, -1)},Tips,120,In`;
    const d = draftFromSheets({ Sheet1: parseCSV(csv) }, 'x.csv', 'csv', ctx('PH'));
    expect(d.transactions.map((t) => t.amountCents).sort((a, b) => a - b)).toEqual([-5000, 12000]);
  });

  it('maps everyday category words and trusts the sign of the amount', () => {
    expect(categoryFromText('Makan')).toBe('food');
    expect(categoryFromText('Rent')).toBe('housing');
    expect(categoryFromText('Groceries')).toBe('groceries');
    expect(categoryFromText('Bill payment')).toBe(null);
    const csv = `Date,Description,Amount,Category\n${addDays(TODAY, -1)},Refund from shop,15,Shopping`;
    const d = draftFromSheets({ T: parseCSV(csv) }, 'x.csv', 'csv', ctx('SG'));
    expect(d.transactions[0].category).toBe('income');
  });

  it('reads frequency words in three languages', () => {
    expect(frequencyFromText('Weekly')).toBe('weekly');
    expect(frequencyFromText('harian')).toBe('daily');
    expect(frequencyFromText('buwanan')).toBe('monthly');
    expect(frequencyFromText('every 2 weeks')).toBe('fortnightly');
  });

  it('reads Income, Bills and Balances sheets and keeps old due dates protected', () => {
    const d = draftFromSheets(
      {
        Transactions: [['Date', 'Description', 'Amount', 'Account'], [addDays(TODAY, -3), 'Bus fare', -2.1, 'Everyday']],
        Income: [['Source', 'Type', 'Amount', 'Frequency', 'Next date', 'Certainty'], ['Shift pay', 'Part-time', 640, 'Fortnightly', addDays(TODAY, -20), 'Expected']],
        Bills: [['Bill', 'Category', 'Amount', 'Frequency', 'Next due', 'Priority'], ['Rent', 'Housing', 650, 'Monthly', addDays(TODAY, -2), 'Essential'], ['Gym', 'Lifestyle', 40, 'Monthly', addDays(TODAY, 9), 'Optional']],
        Balances: [['Account', 'Balance'], ['Everyday', 820.4]],
      },
      'mine.xlsx',
      'xlsx',
      ctx('SG'),
    );
    expect(d.incomeFromSheet).toBe(true);
    expect(d.income[0].item.kind).toBe('parttime');
    expect(d.income[0].item.nextDate >= TODAY).toBe(true);
    const rent = d.bills.find((b) => b.item.name === 'Rent')!.item;
    expect(rent.nextDue).toBe(addDays(TODAY, -2)); // overdue stays overdue: protected now
    expect(d.bills.find((b) => b.item.name === 'Gym')!.item.priority).toBe('discretionary');
    expect(d.transactions[0].accountId).toBe('acct:everyday');
    const s = applyImport(emptyState('SG', TODAY), d, choicesFor(d), TODAY);
    expect(s.transactions[0].accountId).toBe(s.accounts[0].id);
    expect(s.accounts[0].balanceCents).toBe(82040);
  });
});

describe('Regular payments found in history', () => {
  it('finds income and bills in every sample workbook with the right rhythm', async () => {
    const expectations = { SG: ['fortnightly', 'housing'], PH: ['weekly', 'housing'], MM: ['fortnightly', 'housing'] } as const;
    for (const code of ['SG', 'PH', 'MM'] as const) {
      const d = draftFromSheets(await readXlsx(sampleWorkbook(code, TODAY)), 's.xlsx', 'xlsx', ctx(code));
      expect(d.errors.length).toBe(0);
      expect(d.history.days).toBeGreaterThan(80);
      const main = d.income.find((i) => i.include)!;
      expect(main.item.frequency).toBe(expectations[code][0]);
      expect(main.evidence ?? '').toContain('payments');
      const rent = d.bills.find((b) => b.item.category === expectations[code][1])!;
      expect(rent.item.frequency).toBe('monthly');
      expect(rent.item.nextDue >= TODAY).toBe(true);
      // Everyday groceries are estimated from history, never turned into "bills".
      expect(d.bills.some((b) => b.item.category === 'groceries' || b.item.category === 'food')).toBe(false);
    }
  });

  it('links past bill payments so everyday spending is not double counted', async () => {
    const d = draftFromSheets(await readXlsx(sampleWorkbook('SG', TODAY)), 's.xlsx', 'xlsx', ctx('SG'));
    const s = applyImport(emptyState('SG', TODAY), d, choicesFor(d), TODAY);
    const rentId = s.bills.find((b) => b.category === 'housing')!.id;
    expect(s.transactions.filter((t) => t.billId === rentId).length).toBeGreaterThan(1);
    const est = estimateDailySpend(s, TODAY);
    expect(est.source).toBe('history');
    // Rent (S$650 a month) would add over S$20 a day if it were counted as everyday spending.
    expect(est.dailyEssentialCents).toBeLessThan(2500);
  });

  it('never recommends saving that would miss a detected bill', async () => {
    for (const code of ['SG', 'PH', 'MM'] as const) {
      const s = await samplePlan(code, TODAY);
      const r = computeRecommendation(s, TODAY);
      const after = r.projection.map((d) => d.closingCents - r.recommendedCents);
      expect(Math.min(...after)).toBeGreaterThanOrEqual(r.floorCents);
    }
  });
});

describe('Applying imports', () => {
  it('a later import merges by account name and updates balances when asked', () => {
    const first = draftFromSheets({ T: [['Date', 'Description', 'Amount'], [addDays(TODAY, -5), 'Hawker', -5]], Balances: [['Account', 'Balance'], ['DBS', 100]] }, 'a.xlsx', 'xlsx', ctx('SG'));
    let s = applyImport(emptyState('SG', TODAY), first, choicesFor(first), TODAY);
    const second = draftFromSheets(
      { T: [['Date', 'Description', 'Amount'], [addDays(TODAY, -1), 'Hawker', -6]], Balances: [['Account', 'Balance'], ['dbs', 250]] },
      'b.xlsx',
      'xlsx',
      { ...ctx('SG'), existing: s.transactions },
    );
    s = applyImport(s, second, { ...choicesFor(second), replaceBalances: true }, TODAY);
    expect(s.accounts.length).toBe(1);
    expect(s.accounts[0].balanceCents).toBe(25000);
    expect(s.transactions.length).toBe(2);
    expect(s.connectors.spreadsheet.recordCount).toBe(2);
  });

  it('exports everything and re-imports the same records', async () => {
    const s = await samplePlan('PH', TODAY);
    const d = draftFromSheets(await readXlsx(exportWorkbook(s)), 'export.xlsx', 'xlsx', ctx('PH'));
    expect(d.transactions.length).toBe(s.transactions.length);
    expect(d.incomeFromSheet).toBe(true);
    expect(d.income.length).toBe(s.incomeSources.length);
    expect(d.bills.length).toBe(s.bills.length);
    expect(d.accounts.map((a) => a.balanceCents)).toEqual(s.accounts.map((a) => a.balanceCents));
    const again = applyImport(emptyState('PH', TODAY), d, choicesFor(d), TODAY);
    expect(computeRecommendation(again, TODAY).recommendedCents).toBe(computeRecommendation(s, TODAY).recommendedCents);
  });

  it('a cash book can start with nothing but a cash count', () => {
    const s = reducer(emptyState('MM', TODAY), { type: 'START_CASHBOOK', input: { cashCents: 400000, savingsCents: 0, dailySpendCents: 60000 } }, TODAY);
    expect(s.onboarded).toBe(true);
    expect(s.accounts.map((a) => [a.kind, a.role, a.balanceCents])).toEqual([['cash', 'spending', 400000]]);
    const r = computeRecommendation(s, TODAY);
    expect(r.spend.dailyEssentialCents).toBe(60000);
    expect(startCashBook(emptyState('SG', TODAY), { cashCents: 0, savingsCents: 500, dailySpendCents: 1 }, TODAY).accounts.length).toBe(2);
  });

  it('a new install is empty: no built-in records', () => {
    const s = emptyState('SG', TODAY);
    expect(s.onboarded).toBe(false);
    expect(s.accounts.length + s.transactions.length + s.bills.length + s.incomeSources.length).toBe(0);
    expect(computeRecommendation(s, TODAY).recommendedCents).toBe(0);
  });
});

describe('Blank templates', () => {
  it('each country gets empty sheets, drop-downs and local examples in the Read me only', async () => {
    const { templateWorkbook } = await import('../src/import/samples');
    for (const code of ['SG', 'PH', 'MM'] as const) {
      const bytes = templateWorkbook(code);
      const xml = new TextDecoder().decode(bytes);
      expect(xml).toContain('<dataValidations');
      const sheets = await readXlsx(bytes);
      expect(Object.keys(sheets)).toEqual(['Read me', 'Transactions', 'Income', 'Bills', 'Balances']);
      expect(sheets.Transactions.length).toBe(1);
      expect(sheets['Read me'].flat().join(' ')).toContain(marketFor(code).currency.code);
      // An untouched template imports to nothing rather than to example data.
      const d = draftFromSheets(sheets, 't.xlsx', 'xlsx', ctx(code));
      expect(d.transactions.length + d.income.length + d.bills.length + d.accounts.length).toBe(0);
    }
  });
});
