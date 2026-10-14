/**
 * Small, dependency-free SVG charts drawn at the container's real pixel width
 * (so text stays legible on phones). Colours come from CSS tokens; every chart
 * has a legend for 2+ series and a hover/tap tooltip.
 */
import { useEffect, useRef, useState, type PointerEvent as RPointerEvent, type ReactNode, type RefObject } from 'react';
import { formatMoney } from '../domain/money';

function useWidth<T extends HTMLElement>(fallback = 640): [RefObject<T | null>, number] {
  const ref = useRef<T | null>(null);
  const [w, setW] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setW(Math.max(260, Math.round(el.getBoundingClientRect().width)));
    update();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

export function niceTicks(min: number, max: number, count = 4): number[] {
  if (min === max) {
    max = min + 1;
  }
  const span = max - min;
  const raw = span / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
  const start = Math.floor(min / step) * step;
  const end = Math.ceil(max / step) * step;
  const out: number[] = [];
  for (let v = start; v <= end + step / 2; v += step) out.push(Math.round(v));
  return out;
}

export interface LineSeries {
  name: string;
  color: string;
  values: number[];
  dashed?: boolean;
  area?: boolean;
  width?: number;
}

const money = (c: number) => formatMoney(c, { compact: true });

export function LineChart({
  series,
  labels,
  height = 220,
  reference,
  markers = [],
  formatY = money,
  ariaLabel,
  tooltipExtra,
}: {
  series: LineSeries[];
  labels: string[];
  height?: number;
  reference?: { value: number; label: string };
  markers?: Array<{ index: number; label: string }>;
  formatY?: (v: number) => string;
  ariaLabel: string;
  tooltipExtra?: (i: number) => ReactNode;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const n = labels.length;
  const all = series.flatMap((s) => s.values).concat(reference ? [reference.value] : []);
  const ticks = niceTicks(Math.min(0, ...all), Math.max(...all, 1));
  const yMin = ticks[0];
  const yMax = ticks[ticks.length - 1];
  const padL = 58;
  const padR = 12;
  const padT = 10;
  const padB = 26;
  const iw = width - padL - padR;
  const ih = height - padT - padB;
  const x = (i: number) => padL + (n <= 1 ? 0 : (i / (n - 1)) * iw);
  const y = (v: number) => padT + ih - ((v - yMin) / (yMax - yMin || 1)) * ih;
  const xTickEvery = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(iw / 80))));

  const onMove = (e: RPointerEvent<SVGRectElement>) => {
    const rect = (e.currentTarget as SVGRectElement).getBoundingClientRect();
    const px = e.clientX - rect.left;
    const i = Math.round((px / rect.width) * (n - 1));
    setHover(Math.max(0, Math.min(n - 1, i)));
  };

  return (
    <div className="chart" ref={ref}>
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={ariaLabel}>
        {ticks.map((t) => (
          <g key={t}>
            <line className="grid-line" x1={padL} x2={width - padR} y1={y(t)} y2={y(t)} />
            <text x={padL - 8} y={y(t) + 3} textAnchor="end">
              {formatY(t)}
            </text>
          </g>
        ))}
        {yMin < 0 ? <line x1={padL} x2={width - padR} y1={y(0)} y2={y(0)} stroke="var(--ink-2)" strokeWidth={1} /> : null}
        {labels.map((l, i) =>
          (i % xTickEvery === 0 && (i === n - 1 || n - 1 - i >= xTickEvery * 0.6)) || i === n - 1 ? (
            <text key={i} x={x(i)} y={height - 8} textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}>
              {l}
            </text>
          ) : null,
        )}
        {reference ? (
          <g>
            <line x1={padL} x2={width - padR} y1={y(reference.value)} y2={y(reference.value)} stroke="var(--critical)" strokeDasharray="4 4" strokeWidth={1.5} />
            <text x={width - padR} y={y(reference.value) - 5} textAnchor="end" style={{ fill: 'var(--critical)' }}>
              {reference.label}
            </text>
          </g>
        ) : null}
        {markers.map((m) => (
          <g key={`${m.index}-${m.label}`}>
            <line x1={x(m.index)} x2={x(m.index)} y1={padT} y2={padT + ih} stroke="var(--ink-2)" strokeDasharray="2 3" strokeWidth={1} />
            <text x={x(m.index) + 4} y={padT + 10} textAnchor="start" style={{ fill: 'var(--ink-2)' }}>
              {m.label}
            </text>
          </g>
        ))}
        {series.map((s) => {
          const d = s.values.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
          return (
            <g key={s.name}>
              {s.area ? <path d={`${d}L${x(s.values.length - 1)},${y(Math.max(yMin, 0))}L${x(0)},${y(Math.max(yMin, 0))}Z`} fill={s.color} opacity={0.12} /> : null}
              <path d={d} fill="none" stroke={s.color} strokeWidth={s.width ?? 2} strokeDasharray={s.dashed ? '5 4' : undefined} strokeLinejoin="round" strokeLinecap="round" />
              <circle cx={x(s.values.length - 1)} cy={y(s.values[s.values.length - 1] ?? 0)} r={3.5} fill={s.color} stroke="var(--surface)" strokeWidth={2} />
            </g>
          );
        })}
        {hover !== null ? (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={padT} y2={padT + ih} stroke="var(--ink-2)" strokeWidth={1} />
            {series.map((s) => (
              <circle key={s.name} cx={x(hover)} cy={y(s.values[hover] ?? 0)} r={4.5} fill={s.color} stroke="var(--surface)" strokeWidth={2} />
            ))}
          </g>
        ) : null}
        <rect x={padL} y={padT} width={iw} height={ih} fill="transparent" onPointerMove={onMove} onPointerDown={onMove} onPointerLeave={() => setHover(null)} />
      </svg>
      {hover !== null ? (
        <div className="tooltip" style={{ left: Math.min(x(hover) + 12, width - 190), top: 8 }}>
          <div style={{ fontWeight: 700, marginBottom: 4 }}>{labels[hover]}</div>
          {series.map((s) => (
            <div className="t-row" key={s.name}>
              <span className="legend-item">
                <span className="swatch" style={{ background: s.color }} />
                {s.name}
              </span>
              <span className="num">{formatY(s.values[hover] ?? 0)}</span>
            </div>
          ))}
          {tooltipExtra ? tooltipExtra(hover) : null}
        </div>
      ) : null}
      {series.length > 1 || reference ? (
        <div className="legend" style={{ marginTop: 6 }}>
          {series.map((s) => (
            <span className="legend-item" key={s.name}>
              <span className="swatch" style={{ background: s.color, opacity: s.dashed ? 0.7 : 1 }} />
              {s.name}
            </span>
          ))}
          {reference ? (
            <span className="legend-item">
              <span className="swatch" style={{ background: 'var(--critical)' }} />
              {reference.label}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export interface BarSegment {
  name: string;
  value: number;
  color: string;
}

/** Horizontal stacked bars with a value column. */
export function HBars({ rows, legend }: { rows: Array<{ label: string; segments: BarSegment[] }>; legend?: Array<{ name: string; color: string }> }) {
  const max = Math.max(1, ...rows.map((r) => r.segments.reduce((t, s) => t + s.value, 0)));
  return (
    <div className="stack">
      {legend && legend.length > 1 ? (
        <div className="legend">
          {legend.map((l) => (
            <span className="legend-item" key={l.name}>
              <span className="swatch box" style={{ background: l.color }} />
              {l.name}
            </span>
          ))}
        </div>
      ) : null}
      <div className="hbars">
        {rows.map((r) => {
          const total = r.segments.reduce((t, s) => t + s.value, 0);
          return (
            <div className="hbar-row" key={r.label} title={r.segments.map((s) => `${s.name}: ${formatMoney(s.value)}`).join(' · ')}>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.label}</span>
              <div className="hbar-track" style={{ width: `${Math.max(2, (total / max) * 100)}%`, background: 'transparent' }}>
                {r.segments
                  .filter((s) => s.value > 0)
                  .map((s) => (
                    <span key={s.name} style={{ width: `${(s.value / total) * 100}%`, background: s.color }} />
                  ))}
              </div>
              <span className="amount">{formatMoney(total)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Vertical columns, optionally grouped by series, with per-bar tooltips. */
export function Columns({
  labels,
  series,
  height = 200,
  ariaLabel,
  reference,
}: {
  labels: string[];
  series: Array<{ name: string; color: string; values: number[] }>;
  height?: number;
  ariaLabel: string;
  reference?: { value: number; label: string };
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<{ i: number; s: number } | null>(null);
  const all = series.flatMap((s) => s.values).concat(reference ? [reference.value] : []);
  const ticks = niceTicks(Math.min(0, ...all), Math.max(1, ...all));
  const yMin = ticks[0];
  const yMax = ticks[ticks.length - 1];
  const padL = 54;
  const padR = 8;
  const padT = 10;
  const padB = 24;
  const iw = width - padL - padR;
  const ih = height - padT - padB;
  const n = labels.length;
  const groupW = iw / Math.max(1, n);
  const gap = 2;
  const barW = Math.max(2, (groupW * 0.78 - gap * (series.length - 1)) / series.length);
  const y = (v: number) => padT + ih - ((v - yMin) / (yMax - yMin || 1)) * ih;
  const xTickEvery = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(iw / 60))));
  return (
    <div className="chart" ref={ref}>
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={ariaLabel}>
        {ticks.map((t) => (
          <g key={t}>
            <line className="grid-line" x1={padL} x2={width - padR} y1={y(t)} y2={y(t)} />
            <text x={padL - 8} y={y(t) + 3} textAnchor="end">
              {formatMoney(t, { compact: true })}
            </text>
          </g>
        ))}
        {labels.map((l, i) => {
          const gx = padL + i * groupW + groupW * 0.11;
          return (
            <g key={i}>
              {series.map((s, si) => {
                const v = s.values[i] ?? 0;
                const top = y(Math.max(0, v));
                const h = Math.max(v === 0 ? 0 : 1, Math.abs(y(v) - y(0)));
                const bx = gx + si * (barW + gap);
                return (
                  <g key={s.name}>
                    <rect x={bx} y={v >= 0 ? top : y(0)} width={barW} height={h} rx={Math.min(3, barW / 2)} fill={s.color} opacity={hover && (hover.i !== i || hover.s !== si) ? 0.45 : 1} />
                    <rect
                      x={bx - gap / 2}
                      y={padT}
                      width={barW + gap}
                      height={ih}
                      fill="transparent"
                      onPointerEnter={() => setHover({ i, s: si })}
                      onPointerDown={() => setHover({ i, s: si })}
                      onPointerLeave={() => setHover(null)}
                    />
                  </g>
                );
              })}
              {i % xTickEvery === 0 ? (
                <text x={padL + i * groupW + groupW / 2} y={height - 8} textAnchor="middle">
                  {l}
                </text>
              ) : null}
            </g>
          );
        })}
        <line className="axis-line" x1={padL} x2={width - padR} y1={y(0)} y2={y(0)} />
        {reference ? (
          <g>
            <line x1={padL} x2={width - padR} y1={y(reference.value)} y2={y(reference.value)} stroke="var(--ink-2)" strokeDasharray="4 4" />
            <text x={width - padR} y={y(reference.value) - 4} textAnchor="end" style={{ fill: 'var(--ink-2)' }}>
              {reference.label}
            </text>
          </g>
        ) : null}
      </svg>
      {hover ? (
        <div className="tooltip" style={{ left: Math.min(padL + hover.i * groupW + groupW, width - 180), top: 6 }}>
          <div style={{ fontWeight: 700 }}>{labels[hover.i]}</div>
          <div className="t-row">
            <span>{series[hover.s].name}</span>
            <span className="num">{formatMoney(series[hover.s].values[hover.i] ?? 0)}</span>
          </div>
        </div>
      ) : null}
      {series.length > 1 ? (
        <div className="legend" style={{ marginTop: 6 }}>
          {series.map((s) => (
            <span className="legend-item" key={s.name}>
              <span className="swatch box" style={{ background: s.color }} />
              {s.name}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
