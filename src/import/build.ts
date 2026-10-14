/**
 * Turn a reviewed import into app state. Used for first-time setup (empty
 * state) and for later imports, which merge into what is already there.
 */
import { marketFor, minor } from '../config/markets';
import { isSpending } from '../domain/classifier';
import { findDuplicates } from '../domain/csv';
import type { ISODate } from '../domain/dates';
import { emergencyBalance } from '../domain/forecast';
import { uid } from '../domain/ids';
import type { Cents } from '../domain/money';
import { matchesBill } from '../domain/spending';
import type { Account, AppState, Profile, Transaction } from '../domain/types';
import type { DraftAccount, ImportDraft } from './workbook';

export type DemoMarket = 'SG' | 'PH' | 'MM';

export interface ImportChoices {
  displayName?: string;
  /** Final accounts with balances confirmed by the user. */
  accounts: Array<Omit<DraftAccount, 'balanceCents'> & { balanceCents: Cents }>;
  /** Fallback everyday spending per day, used while history is thin. */
  dailyEssentialCents: Cents;
  dailyDiscretionaryCents: Cents;
  /** For later imports: overwrite balances of accounts with the same name. */
  replaceBalances?: boolean;
}

export function blankProfile(displayName = ''): Profile {
  return {
    personaId: 'self',
    displayName,
    personaLabel: '',
    occupation: '',
    householdSize: 1,
    dependants: 0,
    housing: '',
    incomePattern: '',
    notes: [],
    fallbackDailyEssentialCents: 0,
    fallbackDailyDiscretionaryCents: 0,
  };
}

/** A new, empty plan for one country. Nothing is pre-filled. */
export function emptyState(market: DemoMarket, today: ISODate, now = new Date().toISOString()): AppState {
  const m = marketFor(market);
  return {
    schemaVersion: 1,
    marketCode: market,
    createdAt: now,
    asOf: today,
    onboarded: false,
    profile: blankProfile(),
    household: { size: 1, dependants: 0, earners: 1 },
    accounts: [],
    incomeSources: [],
    bills: [],
    transactions: [],
    healthBills: [],
    contributions: [],
    shocks: [],
    goal: { selected: 'auto', customTargetCents: 0, weeklyTargetCents: 0 },
    connectors: {},
    consents: [],
    rules: [],
    settings: {
      minCashReserveCents: minor(m, m.defaultReserveMajor),
      horizonDays: 35,
      incomeDelayDays: 0,
      discretionaryReservePct: 100,
      groceryBudgetCents: 0,
      remindersEnabled: true,
      language: 'en',
      simpleMode: m.cashHeavy && market === 'MM',
    },
    history: [],
    peakEmergencyCents: 0,
  };
}

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** Apply a reviewed draft. Pure: returns a new state. */
export function applyImport(state: AppState, draft: ImportDraft, choices: ImportChoices, today: ISODate, now = new Date().toISOString()): AppState {
  const first = !state.onboarded || state.accounts.length === 0;

  // Accounts.
  let accounts: Account[] = state.accounts.map((a) => ({ ...a }));
  const keyToId = new Map<string, string>();
  for (const c of choices.accounts) {
    const existing = accounts.find((a) => sameName(a.name, c.name));
    if (existing) {
      keyToId.set(c.key, existing.id);
      if (choices.replaceBalances || first) Object.assign(existing, { balanceCents: c.balanceCents, asOf: today, role: c.role, kind: c.kind, source: c.fromSheet ? 'imported' : 'user' });
      continue;
    }
    const id = uid('acct');
    keyToId.set(c.key, id);
    accounts.push({ id, name: c.name, institution: c.kind === 'cash' ? 'Cash' : c.name, kind: c.kind, role: c.role, balanceCents: c.balanceCents, asOf: today, source: c.fromSheet ? 'imported' : 'user' });
  }
  if (!accounts.some((a) => a.role === 'spending')) {
    accounts = [{ id: uid('acct'), name: 'Everyday money', institution: '', kind: 'bank', role: 'spending', balanceCents: 0, asOf: today, source: 'user' }, ...accounts];
  }

  // Transactions (re-check duplicates against the current state).
  const mapped = draft.transactions.map((t) => ({ ...t, accountId: t.accountId ? keyToId.get(t.accountId) : undefined }));
  const { fresh } = findDuplicates(state.transactions, mapped);

  // Income and bills the user kept; skip ones already tracked under the same name.
  const incomeSources = [...state.incomeSources];
  for (const d of draft.income) if (d.include && !incomeSources.some((i) => sameName(i.name, d.item.name))) incomeSources.push({ ...d.item });
  const bills = [...state.bills];
  const billTx = new Map<string, string>();
  for (const d of draft.bills) {
    if (!d.include || bills.some((b) => sameName(b.name, d.item.name))) continue;
    bills.push({ ...d.item });
    for (const id of d.txIds ?? []) billTx.set(id, d.item.id);
  }
  // Link past bill payments so everyday-spending estimates don't count them twice.
  const linked: Transaction[] = fresh.map((t) => {
    if (billTx.has(t.id)) return { ...t, billId: billTx.get(t.id) };
    if (!isSpending(t)) return t;
    const b = matchesBill(t, bills);
    return b ? { ...t, billId: b.id } : t;
  });

  const transactions = [...linked, ...state.transactions].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  const prev = state.connectors.spreadsheet;
  const next: AppState = {
    ...state,
    onboarded: true,
    asOf: today,
    profile: first
      ? {
          ...state.profile,
          displayName: (choices.displayName ?? '').trim().slice(0, 40),
          personaLabel: 'Imported from your spreadsheet',
          fallbackDailyEssentialCents: Math.max(0, choices.dailyEssentialCents),
          fallbackDailyDiscretionaryCents: Math.max(0, choices.dailyDiscretionaryCents),
        }
      : state.profile,
    accounts,
    incomeSources,
    bills,
    transactions,
    connectors: {
      ...state.connectors,
      spreadsheet: { providerId: 'spreadsheet', connected: true, consentGiven: true, consentAt: today, lastSync: now, recordCount: (prev?.recordCount ?? 0) + linked.length },
    },
  };
  const emergency = emergencyBalance(next);
  return { ...next, peakEmergencyCents: Math.max(state.peakEmergencyCents, emergency) };
}

/** Start with nothing but a cash count: for people without bank records. */
export function startCashBook(state: AppState, input: { displayName?: string; cashCents: Cents; savingsCents: Cents; dailySpendCents: Cents }, today: ISODate): AppState {
  const accounts: Account[] = [{ id: uid('acct'), name: 'Cash', institution: 'Cash', kind: 'cash', role: 'spending', balanceCents: Math.max(0, input.cashCents), asOf: today, source: 'user' }];
  if (input.savingsCents > 0) accounts.push({ id: uid('acct'), name: 'Emergency savings', institution: 'Cash', kind: 'cash', role: 'emergency', balanceCents: input.savingsCents, asOf: today, source: 'user' });
  return {
    ...state,
    onboarded: true,
    asOf: today,
    profile: { ...state.profile, displayName: (input.displayName ?? '').trim().slice(0, 40), personaLabel: 'Cash book', fallbackDailyEssentialCents: Math.max(0, input.dailySpendCents), fallbackDailyDiscretionaryCents: 0 },
    accounts,
    peakEmergencyCents: Math.max(0, input.savingsCents),
    connectors: { ...state.connectors, 'cash-ledger': { providerId: 'cash-ledger', connected: true, consentGiven: true, consentAt: today, recordCount: 0 } },
  };
}

