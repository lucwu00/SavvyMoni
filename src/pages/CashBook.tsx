/**
 * Manual cash book for people without a bank account or reliable internet.
 * Every entry updates the chosen cash or e-wallet balance and feeds the same
 * Safe-to-Save engine as bank data. Nothing here needs a network connection.
 */
import { useMemo, useState } from 'react';
import { LuArrowDownLeft, LuArrowUpRight, LuCheck, LuLock, LuTrash2 } from 'react-icons/lu';
import type { QuickCategory } from '../config/markets';
import { minor } from '../config/markets';
import { addDays, formatDate, isISODate, relativeDay, startOfWeek, type ISODate } from '../domain/dates';
import { uid } from '../domain/ids';
import { formatMoney, type Cents } from '../domain/money';
import { defaultEssentiality, spendingCategoriesFor } from '../domain/categories';
import { classify } from '../domain/classifier';
import type { CategoryId, Transaction } from '../domain/types';
import { GENERIC_SUB } from '../import/workbook';
import { findPatterns, type PatternSuggestions } from '../import/patterns';
import { FREQUENCY_LABELS } from '../domain/recurrence';
import { useStore } from '../state/store';
import { Columns } from '../ui/charts';
import { Callout, Card, CardHead, ConfirmButton, Field, MoneyInput, PageHead, Segmented, SourceBadge } from '../ui/components';
import { t } from '../ui/i18n';
import { LiveRecommendation } from './Finances';

type Dir = 'in' | 'out';
type View = 'daily' | 'weekly';

export function CashBook() {
  const { state, market, today, dispatch, notify } = useStore();
  const lang = state.settings.language;
  const spending = state.accounts.filter((a) => a.role === 'spending');
  const [dir, setDir] = useState<Dir>('out');
  const [amount, setAmount] = useState<Cents>(0);
  const [pick, setPick] = useState<string>('');
  const [accountId, setAccountId] = useState<string>(spending[0]?.id ?? '');
  const [date, setDate] = useState<ISODate>(today);
  const [note, setNote] = useState('');
  const [view, setView] = useState<View>('daily');
  // Custom reason: the user's own words, with a category they can change.
  const [custom, setCustom] = useState('');
  const [customCat, setCustomCat] = useState<CategoryId | ''>('');
  const [treat, setTreat] = useState(false);

  const step = minor(market, market.rounding.stepMajor);
  const chips = [1, 2, 4, 10].map((k) => step * k);
  const incomeSources = state.incomeSources;
  const quick: QuickCategory[] = dir === 'out' ? market.quickExpense : market.quickIncome;
  const options: Array<{ key: string; label: string }> =
    dir === 'out'
      ? quick.map((q) => ({ key: `q:${q.label}`, label: q.label }))
      : [...incomeSources.map((s) => ({ key: `src:${s.id}`, label: s.name })), ...quick.map((q) => ({ key: `q:${q.label}`, label: q.label }))];
  const isCustom = pick === 'custom';
  const guessed = custom.trim() ? classify(custom, custom, dir === 'out' ? -1 : 1, state.rules) : null;
  const customCategory: CategoryId = dir === 'in' ? 'income' : customCat || (guessed && guessed.category !== 'income' && guessed.category !== 'transfer' ? guessed.category : 'uncategorised');
  const valid = amount > 0 && !!pick && (!isCustom || custom.trim().length > 0) && !!accountId && isISODate(date) && date <= today;

  const save = () => {
    if (!valid) return;
    if (pick.startsWith('src:')) {
      dispatch({ type: 'RECEIVE_INCOME', id: pick.slice(4), amountCents: amount, accountId, date });
    } else if (isCustom) {
      const label = custom.trim().slice(0, 60);
      const sameCat = guessed && guessed.category === customCategory;
      const sub = dir === 'in' ? (guessed?.category === 'income' ? guessed.subcategory : 'other-income') : sameCat ? guessed!.subcategory : GENERIC_SUB[customCategory];
      const tx: Transaction = {
        id: uid('tx'),
        date,
        merchant: label,
        description: note.trim() || label,
        amountCents: dir === 'out' ? -amount : amount,
        category: customCategory,
        subcategory: sub,
        // Unknown spending is protected as essential until the user says it was a treat.
        essentiality: dir === 'in' ? 'review' : treat ? 'discretionary' : customCategory === 'uncategorised' ? 'review' : defaultEssentiality(customCategory, sub) === 'discretionary' ? 'discretionary' : defaultEssentiality(customCategory, sub),
        source: 'user',
        providerId: 'cash-ledger',
        accountId,
        confidence: 'high',
        overridden: true,
      };
      dispatch({ type: 'ADD_TRANSACTION', tx, affectBalance: true });
    } else {
      const q = quick.find((x) => `q:${x.label}` === pick)!;
      const tx: Transaction = {
        id: uid('tx'),
        date,
        merchant: note.trim() || q.label,
        description: note.trim() || q.label,
        amountCents: dir === 'out' ? -amount : amount,
        category: q.category,
        subcategory: q.subcategory,
        essentiality: q.essentiality,
        source: 'user',
        providerId: 'cash-ledger',
        accountId,
        confidence: 'high',
        overridden: true,
      };
      dispatch({ type: 'ADD_TRANSACTION', tx, affectBalance: true });
    }
    notify(t('cash.saved', lang));
    setAmount(0);
    setNote('');
    setPick('');
    setCustom('');
    setCustomCat('');
    setTreat(false);
  };

  // Ledger: everything that moved cash, newest first.
  const entries = useMemo(
    () => state.transactions.filter((tx) => tx.category !== 'transfer').sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)),
    [state.transactions],
  );
  const days = Array.from({ length: 14 }, (_, i) => addDays(today, -13 + i));
  const dayIn = days.map((d) => entries.filter((e) => e.date === d && e.amountCents > 0).reduce((s, e) => s + e.amountCents, 0));
  const dayOut = days.map((d) => entries.filter((e) => e.date === d && e.amountCents < 0).reduce((s, e) => s - e.amountCents, 0));
  const weeks = Array.from({ length: 8 }, (_, i) => addDays(startOfWeek(today), -(7 - i) * 7));
  const wk = (w: ISODate, sign: 1 | -1) =>
    entries.filter((e) => e.date >= w && e.date < addDays(w, 7) && Math.sign(e.amountCents) === sign).reduce((s, e) => s + Math.abs(e.amountCents), 0);
  const weekIn = weeks.map((w) => wk(w, 1));
  const weekOut = weeks.map((w) => wk(w, -1));
  const recentDays = days.slice().reverse().slice(0, 7);

  return (
    <div className="page cashbook">
      <PageHead title={t('cash.title', lang)} sub={t('cash.sub', lang)} />
      <LiveRecommendation />

      <div className="grid grid-2">
        <Card data-testid="cash-form">
          <div className="stack">
            <div className="dir-toggle" role="group" aria-label="Money in or out">
              <button type="button" className={`dir ${dir === 'in' ? 'on in' : ''}`} aria-pressed={dir === 'in'} onClick={() => (setDir('in'), setPick(''))} data-testid="cash-dir-in">
                <LuArrowDownLeft aria-hidden /> {t('cash.in', lang)}
              </button>
              <button type="button" className={`dir ${dir === 'out' ? 'on out' : ''}`} aria-pressed={dir === 'out'} onClick={() => (setDir('out'), setPick(''))} data-testid="cash-dir-out">
                <LuArrowUpRight aria-hidden /> {t('cash.out', lang)}
              </button>
            </div>

            <Field label={t('cash.amount', lang)}>
              <div className="big-input">
                <MoneyInput value={amount} onChange={setAmount} testId="cash-amount" ariaLabel={t('cash.amount', lang)} />
              </div>
            </Field>
            <div className="chips" aria-label="Add a common amount">
              {chips.map((c) => (
                <button key={c} type="button" className="chip" onClick={() => setAmount(amount + c)}>
                  + {formatMoney(c)}
                </button>
              ))}
              {amount > 0 ? (
                <button type="button" className="chip" onClick={() => setAmount(0)}>
                  Clear
                </button>
              ) : null}
            </div>

            <fieldset className="pick">
              <legend>{t('cash.what', lang)}</legend>
              <div className="pick-grid">
                {options.map((o) => (
                  <button key={o.key} type="button" className="pick-btn" aria-pressed={pick === o.key} onClick={() => setPick(o.key)} data-testid={`cash-pick-${o.label}`}>
                    {o.label}
                  </button>
                ))}
                <button type="button" className="pick-btn" aria-pressed={isCustom} onClick={() => setPick('custom')} data-testid="cash-pick-custom">
                  {t('cash.custom', lang)}
                </button>
              </div>
              {isCustom ? (
                <div className="custom-reason">
                  <input
                    className="input"
                    autoFocus
                    value={custom}
                    maxLength={60}
                    placeholder={dir === 'out' ? 'e.g. school shoes, bike tyre' : 'e.g. sold old phone, birthday money'}
                    aria-label={t('cash.what', lang)}
                    data-testid="cash-custom-text"
                    onChange={(e) => setCustom(e.target.value)}
                  />
                  {dir === 'out' ? (
                    <div className="row" style={{ gap: 8 }}>
                      <select className="input" style={{ flex: 1, minWidth: 140 }} aria-label="Category" value={customCat || customCategory} onChange={(e) => setCustomCat(e.target.value as CategoryId)} data-testid="cash-custom-cat">
                        {spendingCategoriesFor(state.marketCode).map((cat) => (
                          <option key={cat.id} value={cat.id}>
                            {cat.label}
                          </option>
                        ))}
                        <option value="uncategorised">Not sure</option>
                      </select>
                      <label className="check small">
                        <input type="checkbox" checked={treat} onChange={(e) => setTreat(e.target.checked)} /> It was a treat, not a need
                      </label>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </fieldset>

            <fieldset className="pick">
              <legend>{dir === 'out' ? t('cash.where', lang) : t('cash.whereIn', lang)}</legend>
              <div className="pick-grid">
                {spending.map((a) => (
                  <button key={a.id} type="button" className="pick-btn" aria-pressed={accountId === a.id} onClick={() => setAccountId(a.id)}>
                    {a.name}
                    <span className="xsmall muted num"> {formatMoney(a.balanceCents)}</span>
                  </button>
                ))}
              </div>
            </fieldset>

            <div className="form-grid">
              <Field label={t('cash.note', lang)}>
                <input className="input" value={note} maxLength={60} onChange={(e) => setNote(e.target.value)} />
              </Field>
              <Field label="Date">
                <input className="input" type="date" max={today} value={date} onChange={(e) => setDate(e.target.value)} />
              </Field>
            </div>

            <button className="btn primary big" disabled={!valid} onClick={save} data-testid="cash-save">
              <LuCheck /> {t('cash.save', lang)}
              {amount > 0 ? ` · ${dir === 'out' ? '−' : '+'}${formatMoney(amount)}` : ''}
            </button>
          </div>
        </Card>

        <div className="stack">
          <Card>
            <CardHead title="Money you have now" sub="Count your cash now and then and correct it here. The plan uses these amounts." />
            <div className="list">
              {state.accounts.map((a) => (
                <CountRow key={`${a.id}-${a.balanceCents}`} id={a.id} name={a.name} role={a.role} balance={a.balanceCents} />
              ))}
            </div>
          </Card>
          <PatternFinder />
          <Callout tone="neutral" icon={<LuLock aria-hidden />}>
            Your entries stay on this device only. The cash book and the savings calculation run on this device and do not need internet. Nothing is shared or sold.
          </Callout>
        </div>
      </div>

      <Card>
        <CardHead
          title={view === 'daily' ? 'Last 14 days' : 'Last 8 weeks'}
          sub="Money in and money out from your cash book and records."
          right={
            <Segmented<View>
              label="View"
              value={view}
              onChange={setView}
              options={[
                { value: 'daily', label: t('cash.daily', lang) },
                { value: 'weekly', label: t('cash.weekly', lang) },
              ]}
            />
          }
        />
        {view === 'daily' ? (
          <Columns
            ariaLabel="Money in and out by day"
            labels={days.map((d) => formatDate(d))}
            series={[
              { name: t('cash.in', lang), color: 'var(--series-3)', values: dayIn },
              { name: t('cash.out', lang), color: 'var(--series-2)', values: dayOut },
            ]}
          />
        ) : (
          <>
            <Columns
              ariaLabel="Money in and out by week"
              labels={weeks.map((w) => formatDate(w))}
              series={[
                { name: t('cash.in', lang), color: 'var(--series-3)', values: weekIn },
                { name: t('cash.out', lang), color: 'var(--series-2)', values: weekOut },
              ]}
            />
            <div className="table-wrap" style={{ marginTop: 10 }}>
              <table className="table" data-testid="cash-weekly">
                <thead>
                  <tr>
                    <th>Week of</th>
                    <th className="r">{t('cash.in', lang)}</th>
                    <th className="r">{t('cash.out', lang)}</th>
                    <th className="r">{t('cash.net', lang)}</th>
                  </tr>
                </thead>
                <tbody>
                  {weeks
                    .map((w, i) => ({ w, i }))
                    .reverse()
                    .map(({ w, i }) => (
                      <tr key={w}>
                        <td className="num">{formatDate(w)}</td>
                        <td className="r num">{formatMoney(weekIn[i])}</td>
                        <td className="r num">{formatMoney(weekOut[i])}</td>
                        <td className="r amount" style={{ color: weekIn[i] - weekOut[i] < 0 ? 'var(--critical)' : undefined }}>
                          {formatMoney(weekIn[i] - weekOut[i], { signed: true })}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Card>

      {view === 'daily' ? (
        <Card>
          <CardHead title="Entries by day" />
          <div className="stack" data-testid="cash-daily">
            {recentDays.map((d) => {
              const list = entries.filter((e) => e.date === d);
              const inn = list.filter((e) => e.amountCents > 0).reduce((s, e) => s + e.amountCents, 0);
              const out = list.filter((e) => e.amountCents < 0).reduce((s, e) => s - e.amountCents, 0);
              return (
                <div key={d}>
                  <div className="row-between day-head">
                    <strong>
                      {formatDate(d)} <span className="muted small">({relativeDay(d, today)})</span>
                    </strong>
                    <span className="small num">
                      <span style={{ color: 'var(--good)' }}>+{formatMoney(inn)}</span> · <span>−{formatMoney(out)}</span> ·{' '}
                      <strong style={{ color: inn - out < 0 ? 'var(--critical)' : undefined }}>{formatMoney(inn - out, { signed: true })}</strong>
                    </span>
                  </div>
                  <div className="list">
                    {list.length === 0 ? <p className="small muted" style={{ padding: '6px 0' }}>No entries.</p> : null}
                    {list.slice(0, 12).map((e) => (
                      <div className="list-row" key={e.id}>
                        <div className="grow">
                          <div className="title" style={{ fontWeight: 500 }}>
                            {e.merchant}
                          </div>
                          <div className="meta">
                            {state.accounts.find((a) => a.id === e.accountId)?.name ?? ''} <SourceBadge source={e.source} />
                          </div>
                        </div>
                        <span className={`amount ${e.amountCents > 0 ? 'in' : ''}`}>{formatMoney(e.amountCents, { signed: e.amountCents > 0 })}</span>
                        {e.providerId === 'cash-ledger' && e.source === 'user' ? (
                          <ConfirmButton
                            className="btn sm ghost icon"
                            label=""
                            icon={<LuTrash2 aria-label="Remove entry" />}
                            confirmLabel="Remove"
                            onConfirm={() => dispatch({ type: 'DELETE_TRANSACTION', id: e.id, revertBalance: true })}
                          />
                        ) : null}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      ) : null}
    </div>
  );
}

function CountRow({ id, name, role, balance }: { id: string; name: string; role: 'spending' | 'emergency'; balance: Cents }) {
  const { dispatch, notify } = useStore();
  const [v, setV] = useState(balance);
  return (
    <div className="list-row" style={{ flexWrap: 'wrap' }}>
      <div className="grow" style={{ minWidth: 180 }}>
        <div className="title">{name}</div>
        <div className="meta">{role === 'emergency' ? 'Emergency savings' : 'For spending'}</div>
      </div>
      <div style={{ width: 160 }}>
        <MoneyInput value={v} onChange={setV} allowNegative ariaLabel={`${name} amount`} />
      </div>
      <button className="btn sm" disabled={v === balance} onClick={() => (dispatch({ type: 'UPDATE_ACCOUNT', id, patch: { balanceCents: v } }), notify(`${name} updated`))}>
        Update
      </button>
    </div>
  );
}

/** Suggest regular income and bills from the user's own entries; the user picks what to keep. */
function PatternFinder() {
  const { state, today, dispatch, notify } = useStore();
  const lang = state.settings.language;
  const [found, setFound] = useState<PatternSuggestions | null>(null);
  const [pick, setPick] = useState<Record<string, boolean>>({});
  const scan = () => {
    const f = findPatterns(state, today);
    setFound(f);
    setPick(Object.fromEntries([...f.income, ...f.bills].map((d) => [d.item.id, d.include])));
  };
  const items = found ? [...found.income, ...found.bills] : [];
  const chosen = items.filter((d) => pick[d.item.id]).length;
  const row = (id: string, name: string, amount: Cents, freq: string, evidence: string) => (
    <label key={id} className="check" style={{ alignItems: 'flex-start', gap: 10 }}>
      <input type="checkbox" checked={!!pick[id]} onChange={(e) => setPick((p) => ({ ...p, [id]: e.target.checked }))} data-testid={`pattern-${id}`} />
      <span className="stack-sm" style={{ gap: 2 }}>
        <span style={{ fontWeight: 650 }}>
          {name} · {formatMoney(amount)} · {freq}
        </span>
        <span className="xsmall muted">{evidence}</span>
      </span>
    </label>
  );
  return (
    <Card data-testid="pattern-finder">
      <CardHead title={t('pat.title', lang)} sub={t('pat.sub', lang)} />
      {!found ? (
        <button className="btn" onClick={scan} data-testid="pattern-scan">
          {t('pat.scan', lang)}
        </button>
      ) : items.length === 0 ? (
        <p className="small ink2" data-testid="pattern-none">
          {t('pat.none', lang)}
        </p>
      ) : (
        <div className="stack">
          {found.income.length ? (
            <div className="stack-sm">
              <span className="eyebrow">{t('pat.income', lang)}</span>
              {found.income.map((d) => row(d.item.id, d.item.name, d.item.netAmountCents, FREQUENCY_LABELS[d.item.frequency] ?? d.item.frequency, d.evidence))}
            </div>
          ) : null}
          {found.bills.length ? (
            <div className="stack-sm">
              <span className="eyebrow">{t('pat.bills', lang)}</span>
              {found.bills.map((d) => row(d.item.id, d.item.name, d.item.amountCents, FREQUENCY_LABELS[d.item.frequency] ?? d.item.frequency, d.evidence))}
            </div>
          ) : null}
          <div>
            <button
              className="btn primary"
              disabled={chosen === 0}
              data-testid="pattern-add"
              onClick={() => {
                dispatch({
                  type: 'ADOPT_PATTERNS',
                  income: found.income.filter((d) => pick[d.item.id]).map((d) => d.item),
                  bills: found.bills.filter((d) => pick[d.item.id]).map((d) => ({ bill: d.item, txIds: d.txIds })),
                });
                notify(t('pat.added', lang));
                setFound(null);
              }}
            >
              <LuCheck /> {t('pat.add', lang)}
            </button>
          </div>
        </div>
      )}
    </Card>
  );
}
