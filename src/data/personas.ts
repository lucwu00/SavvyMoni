/**
 * Synthetic personas for Singapore, the Philippines and Myanmar. Every figure here is illustrative and
 * generated; none of it describes a real person. The app itself never loads
 * these: they generate the downloadable sample workbooks (which go through the
 * same import as a user's own file) and the test fixtures. Data is anchored to "today"
 * so bills and paydays always fall in the near future during a demo.
 */
import { classify } from '../domain/classifier';
import { addDays, addMonths, type ISODate } from '../domain/dates';
import { rng } from '../domain/ids';
import { toCents, type Cents } from '../domain/money';
import { nthOccurrence } from '../domain/recurrence';
import type {
  Account,
  AppState,
  CategoryId,
  ConnectorState,
  Essentiality,
  HealthBill,
  IncomeSource,
  Profile,
  RecurringBill,
  Transaction,
  TransactionLine,
} from '../domain/types';

export type PersonaId = 'student' | 'rider' | 'household' | 'earlycareer' | 'ph-rider' | 'mm-worker';

interface SpendPattern {
  /** [min, max] dollars per occurrence, occurrences per week. */
  merchant: string;
  min: number;
  max: number;
  perWeek: number;
  weekdaysOnly?: boolean;
  provider?: string;
}

interface PersonaSpec {
  id: PersonaId;
  seed: number;
  market: 'SG' | 'PH' | 'MM';
  /** Minor units per major unit (100 for SGD/PHP, 1 for MMK). Defaults to 100. */
  unit?: number;
  /** Generated amounts are rounded to this many major units (0.01 by default; K100 for MMK). */
  roundTo?: number;
  /** Provider id used for the persona's everyday history and bill/income ledger. Defaults to 'dbs'. */
  ledgerProvider?: string;
  profile: Omit<Profile, 'personaId'>;
  household: AppState['household'];
  reserve: number;
  accounts: (t: ISODate) => Account[];
  income: (t: ISODate) => IncomeSource[];
  bills: (t: ISODate) => RecurringBill[];
  groceries: { stores: string[]; perWeek: number; min: number; max: number; pharmacyChance: number; provider?: string; sub?: string };
  spend: SpendPattern[];
  healthBills: (t: ISODate) => HealthBill[];
  connected: string[];
  summary: string;
}

const acct = (id: string, name: string, institution: string, kind: Account['kind'], role: Account['role'], dollars: number, t: ISODate, providerId?: string): Account => ({
  id,
  name,
  institution,
  kind,
  role,
  balanceCents: toCents(dollars),
  asOf: t,
  source: 'simulated',
  providerId,
});

const income = (p: Omit<IncomeSource, 'source' | 'netAmountCents' | 'grossAmountCents'> & { net: number; gross?: number }): IncomeSource => {
  const { net, gross, ...rest } = p;
  return { ...rest, netAmountCents: toCents(net), grossAmountCents: gross ? toCents(gross) : undefined, source: 'simulated' };
};

const bill = (
  id: string,
  name: string,
  category: CategoryId,
  subcategory: string,
  dollars: number,
  nextDue: ISODate,
  frequency: RecurringBill['frequency'],
  priority: RecurringBill['priority'],
  autoDebit = false,
): RecurringBill => ({ id, name, category, subcategory, amountCents: toCents(dollars), nextDue, frequency, priority, status: 'unpaid', source: 'simulated', confidence: 'high', autoDebit });

export const PERSONAS: Record<PersonaId, PersonaSpec> = {
  student: {
    id: 'student',
    market: 'SG',
    seed: 1101,
    summary: 'Polytechnic student with part-time retail shifts and weekend tutoring. Income varies week to week; savings are just starting.',
    profile: {
      displayName: 'Nur Aisyah',
      personaLabel: 'Part-time student worker',
      occupation: 'Polytechnic student, part-time retail assistant',
      householdSize: 1,
      dependants: 0,
      housing: 'Rents a room near Tampines',
      incomePattern: 'Fortnightly shift pay (varies) + occasional tutoring',
      notes: ['Income S$1,500–S$2,100 a month depending on shifts.', 'Pays her own course materials.'],
      fallbackDailyEssentialCents: 2200,
      fallbackDailyDiscretionaryCents: 600,
    },
    household: { size: 1, dependants: 0, earners: 1 },
    reserve: 100,
    accounts: (t) => [
      acct('a-posb', 'POSB eSavings', 'POSB', 'bank', 'spending', 1040.4, t, 'dbs'),
      acct('a-gxs', 'GXS Saving Pocket', 'GXS Bank', 'bank', 'emergency', 240, t),
    ],
    income: (t) => [
      income({ id: 'i-retail', name: 'Retail shift pay', kind: 'parttime', earner: 'Aisyah', frequency: 'fortnightly', net: 800, nextDate: addDays(t, 6), certainty: 'expected', variability: 0.2 }),
      income({ id: 'i-tutor', name: 'Weekend tutoring', kind: 'other', earner: 'Aisyah', frequency: 'monthly', net: 320, nextDate: addDays(t, 16), certainty: 'uncertain', variability: 0.4 }),
    ],
    bills: (t) => [
      bill('b-rent', 'Room rental', 'housing', 'room-rental', 650, addDays(t, 4), 'monthly', 'essential'),
      bill('b-mobile', 'SIM-only mobile plan', 'utilities', 'mobile', 10, addDays(t, 11), 'monthly', 'essential', true),
      bill('b-course', 'Course materials', 'family', 'school-fees', 85, addDays(t, 18), 'once', 'essential'),
      bill('b-music', 'Music streaming', 'lifestyle', 'streaming', 10.98, addDays(t, 21), 'monthly', 'discretionary', true),
    ],
    groceries: { stores: ['FairPrice Tampines Hub', 'FairPrice Xtra Tampines Mall'], perWeek: 1, min: 22, max: 42, pharmacyChance: 0.15 },
    spend: [
      { merchant: 'Tampines Round Market & Food Centre', min: 4.5, max: 7.5, perWeek: 9 },
      { merchant: 'Koufu Food Court Temasek Poly', min: 4.2, max: 6.5, perWeek: 4, weekdaysOnly: true },
      { merchant: 'SimplyGo Bus/MRT', min: 1.8, max: 3.6, perWeek: 6, provider: 'simplygo' },
      { merchant: 'LiHO Tea', min: 4.2, max: 6.4, perWeek: 2 },
      { merchant: 'Shopee Singapore', min: 12, max: 38, perWeek: 0.5 },
      { merchant: 'GrabFood', min: 14, max: 22, perWeek: 0.4 },
    ],
    healthBills: () => [],
    connected: ['dbs', 'fairprice', 'simplygo'],
  },
  rider: {
    id: 'rider',
    market: 'SG',
    seed: 2202,
    summary: 'Full-time food delivery rider on a motorcycle. Weekly payouts swing with demand, weather and incentives.',
    profile: {
      displayName: 'Ravi Kumar',
      personaLabel: 'Gig delivery rider',
      occupation: 'Platform food delivery rider (motorcycle)',
      householdSize: 1,
      dependants: 0,
      housing: 'Rents a room in an HDB flat in Woodlands',
      incomePattern: 'Weekly platform payouts after fees (varies)',
      notes: ['Income S$2,200–S$4,000 a month.', 'Sends money to family monthly.', 'Motorcycle on instalment.'],
      fallbackDailyEssentialCents: 3800,
      fallbackDailyDiscretionaryCents: 600,
    },
    household: { size: 1, dependants: 0, earners: 1 },
    reserve: 200,
    accounts: (t) => [
      acct('r-dbs', 'DBS Savings Plus', 'DBS', 'bank', 'spending', 1380, t, 'dbs'),
      acct('r-cash', 'Emergency cash envelope', 'Cash at home', 'cash', 'emergency', 450, t),
    ],
    income: (t) => [
      income({ id: 'i-payout', name: 'Delivery payouts', kind: 'gig', earner: 'Ravi', frequency: 'weekly', net: 760, nextDate: addDays(t, 3), certainty: 'expected', variability: 0.35 }),
    ],
    bills: (t) => [
      bill('b-rent', 'HDB room rental', 'housing', 'room-rental', 750, addDays(t, 13), 'monthly', 'essential'),
      bill('b-bike', 'Motorcycle instalment', 'financial', 'instalment', 285, addDays(t, 8), 'monthly', 'obligation', true),
      bill('b-motorins', 'Motor insurance', 'transport', 'motor-insurance', 92, addDays(t, 20), 'monthly', 'obligation', true),
      bill('b-mobile', 'Mobile plan', 'utilities', 'mobile', 25, addDays(t, 17), 'monthly', 'essential', true),
      bill('b-remit', 'Family remittance', 'family', 'remittance', 300, addDays(t, 26), 'monthly', 'adjustable'),
    ],
    groceries: { stores: ['FairPrice Woodlands North Plaza', 'FairPrice Causeway Point'], perWeek: 1, min: 18, max: 34, pharmacyChance: 0.1 },
    spend: [
      { merchant: 'Shell Woodlands Ave 3', min: 9, max: 14.5, perWeek: 6 },
      { merchant: 'Woodlands Hawker Centre', min: 4, max: 7, perWeek: 12 },
      { merchant: 'Kopitiam Admiralty', min: 1.4, max: 2.2, perWeek: 6 },
      { merchant: 'Shopee Singapore', min: 10, max: 30, perWeek: 0.4 },
      { merchant: 'Shaw Theatres', min: 13, max: 16, perWeek: 0.2 },
    ],
    healthBills: () => [],
    connected: ['dbs', 'fairprice'],
  },
  household: {
    id: 'household',
    market: 'SG',
    seed: 3303,
    summary: 'Family of four in a 3-room HDB flat. One full-time salary plus part-time work; childcare and support for elderly parents.',
    profile: {
      displayName: 'The Lim household',
      personaLabel: 'Lower-income household',
      occupation: 'Kelvin (warehouse supervisor) and Mei Hua (part-time admin)',
      householdSize: 4,
      dependants: 2,
      housing: '3-room HDB flat in Jurong West',
      incomePattern: 'Monthly salary (confirmed) + weekly part-time pay (varies)',
      notes: ['Household income S$3,000–S$4,500 a month.', 'Salary shown as take-home after employee CPF (illustrative).', 'Subsidies and CPF use vary by household; none are assumed beyond what is shown.'],
      fallbackDailyEssentialCents: 5500,
      fallbackDailyDiscretionaryCents: 1000,
    },
    household: { size: 4, dependants: 2, earners: 2 },
    reserve: 300,
    accounts: (t) => [
      acct('h-posb', 'POSB Everyday (joint)', 'POSB', 'bank', 'spending', 2180, t, 'dbs'),
      acct('h-uob', 'UOB Savings (rainy day)', 'UOB', 'bank', 'emergency', 1480, t),
    ],
    income: (t) => [
      income({ id: 'i-salary', name: 'Kelvin’s salary', kind: 'salary', earner: 'Kelvin', frequency: 'monthly', net: 2640, gross: 3300, nextDate: addDays(t, 18), certainty: 'confirmed', variability: 0 }),
      income({ id: 'i-parttime', name: 'Mei Hua’s part-time pay', kind: 'parttime', earner: 'Mei Hua', frequency: 'weekly', net: 290, nextDate: addDays(t, 2), certainty: 'expected', variability: 0.15 }),
    ],
    bills: (t) => [
      bill('b-hdb', 'HDB loan (cash portion)', 'housing', 'hdb-mortgage', 260, addDays(t, 5), 'monthly', 'obligation', true),
      bill('b-scc', 'Service & conservancy charges', 'housing', 'scc', 72, addDays(t, 5), 'monthly', 'essential', true),
      bill('b-sp', 'SP Group utilities', 'utilities', 'sp-group', 138, addDays(t, 9), 'monthly', 'essential', true),
      bill('b-broadband', 'Home broadband', 'utilities', 'broadband', 39, addDays(t, 14), 'monthly', 'adjustable', true),
      bill('b-mobile', 'Family mobile plan', 'utilities', 'mobile', 52, addDays(t, 14), 'monthly', 'essential', true),
      bill('b-childcare', 'Childcare (after subsidy)', 'family', 'childcare', 380, addDays(t, 3), 'monthly', 'essential'),
      bill('b-school', 'School pocket money & fees', 'family', 'school-fees', 40, addDays(t, 1), 'weekly', 'essential'),
      bill('b-ins', 'Insurance premiums', 'financial', 'insurance', 168, addDays(t, 22), 'monthly', 'obligation', true),
      bill('b-parents', 'Support for parents', 'family', 'elderly-support', 300, addDays(t, 19), 'monthly', 'essential'),
      bill('b-tuition', 'Tuition (P5 maths)', 'family', 'tuition', 180, addDays(t, 12), 'monthly', 'adjustable'),
      bill('b-netflix', 'Video streaming', 'lifestyle', 'streaming', 19.98, addDays(t, 7), 'monthly', 'discretionary', true),
    ],
    groceries: { stores: ['FairPrice Jurong Point', 'FairPrice Boon Lay'], perWeek: 1.5, min: 45, max: 78, pharmacyChance: 0.3 },
    spend: [
      { merchant: 'Sheng Siong Jurong West', min: 18, max: 40, perWeek: 0.7 },
      { merchant: 'Taman Jurong Market & Food Centre', min: 9, max: 18, perWeek: 9 },
      { merchant: 'SimplyGo Bus/MRT', min: 2.8, max: 5.6, perWeek: 7, provider: 'simplygo' },
      { merchant: 'Boon Lay Wet Market', min: 12, max: 24, perWeek: 0.8 },
      { merchant: 'KFC Jurong Point', min: 28, max: 46, perWeek: 0.6 },
      { merchant: 'Shopee Singapore', min: 12, max: 40, perWeek: 0.4 },
    ],
    healthBills: (t) => [
      {
        id: 'hb-poly-paid',
        provider: 'Jurong Polyclinic',
        providerType: 'polyclinic',
        visitDate: addDays(t, -24),
        dueDate: addDays(t, -10),
        billedCents: toCents(48.6),
        subsidyCents: toCents(24.3),
        insuranceCents: 0,
        medisaveCents: 0,
        status: 'paid',
        source: 'simulated',
        providerId: 'healthhub',
      },
      {
        id: 'hb-sotc',
        provider: 'Ng Teng Fong General Hospital (specialist clinic)',
        providerType: 'specialist',
        visitDate: addDays(t, -6),
        dueDate: addDays(t, 10),
        billedCents: toCents(168),
        subsidyCents: toCents(84),
        insuranceCents: 0,
        medisaveCents: 0,
        status: 'unpaid',
        source: 'simulated',
        providerId: 'healthhub',
        note: 'Subsidised outpatient visit. MediSave and insurance not assumed.',
      },
    ],
    connected: ['dbs', 'fairprice', 'simplygo', 'healthhub'],
  },
  earlycareer: {
    id: 'earlycareer',
    market: 'SG',
    seed: 4404,
    summary: 'Junior analyst in his first full-time job. Stable salary, a study loan and regular support for family.',
    profile: {
      displayName: 'Marcus Tan',
      personaLabel: 'Early-career salaried worker',
      occupation: 'Junior operations analyst',
      householdSize: 1,
      dependants: 0,
      housing: 'Rents a common room near Buona Vista',
      incomePattern: 'Monthly salary (confirmed)',
      notes: ['Salary shown as take-home after employee CPF (illustrative).', 'Repaying a study loan.', 'Sends an allowance to family.'],
      fallbackDailyEssentialCents: 3400,
      fallbackDailyDiscretionaryCents: 1800,
    },
    household: { size: 1, dependants: 0, earners: 1 },
    reserve: 500,
    accounts: (t) => [
      acct('m-dbs', 'DBS Multiplier', 'DBS', 'bank', 'spending', 2640, t, 'dbs'),
      acct('m-trust', 'Trust savings', 'Trust Bank', 'bank', 'emergency', 3250, t),
    ],
    income: (t) => [
      income({ id: 'i-salary', name: 'Salary', kind: 'salary', earner: 'Marcus', frequency: 'monthly', net: 3440, gross: 4300, nextDate: addDays(t, 13), certainty: 'confirmed', variability: 0 }),
    ],
    bills: (t) => [
      bill('b-rent', 'Room rental', 'housing', 'room-rental', 1050, addDays(t, 20), 'monthly', 'essential'),
      bill('b-loan', 'Study loan repayment', 'family', 'education-loan', 240, addDays(t, 9), 'monthly', 'obligation', true),
      bill('b-ins', 'Life & health insurance', 'financial', 'insurance', 118, addDays(t, 15), 'monthly', 'obligation', true),
      bill('b-mobile', 'Mobile plan', 'utilities', 'mobile', 30, addDays(t, 11), 'monthly', 'essential', true),
      bill('b-remit', 'Allowance to family', 'family', 'remittance', 350, addDays(t, 14), 'monthly', 'adjustable'),
      bill('b-gym', 'Gym membership', 'lifestyle', 'gym', 98, addDays(t, 6), 'monthly', 'discretionary', true),
      bill('b-stream', 'Streaming bundle', 'lifestyle', 'streaming', 15.98, addDays(t, 24), 'monthly', 'discretionary', true),
    ],
    groceries: { stores: ['FairPrice Finest Star Vista', 'FairPrice Buona Vista'], perWeek: 1, min: 28, max: 55, pharmacyChance: 0.1 },
    spend: [
      { merchant: 'Food Republic one-north', min: 6, max: 9.5, perWeek: 5, weekdaysOnly: true },
      { merchant: 'Ghim Moh Market & Food Centre', min: 5, max: 8, perWeek: 6 },
      { merchant: 'SimplyGo Bus/MRT', min: 2.4, max: 3.8, perWeek: 6, provider: 'simplygo' },
      { merchant: 'Grab ride', min: 12, max: 22, perWeek: 1.2 },
      { merchant: 'Toast Box', min: 4.5, max: 7, perWeek: 2 },
      { merchant: 'Restaurant at Holland Village', min: 30, max: 70, perWeek: 1 },
      { merchant: 'Uniqlo', min: 30, max: 80, perWeek: 0.3 },
    ],
    healthBills: () => [],
    connected: ['dbs', 'fairprice', 'simplygo'],
  },
  'ph-rider': {
    id: 'ph-rider',
    market: 'PH',
    seed: 5505,
    ledgerProvider: 'cash-ledger',
    summary: 'Motorcycle delivery rider in Quezon City. Weekly e-wallet cash-outs that swing with demand and rain, cash tips, and most spending in cash.',
    profile: {
      displayName: 'Joel Santos',
      personaLabel: 'Delivery rider (Philippines)',
      occupation: 'Motorcycle delivery rider for several apps',
      householdSize: 1,
      dependants: 0,
      housing: 'Rents a bedspace in a boarding house in Quezon City',
      incomePattern: 'Weekly e-wallet cash-out (varies) + daily cash tips',
      notes: ['Take-home earnings roughly ₱22,000–₱35,000 a month after platform fees, before fuel, depending on weather and demand (illustrative).', 'Keeps cash on hand and an e-wallet; no bank account used.', 'Sends money to family in the province.'],
      fallbackDailyEssentialCents: 33000,
      fallbackDailyDiscretionaryCents: 3000,
    },
    household: { size: 1, dependants: 0, earners: 1 },
    reserve: 500,
    accounts: (t) => [
      acct('p-cash', 'Cash on hand', 'Wallet', 'cash', 'spending', 2600, t),
      acct('p-wallet', 'E-wallet balance', 'E-wallet', 'ewallet', 'spending', 3100, t),
      acct('p-alkansya', 'Alkansya (coin bank)', 'Cash at home', 'cash', 'emergency', 1200, t),
    ],
    income: (t) => [
      income({ id: 'i-ph-payout', name: 'Delivery earnings', kind: 'gig', earner: 'Joel', frequency: 'weekly', net: 7000, nextDate: addDays(t, 4), certainty: 'expected', variability: 0.2 }),
      income({ id: 'i-ph-tips', name: 'Cash tips', kind: 'other', earner: 'Joel', frequency: 'daily', net: 80, nextDate: addDays(t, 1), certainty: 'uncertain', variability: 0.6 }),
    ],
    bills: (t) => [
      bill('b-ph-rent', 'Boarding house rent', 'housing', 'boarding-house', 3000, addDays(t, 6), 'monthly', 'essential'),
      bill('b-ph-moto', 'Motorcycle loan amortisation', 'financial', 'instalment', 2800, addDays(t, 12), 'monthly', 'obligation'),
      bill('b-ph-load', 'Prepaid load for data', 'utilities', 'prepaid-load', 150, addDays(t, 2), 'weekly', 'essential'),
      bill('b-ph-padala', 'Padala to family', 'family', 'padala', 2500, addDays(t, 15), 'monthly', 'adjustable'),
      bill('b-ph-power', 'Electricity share', 'utilities', 'electricity', 400, addDays(t, 20), 'monthly', 'essential'),
    ],
    groceries: { stores: ['Sari-sari store', 'Palengke Commonwealth'], perWeek: 2, min: 150, max: 350, pharmacyChance: 0.1, provider: 'cash-ledger', sub: 'sari-sari' },
    spend: [
      { merchant: 'Petron gasoline', min: 180, max: 240, perWeek: 5 },
      { merchant: 'Carinderia meal', min: 65, max: 95, perWeek: 9 },
      { merchant: 'Jeepney fare', min: 13, max: 26, perWeek: 2 },
      { merchant: 'Shopee PH', min: 150, max: 400, perWeek: 0.4 },
      { merchant: 'Cinema', min: 250, max: 300, perWeek: 0.15 },
    ],
    healthBills: () => [],
    connected: ['cash-ledger'],
  },
  'mm-worker': {
    id: 'mm-worker',
    market: 'MM',
    seed: 7707,
    unit: 1,
    roundTo: 100,
    ledgerProvider: 'cash-ledger',
    summary: 'Garment factory worker in an industrial zone of Yangon. Wages twice a month, overtime that comes and goes with orders and power cuts, and money sent home to her family.',
    profile: {
      displayName: 'Ma Hnin Ei',
      personaLabel: 'Garment worker (Myanmar)',
      occupation: 'Sewing operator at a garment factory',
      householdSize: 1,
      dependants: 0,
      housing: 'Shares a hostel room near the factory',
      incomePattern: 'Wages twice a month + weekly overtime (varies a lot)',
      notes: ['Take-home roughly K260,000–K330,000 a month depending on overtime (illustrative).', 'Keeps cash and a mobile wallet; savings kept in a tin at home.', 'Sends money to her parents in the village every month.', 'Power cuts can stop work and overtime without notice.'],
      fallbackDailyEssentialCents: 7000,
      fallbackDailyDiscretionaryCents: 1000,
    },
    household: { size: 1, dependants: 0, earners: 1 },
    reserve: 20000,
    accounts: (t) => [
      acct('m-cash', 'Cash on hand', 'Cash', 'cash', 'spending', 90000 / 100, t),
      acct('m-wallet', 'Mobile wallet', 'Mobile wallet', 'ewallet', 'spending', 30000 / 100, t),
      acct('m-tin', 'Savings tin at home', 'Cash at home', 'cash', 'emergency', 40000 / 100, t),
    ],
    income: (t) => [
      income({ id: 'i-mm-wage', name: 'Factory wages', kind: 'salary', earner: 'Hnin Ei', frequency: 'fortnightly', net: 110000 / 100, nextDate: addDays(t, 5), certainty: 'expected', variability: 0.1 }),
      income({ id: 'i-mm-ot', name: 'Overtime pay', kind: 'salary', earner: 'Hnin Ei', frequency: 'weekly', net: 20000 / 100, nextDate: addDays(t, 2), certainty: 'uncertain', variability: 0.6 }),
    ],
    bills: (t) => [
      bill('b-mm-room', 'Hostel room share', 'housing', 'hostel-room', 40000 / 100, addDays(t, 8), 'monthly', 'essential'),
      bill('b-mm-linecar', 'Line car to the factory', 'transport', 'line-car', 20000 / 100, addDays(t, 3), 'monthly', 'essential'),
      bill('b-mm-topup', 'Phone top-up', 'utilities', 'phone-topup', 3000 / 100, addDays(t, 2), 'weekly', 'essential'),
      bill('b-mm-home', 'Money sent home to parents', 'family', 'remittance', 40000 / 100, addDays(t, 16), 'monthly', 'adjustable'),
      bill('b-mm-power', 'Generator and electricity share', 'utilities', 'electricity', 10000 / 100, addDays(t, 20), 'monthly', 'essential'),
    ],
    groceries: { stores: ['Hlaing Tharyar zay', 'Corner shop'], perWeek: 2, min: 4000, max: 7000, pharmacyChance: 0.08, provider: 'cash-ledger', sub: 'zay' },
    spend: [
      { merchant: 'Tea shop meal', min: 1200, max: 2000, perWeek: 7 },
      { merchant: 'Mohinga breakfast', min: 800, max: 1200, perWeek: 4 },
      { merchant: 'Bus fare', min: 500, max: 1000, perWeek: 2 },
      { merchant: 'Thanaka and soap', min: 1500, max: 3000, perWeek: 0.5 },
    ],
    healthBills: () => [],
    connected: ['cash-ledger'],
  },
};

export const PERSONA_ORDER: PersonaId[] = ['student', 'rider', 'household', 'earlycareer', 'ph-rider', 'mm-worker'];

export const PERSONAS_BY_MARKET: Record<'SG' | 'PH' | 'MM', PersonaId[]> = {
  SG: ['student', 'rider', 'household', 'earlycareer'],
  PH: ['ph-rider'],
  MM: ['mm-worker'],
};

/** Default persona when a country is first opened. */
export const DEFAULT_PERSONA: Record<'SG' | 'PH' | 'MM', PersonaId> = { SG: 'student', PH: 'ph-rider', MM: 'mm-worker' };

/** Days of synthetic history generated (sample workbooks use 90). */
let HISTORY_DAYS = 56;
const unitOf = (spec: PersonaSpec) => spec.unit ?? 100;
/** Round a major amount to the persona's step and convert to minor units. */
const money = (spec: PersonaSpec, major: number) => {
  const step = spec.roundTo ?? 0.01;
  return Math.round(Math.round(major / step) * step * unitOf(spec));
};
const ledgerOf = (spec: PersonaSpec) => spec.ledgerProvider ?? 'dbs';

function makeTx(id: string, date: ISODate, merchant: string, cents: Cents, providerId: string, extra: Partial<Transaction> = {}): Transaction {
  const c = classify(merchant, merchant, cents);
  return {
    id,
    date,
    merchant,
    description: merchant,
    amountCents: cents,
    category: c.category,
    subcategory: c.subcategory,
    essentiality: c.essentiality,
    source: 'simulated',
    providerId,
    confidence: c.confidence,
    ...extra,
  };
}

const line = (id: string, label: string, cents: Cents, category: CategoryId, subcategory: string, essentiality: Essentiality): TransactionLine => ({
  id,
  label,
  amountCents: cents,
  category,
  subcategory,
  essentiality,
});

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** Synthetic grocery baskets with mixed-category lines (FairPrice in SG, market or sari-sari baskets elsewhere). */
export function fairpriceHistory(spec: PersonaSpec, today: ISODate): Transaction[] {
  const r = rng(spec.seed + hash('fairprice'));
  const provider = spec.groceries.provider ?? 'fairprice';
  const grocerySub = spec.groceries.sub ?? 'fairprice';
  const out: Transaction[] = [];
  const g = spec.groceries;
  let n = 0;
  let acc = r();
  for (let d = HISTORY_DAYS; d >= 1; d--) {
    acc += g.perWeek / 7;
    if (acc < 1) continue;
    acc -= 1;
    const date = addDays(today, -d);
    const total = g.min + r() * (g.max - g.min);
    const fresh = total * (0.45 + r() * 0.15);
    const household = total * (0.12 + r() * 0.08);
    const hygiene = total * (0.06 + r() * 0.05);
    const pharmacy = r() < g.pharmacyChance ? total * (0.1 + r() * 0.15) : 0;
    const snacks = Math.max(0, total - fresh - household - hygiene);
    const id = `${spec.id}-fp-${n++}`;
    const lines = [
      line(`${id}-1`, 'Fresh food & pantry', money(spec, fresh), 'groceries', grocerySub, 'essential'),
      line(`${id}-2`, 'Household essentials', money(spec, household), 'groceries', 'household-essentials', 'essential'),
      line(`${id}-3`, 'Personal hygiene', money(spec, hygiene), 'groceries', 'hygiene', 'essential'),
      line(`${id}-4`, 'Snacks & drinks', money(spec, snacks), 'groceries', 'snacks', 'discretionary'),
    ];
    if (pharmacy > 0) lines.push(line(`${id}-5`, 'Pharmacy (paracetamol, plasters)', money(spec, pharmacy), 'healthcare', 'pharmacy', 'adjustable'));
    const cents = lines.reduce((t, l) => t + l.amountCents, 0);
    out.push(makeTx(id, date, g.stores[Math.floor(r() * g.stores.length)], -cents, provider, { lines: lines.filter((l) => l.amountCents > 0) }));
  }
  return out;
}

function patternHistory(spec: PersonaSpec, today: ISODate, provider: string): Transaction[] {
  const r = rng(spec.seed + hash(provider));
  const out: Transaction[] = [];
  let n = 0;
  for (const p of spec.spend.filter((x) => (x.provider ?? ledgerOf(spec)) === provider)) {
    // Evenly spaced occurrences at the stated rate, with a random phase, so
    // short windows are representative of the persona's typical month.
    let acc = r();
    for (let d = HISTORY_DAYS; d >= 1; d--) {
      const date = addDays(today, -d);
      const dow = new Date(date + 'T00:00:00Z').getUTCDay();
      if (p.weekdaysOnly && (dow === 0 || dow === 6)) continue;
      acc += p.perWeek / (p.weekdaysOnly ? 5 : 7);
      const count = Math.floor(acc);
      acc -= count;
      for (let k = 0; k < count; k++) {
        const amt = p.min + r() * (p.max - p.min);
        out.push(makeTx(`${spec.id}-${provider}-${n++}`, date, p.merchant, -money(spec, amt), provider));
      }
    }
  }
  return out;
}

/** Past bill payments and income credits, so history matches the schedule. */
function bankLedger(spec: PersonaSpec, today: ISODate, bills: RecurringBill[], incomes: IncomeSource[]): Transaction[] {
  const r = rng(spec.seed + hash('ledger'));
  const ledger = ledgerOf(spec);
  const out: Transaction[] = [];
  let n = 0;
  const from = addDays(today, -HISTORY_DAYS);
  for (const b of bills) {
    if (b.frequency === 'once') continue;
    for (let k = -1; k >= -400; k--) {
      const d = nthOccurrence(b.nextDue, b.frequency, k);
      if (d < from) break;
      if (d >= today) continue;
      out.push(makeTx(`${spec.id}-bill-${n++}`, d, b.name, -b.amountCents, ledger, { billId: b.id, category: b.category, subcategory: b.subcategory, essentiality: b.priority, confidence: 'high' }));
    }
  }
  for (const s of incomes) {
    for (let k = -1; k >= -400; k--) {
      const d = nthOccurrence(s.nextDate, s.frequency, k);
      if (d < from) break;
      if (d >= today) continue;
      if (s.certainty === 'uncertain' && r() < 0.4) continue;
      const swing = 1 + (r() * 2 - 1) * s.variability;
      const step = (spec.roundTo ?? 0.01) * unitOf(spec);
      const cents = Math.round((s.netAmountCents * swing) / step) * step;
      const name = s.kind === 'gig' ? (spec.market === 'SG' ? 'Grab delivery partner payout' : `${s.name} (cash-out)`) : s.kind === 'salary' && spec.market === 'SG' ? `Salary GIRO ${s.earner}` : s.name;
      out.push(
        makeTx(`${spec.id}-inc-${n++}`, d, name, cents, ledger, {
          category: 'income',
          subcategory: s.kind === 'gig' ? 'gig-payout' : s.kind === 'salary' ? (/overtime/i.test(s.name) ? 'overtime' : 'salary') : s.kind === 'business' ? 'business-takings' : 'other-income',
          essentiality: 'review',
        }),
      );
    }
  }
  return out;
}

export interface ProviderData {
  transactions: Transaction[];
  healthBills: HealthBill[];
}

/** Deterministic demo data for one simulated connector and persona. */
export function generateProviderData(providerId: string, personaId: string, today: ISODate): ProviderData {
  const spec = PERSONAS[personaId as PersonaId] ?? PERSONAS.student;
  switch (providerId) {
    case 'fairprice':
      return { transactions: spec.market === 'SG' ? fairpriceHistory(spec, today) : [], healthBills: [] };
    case 'simplygo': {
      const tx = patternHistory(spec, today, 'simplygo');
      if (tx.length === 0) {
        // Personas without regular public transport still get a light history.
        const r = rng(spec.seed + 7);
        for (let d = 28; d >= 1; d -= 3) tx.push(makeTx(`${spec.id}-simplygo-x${d}`, addDays(today, -d), 'SimplyGo Bus/MRT', -money(spec, 1.6 + r() * 1.6), 'simplygo'));
      }
      return { transactions: tx, healthBills: [] };
    }
    case 'healthhub': {
      const hb = spec.healthBills(today);
      if (hb.length) return { transactions: [], healthBills: hb };
      return {
        transactions: [],
        healthBills: [
          {
            id: `${spec.id}-hb-gp`,
            provider: 'Polyclinic (subsidised visit)',
            providerType: 'polyclinic',
            visitDate: addDays(today, -3),
            dueDate: addDays(today, 11),
            billedCents: toCents(46.2),
            subsidyCents: toCents(23.1),
            insuranceCents: 0,
            medisaveCents: 0,
            status: 'unpaid',
            source: 'simulated',
            providerId: 'healthhub',
            note: 'Synthetic billing record. No clinical information is included.',
          },
        ],
      };
    }
    default: {
      if (providerId === ledgerOf(spec)) {
        const bills = spec.bills(today);
        const incomes = spec.income(today);
        const groceries = (spec.groceries.provider ?? 'fairprice') === providerId ? fairpriceHistory(spec, today) : [];
        return { transactions: [...patternHistory(spec, today, providerId), ...bankLedger(spec, today, bills, incomes), ...groceries], healthBills: [] };
      }
      return { transactions: [], healthBills: [] };
    }
  }
}

export function buildPersonaState(personaId: PersonaId, today: ISODate, now = new Date().toISOString(), historyDays = 56): AppState {
  const before = HISTORY_DAYS;
  HISTORY_DAYS = historyDays;
  try {
    return buildPersonaStateInner(personaId, today, now);
  } finally {
    HISTORY_DAYS = before;
  }
}

function buildPersonaStateInner(personaId: PersonaId, today: ISODate, now: string): AppState {
  const spec = PERSONAS[personaId];
  const connectors: Record<string, ConnectorState> = {};
  let transactions: Transaction[] = [];
  let healthBills: HealthBill[] = [];
  for (const pid of spec.connected) {
    const data = generateProviderData(pid, personaId, today);
    transactions = transactions.concat(data.transactions);
    healthBills = healthBills.concat(data.healthBills);
    connectors[pid] = { providerId: pid, connected: true, consentGiven: true, consentAt: today, lastSync: now, recordCount: data.transactions.length + data.healthBills.length };
  }
  transactions.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  const accounts = spec.accounts(today);
  const emergency = accounts.filter((a) => a.role === 'emergency').reduce((t, a) => t + a.balanceCents, 0);
  return {
    schemaVersion: 1,
    marketCode: spec.market,
    createdAt: now,
    asOf: today,
    onboarded: false,
    profile: { personaId, ...spec.profile },
    household: spec.household,
    accounts,
    incomeSources: spec.income(today),
    bills: spec.bills(today),
    transactions,
    healthBills,
    contributions: [
      { id: `${personaId}-c1`, date: addMonths(today, -2), amountCents: Math.round(emergency * 0.6), kind: 'deposit', note: 'Opening balance (demo)', source: 'simulated' },
      { id: `${personaId}-c2`, date: addDays(today, -30), amountCents: emergency - Math.round(emergency * 0.6), kind: 'deposit', note: 'Top-up (demo)', source: 'simulated' },
    ],
    shocks: [],
    goal: { selected: 'auto', customTargetCents: 0, weeklyTargetCents: 0 },
    connectors,
    consents: spec.connected.map((pid) => ({ id: `consent-${pid}`, scope: `Demo data: ${pid}`, givenOn: today, revocable: true as const })),
    rules: [],
    settings: {
      minCashReserveCents: spec.reserve * unitOf(spec),
      horizonDays: 35,
      incomeDelayDays: 0,
      discretionaryReservePct: 100,
      groceryBudgetCents: money(spec, Math.round(((spec.groceries.min + spec.groceries.max) / 2) * spec.groceries.perWeek * 4.35 * 1.1)),
      remindersEnabled: true,
      language: 'en',
      simpleMode: spec.market === 'MM',
    },
    history: [],
    peakEmergencyCents: emergency,
  };
}

export const personaSummary = (id: PersonaId) => PERSONAS[id].summary;
