import { useMemo, useState } from 'react';
import { LuCheck, LuChevronDown, LuChevronRight, LuPencil, LuPlus, LuTrash2 } from 'react-icons/lu';
import { providerName } from '../connectors/providers';
import { ESSENTIALITY_LABELS, categoryLabel, subcategoryLabel, spendingCategoriesFor } from '../domain/categories';
import { minor } from '../config/markets';
import { addDays, diffDays, formatDate, isISODate, relativeDay, startOfWeek } from '../domain/dates';
import { uid } from '../domain/ids';
import { formatMoney, type Cents } from '../domain/money';
import { FREQUENCY_LABELS } from '../domain/recurrence';
import type { Account, IncomeCertainty, IncomeSource, RecurringBill, Transaction, UserRule } from '../domain/types';
import { manualTransaction } from '../state/reducer';
import { useStore } from '../state/store';
import { Card, CardHead, ConfirmButton, Field, Modal, Money, MoneyInput, PageHead, Segmented, SourceBadge, StatusPill } from '../ui/components';
import { BillForm, CategorySelect, EssentialitySelect } from './forms';

type Tab = 'accounts' | 'income' | 'bills' | 'transactions';

export function LiveRecommendation() {
  const { rec, state } = useStore();
  const prev = state.history.length > 1 ? state.history[state.history.length - 2] : null;
  const last = state.history[state.history.length - 1];
  return (
    <Card style={{ padding: 14 }} data-testid="live-rec">
      <div className="row-between">
        <div className="row">
          <span className="eyebrow">Safe to save now</span>
          <strong className="num" style={{ fontSize: '1.2rem' }} data-testid="live-rec-amount">
            {formatMoney(rec.recommendedCents)}
          </strong>
          <StatusPill status={rec.status} />
        </div>
        {prev && last ? (
          <span className="small muted">
            Was {formatMoney(prev.recommendedCents)} · {last.reason}
          </span>
        ) : null}
      </div>
    </Card>
  );
}

export function Finances() {
  const [tab, setTab] = useState<Tab>('income');
  return (
    <div className="page">
      <PageHead title="My finances" sub="Your accounts, income, bills and transactions. Every change updates your safe-to-save amount immediately." />
      <LiveRecommendation />
      <Segmented<Tab>
        label="Section"
        value={tab}
        onChange={setTab}
        options={[
          { value: 'income', label: 'Income' },
          { value: 'bills', label: 'Bills' },
          { value: 'accounts', label: 'Accounts' },
          { value: 'transactions', label: 'Transactions' },
        ]}
      />
      {tab === 'accounts' ? <Accounts /> : tab === 'income' ? <Income /> : tab === 'bills' ? <Bills /> : <Transactions />}
    </div>
  );
}

function Accounts() {
  const { state, dispatch, notify, today } = useStore();
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<Account>({ id: '', name: '', institution: '', kind: 'bank', role: 'spending', balanceCents: 0, asOf: today, source: 'user' });
  return (
    <Card>
      <CardHead
        title="Accounts"
        sub="Balances are as you entered or imported them. Emergency savings can stay in any existing account or as cash."
        right={
          <button className="btn sm" onClick={() => (setDraft({ ...draft, id: uid('acct') }), setAdding(true))}>
            <LuPlus /> Add account
          </button>
        }
      />
      <div className="list">
        {state.accounts.map((a) => (
          <AccountRow key={a.id} a={a} onSave={(c) => (dispatch({ type: 'UPDATE_ACCOUNT', id: a.id, patch: { balanceCents: c } }), notify(`${a.name} updated`))} onDelete={() => dispatch({ type: 'DELETE_ACCOUNT', id: a.id })} />
        ))}
      </div>
      {adding ? (
        <Modal
          title="Add an account"
          onClose={() => setAdding(false)}
          footer={
            <button
              className="btn primary"
              disabled={!draft.name.trim()}
              onClick={() => {
                dispatch({ type: 'ADD_ACCOUNT', account: { ...draft, name: draft.name.trim() } });
                setAdding(false);
              }}
            >
              Add account
            </button>
          }
        >
          <p className="small muted">Only a name and balance. SavvyMoni never asks for account numbers or passwords.</p>
          <div className="form-grid">
            <Field label="Name">
              <input className="input" id="acct-name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value.slice(0, 40), institution: e.target.value.slice(0, 40) })} />
            </Field>
            <Field label="Balance">
              <MoneyInput value={draft.balanceCents} allowNegative onChange={(c) => setDraft({ ...draft, balanceCents: c })} />
            </Field>
            <Field label="Type">
              <select className="input" value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value as Account['kind'] })}>
                <option value="bank">Bank</option>
                <option value="ewallet">E-wallet</option>
                <option value="cash">Cash</option>
              </select>
            </Field>
            <Field label="Used for">
              <select className="input" value={draft.role} onChange={(e) => setDraft({ ...draft, role: e.target.value as Account['role'] })}>
                <option value="spending">Everyday spending</option>
                <option value="emergency">Emergency savings</option>
              </select>
            </Field>
          </div>
        </Modal>
      ) : null}
    </Card>
  );
}

function AccountRow({ a, onSave, onDelete }: { a: Account; onSave: (c: Cents) => void; onDelete: () => void }) {
  const [v, setV] = useState(a.balanceCents);
  const dirty = v !== a.balanceCents;
  return (
    <div className="list-row" style={{ flexWrap: 'wrap' }}>
      <div className="grow">
        <div className="title">{a.name}</div>
        <div className="meta">
          {a.role === 'emergency' ? 'Emergency savings' : 'Everyday spending'} · {a.institution} · as of {formatDate(a.asOf)} <SourceBadge source={a.source} />
        </div>
      </div>
      <div style={{ width: 150 }}>
        <MoneyInput value={v} allowNegative onChange={setV} ariaLabel={`${a.name} balance`} testId={`balance-${a.id}`} />
      </div>
      <button className="btn sm primary" disabled={!dirty} onClick={() => onSave(v)}>
        <LuCheck /> Save
      </button>
      <ConfirmButton className="btn sm ghost danger" label="Remove" confirmLabel="Remove account" onConfirm={onDelete} icon={<LuTrash2 />} />
    </div>
  );
}

const CERTAINTY_LABEL: Record<IncomeCertainty, string> = { confirmed: 'Confirmed', expected: 'Expected (varies)', uncertain: 'Uncertain' };

function Income() {
  const { state, dispatch, today } = useStore();
  return (
    <div className="stack">
      {state.incomeSources.map((s) => (
        <IncomeCard key={s.id} s={s} />
      ))}
      {state.incomeSources.length === 0 ? <Card><p className="muted">No income recorded. Add income so upcoming pay can be planned for.</p></Card> : null}
      <div>
        <button
          className="btn"
          onClick={() =>
            dispatch({
              type: 'ADD_INCOME',
              income: { id: uid('inc'), name: 'New income', kind: 'other', earner: state.profile.displayName, frequency: 'monthly', netAmountCents: 0, nextDate: addDays(today, 14), certainty: 'expected', variability: 0.2, source: 'user' },
            })
          }
        >
          <LuPlus /> Add income
        </button>
      </div>
    </div>
  );
}

function IncomeCard({ s }: { s: IncomeSource }) {
  const { dispatch, notify, today, market } = useStore();
  const [draft, setDraft] = useState(s);
  const step = minor(market, market.rounding.stepMajor);
  const [sliderMax] = useState(Math.max(step * 40, Math.ceil((s.netAmountCents * 2) / (step * 10)) * step * 10));
  const dirty = JSON.stringify(draft) !== JSON.stringify(s);
  const save = (patch: Partial<IncomeSource>) => {
    dispatch({ type: 'UPDATE_INCOME', id: s.id, patch });
  };
  return (
    <Card data-testid={`income-${s.id}`}>
      <CardHead
        title={s.name}
        sub={`${s.earner} · ${FREQUENCY_LABELS[s.frequency]} · next ${formatDate(s.nextDate)} (${relativeDay(s.nextDate, today)})${s.grossAmountCents ? ` · gross ${formatMoney(s.grossAmountCents)} (reference only)` : ''}`}
        right={<SourceBadge source={s.source} />}
      />
      <div className="stack">
        <Field label={`Take-home per payment: ${formatMoney(draft.netAmountCents)}`} hint="Drag to see how a change in income changes your plan. Released values are applied.">
          <input
            type="range"
            min={0}
            max={sliderMax}
            step={step}
            value={Math.min(draft.netAmountCents, sliderMax)}
            aria-label={`${s.name} amount`}
            data-testid={`income-slider-${s.id}`}
            onChange={(e) => setDraft({ ...draft, netAmountCents: Number(e.target.value) })}
            onPointerUp={(e) => save({ netAmountCents: Number((e.target as HTMLInputElement).value) })}
            onKeyUp={(e) => save({ netAmountCents: Number((e.target as HTMLInputElement).value) })}
          />
        </Field>
        <div className="form-grid">
          <Field label="Name">
            <input className="input" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value.slice(0, 50) })} />
          </Field>
          <Field label="Take-home amount">
            <MoneyInput value={draft.netAmountCents} onChange={(c) => setDraft({ ...draft, netAmountCents: c })} testId={`income-amount-${s.id}`} />
          </Field>
          <Field label="How often">
            <select className="input" value={draft.frequency} onChange={(e) => setDraft({ ...draft, frequency: e.target.value as IncomeSource['frequency'] })}>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="fortnightly">Every 2 weeks</option>
              <option value="monthly">Monthly</option>
            </select>
          </Field>
          <Field label="Next payment">
            <input className="input" type="date" value={draft.nextDate} onChange={(e) => isISODate(e.target.value) && setDraft({ ...draft, nextDate: e.target.value })} />
          </Field>
          <Field label="How certain">
            <select className="input" value={draft.certainty} onChange={(e) => setDraft({ ...draft, certainty: e.target.value as IncomeCertainty })} data-testid={`income-certainty-${s.id}`}>
              {(Object.keys(CERTAINTY_LABEL) as IncomeCertainty[]).map((k) => (
                <option key={k} value={k}>
                  {CERTAINTY_LABEL[k]}
                </option>
              ))}
            </select>
          </Field>
          <Field label={`Typical swing: ±${Math.round(draft.variability * 100)}%`} hint="How much one payment differs from the usual.">
            <input type="range" min={0} max={60} value={Math.round(draft.variability * 100)} onChange={(e) => setDraft({ ...draft, variability: Number(e.target.value) / 100 })} />
          </Field>
        </div>
        <div className="row">
          <button className="btn primary sm" disabled={!dirty} onClick={() => (save(draft), notify('Income updated'))} data-testid={`income-save-${s.id}`}>
            <LuCheck /> Save changes
          </button>
          <button
            className="btn sm"
            onClick={() => {
              dispatch({ type: 'RECEIVE_INCOME', id: s.id });
              notify(`${s.name} recorded as received`);
            }}
          >
            Mark next payment received
          </button>
          <ConfirmButton className="btn sm ghost danger" label="Remove" confirmLabel="Remove income" icon={<LuTrash2 />} onConfirm={() => dispatch({ type: 'DELETE_INCOME', id: s.id })} />
        </div>
      </div>
    </Card>
  );
}

function billStatus(b: RecurringBill, today: string): { label: string; tone: string } {
  if (b.frequency === 'once' && b.status === 'paid') return { label: `Paid ${b.lastPaid ? formatDate(b.lastPaid) : ''}`, tone: 'good' };
  if (b.nextDue < today) return { label: 'Overdue', tone: 'critical' };
  if (b.lastPaid && diffDays(b.lastPaid, today) < 28) return { label: `Paid ${formatDate(b.lastPaid)} · next unpaid`, tone: 'good' };
  return { label: 'Unpaid', tone: 'neutral' };
}

function Bills() {
  const { state, dispatch, notify, today } = useStore();
  const [editing, setEditing] = useState<RecurringBill | null>(null);
  const [adding, setAdding] = useState(false);
  const groups = useMemo(() => {
    const sorted = [...state.bills].sort((a, b) => (a.nextDue < b.nextDue ? -1 : 1));
    const thisWeek = startOfWeek(today);
    const label = (d: string) => {
      if (d < today) return 'Overdue';
      const w = Math.floor(diffDays(thisWeek, startOfWeek(d)) / 7);
      return w === 0 ? 'This week' : w === 1 ? 'Next week' : w <= 4 ? `Week of ${formatDate(startOfWeek(d))}` : 'Later';
    };
    const map = new Map<string, RecurringBill[]>();
    for (const b of sorted) {
      const key = b.frequency === 'once' && b.status === 'paid' ? 'Paid one-off bills' : label(b.nextDue);
      map.set(key, [...(map.get(key) ?? []), b]);
    }
    return [...map.entries()];
  }, [state.bills, today]);

  return (
    <Card>
      <CardHead
        title="Bills calendar"
        sub="Protected bills are set aside before any savings recommendation. Marking a bill paid lowers your cash and moves it to the next due date."
        right={
          <button className="btn sm primary" onClick={() => setAdding(true)} data-testid="add-bill">
            <LuPlus /> Add bill
          </button>
        }
      />
      <div className="stack">
        {groups.map(([g, bills]) => (
          <div key={g}>
            <div className="eyebrow" style={{ margin: '6px 0 2px' }}>
              {g}
            </div>
            <div className="list">
              {bills.map((b) => {
                const st = billStatus(b, today);
                return (
                  <div className="list-row" key={b.id} style={{ flexWrap: 'wrap' }} data-testid={`bill-${b.id}`}>
                    <div className="grow">
                      <div className="title">{b.name}</div>
                      <div className="meta">
                        <span>{categoryLabel(b.category)}</span>·<span>{FREQUENCY_LABELS[b.frequency]}</span>·<span>due {formatDate(b.nextDue)}</span>
                        <span className={`pill tone-${st.tone}`} style={{ padding: '0 8px', fontSize: '0.72rem' }}>
                          {st.label}
                        </span>
                        <span className="badge">{b.priority === 'discretionary' ? 'Optional' : 'Protected'}</span>
                        <SourceBadge source={b.source} />
                        <span className="xsmall">{b.confidence} confidence</span>
                      </div>
                    </div>
                    <Money cents={b.amountCents} className="amount" />
                    <div className="row" style={{ gap: 4 }}>
                      {!(b.frequency === 'once' && b.status === 'paid') ? (
                        <button className="btn sm" onClick={() => (dispatch({ type: 'PAY_BILL', id: b.id }), notify(`${b.name} marked paid`))} data-testid={`pay-${b.id}`}>
                          Mark paid
                        </button>
                      ) : null}
                      <button className="btn sm ghost icon" aria-label={`Edit ${b.name}`} onClick={() => setEditing(b)}>
                        <LuPencil />
                      </button>
                      <ConfirmButton className="btn sm ghost icon danger" label="" icon={<LuTrash2 aria-label={`Delete ${b.name}`} />} confirmLabel="Delete" onConfirm={() => dispatch({ type: 'DELETE_BILL', id: b.id })} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      {adding ? (
        <BillForm
          today={today}
          onClose={() => setAdding(false)}
          onSave={(b) => {
            dispatch({ type: 'ADD_BILL', bill: b });
            setAdding(false);
            notify(`${b.name} added and protected`);
          }}
        />
      ) : null}
      {editing ? (
        <BillForm
          today={today}
          initial={editing}
          onClose={() => setEditing(null)}
          onSave={(b) => {
            dispatch({ type: 'UPDATE_BILL', id: b.id, patch: b });
            setEditing(null);
            notify('Bill updated');
          }}
        />
      ) : null}
    </Card>
  );
}

function Transactions() {
  const { state, dispatch, notify, today } = useStore();
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('all');
  const [src, setSrc] = useState('all');
  const [limit, setLimit] = useState(40);
  const [applyAll, setApplyAll] = useState(true);
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const filtered = state.transactions.filter(
    (t) =>
      (cat === 'all' || t.category === cat || (cat === 'review' && t.essentiality === 'review' && t.amountCents < 0)) &&
      (src === 'all' || t.source === src) &&
      (!q || `${t.merchant} ${t.description}`.toLowerCase().includes(q.toLowerCase())),
  );

  return (
    <Card>
      <CardHead
        title="Transactions"
        sub="Change any category or priority. Mixed receipts (like a FairPrice basket) can be classified line by line."
        right={
          <button className="btn sm primary" onClick={() => setAdding(true)} data-testid="add-tx">
            <LuPlus /> Add transaction
          </button>
        }
      />
      <div className="form-grid" style={{ marginBottom: 12 }}>
        <Field label="Search">
          <input className="input" value={q} placeholder="Merchant or description" onChange={(e) => setQ(e.target.value)} />
        </Field>
        <Field label="Category">
          <select className="input" value={cat} onChange={(e) => setCat(e.target.value)}>
            <option value="all">All categories</option>
            <option value="review">Needs review</option>
            {spendingCategoriesFor(state.marketCode).map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
            <option value="income">Income</option>
          </select>
        </Field>
        <Field label="Source">
          <select className="input" value={src} onChange={(e) => setSrc(e.target.value)}>
            <option value="all">All sources</option>
            <option value="imported">Imported</option>
            <option value="user">Entered by you</option>
          </select>
        </Field>
      </div>
      <label className="check" style={{ marginBottom: 8 }}>
        <input type="checkbox" checked={applyAll} onChange={(e) => setApplyAll(e.target.checked)} />
        When I change a category, apply it to other transactions from the same merchant
      </label>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Merchant</th>
              <th>Category</th>
              <th>Priority</th>
              <th className="r">Amount</th>
              <th>
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {filtered.slice(0, limit).map((t) => (
              <TxRow key={t.id} t={t} open={open === t.id} onToggle={() => setOpen(open === t.id ? null : t.id)} applyAll={applyAll} />
            ))}
          </tbody>
        </table>
      </div>
      <div className="row-between" style={{ marginTop: 10 }}>
        <span className="small muted">
          Showing {Math.min(limit, filtered.length)} of {filtered.length}
        </span>
        {filtered.length > limit ? (
          <button className="btn sm" onClick={() => setLimit(limit + 60)}>
            Show more
          </button>
        ) : null}
      </div>
      {adding ? (
        <AddTransaction
          onClose={() => setAdding(false)}
          onSave={(t, affect) => {
            dispatch({ type: 'ADD_TRANSACTION', tx: t, affectBalance: affect });
            setAdding(false);
            notify('Transaction added');
          }}
          today={today}
          rules={state.rules}
        />
      ) : null}
    </Card>
  );
}

function TxRow({ t, open, onToggle, applyAll }: { t: Transaction; open: boolean; onToggle: () => void; applyAll: boolean }) {
  const { dispatch } = useStore();
  const isIncome = t.amountCents > 0;
  return (
    <>
      <tr>
        <td className="num" style={{ whiteSpace: 'nowrap' }}>
          {formatDate(t.date)}
        </td>
        <td style={{ minWidth: 160 }}>
          <div style={{ fontWeight: 600 }}>{t.merchant}</div>
          <div className="row" style={{ gap: 6 }}>
            <SourceBadge source={t.source} title={providerName(t.providerId)} />
            {t.lines?.length ? (
              <button className="link-btn xsmall" onClick={onToggle} aria-expanded={open}>
                {open ? <LuChevronDown /> : <LuChevronRight />} {t.lines.length} items
              </button>
            ) : null}
            {t.billId ? <span className="badge">Bill payment</span> : null}
            {t.overridden ? <span className="badge">Edited</span> : null}
          </div>
        </td>
        <td style={{ minWidth: 200 }}>
          {t.lines?.length ? (
            <span className="small muted">Mixed basket</span>
          ) : isIncome ? (
            <span className="small">{categoryLabel(t.category)}</span>
          ) : (
            <CategorySelect
              ariaLabel={`Category for ${t.merchant}`}
              category={t.category}
              subcategory={t.subcategory}
              onChange={(c, s) => dispatch({ type: 'UPDATE_TRANSACTION', id: t.id, patch: { category: c, subcategory: s }, applyToMerchant: applyAll })}
            />
          )}
        </td>
        <td style={{ minWidth: 150 }}>
          {isIncome || t.lines?.length ? (
            <span className="small muted">{isIncome ? 'Income' : '—'}</span>
          ) : (
            <EssentialitySelect ariaLabel={`Priority for ${t.merchant}`} value={t.essentiality} onChange={(e) => dispatch({ type: 'UPDATE_TRANSACTION', id: t.id, patch: { essentiality: e }, applyToMerchant: applyAll })} />
          )}
        </td>
        <td className={`r amount ${isIncome ? 'in' : ''}`}>{formatMoney(t.amountCents, { signed: isIncome })}</td>
        <td>
          <ConfirmButton className="btn sm ghost icon" label="" icon={<LuTrash2 aria-label="Delete transaction" />} confirmLabel="Delete" onConfirm={() => dispatch({ type: 'DELETE_TRANSACTION', id: t.id })} />
        </td>
      </tr>
      {open && t.lines
        ? t.lines.map((l) => (
            <tr key={l.id} style={{ background: 'var(--surface-2)' }}>
              <td />
              <td className="small">{l.label}</td>
              <td>
                <CategorySelect ariaLabel={`Category for ${l.label}`} category={l.category} subcategory={l.subcategory} onChange={(c, s) => dispatch({ type: 'UPDATE_LINE', txId: t.id, lineId: l.id, patch: { category: c, subcategory: s } })} />
              </td>
              <td>
                <EssentialitySelect ariaLabel={`Priority for ${l.label}`} value={l.essentiality} onChange={(e) => dispatch({ type: 'UPDATE_LINE', txId: t.id, lineId: l.id, patch: { essentiality: e } })} />
              </td>
              <td className="r amount small">{formatMoney(l.amountCents)}</td>
              <td className="xsmall muted">{subcategoryLabel(l.category, l.subcategory)}</td>
            </tr>
          ))
        : null}
    </>
  );
}

function AddTransaction({ onClose, onSave, today, rules }: { onClose: () => void; onSave: (t: Transaction, affect: boolean) => void; today: string; rules: UserRule[] }) {
  const [merchant, setMerchant] = useState('');
  const [amount, setAmount] = useState(0);
  const [date, setDate] = useState(today);
  const [dir, setDir] = useState<'out' | 'in'>('out');
  const [affect, setAffect] = useState(true);
  const preview = merchant ? manualTransaction(merchant, dir === 'out' ? -amount : amount, date, rules) : null;
  const valid = merchant.trim() && amount > 0 && isISODate(date) && date <= today;
  return (
    <Modal
      title="Add a transaction"
      onClose={onClose}
      footer={
        <button className="btn primary" disabled={!valid} onClick={() => valid && onSave(manualTransaction(merchant.trim(), dir === 'out' ? -amount : amount, date, rules), affect)}>
          Add transaction
        </button>
      }
    >
      <Segmented
        label="Direction"
        value={dir}
        onChange={setDir}
        options={[
          { value: 'out', label: 'Money out' },
          { value: 'in', label: 'Money in' },
        ]}
      />
      <div className="form-grid">
        <Field label="Merchant or description">
          <input className="input" value={merchant} onChange={(e) => setMerchant(e.target.value.slice(0, 80))} placeholder="e.g. Sheng Siong" />
        </Field>
        <Field label="Amount">
          <MoneyInput value={amount} onChange={setAmount} />
        </Field>
        <Field label="Date">
          <input className="input" type="date" max={today} value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
      </div>
      {preview ? (
        <p className="small muted">
          Will be classified as <strong>{categoryLabel(preview.category)}</strong> · {ESSENTIALITY_LABELS[preview.essentiality]}. You can change this afterwards.
        </p>
      ) : null}
      <label className="check">
        <input type="checkbox" checked={affect} onChange={(e) => setAffect(e.target.checked)} />
        Update my spending account balance (untick for older transactions already reflected in your balance)
      </label>
    </Modal>
  );
}
