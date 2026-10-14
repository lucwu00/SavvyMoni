import { useMemo, useState } from 'react';
import { LuArrowRight, LuZap } from 'react-icons/lu';
import { addDays, formatDate } from '../domain/dates';
import { describeCoverage } from '../domain/goals';
import { formatMoney } from '../domain/money';
import { defaultShockInput, presetsFor, simulateShock, type ShockInput } from '../domain/shock';
import { useNavigate, useStore } from '../state/store';
import { LineChart } from '../ui/charts';
import { Callout, Card, CardHead, ConfirmButton, Field, Money, MoneyInput, PageHead, Pill, Stat, StatusPill } from '../ui/components';

export function Simulator() {
  const { state, today, dispatch, notify } = useStore();
  const go = useNavigate();
  const presets = presetsFor(state.marketCode);
  const defaultPreset = state.marketCode === 'SG' && state.incomeSources.some((s) => s.kind === 'gig') ? 'vehicle' : presets[0].id;
  const [input, setInput] = useState<ShockInput>(() => defaultShockInput(presets.find((p) => p.id === defaultPreset) ?? presets[0], state));
  const r = useMemo(() => simulateShock(state, input, today), [state, input, today]);
  const shockIndex = r.after.projection.findIndex((d) => d.date === r.shock.date);

  return (
    <div className="page">
      <PageHead title="Emergency simulator" sub="Try a realistic local emergency and see exactly what it would do to your cash, savings and plan. Nothing changes until you apply it." right={<Pill tone="info">Simulation</Pill>} />

      <Card>
        <CardHead title="Choose an emergency" sub="Amounts are illustrative examples. Adjust them to your situation." />
        <div className="ladder" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))' }}>
          {presets.map((p) => (
            <button key={p.id} className="rung" aria-pressed={input.presetId === p.id} data-testid={`preset-${p.id}`} onClick={() => setInput(defaultShockInput(p, state))}>
              <span className="small" style={{ fontWeight: 650 }}>
                {p.label}
              </span>
              <span className="xsmall muted">{p.description}</span>
              <span className="num small">
                {p.costCents ? formatMoney(p.costCents) : ''}
                {p.costCents && p.incomeLossDays ? ' + ' : ''}
                {p.incomeLossDays ? `${p.incomeLossDays} days' pay` : ''}
              </span>
            </button>
          ))}
        </div>
        <div className="form-grid" style={{ marginTop: 16 }}>
          <Field label="Cost">
            <MoneyInput value={input.costCents} onChange={(c) => setInput({ ...input, costCents: c })} testId="shock-cost" />
          </Field>
          <Field label={`Happens in ${input.offsetDays} day${input.offsetDays === 1 ? '' : 's'} (${formatDate(addDays(today, input.offsetDays))})`}>
            <input type="range" min={0} max={30} value={input.offsetDays} onChange={(e) => setInput({ ...input, offsetDays: Number(e.target.value) })} />
          </Field>
          <Field label={`Days without pay: ${input.incomeLossDays}`}>
            <input type="range" min={0} max={60} value={input.incomeLossDays} onChange={(e) => setInput({ ...input, incomeLossDays: Number(e.target.value) })} />
          </Field>
        </div>
        {input.incomeLossDays > 0 ? (
          <div className="row" style={{ marginTop: 10 }}>
            <span className="small ink2">Income affected:</span>
            {state.incomeSources.map((s) => (
              <label key={s.id} className="check">
                <input
                  type="checkbox"
                  checked={input.incomeSourceIds.includes(s.id)}
                  onChange={(e) => setInput({ ...input, incomeSourceIds: e.target.checked ? [...input.incomeSourceIds, s.id] : input.incomeSourceIds.filter((x) => x !== s.id) })}
                />
                {s.name}
              </label>
            ))}
          </div>
        ) : null}
      </Card>

      <div className="grid grid-4" data-testid="shock-results">
        <Card>
          <Stat label="Emergency cost" value={<Money cents={r.costCents} />} sub={r.incomeLostCents ? `+ ${formatMoney(r.incomeLostCents)} pay lost` : 'No pay lost'} />
        </Card>
        <Card>
          <Stat label="Covered by savings" value={<Money cents={r.emergencyUsedCents} />} sub={`${formatMoney(r.emergencyAfterCents)} left of ${formatMoney(r.emergencyBeforeCents)}`} />
        </Card>
        <Card>
          <Stat label="From everyday cash" value={<Money cents={r.costFromCashCents} />} sub="Already protected in the plan" />
        </Card>
        <Card>
          <Stat
            label={r.shortfallCents > 0 ? 'Shortfall on essentials' : 'Lowest cash buffer'}
            value={<span style={{ color: r.shortfallCents > 0 ? 'var(--critical)' : undefined }}>{formatMoney(r.shortfallCents > 0 ? r.shortfallCents : r.remainingBufferCents)}</span>}
            sub={r.shortfallCents > 0 ? 'Essentials at risk' : `Reserve ${formatMoney(r.after.floorCents)}`}
          />
        </Card>
      </div>

      <div className="grid grid-3">
        <Card className="span-2">
          <CardHead title="Before and after" sub="Projected spendable cash. Emergency savings that cover the cost are moved into cash, so nothing is counted twice." />
          <LineChart
            ariaLabel="Cash before and after the emergency"
            labels={r.after.projection.map((d) => formatDate(d.date))}
            series={[
              { name: 'Before', color: 'var(--series-1)', values: r.before.projection.map((d) => d.closingCents) },
              { name: 'After the emergency', color: 'var(--series-2)', values: r.after.projection.map((d) => d.closingCents), area: true },
            ]}
            reference={{ value: r.after.floorCents, label: 'Reserve' }}
            markers={shockIndex >= 0 ? [{ index: shockIndex, label: input.label }] : []}
          />
        </Card>
        <Card>
          <CardHead title="Your position" />
          <table className="table">
            <thead>
              <tr>
                <th />
                <th className="r">Before</th>
                <th className="r">After</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Emergency savings</td>
                <td className="r num">{formatMoney(r.emergencyBeforeCents)}</td>
                <td className="r num">{formatMoney(r.emergencyAfterCents)}</td>
              </tr>
              <tr>
                <td>Essentials covered</td>
                <td className="r">{describeCoverage(r.coverageBeforeMonths)}</td>
                <td className="r">{describeCoverage(r.coverageAfterMonths)}</td>
              </tr>
              <tr>
                <td>Protected obligations</td>
                <td className="r num">{formatMoney(r.before.protectedTotalCents)}</td>
                <td className="r num">{formatMoney(r.protectedObligationsCents)}</td>
              </tr>
              <tr>
                <td>Safe to save</td>
                <td className="r num">{formatMoney(r.before.recommendedCents)}</td>
                <td className="r num" data-testid="shock-after-rec">
                  {formatMoney(r.after.recommendedCents)}
                </td>
              </tr>
            </tbody>
          </table>
          <div className="row" style={{ marginTop: 10 }}>
            <StatusPill status={r.after.status} />
          </div>
        </Card>
      </div>

      <Card>
        <CardHead title="Recovery strategy" sub="What SavvyMoni would suggest if this happened." />
        <ol className="ink2" style={{ margin: 0, paddingLeft: 20, display: 'grid', gap: 6 }}>
          {r.strategy.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ol>
        {r.shortfallCents > 0 ? (
          <div style={{ marginTop: 12 }}>
            <Callout tone="critical">Even after using all emergency savings, essentials could be {formatMoney(r.shortfallCents)} short. SavvyMoni will never suggest high-interest borrowing to close this gap.</Callout>
          </div>
        ) : null}
        <div className="row" style={{ marginTop: 16 }}>
          <ConfirmButton
            className="btn primary"
            testId="apply-shock"
            icon={<LuZap />}
            label="Apply to my plan"
            confirmLabel={`Yes, apply "${input.label}"`}
            onConfirm={() => {
              dispatch({ type: 'APPLY_SHOCK', input });
              notify(`${input.label} applied. Your plan has been updated.`);
              go('recovery');
            }}
          />
          <button className="btn ghost" onClick={() => go('recovery')}>
            Open recovery planner <LuArrowRight />
          </button>
        </div>
        <p className="xsmall muted" style={{ marginTop: 8 }}>
          Applying records the withdrawal from emergency savings and a one-off protected bill in your records. You can delete the bill later in My finances.
        </p>
      </Card>
    </div>
  );
}
