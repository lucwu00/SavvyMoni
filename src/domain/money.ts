/**
 * Currency helpers. All amounts are stored as integers in the currency's
 * minor unit (cents for SGD and PHP, whole kyat for MMK), so arithmetic is
 * exact and identical in every country. Only parsing and display differ.
 *
 * The type is still called `Cents` for brevity: read it as "minor units".
 */
export type Cents = number;

export interface Currency {
  code: string;
  symbol: string;
  /** Decimal places in everyday use: 2 for SGD/PHP, 0 for MMK. */
  minorUnits: number;
  groupSeparator: string;
  decimalSeparator: string;
}

export const SGD: Currency = { code: 'SGD', symbol: 'S$', minorUnits: 2, groupSeparator: ',', decimalSeparator: '.' };
export const PHP: Currency = { code: 'PHP', symbol: '₱', minorUnits: 2, groupSeparator: ',', decimalSeparator: '.' };
/** Myanmar kyat: pya are not used in everyday payments, so amounts are whole kyat. */
export const MMK: Currency = { code: 'MMK', symbol: 'K', minorUnits: 0, groupSeparator: ',', decimalSeparator: '.' };

/**
 * Currency used by UI components that don't receive one explicitly. The store
 * sets it from the active country before rendering. Domain code never relies
 * on it: engine functions always pass the state's own currency.
 */
let activeCurrency: Currency = SGD;
export const setActiveCurrency = (c: Currency) => {
  activeCurrency = c;
};
export const getActiveCurrency = () => activeCurrency;

const factor = (c: Currency) => 10 ** c.minorUnits;

/** Major units (dollars, pesos, kyat) to minor units. */
export const toMinor = (major: number, c: Currency = SGD): Cents => Math.round(major * factor(c));
export const toCents = (dollars: number): Cents => toMinor(dollars, SGD);
export const fromCents = (cents: Cents): number => cents / 100;

/** Ensure a value is a finite integer number of minor units. */
export function asCents(value: unknown): Cents {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n);
}

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Parse a user-entered amount ("S$1,234.50", "₱2,500", "K25,000", "-12")
 * into minor units without passing through floating point. Returns null when
 * the text is not a valid amount for this currency.
 */
export function parseMoney(input: string, c: Currency = SGD): Cents | null {
  if (typeof input !== 'string') return null;
  let s = input.trim();
  s = s.replace(new RegExp(`^${escapeRe(c.symbol)}`, 'i'), '').replace(new RegExp(`^${c.code}`, 'i'), '').replace(/\$/g, '').trim();
  let negative = false;
  if (s.startsWith('(') && s.endsWith(')')) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (s.startsWith('-')) {
    negative = !negative;
    s = s.slice(1);
  } else if (s.startsWith('+')) {
    s = s.slice(1);
  }
  s = s.trim();
  let intPart: string;
  let fracPart = '';
  if (c.minorUnits === 0) {
    // Whole units only: accept "25000", "25.000" and "25,000" as grouping.
    if (!/^\d{1,3}([.,\s]\d{3})*$/.test(s) && !/^\d+$/.test(s)) return null;
    intPart = s.replace(/[.,\s]/g, '');
  } else {
    const g = escapeRe(c.groupSeparator);
    const d = escapeRe(c.decimalSeparator);
    const withGroups = new RegExp(`^\\d{1,3}(${g}\\d{3})+(${d}\\d{0,${c.minorUnits}})?$`);
    const plain = new RegExp(`^\\d*(${d}\\d{0,${c.minorUnits}})?$`);
    if (!(withGroups.test(s) || plain.test(s)) || s === '' || s === c.decimalSeparator) return null;
    const cleaned = s.split(c.groupSeparator).join('');
    [intPart, fracPart = ''] = cleaned.split(c.decimalSeparator);
  }
  const minor = Number(intPart || '0') * factor(c) + Number((fracPart + '0'.repeat(c.minorUnits)).slice(0, c.minorUnits) || '0');
  if (!Number.isSafeInteger(minor)) return null;
  return negative ? -minor : minor;
}

/** Round down (towards zero for positives) to a step, e.g. S$5 = 500 cents. */
export function roundDownTo(cents: Cents, step: Cents): Cents {
  if (step <= 0) return cents;
  if (cents <= 0) return 0;
  return Math.floor(cents / step) * step;
}

export const sumCents = (values: Cents[]): Cents => values.reduce((a, b) => a + b, 0);

function group(n: number, sep: string): string {
  return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, sep);
}

export interface FormatOptions {
  /** Show minor units. Defaults to true when the amount has a fractional part. */
  decimals?: boolean;
  /** Prefix positive numbers with "+". */
  signed?: boolean;
  /** Compact form for axis labels, e.g. S$1.2k or K1.5M. */
  compact?: boolean;
}

export function formatMoney(minor: Cents, opts: FormatOptions = {}, c: Currency = activeCurrency): string {
  const v = Math.round(minor);
  const neg = v < 0;
  const abs = Math.abs(v);
  const f = factor(c);
  const major = abs / f;
  let body: string;
  if (opts.compact && major >= 1000) {
    const [n, suffix] = major >= 1_000_000 ? [major / 1_000_000, 'M'] : [major / 1000, 'k'];
    const r = n >= 10 ? Math.round(n) : Math.round(n * 10) / 10;
    body = `${String(r).replace('.', c.decimalSeparator)}${suffix}`;
  } else {
    const whole = Math.floor(abs / f);
    const rem = abs % f;
    const showDecimals = c.minorUnits > 0 && (opts.decimals ?? rem !== 0);
    body = group(whole, c.groupSeparator) + (showDecimals ? c.decimalSeparator + String(rem).padStart(c.minorUnits, '0') : '');
  }
  const sign = neg ? '−' : opts.signed && v > 0 ? '+' : '';
  return `${sign}${c.symbol}${body}`;
}

/** Singapore-dollar formatter (kept for explicit SGD contexts and tests). */
export const formatSGD = (cents: Cents, opts: FormatOptions = {}): string => formatMoney(cents, opts, SGD);

/** Plain numeric string for form inputs, e.g. 123456 -> "1234.56" (SGD) or 25000 -> "25000" (MMK). */
export function centsToInput(minor: Cents, c: Currency = SGD): string {
  const neg = minor < 0;
  const abs = Math.abs(Math.round(minor));
  const f = factor(c);
  const s = `${Math.floor(abs / f)}${c.minorUnits && abs % f ? c.decimalSeparator + String(abs % f).padStart(c.minorUnits, '0') : ''}`;
  return neg ? '-' + s : s;
}

/** Multiply by a ratio and round down to a whole minor unit. */
export function scaleCents(cents: Cents, ratio: number): Cents {
  if (!Number.isFinite(ratio)) return 0;
  return Math.floor(cents * ratio);
}
