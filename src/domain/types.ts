/** Interface languages. Each country offers its own set (see config/markets.ts). */
export type Lang = 'en' | 'zh' | 'ms' | 'ta' | 'fil' | 'my';

import type { Cents } from './money';
import type { ISODate } from './dates';

/** Where a record came from. Never mix these without a visible label. */
export type DataSource = 'user' | 'imported' | 'simulated' | 'estimated';
/** Whether a value has been confirmed or is an estimate. */
export type Confidence = 'high' | 'medium' | 'low';

export type Essentiality = 'essential' | 'adjustable' | 'discretionary' | 'obligation' | 'review';

export type CategoryId =
  | 'housing'
  | 'groceries'
  | 'food'
  | 'transport'
  | 'healthcare'
  | 'utilities'
  | 'family'
  | 'financial'
  | 'lifestyle'
  | 'business'
  | 'income'
  | 'transfer'
  | 'uncategorised';

export type Frequency = 'once' | 'daily' | 'weekly' | 'fortnightly' | 'monthly' | 'quarterly' | 'annual';
export type IncomeCertainty = 'confirmed' | 'expected' | 'uncertain';

export interface Profile {
  personaId: string;
  displayName: string;
  personaLabel: string;
  occupation: string;
  householdSize: number;
  dependants: number;
  housing: string;
  incomePattern: string;
  notes: string[];
  /** Fallback daily essential spend when transaction history is too thin. */
  fallbackDailyEssentialCents: Cents;
  fallbackDailyDiscretionaryCents: Cents;
}

export interface Household {
  size: number;
  dependants: number;
  earners: number;
}

export interface Account {
  id: string;
  name: string;
  institution: string;
  kind: 'bank' | 'ewallet' | 'cash';
  role: 'spending' | 'emergency';
  balanceCents: Cents;
  asOf: ISODate;
  source: DataSource;
  providerId?: string;
}

export interface IncomeSource {
  id: string;
  name: string;
  kind: 'salary' | 'gig' | 'parttime' | 'allowance' | 'business' | 'other';
  earner: string;
  frequency: Exclude<Frequency, 'once' | 'quarterly' | 'annual'>;
  /** Take-home amount per payment (after CPF / platform fees). */
  netAmountCents: Cents;
  /** Optional gross amount, shown for reference only. Never used in cash-flow maths. */
  grossAmountCents?: Cents;
  nextDate: ISODate;
  certainty: IncomeCertainty;
  /** 0–0.6: typical proportional swing in amount between payments. */
  variability: number;
  source: DataSource;
}

/** A single dated income event (received or projected). */
export interface IncomeEvent {
  sourceId: string;
  date: ISODate;
  amountCents: Cents;
  countedCents: Cents;
  certainty: IncomeCertainty;
}

export interface RecurringBill {
  id: string;
  name: string;
  category: CategoryId;
  subcategory: string;
  amountCents: Cents;
  nextDue: ISODate;
  frequency: Frequency;
  priority: Exclude<Essentiality, 'review'>;
  /** For one-off bills. Recurring bills advance nextDue when paid. */
  status: 'unpaid' | 'paid';
  lastPaid?: ISODate;
  source: DataSource;
  confidence: Confidence;
  autoDebit?: boolean;
  providerId?: string;
}

export interface TransactionLine {
  id: string;
  label: string;
  amountCents: Cents; // positive spend
  category: CategoryId;
  subcategory: string;
  essentiality: Essentiality;
}

export interface Transaction {
  id: string;
  date: ISODate;
  merchant: string;
  description: string;
  /** Negative = money out, positive = money in. */
  amountCents: Cents;
  category: CategoryId;
  subcategory: string;
  essentiality: Essentiality;
  source: DataSource;
  providerId?: string;
  accountId?: string;
  /** Set when the transaction is the payment of a tracked bill (avoids double counting). */
  billId?: string;
  /** Mixed-category receipts (e.g. a FairPrice basket with groceries + pharmacy). */
  lines?: TransactionLine[];
  overridden?: boolean;
  flags?: Array<'duplicate' | 'review'>;
  confidence: Confidence;
}

export interface EmergencySavingsAccount extends Account {
  role: 'emergency';
}

export interface SavingsContribution {
  id: string;
  date: ISODate;
  /** Positive deposit into emergency savings, negative withdrawal. */
  amountCents: Cents;
  kind: 'deposit' | 'withdrawal';
  note: string;
  shockId?: string;
  source: DataSource;
  /** What to restore if the user undoes this entry. */
  undo?: { peakBefore: Cents; cushionBefore?: { cents: Cents; setOn: ISODate; reviewOn: ISODate } };
}

export type MilestoneId = 'first100' | 'first500' | 'first1000' | 'week' | 'month' | 'three' | 'custom';

export interface SavingsGoal {
  selected: MilestoneId | 'auto';
  customTargetCents: Cents;
  /** Optional user-selected weekly savings target. 0 = none. */
  weeklyTargetCents: Cents;
}

export interface HealthBill {
  id: string;
  provider: string;
  providerType: 'polyclinic' | 'gp' | 'hospital' | 'specialist' | 'dental' | 'pharmacy';
  visitDate: ISODate;
  dueDate: ISODate;
  billedCents: Cents;
  subsidyCents: Cents;
  insuranceCents: Cents;
  medisaveCents: Cents;
  status: 'unpaid' | 'paid';
  source: DataSource;
  providerId?: string;
  note?: string;
}

export interface FinancialShock {
  id: string;
  presetId: string;
  label: string;
  costCents: Cents;
  date: ISODate;
  incomeLossDays: number;
  incomeSourceIds: string[];
  appliedOn: ISODate;
  emergencyUsedCents: Cents;
}

export type ConnectionStatus = 'real-api' | 'user-import' | 'simulated' | 'planned' | 'unavailable';

export interface ConnectorState {
  providerId: string;
  connected: boolean;
  consentGiven: boolean;
  consentAt?: ISODate;
  lastSync?: string;
  recordCount: number;
}

export interface UserConsent {
  id: string;
  scope: string;
  givenOn: ISODate;
  revocable: true;
}

export interface UserRule {
  id: string;
  pattern: string; // lowercase substring of merchant
  category: CategoryId;
  subcategory: string;
  essentiality: Essentiality;
}

export interface Settings {
  minCashReserveCents: Cents;
  horizonDays: number;
  /** Assume income may arrive this many days late. */
  incomeDelayDays: number;
  /** Share of usual discretionary spending to keep aside (0–100). */
  discretionaryReservePct: number;
  groceryBudgetCents: Cents;
  remindersEnabled: boolean;
  pauseUntil?: ISODate;
  /** UI language. Engine messages remain English in the prototype. */
  language: Lang;
  /** Larger text, fewer pages, plainer words. */
  simpleMode: boolean;
  /** When the user agreed that assistant questions and looked-up data may be sent to Claude. Absent = not agreed. */
  aiConsentAt?: string;
}

export interface RecommendationSnapshot {
  at: string;
  date: ISODate;
  recommendedCents: Cents;
  maxSafeCents: Cents;
  status: string;
  reason: string;
  liquidCents: Cents;
  emergencyCents: Cents;
}

export interface RecoveryPlan {
  targetCents: Cents;
  pauseWeeks: number;
  createdOn: ISODate;
}

export interface AppState {
  schemaVersion: 1;
  /** Country whose configuration (currency, categories, shocks, rounding) applies. */
  marketCode: 'SG' | 'PH' | 'MM';
  createdAt: string;
  asOf: ISODate;
  onboarded: boolean;
  profile: Profile;
  household: Household;
  accounts: Account[];
  incomeSources: IncomeSource[];
  bills: RecurringBill[];
  transactions: Transaction[];
  healthBills: HealthBill[];
  contributions: SavingsContribution[];
  shocks: FinancialShock[];
  goal: SavingsGoal;
  connectors: Record<string, ConnectorState>;
  consents: UserConsent[];
  rules: UserRule[];
  settings: Settings;
  history: RecommendationSnapshot[];
  /** Highest emergency balance seen, used to size rebuilding. */
  peakEmergencyCents: Cents;
  recoveryPlan?: RecoveryPlan;
  /**
   * The part of a safe maximum the user did not save because the forecast was
   * uncertain. Checked again on reviewOn: if it was not needed, SavvyMoni
   * suggests saving it then.
   */
  cushion?: { cents: Cents; setOn: ISODate; reviewOn: ISODate };
}
