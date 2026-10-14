import { CATEGORY_MAP } from '../domain/categories';
import { addDays, diffDays, formatDate, type ISODate } from '../domain/dates';
import type { Recommendation } from '../domain/engine';
import { spendByCategory } from '../domain/spending';
import { formatMoney as fmt } from '../domain/money';
import type { AppState, CategoryId } from '../domain/types';

/** Category colours: fixed order so a category keeps its colour everywhere. */
export const CAT_COLORS: Partial<Record<CategoryId, string>> = {
  housing: 'var(--series-1)',
  groceries: 'var(--series-3)',
  food: 'var(--series-2)',
  transport: 'var(--series-4)',
  healthcare: '#e87ba4',
  utilities: '#6250d6',
  family: '#008300',
  financial: '#e34948',
  lifestyle: 'var(--muted)',
  uncategorised: 'var(--surface-3)',
};

export type Stage = 'prepare' | 'save' | 'shock' | 'withdraw' | 'recover' | 'rebuild';
export const STAGES: Array<{ id: Stage; label: string }> = [
  { id: 'prepare', label: 'Prepare' },
  { id: 'save', label: 'Save' },
  { id: 'shock', label: 'Shock' },
  { id: 'withdraw', label: 'Withdraw' },
  { id: 'recover', label: 'Recover' },
  { id: 'rebuild', label: 'Rebuild' },
];

/** Where the user is on the emergency-to-recovery lifecycle. */
export function lifecycleStage(state: AppState, rec: Recommendation, today: ISODate): Stage {
  const recent = [...state.shocks].sort((a, b) => (a.appliedOn < b.appliedOn ? 1 : -1))[0];
  if (recent) {
    const lossEnd = addDays(recent.date, recent.incomeLossDays);
    if (recent.incomeLossDays > 0 && today >= recent.date && today < lossEnd) return 'recover';
    if (recent.date > today) return 'shock';
    if (diffDays(recent.appliedOn, today) <= 3 && recent.emergencyUsedCents > 0) return 'withdraw';
    if (rec.status === 'rebuild' || rec.emergencyCents < state.peakEmergencyCents) return 'rebuild';
  }
  if (rec.shortfallCents > 0) return 'shock';
  if (rec.coverageMonths < 0.23) return 'prepare';
  return 'save';
}

export function Lifecycle({ stage }: { stage: Stage }) {
  const idx = STAGES.findIndex((s) => s.id === stage);
  return (
    <div className="lifecycle" aria-label={`Emergency lifecycle: currently at ${STAGES[idx].label}`}>
      {STAGES.map((s, i) => (
        <div key={s.id} className={`lc-stop ${i < idx ? 'past' : i === idx ? 'now' : ''}`} aria-current={i === idx ? 'step' : undefined}>
          <span className="lc-dot" />
          {s.label}
        </div>
      ))}
    </div>
  );
}

export function spendBreakdown(state: AppState, today: ISODate, days = 28) {
  return spendByCategory(state.transactions, addDays(today, -days), today).map((r) => ({
    label: CATEGORY_MAP[r.category]?.label ?? r.category,
    category: r.category,
    segments: [
      { name: 'Essential', value: r.essentialCents, color: 'var(--brand)' },
      { name: 'Discretionary', value: r.discretionaryCents, color: 'var(--series-2)' },
    ],
  }));
}

export const shortDate = (d: ISODate) => formatDate(d);

export interface RiskItem {
  tone: 'critical' | 'serious' | 'warning' | 'info';
  text: string;
}

export function riskWarnings(state: AppState, rec: Recommendation): RiskItem[] {
  const out: RiskItem[] = [];
  if (rec.shortfallCents > 0)
    out.push({ tone: 'critical', text: `Upcoming essentials may be short by ${fmt(rec.shortfallCents)} before ${formatDate(rec.horizonEnd)}. Consider using emergency savings for essentials or asking billers about instalments.` });
  else if (rec.reserveGapCents > 0) out.push({ tone: 'serious', text: `Cash is projected to dip ${fmt(rec.reserveGapCents)} below your minimum reserve.` });
  const overdue = rec.protectedItems.filter((p) => p.overdue);
  if (overdue.length) out.push({ tone: 'serious', text: `${overdue.length} bill${overdue.length > 1 ? 's are' : ' is'} overdue: ${overdue.map((o) => o.label).join(', ')}.` });
  if (rec.coverageMonths < 0.25) out.push({ tone: 'warning', text: 'Emergency savings cover less than a week of essentials. Small, regular amounts help most here.' });
  const uncertain = rec.excludedIncome.filter((x) => x.reason.startsWith('Uncertain'));
  if (uncertain.length) out.push({ tone: 'info', text: `${uncertain.length} uncertain income payment${uncertain.length > 1 ? 's are' : ' is'} not counted until it arrives.` });
  if (rec.spend.source === 'estimated') out.push({ tone: 'info', text: 'Everyday spending is estimated. Import or add transactions for a more precise plan.' });
  if (state.incomeSources.some((s) => s.variability >= 0.3 && s.certainty !== 'confirmed')) out.push({ tone: 'info', text: 'Income varies a lot, so expected pay is counted conservatively.' });
  return out;
}

