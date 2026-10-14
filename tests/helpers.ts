import { addDays, type ISODate } from '../src/domain/dates';
import { toCents } from '../src/domain/money';
import type { AppState, IncomeSource, RecurringBill } from '../src/domain/types';

export const TODAY: ISODate = '2026-10-12';

/** A minimal, fully controlled state for engine tests. */
export function blankState(overrides: Partial<AppState> = {}): AppState {
  return {
    schemaVersion: 1,
    marketCode: 'SG',
    createdAt: '2026-10-12T00:00:00.000Z',
    asOf: TODAY,
    onboarded: true,
    profile: {
      personaId: 'test',
      displayName: 'Test',
      personaLabel: 'Test',
      occupation: '',
      householdSize: 1,
      dependants: 0,
      housing: '',
      incomePattern: '',
      notes: [],
      fallbackDailyEssentialCents: toCents(20),
      fallbackDailyDiscretionaryCents: 0,
    },
    household: { size: 1, dependants: 0, earners: 1 },
    accounts: [
      { id: 'spend', name: 'Spending', institution: 'Bank', kind: 'bank', role: 'spending', balanceCents: toCents(2000), asOf: TODAY, source: 'user' },
      { id: 'em', name: 'Emergency', institution: 'Bank', kind: 'bank', role: 'emergency', balanceCents: toCents(500), asOf: TODAY, source: 'user' },
    ],
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
      minCashReserveCents: toCents(100),
      horizonDays: 35,
      incomeDelayDays: 0,
      discretionaryReservePct: 100,
      groceryBudgetCents: toCents(200),
      remindersEnabled: false,
      language: 'en',
      simpleMode: false,
    },
    history: [],
    peakEmergencyCents: toCents(500),
    ...overrides,
  };
}

export function salary(dollars: number, inDays: number, extra: Partial<IncomeSource> = {}): IncomeSource {
  return {
    id: extra.id ?? `inc-${dollars}-${inDays}`,
    name: 'Salary',
    kind: 'salary',
    earner: 'Test',
    frequency: 'monthly',
    netAmountCents: toCents(dollars),
    nextDate: addDays(TODAY, inDays),
    certainty: 'confirmed',
    variability: 0,
    source: 'user',
    ...extra,
  };
}

export function bill(name: string, dollars: number, inDays: number, extra: Partial<RecurringBill> = {}): RecurringBill {
  return {
    id: extra.id ?? `bill-${name}`,
    name,
    category: 'housing',
    subcategory: 'room-rental',
    amountCents: toCents(dollars),
    nextDue: addDays(TODAY, inDays),
    frequency: 'monthly',
    priority: 'essential',
    status: 'unpaid',
    source: 'user',
    confidence: 'high',
    ...extra,
  };
}

/** A bank-style CSV export (synthetic) with one duplicate row and one broken row. */
export function bankCsv(today: ISODate = TODAY): string {
  const d = (n: number) => {
    const t = new Date(Date.UTC(+today.slice(0, 4), +today.slice(5, 7) - 1, +today.slice(8, 10)) - n * 86_400_000);
    return `${String(t.getUTCDate()).padStart(2, '0')}/${String(t.getUTCMonth() + 1).padStart(2, '0')}/${t.getUTCFullYear()}`;
  };
  return [
    'Date,Description,Debit,Credit',
    `${d(13)},SHENG SIONG SUPERMARKET TAMPINES,42.35,`,
    `${d(12)},BUS/MRT 98765 SIMPLYGO,3.28,`,
    `${d(11)},KOUFU FOOD COURT,6.80,`,
    `${d(10)},"GUARDIAN HEALTH & BEAUTY",18.90,`,
    `${d(9)},SINGTEL MOBILE BILL,28.00,`,
    `${d(8)},GRAB RIDE 1234,14.60,`,
    `${d(7)},SHOPEE SINGAPORE,35.00,`,
    `${d(6)},POLYCLINIC BEDOK,15.40,`,
    `${d(5)},GIANT HYPERMARKET,58.10,`,
    `${d(5)},GIANT HYPERMARKET,58.10,`,
    `${d(4)},TOAST BOX,5.40,`,
    `${d(3)},UNKNOWN MERCHANT 8812,22.00,`,
    `${d(2)},COLD STORAGE,27.45,`,
    `${d(1)},PAYNOW TRANSFER FROM FRIEND,,40.00`,
    `bad-date,BROKEN ROW,1.00,`,
  ].join('\n');
}
