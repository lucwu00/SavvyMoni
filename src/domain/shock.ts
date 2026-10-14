import { addDays, formatDate, type ISODate } from './dates';
import { computeRecommendation, type Recommendation } from './engine';
import { emergencyBalance } from './forecast';
import { clone, uid } from './ids';
import { formatMoney, type Cents } from './money';
import { marketFor, minor } from '../config/markets';
import type { AppState, CategoryId, FinancialShock, IncomeSource } from './types';

export interface ShockPreset {
  id: string;
  label: string;
  description: string;
  costCents: Cents;
  offsetDays: number;
  incomeLossDays: number;
  incomeKinds: Array<IncomeSource['kind']>;
  category: CategoryId;
  subcategory: string;
}

/** Illustrative emergencies for a country, from its configuration. Amounts are examples, not price quotes. */
export function presetsFor(marketCode: string | undefined): ShockPreset[] {
  const m = marketFor(marketCode);
  return m.shocks.map((p) => ({
    id: p.id,
    label: p.label,
    description: p.description,
    costCents: minor(m, p.costMajor),
    offsetDays: p.offsetDays,
    incomeLossDays: p.incomeLossDays,
    incomeKinds: p.incomeKinds,
    category: p.category,
    subcategory: p.subcategory,
  }));
}

/** Singapore presets (kept for existing callers and tests). */
export const SHOCK_PRESETS: ShockPreset[] = presetsFor('SG');

export interface ShockInput {
  presetId: string;
  label: string;
  costCents: Cents;
  offsetDays: number;
  incomeLossDays: number;
  incomeSourceIds: string[];
  category: CategoryId;
  subcategory: string;
}

export function defaultShockInput(preset: ShockPreset, state: AppState): ShockInput {
  let ids = state.incomeSources.filter((s) => preset.incomeKinds.includes(s.kind)).map((s) => s.id);
  if (preset.incomeLossDays > 0 && ids.length === 0 && state.incomeSources.length > 0) {
    const biggest = [...state.incomeSources].sort((a, b) => b.netAmountCents - a.netAmountCents)[0];
    ids = [biggest.id];
  }
  return {
    presetId: preset.id,
    label: preset.label,
    costCents: preset.costCents,
    offsetDays: preset.offsetDays,
    incomeLossDays: preset.incomeLossDays,
    incomeSourceIds: ids,
    category: preset.category,
    subcategory: preset.subcategory,
  };
}

function moveFromEmergency(state: AppState, amount: Cents, today: ISODate, note: string, shockId: string): Cents {
  let remaining = amount;
  for (const a of state.accounts) {
    if (remaining <= 0) break;
    if (a.role !== 'emergency' || a.balanceCents <= 0) continue;
    const take = Math.min(a.balanceCents, remaining);
    a.balanceCents -= take;
    remaining -= take;
  }
  const moved = amount - remaining;
  if (moved > 0) {
    const spend = state.accounts.find((a) => a.role === 'spending');
    if (spend) spend.balanceCents += moved;
    state.contributions.push({ id: uid('ctb'), date: today, amountCents: -moved, kind: 'withdrawal', note, shockId, source: 'user' });
  }
  return moved;
}

/**
 * Apply a shock to a copy of the state. The cost is recorded once, as a
 * one-off protected bill on the shock date. Emergency savings fund as much of
 * the cost as they can (moved into spending cash today), so cash flow is never
 * double counted. Income loss is recorded on the shock and removed from the
 * forecast. Optionally tops up cash from remaining savings to keep the
 * projection at the reserve during income loss.
 */
export function applyShock(state: AppState, input: ShockInput, today: ISODate, coverIncomeGap = true): { state: AppState; shock: FinancialShock } {
  const s = clone(state);
  const E = emergencyBalance(s);
  s.peakEmergencyCents = Math.max(s.peakEmergencyCents, E);
  const date = addDays(today, Math.max(0, input.offsetDays));
  const shock: FinancialShock = {
    id: uid('shock'),
    presetId: input.presetId,
    label: input.label,
    costCents: Math.max(0, input.costCents),
    date,
    incomeLossDays: Math.max(0, Math.round(input.incomeLossDays)),
    incomeSourceIds: input.incomeSourceIds,
    appliedOn: today,
    emergencyUsedCents: 0,
  };
  let used = 0;
  if (shock.costCents > 0) {
    used += moveFromEmergency(s, Math.min(shock.costCents, E), today, `Used for: ${shock.label}`, shock.id);
    s.bills.push({
      id: uid('bill'),
      name: shock.label,
      category: input.category === 'income' ? 'uncategorised' : input.category,
      subcategory: input.category === 'income' ? 'unknown' : input.subcategory,
      amountCents: shock.costCents,
      nextDue: date,
      frequency: 'once',
      priority: 'essential',
      status: 'unpaid',
      source: 'user',
      confidence: 'high',
    });
  }
  s.shocks.push(shock);
  if (coverIncomeGap) {
    const rec = computeRecommendation(s, today);
    const remainingE = emergencyBalance(s);
    if (rec.minProjectedCents < rec.floorCents && remainingE > 0) {
      const extra = Math.min(remainingE, rec.floorCents - rec.minProjectedCents);
      used += moveFromEmergency(s, extra, today, `Cover essentials during: ${shock.label}`, shock.id);
    }
  }
  shock.emergencyUsedCents = used;
  return { state: s, shock };
}

export interface ShockResult {
  before: Recommendation;
  after: Recommendation;
  afterState: AppState;
  shock: FinancialShock;
  costCents: Cents;
  emergencyBeforeCents: Cents;
  emergencyAfterCents: Cents;
  emergencyUsedCents: Cents;
  costFromCashCents: Cents;
  incomeLostCents: Cents;
  protectedObligationsCents: Cents;
  shortfallCents: Cents;
  reserveGapCents: Cents;
  remainingBufferCents: Cents;
  coverageBeforeMonths: number;
  coverageAfterMonths: number;
  strategy: string[];
}

export function simulateShock(state: AppState, input: ShockInput, today: ISODate): ShockResult {
  const before = computeRecommendation(state, today);
  const { state: afterState, shock } = applyShock(state, input, today, true);
  const after = computeRecommendation(afterState, today);
  const lostEvents = after.excludedIncome.filter((x) => x.reason === `Lost during "${shock.label}"`);
  const incomeLost = lostEvents.reduce((t, x) => t + x.amountCents, 0);
  const costFromCash = Math.max(0, shock.costCents - Math.min(shock.costCents, before.emergencyCents));

  const market = marketFor(state.marketCode);
  const formatSGD = (c: Cents) => formatMoney(c, {}, market.currency);
  const strategy: string[] = [];
  if (shock.emergencyUsedCents > 0)
    strategy.push(`Use ${formatSGD(shock.emergencyUsedCents)} of emergency savings. This is exactly what the buffer is for.`);
  if (costFromCash > 0) strategy.push(`Pay the remaining ${formatSGD(costFromCash)} from everyday cash; it is protected in your plan.`);
  if (after.shortfallCents > 0)
    strategy.push(
      `Essentials may be ${formatSGD(after.shortfallCents)} short. Ask about instalment plans with the provider, check eligibility for public assistance (for example ${market.assistanceExamples}), and avoid high-interest borrowing.`,
    );
  if (after.status === 'pause') strategy.push('Pause savings contributions until your next income arrives. Nothing is lost by pausing.');
  else strategy.push(`Restart small: ${formatSGD(after.recommendedCents)} now is still safe after the shock.`);
  if (shock.incomeLossDays > 0) strategy.push(`Review your plan when income is expected to resume, around ${formatDate(addDays(shock.date, shock.incomeLossDays))}.`);
  strategy.push('Open the Recovery Planner to see how long rebuilding could take.');

  return {
    before,
    after,
    afterState,
    shock,
    costCents: shock.costCents,
    emergencyBeforeCents: before.emergencyCents,
    emergencyAfterCents: after.emergencyCents,
    emergencyUsedCents: shock.emergencyUsedCents,
    costFromCashCents: costFromCash,
    incomeLostCents: incomeLost,
    protectedObligationsCents: after.protectedTotalCents,
    shortfallCents: after.shortfallCents,
    reserveGapCents: after.reserveGapCents,
    remainingBufferCents: after.minProjectedCents,
    coverageBeforeMonths: before.coverageMonths,
    coverageAfterMonths: after.coverageMonths,
    strategy,
  };
}
