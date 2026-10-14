import { useEffect, useId, useState, type HTMLAttributes, type ReactNode } from 'react';
import { LuCircleAlert, LuCircleCheck, LuCircleHelp, LuInfo, LuPause, LuRefreshCw, LuTriangleAlert, LuX } from 'react-icons/lu';
import { STATUS_META, type SaveStatus } from '../domain/engine';
import { centsToInput, formatMoney, getActiveCurrency, parseMoney, type Cents } from '../domain/money';
import type { DataSource } from '../domain/types';
import { useStore } from '../state/store';
import { t, type StringKey } from './i18n';

export function Card({ children, className = '', ...rest }: { children: ReactNode; className?: string } & HTMLAttributes<HTMLElement>) {
  return (
    <section className={`card ${className}`} {...rest}>
      {children}
    </section>
  );
}

export function CardHead({ title, sub, right }: { title: ReactNode; sub?: ReactNode; right?: ReactNode }) {
  return (
    <div className="card-head">
      <div style={{ minWidth: 0 }}>
        <h2>{title}</h2>
        {sub ? <p>{sub}</p> : null}
      </div>
      {right}
    </div>
  );
}

export function PageHead({ title, sub, right }: { title: string; sub?: ReactNode; right?: ReactNode }) {
  return (
    <header className="page-head">
      <div>
        <h1>{title}</h1>
        {sub ? <p>{sub}</p> : null}
      </div>
      {right ? <div className="row">{right}</div> : null}
    </header>
  );
}

export function Money({ cents, signed, className = '', decimals }: { cents: Cents; signed?: boolean; className?: string; decimals?: boolean }) {
  return <span className={`num ${className}`}>{formatMoney(cents, { signed, decimals })}</span>;
}

export function Stat({ label, value, sub, icon }: { label: ReactNode; value: ReactNode; sub?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="stat">
      <span className="stat-label">
        {icon}
        {label}
      </span>
      <span className="stat-value">{value}</span>
      {sub ? <span className="stat-sub">{sub}</span> : null}
    </div>
  );
}

const STATUS_ICON: Record<SaveStatus, ReactNode> = {
  safe: <LuCircleCheck aria-hidden />,
  cautious: <LuTriangleAlert aria-hidden />,
  reduce: <LuTriangleAlert aria-hidden />,
  pause: <LuPause aria-hidden />,
  rebuild: <LuRefreshCw aria-hidden />,
  insufficient: <LuCircleHelp aria-hidden />,
};

export function StatusPill({ status }: { status: SaveStatus }) {
  const meta = STATUS_META[status];
  const { state } = useStore();
  return (
    <span className={`pill tone-${meta.tone}`} data-testid="status-pill">
      {STATUS_ICON[status]}
      {t(`status.${status}` as StringKey, state.settings.language)}
    </span>
  );
}

export function Pill({ tone, children, icon }: { tone: 'good' | 'warning' | 'serious' | 'critical' | 'info' | 'neutral'; children: ReactNode; icon?: ReactNode }) {
  return (
    <span className={`pill tone-${tone}`}>
      {icon}
      {children}
    </span>
  );
}

const SOURCE_LABEL: Record<DataSource, string> = { simulated: 'Demo data', imported: 'Imported', user: 'Entered by you', estimated: 'Estimate' };
const SOURCE_CLASS: Record<DataSource, string> = { simulated: 'demo', imported: 'imported', user: '', estimated: 'estimated' };

/** Where most of the current records came from, for page-level badges. */
export function RecordsBadge() {
  const { state } = useStore();
  const imported = state.transactions.filter((t) => t.source === 'imported').length;
  const source: DataSource = imported > state.transactions.length / 2 ? 'imported' : 'user';
  return <SourceBadge source={source} title={source === 'imported' ? 'Mostly from your imported spreadsheet' : 'Entered by you'} />;
}

export function SourceBadge({ source, title }: { source: DataSource; title?: string }) {
  return (
    <span className={`badge ${SOURCE_CLASS[source]}`} title={title ?? SOURCE_LABEL[source]}>
      {SOURCE_LABEL[source]}
    </span>
  );
}

export function Callout({ tone = 'neutral', children, icon }: { tone?: 'good' | 'warning' | 'serious' | 'critical' | 'info' | 'neutral'; children: ReactNode; icon?: ReactNode }) {
  const i =
    icon ??
    (tone === 'good' ? <LuCircleCheck aria-hidden /> : tone === 'critical' || tone === 'serious' ? <LuCircleAlert aria-hidden /> : tone === 'warning' ? <LuTriangleAlert aria-hidden /> : <LuInfo aria-hidden />);
  return (
    <div className={`callout ${tone === 'neutral' ? 'neutral' : `tone-${tone}`}`} role={tone === 'critical' || tone === 'serious' ? 'alert' : undefined}>
      {i}
      <div style={{ minWidth: 0 }}>{children}</div>
    </div>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint ? <small>{hint}</small> : null}
    </label>
  );
}

/** Whole-number input with a fixed unit after it (for example "weeks"). Commits on blur or Enter, clamped to min..max. */
export function UnitNumberInput({
  value,
  onChange,
  unit,
  min,
  max,
  ariaLabel,
  testId,
}: {
  value: number;
  onChange: (n: number) => void;
  unit: string;
  min: number;
  max: number;
  ariaLabel?: string;
  testId?: string;
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const n = Number(text);
  const invalid = text.trim() !== '' && (!Number.isInteger(n) || n < min || n > max);
  const commit = () => {
    const v = Number(text);
    const next = Number.isFinite(v) && text.trim() !== '' ? Math.min(max, Math.max(min, Math.round(v))) : value;
    setText(String(next));
    if (next !== value) onChange(next);
  };
  return (
    <div className="unit-input">
      <input
        className="input"
        inputMode="numeric"
        value={text}
        aria-label={ariaLabel}
        aria-invalid={invalid}
        data-testid={testId}
        onChange={(e) => setText(e.target.value.replace(/[^0-9]/g, ''))}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
        }}
      />
      <span className="unit">{unit}</span>
    </div>
  );
}

/** Money input that edits in dollars but reports integer cents. */
export function MoneyInput({
  value,
  onChange,
  id,
  allowNegative = false,
  ariaLabel,
  testId,
}: {
  value: Cents;
  onChange: (c: Cents) => void;
  id?: string;
  allowNegative?: boolean;
  ariaLabel?: string;
  testId?: string;
}) {
  const cur = getActiveCurrency();
  const [text, setText] = useState(centsToInput(value, cur));
  const [invalid, setInvalid] = useState(false);
  useEffect(() => {
    const parsed = parseMoney(text, cur);
    if (parsed !== value) setText(centsToInput(value, cur));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <div className="money-input">
      <span className="prefix">{cur.symbol}</span>
      <input
        id={id}
        className="input"
        inputMode={cur.minorUnits ? 'decimal' : 'numeric'}
        value={text}
        aria-label={ariaLabel}
        aria-invalid={invalid}
        data-testid={testId}
        onChange={(e) => {
          setText(e.target.value);
          const c = parseMoney(e.target.value, cur);
          const ok = c !== null && (allowNegative || c >= 0);
          setInvalid(!ok && e.target.value.trim() !== '');
          if (ok) onChange(c!);
          else if (e.target.value.trim() === '') onChange(0);
        }}
      />
    </div>
  );
}

export function Modal({ title, onClose, children, footer }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  const id = useId();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby={id}>
        <div className="row-between">
          <h2 id={id}>{title}</h2>
          <button className="btn ghost icon" onClick={onClose} aria-label="Close">
            <LuX />
          </button>
        </div>
        {children}
        {footer ? <div className="row" style={{ justifyContent: 'flex-end' }}>{footer}</div> : null}
      </div>
    </div>
  );
}

export function Segmented<T extends string>({ options, value, onChange, label }: { options: Array<{ value: T; label: string }>; value: T; onChange: (v: T) => void; label: string }) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function ProgressBar({ value, label }: { value: number; label: string }) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  return (
    <div className="bar" role="progressbar" aria-label={label} aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
      <span style={{ width: `${pct}%` }} />
    </div>
  );
}

/** Two-step inline confirmation, since the artifact frame blocks confirm(). */
export function ConfirmButton({ label, confirmLabel, onConfirm, className = 'btn', icon, testId }: { label: string; confirmLabel: string; onConfirm: () => void; className?: string; icon?: ReactNode; testId?: string }) {
  const [armed, setArmed] = useState(false);
  if (!armed)
    return (
      <button className={className} onClick={() => setArmed(true)} data-testid={testId}>
        {icon}
        {label}
      </button>
    );
  return (
    <span className="row">
      <button
        className="btn primary sm"
        data-testid={testId ? `${testId}-confirm` : undefined}
        onClick={() => {
          setArmed(false);
          onConfirm();
        }}
      >
        {confirmLabel}
      </button>
      <button className="btn ghost sm" onClick={() => setArmed(false)}>
        Cancel
      </button>
    </span>
  );
}
