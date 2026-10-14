import { describe, expect, it } from 'vitest';
import { buildPersonaState } from '../src/data/personas';
import { classify } from '../src/domain/classifier';
import { parseCSV, sanitiseText } from '../src/domain/csv';
import { addDays } from '../src/domain/dates';
import { computeRecommendation } from '../src/domain/engine';
import { emergencyBalance, liquidBalance } from '../src/domain/forecast';
import { toCents } from '../src/domain/money';
import { applyShock, defaultShockInput, SHOCK_PRESETS } from '../src/domain/shock';
import { estimateDailySpend } from '../src/domain/spending';
import type { Transaction } from '../src/domain/types';
import { loadState, MemoryStorage, saveState, STORAGE_KEY } from '../src/state/persistence';
import { reducer } from '../src/state/reducer';
import { marketFor } from '../src/config/markets';
import { applyImport, emptyState } from '../src/import/build';
import { checkImportFile, draftFromSheets } from '../src/import/workbook';
import { bankCsv, bill, blankState, salary, TODAY } from './helpers';

const SG = marketFor('SG');
const csvDraft = (text: string, existing: Transaction[] = []) => draftFromSheets({ Transactions: parseCSV(text) }, 'export.csv', 'csv', { market: SG, today: TODAY, rules: [], existing });

const tx = (i: number, daysAgo: number, merchant: string, dollars: number): Transaction => {
  const c = classify(merchant, merchant, -toCents(dollars));
  return {
    id: `t${i}`,
    date: addDays(TODAY, -daysAgo),
    merchant,
    description: merchant,
    amountCents: -toCents(dollars),
    category: c.category,
    subcategory: c.subcategory,
    essentiality: c.essentiality,
    source: 'user',
    confidence: c.confidence,
  };
};

describe('Missing and duplicate transactions', () => {
  it('falls back to the profile estimate when history is thin', () => {
    const s = blankState({ transactions: [tx(1, 2, 'FairPrice', 30), tx(2, 3, 'Hawker centre', 5)] });
    const e = estimateDailySpend(s, TODAY);
    expect(e.source).toBe('estimated');
    expect(e.dailyEssentialCents).toBe(s.profile.fallbackDailyEssentialCents);
  });

  it('measures from history when there are enough transactions', () => {
    const txns = Array.from({ length: 28 }, (_, i) => tx(i, i + 1, 'Hawker centre', 10));
    const e = estimateDailySpend(blankState({ transactions: txns }), TODAY);
    expect(e.source).toBe('history');
    expect(e.dailyEssentialCents).toBe(toCents(10));
  });

  it('does not double count a bill that also appears as a transaction', () => {
    const txns = Array.from({ length: 20 }, (_, i) => tx(i, i + 1, 'Hawker centre', 10));
    txns.push({ ...tx(99, 5, 'Landlord rent transfer', 1500) });
    const s = blankState({ transactions: txns, bills: [bill('Rent', 1500, 25)] });
    expect(estimateDailySpend(s, TODAY).dailyEssentialCents).toBe(toCents(10));
  });

  it('flags duplicates within a file and against existing data', () => {
    const p = csvDraft(bankCsv());
    expect(p.duplicates).toBe(1);
    const again = csvDraft(bankCsv(), p.transactions);
    expect(again.transactions.length).toBe(0);
    expect(again.duplicates).toBe(p.transactions.length + 1);
  });

  it('importing the same file twice adds nothing new', () => {
    const first = csvDraft(bankCsv());
    const acc = [{ ...first.accounts[0], key: 'k', name: 'Everyday', kind: 'bank' as const, role: 'spending' as const, balanceCents: 100000, fromSheet: false }];
    let s = applyImport(emptyState('SG', TODAY), first, { accounts: acc, dailyEssentialCents: 2000, dailyDiscretionaryCents: 0 }, TODAY);
    const n = s.transactions.length;
    s = applyImport(s, csvDraft(bankCsv(), s.transactions), { accounts: [], dailyEssentialCents: 0, dailyDiscretionaryCents: 0 }, TODAY);
    expect(s.transactions.length).toBe(n);
  });
});

describe('Imported files', () => {
  it('rejects wrong types, macro workbooks, empty and oversized files', () => {
    expect(checkImportFile('statement.pdf', 100).ok).toBe(false);
    expect(checkImportFile('old.xls', 100).ok).toBe(false);
    expect(checkImportFile('macro.xlsm', 100).ok).toBe(false);
    expect(checkImportFile('data.csv', 0).ok).toBe(false);
    expect(checkImportFile('data.xlsx', 6_000_000).ok).toBe(false);
    expect(checkImportFile('data.csv', 2_000).ok).toBe(true);
    expect(checkImportFile('Data.XLSX', 2_000).format).toBe('xlsx');
  });

  it('reports missing columns instead of guessing', () => {
    const p = csvDraft('Foo,Bar\n1,2');
    expect(p.transactions.length).toBe(0);
    expect(p.errors[0].message).toContain('column headings');
  });

  it('skips malformed rows with line numbers and keeps good ones', () => {
    const p = csvDraft(bankCsv());
    expect(p.errors.length).toBe(1);
    expect(p.errors[0].message).toContain('Unreadable date');
    expect(p.transactions.length).toBe(13);
    const unknown = p.transactions.find((t) => t.merchant.startsWith('UNKNOWN'));
    expect(unknown?.essentiality).toBe('review');
    const paynow = p.transactions.find((t) => t.amountCents > 0);
    expect(paynow?.category).toBe('income');
  });

  it('parses quoted fields and neutralises spreadsheet formulas', () => {
    expect(parseCSV('a,"b, c","d ""e"""\r\n1,2,3')).toEqual([
      ['a', 'b, c', 'd "e"'],
      ['1', '2', '3'],
    ]);
    expect(sanitiseText('=HYPERLINK("x")')).toBe('HYPERLINK("x")');
    expect(sanitiseText('-12.50')).toBe('-12.50');
  });

  it('rejects future dates and zero amounts', () => {
    const future = addDays(TODAY, 3);
    const p = csvDraft(`Date,Description,Amount\n${future},Shop,-5\n${TODAY},Shop,0`);
    expect(p.transactions.length).toBe(0);
    expect(p.errors.length).toBe(2);
  });
});

describe('Categorisation overrides', () => {
  it('a manual override sticks and can teach a rule for the merchant', () => {
    let s = blankState({ transactions: [tx(1, 1, 'Ah Seng Provision', 12), tx(2, 4, 'Ah Seng Provision', 8), tx(3, 2, 'Random Shop 77', 9)] });
    expect(s.transactions[0].category).toBe('groceries');
    s = reducer(s, { type: 'UPDATE_TRANSACTION', id: 't1', patch: { category: 'lifestyle', subcategory: 'shopping', essentiality: 'discretionary' }, applyToMerchant: true }, TODAY);
    expect(s.transactions.find((t) => t.id === 't1')?.overridden).toBe(true);
    expect(s.transactions.find((t) => t.id === 't2')?.category).toBe('lifestyle');
    expect(s.transactions.find((t) => t.id === 't3')?.category).toBe('uncategorised');
    expect(s.rules.length).toBe(1);
    expect(classify('Ah Seng Provision', '', -100, s.rules).category).toBe('lifestyle');
  });

  it('mixed receipts can be reclassified line by line', () => {
    let s = buildPersonaState('student', TODAY);
    const basket = s.transactions.find((t) => t.lines && t.lines.length > 0)!;
    const line = basket.lines![0];
    s = reducer(s, { type: 'UPDATE_LINE', txId: basket.id, lineId: line.id, patch: { essentiality: 'discretionary' } }, TODAY);
    expect(s.transactions.find((t) => t.id === basket.id)!.lines![0].essentiality).toBe('discretionary');
  });
});

describe('Contributions and emergency withdrawals', () => {
  it('moves money between spending and emergency without creating or losing any', () => {
    let s = blankState();
    const total = liquidBalance(s) + emergencyBalance(s);
    s = reducer(s, { type: 'RECORD_CONTRIBUTION', amountCents: toCents(300), kind: 'deposit' }, TODAY);
    expect(liquidBalance(s)).toBe(toCents(1700));
    expect(emergencyBalance(s)).toBe(toCents(800));
    expect(s.peakEmergencyCents).toBe(toCents(800));
    s = reducer(s, { type: 'RECORD_CONTRIBUTION', amountCents: toCents(5000), kind: 'withdrawal' }, TODAY);
    expect(emergencyBalance(s)).toBe(0);
    expect(liquidBalance(s) + emergencyBalance(s)).toBe(total);
    expect(s.contributions[s.contributions.length - 1].amountCents).toBe(-toCents(800));
  });

  it('a shock is counted once: savings fund what they can, the cost appears as one bill', () => {
    const s = blankState({ incomeSources: [salary(3000, 10)] });
    const preset = SHOCK_PRESETS.find((p) => p.id === 'laptop')!;
    const { state: after, shock } = applyShock(s, { ...defaultShockInput(preset, s), offsetDays: 3 }, TODAY);
    expect(shock.emergencyUsedCents).toBe(toCents(500));
    expect(emergencyBalance(after)).toBe(0);
    expect(liquidBalance(after)).toBe(toCents(2500));
    expect(after.bills.filter((b) => b.name === preset.label).length).toBe(1);
    const r = computeRecommendation(after, TODAY);
    const day3 = r.projection[3];
    expect(day3.events.filter((e) => e.label === preset.label).length).toBe(1);
  });

  it('income loss tops up cash from savings only as far as the reserve needs', () => {
    const s = blankState({ incomeSources: [salary(3000, 10)], bills: [bill('Rent', 1500, 3, { frequency: 'once' })] });
    const preset = SHOCK_PRESETS.find((p) => p.id === 'job-loss')!;
    const { state: after, shock } = applyShock(s, { ...defaultShockInput(preset, s), offsetDays: 0 }, TODAY);
    // Without the salary: 2000 - 1500 - 35 x 20 = -200; reserve 100 => needs 300 from savings.
    expect(shock.emergencyUsedCents).toBe(toCents(300));
    const r = computeRecommendation(after, TODAY);
    expect(r.shortfallCents).toBe(0);
    expect(r.excludedIncome.some((x) => x.reason.includes(preset.label))).toBe(true);
  });
});

describe('Local persistence', () => {
  it('round-trips state and survives corrupt data', () => {
    const storage = new MemoryStorage();
    const s = reducer(buildPersonaState('rider', TODAY), { type: 'RECORD_CONTRIBUTION', amountCents: 2000, kind: 'deposit' }, TODAY);
    expect(saveState(storage, s)).toBe(true);
    expect(loadState(storage)).toEqual(s);
    storage.setItem(STORAGE_KEY, '{not json');
    expect(loadState(storage)).toBe(null);
    storage.setItem(STORAGE_KEY, JSON.stringify({ schemaVersion: 99 }));
    expect(loadState(storage)).toBe(null);
    expect(saveState(null, s)).toBe(false);
  });
});

describe('Start again', () => {
  it('deletes every record and returns to setup in the same country', () => {
    const strip = (v: unknown) => JSON.parse(JSON.stringify(v, (k, val) => (['createdAt', 'lastSync', 'at'].includes(k) ? undefined : val)));
    let s: ReturnType<typeof buildPersonaState> = { ...buildPersonaState('ph-rider', TODAY), onboarded: true };
    s = reducer(s, { type: 'APPLY_SHOCK', input: defaultShockInput(SHOCK_PRESETS[0], s) }, TODAY);
    const reset = reducer(s, { type: 'RESET' }, TODAY);
    expect(reset.onboarded).toBe(false);
    expect(reset.marketCode).toBe('PH');
    expect(reset.transactions.length + reset.accounts.length + reset.bills.length + reset.incomeSources.length + reset.history.length).toBe(0);
    expect(strip(reset)).toEqual(strip(emptyState('PH', TODAY)));
  });
});
