import { useState, type ReactNode } from 'react';
import { LuCircleCheck, LuDownload, LuFileSpreadsheet, LuPlus, LuTrash2, LuUpload } from 'react-icons/lu';
import { categoryLabel } from '../domain/categories';
import { formatDate } from '../domain/dates';
import { formatMoney, type Cents } from '../domain/money';
import { FREQUENCY_LABELS } from '../domain/recurrence';
import type { Account } from '../domain/types';
import type { ImportChoices } from '../import/build';
import { sampleWorkbook, templateWorkbook } from '../import/samples';
import { checkImportFile, draftFromFile, draftMonthly, estimateDaily, type DraftAccount, type ImportDraft } from '../import/workbook';
import { DEMO_MARKETS, MARKETS } from '../config/markets';
import type { DemoMarket } from '../state/country';
import { useStore } from '../state/store';
import { Callout, Card, CardHead, MoneyInput, Pill } from '../ui/components';
import { saveFile, XLSX_MIME } from '../ui/download';

const CERTAINTY: Record<string, string> = { confirmed: 'Confirmed', expected: 'Expected, varies', uncertain: 'Uncertain, not counted' };

/** Blank templates for every country, for people who keep their records by hand. */
export function AllTemplates({ compact = false }: { compact?: boolean }) {
  const { state, notify } = useStore();
  const save = async (code: DemoMarket) => {
    const r = await saveFile(`SavvyMoni-template-${MARKETS[code].name}.xlsx`, templateWorkbook(code), XLSX_MIME);
    if (r === 'failed') notify('Download is not available here');
  };
  return (
    <div className="stack-sm" data-testid="all-templates">
      {compact ? null : (
        <p className="small ink2">
          Keep your records by hand? Download a blank workbook, write down money in and out (and, if you like, your regular income, bills and balances), then import it here. Each one has drop-down lists, local examples and the right currency.
        </p>
      )}
      <div className="row" style={{ gap: 8 }}>
        {DEMO_MARKETS.map((code) => (
          <button key={code} type="button" className={`btn sm ${code === state.marketCode ? '' : 'ghost'}`} onClick={() => save(code as DemoMarket)} data-testid={`template-${code}`}>
            <LuDownload /> {MARKETS[code].name} ({MARKETS[code].currency.code})
          </button>
        ))}
      </div>
    </div>
  );
}

/** Download links for the blank template and the synthetic sample file. */
export function TemplateLinks() {
  const { state, today, notify, market } = useStore();
  const save = async (kind: 'template' | 'sample') => {
    const bytes = kind === 'template' ? templateWorkbook(state.marketCode) : sampleWorkbook(state.marketCode, today);
    const name = kind === 'template' ? `SavvyMoni-template-${market.code}.xlsx` : `SavvyMoni-sample-${market.code}.xlsx`;
    const r = await saveFile(name, bytes, XLSX_MIME);
    if (r === 'failed') notify('Download is not available here');
  };
  return (
    <div className="row" style={{ gap: 8 }}>
      <button type="button" className="btn sm" onClick={() => save('template')} data-testid="download-template">
        <LuDownload /> Blank template (.xlsx)
      </button>
      <button type="button" className="btn sm ghost" onClick={() => save('sample')} data-testid="download-sample">
        <LuDownload /> Sample workbook (synthetic)
      </button>
    </div>
  );
}

/** Choose or drop a .xlsx / .csv file and turn it into a draft for review. */
export function FilePicker({ onDraft, allowSample = true }: { onDraft: (d: ImportDraft) => void; allowSample?: boolean }) {
  const { state, today, market } = useStore();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const ctx = { market, today, rules: state.rules, existing: state.transactions };

  const read = async (name: string, bytes: ArrayBuffer | Uint8Array) => {
    setBusy(true);
    setError(null);
    try {
      onDraft(await draftFromFile(name, bytes, ctx));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The file could not be read.');
    } finally {
      setBusy(false);
    }
  };
  const take = async (f: File | undefined) => {
    if (!f) return;
    const check = checkImportFile(f.name, f.size);
    if (!check.ok) return setError(check.error!);
    try {
      await read(f.name, await f.arrayBuffer());
    } catch {
      setError('The file could not be read.');
    }
  };

  return (
    <div className="stack">
      <label
        className={`dropzone ${over ? 'over' : ''}`}
        onDragOver={(e) => (e.preventDefault(), setOver(true))}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          take(e.dataTransfer.files?.[0]);
        }}
      >
        <LuFileSpreadsheet aria-hidden className="dz-icon" />
        <span className="dz-title">{busy ? 'Reading your file…' : 'Choose a spreadsheet or drop it here'}</span>
        <span className="xsmall muted">Excel workbook (.xlsx) or CSV, up to 5 MB. Read on this device; nothing is uploaded.</span>
        <span className="btn sm primary" aria-hidden>
          <LuUpload /> Choose file
        </span>
        <input
          type="file"
          accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
          className="sr-only"
          data-testid="import-file"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            take(f);
          }}
        />
      </label>
      {error ? <Callout tone="critical">{error}</Callout> : null}
      {allowSample ? (
        <div className="row-between" style={{ gap: 8 }}>
          <span className="xsmall muted">
            No file handy? The sample workbook holds 90 days of synthetic {market.name} records. It goes through the same import and review as your own file.
          </span>
          <button type="button" className="btn sm ghost" disabled={busy} data-testid="use-sample" onClick={() => read(`SavvyMoni-sample-${market.code}.xlsx`, sampleWorkbook(state.marketCode, today))}>
            Try the sample file
          </button>
        </div>
      ) : null}
    </div>
  );
}

type Row = Omit<DraftAccount, 'balanceCents'> & { balanceCents: Cents; needsBalance: boolean };

function defaultAccounts(cashHeavy: boolean): Row[] {
  return cashHeavy
    ? [
        { key: 'acct:cash', name: 'Cash', kind: 'cash', role: 'spending', balanceCents: 0, needsBalance: true, fromSheet: false },
        { key: 'acct:emergency', name: 'Emergency savings', kind: 'cash', role: 'emergency', balanceCents: 0, needsBalance: false, fromSheet: false },
      ]
    : [
        { key: 'acct:everyday', name: 'Everyday account', kind: 'bank', role: 'spending', balanceCents: 0, needsBalance: true, fromSheet: false },
        { key: 'acct:emergency', name: 'Emergency savings', kind: 'bank', role: 'emergency', balanceCents: 0, needsBalance: false, fromSheet: false },
      ];
}

function Section({ title, sub, children }: { title: string; sub?: ReactNode; children: ReactNode }) {
  return (
    <div className="stack-sm">
      <h3>{title}</h3>
      {sub ? <p className="xsmall muted">{sub}</p> : null}
      {children}
    </div>
  );
}

/** Review what was found before anything is saved. */
export function DraftReview({ draft: initial, mode, onCancel, onDone }: { draft: ImportDraft; mode: 'setup' | 'merge'; onCancel: () => void; onDone: () => void }) {
  const { state, dispatch, notify, market } = useStore();
  const [draft, setDraft] = useState(initial);
  const existingNames = new Set(state.accounts.map((a) => a.name.toLowerCase()));
  const [rows, setRows] = useState<Row[]>(() => {
    const fromDraft = initial.accounts.map((a) => ({ ...a, balanceCents: a.balanceCents ?? 0, needsBalance: a.balanceCents === null && !existingNames.has(a.name.toLowerCase()) }));
    if (mode === 'merge') return fromDraft;
    return fromDraft.length ? fromDraft : defaultAccounts(market.cashHeavy);
  });
  const [name, setName] = useState(state.profile.displayName);
  const [replaceBalances, setReplace] = useState(true);
  const bills = draft.bills.filter((b) => b.include).map((b) => b.item);
  const est = estimateDaily(draft.transactions, bills, draft.history.days);
  const [daily, setDaily] = useState<Cents>(initial.dailyEssentialCents);
  const monthly = draftMonthly(draft);
  const missing = rows.filter((r) => r.needsBalance);
  const hasSpending = mode === 'merge' || rows.some((r) => r.role === 'spending');
  const canSave = missing.length === 0 && hasSpending && (draft.transactions.length > 0 || draft.income.some((i) => i.include) || draft.bills.some((b) => b.include) || rows.length > 0);

  const toggle = (list: 'income' | 'bills', i: number) =>
    setDraft((d) => ({ ...d, [list]: d[list].map((x, j) => (j === i ? { ...x, include: !x.include } : x)) }) as ImportDraft);
  const setRow = (i: number, patch: Partial<Row>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const save = () => {
    const choices: ImportChoices = {
      displayName: name,
      accounts: rows.map(({ needsBalance: _n, ...r }) => r),
      dailyEssentialCents: draft.history.days >= 14 ? est.essential : daily,
      dailyDiscretionaryCents: est.discretionary,
      replaceBalances,
    };
    dispatch({ type: 'IMPORT_DRAFT', draft, choices });
    notify(mode === 'setup' ? 'Your plan is ready' : `${draft.transactions.length} transactions imported`);
    onDone();
  };

  return (
    <Card data-testid="import-review">
      <CardHead
        title={`Review ${draft.fileName}`}
        sub={`Found ${draft.sheetsFound.length} sheet${draft.sheetsFound.length === 1 ? '' : 's'}: ${draft.sheetsFound.join(', ')}. Nothing is saved until you confirm.`}
        right={
          <button className="btn sm ghost" onClick={onCancel}>
            Choose another file
          </button>
        }
      />
      <div className="stack">
        <div className="row" data-testid="import-counts">
          <Pill tone="good">{draft.transactions.length} transactions</Pill>
          {draft.duplicates ? <Pill tone="warning">{draft.duplicates} duplicates skipped</Pill> : null}
          <Pill tone={draft.errors.length ? 'warning' : 'neutral'}>{draft.errors.length} rows with problems</Pill>
          {draft.history.from ? (
            <Pill tone="neutral">
              {formatDate(draft.history.from, true)} to {formatDate(draft.history.to!, true)}
            </Pill>
          ) : null}
        </div>
        {draft.columns.date ? (
          <p className="xsmall muted">
            Columns used: date “{draft.columns.date}”, description “{draft.columns.description}”, amount “{draft.columns.amount}”
            {draft.columns.category ? `, category “${draft.columns.category}”` : ''}
            {draft.columns.account ? `, account “${draft.columns.account}”` : ''}.
          </p>
        ) : null}
        {draft.warnings.map((w) => (
          <Callout key={w} tone="info">
            {w}
          </Callout>
        ))}
        {draft.errors.length ? (
          <details className="details">
            <summary className="small">Show rows that were skipped or need attention</summary>
            <ul className="small" style={{ margin: '8px 0 0', paddingLeft: 18 }}>
              {draft.errors.slice(0, 60).map((e, i) => (
                <li key={i}>
                  {e.sheet} row {e.line}: {e.message}
                </li>
              ))}
              {draft.errors.length > 60 ? <li>…and {draft.errors.length - 60} more</li> : null}
            </ul>
          </details>
        ) : null}

        {draft.transactions.length ? (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Description</th>
                  <th>Category</th>
                  <th className="r">Amount</th>
                </tr>
              </thead>
              <tbody>
                {[...draft.transactions]
                  .sort((a, b) => (a.date < b.date ? 1 : -1))
                  .slice(0, 8)
                  .map((t) => (
                    <tr key={t.id}>
                      <td className="num">{formatDate(t.date)}</td>
                      <td>{t.merchant}</td>
                      <td className="small">{t.essentiality === 'review' && t.amountCents < 0 ? <span style={{ color: 'var(--warning)' }}>Needs review</span> : categoryLabel(t.category)}</td>
                      <td className="r amount">{formatMoney(t.amountCents, { signed: t.amountCents > 0 })}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
            {draft.transactions.length > 8 ? <p className="xsmall muted" style={{ padding: '6px 2px' }}>Newest 8 of {draft.transactions.length} shown.</p> : null}
          </div>
        ) : null}

        <div className="grid grid-2">
          <Section
            title={draft.incomeFromSheet ? 'Income from your Income sheet' : 'Regular income found in your transactions'}
            sub={draft.income.length ? `Tick what you expect to continue. About ${formatMoney(monthly.income)} a month take-home is ticked.` : undefined}
          >
            {draft.income.length === 0 ? (
              <p className="small ink2">No regular income pattern was found. You can add income in My finances or the cash book afterwards.</p>
            ) : (
              <div className="list" data-testid="import-income">
                {draft.income.map((d, i) => (
                  <label key={d.item.id} className="list-row check-row">
                    <input type="checkbox" checked={d.include} onChange={() => toggle('income', i)} />
                    <div className="grow">
                      <div className="title">{d.item.name}</div>
                      <div className="meta">
                        {FREQUENCY_LABELS[d.item.frequency]} · {CERTAINTY[d.item.certainty]} · next {formatDate(d.item.nextDate)}
                      </div>
                      {d.evidence ? <div className="xsmall muted">{d.evidence}</div> : null}
                    </div>
                    <span className="amount">{formatMoney(d.item.netAmountCents)}</span>
                  </label>
                ))}
              </div>
            )}
          </Section>
          <Section
            title={draft.billsFromSheet ? 'Bills from your Bills sheet' : 'Regular bills found in your transactions'}
            sub={draft.bills.length ? `Ticked bills are protected before anything is saved: about ${formatMoney(monthly.bills)} a month.` : undefined}
          >
            {draft.bills.length === 0 ? (
              <p className="small ink2">No repeating bills were found. Add rent, phone or loan payments in My finances so they are protected.</p>
            ) : (
              <div className="list" data-testid="import-bills">
                {draft.bills.map((d, i) => (
                  <label key={d.item.id} className="list-row check-row">
                    <input type="checkbox" checked={d.include} onChange={() => toggle('bills', i)} />
                    <div className="grow">
                      <div className="title">{d.item.name}</div>
                      <div className="meta">
                        {categoryLabel(d.item.category)} · {FREQUENCY_LABELS[d.item.frequency]} · due {formatDate(d.item.nextDue)}
                      </div>
                      {d.evidence ? <div className="xsmall muted">{d.evidence}</div> : null}
                    </div>
                    <span className="amount">{formatMoney(d.item.amountCents)}</span>
                  </label>
                ))}
              </div>
            )}
          </Section>
        </div>

        <Section
          title={mode === 'merge' ? 'Balances' : 'What you have today'}
          sub={
            mode === 'merge'
              ? 'Accounts in this file are matched to yours by name.'
              : 'Your plan starts from these balances. Spending money pays everyday costs and bills; emergency savings are kept aside.'
          }
        >
          <div className="stack-sm" data-testid="import-accounts">
            {rows.map((r, i) => (
              <div key={r.key} className="acct-row">
                <input className="input" aria-label="Account name" value={r.name} onChange={(e) => setRow(i, { name: e.target.value.slice(0, 40) })} />
                <select className="input" aria-label="Type" value={r.kind} onChange={(e) => setRow(i, { kind: e.target.value as Account['kind'] })}>
                  <option value="bank">Bank</option>
                  <option value="ewallet">E-wallet</option>
                  <option value="cash">Cash</option>
                </select>
                <select className="input" aria-label="Use" value={r.role} onChange={(e) => setRow(i, { role: e.target.value as Account['role'] })}>
                  <option value="spending">Spending money</option>
                  <option value="emergency">Emergency savings</option>
                </select>
                <div className={r.needsBalance ? 'needs' : ''}>
                  <MoneyInput value={r.balanceCents} ariaLabel={`${r.name} balance`} testId={`balance-${i}`} onChange={(c) => setRow(i, { balanceCents: c, needsBalance: false })} />
                </div>
                <button type="button" className="icon-btn" aria-label={`Remove ${r.name}`} onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}>
                  <LuTrash2 />
                </button>
              </div>
            ))}
            {missing.length ? <p className="xsmall" style={{ color: 'var(--warning)' }}>Enter today’s balance for {missing.map((m) => m.name).join(', ')} (0 is fine).</p> : null}
            {!hasSpending ? <p className="xsmall" style={{ color: 'var(--warning)' }}>Mark at least one account as spending money.</p> : null}
            <div className="row">
              <button
                type="button"
                className="btn sm ghost"
                onClick={() => setRows((rs) => [...rs, { key: `acct:new-${rs.length}-${Date.now()}`, name: 'New account', kind: market.cashHeavy ? 'cash' : 'bank', role: 'spending', balanceCents: 0, needsBalance: true, fromSheet: false }])}
              >
                <LuPlus /> Add account
              </button>
              {mode === 'merge' && rows.some((r) => r.fromSheet) ? (
                <label className="check small">
                  <input type="checkbox" checked={replaceBalances} onChange={(e) => setReplace(e.target.checked)} /> Update balances of matching accounts
                </label>
              ) : null}
            </div>
          </div>
        </Section>

        {mode === 'setup' ? (
          <div className="form-grid">
            <label className="field">
              <span>What should SavvyMoni call you? (optional)</span>
              <input className="input" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} data-testid="import-name" />
              <small>Stays on this device. No surname or ID needed.</small>
            </label>
            <label className="field">
              <span>Everyday essentials per day</span>
              {draft.history.days >= 14 ? (
                <>
                  <div className="input-static amount" data-testid="daily-estimate">
                    {formatMoney(est.essential)} essentials + {formatMoney(est.discretionary)} discretionary
                  </div>
                  <small>Worked out from {draft.history.days} days in your file, leaving out bills. It updates as you add records.</small>
                </>
              ) : (
                <>
                  <MoneyInput value={daily} onChange={setDaily} ariaLabel="Everyday essentials per day" testId="daily-input" />
                  <small>Your file is short, so tell us roughly what food, transport and other daily needs cost. Used until there are two weeks of records.</small>
                </>
              )}
            </label>
          </div>
        ) : null}

        <div className="row">
          <button className="btn primary" disabled={!canSave} onClick={save} data-testid="import-confirm">
            <LuCircleCheck /> {mode === 'setup' ? 'Build my plan' : `Import ${draft.transactions.length} transactions`}
          </button>
          <span className="xsmall muted">You can change any of this later in My finances.</span>
        </div>
      </div>
    </Card>
  );
}

/** Picker and review together, for later imports. */
export function ImportPanel({ onClose }: { onClose: () => void }) {
  const [draft, setDraft] = useState<ImportDraft | null>(null);
  if (draft) return <DraftReview draft={draft} mode="merge" onCancel={() => setDraft(null)} onDone={onClose} />;
  return (
    <Card data-testid="import-panel">
      <CardHead
        title="Import a spreadsheet"
        sub="Your bank or e-wallet export, or the SavvyMoni template. New transactions are added; duplicates are skipped."
        right={
          <button className="btn sm ghost" onClick={onClose}>
            Close
          </button>
        }
      />
      <div className="stack">
        <FilePicker onDraft={setDraft} />
        <TemplateLinks />
      </div>
    </Card>
  );
}
