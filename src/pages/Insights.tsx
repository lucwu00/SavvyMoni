import { useMemo, useState } from 'react';
import { LuPlus, LuStethoscope, LuTrash2 } from 'react-icons/lu';
import { classify } from '../domain/classifier';
import { addDays, formatDate, isISODate, startOfWeek, type ISODate } from '../domain/dates';
import { outOfPocket } from '../domain/forecast';
import { uid } from '../domain/ids';
import { formatMoney, type Cents } from '../domain/money';
import { spendItems, type SpendItem } from '../domain/spending';
import type { HealthBill, Transaction, TransactionLine } from '../domain/types';
import { manualTransaction } from '../state/reducer';
import { useStore } from '../state/store';
import { minor } from '../config/markets';
import { Columns, HBars } from '../ui/charts';
import { Callout, Card, CardHead, ConfirmButton, Field, Modal, Money, MoneyInput, PageHead, RecordsBadge, Segmented, SourceBadge, Stat } from '../ui/components';
import { LiveRecommendation } from './Finances';
import { spendBreakdown } from './shared';

type Tab = 'overview' | 'groceries' | 'transport' | 'healthcare';

function weeksBack(today: ISODate, n: number): ISODate[] {
  const start = startOfWeek(today);
  return Array.from({ length: n }, (_, i) => addDays(start, -(n - 1 - i) * 7));
}

function weeklyTotals(items: SpendItem[], weeks: ISODate[]): number[] {
  return weeks.map((w) => items.filter((i) => i.date >= w && i.date < addDays(w, 7)).reduce((t, i) => t + i.amountCents, 0));
}

const sd = (xs: number[]) => {
  const m = xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, xs.length));
};

export function Insights() {
  const [tab, setTab] = useState<Tab>('overview');
  return (
    <div className="page">
      <PageHead title="Spending insights" sub="Singapore-specific spending patterns from your transactions, receipts and bills." />
      <Segmented<Tab>
        label="Insight"
        value={tab}
        onChange={setTab}
        options={[
          { value: 'overview', label: 'Overview' },
          { value: 'groceries', label: 'Groceries' },
          { value: 'transport', label: 'Transport' },
          { value: 'healthcare', label: 'Healthcare' },
        ]}
      />
      {tab === 'overview' ? <OverviewTab /> : tab === 'groceries' ? <Groceries /> : tab === 'transport' ? <Transport /> : <Healthcare />}
    </div>
  );
}

function OverviewTab() {
  const { state, today } = useStore();
  const all = useMemo(() => state.transactions.flatMap(spendItems), [state.transactions]);
  const weeks = weeksBack(today, 8);
  const ess = weeklyTotals(all.filter((i) => i.essentiality !== 'discretionary'), weeks);
  const disc = weeklyTotals(all.filter((i) => i.essentiality === 'discretionary'), weeks);
  const breakdown = spendBreakdown(state, today);
  const totalEss = breakdown.reduce((t, r) => t + r.segments[0].value, 0);
  const totalDisc = breakdown.reduce((t, r) => t + r.segments[1].value, 0);
  const review = state.transactions.filter((t) => t.amountCents < 0 && t.essentiality === 'review').length;
  return (
    <>
      <div className="grid grid-3">
        <Card>
          <Stat label="Essential spending, 4 weeks" value={<Money cents={totalEss} />} sub="Includes bill payments" />
        </Card>
        <Card>
          <Stat label="Discretionary spending, 4 weeks" value={<Money cents={totalDisc} />} sub={`${Math.round((totalDisc / Math.max(1, totalEss + totalDisc)) * 100)}% of spending`} />
        </Card>
        <Card>
          <Stat label="Needs review" value={review} sub="Unclassified items are treated as essential until you decide" />
        </Card>
      </div>
      <div className="grid grid-2">
        <Card>
          <CardHead title="By category" sub="Last 4 weeks." right={<RecordsBadge />} />
          <HBars
            rows={breakdown}
            legend={[
              { name: 'Essential', color: 'var(--brand)' },
              { name: 'Discretionary', color: 'var(--series-2)' },
            ]}
          />
        </Card>
        <Card>
          <CardHead title="Weekly spending" sub="Last 8 weeks, Monday to Sunday." />
          <Columns
            ariaLabel="Weekly essential and discretionary spending"
            labels={weeks.map((w) => formatDate(w))}
            series={[
              { name: 'Essential', color: 'var(--brand)', values: ess },
              { name: 'Discretionary', color: 'var(--series-2)', values: disc },
            ]}
          />
        </Card>
      </div>
    </>
  );
}

const RETAILERS: Array<{ id: string; label: string }> = [
  { id: 'fairprice', label: 'FairPrice' },
  { id: 'sheng-siong', label: 'Sheng Siong' },
  { id: 'giant', label: 'Giant' },
  { id: 'cold-storage', label: 'Cold Storage' },
  { id: 'wet-market', label: 'Wet markets' },
  { id: 'other', label: 'Minimarts & online' },
];

function retailerOf(t: Transaction): string {
  const sub = classify(t.merchant, t.merchant, -1).subcategory;
  return RETAILERS.some((r) => r.id === sub) ? sub : 'other';
}

const STORES: Record<string, string[]> = {
  SG: ['FairPrice', 'Sheng Siong', 'Giant', 'Cold Storage', 'Wet market', 'Minimart'],
  PH: ['Sari-sari store', 'Palengke', 'Supermarket'],
  MM: ['Zay (market)', 'Corner shop', 'Supermarket'],
};

/** What a grocery budget does, and does not do, to the savings plan. */
function BudgetEffect({ budget, usualMonthly }: { budget: Cents; usualMonthly: Cents }) {
  if (budget <= 0)
    return <p className="xsmall muted" style={{ marginTop: 10 }}>Set a monthly budget to track your groceries against it.</p>;
  if (usualMonthly <= 0) return null;
  const diff = usualMonthly - budget;
  return (
    <div className="callout neutral" style={{ marginTop: 12 }} data-testid="budget-effect">
      <div className="small">
        {diff > 0 ? (
          <>
            You usually spend about <strong>{formatMoney(usualMonthly)}</strong> a month on groceries. Keeping to {formatMoney(budget)} would free about{' '}
            <strong>{formatMoney(diff)} a month</strong> for savings.{' '}
          </>
        ) : (
          <>
            Your budget covers your usual {formatMoney(usualMonthly)} a month with {formatMoney(-diff)} to spare.{' '}
          </>
        )}
        <span className="muted">
          The budget is a goal to track. To keep essentials safe, SavvyMoni plans with what you actually spend, so safe-to-save rises once your records show the lower spending.
        </span>
      </div>
    </div>
  );
}

function Groceries() {
  const { state, today, dispatch, notify, rec, market } = useStore();
  const isSG = state.marketCode === 'SG';
  const [adding, setAdding] = useState(false);
  const groceryTx = state.transactions.filter((t) => t.amountCents < 0 && (t.category === 'groceries' || t.lines?.some((l) => l.category === 'groceries')));
  const items = groceryTx.flatMap(spendItems);
  const weeks = weeksBack(today, 8);
  const weekly = weeklyTotals(items, weeks);
  const monthStart = today.slice(0, 8) + '01';
  const monthToDate = items.filter((i) => i.date >= monthStart).reduce((t, i) => t + i.amountCents, 0);
  const budget = state.settings.groceryBudgetCents;
  const avgWeekly = weekly.slice(0, -1).reduce((a, b) => a + b, 0) / Math.max(1, weekly.length - 1);
  const variability = avgWeekly > 0 ? sd(weekly.slice(0, -1)) / avgWeekly : 0;
  const last28 = items.filter((i) => i.date >= addDays(today, -28));
  const recent = groceryTx.filter((t) => t.date >= addDays(today, -28));
  const sumOf = (txs: Transaction[]) => txs.reduce((t, x) => t + spendItems(x).reduce((a, i) => a + i.amountCents, 0), 0);
  const byRetailer = isSG
    ? RETAILERS.map((r) => ({ label: r.label, segments: [{ name: 'Spend', value: sumOf(recent.filter((t) => retailerOf(t) === r.id)), color: 'var(--series-3)' }] })).filter((r) => r.segments[0].value > 0)
    : [...new Set(recent.map((t) => t.merchant))].map((m) => ({ label: m, segments: [{ name: 'Spend', value: sumOf(recent.filter((t) => t.merchant === m)), color: 'var(--series-3)' }] })).sort((a, b) => b.segments[0].value - a.segments[0].value).slice(0, 6);
  const lineGroups = new Map<string, number>();
  for (const t of groceryTx.filter((x) => x.date >= addDays(today, -28) && x.lines)) for (const l of t.lines!) lineGroups.set(l.label, (lineGroups.get(l.label) ?? 0) + l.amountCents);
  const fp = groceryTx.slice(0, 8);

  return (
    <>
      <LiveRecommendation />
      <div className="grid grid-4">
        <Card>
          <Stat label="This month so far" value={<Money cents={monthToDate} />} sub={`Budget ${formatMoney(budget)}`} />
        </Card>
        <Card>
          <Stat label="Average week" value={<Money cents={Math.round(avgWeekly)} />} sub="Last 7 full weeks" />
        </Card>
        <Card>
          <Stat label="Week-to-week swing" value={`±${Math.round(variability * 100)}%`} sub={variability > 0.35 ? 'Irregular: bulk buys or gaps' : 'Fairly steady'} />
        </Card>
        <Card>
          <Stat label="Next 2 weeks" value={<Money cents={Math.round(avgWeekly * 2)} />} sub="Expected; already protected as everyday essentials" />
        </Card>
      </div>
      <div className="grid grid-2">
        <Card>
          <CardHead title="Weekly grocery spending" sub="Against your monthly budget, spread by week." />
          <Columns ariaLabel="Weekly grocery spending" labels={weeks.map((w) => formatDate(w))} series={[{ name: 'Groceries', color: 'var(--series-3)', values: weekly }]} reference={{ value: Math.round((budget * 12) / 52), label: 'Weekly budget' }} />
          <div className="row" style={{ marginTop: 10, alignItems: 'flex-end' }}>
            <div style={{ width: 170 }}>
              <Field label="Monthly grocery budget">
                <MoneyInput value={budget} onChange={(c) => dispatch({ type: 'UPDATE_SETTINGS', patch: { groceryBudgetCents: c } })} />
              </Field>
            </div>
            {budget > 0 ? (
              <span className="small" style={{ color: monthToDate > budget ? 'var(--critical)' : 'var(--good)' }}>
                {monthToDate > budget ? `${formatMoney(monthToDate - budget)} over budget this month` : `${formatMoney(budget - monthToDate)} left this month`}
              </span>
            ) : null}
          </div>
          <BudgetEffect budget={budget} usualMonthly={Math.round((avgWeekly * 52) / 12)} />
        </Card>
        <Card>
          <CardHead title="By retailer and basket" sub="Last 4 weeks. Basket lines come from itemised receipts." />
          <HBars rows={byRetailer} />
          <hr className="divider" style={{ margin: '14px 0' }} />
          <div className="list">
            {[...lineGroups.entries()]
              .sort((a, b) => b[1] - a[1])
              .map(([label, v]) => (
                <div className="list-row" key={label} style={{ padding: '6px 0' }}>
                  <span className="grow small">{label}</span>
                  <span className="amount small">{formatMoney(v)}</span>
                </div>
              ))}
          </div>
          <p className="xsmall muted">{last28.filter((i) => i.essentiality === 'discretionary').length} discretionary items such as snacks are kept out of protected essentials.</p>
        </Card>
      </div>
      <Card>
        <CardHead
          title="Recent grocery purchases"
          sub={isSG ? 'From your imported statements and receipts you add. Add a receipt to split groceries from pharmacy items and treats.' : 'From your cash book and imported records. Add a purchase to split essentials from treats.'}
          right={
            <div className="row">
              <button className="btn sm primary" onClick={() => setAdding(true)} data-testid="add-purchase">
                <LuPlus /> Add purchase
              </button>
            </div>
          }
        />
        <div className="list" data-testid="fairprice-history">
          {fp.length === 0 ? <p className="small muted">No grocery purchases yet. Import a statement or add a purchase.</p> : null}
          {fp.map((t) => (
            <div className="list-row" key={t.id}>
              <div className="grow">
                <div className="title">{t.merchant}</div>
                <div className="meta">
                  {formatDate(t.date)}
                  {t.lines?.length ? ` · ${t.lines.map((l) => l.label).join(', ')}` : ''}
                </div>
              </div>
              <Money cents={-t.amountCents} className="amount" />
            </div>
          ))}
        </div>
      </Card>
      {adding ? (
        <AddPurchase
          today={today}
          onClose={() => setAdding(false)}
          onSave={(t) => {
            const before = rec.recommendedCents;
            dispatch({ type: 'ADD_TRANSACTION', tx: t, affectBalance: true });
            setAdding(false);
            notify(`Purchase added. Safe-to-save was ${formatMoney(before)}; check the updated amount above.`);
          }}
          rules={state.rules}
          stores={STORES[state.marketCode] ?? STORES.SG}
          defaultAmount={minor(market, market.rounding.stepMajor) * 9}
        />
      ) : null}
    </>
  );
}

function AddPurchase({ today, onClose, onSave, rules, stores, defaultAmount }: { today: ISODate; onClose: () => void; onSave: (t: Transaction) => void; rules: Parameters<typeof manualTransaction>[3]; stores: string[]; defaultAmount: Cents }) {
  const [store, setStore] = useState(stores[0]);
  const [groceries, setGroceries] = useState<Cents>(defaultAmount);
  const [household, setHousehold] = useState<Cents>(0);
  const [pharmacy, setPharmacy] = useState<Cents>(0);
  const [snacks, setSnacks] = useState<Cents>(0);
  const [date, setDate] = useState(today);
  const total = groceries + household + pharmacy + snacks;
  const valid = total > 0 && isISODate(date) && date <= today;
  const providerId = store === 'FairPrice' ? 'fairprice' : 'cash-ledger';
  const submit = () => {
    const id = uid('tx');
    const lines: TransactionLine[] = [
      { id: `${id}-1`, label: 'Fresh food & pantry', amountCents: groceries, category: 'groceries', subcategory: classify(store, '', -1).subcategory, essentiality: 'essential' },
      { id: `${id}-2`, label: 'Household essentials', amountCents: household, category: 'groceries', subcategory: 'household-essentials', essentiality: 'essential' },
      { id: `${id}-3`, label: 'Pharmacy', amountCents: pharmacy, category: 'healthcare', subcategory: 'pharmacy', essentiality: 'adjustable' },
      { id: `${id}-4`, label: 'Snacks & drinks', amountCents: snacks, category: 'groceries', subcategory: 'snacks', essentiality: 'discretionary' },
    ].filter((l) => l.amountCents > 0) as TransactionLine[];
    const t = manualTransaction(store, -total, date, rules, lines.length > 1 ? lines : undefined, providerId);
    onSave({ ...t, source: 'user' });
  };
  return (
    <Modal
      title="Add a grocery purchase"
      onClose={onClose}
      footer={
        <button className="btn primary" disabled={!valid} onClick={submit} data-testid="purchase-save">
          Add {formatMoney(total)} purchase
        </button>
      }
    >
      <p className="small muted">Split the receipt so only essentials are protected. Your spending balance is reduced by the total.</p>
      <div className="form-grid">
        <Field label="Store">
          <select className="input" value={store} onChange={(e) => setStore(e.target.value)} data-testid="purchase-store">
            {stores.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </Field>
        <Field label="Date">
          <input className="input" type="date" max={today} value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Groceries">
          <MoneyInput value={groceries} onChange={setGroceries} testId="purchase-groceries" />
        </Field>
        <Field label="Household essentials">
          <MoneyInput value={household} onChange={setHousehold} />
        </Field>
        <Field label="Pharmacy items">
          <MoneyInput value={pharmacy} onChange={setPharmacy} />
        </Field>
        <Field label="Snacks & treats">
          <MoneyInput value={snacks} onChange={setSnacks} />
        </Field>
      </div>
    </Modal>
  );
}

function Transport() {
  const { state, today, market } = useStore();
  const items = state.transactions.flatMap(spendItems).filter((i) => i.category === 'transport');
  const weeks = weeksBack(today, 8);
  const pub = (i: SpendItem) => ['mrt', 'bus', 'simplygo', 'ezlink', 'jeepney', 'tricycle', 'line-car'].includes(i.subcategory);
  const ride = (i: SpendItem) => ['grab-ride', 'taxi'].includes(i.subcategory);
  const veh = (i: SpendItem) => !pub(i) && !ride(i);
  const sPub = weeklyTotals(items.filter(pub), weeks);
  const sRide = weeklyTotals(items.filter(ride), weeks);
  const sVeh = weeklyTotals(items.filter(veh), weeks);
  const avg = (xs: number[]) => Math.round(xs.slice(0, -1).reduce((a, b) => a + b, 0) / Math.max(1, xs.length - 1));
  const essentialWeekly = avg(sPub) + avg(sVeh);
  const rideAvg = avg(sRide);
  const vehicleBills = state.bills.filter((b) => b.category === 'transport' || /motor|instal/i.test(b.name));
  return (
    <>
      <div className="grid grid-4">
        <Card>
          <Stat label="Public transport / week" value={<Money cents={avg(sPub)} />} sub="MRT, bus, SimplyGo" />
        </Card>
        <Card>
          <Stat label="Ride-hailing & taxi / week" value={<Money cents={rideAvg} />} sub="Adjustable" />
        </Card>
        <Card>
          <Stat label="Fuel & vehicle / week" value={<Money cents={avg(sVeh)} />} sub="Excludes instalments" />
        </Card>
        <Card>
          <Stat label="Essential transport budget" value={<Money cents={essentialWeekly} />} sub="Per week, protected" />
        </Card>
      </div>
      <div className="grid grid-2">
        <Card>
          <CardHead title="Weekly commuting cost" right={<RecordsBadge />} />
          <Columns
            ariaLabel="Weekly transport cost by mode"
            labels={weeks.map((w) => formatDate(w))}
            series={[
              { name: 'Public transport', color: 'var(--series-1)', values: sPub },
              { name: 'Ride-hailing', color: 'var(--series-2)', values: sRide },
              { name: 'Fuel & vehicle', color: 'var(--series-3)', values: sVeh },
            ]}
          />
        </Card>
        <Card>
          <CardHead title="Scenarios" sub="Estimates from your last 7 weeks." />
          <div className="stack">
            <Callout tone="neutral">
              <strong>Switch half of ride-hailing to MRT and bus:</strong> frees about {formatMoney(Math.round(rideAvg * 0.5 * 0.7))} a week, assuming the same trips cost about 30% as much by public transport.
            </Callout>
            <Callout tone="neutral">
              <strong>If income stops:</strong> keep about {formatMoney(avg(sPub) || minor(market, market.rounding.stepMajor) * 3)} a week for public transport to job interviews and appointments. This stays protected in every plan.
            </Callout>
            {vehicleBills.length ? (
              <Callout tone="neutral">
                <strong>Vehicle commitments:</strong> {vehicleBills.map((b) => `${b.name} ${formatMoney(b.amountCents)}`).join(', ')} continue even when you can't ride. The emergency simulator's vehicle breakdown scenario includes days off the road.
              </Callout>
            ) : null}
          </div>
        </Card>
      </div>
    </>
  );
}

const PROVIDER_TYPES: HealthBill['providerType'][] = ['polyclinic', 'gp', 'hospital', 'specialist', 'dental', 'pharmacy'];
const PT_LABEL: Record<HealthBill['providerType'], string> = { polyclinic: 'Polyclinic', gp: 'GP clinic', hospital: 'Public hospital', specialist: 'Specialist', dental: 'Dental', pharmacy: 'Pharmacy' };

function Healthcare() {
  const { state, dispatch, notify, today, rec, market } = useStore();
  const [adding, setAdding] = useState(false);
  const unpaid = state.healthBills.filter((h) => h.status === 'unpaid');
  const unpaidOop = unpaid.reduce((t, h) => t + outOfPocket(h), 0);
  const last90 = state.transactions.flatMap(spendItems).filter((i) => i.category === 'healthcare' && i.date >= addDays(today, -90));
  const paid90 = last90.reduce((t, i) => t + i.amountCents, 0);
  const typical = minor(market, market.benchmarkShockMajor);
  return (
    <>
      <Callout tone="neutral" icon={<LuStethoscope aria-hidden />}>
        Only bill amounts and due dates are used. No health records, diagnoses, digital ID logins or national ID numbers are ever requested. {market.health.publicScheme.replace(/ (used|covers)$/, '')} or insurance is only counted when you enter it.
      </Callout>
      <div className="grid grid-3">
        <Card>
          <Stat label="Unpaid out-of-pocket" value={<Money cents={unpaidOop} />} sub={`${unpaid.length} bill${unpaid.length === 1 ? '' : 's'}, protected in your plan`} />
        </Card>
        <Card>
          <Stat label="Health spending, 90 days" value={<Money cents={paid90} />} sub="From transactions and receipts" />
        </Card>
        <Card>
          <Stat
            label="Healthcare buffer to aim for"
            value={<Money cents={unpaidOop + typical} />}
            sub={`Unpaid bills + ${formatMoney(typical)} for one unexpected visit. Savings cover ${rec.emergencyCents >= unpaidOop + typical ? 'this' : `${Math.round((rec.emergencyCents / (unpaidOop + typical)) * 100)}%`}.`}
          />
        </Card>
      </div>
      <Card>
        <CardHead
          title="Medical bills"
          sub={`Billed amount, subsidy, insurance and ${market.health.publicScheme.replace(/ (used|covers)$/, '')} are shown separately. Only what you pay is protected.`}
          right={
            <button className="btn sm primary" onClick={() => setAdding(true)} data-testid="add-medical">
              <LuPlus /> Add medical bill
            </button>
          }
        />
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Provider</th>
                <th>Due</th>
                <th className="r">Billed</th>
                <th className="r">Subsidy</th>
                <th className="r">Insurance</th>
                <th className="r">{market.health.publicScheme.replace(/ (used|covers)$/, '')}</th>
                <th className="r">You pay</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {state.healthBills.length === 0 ? (
                <tr>
                  <td colSpan={9} className="muted">
                    No medical bills. Add one, or connect the HealthHub-style demo in the Integrations hub.
                  </td>
                </tr>
              ) : null}
              {state.healthBills.map((h) => (
                <tr key={h.id}>
                  <td>
                    <div style={{ fontWeight: 600 }}>{h.provider}</div>
                    <div className="row" style={{ gap: 6 }}>
                      <span className="xsmall muted">{PT_LABEL[h.providerType]}</span>
                      <SourceBadge source={h.source} />
                    </div>
                  </td>
                  <td className="num">{formatDate(h.dueDate)}</td>
                  <td className="r num">{formatMoney(h.billedCents)}</td>
                  <td className="r num">{formatMoney(-h.subsidyCents)}</td>
                  <td className="r num">{formatMoney(-h.insuranceCents)}</td>
                  <td className="r num">{formatMoney(-h.medisaveCents)}</td>
                  <td className="r amount">{formatMoney(outOfPocket(h))}</td>
                  <td>{h.status === 'paid' ? <span className="pill tone-good">Paid</span> : <span className="pill tone-neutral">Unpaid</span>}</td>
                  <td>
                    <div className="row" style={{ gap: 4, flexWrap: 'nowrap' }}>
                      {h.status === 'unpaid' ? (
                        <button className="btn sm" onClick={() => (dispatch({ type: 'PAY_HEALTH_BILL', id: h.id }), notify('Medical bill marked paid'))}>
                          Mark paid
                        </button>
                      ) : null}
                      <ConfirmButton className="btn sm ghost icon" label="" icon={<LuTrash2 aria-label="Delete bill" />} confirmLabel="Delete" onConfirm={() => dispatch({ type: 'DELETE_HEALTH_BILL', id: h.id })} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      {adding ? (
        <AddMedicalBill
          today={today}
          onClose={() => setAdding(false)}
          onSave={(b) => {
            dispatch({ type: 'ADD_HEALTH_BILL', bill: b });
            setAdding(false);
            notify(`${formatMoney(outOfPocket(b))} medical bill added and protected`);
          }}
        />
      ) : null}
    </>
  );
}

function AddMedicalBill({ today, onClose, onSave }: { today: ISODate; onClose: () => void; onSave: (b: HealthBill) => void }) {
  const { market } = useStore();
  const [b, setB] = useState<HealthBill>({
    id: uid('hb'),
    provider: 'Dental clinic',
    providerType: 'dental',
    visitDate: today,
    dueDate: addDays(today, 7),
    billedCents: minor(market, market.benchmarkShockMajor),
    subsidyCents: 0,
    insuranceCents: 0,
    medisaveCents: 0,
    status: 'unpaid',
    source: 'user',
  });
  const cover = b.subsidyCents + b.insuranceCents + b.medisaveCents;
  const valid = b.provider.trim() && b.billedCents > 0 && cover <= b.billedCents && isISODate(b.dueDate);
  return (
    <Modal
      title="Add a medical bill"
      onClose={onClose}
      footer={
        <button className="btn primary" disabled={!valid} onClick={() => valid && onSave(b)} data-testid="medical-save">
          Add bill ({formatMoney(outOfPocket(b))} to pay)
        </button>
      }
    >
      <div className="form-grid">
        <Field label="Clinic or hospital">
          <input className="input" value={b.provider} onChange={(e) => setB({ ...b, provider: e.target.value.slice(0, 60) })} />
        </Field>
        <Field label="Type">
          <select className="input" value={b.providerType} onChange={(e) => setB({ ...b, providerType: e.target.value as HealthBill['providerType'] })}>
            {PROVIDER_TYPES.map((p) => (
              <option key={p} value={p}>
                {PT_LABEL[p]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Payment due">
          <input className="input" type="date" value={b.dueDate} onChange={(e) => setB({ ...b, dueDate: e.target.value })} />
        </Field>
        <Field label="Billed amount">
          <MoneyInput value={b.billedCents} onChange={(c) => setB({ ...b, billedCents: c })} testId="medical-billed" />
        </Field>
        <Field label={market.health.subsidy}>
          <MoneyInput value={b.subsidyCents} onChange={(c) => setB({ ...b, subsidyCents: c })} />
        </Field>
        <Field label={market.health.insurance}>
          <MoneyInput value={b.insuranceCents} onChange={(c) => setB({ ...b, insuranceCents: c })} />
        </Field>
        <Field label={market.health.publicScheme} hint={market.health.schemeNote}>
          <MoneyInput value={b.medisaveCents} onChange={(c) => setB({ ...b, medisaveCents: c })} />
        </Field>
      </div>
      {cover > b.billedCents ? <p className="small" style={{ color: 'var(--critical)' }}>Subsidy, insurance and public scheme together can't be more than the billed amount.</p> : null}
      <p className="small ink2">
        You pay: <strong>{formatMoney(outOfPocket(b))}</strong>. This is protected until it's paid.
      </p>
    </Modal>
  );
}
