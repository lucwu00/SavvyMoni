/**
 * Read-only tools the AI assistant can call to look at the user's live data.
 *
 * Every tool reads the CURRENT app state at the moment it is called and
 * answers from SavvyMoni's own deterministic engine, so the assistant never
 * needs to estimate a balance or a safe amount itself. Simulations run on a
 * copy of the state: no tool can change the user's records.
 *
 * Results are small plain objects with money already formatted in the
 * country's currency.
 */
import { marketFor, minor, type MarketConfig } from '../config/markets';
import { categoryLabel, ESSENTIALITY_LABELS } from '../domain/categories';
import { addDays, type ISODate } from '../domain/dates';
import { computeRecommendation, type Recommendation } from '../domain/engine';
import { clone } from '../domain/ids';
import { formatMoney, type Cents } from '../domain/money';
import { FREQUENCY_LABELS } from '../domain/recurrence';
import { planRecovery } from '../domain/recovery';
import { defaultShockInput, presetsFor, simulateShock, type ShockInput } from '../domain/shock';
import { spendByCategory } from '../domain/spending';
import { describeCoverage } from '../domain/goals';
import type { AppState, CategoryId } from '../domain/types';

export interface ToolContext {
  state: AppState;
  today: ISODate;
}

export interface AssistantTool {
  name: string;
  description: string;
  inputSchema: { type: 'object'; properties: Record<string, unknown>; required?: string[] };
  /** Short label shown to the user while the tool runs ("Reading your bills"). */
  label: string;
  run(input: Record<string, unknown>, ctx: ToolContext): unknown;
}

const num = (v: unknown, fallback: number, min: number, max: number) => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};
const str = (v: unknown, max = 60) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const isoOrNull = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);

function fmt(m: MarketConfig) {
  return (c: Cents) => formatMoney(c, {}, m.currency);
}

function planSummary(rec: Recommendation, state: AppState, m: MarketConfig) {
  const f = fmt(m);
  return {
    safe_to_save_now: f(rec.recommendedCents),
    maximum_safe_amount: f(rec.maxSafeCents),
    status: rec.statusLabel,
    headline: rec.headline,
    message: rec.message,
    confidence: rec.confidence,
    confidence_reasons: rec.confidenceReasons,
    planning_window: `${rec.today} to ${rec.horizonEnd} (${rec.horizonDays} days)`,
    spending_money_now: f(rec.liquidCents),
    emergency_savings_now: f(rec.emergencyCents),
    cash_reserve_kept: f(rec.floorCents),
    lowest_projected_balance: f(rec.minProjectedCents),
    limiting_factor: rec.limitingFactor?.text ?? null,
    shortfall_on_essentials: rec.shortfallCents > 0 ? f(rec.shortfallCents) : null,
    protected_payments_total: f(rec.protectedTotalCents),
    monthly_essentials: f(rec.monthlyEssentialCents),
    emergency_cover: describeCoverage(rec.coverageMonths),
    current_goal: `${rec.goal.milestone.label}: ${f(rec.goal.milestone.targetCents)}, ${Math.round(rec.goal.progress * 100)}% reached, ${f(rec.goal.remainingCents)} to go`,
    everyday_spending_estimate: `${f(rec.spend.dailyEssentialCents)} essential + ${f(rec.spend.dailyDiscretionaryCents)} discretionary per day (${rec.spend.reason})`,
    how_it_was_calculated: rec.explanation.map((e) => (e.amountCents === null ? e.label : `${e.label}: ${f(e.amountCents)}${e.detail ? ` (${e.detail})` : ''}`)),
    missing_information: rec.missingInfo,
    warnings: rec.warnings,
    savings_paused_by_user: rec.paused,
    next_review: rec.nextReviewDate,
    user_name: state.profile.displayName || null,
  };
}

/** Build the tool list for one country (amount units differ by currency). */
export function buildTools(marketCode: string): AssistantTool[] {
  const m = marketFor(marketCode);
  const cur = m.currency.code;
  const presets = presetsFor(marketCode);
  return [
    {
      name: 'get_plan_summary',
      label: 'Checking your safe-to-save plan',
      description:
        "The user's current SavvyMoni plan from the deterministic engine: today's safe-to-save amount, status, balances, cash reserve, lowest projected balance, what limits the amount, goal progress, emergency cover and the step-by-step calculation. Call this first for any question about saving.",
      inputSchema: { type: 'object', properties: {} },
      run: (_i, { state, today }) => planSummary(computeRecommendation(state, today), state, m),
    },
    {
      name: 'get_accounts',
      label: 'Reading your balances',
      description: 'Every account, e-wallet and cash box with its current balance, whether it is everyday spending money or emergency savings, and when the balance was last updated.',
      inputSchema: { type: 'object', properties: {} },
      run: (_i, { state }) => {
        const f = fmt(m);
        return state.accounts.map((a) => ({ name: a.name, type: a.kind, role: a.role === 'emergency' ? 'emergency savings' : 'everyday spending', balance: f(a.balanceCents), as_of: a.asOf, source: a.source }));
      },
    },
    {
      name: 'get_income',
      label: 'Reading your income',
      description:
        'Regular income sources (take-home amount per payment, how often, next date, certainty) and how much of each the plan counts in the planning window. Uncertain income is not counted; variable income is counted cautiously.',
      inputSchema: { type: 'object', properties: {} },
      run: (_i, { state, today }) => {
        const f = fmt(m);
        const rec = computeRecommendation(state, today);
        return {
          sources: state.incomeSources.map((i) => ({
            name: i.name,
            type: i.kind,
            amount_per_payment: f(i.netAmountCents),
            frequency: FREQUENCY_LABELS[i.frequency],
            next_date: i.nextDate,
            certainty: i.certainty,
            typical_swing: `${Math.round(i.variability * 100)}%`,
          })),
          counted_in_window: f(rec.countedIncomeCents),
          full_expected_in_window: f(rec.fullIncomeCents),
          not_counted: rec.excludedIncome.slice(0, 15).map((x) => ({ date: x.date, label: x.label, amount: f(x.amountCents), reason: x.reason })),
        };
      },
    },
    {
      name: 'get_bills',
      label: 'Reading your bills',
      description: 'Regular bills (amount, frequency, next due date, priority, auto-debit) and every protected payment falling due in the planning window, including overdue ones.',
      inputSchema: { type: 'object', properties: {} },
      run: (_i, { state, today }) => {
        const f = fmt(m);
        const rec = computeRecommendation(state, today);
        return {
          bills: state.bills
            .filter((b) => b.status === 'unpaid')
            .map((b) => ({ name: b.name, category: categoryLabel(b.category), amount: f(b.amountCents), frequency: FREQUENCY_LABELS[b.frequency], next_due: b.nextDue, priority: ESSENTIALITY_LABELS[b.priority], auto_debit: !!b.autoDebit })),
          protected_in_window: rec.protectedItems.slice(0, 40).map((p) => ({ date: p.date, label: p.label, amount: f(p.amountCents), overdue: !!p.overdue })),
          protected_total: f(rec.protectedTotalCents),
        };
      },
    },
    {
      name: 'find_transactions',
      label: 'Searching your transactions',
      description:
        'Search the transaction history. Filter by date range (YYYY-MM-DD), category, text in the description, or direction. Returns matching rows (newest first, up to `limit`), how many matched and their total. Use for questions about specific payments or merchants.',
      inputSchema: {
        type: 'object',
        properties: {
          from: { type: 'string', description: 'Start date YYYY-MM-DD (inclusive). Default: 30 days ago.' },
          to: { type: 'string', description: 'End date YYYY-MM-DD (inclusive). Default: today.' },
          category: { type: 'string', enum: ['housing', 'groceries', 'food', 'transport', 'healthcare', 'utilities', 'family', 'financial', 'lifestyle', 'business', 'income', 'transfer', 'uncategorised'] },
          search: { type: 'string', description: 'Case-insensitive text to find in the description or merchant.' },
          direction: { type: 'string', enum: ['in', 'out', 'any'] },
          limit: { type: 'number', description: 'Rows to return, 1-60. Default 25.' },
        },
      },
      run: (input, { state, today }) => {
        const f = fmt(m);
        const from = isoOrNull(input.from) ?? addDays(today, -30);
        const to = isoOrNull(input.to) ?? today;
        const cat = str(input.category, 20) as CategoryId | '';
        const q = str(input.search).toLowerCase();
        const dir = str(input.direction, 4);
        const limit = Math.round(num(input.limit, 25, 1, 60));
        const rows = state.transactions.filter(
          (t) =>
            t.date >= from &&
            t.date <= to &&
            (!cat || t.category === cat || t.lines?.some((l) => l.category === cat)) &&
            (!q || t.merchant.toLowerCase().includes(q) || t.description.toLowerCase().includes(q)) &&
            (dir === 'in' ? t.amountCents > 0 : dir === 'out' ? t.amountCents < 0 : true),
        );
        const total = rows.reduce((s, t) => s + t.amountCents, 0);
        return {
          range: `${from} to ${to}`,
          matched: rows.length,
          total_signed: f(total),
          note: 'Negative amounts are money out.',
          rows: rows.slice(0, limit).map((t) => ({
            date: t.date,
            description: t.merchant,
            amount: f(t.amountCents),
            category: categoryLabel(t.category),
            kind: ESSENTIALITY_LABELS[t.essentiality],
            ...(t.lines?.length ? { split: t.lines.map((l) => `${l.label} ${f(-Math.abs(l.amountCents))}`) } : {}),
          })),
          more: Math.max(0, rows.length - limit),
        };
      },
    },
    {
      name: 'get_spending_summary',
      label: 'Adding up your spending',
      description:
        'Spending totals by category for a period, split into essential and discretionary, plus weekly totals and the daily average. Bills paid in the period are included. Default period: the last 28 days.',
      inputSchema: {
        type: 'object',
        properties: {
          days: { type: 'number', description: 'Look back this many days (7-180). Ignored if from/to given.' },
          from: { type: 'string', description: 'Start date YYYY-MM-DD.' },
          to: { type: 'string', description: 'End date YYYY-MM-DD (inclusive).' },
        },
      },
      run: (input, { state, today }) => {
        const f = fmt(m);
        const days = Math.round(num(input.days, 28, 7, 180));
        const toIncl = isoOrNull(input.to) ?? addDays(today, -1);
        const from = isoOrNull(input.from) ?? addDays(today, -days);
        const toExcl = addDays(toIncl, 1);
        const cats = spendByCategory(state.transactions, from, toExcl);
        const total = cats.reduce((s, c) => s + c.totalCents, 0);
        const ess = cats.reduce((s, c) => s + c.essentialCents, 0);
        const span = Math.max(1, Math.round((Date.parse(toExcl) - Date.parse(from)) / 86_400_000));
        const weeks: Array<{ week_from: string; spent: string }> = [];
        for (let d = from; d < toExcl; d = addDays(d, 7)) {
          const end = addDays(d, 7) < toExcl ? addDays(d, 7) : toExcl;
          weeks.push({ week_from: d, spent: f(spendByCategory(state.transactions, d, end).reduce((s, c) => s + c.totalCents, 0)) });
        }
        const income = state.transactions.filter((t) => t.date >= from && t.date < toExcl && t.amountCents > 0 && t.category === 'income').reduce((s, t) => s + t.amountCents, 0);
        return {
          period: `${from} to ${toIncl} (${span} days)`,
          total_spent: f(total),
          essential: f(ess),
          discretionary: f(total - ess),
          daily_average: f(Math.round(total / span)),
          income_received: f(income),
          by_category: cats.map((c) => ({ category: categoryLabel(c.category), total: f(c.totalCents), essential: f(c.essentialCents), discretionary: f(c.discretionaryCents) })),
          by_week: weeks.slice(0, 26),
        };
      },
    },
    {
      name: 'get_cash_projection',
      label: 'Projecting your cash',
      description:
        "Day-by-day projection of everyday cash with no new saving: the closing balance on each day that has income or a bill, the lowest point and its date. Shows when money gets tight.",
      inputSchema: { type: 'object', properties: { days: { type: 'number', description: 'Days ahead, 7-35. Default: the full planning window.' } } },
      run: (input, { state, today }) => {
        const f = fmt(m);
        const rec = computeRecommendation(state, today);
        const n = Math.round(num(input.days, rec.projection.length, 1, rec.projection.length));
        const days = rec.projection.slice(0, n);
        const low = days.reduce((a, d) => (d.closingCents < a.closingCents ? d : a), days[0]);
        return {
          start_balance: f(rec.liquidCents),
          reserve_kept: f(rec.floorCents),
          lowest: low ? { date: low.date, balance: f(low.closingCents) } : null,
          days: days
            .filter((d) => d.events.some((e) => e.kind === 'income' || e.kind === 'bill' || e.kind === 'health') || d === low)
            .slice(0, 40)
            .map((d) => ({
              date: d.date,
              closing: f(d.closingCents),
              events: d.events.filter((e) => e.kind === 'income' || e.kind === 'bill' || e.kind === 'health').map((e) => `${e.label} ${f(e.amountCents)}`),
            })),
          everyday_spending_per_day: f(rec.spend.dailyEssentialCents + rec.spend.dailyDiscretionaryCents),
        };
      },
    },
    {
      name: 'simulate_emergency',
      label: 'Simulating an emergency',
      description: `What-if only, nothing is saved: an unexpected cost and/or lost income, run through the same engine. Returns emergency savings used, the safe amount before and after, any shortfall on essentials, and suggested steps. Amounts in ${cur}. Example presets (id: label, cost): ${presets.map((p) => `${p.id}: ${p.label}, ${formatMoney(p.costCents, {}, m.currency)}`).join('; ')}.`,
      inputSchema: {
        type: 'object',
        properties: {
          preset_id: { type: 'string', description: 'Optional preset id from the list.' },
          cost: { type: 'number', description: `Cost in ${cur} (major units). Overrides the preset cost.` },
          days_from_now: { type: 'number', description: 'When the cost is due, 0-30 days. Default 0.' },
          income_loss_days: { type: 'number', description: 'Days of income lost, 0-90. Default 0 (or the preset value).' },
          label: { type: 'string' },
        },
      },
      run: (input, { state, today }) => {
        const f = fmt(m);
        const preset = presets.find((p) => p.id === str(input.preset_id, 40));
        const base: ShockInput = preset
          ? defaultShockInput(preset, state)
          : { presetId: 'custom', label: 'Unexpected cost', costCents: 0, offsetDays: 0, incomeLossDays: 0, incomeSourceIds: [], category: 'uncategorised', subcategory: 'unknown' };
        const costMajor = num(input.cost, NaN, 0, m.maxImportMajor);
        const lossDays = Math.round(num(input.income_loss_days, base.incomeLossDays, 0, 90));
        const shock: ShockInput = {
          ...base,
          label: str(input.label, 60) || base.label,
          costCents: Number.isFinite(costMajor) ? minor(m, costMajor) : base.costCents,
          offsetDays: Math.round(num(input.days_from_now, base.offsetDays, 0, 30)),
          incomeLossDays: lossDays,
          incomeSourceIds:
            lossDays > 0 && base.incomeSourceIds.length === 0 && state.incomeSources.length
              ? [[...state.incomeSources].sort((a, b) => b.netAmountCents - a.netAmountCents)[0].id]
              : base.incomeSourceIds,
        };
        if (shock.costCents <= 0 && shock.incomeLossDays <= 0) throw new Error('Give a cost or some days of lost income.');
        const r = simulateShock(state, shock, today);
        return {
          scenario: `${shock.label}: ${f(shock.costCents)} due ${addDays(today, shock.offsetDays)}${shock.incomeLossDays ? `, ${shock.incomeLossDays} days of income lost (${f(r.incomeLostCents)})` : ''}`,
          emergency_savings_before: f(r.emergencyBeforeCents),
          emergency_savings_used: f(r.emergencyUsedCents),
          emergency_savings_after: f(r.emergencyAfterCents),
          paid_from_everyday_cash: f(r.costFromCashCents),
          shortfall_on_essentials: r.shortfallCents > 0 ? f(r.shortfallCents) : 'none',
          safe_to_save_before: f(r.before.recommendedCents),
          safe_to_save_after: f(r.after.recommendedCents),
          status_after: r.after.statusLabel,
          cover_before: describeCoverage(r.coverageBeforeMonths),
          cover_after: describeCoverage(r.coverageAfterMonths),
          suggested_steps: r.strategy,
          note: 'Simulation only. Nothing was changed. The user can apply it on the Emergency simulator page.',
        };
      },
    },
    {
      name: 'simulate_change',
      label: 'Testing a what-if',
      description: `What-if only, nothing is saved: re-run the plan with income scaled (e.g. 0.7 = 30% less), an extra one-off cost, or a different cash reserve. Returns the safe amount and status before and after. Amounts in ${cur}.`,
      inputSchema: {
        type: 'object',
        properties: {
          income_multiplier: { type: 'number', description: '0-2. Scales every income source. Default 1.' },
          extra_cost: { type: 'number', description: `One-off extra cost in ${cur}.` },
          extra_cost_in_days: { type: 'number', description: 'When the extra cost is due, 0-30. Default 0.' },
          cash_reserve: { type: 'number', description: `Cash reserve to keep, in ${cur}.` },
        },
      },
      run: (input, { state, today }) => {
        const f = fmt(m);
        const before = computeRecommendation(state, today);
        const s = clone(state);
        const k = num(input.income_multiplier, 1, 0, 2);
        s.incomeSources = s.incomeSources.map((i) => ({ ...i, netAmountCents: Math.round(i.netAmountCents * k) }));
        const extra = num(input.extra_cost, 0, 0, m.maxImportMajor);
        if (extra > 0)
          s.bills.push({
            id: 'whatif',
            name: 'Extra cost (what-if)',
            category: 'uncategorised',
            subcategory: 'unknown',
            amountCents: minor(m, extra),
            nextDue: addDays(today, Math.round(num(input.extra_cost_in_days, 0, 0, 30))),
            frequency: 'once',
            priority: 'essential',
            status: 'unpaid',
            source: 'estimated',
            confidence: 'medium',
          });
        const reserve = num(input.cash_reserve, NaN, 0, m.maxImportMajor);
        const after = computeRecommendation(s, today, Number.isFinite(reserve) ? { minCashReserveCents: minor(m, reserve) } : {});
        return {
          before: { safe_to_save: f(before.recommendedCents), maximum_safe: f(before.maxSafeCents), status: before.statusLabel, lowest_balance: f(before.minProjectedCents) },
          after: { safe_to_save: f(after.recommendedCents), maximum_safe: f(after.maxSafeCents), status: after.statusLabel, lowest_balance: f(after.minProjectedCents), limiting_factor: after.limitingFactor?.text ?? null },
          note: 'Simulation only. Nothing was changed.',
        };
      },
    },
    {
      name: 'plan_rebuild',
      label: 'Planning how to rebuild savings',
      description: `Rebuilding schedules for emergency savings (conservative, balanced, optimistic): weekly amount, weeks to reach the target and the risk. Target defaults to the current goal. Amounts in ${cur}.`,
      inputSchema: {
        type: 'object',
        properties: { target: { type: 'number', description: `Target emergency savings in ${cur}.` }, pause_weeks: { type: 'number', description: 'Weeks to pause before starting, 0-12.' } },
      },
      run: (input, { state, today }) => {
        const f = fmt(m);
        const rec = computeRecommendation(state, today);
        const t = num(input.target, NaN, 0, m.maxImportMajor * 10);
        const r = planRecovery(state, rec, { targetCents: Number.isFinite(t) ? minor(m, t) : rec.goal.milestone.targetCents, pauseWeeks: Math.round(num(input.pause_weeks, 0, 0, 12)) });
        return {
          current: f(r.currentCents),
          target: f(r.targetCents),
          gap: f(r.gapCents),
          risk: r.risk,
          risk_reasons: r.riskReasons,
          scenarios: r.scenarios.map((s) => ({ name: s.label, weekly: f(s.weeklyCents), first_week: f(s.firstWeekCents), weeks_to_target: s.weeksToTarget, reach_date: s.reachDate })),
          note: 'Estimates under stated assumptions, not promises.',
        };
      },
    },
  ];
}

/** A compact snapshot for chat surfaces that cannot run tools. */
export function dataSnapshot(ctx: ToolContext): string {
  const tools = buildTools(ctx.state.marketCode);
  const pick = (n: string, input: Record<string, unknown> = {}) => {
    try {
      return tools.find((t) => t.name === n)!.run(input, ctx);
    } catch {
      return null;
    }
  };
  return JSON.stringify({
    plan: pick('get_plan_summary'),
    accounts: pick('get_accounts'),
    income: pick('get_income'),
    bills: pick('get_bills'),
    spending_last_28_days: pick('get_spending_summary'),
    recent_transactions: pick('find_transactions', { limit: 40 }),
  });
}
