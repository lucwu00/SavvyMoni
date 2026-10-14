import { useState } from 'react';
import { LuPause, LuPlay, LuShieldCheck } from 'react-icons/lu';
import { addDays, formatDate, formatDateLong } from '../domain/dates';
import { milestones } from '../domain/goals';
import { formatMoney } from '../domain/money';
import { useStore } from '../state/store';
import { LineChart } from '../ui/charts';
import { Callout, Card, CardHead, Field, Money, MoneyInput, PageHead, Pill, StatusPill, UnitNumberInput } from '../ui/components';

export function Planner() {
  const { state, rec, dispatch, notify, today } = useStore();
  const [amount, setAmount] = useState(rec.recommendedCents);
  const s = state.settings;
  const ladder = milestones(state, rec.monthlyEssentialCents);

  return (
    <div className="page">
      <PageHead title="Safe-to-Save planner" sub="The most you can set aside today while every protected bill and everyday essential stays covered, with the full working shown." />

      <div className="grid grid-3">
        <Card className="span-2" data-testid="planner-summary">
          <div className="stack">
            <div className="row-between">
              <span className="eyebrow">Recommendation for {formatDateLong(today)}</span>
              <StatusPill status={rec.status} />
            </div>
            <h2 style={{ fontSize: '1.5rem' }}>{rec.headline}</h2>
            <p className="ink2">{rec.message}</p>
            <div className="grid grid-3">
              <div className="stat">
                <span className="stat-label">Recommended</span>
                <span className="stat-value" data-testid="planner-recommended">
                  <Money cents={rec.recommendedCents} />
                </span>
              </div>
              <div className="stat">
                <span className="stat-label">Safe maximum</span>
                <span className="stat-value" data-testid="planner-max">
                  <Money cents={rec.maxSafeCents} />
                </span>
              </div>
              <div className="stat">
                <span className="stat-label">Next review</span>
                <span className="stat-value" style={{ fontSize: '1.1rem' }}>
                  {formatDate(rec.nextReviewDate)}
                </span>
              </div>
            </div>
            {rec.limitingFactor ? (
              <Callout tone="neutral" icon={<LuShieldCheck aria-hidden />}>
                <strong>What limits this: </strong>
                {rec.limitingFactor.text}
              </Callout>
            ) : null}
            {rec.missingInfo.length && rec.status === 'insufficient' ? (
              <Callout tone="warning">
                <ul style={{ margin: 0, paddingLeft: 18 }}>
                  {rec.missingInfo.map((m) => (
                    <li key={m}>{m}</li>
                  ))}
                </ul>
              </Callout>
            ) : null}
          </div>
        </Card>
        <Card>
          <CardHead title="Confidence" right={<Pill tone={rec.confidence === 'high' ? 'good' : rec.confidence === 'medium' ? 'warning' : 'serious'}>{rec.confidence}</Pill>} />
          <ul className="small ink2" style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 6 }}>
            {rec.confidenceReasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
          <p className="xsmall muted" style={{ marginTop: 10 }}>
            Lower confidence means a smaller share of the safe maximum is recommended ({Math.round(rec.share * 100)}% now).
          </p>
        </Card>
      </div>

      <div className="grid grid-2">
        <Card>
          <CardHead title="How this was calculated" sub="Every figure comes from your accounts, bills, transactions and income." />
          <div className="steps" data-testid="explanation">
            {rec.explanation.map((st, i) => (
              <div key={i} className={`step ${st.kind === 'result' ? 'result' : ''}`}>
                <span className="sign">{st.kind === 'plus' ? '+' : st.kind === 'minus' ? '−' : st.kind === 'result' ? '=' : st.kind === 'note' ? '·' : ''}</span>
                <div>
                  <div className="label">{st.label}</div>
                  {st.detail ? <div className="detail">{st.detail}</div> : null}
                </div>
                <span className="amount">{st.amountCents === null ? '' : formatMoney(Math.abs(st.amountCents))}</span>
              </div>
            ))}
          </div>
          <p className="xsmall muted" style={{ marginTop: 8 }}>
            The plus and minus lines are totals for the period. The safe maximum comes from the single lowest day, because bills and pay land on different dates.
          </p>
        </Card>
        <div className="stack">
          <Card>
            <CardHead title="Day-by-day projection" sub={`${formatDate(today)} to ${formatDate(rec.horizonEnd)}`} />
            <LineChart
              ariaLabel="Projected cash with and without saving"
              labels={rec.projection.map((d) => formatDate(d.date))}
              series={[
                { name: 'Without saving', color: 'var(--muted)', values: rec.projection.map((d) => d.closingCents), dashed: true },
                { name: `After saving ${formatMoney(rec.recommendedCents)}`, color: 'var(--brand)', values: rec.projectionAfter.map((d) => d.closingCents), area: true },
              ]}
              reference={{ value: rec.floorCents, label: 'Minimum reserve' }}
              markers={rec.limitingFactor ? [{ index: rec.projection.findIndex((d) => d.date === rec.limitingFactor!.date), label: 'Lowest point' }] : []}
            />
          </Card>
          <Card>
            <CardHead title="Record a transfer" sub="SavvyMoni doesn't move money. Record what you moved in your own banking app." />
            <div className="row" style={{ alignItems: 'flex-end' }}>
              <div style={{ width: 160 }}>
                <Field label="Amount">
                  <MoneyInput value={amount} onChange={setAmount} testId="transfer-amount" />
                </Field>
              </div>
              <button
                className="btn primary"
                disabled={amount <= 0}
                data-testid="transfer-deposit"
                onClick={() => {
                  dispatch({ type: 'RECORD_CONTRIBUTION', amountCents: amount, kind: 'deposit' });
                  notify(`Recorded ${formatMoney(amount)} saved`);
                }}
              >
                Saved to emergency fund
              </button>
              <button
                className="btn"
                disabled={amount <= 0 || rec.emergencyCents === 0}
                onClick={() => {
                  dispatch({ type: 'RECORD_CONTRIBUTION', amountCents: amount, kind: 'withdrawal' });
                  notify(`Recorded ${formatMoney(Math.min(amount, rec.emergencyCents))} withdrawn`);
                }}
              >
                Withdrew for an emergency
              </button>
            </div>
            {amount > rec.maxSafeCents && amount > 0 ? (
              <p className="small" style={{ color: 'var(--serious)', marginTop: 8 }}>
                This is more than the safe maximum of {formatMoney(rec.maxSafeCents)}. It may leave too little for upcoming essentials.
              </p>
            ) : null}
          </Card>
        </div>
      </div>

      <Card>
        <CardHead title="Protected expenses" sub={`Set aside before any saving: ${formatMoney(rec.protectedTotalCents)} in total including everyday essentials.`} />
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Due</th>
                <th>Payment</th>
                <th>Type</th>
                <th className="r">Amount</th>
              </tr>
            </thead>
            <tbody>
              {rec.protectedItems.map((p, i) => (
                <tr key={`${p.refId}-${p.date}-${i}`}>
                  <td className="num">
                    {formatDate(p.date)} {p.overdue ? <span style={{ color: 'var(--critical)' }}>(overdue)</span> : null}
                  </td>
                  <td>{p.label}</td>
                  <td className="small muted">{p.kind === 'health' ? 'Medical bill' : 'Bill'}</td>
                  <td className="r amount">{formatMoney(p.amountCents)}</td>
                </tr>
              ))}
              <tr>
                <td className="num">Daily</td>
                <td>Everyday essentials (food, groceries, transport)</td>
                <td className="small muted">{rec.spend.source === 'history' ? 'From your transactions' : 'Estimate'}</td>
                <td className="r amount">{formatMoney(rec.spend.dailyEssentialCents)}/day</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid grid-2">
        <Card>
          <CardHead title="Your emergency savings goal" sub="Start small. Milestones grow with you; a goal you pick also caps how much is suggested." />
          <div className="ladder">
            <button className="rung" aria-pressed={state.goal.selected === 'auto'} onClick={() => dispatch({ type: 'UPDATE_GOAL', patch: { selected: 'auto' } })}>
              <span className="eyebrow">Automatic</span>
              <span className="small">Next milestone</span>
            </button>
            {ladder.map((m) => (
              <button
                key={m.id}
                className={`rung ${rec.emergencyCents >= m.targetCents ? 'done' : ''}`}
                aria-pressed={state.goal.selected === m.id}
                onClick={() => dispatch({ type: 'UPDATE_GOAL', patch: { selected: m.id } })}
              >
                <span className="eyebrow">{rec.emergencyCents >= m.targetCents ? 'Reached' : m.short}</span>
                <span className="small" style={{ fontWeight: 600 }}>
                  {m.label}
                </span>
                <span className="num small">{formatMoney(m.targetCents)}</span>
              </button>
            ))}
          </div>
          <div className="form-grid" style={{ marginTop: 14 }}>
            <Field label="My own goal" hint="Optional. Set to 0 to remove.">
              <MoneyInput value={state.goal.customTargetCents} onChange={(c) => dispatch({ type: 'UPDATE_GOAL', patch: { customTargetCents: c, selected: c > 0 ? 'custom' : state.goal.selected === 'custom' ? 'auto' : state.goal.selected } })} />
            </Field>
            <Field label="My weekly saving target" hint="Optional. SavvyMoni will suggest less when it isn't safe.">
              <MoneyInput value={state.goal.weeklyTargetCents} onChange={(c) => dispatch({ type: 'UPDATE_GOAL', patch: { weeklyTargetCents: c } })} testId="weekly-target" />
            </Field>
          </div>
        </Card>
        <Card>
          <CardHead title="Assumptions you control" sub="Change these to make the plan more or less cautious." />
          <div className="form-grid">
            <Field label="Minimum cash reserve" hint="Never planned away.">
              <MoneyInput value={s.minCashReserveCents} onChange={(c) => dispatch({ type: 'UPDATE_SETTINGS', patch: { minCashReserveCents: c } })} />
            </Field>
            <Field label="Planning horizon" hint="How far ahead bills are protected: 1 to 17 weeks.">
              <UnitNumberInput
                value={Math.max(1, Math.round(s.horizonDays / 7))}
                unit="weeks"
                min={1}
                max={17}
                ariaLabel="Planning horizon in weeks"
                testId="horizon-weeks"
                onChange={(w) => dispatch({ type: 'UPDATE_SETTINGS', patch: { horizonDays: w * 7 } })}
              />
            </Field>
            <Field label="Assume pay arrives late by">
              <select className="input" value={s.incomeDelayDays} onChange={(e) => dispatch({ type: 'UPDATE_SETTINGS', patch: { incomeDelayDays: Number(e.target.value) } })}>
                {[0, 1, 2, 3, 5, 7].map((d) => (
                  <option key={d} value={d}>
                    {d === 0 ? 'On time' : `${d} day${d > 1 ? 's' : ''}`}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={`Keep ${s.discretionaryReservePct}% of usual non-essential spending`}>
              <input type="range" min={0} max={100} step={10} value={s.discretionaryReservePct} onChange={(e) => dispatch({ type: 'UPDATE_SETTINGS', patch: { discretionaryReservePct: Number(e.target.value) } })} />
            </Field>
          </div>
          <hr className="divider" style={{ margin: '14px 0' }} />
          <div className="row-between">
            <div>
              <div style={{ fontWeight: 600 }}>{rec.paused ? `Paused until ${formatDate(s.pauseUntil!)}` : 'Need a break from saving?'}</div>
              <div className="small muted">Pausing is always fine. Nothing is lost.</div>
            </div>
            {rec.paused ? (
              <button className="btn" onClick={() => (dispatch({ type: 'UPDATE_SETTINGS', patch: { pauseUntil: undefined } }), notify('Savings resumed'))}>
                <LuPlay /> Resume
              </button>
            ) : (
              <button className="btn" data-testid="pause-2w" onClick={() => (dispatch({ type: 'UPDATE_SETTINGS', patch: { pauseUntil: addDays(today, 13) } }), notify('Paused for 2 weeks'))}>
                <LuPause /> Pause 2 weeks
              </button>
            )}
          </div>
          <details className="details" style={{ marginTop: 14 }}>
            <summary>All assumptions</summary>
            <ul className="small ink2" style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 4 }}>
              {rec.assumptions.map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ul>
          </details>
        </Card>
      </div>
    </div>
  );
}
