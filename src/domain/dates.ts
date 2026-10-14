/**
 * Date-only helpers. Dates are stored as ISO "YYYY-MM-DD" strings and
 * arithmetic is done in UTC so results never shift with the host time zone.
 * "Today" is evaluated in Asia/Singapore.
 */
export type ISODate = string;

export const DEFAULT_TIME_ZONE = 'Asia/Singapore';
const DAY_MS = 86_400_000;

export function todayIn(timeZone = DEFAULT_TIME_ZONE, now: Date = new Date()): ISODate {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export const todaySG = (now?: Date): ISODate => todayIn(DEFAULT_TIME_ZONE, now);

export function isISODate(s: unknown): boolean {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const t = toUTC(s);
  return Number.isFinite(t) && fromUTC(t) === s;
}

export function toUTC(d: ISODate): number {
  const [y, m, day] = d.split('-').map(Number);
  return Date.UTC(y, m - 1, day);
}

export function fromUTC(ms: number): ISODate {
  const dt = new Date(ms);
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const d = String(dt.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export const addDays = (d: ISODate, n: number): ISODate => fromUTC(toUTC(d) + n * DAY_MS);

/** Whole days from a to b (b - a). */
export const diffDays = (a: ISODate, b: ISODate): number => Math.round((toUTC(b) - toUTC(a)) / DAY_MS);

const daysInMonth = (y: number, m0: number) => new Date(Date.UTC(y, m0 + 1, 0)).getUTCDate();

/** Add calendar months, clamping to the end of shorter months (31 Jan + 1 = 28/29 Feb). */
export function addMonths(d: ISODate, n: number): ISODate {
  const [y, m, day] = d.split('-').map(Number);
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12);
  const nm0 = total - ny * 12;
  const nd = Math.min(day, daysInMonth(ny, nm0));
  return fromUTC(Date.UTC(ny, nm0, nd));
}

export const minDate = (a: ISODate, b: ISODate): ISODate => (a <= b ? a : b);
export const maxDate = (a: ISODate, b: ISODate): ISODate => (a >= b ? a : b);

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function formatDate(d: ISODate, withYear = false): string {
  if (!isISODate(d)) return d;
  const [y, m, day] = d.split('-').map(Number);
  return `${day} ${MONTHS[m - 1]}${withYear ? ' ' + y : ''}`;
}

export function formatDateLong(d: ISODate): string {
  if (!isISODate(d)) return d;
  const dow = new Date(toUTC(d)).getUTCDay();
  return `${WEEKDAYS[dow]}, ${formatDate(d, true)}`;
}

export function formatMonth(d: ISODate): string {
  const [y, m] = d.split('-').map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}

export function relativeDay(d: ISODate, today: ISODate): string {
  const n = diffDays(today, d);
  if (n === 0) return 'today';
  if (n === 1) return 'tomorrow';
  if (n === -1) return 'yesterday';
  if (n < 0) return `${-n} days ago`;
  return `in ${n} days`;
}

/** Monday-based week start. */
export function startOfWeek(d: ISODate): ISODate {
  const dow = new Date(toUTC(d)).getUTCDay();
  const offset = (dow + 6) % 7;
  return addDays(d, -offset);
}

/** Parse common CSV date formats: YYYY-MM-DD, DD/MM/YYYY, D/M/YY, DD-MM-YYYY, DD MMM YYYY. */
export function parseLooseDate(input: string): ISODate | null {
  const s = input.trim();
  if (isISODate(s)) return s;
  // ISO date with a time part ("2026-09-01 08:30" or "2026-09-01T08:30:00").
  if (/^\d{4}-\d{2}-\d{2}[T ]/.test(s) && isISODate(s.slice(0, 10))) return s.slice(0, 10);
  const y = s.match(/^(\d{4})[/.](\d{1,2})[/.](\d{1,2})$/);
  if (y) {
    const iso = `${y[1]}-${y[2].padStart(2, '0')}-${y[3].padStart(2, '0')}`;
    return isISODate(iso) ? iso : null;
  }
  let m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/);
  if (m) {
    const day = Number(m[1]);
    const mon = Number(m[2]);
    let yr = Number(m[3]);
    if (yr < 100) yr += 2000;
    const iso = `${yr}-${String(mon).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    return isISODate(iso) ? iso : null;
  }
  m = s.match(/^(\d{1,2})[\s-]+([A-Za-z]{3})[a-z]*[\s-]+(\d{4})$/);
  if (m) {
    const idx = MONTHS.findIndex((x) => x.toLowerCase() === m![2].toLowerCase());
    if (idx < 0) return null;
    const iso = `${m[3]}-${String(idx + 1).padStart(2, '0')}-${String(Number(m[1])).padStart(2, '0')}`;
    return isISODate(iso) ? iso : null;
  }
  return null;
}
