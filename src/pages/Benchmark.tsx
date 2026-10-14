import { useEffect, useMemo, useState } from 'react';
import { LuRefreshCw, LuShuffle } from 'react-icons/lu';
import { benchmarkBaseFromState, defaultBenchmarkConfig, runBenchmark, STRATEGY_LABELS, type BenchmarkConfig, type StrategyMetrics, type StrategyResult } from '../domain/benchmark';
import { formatMoney } from '../domain/money';
import { useStore } from '../state/store';
import { Columns, LineChart } from '../ui/charts';
import { Callout, Card, CardHead, Field, MoneyInput, PageHead, Pill } from '../ui/components';

const COLORS = { adaptive: 'var(--series-1)', fixed10: 'var(--series-2)', fixedWeekly: 'var(--series-3)' } as const;

interface MetricRow {
  label: string;
  hint: string;
  get: (m: StrategyMetrics) => number | null;
  fmt: (v: number | null) => string;
  better: 'high' | 'low' | 'none';
}

const money = (v: number | null) => (v === null ? '—' : formatMoney(v));
const count = (v: number | null) => (v === null ? 'Not within 26 weeks' : String(v));

const ROWS: MetricRow[] = [
  { label: 'Emergency savings at week 26', hint: 'Total savings accumulated', get: (m) => m.finalSavingsCents, fmt: money, better: 'high' },
  { label: 'Unpaid essentials', hint: 'Essential expense shortfall even after using all savings', get: (m) => m.unmetCents, fmt: money, better: 'low' },
  { label: 'Weeks savings had to rescue essentials (no shock)', hint: 'The saving plan itself left too little for that week', get: (m) => m.squeezeWeeks, fmt: count, better: 'low' },
  { label: 'Weeks savings were used at all', hint: 'Including shock weeks', get: (m) => m.rescueWeeks, fmt: count, better: 'none' },
  { label: 'Shocks absorbed', hint: 'Shocks paid without unpaid essentials', get: (m) => m.shocksAbsorbed, fmt: count, better: 'high' },
  { label: 'Lowest emergency buffer', hint: 'Smallest savings balance in the period', get: (m) => m.lowestSavingsCents, fmt: money, better: 'high' },
  { label: 'Weeks below cash reserve', hint: 'Week-end cash under the minimum reserve', get: (m) => m.lowCashWeeks, fmt: count, better: 'low' },
  { label: 'Contribution volatility', hint: 'Standard deviation of weekly contributions', get: (m) => m.contributionStdDevCents, fmt: money, better: 'none' },
  { label: 'Weeks with no contribution', hint: 'Paused or skipped weeks', get: (m) => m.pausedWeeks, fmt: count, better: 'none' },
  { label: 'Weeks to rebuild after biggest withdrawal', hint: 'Until savings return to their level before it', get: (m) => m.rebuildWeeks, fmt: count, better: 'low' },
];

function narrative(results: StrategyResult[]): string[] {
  const a = results.find((r) => r.id === 'adaptive')!.metrics;
  const f10 = results.find((r) => r.id === 'fixed10')!.metrics;
  const fw = results.find((r) => r.id === 'fixedWeekly')!.metrics;
  const out: string[] = [];
  const bestSaved = [...results].sort((x, y) => y.metrics.finalSavingsCents - x.metrics.finalSavingsCents)[0];
  const tied = results.every((r) => r.metrics.finalSavingsCents === bestSaved.metrics.finalSavingsCents);
  if (tied) out.push(`All three strategies end with the same savings (${formatMoney(a.finalSavingsCents)}). In this history, income does not leave room to keep any buffer.`);
  else out.push(
    bestSaved.id === 'adaptive'
      ? `SavvyMoni ended with the most savings (${formatMoney(a.finalSavingsCents)}), mainly by saving more in good weeks.`
      : `${bestSaved.label} ended with more savings (${formatMoney(bestSaved.metrics.finalSavingsCents)}) than SavvyMoni (${formatMoney(a.finalSavingsCents)}). Adaptive saving trades some accumulation for safety.`,
  );
  const fixedSqueeze = Math.max(f10.squeezeWeeks, fw.squeezeWeeks);
  if (a.squeezeWeeks < fixedSqueeze) out.push(`Fixed plans needed savings to cover essentials in up to ${fixedSqueeze} ordinary weeks; SavvyMoni in ${a.squeezeWeeks}.`);
  else if (a.squeezeWeeks > fixedSqueeze) out.push(`In this history SavvyMoni needed savings to cover essentials in ${a.squeezeWeeks} ordinary weeks, more than the fixed plans (${fixedSqueeze}). Tight months happen regardless of the strategy.`);
  else out.push(`All strategies needed savings to cover essentials in the same number of ordinary weeks (${a.squeezeWeeks}). Here the squeeze comes from the timing of bills and pay, not the savings plan.`);
  if (a.pausedWeeks > fw.pausedWeeks) out.push(`SavvyMoni paused in ${a.pausedWeeks} weeks when cash was tight; the fixed weekly plan kept transferring.`);
  if (a.contributionStdDevCents > fw.contributionStdDevCents) out.push('Adaptive contributions vary much more week to week. That flexibility is the point, but it is less predictable.');
  return out;
}

export function Benchmark() {
  const { state, rec } = useStore();
  const base = useMemo(() => benchmarkBaseFromState(state, rec), [state, rec]);
  const initial = useMemo(() => defaultBenchmarkConfig(base, state.settings.minCashReserveCents), [base, state.settings.minCashReserveCents]);
  const [cfg, setCfg] = useState<BenchmarkConfig>(initial);
  useEffect(() => setCfg(initial), [initial]);
  const { history, results } = useMemo(() => runBenchmark(base, cfg), [base, cfg]);
  const labels = history.map((h) => `Wk ${h.week + 1}`);
  const markers = history.filter((h) => h.shockCents > 0).map((h) => ({ index: h.week, label: h.shockLabel ?? 'Shock' }));
  if (cfg.incomeChange !== 0) markers.push({ index: cfg.incomeChangeWeek, label: `Income ${cfg.incomeChange > 0 ? '+' : ''}${Math.round(cfg.incomeChange * 100)}%` });

  const best = (row: MetricRow) => {
    if (row.better === 'none') return null;
    const vals = results.map((r) => row.get(r.metrics)).map((v) => (v === null ? (row.better === 'low' ? Infinity : -Infinity) : v));
    const target = row.better === 'high' ? Math.max(...vals) : Math.min(...vals);
    const winners = results.filter((_, i) => vals[i] === target);
    return winners.length === results.length ? null : new Set(winners.map((w) => w.id));
  };

  return (
    <div className="page">
      <PageHead
        title="Benchmark lab"
        sub="Three saving strategies run on the same simulated 26-week future, built from your current income, bills and spending. Shocks are unexpected: no strategy knows about them in advance."
        right={<Pill tone="info">Simulation</Pill>}
      />

      <Card>
        <CardHead
          title="Stress the history"
          sub="Change conditions and watch each strategy respond."

        />
        <div className="row" style={{ marginBottom: 14 }}>
          <button className="btn sm" data-testid="bench-income-cut" onClick={() => setCfg({ ...cfg, incomeChange: -0.5 })}>
            Cut income 50% from week {cfg.incomeChangeWeek + 1}
          </button>
          <button className="btn sm" data-testid="bench-medical" onClick={() => setCfg({ ...cfg, medicalBillCents: base.shockCents * 4 })}>
            Add a {formatMoney(base.shockCents * 4)} medical bill in week {cfg.medicalWeek + 1}
          </button>
          <button className="btn sm ghost" onClick={() => setCfg({ ...cfg, seed: cfg.seed + 1 })}>
            <LuShuffle /> Another random history
          </button>
          <button className="btn sm ghost" onClick={() => setCfg(initial)}>
            <LuRefreshCw /> Reset
          </button>
        </div>
        <div className="form-grid">
          <Field label={`Income change from week ${cfg.incomeChangeWeek + 1}: ${cfg.incomeChange > 0 ? '+' : ''}${Math.round(cfg.incomeChange * 100)}%`}>
            <input type="range" min={-80} max={20} step={5} value={Math.round(cfg.incomeChange * 100)} onChange={(e) => setCfg({ ...cfg, incomeChange: Number(e.target.value) / 100 })} data-testid="bench-income" />
          </Field>
          <Field label="Extra medical bill">
            <MoneyInput value={cfg.medicalBillCents} onChange={(c) => setCfg({ ...cfg, medicalBillCents: c })} />
          </Field>
          <Field label={`Medical bill in week ${cfg.medicalWeek + 1}`}>
            <input type="range" min={1} max={25} value={cfg.medicalWeek} onChange={(e) => setCfg({ ...cfg, medicalWeek: Number(e.target.value) })} />
          </Field>
          <Field label={`Income volatility: ±${Math.round(cfg.volatility * 100)}%`}>
            <input type="range" min={0} max={50} value={Math.round(cfg.volatility * 100)} onChange={(e) => setCfg({ ...cfg, volatility: Number(e.target.value) / 100 })} />
          </Field>
          <Field label="Fixed weekly amount">
            <MoneyInput value={cfg.fixedWeeklyCents} onChange={(c) => setCfg({ ...cfg, fixedWeeklyCents: c })} />
          </Field>
        </div>
      </Card>

      <Card>
        <CardHead title="Emergency savings over 26 weeks" />
        <LineChart
          ariaLabel="Emergency savings by strategy"
          labels={labels}
          series={results.map((r) => ({ name: r.label, color: COLORS[r.id], values: r.weeks.map((w) => w.savingsCents), width: r.id === 'adaptive' ? 2.5 : 2 }))}
          markers={markers}
        />
      </Card>

      <div className="stack">
        <Card>
          <CardHead title="Results" sub="Bold marks the better value where one is clearly better. Some measures have no right answer." />
          <div className="table-wrap">
            <table className="table" data-testid="bench-table">
              <thead>
                <tr>
                  <th>Measure</th>
                  {results.map((r) => (
                    <th key={r.id} className="r">
                      <span className="legend-item" style={{ justifyContent: 'flex-end' }}>
                        <span className="swatch" style={{ background: COLORS[r.id] }} />
                        {STRATEGY_LABELS[r.id]}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ROWS.map((row) => {
                  const winners = best(row);
                  return (
                    <tr key={row.label}>
                      <td style={{ minWidth: 200 }}>
                        <div>{row.label}</div>
                        <div className="xsmall muted">{row.hint}</div>
                      </td>
                      {results.map((r) => (
                        <td key={r.id} className={`r num ${winners?.has(r.id) ? 'best' : ''}`}>
                          {row.label === 'Shocks absorbed' ? `${r.metrics.shocksAbsorbed} of ${r.metrics.shocksTotal}` : row.fmt(row.get(r.metrics))}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
        <Card>
          <CardHead title="What this shows" />
          <ul className="ink2" style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 8 }} data-testid="bench-narrative">
            {narrative(results).map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
          <div style={{ marginTop: 12 }}>
            <Callout tone="neutral">Synthetic data only. Real-world results need the pilot study described in PILOT_PLAN.md.</Callout>
          </div>
        </Card>
      </div>

      <Card>
        <CardHead title="Weekly contributions" sub="How much each strategy set aside each week." />
        <Columns ariaLabel="Weekly contributions by strategy" labels={labels} series={results.map((r) => ({ name: r.label, color: COLORS[r.id], values: r.weeks.map((w) => w.contributionCents) }))} />
      </Card>

      <Card>
        <CardHead title="Method" />
        <ul className="small ink2" style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 4 }}>
          <li>Starting cash {formatMoney(base.startingCashCents)} and savings {formatMoney(base.startingSavingsCents)}; about {formatMoney(base.monthlyIncomeCents)} a month take-home, paid {base.payFrequency}.</li>
          <li>Each week: pay arrives, the strategy transfers its contribution (never more than the cash available), then bills, everyday spending and any shock are paid.</li>
          <li>If cash runs out, savings are withdrawn to pay essentials. If savings run out too, the remainder counts as unpaid essentials.</li>
          <li>Fixed 10% saves a tenth of each payment. Fixed weekly saves the same amount every week.</li>
          <li>SavvyMoni looks five weeks ahead using only what is known that week: scheduled bills, recent essential spending, usual discretionary spending, and expected pay reduced for volatility. It saves 60% of the safe maximum, and nothing when that is under {formatMoney(base.minActionableCents)}.</li>
          <li>An unexpected bill of {formatMoney(base.shockCents)} lands in week 9 for everyone{base.variableIncome ? '; variable earners also have a two-week income dip in weeks 16–17' : '; salaried households also face an urgent family expense in week 20'}.</li>
        </ul>
      </Card>
    </div>
  );
}
