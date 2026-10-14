import { defaultEssentiality } from './categories';
import type { CategoryId, Confidence, Essentiality, Transaction, UserRule } from './types';

export interface Classification {
  category: CategoryId;
  subcategory: string;
  essentiality: Essentiality;
  confidence: Confidence;
  matchedBy: 'user-rule' | 'merchant-rule' | 'keyword' | 'none';
}

interface MerchantRule {
  test: RegExp;
  category: CategoryId;
  subcategory: string;
  /** Overrides the subcategory's default essentiality. */
  essentiality?: Essentiality;
}

/**
 * Merchant & keyword rules for common Singapore payees. Order matters: the
 * first match wins, so more specific patterns come first. A merchant is a
 * starting point, not a verdict: users can override and split receipts.
 */
const RULES: MerchantRule[] = [
  // Income
  { test: /\b(salary|payroll|sal\b|giro sal)/i, category: 'income', subcategory: 'salary' },
  { test: /(grab|foodpanda|deliveroo|lalamove).*(payout|earning|incentive)|payout/i, category: 'income', subcategory: 'gig-payout' },
  // Philippines and Myanmar (checked first: local words are unambiguous)
  { test: /daily sales|takings/i, category: 'income', subcategory: 'business-takings' },
  { test: /sari-?sari/i, category: 'groceries', subcategory: 'sari-sari' },
  { test: /palengke/i, category: 'groceries', subcategory: 'palengke' },
  { test: /carinderia|karinderya|turo-?turo/i, category: 'food', subcategory: 'carinderia' },
  { test: /jeepney|\bjeep\b/i, category: 'transport', subcategory: 'jeepney' },
  { test: /tricycle|trike/i, category: 'transport', subcategory: 'tricycle' },
  { test: /\bload\b|smart load|globe load|e-?load/i, category: 'utilities', subcategory: 'prepaid-load' },
  { test: /boarding house|bedspace/i, category: 'housing', subcategory: 'boarding-house' },
  { test: /padala|pasaload/i, category: 'family', subcategory: 'padala' },
  { test: /botika|mercury drug|watsons ph/i, category: 'healthcare', subcategory: 'botika' },
  { test: /\blpg\b|gas tank|gas refill/i, category: 'utilities', subcategory: 'gas' },
  { test: /restock|supplier/i, category: 'business', subcategory: 'restock' },
  { test: /stall rent|market fee/i, category: 'business', subcategory: 'stall-rent' },
  { test: /petron|shell|caltex|gasoline|gasolina/i, category: 'business', subcategory: 'fuel' },
  { test: /school fees?|tuition fee school/i, category: 'family', subcategory: 'school-fees' },
  // Myanmar
  { test: /\bovertime\b|\bOT pay\b/i, category: 'income', subcategory: 'overtime' },
  { test: /\bwages?\b/i, category: 'income', subcategory: 'salary' },
  { test: /\bzay\b|\bzei\b/i, category: 'groceries', subcategory: 'zay' },
  { test: /tea ?shop|lahpet|mohinga|curry stall/i, category: 'food', subcategory: 'tea-shop' },
  { test: /line ?car|ferry/i, category: 'transport', subcategory: 'line-car' },
  { test: /phone top-?up|mpt|ooredoo|atom top|mytel/i, category: 'utilities', subcategory: 'phone-topup' },
  { test: /hostel/i, category: 'housing', subcategory: 'hostel-room' },
  { test: /generator/i, category: 'utilities', subcategory: 'electricity' },
  { test: /sent home|money home/i, category: 'family', subcategory: 'remittance' },
  // Groceries
  { test: /fairprice|ntuc|fp xtra|finest/i, category: 'groceries', subcategory: 'fairprice' },
  { test: /sheng ?siong/i, category: 'groceries', subcategory: 'sheng-siong' },
  { test: /\bgiant\b/i, category: 'groceries', subcategory: 'giant' },
  { test: /cold storage|cs fresh/i, category: 'groceries', subcategory: 'cold-storage' },
  { test: /wet market|market stall/i, category: 'groceries', subcategory: 'wet-market' },
  { test: /minimart|provision|7-eleven|7 eleven|cheers/i, category: 'groceries', subcategory: 'minimart' },
  { test: /redmart|amazon fresh|pandamart|grabmart/i, category: 'groceries', subcategory: 'online' },
  // Food delivery before rides (both "grab")
  { test: /grabfood|grab food/i, category: 'food', subcategory: 'grabfood' },
  { test: /foodpanda/i, category: 'food', subcategory: 'foodpanda' },
  { test: /deliveroo/i, category: 'food', subcategory: 'deliveroo' },
  { test: /hawker|food centre|food center|market & food/i, category: 'food', subcategory: 'hawker' },
  { test: /kopitiam|coffee shop|kopi/i, category: 'food', subcategory: 'kopitiam' },
  { test: /food court|koufu|food republic|foodfare/i, category: 'food', subcategory: 'food-court' },
  { test: /starbucks|toast box|ya kun|cafe|café|coffee bean|luckin/i, category: 'food', subcategory: 'cafe' },
  { test: /bubble tea|koi|liho|chicha|gong cha|playmade/i, category: 'food', subcategory: 'drinks' },
  { test: /restaurant|bistro|mcdonald|kfc|subway|jollibee|sushi/i, category: 'food', subcategory: 'restaurant' },
  // Transport
  { test: /simplygo/i, category: 'transport', subcategory: 'simplygo' },
  { test: /ez-?link/i, category: 'transport', subcategory: 'ezlink' },
  { test: /\bmrt\b|smrt|transitlink/i, category: 'transport', subcategory: 'mrt' },
  { test: /\bbus\b|sbs transit/i, category: 'transport', subcategory: 'bus' },
  { test: /grab ?(ride|car|taxi)|gojek|tada|ryde|\bgrab\b/i, category: 'transport', subcategory: 'grab-ride' },
  { test: /comfort|citycab|taxi|cdg/i, category: 'transport', subcategory: 'taxi' },
  { test: /shell|esso|caltex|spc|sinopec|petrol/i, category: 'transport', subcategory: 'petrol' },
  { test: /parking|carpark|ura park/i, category: 'transport', subcategory: 'parking' },
  { test: /\berp\b/i, category: 'transport', subcategory: 'erp' },
  { test: /road tax|lta/i, category: 'transport', subcategory: 'road-tax' },
  { test: /motor insurance|vehicle insurance/i, category: 'transport', subcategory: 'motor-insurance' },
  { test: /workshop|servicing|tyre|motorcycle repair/i, category: 'transport', subcategory: 'servicing' },
  // Healthcare
  { test: /polyclinic/i, category: 'healthcare', subcategory: 'polyclinic' },
  { test: /dental|dentist/i, category: 'healthcare', subcategory: 'dental' },
  { test: /hospital|sgh|ttsh|nuh|ktph|cgh|ngh/i, category: 'healthcare', subcategory: 'hospital' },
  { test: /specialist|sotc|centre for/i, category: 'healthcare', subcategory: 'specialist' },
  { test: /clinic|medical|family practice|\bgp\b/i, category: 'healthcare', subcategory: 'gp' },
  { test: /guardian|watsons|unity|pharmacy/i, category: 'healthcare', subcategory: 'pharmacy' },
  // Utilities
  { test: /sp group|sp services|sp digital/i, category: 'utilities', subcategory: 'sp-group' },
  { test: /town council|\btc\b/i, category: 'utilities', subcategory: 'town-council' },
  { test: /singtel|starhub|m1|simba|circles|giga|gomo|myrepublic|viewqwest/i, category: 'utilities', subcategory: 'mobile' },
  // Housing
  { test: /hdb.*(loan|mortgage|instal)|housing loan/i, category: 'housing', subcategory: 'hdb-mortgage' },
  { test: /\brent(al)?\b|landlord|room rental/i, category: 'housing', subcategory: 'room-rental' },
  { test: /s&cc|conservancy/i, category: 'housing', subcategory: 'scc' },
  // Family & education
  { test: /childcare|preschool|kindergarten|sparkletots|my first skool|pcf/i, category: 'family', subcategory: 'childcare' },
  { test: /school fee|moe|polytechnic|\bite\b|university/i, category: 'family', subcategory: 'school-fees' },
  { test: /tuition|enrichment/i, category: 'family', subcategory: 'tuition' },
  { test: /study loan|tuition fee loan|education loan/i, category: 'family', subcategory: 'education-loan' },
  { test: /remit|western union|wise|instarem|singx/i, category: 'family', subcategory: 'remittance' },
  { test: /parents|elderly|allowance to/i, category: 'family', subcategory: 'elderly-support' },
  // Financial
  { test: /insurance|prudential|aia|income insurance|great eastern|aviva|singlife|fwd/i, category: 'financial', subcategory: 'insurance' },
  { test: /credit card|card payment|bill payment - card/i, category: 'financial', subcategory: 'credit-card' },
  { test: /atome|hoolah|pace|grab paylater|bnpl/i, category: 'financial', subcategory: 'bnpl' },
  { test: /iras|income tax/i, category: 'financial', subcategory: 'tax' },
  { test: /instal|hire purchase|loan/i, category: 'financial', subcategory: 'instalment' },
  // Lifestyle
  { test: /netflix|spotify|disney|youtube premium|apple\.com|viu|hbo/i, category: 'lifestyle', subcategory: 'streaming' },
  { test: /shopee|lazada|uniqlo|zara|h&m|taobao|amazon/i, category: 'lifestyle', subcategory: 'shopping' },
  { test: /cinema|golden village|shaw|cathay|steam|playstation/i, category: 'lifestyle', subcategory: 'entertainment' },
  { test: /gym|fitness|anytime|activesg|virgin active/i, category: 'lifestyle', subcategory: 'gym' },
  { test: /airasia|scoot|singapore airlines|jetstar|agoda|booking\.com|klook/i, category: 'lifestyle', subcategory: 'travel' },
  { test: /salon|barber|hair|nail|sephora/i, category: 'lifestyle', subcategory: 'grooming' },
  // Transfers
  { test: /emergency savings|savings pocket|transfer to savings/i, category: 'transfer', subcategory: 'savings' },
  { test: /paynow transfer to self|own account|fund transfer/i, category: 'transfer', subcategory: 'own-account' },
];

/** Normalise a merchant string for matching and duplicate detection. */
export function normaliseMerchant(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\b(pte|ltd|sg|singapore|the)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function classify(
  merchant: string,
  description: string,
  amountCents: number,
  userRules: UserRule[] = [],
): Classification {
  const norm = normaliseMerchant(merchant);
  for (const r of userRules) {
    if (r.pattern && norm.includes(r.pattern)) {
      return { category: r.category, subcategory: r.subcategory, essentiality: r.essentiality, confidence: 'high', matchedBy: 'user-rule' };
    }
  }
  const text = `${merchant} ${description}`;
  for (const r of RULES) {
    if (r.test.test(text)) {
      // Income rules only apply to inflows; spending rules only to outflows.
      const isIncomeRule = r.category === 'income';
      if (isIncomeRule && amountCents <= 0) continue;
      if (!isIncomeRule && r.category !== 'transfer' && amountCents > 0) continue;
      return {
        category: r.category,
        subcategory: r.subcategory,
        essentiality: r.essentiality ?? defaultEssentiality(r.category, r.subcategory),
        confidence: r.test.test(merchant) ? 'high' : 'medium',
        matchedBy: r.test.test(merchant) ? 'merchant-rule' : 'keyword',
      };
    }
  }
  if (amountCents > 0) {
    return { category: 'income', subcategory: 'other-income', essentiality: 'review', confidence: 'low', matchedBy: 'none' };
  }
  return { category: 'uncategorised', subcategory: 'unknown', essentiality: 'review', confidence: 'low', matchedBy: 'none' };
}

/** Re-classify a transaction unless the user has overridden it. */
export function reclassify(t: Transaction, userRules: UserRule[]): Transaction {
  if (t.overridden || t.billId) return t;
  const c = classify(t.merchant, t.description, t.amountCents, userRules);
  return { ...t, category: c.category, subcategory: c.subcategory, essentiality: c.essentiality, confidence: c.confidence };
}

/** Is this transaction spending (not income or a transfer between own accounts)? */
export const isSpending = (t: Transaction): boolean =>
  t.amountCents < 0 && t.category !== 'transfer' && t.category !== 'income';
