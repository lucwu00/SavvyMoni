import { useEffect, useState } from 'react';
import { LuArrowRight, LuCalendar, LuPiggyBank, LuShieldCheck, LuWallet } from 'react-icons/lu';
import { addDays, formatDate, formatDateLong, relativeDay } from '../domain/dates';
import { minor } from '../config/markets';
import { describeCoverage } from '../domain/goals';
import { emergencyHistory } from '../domain/history';
import { formatMoney } from '../domain/money';
import { useNavigate, useStore } from '../state/store';
import { t } from '../ui/i18n';
import { HBars, LineChart } from '../ui/charts';
import { Callout, Card, CardHead, Money, MoneyInput, Pill, ProgressBar, RecordsBadge, SourceBadge, Stat, StatusPill } from '../ui/components';
import { Lifecycle, lifecycleStage, riskWarnings, spendBreakdown } from './shared';

export function Overview() {
  const { state, rec, today } = useStore();
  const go = useNavigate();
  const name = state.profile.displayName;
  const first = /^(The|Ibu|Bapak|Pak|Bu) /.test(name) ? name.split(' ').slice(0, 2).join(' ') : name.split(' ')[0];
  const risks = riskWarnings(state, rec);
  const stage = lifecycleStage(state, rec, today);
  const upcoming = rec.projection
    .flatMap((d) => d.events.filter((e) => e.kind === 'bill' || e.kind === 'health'))
    .slice(0, 6);
  const next14 = rec.protectedItems.filter((p) => p.date <= addDays(today, 13));
  const breakdown = spendBreakdown(state, today);

  // Emergency savings history: only as far back as there is evidence for it.
  const hist = emergencyHistory(state, today);
  const trend = hist.points.map((p) => p.cents);
  const trendLabels = hist.points.map((p) => formatDate(p.date));

  const incomeEvents = rec.projection.flatMap((d) => d.events.filter((e) => e.kind === 'income'));

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <span className="eyebrow">{formatDateLong(today)}</span>
          <h1>Hello, {first}</h1>
        </div>
        <RecordsBadge />
      </header>

      <Card className="hero" data-testid="hero">
        <div className="hero-main">
          <span className="eyebrow">{t('hero.safeToSave', state.settings.language)}</span>
          <div className="hero-amount" data-testid="hero-amount">
            <span className="unit">{rec.currency.symbol}</span>
            {formatMoney(rec.recommendedCents).slice(rec.currency.symbol.length)}
          </div>
          <div className="row">
            <StatusPill status={rec.status} />
            <Pill tone="neutral">{rec.confidence[0].toUpperCase() + rec.confidence.slice(1)} confidence</Pill>
          </div>
          <p className="ink2">{rec.message}</p>
          {rec.cushionCents > 0 ? (
            <p className="small cushion-note" data-testid="cushion-note">
              <strong>{formatMoney(rec.cushionCents)} kept as a cushion</strong>, not spare money: it stays in your spending money in case pay comes in lower or costs run higher than forecast. If it isn't needed,
              SavvyMoni will suggest saving it on {formatDate(rec.nextReviewDate)}.
            </p>
          ) : null}
          {rec.limitingFactor ? <p className="small muted">{rec.limitingFactor.text}</p> : null}
          <div className="row" style={{ marginTop: 4 }}>
            <button className="btn primary" onClick={() => go('planner')} data-testid="cta-planner">
              {t('hero.cta', state.settings.language)} <LuArrowRight />
            </button>
          </div>
          <SavePanel />
        </div>
        <div className="hero-side">
          <span className="eyebrow">Emergency savings goal</span>
          <div className="row-between">
            <strong>{rec.goal.milestone.label}</strong>
            <span className="num small">{Math.round(rec.goal.progress * 100)}%</span>
          </div>
          <ProgressBar value={rec.goal.progress} label={`Progress to ${rec.goal.milestone.label}`} />
          <div className="small ink2">
            <Money cents={rec.emergencyCents} /> saved of <Money cents={rec.goal.milestone.targetCents} />
          </div>
          <hr className="divider" />
          <div className="small ink2">
            Covers <strong>{describeCoverage(rec.coverageMonths)}</strong> of essential spending ({formatMoney(rec.monthlyEssentialCents)} a month).
          </div>
          <div className="small ink2 row">
            <LuCalendar aria-hidden /> Next check-in {formatDate(rec.nextReviewDate)} ({relativeDay(rec.nextReviewDate, today)})
            {state.settings.remindersEnabled ? <span className="badge">Reminder on</span> : null}
          </div>
        </div>
      </Card>

      <CushionCheck />

      {rec.missingInfo.length && rec.status === 'insufficient' ? (
        <Callout tone="warning">
          <strong>To give you a safe number, SavvyMoni needs:</strong>
          <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
            {rec.missingInfo.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
          <button className="link-btn" onClick={() => go('finances')} style={{ marginTop: 6 }}>
            Add details <LuArrowRight />
          </button>
        </Callout>
      ) : null}

      <div className="grid grid-4">
        <Card>
          <Stat label="Spendable cash" icon={<LuWallet aria-hidden />} value={<Money cents={rec.liquidCents} />} sub={`${state.accounts.filter((a) => a.role === 'spending').length} account(s)`} />
        </Card>
        <Card>
          <Stat label="Emergency savings" icon={<LuShieldCheck aria-hidden />} value={<Money cents={rec.emergencyCents} />} sub={`Target ${formatMoney(rec.goal.milestone.targetCents)}`} />
        </Card>
        <Card>
          <Stat label="Essentials covered" value={describeCoverage(rec.coverageMonths)} sub="by emergency savings" />
        </Card>
        <Card>
          <Stat label="Protected in next 14 days" value={<Money cents={next14.reduce((t, p) => t + p.amountCents, 0)} />} sub={`${next14.length} bills and payments`} />
        </Card>
      </div>

      <Card>
        <CardHead title="Where you are" sub="Prepare, save, absorb a shock, recover and rebuild. SavvyMoni adapts at every stage." />
        <Lifecycle stage={stage} />
      </Card>

      {risks.length ? (
        <div className="stack" aria-label="Risk warnings">
          {risks.map((r) => (
            <Callout key={r.text} tone={r.tone}>
              {r.text}
            </Callout>
          ))}
        </div>
      ) : null}

      <div className="grid grid-3">
        <Card className="span-2">
          <CardHead
            title="Cash over the next 5 weeks"
            sub="Projected spendable cash after protected bills, everyday essentials and counted income."
            right={<SourceBadge source="estimated" title="Projection, not a guarantee" />}
          />
          <LineChart
            ariaLabel="Projected cash balance"
            labels={rec.projection.map((d) => formatDate(d.date))}
            series={[
              { name: 'If you save nothing', color: 'var(--muted)', values: rec.projection.map((d) => d.closingCents), dashed: true },
              { name: `If you save ${formatMoney(rec.recommendedCents)}`, color: 'var(--brand)', values: rec.projectionAfter.map((d) => d.closingCents), area: true },
            ]}
            reference={{ value: rec.floorCents, label: `Reserve ${formatMoney(rec.floorCents)}` }}
            tooltipExtra={(i) => {
              const ev = rec.projection[i].events.filter((e) => e.kind === 'income' || e.kind === 'bill' || e.kind === 'health');
              return ev.length ? (
                <div className="xsmall muted" style={{ marginTop: 4 }}>
                  {ev.map((e) => `${e.label} ${formatMoney(e.amountCents, { signed: true })}`).join(' · ')}
                </div>
              ) : null;
            }}
          />
        </Card>
        <Card>
          <CardHead title="Upcoming bills" right={<button className="link-btn small" onClick={() => go('finances')}>All bills</button>} />
          <div className="list">
            {upcoming.length === 0 ? <p className="muted small">No bills in the next five weeks.</p> : null}
            {upcoming.map((e, i) => (
              <div className="list-row" key={`${e.refId}-${e.date}-${i}`}>
                <div className="grow">
                  <div className="title">{e.label}</div>
                  <div className="meta">
                    {e.overdue ? <span style={{ color: 'var(--critical)', fontWeight: 600 }}>Overdue</span> : relativeDay(e.date, today)}
                    {e.protected ? <span className="badge">Protected</span> : <span className="badge">Optional</span>}
                  </div>
                </div>
                <Money cents={-e.amountCents} className="amount" />
              </div>
            ))}
          </div>
        </Card>
      </div>

      <div className="grid grid-2">
        <Card>
          <CardHead title="Spending, last 4 weeks" sub="Split into essential and discretionary. Mixed receipts are split by line." right={<RecordsBadge />} />
          <HBars
            rows={breakdown.slice(0, 8)}
            legend={[
              { name: 'Essential', color: 'var(--brand)' },
              { name: 'Discretionary', color: 'var(--series-2)' },
            ]}
          />
        </Card>
        <Card>
          <CardHead title="Income forecast" sub={`Next ${rec.horizonDays} days. Only what is counted is used to plan.`} />
          <div className="list">
            {incomeEvents.map((e, i) => (
              <div className="list-row" key={`${e.refId}-${i}`}>
                <div className="grow">
                  <div className="title">{e.label}</div>
                  <div className="meta">
                    {formatDate(e.date)} · {e.certainty === 'confirmed' ? 'Confirmed' : `Expected ${formatMoney(e.fullAmountCents)}, counted conservatively`}
                  </div>
                </div>
                <Money cents={e.amountCents} className="amount in" />
              </div>
            ))}
            {rec.excludedIncome.map((x, i) => (
              <div className="list-row" key={`x-${i}`}>
                <div className="grow">
                  <div className="title muted">{x.label}</div>
                  <div className="meta">
                    {formatDate(x.date)} · {x.reason}
                  </div>
                </div>
                <span className="amount muted" style={{ textDecoration: 'line-through' }}>
                  {formatMoney(x.amountCents)}
                </span>
              </div>
            ))}
            {incomeEvents.length + rec.excludedIncome.length === 0 ? <p className="small muted">No income expected in this period.</p> : null}
          </div>
        </Card>
      </div>

      <div className="grid grid-2">
        <Card>
          <CardHead
            title="Financial resilience trend"
            sub={
              hist.basis === 'transfers'
                ? `Emergency savings since ${formatDate(hist.knownFrom, true)}, worked out from ${hist.transfersFound} transfer${hist.transfersFound === 1 ? '' : 's'} in your records.`
                : `Emergency savings since you set up SavvyMoni on ${formatDate(hist.knownFrom, true)}.`
            }
          />
          {trend.length >= 3 ? (
            <LineChart ariaLabel="Emergency savings trend" labels={trendLabels} series={[{ name: 'Emergency savings', color: 'var(--series-1)', values: trend, area: true }]} height={180} />
          ) : (
            <div className="trend-empty" data-testid="trend-empty">
              <div className="stat-value">
                <Money cents={rec.emergencyCents} />
              </div>
              <p className="small ink2">Today’s emergency savings. The line starts here and grows as you save.</p>
            </div>
          )}
          {hist.basis === 'since-setup' ? (
            <p className="xsmall muted" style={{ marginTop: 8 }}>
              Earlier balances are not shown because your records don’t say what they were. Imported transfers to your savings account (for example “Transfer to {state.accounts.find((a) => a.role === 'emergency')?.name ?? 'savings'}”) let SavvyMoni work them out.
            </p>
          ) : null}
        </Card>
        <Card>
          <CardHead title="Why your number changes" sub="Every time your plan changes, SavvyMoni records why." right={<button className="link-btn small" onClick={() => go('assistant')}>Ask why</button>} />
          <div className="list">
            {[...state.history].reverse().slice(0, 6).map((h, i) => (
              <div className="list-row" key={`${h.at}-${i}`}>
                <div className="grow">
                  <div className="title" style={{ fontWeight: 500 }}>
                    {h.reason}
                  </div>
                  <div className="meta">{formatDate(h.date)}</div>
                </div>
                <span className="amount">{formatMoney(h.recommendedCents)}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}

/** At the check-in after a cushion was kept: suggest saving it if it wasn't needed. */
function CushionCheck() {
  const { state, rec, today, dispatch, notify, market } = useStore();
  const c = state.cushion;
  if (!c || today < c.reviewOn) return null;
  // Never more than today's safe maximum, rounded down to the country's step.
  const step = minor(market, market.rounding.stepMajor);
  const suggest = Math.floor(Math.min(c.cents, rec.maxSafeCents) / step) * step;
  const usable = suggest >= minor(market, market.rounding.minActionableMajor) && rec.status !== 'pause';
  return (
    <Callout tone={usable ? 'good' : 'neutral'}>
      <div className="stack-sm" data-testid="cushion-check">
        {usable ? (
          <>
            <div>
              <strong>Your cushion from {formatDate(c.setOn)} wasn’t needed.</strong> On {formatDate(c.setOn)} you kept {formatMoney(c.cents)} aside in case pay came in low. Your bills are still covered, so you can
              safely move {suggest < c.cents ? `${formatMoney(suggest)} of it` : 'it'} to emergency savings now.
            </div>
            <div className="row">
              <button
                className="btn sm primary"
                data-testid="cushion-save"
                onClick={() => {
                  dispatch({ type: 'RECORD_CONTRIBUTION', amountCents: suggest, kind: 'deposit', fromCushion: true, note: `Unused cushion from ${formatDate(c.setOn)}` });
                  notify(`Recorded ${formatMoney(suggest)} moved to emergency savings`);
                }}
              >
                Save {formatMoney(suggest)}
              </button>
              <button className="btn sm ghost" data-testid="cushion-keep" onClick={() => dispatch({ type: 'CLEAR_CUSHION' })}>
                Keep it in spending
              </button>
            </div>
          </>
        ) : (
          <>
            <div>
              <strong>Your cushion from {formatDate(c.setOn)} was needed.</strong> Cash is tighter than forecast, so nothing extra is safe to save now. That is exactly what the cushion was for.
            </div>
            <div>
              <button className="btn sm ghost" data-testid="cushion-keep" onClick={() => dispatch({ type: 'CLEAR_CUSHION' })}>
                OK
              </button>
            </div>
          </>
        )}
      </div>
    </Callout>
  );
}

/**
 * Record a saving of any amount. The suggestion is pre-filled; anything up to
 * the safe maximum keeps every bill covered; more than that needs a second
 * confirmation. The latest saving can be undone.
 */
function SavePanel() {
  const { state, rec, dispatch, notify } = useStore();
  const [amount, setAmount] = useState<number>(rec.recommendedCents);
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    setAmount(rec.recommendedCents);
    setArmed(false);
  }, [rec.recommendedCents]);
  const last = [...state.contributions].reverse().find((c) => c.source === 'user' && !c.shockId);
  const over = amount > rec.maxSafeCents;
  const save = () => {
    dispatch({ type: 'RECORD_CONTRIBUTION', amountCents: amount, kind: 'deposit' });
    notify(`Recorded ${formatMoney(amount)} moved to emergency savings`);
    setArmed(false);
  };
  return (
    <div className="save-panel" data-testid="save-panel">
      <div className="save-row">
        <label className="field" style={{ flex: 1, minWidth: 150 }}>
          <span>I moved this to emergency savings</span>
          <MoneyInput value={amount} onChange={(c) => (setAmount(c), setArmed(false))} ariaLabel="Amount saved" testId="save-amount" />
        </label>
        <button className={`btn ${over ? 'danger' : ''}`} disabled={amount <= 0} data-testid="record-saving" onClick={() => (over && !armed ? setArmed(true) : save())}>
          <LuPiggyBank /> {over && armed ? 'Yes, record anyway' : `${t('hero.saved', state.settings.language)} ${formatMoney(amount)}`}
        </button>
      </div>
      <div className="chips">
        {rec.recommendedCents > 0 ? (
          <button type="button" className="chip" onClick={() => setAmount(rec.recommendedCents)}>
            Suggested {formatMoney(rec.recommendedCents)}
          </button>
        ) : null}
        {rec.maxSafeCents > rec.recommendedCents ? (
          <button type="button" className="chip" data-testid="save-max" onClick={() => setAmount(rec.maxSafeCents)}>
            Safe maximum {formatMoney(rec.maxSafeCents)}
          </button>
        ) : null}
      </div>
      {over ? (
        <p className="small" style={{ color: 'var(--critical)', margin: 0 }} data-testid="save-over">
          That is {formatMoney(amount - rec.maxSafeCents)} more than is safe: {rec.limitingFactor?.text ?? 'upcoming essentials may not be covered.'} {armed ? 'Press again only if you are sure.' : ''}
        </p>
      ) : amount > rec.recommendedCents && rec.recommendedCents > 0 ? (
        <p className="xsmall muted" style={{ margin: 0 }}>
          More than suggested but within the safe maximum: every bill stays covered, with less room if pay comes in low.
        </p>
      ) : null}
      {last ? (
        <p className="xsmall muted" style={{ margin: 0 }} data-testid="last-saving">
          Last recorded: {last.amountCents >= 0 ? 'saved' : 'withdrew'} {formatMoney(Math.abs(last.amountCents))} on {formatDate(last.date)}.{' '}
          <button
            className="link-btn xsmall"
            data-testid="undo-saving"
            onClick={() => {
              const amt = Math.abs(last.amountCents);
              const from = state.accounts.filter((a) => a.role === (last.amountCents >= 0 ? 'emergency' : 'spending')).reduce((t, a) => t + Math.max(0, a.balanceCents), 0);
              if (last.amountCents >= 0 && from < amt) return notify('Can’t undo: that money is no longer in emergency savings');
              dispatch({ type: 'UNDO_CONTRIBUTION', id: last.id });
              notify(last.amountCents >= 0 ? `Undone: ${formatMoney(amt)} is back in spending money` : `Undone: ${formatMoney(amt)} is back in emergency savings`);
            }}
          >
            Undo
          </button>
        </p>
      ) : null}
    </div>
  );
}
