/**
 * Country configuration. The Safe-to-Save engine is the same everywhere; this
 * file holds everything that changes between countries. Values for PH and ID
 * are reasoned prototype defaults for synthetic demos, not researched local
 * benchmarks, and must be validated with local partners before any pilot.
 */
import { MMK, PHP, SGD, type Currency } from '../domain/money';
import type { CategoryId, Essentiality, Lang } from '../domain/types';

export type MarketCode = 'SG' | 'PH' | 'MM' | 'MY' | 'TH' | 'VN';
export type LanguageCode = Lang;

export interface QuickCategory {
  /** Plain-language label shown on the cash book's quick-pick buttons. */
  label: string;
  category: CategoryId;
  subcategory: string;
  essentiality: Essentiality;
}

export interface MarketShockPreset {
  id: string;
  label: string;
  description: string;
  costMajor: number;
  offsetDays: number;
  incomeLossDays: number;
  incomeKinds: Array<'salary' | 'gig' | 'parttime' | 'allowance' | 'other' | 'business'>;
  category: CategoryId;
  subcategory: string;
}

export interface MarketConfig {
  code: MarketCode;
  name: string;
  status: 'demo' | 'planned';
  currency: Currency;
  locale: string;
  timeZone: string;
  languages: Array<{ code: LanguageCode; label: string }>;
  incomeFrequencies: Array<'daily' | 'weekly' | 'fortnightly' | 'monthly'>;
  /** Engine rounding: recommendations are rounded down to `stepMajor`; below `minActionableMajor` the advice is to pause. */
  rounding: { stepMajor: number; minActionableMajor: number };
  /** Fixed early milestones, in major units. Expense-based milestones (1 week, 1 month, 3 months) are added by the engine. */
  milestonesMajor: number[];
  defaultReserveMajor: number;
  /** Labels for the parts of a medical bill. The engine only uses the numbers. */
  health: { subsidy: string; insurance: string; publicScheme: string; schemeNote: string };
  paymentProviders: Array<{ name: string; kind: 'bank' | 'wallet' | 'rail' | 'cash'; status: 'user-import' | 'planned' | 'unavailable' | 'manual' }>;
  /** Largest single imported amount accepted without review, in major units. */
  maxImportMajor: number;
  /** Benchmark lab: size of the built-in unexpected bill, in major units. */
  benchmarkShockMajor: number;
  cashHeavy: boolean;
  dataProtectionLaw: string;
  /** Examples of public assistance to mention when essentials are short. Users must check eligibility. */
  assistanceExamples: string;
  quickIncome: QuickCategory[];
  quickExpense: QuickCategory[];
  shocks: MarketShockPreset[];
  notes: string[];
}

const q = (label: string, category: CategoryId, subcategory: string, essentiality: Essentiality): QuickCategory => ({ label, category, subcategory, essentiality });

// Placeholder base for planned markets (not selectable in the app).
const MARKETS_BASE: MarketConfig = {
  code: 'SG',
  name: '',
  status: 'planned',
  currency: SGD,
  locale: 'en',
  timeZone: 'UTC',
  languages: [{ code: 'en', label: 'English' }],
  incomeFrequencies: ['weekly', 'monthly'],
  rounding: { stepMajor: 1, minActionableMajor: 1 },
  milestonesMajor: [],
  defaultReserveMajor: 0,
  health: { subsidy: 'Subsidy', insurance: 'Insurance', publicScheme: 'Public scheme', schemeNote: '' },
  paymentProviders: [],
  maxImportMajor: 0,
  benchmarkShockMajor: 0,
  cashHeavy: false,
  dataProtectionLaw: '',
  assistanceExamples: '',
  quickIncome: [],
  quickExpense: [],
  shocks: [],
  notes: [],
};

export const MARKETS: Record<MarketCode, MarketConfig> = {
  SG: {
    code: 'SG',
    name: 'Singapore',
    status: 'demo',
    currency: SGD,
    locale: 'en-SG',
    timeZone: 'Asia/Singapore',
    languages: [
      { code: 'en', label: 'English' },
      { code: 'zh', label: '中文' },
      { code: 'ms', label: 'Bahasa Melayu' },
      { code: 'ta', label: 'தமிழ்' },
    ],
    incomeFrequencies: ['weekly', 'fortnightly', 'monthly'],
    rounding: { stepMajor: 5, minActionableMajor: 10 },
    milestonesMajor: [100, 500, 1000],
    defaultReserveMajor: 100,
    health: { subsidy: 'Government subsidy', insurance: 'Insurance pays', publicScheme: 'MediSave used', schemeNote: 'Only if confirmed for this bill.' },
    paymentProviders: [
      { name: 'DBS/POSB, OCBC, UOB and other banks', kind: 'bank', status: 'user-import' },
      { name: 'PayNow, SGQR, NETS', kind: 'rail', status: 'unavailable' },
      { name: 'DBS PayLah!, GrabPay', kind: 'wallet', status: 'planned' },
      { name: 'Cash', kind: 'cash', status: 'manual' },
    ],
    maxImportMajor: 100_000,
    benchmarkShockMajor: 400,
    cashHeavy: false,
    dataProtectionLaw: 'Personal Data Protection Act 2012 (PDPA)',
    assistanceExamples: 'ComCare, or MediFund for medical bills',
    quickIncome: [q('Pay', 'income', 'salary', 'review'), q('Gig payout', 'income', 'gig-payout', 'review'), q('Other money in', 'income', 'other-income', 'review')],
    quickExpense: [
      q('Food', 'food', 'hawker', 'essential'),
      q('Groceries', 'groceries', 'fairprice', 'essential'),
      q('Transport', 'transport', 'mrt', 'essential'),
      q('Bills', 'utilities', 'sp-group', 'essential'),
      q('Health', 'healthcare', 'gp', 'essential'),
      q('Family', 'family', 'elderly-support', 'essential'),
      q('Treats', 'lifestyle', 'nonessential', 'discretionary'),
    ],
    shocks: [
      { id: 'dental', label: 'Unexpected dental bill', description: 'Tooth extraction or root canal at a private clinic.', costMajor: 400, offsetDays: 3, incomeLossDays: 0, incomeKinds: [], category: 'healthcare', subcategory: 'dental' },
      { id: 'laptop', label: 'Laptop replacement', description: 'Laptop needed for school or work stops working.', costMajor: 800, offsetDays: 2, incomeLossDays: 0, incomeKinds: [], category: 'lifestyle', subcategory: 'shopping' },
      { id: 'repair', label: 'Urgent household repair', description: 'Leaking pipe or broken water heater.', costMajor: 1200, offsetDays: 5, incomeLossDays: 0, incomeKinds: [], category: 'housing', subcategory: 'repairs' },
      { id: 'medical', label: 'Medical out-of-pocket cost', description: 'Hospital stay after subsidies, with nothing assumed covered by MediSave or insurance.', costMajor: 2500, offsetDays: 14, incomeLossDays: 0, incomeKinds: [], category: 'healthcare', subcategory: 'out-of-pocket' },
      { id: 'gig-loss', label: 'Two weeks without gig income', description: 'Injury, platform suspension or a slow period.', costMajor: 0, offsetDays: 0, incomeLossDays: 14, incomeKinds: ['gig'], category: 'income', subcategory: 'gig-payout' },
      { id: 'job-loss', label: 'One month without work', description: 'Retrenchment or a contract ending without notice.', costMajor: 0, offsetDays: 7, incomeLossDays: 30, incomeKinds: ['salary', 'parttime'], category: 'income', subcategory: 'salary' },
      { id: 'vehicle', label: 'Vehicle breakdown', description: 'Motorcycle repair plus five days off the road.', costMajor: 900, offsetDays: 1, incomeLossDays: 5, incomeKinds: ['gig'], category: 'transport', subcategory: 'servicing' },
      { id: 'remittance', label: 'Emergency family remittance', description: 'Urgent support for a family member.', costMajor: 600, offsetDays: 1, incomeLossDays: 0, incomeKinds: [], category: 'family', subcategory: 'remittance' },
      { id: 'deposit', label: 'Unexpected housing cost', description: 'New rental deposit after a landlord sells the unit.', costMajor: 1800, offsetDays: 21, incomeLossDays: 0, incomeKinds: [], category: 'housing', subcategory: 'room-rental' },
    ],
    notes: ['Take-home pay modelled separately from gross (CPF eligibility varies).', 'Healthcare bills separate subsidy, insurance and MediSave.'],
  },
  PH: {
    code: 'PH',
    name: 'Philippines',
    status: 'demo',
    currency: PHP,
    locale: 'en-PH',
    timeZone: 'Asia/Manila',
    languages: [
      { code: 'en', label: 'English' },
      { code: 'fil', label: 'Filipino' },
    ],
    incomeFrequencies: ['daily', 'weekly', 'fortnightly', 'monthly'],
    rounding: { stepMajor: 50, minActionableMajor: 100 },
    milestonesMajor: [500, 2000, 5000],
    defaultReserveMajor: 500,
    health: { subsidy: 'Discount or subsidy', insurance: 'HMO or insurance pays', publicScheme: 'PhilHealth covers', schemeNote: 'Only if confirmed for this bill.' },
    paymentProviders: [
      { name: 'Banks (statement CSV)', kind: 'bank', status: 'user-import' },
      { name: 'E-wallets (GCash, Maya)', kind: 'wallet', status: 'planned' },
      { name: 'InstaPay, PESONet, QR Ph', kind: 'rail', status: 'unavailable' },
      { name: 'Cash', kind: 'cash', status: 'manual' },
    ],
    maxImportMajor: 500_000,
    benchmarkShockMajor: 3000,
    cashHeavy: true,
    dataProtectionLaw: 'Data Privacy Act of 2012 (Republic Act No. 10173)',
    assistanceExamples: 'DSWD crisis assistance, or a Malasakit Center for hospital bills',
    quickIncome: [q('Delivery payout', 'income', 'gig-payout', 'review'), q('Cash tips', 'income', 'other-income', 'review'), q('Other money in', 'income', 'other-income', 'review')],
    quickExpense: [
      q('Fuel', 'business', 'fuel', 'essential'),
      q('Food', 'food', 'carinderia', 'essential'),
      q('Sari-sari store', 'groceries', 'sari-sari', 'essential'),
      q('Load', 'utilities', 'prepaid-load', 'essential'),
      q('Fare', 'transport', 'jeepney', 'essential'),
      q('Family', 'family', 'remittance', 'adjustable'),
      q('Treats', 'lifestyle', 'nonessential', 'discretionary'),
    ],
    shocks: [
      { id: 'moto-repair', label: 'Motorcycle repair', description: 'Engine repair and four days off the road.', costMajor: 8000, offsetDays: 1, incomeLossDays: 4, incomeKinds: ['gig'], category: 'business', subcategory: 'vehicle-repair' },
      { id: 'typhoon', label: 'Typhoon week', description: 'Heavy rain stops deliveries for a week; small home repair after.', costMajor: 2500, offsetDays: 2, incomeLossDays: 7, incomeKinds: ['gig'], category: 'housing', subcategory: 'repairs' },
      { id: 'hospital', label: 'Hospital bill', description: 'Out-of-pocket hospital cost, nothing assumed covered by PhilHealth or an HMO.', costMajor: 12000, offsetDays: 5, incomeLossDays: 0, incomeKinds: [], category: 'healthcare', subcategory: 'hospital' },
      { id: 'phone', label: 'Phone lost or broken', description: 'A phone is needed to receive delivery jobs.', costMajor: 6500, offsetDays: 0, incomeLossDays: 2, incomeKinds: ['gig'], category: 'business', subcategory: 'work-tools' },
      { id: 'province', label: 'Family emergency in the province', description: 'Urgent money sent home.', costMajor: 5000, offsetDays: 1, incomeLossDays: 0, incomeKinds: [], category: 'family', subcategory: 'remittance' },
    ],
    notes: ['Income often arrives weekly via e-wallet cash-out, with cash tips daily.', 'Many expenses are paid in cash and small amounts (tingi).'],
  },
  MM: {
    code: 'MM',
    name: 'Myanmar',
    status: 'demo',
    currency: MMK,
    locale: 'en-MM',
    timeZone: 'Asia/Yangon',
    languages: [
      { code: 'en', label: 'English' },
      { code: 'my', label: 'မြန်မာ' },
    ],
    incomeFrequencies: ['daily', 'weekly', 'fortnightly', 'monthly'],
    rounding: { stepMajor: 1000, minActionableMajor: 2000 },
    milestonesMajor: [50_000, 200_000, 500_000],
    defaultReserveMajor: 20_000,
    health: { subsidy: 'Discount or donation', insurance: 'Insurance pays', publicScheme: 'Social Security Board covers', schemeNote: 'Only if confirmed for this bill.' },
    paymentProviders: [
      { name: 'Banks (statement CSV)', kind: 'bank', status: 'user-import' },
      { name: 'Mobile wallets (KBZPay, WavePay, AYA Pay)', kind: 'wallet', status: 'planned' },
      { name: 'MMQR and bank transfers', kind: 'rail', status: 'unavailable' },
      { name: 'Cash', kind: 'cash', status: 'manual' },
    ],
    maxImportMajor: 100_000_000,
    benchmarkShockMajor: 100_000,
    cashHeavy: true,
    dataProtectionLaw: 'No comprehensive data protection law; the Law Protecting the Privacy and Security of Citizens (2017) applies in part',
    assistanceExamples: 'community donation (parahita) groups, or the Social Security Board if you are a registered worker',
    quickIncome: [q('Wages', 'income', 'salary', 'review'), q('Overtime', 'income', 'overtime', 'review'), q('Other money in', 'income', 'other-income', 'review')],
    quickExpense: [
      q('Food', 'food', 'tea-shop', 'essential'),
      q('Rice and oil', 'groceries', 'zay', 'essential'),
      q('Phone top-up', 'utilities', 'phone-topup', 'essential'),
      q('Ferry or line car', 'transport', 'line-car', 'essential'),
      q('Generator or power', 'utilities', 'electricity', 'essential'),
      q('Family', 'family', 'remittance', 'adjustable'),
      q('Treats', 'lifestyle', 'nonessential', 'discretionary'),
    ],
    shocks: [
      { id: 'power-cut', label: 'Power cuts close the factory', description: 'A week of blackouts: no overtime and lost daily wages.', costMajor: 0, offsetDays: 2, incomeLossDays: 7, incomeKinds: ['salary', 'parttime'], category: 'income', subcategory: 'overtime' },
      { id: 'clinic', label: 'Clinic visit and medicine', description: 'Private clinic fee and medicine, nothing assumed covered by the Social Security Board.', costMajor: 80_000, offsetDays: 3, incomeLossDays: 2, incomeKinds: ['salary', 'parttime'], category: 'healthcare', subcategory: 'gp' },
      { id: 'village', label: 'Family emergency in the village', description: 'Urgent money sent home.', costMajor: 150_000, offsetDays: 1, incomeLossDays: 0, incomeKinds: [], category: 'family', subcategory: 'remittance' },
      { id: 'phone', label: 'Phone lost or broken', description: 'The phone is needed for the wallet and family contact.', costMajor: 120_000, offsetDays: 0, incomeLossDays: 0, incomeKinds: [], category: 'lifestyle', subcategory: 'shopping' },
      { id: 'prices', label: 'Rice and cooking oil prices jump', description: 'A month of higher food prices.', costMajor: 40_000, offsetDays: 5, incomeLossDays: 0, incomeKinds: [], category: 'groceries', subcategory: 'zay' },
    ],
    notes: ['Wages paid twice a month in cash or by mobile wallet; overtime changes week to week.', 'Prices can move quickly, so the cushion matters more.', 'Kyat amounts are whole numbers.'],
  },
  MY: plannedMarket('MY', 'Malaysia', 'Personal Data Protection Act 2010'),
  TH: plannedMarket('TH', 'Thailand', 'Personal Data Protection Act B.E. 2562 (2019)'),
  VN: plannedMarket('VN', 'Vietnam', 'Decree 13/2023/ND-CP on Personal Data Protection'),
};

function plannedMarket(code: MarketCode, name: string, law: string): MarketConfig {
  return {
    ...MARKETS_BASE,
    code,
    name,
    status: 'planned',
    dataProtectionLaw: law,
    notes: ['Not configured yet. Requires local research before any demo.'],
  };
}

export const DEMO_MARKETS: MarketCode[] = ['SG', 'PH', 'MM'];

export function marketFor(code: string | undefined): MarketConfig {
  const m = MARKETS[(code ?? 'SG') as MarketCode];
  return m && m.status === 'demo' ? m : MARKETS.SG;
}

/** Major units to this market's minor units. */
export const minor = (m: MarketConfig, major: number) => Math.round(major * 10 ** m.currency.minorUnits);
