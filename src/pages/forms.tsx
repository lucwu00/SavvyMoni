/** Reusable form pieces for bills, transactions and categories. */
import { useState } from 'react';
import { ESSENTIALITY_LABELS, categoriesFor, defaultEssentiality } from '../domain/categories';
import { useStore } from '../state/store';
import { addDays, isISODate, type ISODate } from '../domain/dates';
import { uid } from '../domain/ids';
import type { Cents } from '../domain/money';
import { FREQUENCY_LABELS } from '../domain/recurrence';
import type { CategoryId, Essentiality, Frequency, RecurringBill } from '../domain/types';
import { Field, Modal, MoneyInput } from '../ui/components';

export function CategorySelect({ category, subcategory, onChange, id, includeIncome = false, ariaLabel }: { category: CategoryId; subcategory: string; onChange: (c: CategoryId, s: string) => void; id?: string; includeIncome?: boolean; ariaLabel?: string }) {
  const { state } = useStore();
  const all = categoriesFor(state.marketCode);
  const cats = includeIncome ? all : all.filter((c) => c.id !== 'income' && c.id !== 'transfer');
  return (
    <select
      id={id}
      className="input"
      aria-label={ariaLabel ?? 'Category'}
      value={`${category}|${subcategory}`}
      onChange={(e) => {
        const [c, s] = e.target.value.split('|');
        onChange(c as CategoryId, s);
      }}
    >
      {!cats.some((c) => c.id === category) ? <option value={`${category}|${subcategory}`}>{category}</option> : null}
      {cats.map((c) => (
        <optgroup key={c.id} label={c.label}>
          {c.subcategories.map((s) => (
            <option key={s.id} value={`${c.id}|${s.id}`}>
              {c.label}: {s.label}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

export function EssentialitySelect({ value, onChange, id, ariaLabel, allowReview = true }: { value: Essentiality; onChange: (e: Essentiality) => void; id?: string; ariaLabel?: string; allowReview?: boolean }) {
  const opts = (Object.keys(ESSENTIALITY_LABELS) as Essentiality[]).filter((k) => allowReview || k !== 'review');
  return (
    <select id={id} className="input" aria-label={ariaLabel ?? 'Priority'} value={value} onChange={(e) => onChange(e.target.value as Essentiality)}>
      {opts.map((k) => (
        <option key={k} value={k}>
          {ESSENTIALITY_LABELS[k]}
        </option>
      ))}
    </select>
  );
}

export function BillForm({ initial, today, onSave, onClose }: { initial?: RecurringBill; today: ISODate; onSave: (b: RecurringBill) => void; onClose: () => void }) {
  const [b, setB] = useState<RecurringBill>(
    initial ?? {
      id: uid('bill'),
      name: '',
      category: 'utilities',
      subcategory: 'mobile',
      amountCents: 0,
      nextDue: addDays(today, 7),
      frequency: 'monthly',
      priority: 'essential',
      status: 'unpaid',
      source: 'user',
      confidence: 'high',
    },
  );
  const valid = b.name.trim().length > 0 && b.amountCents > 0 && isISODate(b.nextDue);
  return (
    <Modal
      title={initial ? 'Edit bill' : 'Add a bill'}
      onClose={onClose}
      footer={
        <>
          <button className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={!valid} data-testid="bill-save" onClick={() => valid && onSave({ ...b, name: b.name.trim() })}>
            {initial ? 'Save bill' : 'Add bill'}
          </button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="Name">
          <input className="input" id="bill-name" value={b.name} placeholder="e.g. SP Group utilities" onChange={(e) => setB({ ...b, name: e.target.value.slice(0, 60) })} />
        </Field>
        <Field label="Amount">
          <MoneyInput id="bill-amount" value={b.amountCents} onChange={(c: Cents) => setB({ ...b, amountCents: c })} />
        </Field>
        <Field label="Next due date">
          <input className="input" id="bill-due" type="date" value={b.nextDue} onChange={(e) => setB({ ...b, nextDue: e.target.value })} />
        </Field>
        <Field label="How often">
          <select className="input" id="bill-freq" value={b.frequency} onChange={(e) => setB({ ...b, frequency: e.target.value as Frequency })}>
            {(Object.keys(FREQUENCY_LABELS) as Frequency[]).map((f) => (
              <option key={f} value={f}>
                {FREQUENCY_LABELS[f]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Category">
          <CategorySelect
            id="bill-cat"
            category={b.category}
            subcategory={b.subcategory}
            onChange={(c, s) => {
              const e = defaultEssentiality(c, s);
              setB({ ...b, category: c, subcategory: s, priority: e === 'review' ? 'essential' : (e as RecurringBill['priority']) });
            }}
          />
        </Field>
        <Field label="Priority" hint="Everything except discretionary is protected.">
          <EssentialitySelect id="bill-priority" value={b.priority} allowReview={false} onChange={(e) => setB({ ...b, priority: e as RecurringBill['priority'] })} />
        </Field>
      </div>
    </Modal>
  );
}
