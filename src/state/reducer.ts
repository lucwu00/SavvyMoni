/**
 * Pure state transitions. Every user action that changes money is applied
 * here so balances, transactions and bills stay consistent: paying a bill both
 * lowers cash and advances the bill, so it is never counted twice.
 */
import { removeProviderData } from '../connectors/connectors';
import { applyImport, emptyState, startCashBook, type DemoMarket, type ImportChoices } from '../import/build';
import type { ImportDraft } from '../import/workbook';
import { classify, normaliseMerchant, reclassify } from '../domain/classifier';
import { formatDate, todaySG, type ISODate } from '../domain/dates';
import { computeRecommendation } from '../domain/engine';
import { emergencyBalance, outOfPocket } from '../domain/forecast';
import { uid } from '../domain/ids';
import { formatMoney, type Cents } from '../domain/money';
import { marketFor, minor } from '../config/markets';
import { nextOccurrence } from '../domain/recurrence';
import { applyShock, type ShockInput } from '../domain/shock';
import type {
  Account,
  AppState,
  HealthBill,
  IncomeSource,
  Profile,
  RecurringBill,
  SavingsGoal,
  Settings,
  Transaction,
  TransactionLine,
} from '../domain/types';

export type Action =
  | { type: 'RESET'; market?: DemoMarket }
  | { type: 'IMPORT_DRAFT'; draft: ImportDraft; choices: ImportChoices }
  | { type: 'START_CASHBOOK'; input: { displayName?: string; cashCents: Cents; savingsCents: Cents; dailySpendCents: Cents } }
  | { type: 'REPLACE_STATE'; state: AppState }
  | { type: 'COMPLETE_ONBOARDING' }
  | { type: 'RESTART_ONBOARDING' }
  | { type: 'UPDATE_ACCOUNT'; id: string; patch: Partial<Account> }
  | { type: 'ADD_ACCOUNT'; account: Account }
  | { type: 'DELETE_ACCOUNT'; id: string }
  | { type: 'UPDATE_INCOME'; id: string; patch: Partial<IncomeSource> }
  | { type: 'ADD_INCOME'; income: IncomeSource }
  | { type: 'DELETE_INCOME'; id: string }
  | { type: 'RECEIVE_INCOME'; id: string; amountCents?: Cents; accountId?: string; date?: ISODate }
  | { type: 'ADD_BILL'; bill: RecurringBill }
  | { type: 'ADOPT_PATTERNS'; income: IncomeSource[]; bills: Array<{ bill: RecurringBill; txIds: string[] }> }
  | { type: 'UPDATE_BILL'; id: string; patch: Partial<RecurringBill> }
  | { type: 'DELETE_BILL'; id: string }
  | { type: 'PAY_BILL'; id: string }
  | { type: 'ADD_TRANSACTION'; tx: Transaction; affectBalance: boolean }
  | { type: 'UPDATE_TRANSACTION'; id: string; patch: Partial<Transaction>; applyToMerchant?: boolean }
  | { type: 'UPDATE_LINE'; txId: string; lineId: string; patch: Partial<TransactionLine> }
  | { type: 'DELETE_TRANSACTION'; id: string; revertBalance?: boolean }
  | { type: 'REMOVE_SOURCE'; providerId: string }
  | { type: 'UPDATE_PROFILE'; patch: Partial<Profile> }
  | { type: 'DELETE_IMPORTED' }
  | { type: 'ADD_HEALTH_BILL'; bill: HealthBill }
  | { type: 'PAY_HEALTH_BILL'; id: string }
  | { type: 'DELETE_HEALTH_BILL'; id: string }
  | { type: 'RECORD_CONTRIBUTION'; amountCents: Cents; kind: 'deposit' | 'withdrawal'; note?: string; fromCushion?: boolean }
  | { type: 'CLEAR_CUSHION' }
  | { type: 'UNDO_CONTRIBUTION'; id: string }
  | { type: 'START_OVER'; market: DemoMarket }
  | { type: 'APPLY_SHOCK'; input: ShockInput }
  | { type: 'UPDATE_SETTINGS'; patch: Partial<Settings> }
  | { type: 'UPDATE_GOAL'; patch: Partial<SavingsGoal> }
  | { type: 'SET_RECOVERY_PLAN'; targetCents: Cents; pauseWeeks: number };

const spendingAccount = (s: AppState, id?: string) => s.accounts.find((a) => a.id === id && a.role === 'spending') ?? s.accounts.find((a) => a.role === 'spending');

function adjust(s: AppState, accountId: string | undefined, delta: Cents): AppState {
  const target = spendingAccount(s, accountId);
  if (!target) return s;
  return { ...s, accounts: s.accounts.map((a) => (a.id === target.id ? { ...a, balanceCents: a.balanceCents + delta } : a)) };
}

function moveBetween(s: AppState, from: 'spending' | 'emergency', amount: Cents): { state: AppState; moved: Cents } {
  const accounts = s.accounts.map((a) => ({ ...a }));
  const src = accounts.filter((a) => a.role === from);
  const dst = accounts.find((a) => a.role === (from === 'spending' ? 'emergency' : 'spending'));
  if (!dst || src.length === 0 || amount <= 0) return { state: s, moved: 0 };
  let remaining = amount;
  for (const a of src) {
    if (remaining <= 0) break;
    const available = from === 'emergency' ? Math.max(0, a.balanceCents) : a.balanceCents;
    const take = from === 'emergency' ? Math.min(available, remaining) : remaining;
    a.balanceCents -= take;
    remaining -= take;
  }
  const moved = amount - remaining;
  dst.balanceCents += moved;
  return { state: { ...s, accounts }, moved };
}

function base(state: AppState, action: Action, today: ISODate): AppState {
  switch (action.type) {
    case 'RESET':
      return emptyState(action.market ?? state.marketCode, today);
    case 'IMPORT_DRAFT':
      return applyImport(state, action.draft, action.choices, today);
    case 'START_CASHBOOK':
      return startCashBook(state, action.input, today);
    case 'REPLACE_STATE':
      return action.state;
    case 'COMPLETE_ONBOARDING':
      return { ...state, onboarded: true };
    case 'RESTART_ONBOARDING':
      return { ...state, onboarded: false };

    case 'UPDATE_ACCOUNT': {
      const next = { ...state, accounts: state.accounts.map((a) => (a.id === action.id ? { ...a, ...action.patch, source: 'user' as const, asOf: today } : a)) };
      return { ...next, peakEmergencyCents: Math.max(next.peakEmergencyCents, emergencyBalance(next)) };
    }
    case 'ADD_ACCOUNT':
      return { ...state, accounts: [...state.accounts, action.account] };
    case 'DELETE_ACCOUNT':
      return { ...state, accounts: state.accounts.filter((a) => a.id !== action.id) };

    case 'UPDATE_INCOME':
      return { ...state, incomeSources: state.incomeSources.map((i) => (i.id === action.id ? { ...i, ...action.patch, source: 'user' as const } : i)) };
    case 'ADD_INCOME':
      return { ...state, incomeSources: [...state.incomeSources, action.income] };
    case 'DELETE_INCOME':
      return { ...state, incomeSources: state.incomeSources.filter((i) => i.id !== action.id) };
    case 'RECEIVE_INCOME': {
      const src = state.incomeSources.find((i) => i.id === action.id);
      if (!src) return state;
      const amount = action.amountCents ?? src.netAmountCents;
      const tx: Transaction = {
        id: uid('tx'),
        date: action.date ?? today,
        accountId: action.accountId,
        merchant: src.name,
        description: `${src.name} received`,
        amountCents: amount,
        category: 'income',
        subcategory: src.kind === 'gig' ? 'gig-payout' : src.kind === 'salary' ? 'salary' : src.kind === 'business' ? 'business-takings' : 'other-income',
        essentiality: 'review',
        source: 'user',
        providerId: 'cash-ledger',
        confidence: 'high',
      };
      const s1 = adjust(state, action.accountId, amount);
      return {
        ...s1,
        transactions: [tx, ...s1.transactions],
        incomeSources: s1.incomeSources.map((i) => (i.id === src.id ? { ...i, nextDate: nextOccurrence(src.nextDate < today ? today : src.nextDate, src.frequency) } : i)),
      };
    }

    case 'ADD_BILL':
      return { ...state, bills: [...state.bills, action.bill] };
    case 'ADOPT_PATTERNS': {
      // Link past payments to their new bill so everyday spending does not count them twice.
      const link = new Map<string, string>();
      for (const b of action.bills) for (const id of b.txIds) link.set(id, b.bill.id);
      return {
        ...state,
        incomeSources: [...state.incomeSources, ...action.income],
        bills: [...state.bills, ...action.bills.map((b) => b.bill)],
        transactions: link.size ? state.transactions.map((t) => (link.has(t.id) && !t.billId ? { ...t, billId: link.get(t.id) } : t)) : state.transactions,
      };
    }
    case 'UPDATE_BILL':
      return { ...state, bills: state.bills.map((b) => (b.id === action.id ? { ...b, ...action.patch, source: b.source === 'simulated' ? 'user' : b.source } : b)) };
    case 'DELETE_BILL':
      return { ...state, bills: state.bills.filter((b) => b.id !== action.id) };
    case 'PAY_BILL': {
      const b = state.bills.find((x) => x.id === action.id);
      if (!b || (b.frequency === 'once' && b.status === 'paid')) return state;
      const tx: Transaction = {
        id: uid('tx'),
        date: today,
        merchant: b.name,
        description: `Paid: ${b.name} (due ${formatDate(b.nextDue)})`,
        amountCents: -b.amountCents,
        category: b.category,
        subcategory: b.subcategory,
        essentiality: b.priority,
        source: 'user',
        providerId: 'manual',
        billId: b.id,
        confidence: 'high',
      };
      const s1 = adjust(state, undefined, -b.amountCents);
      return {
        ...s1,
        transactions: [tx, ...s1.transactions],
        bills: s1.bills.map((x) =>
          x.id !== b.id ? x : b.frequency === 'once' ? { ...x, status: 'paid' as const, lastPaid: today } : { ...x, nextDue: nextOccurrence(x.nextDue, x.frequency), lastPaid: today },
        ),
      };
    }

    case 'ADD_TRANSACTION': {
      const s1 = action.affectBalance ? adjust(state, action.tx.accountId, action.tx.amountCents) : state;
      return { ...s1, transactions: [action.tx, ...s1.transactions] };
    }
    case 'UPDATE_TRANSACTION': {
      const tx = state.transactions.find((t) => t.id === action.id);
      if (!tx) return state;
      let rules = state.rules;
      const pattern = normaliseMerchant(tx.merchant);
      if (action.applyToMerchant && pattern && action.patch.category) {
        rules = [
          { id: uid('rule'), pattern, category: action.patch.category, subcategory: action.patch.subcategory ?? tx.subcategory, essentiality: action.patch.essentiality ?? tx.essentiality },
          ...rules.filter((r) => r.pattern !== pattern),
        ];
      }
      const transactions = state.transactions.map((t) => {
        if (t.id === action.id) return { ...t, ...action.patch, overridden: true, confidence: 'high' as const };
        if (action.applyToMerchant && normaliseMerchant(t.merchant) === pattern && !t.lines) return reclassify(t, rules);
        return t;
      });
      return { ...state, rules, transactions };
    }
    case 'UPDATE_LINE':
      return {
        ...state,
        transactions: state.transactions.map((t) =>
          t.id !== action.txId ? t : { ...t, overridden: true, lines: t.lines?.map((l) => (l.id === action.lineId ? { ...l, ...action.patch } : l)) },
        ),
      };
    case 'DELETE_TRANSACTION': {
      const tx = state.transactions.find((t) => t.id === action.id);
      const s1 = tx && action.revertBalance ? adjust(state, tx.accountId, -tx.amountCents) : state;
      return { ...s1, transactions: s1.transactions.filter((t) => t.id !== action.id) };
    }

    case 'REMOVE_SOURCE':
      return removeProviderData(state, action.providerId);
    case 'UPDATE_PROFILE':
      return { ...state, profile: { ...state.profile, ...action.patch } };
    case 'DELETE_IMPORTED': {
      const importedProviders = Object.keys(state.connectors).filter((k) => state.transactions.some((t) => t.providerId === k && t.source === 'imported'));
      const connectors = { ...state.connectors };
      importedProviders.forEach((k) => delete connectors[k]);
      delete connectors.csv;
      delete connectors.spreadsheet;
      return { ...state, transactions: state.transactions.filter((t) => t.source !== 'imported'), connectors };
    }

    case 'ADD_HEALTH_BILL':
      return { ...state, healthBills: [action.bill, ...state.healthBills] };
    case 'PAY_HEALTH_BILL': {
      const hb = state.healthBills.find((h) => h.id === action.id);
      if (!hb || hb.status === 'paid') return state;
      const oop = outOfPocket(hb);
      const sub = hb.providerType === 'dental' ? 'dental' : hb.providerType === 'hospital' ? 'hospital' : hb.providerType === 'gp' ? 'gp' : hb.providerType === 'pharmacy' ? 'prescription' : hb.providerType;
      const tx: Transaction = {
        id: uid('tx'),
        date: today,
        merchant: hb.provider,
        description: `Medical bill (out-of-pocket)`,
        amountCents: -oop,
        category: 'healthcare',
        subcategory: sub,
        essentiality: 'essential',
        source: 'user',
        providerId: 'manual',
        billId: hb.id,
        confidence: 'high',
      };
      const s1 = oop > 0 ? adjust(state, undefined, -oop) : state;
      return { ...s1, transactions: oop > 0 ? [tx, ...s1.transactions] : s1.transactions, healthBills: s1.healthBills.map((h) => (h.id === hb.id ? { ...h, status: 'paid' as const } : h)) };
    }
    case 'DELETE_HEALTH_BILL':
      return { ...state, healthBills: state.healthBills.filter((h) => h.id !== action.id) };

    case 'RECORD_CONTRIBUTION': {
      if (!(action.amountCents > 0)) return state;
      const { state: s1, moved } = moveBetween(state, action.kind === 'deposit' ? 'spending' : 'emergency', action.amountCents);
      if (moved <= 0) return state;
      const s2: AppState = {
        ...s1,
        contributions: [
          ...s1.contributions,
          {
            id: uid('ctb'),
            date: today,
            amountCents: action.kind === 'deposit' ? moved : -moved,
            kind: action.kind,
            note: action.note ?? (action.kind === 'deposit' ? 'Transfer to emergency savings' : 'Withdrawal from emergency savings'),
            source: 'user',
            undo: { peakBefore: state.peakEmergencyCents, cushionBefore: state.cushion },
          },
        ],
      };
      if (action.kind === 'withdrawal') return { ...s2, peakEmergencyCents: Math.max(s2.peakEmergencyCents, emergencyBalance(state)) };
      // Saving from today's plan leaves the rest of the safe maximum as a cushion, checked again at the next review.
      let cushion = action.fromCushion ? undefined : state.cushion;
      if (!action.fromCushion) {
        const before = computeRecommendation(state, today);
        // Only money held back for uncertainty counts as a cushion, not a limit the user chose.
        const left = before.cushionCents > 0 ? before.maxSafeCents - moved : 0;
        const m = marketFor(state.marketCode);
        const min = minor(m, m.rounding.minActionableMajor);
        cushion = left >= min ? { cents: left, setOn: today, reviewOn: before.nextReviewDate } : undefined;
      }
      return { ...s2, cushion, peakEmergencyCents: Math.max(s2.peakEmergencyCents, emergencyBalance(s2)) };
    }
    case 'CLEAR_CUSHION':
      return { ...state, cushion: undefined };
    case 'UNDO_CONTRIBUTION': {
      const c = state.contributions.find((x) => x.id === action.id && x.source === 'user' && !x.shockId);
      if (!c) return state;
      // Move the money back the way it came; give up if it has since been spent.
      const back = Math.abs(c.amountCents);
      const { state: s1, moved } = moveBetween(state, c.kind === 'deposit' ? 'emergency' : 'spending', back);
      if (moved !== back) return state;
      return {
        ...s1,
        contributions: s1.contributions.filter((x) => x.id !== c.id),
        peakEmergencyCents: c.undo ? c.undo.peakBefore : s1.peakEmergencyCents,
        cushion: c.undo ? c.undo.cushionBefore : s1.cushion,
      };
    }
    case 'START_OVER':
      return emptyState(action.market, today);

    case 'APPLY_SHOCK':
      return applyShock(state, action.input, today, true).state;

    case 'UPDATE_SETTINGS':
      return { ...state, settings: { ...state.settings, ...action.patch } };
    case 'UPDATE_GOAL':
      return { ...state, goal: { ...state.goal, ...action.patch } };
    case 'SET_RECOVERY_PLAN':
      return { ...state, recoveryPlan: { targetCents: action.targetCents, pauseWeeks: action.pauseWeeks, createdOn: today } };
  }
}

export function describeAction(a: Action, prev: AppState): string {
  const formatSGD = (c: Cents) => formatMoney(c, {}, marketFor(prev.marketCode).currency);
  switch (a.type) {
    case 'RESET':
      return 'Started again';
    case 'IMPORT_DRAFT':
      return prev.onboarded ? `Imported ${a.draft.transactions.length} transactions from ${a.draft.fileName}` : `Plan created from ${a.draft.fileName}`;
    case 'START_CASHBOOK':
      return 'Cash book started';
    case 'UPDATE_ACCOUNT':
      return `Updated ${prev.accounts.find((x) => x.id === a.id)?.name ?? 'an account'} balance`;
    case 'UPDATE_INCOME': {
      const src = prev.incomeSources.find((x) => x.id === a.id);
      if (src && a.patch.netAmountCents !== undefined && a.patch.netAmountCents !== src.netAmountCents)
        return `${src.name} changed from ${formatSGD(src.netAmountCents)} to ${formatSGD(a.patch.netAmountCents)} per payment`;
      if (src && a.patch.certainty && a.patch.certainty !== src.certainty) return `${src.name} marked as ${a.patch.certainty}`;
      return `Updated ${src?.name ?? 'income'}`;
    }
    case 'ADD_INCOME':
      return `Added income: ${a.income.name}`;
    case 'DELETE_INCOME':
      return `Removed income: ${prev.incomeSources.find((x) => x.id === a.id)?.name ?? ''}`;
    case 'RECEIVE_INCOME':
      return `Received ${prev.incomeSources.find((x) => x.id === a.id)?.name ?? 'income'}`;
    case 'ADD_BILL':
      return `Added bill: ${a.bill.name} (${formatSGD(a.bill.amountCents)})`;
    case 'ADOPT_PATTERNS':
      return `Added from your records: ${[...a.income.map((i) => i.name), ...a.bills.map((b) => b.bill.name)].join(', ')}`;
    case 'UPDATE_BILL':
      return `Updated bill: ${prev.bills.find((x) => x.id === a.id)?.name ?? ''}`;
    case 'DELETE_BILL':
      return `Removed bill: ${prev.bills.find((x) => x.id === a.id)?.name ?? ''}`;
    case 'PAY_BILL':
      return `Paid ${prev.bills.find((x) => x.id === a.id)?.name ?? 'a bill'}`;
    case 'ADD_TRANSACTION':
      return a.tx.amountCents > 0 ? `Money in: ${a.tx.merchant} (${formatSGD(a.tx.amountCents)})` : `New purchase: ${a.tx.merchant} (${formatSGD(-a.tx.amountCents)})`;
    case 'UPDATE_TRANSACTION':
    case 'UPDATE_LINE':
      return 'Reclassified spending';
    case 'DELETE_TRANSACTION':
      return 'Deleted a transaction';
    case 'REMOVE_SOURCE':
      return `Removed data from ${a.providerId}`;
    case 'DELETE_IMPORTED':
      return 'Deleted imported data';
    case 'ADD_HEALTH_BILL':
      return `Added medical bill: ${a.bill.provider} (${formatSGD(outOfPocket(a.bill))} out-of-pocket)`;
    case 'PAY_HEALTH_BILL':
      return 'Paid a medical bill';
    case 'DELETE_HEALTH_BILL':
      return 'Removed a medical bill';
    case 'UNDO_CONTRIBUTION':
      return 'Undid a recorded saving';
    case 'RECORD_CONTRIBUTION':
      return a.kind === 'deposit' ? (a.fromCushion ? `Saved unused cushion ${formatSGD(a.amountCents)}` : `Saved ${formatSGD(a.amountCents)}`) : `Withdrew ${formatSGD(a.amountCents)} from emergency savings`;
    case 'APPLY_SHOCK':
      return `Emergency: ${a.input.label}`;
    case 'UPDATE_SETTINGS':
      return 'Changed planning settings';
    case 'UPDATE_GOAL':
      return 'Changed savings goal';
    default:
      return 'Updated plan';
  }
}

const SILENT: Action['type'][] = ['RESET', 'START_OVER', 'CLEAR_CUSHION', 'COMPLETE_ONBOARDING', 'RESTART_ONBOARDING', 'SET_RECOVERY_PLAN', 'REPLACE_STATE', 'UPDATE_PROFILE'];

/** Apply an action and record a recommendation snapshot whenever the recommendation changes. */
export function reducer(state: AppState, action: Action, today: ISODate = todaySG()): AppState {
  const next = base(state, action, today);
  if (next === state || SILENT.includes(action.type)) return next;
  const rec = computeRecommendation(next, today);
  const fresh = action.type === 'RESET' || ((action.type === 'IMPORT_DRAFT' || action.type === 'START_CASHBOOK') && !state.onboarded);
  const history = fresh ? [] : next.history;
  const last = history[history.length - 1];
  if (last && last.recommendedCents === rec.recommendedCents && last.maxSafeCents === rec.maxSafeCents && last.status === rec.status) return next;
  return {
    ...next,
    history: [
      ...history,
      {
        at: new Date().toISOString(),
        date: today,
        recommendedCents: rec.recommendedCents,
        maxSafeCents: rec.maxSafeCents,
        status: rec.status,
        reason: describeAction(action, state),
        liquidCents: rec.liquidCents,
        emergencyCents: rec.emergencyCents,
      },
    ].slice(-40),
  };
}

/** A brand-new install: empty, waiting for the user's own data. */
export function initialState(today: ISODate = todaySG()): AppState {
  return emptyState('SG', today);
}

/** Build a manual transaction (used by quick-add forms). */
export function manualTransaction(merchant: string, amountCents: Cents, date: ISODate, rules: AppState['rules'], lines?: TransactionLine[], providerId = 'manual'): Transaction {
  const c = classify(merchant, merchant, amountCents, rules);
  return {
    id: uid('tx'),
    date,
    merchant,
    description: merchant,
    amountCents,
    category: c.category,
    subcategory: c.subcategory,
    essentiality: c.essentiality,
    source: 'user',
    providerId,
    confidence: c.confidence,
    lines,
    overridden: !!lines,
  };
}
