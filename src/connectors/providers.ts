import type { ConnectionStatus } from '../domain/types';

export type ProviderCategory = 'bank' | 'payments' | 'grocery' | 'healthcare' | 'transport' | 'utilities';

export interface ProviderMeta {
  id: string;
  name: string;
  category: ProviderCategory;
  /** The honest status of this integration in the prototype. */
  status: ConnectionStatus;
  formats: Array<'csv' | 'xlsx' | 'manual' | 'pdf'>;
  /** What this provider would contribute to the plan. */
  contributes: string;
  /** Why the status is what it is, and what a real integration would require. */
  note: string;
}

export const STATUS_LABELS: Record<ConnectionStatus, string> = {
  'real-api': 'Connected through an authorised API',
  'user-import': 'User-authorised import',
  simulated: 'Simulated demo connector',
  planned: 'Planned integration',
  unavailable: 'Not available',
};

export const STATUS_HELP: Record<ConnectionStatus, string> = {
  'real-api': 'Live data under a signed provider agreement and explicit user consent. No provider uses this status in the prototype.',
  'user-import': 'You import your own spreadsheet (.xlsx or .csv) or type entries in. Nothing is fetched from the provider.',
  simulated: 'Not used: the prototype has no simulated connections.',
  planned: 'On the roadmap. Requires a provider partnership or authorised access before it can exist.',
  unavailable: 'No consumer data access exists or is assumed for this service.',
};

export const CATEGORY_LABELS: Record<ProviderCategory, string> = {
  bank: 'Banks',
  payments: 'Payments & wallets',
  grocery: 'Groceries',
  healthcare: 'Healthcare billing',
  transport: 'Transport',
  utilities: 'Utilities & household',
};

const bankNote = 'Download your statement from internet banking as CSV or Excel and import it here, or copy it into the SavvyMoni template. A direct connection would need a bank partnership and explicit consent; none exists in this prototype.';

export const PROVIDERS: ProviderMeta[] = [
  { id: 'dbs', name: 'DBS / POSB', category: 'bank', status: 'user-import', formats: ['csv', 'xlsx'], contributes: 'Balances, income and spending', note: bankNote },
  { id: 'ocbc', name: 'OCBC', category: 'bank', status: 'user-import', formats: ['csv', 'xlsx'], contributes: 'Balances, income and spending', note: bankNote },
  { id: 'uob', name: 'UOB', category: 'bank', status: 'user-import', formats: ['csv', 'xlsx'], contributes: 'Balances, income and spending', note: bankNote },
  { id: 'scb', name: 'Standard Chartered', category: 'bank', status: 'user-import', formats: ['csv', 'xlsx'], contributes: 'Balances, income and spending', note: bankNote },
  { id: 'trust', name: 'Trust Bank', category: 'bank', status: 'user-import', formats: ['csv', 'xlsx', 'manual'], contributes: 'Balances and card spending', note: 'Enter balances manually or import a CSV if your app provides one. ' + 'Direct access would need a partnership.' },
  { id: 'gxs', name: 'GXS Bank', category: 'bank', status: 'user-import', formats: ['csv', 'xlsx', 'manual'], contributes: 'Savings pockets and spending', note: 'Enter balances manually or import a CSV if available. Direct access would need a partnership.' },
  { id: 'maribank', name: 'MariBank', category: 'bank', status: 'user-import', formats: ['csv', 'xlsx', 'manual'], contributes: 'Savings balance', note: 'Enter balances manually. Direct access would need a partnership.' },
  { id: 'sgfindex', name: 'SGFinDex', category: 'bank', status: 'planned', formats: [], contributes: 'Consolidated balances with Singpass consent', note: 'A public–private financial data exchange. Participation would require authorisation and regulatory review; SavvyMoni does not access it.' },
  { id: 'paynow', name: 'PayNow', category: 'payments', status: 'unavailable', formats: [], contributes: 'Transfers appear in your bank statement', note: 'PayNow is a transfer service, not a data source. There is no consumer payment-history API, so PayNow transfers are picked up from bank exports instead.' },
  { id: 'sgqr', name: 'SGQR', category: 'payments', status: 'unavailable', formats: [], contributes: 'QR payments appear in your bank or wallet statement', note: 'SGQR is a payment QR standard with no consumer history API. Payments show up through the underlying bank or wallet.' },
  { id: 'nets', name: 'NETS', category: 'payments', status: 'unavailable', formats: [], contributes: 'Card payments appear in your bank statement', note: 'NETS payments are captured through your bank export.' },
  { id: 'paylah', name: 'DBS PayLah!', category: 'payments', status: 'planned', formats: [], contributes: 'Wallet spending', note: 'Would require a provider partnership. Until then, top-ups and spending appear in your DBS/POSB export.' },
  { id: 'grabpay', name: 'GrabPay', category: 'payments', status: 'planned', formats: [], contributes: 'Wallet spending and gig payouts', note: 'Would require a provider partnership. Gig payouts can be added as income manually.' },
  { id: 'cards', name: 'Credit & debit cards', category: 'payments', status: 'user-import', formats: ['csv', 'xlsx'], contributes: 'Card spending', note: 'Import your card statement as CSV or Excel. Card numbers are never needed or stored.' },
  { id: 'fairprice', name: 'FairPrice', category: 'grocery', status: 'user-import', formats: ['manual', 'xlsx'], contributes: 'Grocery spending', note: 'Purchases appear in your bank or card export. You can also list receipts in the template, or split a receipt into groceries and pharmacy lines. No official FairPrice transaction API is assumed, and no account scraping is used.' },
  { id: 'shengsiong', name: 'Sheng Siong', category: 'grocery', status: 'user-import', formats: ['manual', 'csv', 'xlsx'], contributes: 'Grocery spending', note: 'Add receipts manually or via your bank export.' },
  { id: 'giant', name: 'Giant', category: 'grocery', status: 'user-import', formats: ['manual', 'csv', 'xlsx'], contributes: 'Grocery spending', note: 'Add receipts manually or via your bank export.' },
  { id: 'coldstorage', name: 'Cold Storage', category: 'grocery', status: 'user-import', formats: ['manual', 'csv', 'xlsx'], contributes: 'Grocery spending', note: 'Add receipts manually or via your bank export.' },
  { id: 'healthhub', name: 'HealthHub', category: 'healthcare', status: 'planned', formats: [], contributes: 'Bill amounts and due dates only', note: 'Would require authorised access and Singpass-based consent; none exists. Until then, enter the bill breakdown yourself. No health records, diagnoses, Singpass or NRIC are ever requested.' },
  { id: 'clinics', name: 'Polyclinics, GPs & hospitals', category: 'healthcare', status: 'user-import', formats: ['manual'], contributes: 'Out-of-pocket amounts', note: 'Enter the bill breakdown yourself: billed, subsidy, insurance, MediSave and what you pay.' },
  { id: 'pharmacies', name: 'Pharmacies', category: 'healthcare', status: 'user-import', formats: ['manual', 'csv', 'xlsx'], contributes: 'Medication spending', note: 'Captured from receipts or your bank export.' },
  { id: 'simplygo', name: 'SimplyGo', category: 'transport', status: 'user-import', formats: ['manual', 'xlsx'], contributes: 'Daily MRT and bus fares', note: 'Fares charged to a bank card appear in your card or bank export. No public SimplyGo transaction API is assumed.' },
  { id: 'ezlink', name: 'EZ-Link', category: 'transport', status: 'user-import', formats: ['manual'], contributes: 'Card top-ups and fares', note: 'Add top-ups manually or via your bank export.' },
  { id: 'ridehail', name: 'Ride-hailing', category: 'transport', status: 'user-import', formats: ['csv', 'xlsx'], contributes: 'Ride spending', note: 'Captured through card or bank CSV exports.' },
  { id: 'spgroup', name: 'SP Group', category: 'utilities', status: 'user-import', formats: ['manual'], contributes: 'Electricity, water and gas bills', note: 'Add your monthly bill in Bills. It is protected in every plan.' },
  { id: 'towncouncil', name: 'Town council', category: 'utilities', status: 'user-import', formats: ['manual'], contributes: 'Service & conservancy charges', note: 'Add as a monthly bill.' },
  { id: 'telco', name: 'Telcos', category: 'utilities', status: 'user-import', formats: ['manual', 'csv', 'xlsx'], contributes: 'Mobile and broadband', note: 'Add as monthly bills or pick up from bank exports.' },
  { id: 'insurers', name: 'Insurers', category: 'utilities', status: 'user-import', formats: ['manual'], contributes: 'Premium due dates', note: 'Add premiums as bills with their real frequency.' },
  { id: 'rent', name: 'Rent & housing', category: 'utilities', status: 'user-import', formats: ['manual'], contributes: 'Rent or loan instalments', note: 'Add as a monthly bill. Rent is always protected.' },
];

export const PROVIDER_MAP: Record<string, ProviderMeta> = Object.fromEntries(PROVIDERS.map((p) => [p.id, p]));

const SOURCE_NAMES: Record<string, string> = { csv: 'CSV import', spreadsheet: 'Spreadsheet import', manual: 'Manual entry', 'cash-ledger': 'Cash book' };
export const providerName = (id?: string): string => (id ? PROVIDER_MAP[id]?.name ?? SOURCE_NAMES[id] ?? id : 'Manual entry');
