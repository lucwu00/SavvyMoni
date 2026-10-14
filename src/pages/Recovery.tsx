import { useMemo, useState } from 'react';
import { LuCheck, LuPause } from 'react-icons/lu';
import { addDays, formatDate } from '../domain/dates';
import { formatMoney } from '../domain/money';
import { planRecovery } from '../domain/recovery';
import { useNavigate, useStore } from '../state/store';
import { LineChart } from '../ui/charts';
import { Callout, Card, CardHead, Field, Money, MoneyInput, PageHead, Pill } from '../ui/components';

const COLORS = { conservative: 'var(--series-2)', balanced: 'var(--series-1)', optimistic: 'var(--series-3)' } as const;

export function Recovery() {
  const { state, rec, dispatch, notify, today } = useStore();
  const go = useNavigate();
  const defaultTarget = state.recoveryPlan?.targetCents ?? (rec.emergencyCents < state.peakEmergencyCents ? state.peakEmergencyCents : rec.goal.milestone.targetCents);
  const [target, setTarget] = useState(defaultTarget);
  const [pauseWeeks, setPauseWeeks] = useState(state.recoveryPlan?.pauseWeeks ?? 0);
  const plan = useMemo(() => planRecovery(state, rec, { targetCents: target, pauseWeeks }), [state, rec, target, pauseWeeks]);
  const weeks = Math.min(78, Math.max(8, ...plan.scenarios.map((s) => s.weeksToTarget ?? 52)));
  const series = plan.scenarios.map((s) => {
    const vals: number[] = [plan.currentCents];
    for (let w = 1; w <= weeks; w++) vals.push(s.schedule[Math.min(w, s.schedule.length) - 1]?.balanceCents ?? plan.currentCents);
    return { name: s.label, color: COLORS[s.id], values: vals };
  });
  const labels = Array.from({ length: weeks + 1 }, (_, i) => (i === 0 ? 'Now' : `Wk ${i}`));
  const recentShocks = [...state.shocks].reverse();
  const balanced = plan.scenarios.find((s) => s.id === 'balanced')!;

  return (
    <div className="page">
      <PageHead title="Recovery planner" sub="After an emergency, rebuild at a pace your budget can sustain. These are simulations under stated assumptions, not promises." right={<Pill tone="info">Simulation</Pill>} />

      {recentShocks.length === 0 && rec.emergencyCents >= state.peakEmergencyCents ? (
        <Callout tone="neutral">
          No emergency withdrawals yet. You can still plan towards your goal below, or{' '}
          <button className="link-btn" onClick={() => go('simulator')}>
            simulate an emergency
          </button>{' '}
          first.
        </Callout>
      ) : null}

      <div className="grid grid-3">
        <Card>
          <CardHead title="Rebuild target" />
          <div className="stack">
            <div className="row-between">
              <span className="muted small">Savings now</span>
              <Money cents={plan.currentCents} className="amount" />
            </div>
            <Field label="Target" hint={state.peakEmergencyCents > rec.emergencyCents ? `Before the emergency you had ${formatMoney(state.peakEmergencyCents)}.` : `Your current milestone is ${formatMoney(rec.goal.milestone.targetCents)}.`}>
              <MoneyInput value={target} onChange={setTarget} testId="recovery-target" />
            </Field>
            <div className="row-between">
              <span className="muted small">Gap to rebuild</span>
              <strong className="num" data-testid="recovery-gap">
                {formatMoney(plan.gapCents)}
              </strong>
            </div>
            <Field label={`Pause contributions first: ${pauseWeeks} week${pauseWeeks === 1 ? '' : 's'}`} hint="Take a breather while things settle.">
              <input type="range" min={0} max={8} value={pauseWeeks} onChange={(e) => setPauseWeeks(Number(e.target.value))} />
            </Field>
          </div>
        </Card>
        <Card className="span-2">
          <CardHead
            title="Financial risk now"
            right={<Pill tone={plan.risk === 'high' ? 'critical' : plan.risk === 'moderate' ? 'warning' : 'good'}>{plan.risk === 'high' ? 'High' : plan.risk === 'moderate' ? 'Moderate' : 'Low'} risk</Pill>}
          />
          <ul className="ink2" style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 6 }}>
            {plan.riskReasons.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
          <div className="grid grid-3" style={{ marginTop: 14 }}>
            {(['conservative', 'balanced', 'optimistic'] as const).map((id) => (
              <div key={id} className="stat">
                <span className="stat-label">{id[0].toUpperCase() + id.slice(1)} monthly surplus</span>
                <span className="stat-value" style={{ fontSize: '1.1rem', color: plan.monthlySurplusCents[id] < 0 ? 'var(--critical)' : undefined }}>
                  {formatMoney(plan.monthlySurplusCents[id])}
                </span>
              </div>
            ))}
          </div>
          <p className="xsmall muted" style={{ marginTop: 8 }}>
            Monthly take-home income minus protected bills, everyday essentials and your usual non-essential spending.
          </p>
        </Card>
      </div>

      <div className="grid grid-3" data-testid="scenarios">
        {plan.scenarios.map((s) => (
          <Card key={s.id}>
            <div className="row-between">
              <h3>
                <span className="swatch box" style={{ background: COLORS[s.id], marginRight: 8 }} />
                {s.label}
              </h3>
              {s.weeksToTarget === null ? (
                <Pill tone="warning">Not reached</Pill>
              ) : s.weeksToTarget === 0 ? (
                <Pill tone="good">At target</Pill>
              ) : s.weeksToTarget === 1 ? (
                <Pill tone="neutral">Next contribution</Pill>
              ) : (
                <Pill tone="neutral">~{s.weeksToTarget} weeks</Pill>
              )}
            </div>
            <div className="stat" style={{ marginTop: 10 }}>
              <span className="stat-value">
                {formatMoney(s.weeklyCents)}
                <span className="small muted" style={{ fontWeight: 500 }}>
                  {' '}
                  / week
                </span>
              </span>
              <span className="stat-sub">
                {s.weeksToTarget === null
                  ? 'Not reachable within 3 years under these assumptions. Revisit when income changes.'
                  : s.weeksToTarget === 0
                    ? 'Already at target.'
                    : s.weeksToTarget === 1
                      ? `Reached with your next contribution of ${formatMoney(s.schedule[0]?.contributionCents ?? s.firstWeekCents)}. Not guaranteed.`
                      : `Estimated around ${formatDate(s.reachDate!, true)}. Not guaranteed.`}
              </span>
            </div>
            <ul className="xsmall muted" style={{ margin: '10px 0 0', paddingLeft: 16, display: 'grid', gap: 3 }}>
              {s.assumptions.map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ul>
          </Card>
        ))}
      </div>

      <Card>
        <CardHead title="Rebuilding schedule" sub="Emergency savings balance by week under each scenario." />
        <LineChart ariaLabel="Recovery scenarios" labels={labels} series={series} reference={{ value: target, label: `Target ${formatMoney(target)}` }} />
        <p className="small muted" style={{ marginTop: 8 }}>
          Week {pauseWeeks + 1} contribution is capped at today’s safe maximum ({formatMoney(rec.maxSafeCents)}) so bills due before your next pay stay protected.
        </p>
        <div className="row" style={{ marginTop: 12 }}>
          <button
            className="btn primary"
            data-testid="use-balanced"
            disabled={balanced.weeklyCents <= 0}
            onClick={() => {
              dispatch({ type: 'SET_RECOVERY_PLAN', targetCents: target, pauseWeeks });
              dispatch({ type: 'UPDATE_GOAL', patch: { weeklyTargetCents: balanced.weeklyCents } });
              if (pauseWeeks > 0) dispatch({ type: 'UPDATE_SETTINGS', patch: { pauseUntil: addDays(today, pauseWeeks * 7 - 1) } });
              notify(`Weekly target set to ${formatMoney(balanced.weeklyCents)}${pauseWeeks ? ` after a ${pauseWeeks}-week pause` : ''}`);
            }}
          >
            <LuCheck /> Use the balanced plan
          </button>
          <button className="btn" onClick={() => (dispatch({ type: 'UPDATE_SETTINGS', patch: { pauseUntil: addDays(today, Math.max(1, pauseWeeks) * 7 - 1) } }), notify('Contributions paused'))}>
            <LuPause /> Pause contributions {Math.max(1, pauseWeeks)} week{Math.max(1, pauseWeeks) > 1 ? 's' : ''}
          </button>
        </div>
      </Card>

      {recentShocks.length ? (
        <Card>
          <CardHead title="Emergencies recorded" />
          <div className="list">
            {recentShocks.map((s) => (
              <div key={s.id} className="list-row">
                <div className="grow">
                  <div className="title">{s.label}</div>
                  <div className="meta">
                    Happens {formatDate(s.date)} · applied {formatDate(s.appliedOn)}
                    {s.incomeLossDays ? ` · ${s.incomeLossDays} days without pay` : ''}
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div className="amount">{formatMoney(s.costCents)}</div>
                  <div className="xsmall muted">{formatMoney(s.emergencyUsedCents)} from savings</div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      ) : null}
    </div>
  );
}
