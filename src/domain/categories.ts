import type { CategoryId, Essentiality } from './types';

export interface SubcategoryDef {
  id: string;
  label: string;
  essentiality: Essentiality;
}

export interface CategoryDef {
  id: CategoryId;
  label: string;
  /** Default essentiality for the category when the subcategory is unknown. */
  essentiality: Essentiality;
  subcategories: SubcategoryDef[];
}

const sub = (id: string, label: string, essentiality: Essentiality): SubcategoryDef => ({ id, label, essentiality });

/** Singapore-specific expense taxonomy. Market-specific; see src/config/markets.ts for localisation. */
export const CATEGORIES: CategoryDef[] = [
  {
    id: 'housing',
    label: 'Housing',
    essentiality: 'essential',
    subcategories: [
      sub('hdb-mortgage', 'HDB mortgage', 'obligation'),
      sub('private-mortgage', 'Private mortgage', 'obligation'),
      sub('room-rental', 'Room rental', 'essential'),
      sub('unit-rental', 'Whole-unit rental', 'essential'),
      sub('scc', 'Service & conservancy charges', 'essential'),
      sub('property-bills', 'Property-related bills', 'essential'),
      sub('maintenance', 'Household maintenance', 'adjustable'),
      sub('repairs', 'Repairs', 'essential'),
      sub('home-insurance', 'Home insurance', 'obligation'),
    ],
  },
  {
    id: 'groceries',
    label: 'Groceries',
    essentiality: 'essential',
    subcategories: [
      sub('fairprice', 'FairPrice', 'essential'),
      sub('sheng-siong', 'Sheng Siong', 'essential'),
      sub('giant', 'Giant', 'essential'),
      sub('cold-storage', 'Cold Storage', 'essential'),
      sub('wet-market', 'Wet market', 'essential'),
      sub('minimart', 'Minimart', 'essential'),
      sub('online', 'Online groceries', 'essential'),
      sub('household-essentials', 'Household essentials', 'essential'),
      sub('hygiene', 'Personal hygiene', 'essential'),
      sub('snacks', 'Snacks & treats', 'discretionary'),
    ],
  },
  {
    id: 'food',
    label: 'Food & drinks',
    essentiality: 'adjustable',
    subcategories: [
      sub('hawker', 'Hawker centre', 'essential'),
      sub('kopitiam', 'Kopitiam', 'essential'),
      sub('food-court', 'Food court', 'adjustable'),
      sub('restaurant', 'Restaurant', 'discretionary'),
      sub('cafe', 'Café', 'discretionary'),
      sub('grabfood', 'GrabFood', 'discretionary'),
      sub('foodpanda', 'foodpanda', 'discretionary'),
      sub('deliveroo', 'Deliveroo', 'discretionary'),
      sub('drinks', 'Coffee & drinks', 'discretionary'),
    ],
  },
  {
    id: 'transport',
    label: 'Transport',
    essentiality: 'essential',
    subcategories: [
      sub('mrt', 'MRT', 'essential'),
      sub('bus', 'Public bus', 'essential'),
      sub('simplygo', 'SimplyGo', 'essential'),
      sub('ezlink', 'EZ-Link', 'essential'),
      sub('grab-ride', 'Grab ride', 'adjustable'),
      sub('taxi', 'Taxi', 'adjustable'),
      sub('petrol', 'Petrol', 'essential'),
      sub('parking', 'Parking', 'adjustable'),
      sub('erp', 'ERP', 'adjustable'),
      sub('servicing', 'Vehicle servicing', 'essential'),
      sub('road-tax', 'Road tax', 'obligation'),
      sub('motor-insurance', 'Motor insurance', 'obligation'),
    ],
  },
  {
    id: 'healthcare',
    label: 'Healthcare',
    essentiality: 'essential',
    subcategories: [
      sub('polyclinic', 'Polyclinic', 'essential'),
      sub('gp', 'GP clinic', 'essential'),
      sub('hospital', 'Public hospital', 'essential'),
      sub('specialist', 'Specialist', 'essential'),
      sub('dental', 'Dental care', 'essential'),
      sub('prescription', 'Prescription medication', 'essential'),
      sub('pharmacy', 'Pharmacy purchase', 'adjustable'),
      sub('medical-insurance', 'Medical insurance', 'obligation'),
      sub('out-of-pocket', 'Out-of-pocket treatment', 'essential'),
    ],
  },
  {
    id: 'utilities',
    label: 'Utilities & connectivity',
    essentiality: 'essential',
    subcategories: [
      sub('sp-group', 'SP Group (utilities)', 'essential'),
      sub('electricity', 'Electricity', 'essential'),
      sub('water', 'Water', 'essential'),
      sub('gas', 'Gas', 'essential'),
      sub('broadband', 'Broadband', 'adjustable'),
      sub('mobile', 'Mobile plan', 'essential'),
      sub('town-council', 'Town council charges', 'essential'),
    ],
  },
  {
    id: 'family',
    label: 'Family & education',
    essentiality: 'essential',
    subcategories: [
      sub('childcare', 'Childcare', 'essential'),
      sub('school-fees', 'School fees', 'essential'),
      sub('tuition', 'Tuition', 'adjustable'),
      sub('education-loan', 'Education loan', 'obligation'),
      sub('elderly-support', 'Elderly support', 'essential'),
      sub('dependent-care', 'Dependent care', 'essential'),
      sub('remittance', 'Family remittance', 'adjustable'),
    ],
  },
  {
    id: 'financial',
    label: 'Financial commitments',
    essentiality: 'obligation',
    subcategories: [
      sub('insurance', 'Insurance premium', 'obligation'),
      sub('loan', 'Loan repayment', 'obligation'),
      sub('credit-card', 'Credit card bill', 'obligation'),
      sub('instalment', 'Instalment', 'obligation'),
      sub('bnpl', 'Buy now, pay later', 'obligation'),
      sub('tax', 'Tax', 'obligation'),
      sub('mandatory', 'Mandatory payment', 'obligation'),
    ],
  },
  {
    id: 'lifestyle',
    label: 'Lifestyle',
    essentiality: 'discretionary',
    subcategories: [
      sub('streaming', 'Streaming subscription', 'discretionary'),
      sub('shopping', 'Shopping', 'discretionary'),
      sub('entertainment', 'Entertainment', 'discretionary'),
      sub('gym', 'Gym membership', 'discretionary'),
      sub('travel', 'Travel', 'discretionary'),
      sub('grooming', 'Beauty & grooming', 'discretionary'),
      sub('nonessential', 'Other non-essential', 'discretionary'),
    ],
  },
  {
    id: 'business',
    label: 'Work & business costs',
    essentiality: 'essential',
    subcategories: [
      sub('restock', 'Stock and supplies', 'essential'),
      sub('stall-rent', 'Stall or cart rent', 'essential'),
      sub('fuel', 'Fuel for work', 'essential'),
      sub('vehicle-repair', 'Vehicle repair for work', 'essential'),
      sub('work-tools', 'Tools and phone for work', 'essential'),
      sub('platform-fees', 'Platform or association fees', 'obligation'),
    ],
  },
  {
    id: 'income',
    label: 'Income',
    essentiality: 'review',
    subcategories: [sub('salary', 'Salary', 'review'), sub('gig-payout', 'Gig payout', 'review'), sub('business-takings', 'Daily sales after stock', 'review'), sub('other-income', 'Other income', 'review')],
  },
  {
    id: 'transfer',
    label: 'Transfers',
    essentiality: 'review',
    subcategories: [sub('own-account', 'Between own accounts', 'review'), sub('savings', 'Emergency savings transfer', 'review')],
  },
  {
    id: 'uncategorised',
    label: 'Needs review',
    essentiality: 'review',
    subcategories: [sub('unknown', 'Unknown', 'review')],
  },
];

/**
 * Country-specific subcategories. The ten top-level categories are shared by
 * every country; only subcategories (merchants, local services) differ.
 */
export const MARKET_SUBCATEGORIES: Record<string, Partial<Record<CategoryId, SubcategoryDef[]>>> = {
  PH: {
    housing: [sub('boarding-house', 'Boarding house or bedspace', 'essential')],
    groceries: [sub('sari-sari', 'Sari-sari store', 'essential'), sub('palengke', 'Palengke (wet market)', 'essential')],
    food: [sub('carinderia', 'Carinderia', 'essential'), sub('street-food', 'Street food', 'adjustable')],
    transport: [sub('jeepney', 'Jeepney', 'essential'), sub('tricycle', 'Tricycle', 'essential')],
    utilities: [sub('prepaid-load', 'Prepaid load', 'essential')],
    healthcare: [sub('botika', 'Botika (pharmacy)', 'adjustable')],
    family: [sub('padala', 'Padala to family', 'adjustable')],
  },
  MM: {
    housing: [sub('hostel-room', 'Hostel or shared room', 'essential')],
    groceries: [sub('zay', 'Zay (market)', 'essential')],
    food: [sub('tea-shop', 'Tea shop or curry stall', 'essential')],
    transport: [sub('line-car', 'Line car or ferry', 'essential')],
    utilities: [sub('phone-topup', 'Phone top-up', 'essential')],
    income: [sub('overtime', 'Overtime pay', 'review')],
  },
};

/** Generic SG-only subcategories hidden in other countries' pickers. */
const SG_ONLY = new Set(['hdb-mortgage', 'scc', 'fairprice', 'sheng-siong', 'giant', 'cold-storage', 'simplygo', 'ezlink', 'mrt', 'erp', 'sp-group', 'town-council', 'polyclinic', 'grabfood', 'foodpanda', 'deliveroo', 'kopitiam']);

// Lookups (labels, defaults) work across all countries.
for (const extras of Object.values(MARKET_SUBCATEGORIES)) {
  for (const [cat, subs] of Object.entries(extras)) {
    const c = CATEGORIES.find((x) => x.id === cat);
    if (c) for (const sd of subs!) if (!c.subcategories.some((x) => x.id === sd.id)) c.subcategories.push(sd);
  }
}

/** Categories as shown in pickers for one country. */
export function categoriesFor(market: string): CategoryDef[] {
  if (market === 'SG') {
    const foreign = new Set(Object.values(MARKET_SUBCATEGORIES).flatMap((m) => Object.values(m).flatMap((x) => x!.map((y) => y.id))));
    return CATEGORIES.map((c) => ({ ...c, subcategories: c.subcategories.filter((s) => !foreign.has(s.id)) }));
  }
  const own = new Set(Object.values(MARKET_SUBCATEGORIES[market] ?? {}).flatMap((x) => x!.map((y) => y.id)));
  const otherForeign = new Set(
    Object.entries(MARKET_SUBCATEGORIES)
      .filter(([k]) => k !== market)
      .flatMap(([, m]) => Object.values(m).flatMap((x) => x!.map((y) => y.id))),
  );
  return CATEGORIES.map((c) => ({
    ...c,
    subcategories: [...c.subcategories.filter((s) => own.has(s.id)), ...c.subcategories.filter((s) => !own.has(s.id) && !SG_ONLY.has(s.id) && !otherForeign.has(s.id))],
  }));
}

export const CATEGORY_MAP: Record<CategoryId, CategoryDef> = Object.fromEntries(
  CATEGORIES.map((c) => [c.id, c]),
) as Record<CategoryId, CategoryDef>;

export const SPENDING_CATEGORIES = CATEGORIES.filter((c) => !['income', 'transfer'].includes(c.id));
export const spendingCategoriesFor = (market: string) => categoriesFor(market).filter((c) => !['income', 'transfer'].includes(c.id));

export function categoryLabel(id: CategoryId): string {
  return CATEGORY_MAP[id]?.label ?? 'Needs review';
}

export function subcategoryDef(category: CategoryId, subId: string): SubcategoryDef | undefined {
  return CATEGORY_MAP[category]?.subcategories.find((s) => s.id === subId);
}

export function subcategoryLabel(category: CategoryId, subId: string): string {
  return subcategoryDef(category, subId)?.label ?? subId;
}

export function defaultEssentiality(category: CategoryId, subId: string): Essentiality {
  return subcategoryDef(category, subId)?.essentiality ?? CATEGORY_MAP[category]?.essentiality ?? 'review';
}

export const ESSENTIALITY_LABELS: Record<Essentiality, string> = {
  essential: 'Essential',
  adjustable: 'Adjustable essential',
  discretionary: 'Discretionary',
  obligation: 'Debt / contractual',
  review: 'Needs review',
};

/** Essentials that the engine protects. Unknown items are protected too (conservative). */
export const isProtected = (e: Essentiality): boolean => e !== 'discretionary';
