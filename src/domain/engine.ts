/**
 * Adaptive Safe-to-Save Engine.
 *
 * Deterministic and explainable. It projects day-by-day cash over a planning
 * horizon (scheduled bills, unpaid medical bills, everyday essentials, a
 * discretionary allowance, and income counted conservatively by certainty) and
 * finds the largest amount that can be set aside today while every projected
 * daily balance stays at or above the user's minimum cash reserve.
 *
 * Invariant: recommendedCents <= maxSafeCents, and a positive recommendation is
 * never made when the projection (without saving) already dips below the reserve.
 */
import { addDays, diffDays, formatDate, todaySG, type ISODate } from './dates';
import { formatMoney, roundDownTo, type Cents, type Currency, type FormatOptions } from './money';
import { marketFor, minor } from '../config/markets';
import {
  buildEvents,
  maxSafeContribution,
  project,
  type CashEvent,
  type ExcludedIncome,
  type ProjectionDay,
} from './forecast';
import { activeGoal, coverageMonths, monthlyEssentialCents, type ActiveGoal } from './goals';
import type { SpendEstimate } from './spending';
import type { AppState, Confidence, Settings } from './types';

export type SaveStatus = 'safe' | 'cautious' | 'reduce' | 'pause' | 'rebuild' | 'insufficient';

export const STATUS_META: Record<SaveStatus, { label: string; tone: 'good' | 'warning' | 'serious' | 'info' | 'neutral' }> = {
  safe: { label: 'Safe to save', tone: 'good' },
  cautious: { label: 'Save cautiously', tone: 'warning' },
  reduce: { label: 'Reduce contribution', tone: 'warning' },
  pause: { label: 'Pause savings', tone: 'serious' },
  rebuild: { label: 'Rebuild emergency buffer', tone: 'info' },
  insufficient: { label: 'Insufficient information', tone: 'neutral' },
};

export interface ExplanationStep {
  label: string;
  amountCents: Cents | null;
  detail?: string;
  kind: 'start' | 'plus' | 'minus' | 'result' | 'note';
}

export interface ProtectedItem {
  label: string;
  date: ISODate;
  amountCents: Cents;
  kind: CashEvent['kind'];
  overdue?: boolean;
  refId?: string;
}

export interface Recommendation {
  marketCode: string;
  currency: Currency;
  today: ISODate;
  horizonEnd: ISODate;
  horizonDays: number;
  status: SaveStatus;
  statusLabel: string;
  headline: string;
  message: string;
  recommendedCents: Cents;
  maxSafeCents: Cents;
  confidence: Confidence;
  confidenceReasons: string[];
  limitingFactor: { date: ISODate; text: string } | null;
  protectedItems: ProtectedItem[];
  protectedTotalCents: Cents;
  assumptions: string[];
  explanation: ExplanationStep[];
  missingInfo: string[];
  warnings: string[];
  nextReviewDate: ISODate;
  liquidCents: Cents;
  emergencyCents: Cents;
  floorCents: Cents;
  minProjectedCents: Cents;
  /** How far the projection (with no saving) falls below the reserve. */
  reserveGapCents: Cents;
  /** How far it falls below zero: obligations at risk of being missed. */
  shortfallCents: Cents;
  projection: ProjectionDay[];
  projectionAfter: ProjectionDay[];
  spend: SpendEstimate;
  excludedIncome: ExcludedIncome[];
  countedIncomeCents: Cents;
  fullIncomeCents: Cents;
  confirmedIncomeCents: Cents;
  monthlyEssentialCents: Cents;
  coverageMonths: number;
  goal: ActiveGoal;
  share: number;
  /** Safe maximum minus the recommendation: kept in spending money as a buffer against forecast errors. */
  cushionCents: Cents;
  paused: boolean;
}


export function computeRecommendation(state: AppState, today: ISODate = todaySG(), overrides: Partial<Settings> = {}): Recommendation {
  const settings = { ...state.settings, ...overrides };
  // Country configuration supplies currency and rounding; the rule itself is identical everywhere.
  const market = marketFor(state.marketCode);
  const currency = market.currency;
  const fmt = (c: Cents, o?: FormatOptions) => formatMoney(c, o, currency);
  const MIN_ACTIONABLE = minor(market, market.rounding.minActionableMajor);
  const STEP = minor(market, market.rounding.stepMajor);
  const fc = buildEvents(state, today, {
    horizonDays: settings.horizonDays,
    incomeDelayDays: settings.incomeDelayDays,
    discretionaryReservePct: settings.discretionaryReservePct,
  });
  const floor = Math.max(0, settings.minCashReserveCents);
  const days = project(fc.liquidCents, fc.events, today, fc.horizonEnd);
  const safe = maxSafeContribution(days, floor);
  const monthlyEss = monthlyEssentialCents(state, fc.spend.dailyEssentialCents);
  const goal = activeGoal(state, fc.emergencyCents, monthlyEss);

  const incomeEvents = fc.events.filter((e) => e.kind === 'income');
  const countedIncome = incomeEvents.reduce((t, e) => t + e.amountCents, 0);
  const confirmedIncome = incomeEvents.filter((e) => e.certainty === 'confirmed').reduce((t, e) => t + e.amountCents, 0);
  const fullIncome = incomeEvents.reduce((t, e) => t + e.fullAmountCents, 0) + fc.excludedIncome.filter((x) => x.reason.startsWith('Uncertain')).reduce((t, x) => t + x.amountCents, 0);

  // Missing information
  const spendingAccounts = state.accounts.filter((a) => a.role === 'spending');
  const missingInfo: string[] = [];
  if (spendingAccounts.length === 0) missingInfo.push('Add at least one bank, e-wallet or cash balance you spend from.');
  if (state.incomeSources.length === 0) missingInfo.push('Add your income, even if it is irregular, so upcoming pay can be planned for.');
  if (fc.spend.source === 'estimated' && fc.spend.dailyEssentialCents === 0)
    missingInfo.push('Add or import a few weeks of transactions so everyday spending can be estimated.');
  if (state.bills.length === 0) missingInfo.push('Add regular bills such as rent, phone and utilities so they can be protected.');
  const insufficient =
    spendingAccounts.length === 0 ||
    (state.incomeSources.length === 0 && state.bills.length === 0 && fc.spend.txnCount < 5) ||
    (fc.spend.source === 'estimated' && fc.spend.dailyEssentialCents === 0 && state.bills.length === 0);

  // Confidence
  const confidenceReasons: string[] = [];
  const weighted = state.incomeSources.filter((s) => s.netAmountCents > 0);
  const totalW = weighted.reduce((t, s) => t + s.netAmountCents, 0);
  const avgVar = totalW > 0 ? weighted.reduce((t, s) => t + s.netAmountCents * (s.certainty === 'uncertain' ? 0.6 : s.variability), 0) / totalW : 0;
  const confirmedShare = fullIncome > 0 ? confirmedIncome / fullIncome : 0;
  let score = 3;
  if (fullIncome === 0) {
    score -= 2;
    confidenceReasons.push('No income is expected in the planning window.');
  } else if (confirmedShare < 0.5) {
    score -= 1;
    confidenceReasons.push(confirmedShare === 0 ? 'None of the expected income is confirmed yet.' : `Only ${Math.round(confirmedShare * 100)}% of expected income is confirmed.`);
  } else {
    confidenceReasons.push(`${Math.round(confirmedShare * 100)}% of expected income is confirmed.`);
  }
  if (avgVar >= 0.25) {
    score -= 1;
    confidenceReasons.push('Income varies a lot from payment to payment.');
  }
  if (fc.spend.source === 'estimated') {
    score -= 1;
    confidenceReasons.push('Everyday spending is estimated, not measured from transactions.');
  } else {
    confidenceReasons.push(fc.spend.reason);
  }
  if (fc.warnings.length) score -= 1;
  const confidence: Confidence = score >= 3 ? 'high' : score >= 2 ? 'medium' : 'low';
  const share = confidence === 'high' ? 0.8 : confidence === 'medium' ? 0.6 : 0.5;

  const paused = !!settings.pauseUntil && settings.pauseUntil >= today;
  const withdrawalRecent = state.contributions.some((c) => c.kind === 'withdrawal' && diffDays(c.date, today) <= 90);
  const rebuilding = withdrawalRecent && fc.emergencyCents < state.peakEmergencyCents;

  // Recommendation
  let recommended = 0;
  let shareAmount = 0;
  if (!insufficient && !paused && safe.maxSafeCents >= MIN_ACTIONABLE) {
    recommended = Math.max(STEP, roundDownTo(Math.floor(safe.maxSafeCents * share), STEP));
    shareAmount = recommended;
    // Milestones on the auto ladder are progress markers, not caps. A goal the
    // user picked explicitly (or the top of the ladder) does cap saving.
    if (state.goal.selected !== 'auto' || goal.reachedAll) recommended = Math.min(recommended, goal.remainingCents);
    if (state.goal.weeklyTargetCents > 0) recommended = Math.min(recommended, state.goal.weeklyTargetCents);
    recommended = Math.min(recommended, safe.maxSafeCents);
  }

  let status: SaveStatus;
  if (insufficient) status = 'insufficient';
  else if (paused || safe.maxSafeCents < MIN_ACTIONABLE) status = 'pause';
  else if (rebuilding && recommended > 0) status = 'rebuild';
  else if (state.goal.weeklyTargetCents > 0 && recommended < state.goal.weeklyTargetCents) status = 'reduce';
  else if (confidence !== 'high' || safe.maxSafeCents < fc.spend.dailyEssentialCents * 7) status = 'cautious';
  else status = 'safe';

  // Limiting factor
  const nextIncome = incomeEvents.find((e) => e.date > today);
  // The cushion is only the part held back for uncertainty, not a cap the user chose.
  const cushion = recommended > 0 && recommended === shareAmount ? Math.max(0, safe.maxSafeCents - recommended) : 0;
  // Next check-in: the next payday if it is within a week (or whenever savings are paused), else a week from now.
  const nextReviewFor = (): ISODate =>
    status === 'pause' && nextIncome ? nextIncome.date : nextIncome && diffDays(today, nextIncome.date) <= 7 ? nextIncome.date : addDays(today, 7);
  let limitingFactor: Recommendation['limitingFactor'] = null;
  if (safe.limitingDay) {
    const ld = safe.limitingDay;
    const before = fc.events.filter((e) => e.date <= ld.date && e.protected && (e.kind === 'bill' || e.kind === 'health'));
    const biggest = before.sort((a, b) => a.amountCents - b.amountCents)[0];
    const incomeAfter = incomeEvents.find((e) => e.date > ld.date);
    if (ld.index === days.length - 1 && !biggest) {
      limitingFactor = { date: ld.date, text: 'Your cash stays above your reserve for the whole planning period. The lowest point is at the end.' };
    } else if (biggest) {
      limitingFactor = {
        date: ld.date,
        text:
          `Cash is lowest on ${formatDate(ld.date)} (${fmt(safe.minClosingCents)}), ` +
          (incomeAfter ? `just before counted income on ${formatDate(incomeAfter.date)}. ` : 'with no counted income after it in this period. ') +
          `The biggest payment before then is ${biggest.label} (${fmt(-biggest.amountCents)}, due ${formatDate(biggest.date)}).`,
      };
    } else {
      limitingFactor = {
        date: ld.date,
        text: `Everyday spending before your next counted income brings cash to its lowest point, ${fmt(safe.minClosingCents)}, on ${formatDate(ld.date)}.`,
      };
    }
  }

  // Protected obligations in the horizon
  const protectedItems: ProtectedItem[] = fc.events
    .filter((e) => e.protected && (e.kind === 'bill' || e.kind === 'health'))
    .map((e) => ({ label: e.label, date: e.date, amountCents: -e.amountCents, kind: e.kind, overdue: e.overdue, refId: e.refId }));
  const everydayTotal = fc.events.filter((e) => e.kind === 'everyday').reduce((t, e) => t - e.amountCents, 0);
  const billsTotal = protectedItems.reduce((t, i) => t + i.amountCents, 0);
  const discretionaryBills = fc.events.filter((e) => e.kind === 'bill' && !e.protected).reduce((t, e) => t - e.amountCents, 0);
  const discretionaryAllowance = fc.events.filter((e) => e.kind === 'discretionary').reduce((t, e) => t - e.amountCents, 0);
  const H = days.length;

  const reserveGap = Math.max(0, floor - safe.minClosingCents);
  const shortfall = Math.max(0, -safe.minClosingCents);

  const expectedCounted = incomeEvents.filter((e) => e.certainty === 'expected');
  const expectedFull = expectedCounted.reduce((t, e) => t + e.fullAmountCents, 0);
  const expectedCount = expectedCounted.reduce((t, e) => t + e.amountCents, 0);
  const uncertainSkipped = fc.excludedIncome.filter((x) => x.reason.startsWith('Uncertain')).reduce((t, x) => t + x.amountCents, 0);

  const explanation: ExplanationStep[] = [
    { label: 'Cash you can spend now', amountCents: fc.liquidCents, kind: 'start', detail: `${spendingAccounts.length} spending account${spendingAccounts.length === 1 ? '' : 's'}; emergency savings are kept separate.` },
    { label: `Confirmed income in the next ${H} days`, amountCents: confirmedIncome, kind: 'plus' },
    {
      label: 'Expected income, counted conservatively',
      amountCents: expectedCount,
      kind: 'plus',
      detail: expectedFull > 0 ? `${fmt(expectedFull)} expected; only ${fmt(expectedCount)} counted because the amount varies.` : 'None expected in this period.',
    },
    ...(uncertainSkipped > 0 ? [{ label: 'Uncertain income, not counted', amountCents: 0, kind: 'note' as const, detail: `${fmt(uncertainSkipped)} possible, but not relied on.` }] : []),
    { label: 'Protected bills and obligations', amountCents: -billsTotal, kind: 'minus', detail: `${protectedItems.length} payment${protectedItems.length === 1 ? '' : 's'} due by ${formatDate(fc.horizonEnd)}.` },
    {
      label: 'Everyday essentials',
      amountCents: -everydayTotal,
      kind: 'minus',
      detail: `${fmt(fc.spend.dailyEssentialCents)} a day for food, groceries and transport. ${fc.spend.reason}`,
    },
    ...(discretionaryBills + discretionaryAllowance > 0
      ? [{ label: 'Non-essential spending allowance', amountCents: -(discretionaryBills + discretionaryAllowance), kind: 'minus' as const, detail: `${settings.discretionaryReservePct}% of your usual non-essential spending, plus subscriptions.` }]
      : []),
    { label: 'Minimum cash reserve kept aside', amountCents: -floor, kind: 'minus' },
    {
      label: 'Lowest point in the plan, above your reserve',
      amountCents: safe.minClosingCents - floor,
      kind: 'result',
      detail: safe.limitingDay ? `On ${formatDate(safe.limitingDay.date)}. Saving any more than this today would push that day below your reserve.` : undefined,
    },
    { label: 'Safe maximum today', amountCents: safe.maxSafeCents, kind: 'result' },
    {
      label: 'Recommended',
      amountCents: recommended,
      kind: 'result',
      detail:
        recommended > 0
          ? `${Math.round(share * 100)}% of the safe maximum (${confidence} confidence), rounded down to ${fmt(STEP)}${(state.goal.selected !== 'auto' || goal.reachedAll) && recommended === goal.remainingCents ? ', capped at what is left of your goal' : ''}${state.goal.weeklyTargetCents > 0 && recommended === state.goal.weeklyTargetCents ? ', capped at your weekly target' : ''}.`
          : 'Nothing to set aside right now.',
    },
    ...(recommended > 0 && recommended < shareAmount
      ? [
          {
            label: 'You could save more',
            amountCents: safe.maxSafeCents - recommended,
            kind: 'note' as const,
            detail: `Your own goal or weekly target keeps today's suggestion at ${fmt(recommended)}. Anything up to the safe maximum of ${fmt(safe.maxSafeCents)} would still leave every bill covered.`,
          },
        ]
      : []),
    ...(cushion > 0
      ? [
          {
            label: 'Kept as a cushion',
            amountCents: cushion,
            kind: 'note' as const,
            detail: `Not spare money to spend. It stays in your spending money in case pay comes in lower or costs run higher than forecast. If it isn't needed, SavvyMoni will suggest saving it at your next check-in on ${formatDate(nextReviewFor())}.`,
          },
        ]
      : []),
  ];

  const assumptions = [
    `Planning horizon: ${H} days (${formatDate(today)} to ${formatDate(fc.horizonEnd)}).`,
    `Minimum cash reserve: ${fmt(floor)} is never planned away.`,
    'Confirmed income counted in full; expected income reduced by its usual variability; uncertain income not counted.',
    settings.incomeDelayDays > 0 ? `Income is assumed to arrive up to ${settings.incomeDelayDays} day(s) late.` : 'Income is assumed to arrive on its scheduled date. Overdue pay is assumed to arrive tomorrow.',
    'Overdue unpaid bills are treated as due today.',
    `Everyday essentials: ${fmt(fc.spend.dailyEssentialCents)}/day (${fc.spend.source === 'history' ? 'measured from your transactions' : 'estimated from your profile'}). Unclassified spending is treated as essential.`,
    `Non-essential spending: ${settings.discretionaryReservePct}% of the usual ${fmt(fc.spend.dailyDiscretionaryCents)}/day is kept aside.`,
    'Emergency savings are not counted as spendable cash.',
    'Balances are as entered or simulated. SavvyMoni does not move money.',
  ];

  // Messaging: never shaming.
  let headline: string;
  let message: string;
  switch (status) {
    case 'insufficient':
      headline = 'We need a bit more information';
      message = 'Add the details below and SavvyMoni will work out a safe amount. Until then, the safest recommendation is S$0.';
      break;
    case 'pause':
      if (paused) {
        headline = 'Savings are paused';
        message = `You paused contributions until ${formatDate(settings.pauseUntil!)}. Your essentials come first, and you can resume any time.`;
      } else if (shortfall > 0) {
        headline = 'Protect your essentials first';
        message = `Upcoming essentials may be ${fmt(shortfall)} more than the cash available before your next income. Saving nothing this week is the right call. Consider using emergency savings for essentials if needed.`;
      } else {
        headline = 'Hold off on saving this week';
        message = 'Your upcoming essentials use almost all of your available cash. Skipping a contribution is normal and protects your bills.';
      }
      break;
    case 'rebuild':
      headline = `Rebuild with ${fmt(recommended)}`;
      message = 'You used your emergency savings for what they are for. Small, steady top-ups will rebuild the buffer without squeezing essentials.';
      break;
    case 'reduce':
      headline = `Save ${fmt(recommended)} instead of ${fmt(state.goal.weeklyTargetCents)}`;
      message = 'Your usual target would cut into upcoming essentials this time. A smaller amount keeps you on track safely.';
      break;
    case 'cautious':
      headline = `You can safely save ${fmt(recommended)}`;
      message = 'There is room to save, with some uncertainty in your income or spending, so the recommendation stays well below the safe maximum.';
      break;
    default:
      headline = recommended > 0 ? `You can safely save ${fmt(recommended)}` : 'Goal reached';
      message =
        recommended > 0
          ? 'Your upcoming bills and everyday essentials are covered with room to spare.'
          : 'You have reached your current emergency savings goal. Choose a new milestone to keep building.';
  }

  const nextReview = nextReviewFor();

  return {
    marketCode: market.code,
    currency,
    today,
    horizonEnd: fc.horizonEnd,
    horizonDays: H,
    status,
    statusLabel: STATUS_META[status].label,
    headline,
    message,
    recommendedCents: recommended,
    maxSafeCents: insufficient ? 0 : safe.maxSafeCents,
    confidence,
    confidenceReasons,
    limitingFactor,
    protectedItems,
    protectedTotalCents: billsTotal + everydayTotal,
    assumptions,
    explanation,
    missingInfo,
    warnings: fc.warnings,
    nextReviewDate: nextReview,
    liquidCents: fc.liquidCents,
    emergencyCents: fc.emergencyCents,
    floorCents: floor,
    minProjectedCents: safe.minClosingCents,
    reserveGapCents: reserveGap,
    shortfallCents: shortfall,
    projection: days,
    projectionAfter: project(fc.liquidCents, fc.events, today, fc.horizonEnd, recommended),
    spend: fc.spend,
    excludedIncome: fc.excludedIncome,
    countedIncomeCents: countedIncome,
    fullIncomeCents: fullIncome,
    confirmedIncomeCents: confirmedIncome,
    monthlyEssentialCents: monthlyEss,
    coverageMonths: coverageMonths(fc.emergencyCents, monthlyEss),
    goal,
    share,
    cushionCents: cushion,
    paused,
  };
}
