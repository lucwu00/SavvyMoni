/**
 * One engine, three countries across the development range. The same computeRecommendation / simulateShock
 * / planRecovery functions run on each country's records, in their own
 * currency. A country uses the user's own records when they exist there;
 * otherwise its sample workbook, imported through the normal import path.
 * Only configuration differs.
 */
import { useEffect, useMemo, useState } from 'react';
import { LuArrowRight } from 'react-icons/lu';
import { MARKETS, minor, type MarketCode } from '../config/markets';
import { addDays, formatDate, todayIn } from '../domain/dates';
import { STATUS_META } from '../domain/engine';
import { describeCoverage } from '../domain/goals';
import { formatMoney } from '../domain/money';
import { planRecovery } from '../domain/recovery';
import { defaultShockInput, presetsFor, simulateShock } from '../domain/shock';
import type { AppState } from '../domain/types';
import { samplePlan } from '../import/samples';
import { getBrowserStorage, loadSlot } from '../state/persistence';
import { useNavigate, useStore } from '../state/store';
import { Card, CardHead, PageHead, Pill } from '../ui/components';

const COLUMNS: Array<{ market: 'SG' | 'PH' | 'MM'; shock: string; who: string }> = [
  { market: 'SG', shock: 'dental', who: 'Sample: student worker with a bank account, fortnightly shift pay and monthly rent.' },
  { market: 'PH', shock: 'moto-repair', who: 'Sample: delivery rider with weekly e-wallet cash-outs, cash spending and a motorcycle loan.' },
  { market: 'MM', shock: 'clinic', who: 'Sample: garment worker with wages twice a month, overtime that comes and goes, cash and a mobile wallet.' },
];

type Source = { state: AppState; own: boolean };

export function AseanDemo() {
  const { state: current, setCountry } = useStore();
  const go = useNavigate();
  const [severity, setSeverity] = useState(100);
  const [offset, setOffset] = useState(2);
  const [choice, setChoice] = useState<Record<string, string>>(Object.fromEntries(COLUMNS.map((c) => [c.market, c.shock])));
  const [sources, setSources] = useState<Record<string, Source> | null>(null);

  useEffect(() => {
    let alive = true;
    const storage = getBrowserStorage();
    Promise.all(
      COLUMNS.map(async (c): Promise<[string, Source]> => {
        const today = todayIn(MARKETS[c.market].timeZone);
        const own = current.marketCode === c.market && current.onboarded ? current : loadSlot(storage, c.market);
        if (own?.onboarded && own.accounts.length) return [c.market, { state: own, own: true }];
        return [c.market, { state: await samplePlan(c.market, today), own: false }];
      }),
    ).then((list) => alive && setSources(Object.fromEntries(list)));
    return () => {
      alive = false;
    };
  }, [current]);

  const results = useMemo(
    () =>
      !sources
        ? []
        : COLUMNS.map((c) => {
        const m = MARKETS[c.market];
        const today = todayIn(m.timeZone);
        const { state, own } = sources[c.market];
        const preset = presetsFor(c.market).find((p) => p.id === choice[c.market]) ?? presetsFor(c.market)[0];
        const input = defaultShockInput(preset, state);
        input.costCents = Math.round((preset.costCents * severity) / 100);
        input.incomeLossDays = Math.round((preset.incomeLossDays * severity) / 100);
        input.offsetDays = offset;
        const r = simulateShock(state, input, today);
        const plan = planRecovery(r.afterState, r.after, { targetCents: r.emergencyBeforeCents, pauseWeeks: 0 });
        const balanced = plan.scenarios.find((s) => s.id === 'balanced')!;
        return { c, m, state, own, preset, input, r, balanced, today };
      }),
    [choice, severity, offset, sources],
  );

  return (
    <div className="page">
      <PageHead
        title="One engine, three countries"
        sub="The same Safe-to-Save engine runs on records from Singapore (high income), the Philippines (upper-middle income) and Myanmar (a UN least developed country), each in its own currency. Where you have not set up a country, its sample workbook is imported through the same path as your own file. Only the country settings change."
        right={<Pill tone="info">Simulation</Pill>}
      />

      <Card>
        <CardHead title="Apply a shock in all three countries" sub="Scale every shock together and see how the same rules respond to each household's money." />
        <div className="form-grid">
          <label className="field">
            <span>Shock size: {severity}% of the example</span>
            <input type="range" min={50} max={200} step={10} value={severity} onChange={(e) => setSeverity(Number(e.target.value))} data-testid="asean-severity" />
          </label>
          <label className="field">
            <span>Happens in {offset} day{offset === 1 ? '' : 's'}</span>
            <input type="range" min={0} max={21} value={offset} onChange={(e) => setOffset(Number(e.target.value))} />
          </label>
        </div>
      </Card>

      {!sources ? <p className="small muted">Loading records…</p> : null}
      <div className="grid grid-3" data-testid="asean-columns">
        {results.map(({ c, m, state, own, preset, input, r, balanced, today }) => {
          const f = (x: number) => formatMoney(x, {}, m.currency);
          return (
            <Card key={c.market} className="country-col" data-testid={`asean-${c.market}`}>
              <div className="row-between">
                <div>
                  <span className="eyebrow">
                    {m.name} · {m.currency.code}
                  </span>
                  <h2>{own ? state.profile.displayName || 'Your records' : 'Sample workbook'}</h2>
                </div>
                <Pill tone={own ? 'good' : 'neutral'}>{own ? 'Your records' : 'Synthetic'}</Pill>
              </div>
              <p className="small ink2">{own ? `${state.transactions.length} transactions, ${state.incomeSources.length} income sources and ${state.bills.length} bills from your own records.` : c.who}</p>
              <label className="field">
                <span>Country-specific shock</span>
                <select className="input" value={preset.id} onChange={(e) => setChoice({ ...choice, [c.market]: e.target.value })} data-testid={`asean-shock-${c.market}`}>
                  {presetsFor(c.market).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </label>
              <div className="callout neutral small">
                <div>
                  <strong>{preset.label}</strong>: {input.costCents ? f(input.costCents) : 'no direct cost'}
                  {input.incomeLossDays ? `, ${input.incomeLossDays} days without income` : ''}, on {formatDate(addDays(today, input.offsetDays))}.
                </div>
              </div>
              <div>
                <div className="compare-row">
                  <span>Safe to save</span>
                  <span className="num">
                    {f(r.before.recommendedCents)} <span className="arrow">→</span> <strong data-testid={`asean-after-${c.market}`}>{f(r.after.recommendedCents)}</strong>
                  </span>
                </div>
                <div className="compare-row">
                  <span>Status</span>
                  <span>
                    {STATUS_META[r.before.status].label} <span className="arrow">→</span> <strong>{STATUS_META[r.after.status].label}</strong>
                  </span>
                </div>
                <div className="compare-row">
                  <span>Emergency savings</span>
                  <span className="num">
                    {f(r.emergencyBeforeCents)} <span className="arrow">→</span> {f(r.emergencyAfterCents)}
                  </span>
                </div>
                <div className="compare-row">
                  <span>Paid from savings / cash</span>
                  <span className="num">
                    {f(r.emergencyUsedCents)} / {f(r.costFromCashCents)}
                  </span>
                </div>
                <div className="compare-row">
                  <span>Income lost</span>
                  <span className="num">{f(r.incomeLostCents)}</span>
                </div>
                <div className="compare-row">
                  <span>Essentials short</span>
                  <span className="num" style={{ color: r.shortfallCents > 0 ? 'var(--critical)' : undefined, fontWeight: 700 }}>
                    {f(r.shortfallCents)}
                  </span>
                </div>
                <div className="compare-row">
                  <span>Essentials covered by savings</span>
                  <span>
                    {describeCoverage(r.coverageBeforeMonths)} <span className="arrow">→</span> {describeCoverage(r.coverageAfterMonths)}
                  </span>
                </div>
                <div className="compare-row">
                  <span>Rebuild savings to {f(r.emergencyBeforeCents)}</span>
                  <span className="num">
                    {balanced.weeksToTarget === null ? 'not reachable yet' : balanced.weeksToTarget === 0 ? 'nothing to rebuild' : `${f(balanced.weeklyCents)}/wk, ~${balanced.weeksToTarget} wks`}
                  </span>
                </div>
              </div>
              <p className="xsmall muted">{r.strategy[0]}</p>
              <button className="btn sm" onClick={() => (setCountry(c.market), go('overview'))} data-testid={`asean-open-${c.market}`}>
                {own ? `Open ${m.name}` : `Set up ${m.name}`} <LuArrowRight />
              </button>
            </Card>
          );
        })}
      </div>

      <Card>
        <CardHead title="Same rule, different settings" sub="What the engine reads from each country's configuration (src/config/markets.ts)." />
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Setting</th>
                {COLUMNS.map((c) => (
                  <th key={c.market}>{MARKETS[c.market].name}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(
                [
                  ['Currency (minor units)', (m) => `${m.currency.code} (${m.currency.minorUnits})`],
                  ['Example amount format', (m) => formatMoney(minor(m, 1234567 / 100), {}, m.currency)],
                  ['Rounding of recommendations', (m) => formatMoney(minor(m, m.rounding.stepMajor), {}, m.currency)],
                  ['Below this, advise pausing', (m) => formatMoney(minor(m, m.rounding.minActionableMajor), {}, m.currency)],
                  ['Default cash reserve', (m) => formatMoney(minor(m, m.defaultReserveMajor), {}, m.currency)],
                  ['First milestones', (m) => m.milestonesMajor.map((x) => formatMoney(minor(m, x), {}, m.currency)).join(', ')],
                  ['Income rhythms offered', (m) => m.incomeFrequencies.join(', ')],
                  ['Public health scheme label', (m) => m.health.publicScheme],
                  ['Languages', (m) => m.languages.map((l) => l.label).join(', ')],
                  ['Cash-heavy design', (m) => (m.cashHeavy ? 'Yes' : 'No')],
                  ['Data protection law', (m) => m.dataProtectionLaw],
                ] as Array<[string, (m: (typeof MARKETS)[MarketCode]) => string]>
              ).map(([label, fn]) => (
                <tr key={label}>
                  <td>{label}</td>
                  {COLUMNS.map((c) => (
                    <td key={c.market} className="small">
                      {fn(MARKETS[c.market])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid grid-2">
        <Card>
          <CardHead title="Reusable everywhere" sub="Identical code in every country." />
          <ul className="small ink2" style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 6 }}>
            <li>Integer minor-unit arithmetic and date handling (domain/money.ts, dates.ts)</li>
            <li>Daily cash projection and the safe-to-save rule: lowest projected balance minus reserve (forecast.ts, engine.ts)</li>
            <li>Certainty-weighted income: confirmed, expected (minus variability), uncertain (not counted)</li>
            <li>Confidence scoring, statuses, explanations and limiting factor</li>
            <li>Shock accounting, recovery scenarios and the benchmark (shock.ts, recovery.ts, benchmark.ts)</li>
            <li>Spreadsheet import, income and bill detection, cash book, persistence, offline operation and the connector interface</li>
          </ul>
        </Card>
        <Card>
          <CardHead title="Needs local adaptation" sub="Configuration and content, researched per country." />
          <ul className="small ink2" style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 6 }}>
            <li>Currency, number format, rounding and milestone sizes</li>
            <li>Language and plain-language wording (Chinese, Malay, Tamil, Filipino and Burmese strings here are drafts)</li>
            <li>Subcategories and merchant rules (sari-sari, palengke, zay, tea shop, line car ...)</li>
            <li>Quick-pick categories for the cash book</li>
            <li>Payment providers and their honest connection status</li>
            <li>Typical emergencies and public assistance references</li>
            <li>Health bill payer labels (MediSave, PhilHealth, BPJS Kesehatan)</li>
            <li>Data protection law, consent wording and regulator engagement</li>
          </ul>
        </Card>
      </div>
    </div>
  );
}
