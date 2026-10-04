import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { Bucket, Candle } from './summary';
import { formatMs, modelLabel } from './summary';
import type { TelemetrySpan } from './types';

const PAD = { left: 52, right: 12, top: 10, bottom: 22 };

/** Track the rendered width so charts draw at 1:1 pixels instead of scaling text. */
function useWidth<T extends HTMLElement>(fallback = 560) {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(fallback);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return undefined;
    const initial = Math.floor(node.getBoundingClientRect().width);
    if (initial > 0) setWidth(initial);
    const observer = new ResizeObserver(([entry]) => {
      const next = Math.floor(entry.contentRect.width);
      if (next > 0) setWidth(next);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

/** Round an axis maximum up to 1, 2, 2.5 or 5 × 10ⁿ. */
export function niceMax(value: number): number {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 2, 2.5, 5, 10]) {
    if (value <= step * magnitude) return step * magnitude;
  }
  return 10 * magnitude;
}

function bucketLabel(bucket: Bucket): string {
  const hourly = bucket.end - bucket.start < 2 * 60 * 60 * 1000;
  const date = new Date(bucket.start);
  return hourly
    ? date.toLocaleTimeString(undefined, { hour: 'numeric' })
    : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** Up to ~6 evenly spaced x labels so they never collide. */
function xTicks(count: number, width: number): number[] {
  const max = Math.max(2, Math.min(count, Math.floor(width / 80)));
  if (count <= max) return Array.from({ length: count }, (_, i) => i);
  const step = (count - 1) / (max - 1);
  return Array.from({ length: max }, (_, i) => Math.round(i * step));
}

export type SeriesDef = { key: string; label: string; color: string };

export function Legend({ series }: { series: SeriesDef[] }) {
  return (
    <ul className="tm-legend">
      {series.map((item) => (
        <li key={item.key}>
          <span className="tm-swatch" style={{ background: item.color }} />
          {item.label}
        </li>
      ))}
    </ul>
  );
}

function Tooltip({ left, top, children }: { left: number; top: number; children: ReactNode }) {
  return (
    <div className="tm-tooltip" style={{ left, top }}>
      {children}
    </div>
  );
}

/** Rect with only the top corners rounded, anchored to the baseline. */
function topRoundedBar(x: number, y: number, w: number, h: number, r: number) {
  const radius = Math.min(r, w / 2, h);
  return `M${x},${y + h} V${y + radius} Q${x},${y} ${x + radius},${y} H${x + w - radius} Q${x + w},${y} ${x + w},${y + radius} V${y + h} Z`;
}

/** Stacked bars per time bucket with a per-bucket hover breakdown. */
export function StackedBars({
  buckets,
  series,
  values,
  format,
  height = 200,
  label,
}: {
  buckets: Bucket[];
  series: SeriesDef[];
  values: number[][];
  format: (value: number) => string;
  height?: number;
  label: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const totals = values.map((row) => row.reduce((sum, value) => sum + value, 0));
  const max = niceMax(Math.max(0, ...totals));
  const innerW = width - PAD.left - PAD.right;
  const innerH = height - PAD.top - PAD.bottom;
  const slot = innerW / Math.max(1, buckets.length);
  const barW = Math.max(2, Math.min(28, slot * 0.7));
  const x = (i: number) => PAD.left + slot * i + (slot - barW) / 2;
  const y = (value: number) => PAD.top + innerH - (value / max) * innerH;
  const ticks = [0, max / 2, max];

  return (
    <div className="tm-chart" ref={ref} onPointerLeave={() => setHover(null)}>
      <svg
        width={width}
        height={height}
        role="img"
        aria-label={label}
        onPointerMove={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          const index = Math.floor((event.clientX - rect.left - PAD.left) / slot);
          setHover(index >= 0 && index < buckets.length ? index : null);
        }}
      >
        {ticks.map((tick) => (
          <g key={tick}>
            <line className="tm-grid" x1={PAD.left} x2={width - PAD.right} y1={y(tick)} y2={y(tick)} />
            <text className="tm-axis" x={PAD.left - 6} y={y(tick) + 3.5} textAnchor="end">{format(tick)}</text>
          </g>
        ))}
        {hover !== null ? (
          <rect className="tm-hover-band" x={PAD.left + slot * hover} y={PAD.top} width={slot} height={innerH} />
        ) : null}
        {values.map((row, i) => {
          let base = 0;
          const first = row.findIndex((value) => value > 0);
          const top = row.reduce((last, value, s) => (value > 0 ? s : last), -1);
          return (
            <g key={buckets[i].start}>
              {row.map((value, s) => {
                if (value <= 0) return null;
                const y0 = y(base);
                base += value;
                const y1 = y(base);
                // 2px surface gap below every segment except the bottom one.
                const h = Math.max(1, y0 - y1 - (s === first ? 0 : 2));
                return s === top ? (
                  <path key={series[s].key} d={topRoundedBar(x(i), y1, barW, h, 4)} fill={series[s].color} />
                ) : (
                  <rect key={series[s].key} x={x(i)} y={y1} width={barW} height={h} fill={series[s].color} />
                );
              })}
            </g>
          );
        })}
        {xTicks(buckets.length, innerW).map((i) => (
          <text key={i} className="tm-axis" x={x(i) + barW / 2} y={height - 6} textAnchor="middle">
            {bucketLabel(buckets[i])}
          </text>
        ))}
      </svg>
      {hover !== null ? (
        <Tooltip left={Math.min(Math.max(x(hover) + barW / 2, 90), width - 90)} top={PAD.top}>
          <strong>{bucketLabel(buckets[hover])} · {format(totals[hover])}</strong>
          {series.map((item, s) => (values[hover][s] > 0 ? (
            <span key={item.key} className="tm-tooltip-row">
              <i className="tm-swatch" style={{ background: item.color }} />
              {item.label}
              <b>{format(values[hover][s])}</b>
            </span>
          ) : null))}
        </Tooltip>
      ) : null}
    </div>
  );
}

/**
 * Candles: the wick spans min to max, the body p25 to p75, a tick marks the
 * median. A volume strip underneath counts calls per bucket.
 */
export function CandleChart({
  buckets,
  candles,
  format,
  label,
  height = 240,
}: {
  buckets: Bucket[];
  candles: Array<Candle | null>;
  format: (value: number) => string;
  label: string;
  height?: number;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const volumeH = 36;
  const gap = 10;
  const innerW = width - PAD.left - PAD.right;
  const priceH = height - PAD.top - PAD.bottom - volumeH - gap;
  const max = niceMax(Math.max(0, ...candles.map((c) => c?.max ?? 0)));
  const maxCount = Math.max(1, ...candles.map((c) => c?.count ?? 0));
  const slot = innerW / Math.max(1, buckets.length);
  const bodyW = Math.max(3, Math.min(16, slot * 0.6));
  const cx = (i: number) => PAD.left + slot * i + slot / 2;
  const y = (value: number) => PAD.top + priceH - (value / max) * priceH;
  const volumeTop = PAD.top + priceH + gap;
  const ticks = [0, max / 2, max];
  const active = hover !== null ? candles[hover] : null;

  return (
    <div className="tm-chart" ref={ref} onPointerLeave={() => setHover(null)}>
      <svg
        width={width}
        height={height}
        role="img"
        aria-label={label}
        onPointerMove={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          const index = Math.floor((event.clientX - rect.left - PAD.left) / slot);
          setHover(index >= 0 && index < buckets.length ? index : null);
        }}
      >
        {ticks.map((tick) => (
          <g key={tick}>
            <line className="tm-grid" x1={PAD.left} x2={width - PAD.right} y1={y(tick)} y2={y(tick)} />
            <text className="tm-axis" x={PAD.left - 6} y={y(tick) + 3.5} textAnchor="end">{format(tick)}</text>
          </g>
        ))}
        <text className="tm-axis" x={PAD.left - 6} y={volumeTop + 9} textAnchor="end">calls</text>
        {hover !== null ? (
          <rect className="tm-hover-band" x={PAD.left + slot * hover} y={PAD.top} width={slot} height={priceH + gap + volumeH} />
        ) : null}
        {candles.map((c, i) => {
          if (!c) return null;
          const volume = (c.count / maxCount) * volumeH;
          return (
            <g key={buckets[i].start}>
              <line className="tm-wick" x1={cx(i)} x2={cx(i)} y1={y(c.max)} y2={y(c.min)} />
              <rect
                className="tm-candle"
                x={cx(i) - bodyW / 2}
                y={y(c.q3)}
                width={bodyW}
                height={Math.max(2, y(c.q1) - y(c.q3))}
                rx={2}
              />
              <line className="tm-median" x1={cx(i) - bodyW / 2 - 2} x2={cx(i) + bodyW / 2 + 2} y1={y(c.median)} y2={y(c.median)} />
              <path className="tm-volume" d={topRoundedBar(cx(i) - bodyW / 2, volumeTop + volumeH - volume, bodyW, Math.max(1, volume), 2)} />
            </g>
          );
        })}
        {xTicks(buckets.length, innerW).map((i) => (
          <text key={i} className="tm-axis" x={cx(i)} y={height - 6} textAnchor="middle">
            {bucketLabel(buckets[i])}
          </text>
        ))}
      </svg>
      {hover !== null ? (
        <Tooltip left={Math.min(Math.max(cx(hover), 90), width - 90)} top={PAD.top}>
          <strong>{bucketLabel(buckets[hover])}</strong>
          {active ? (
            <>
              <span className="tm-tooltip-row">max<b>{format(active.max)}</b></span>
              <span className="tm-tooltip-row">p75<b>{format(active.q3)}</b></span>
              <span className="tm-tooltip-row">median<b>{format(active.median)}</b></span>
              <span className="tm-tooltip-row">p25<b>{format(active.q1)}</b></span>
              <span className="tm-tooltip-row">min<b>{format(active.min)}</b></span>
              <small>{active.count} call{active.count === 1 ? '' : 's'}</small>
            </>
          ) : <small>No calls</small>}
        </Tooltip>
      ) : null}
    </div>
  );
}

/** One run's LLM turns and tool calls on a shared time axis. */
export function Waterfall({
  spans,
  formatCost,
}: {
  spans: TelemetrySpan[];
  formatCost: (span: TelemetrySpan) => string | null;
}) {
  const rows = spans.filter((span) => span.kind !== 'agent_run');
  const root = spans.find((span) => span.parentId === null) ?? spans[0];
  if (!root) return null;
  const start = Math.min(...spans.map((span) => span.startedAt));
  const end = Math.max(...spans.map((span) => span.startedAt + span.durationMs), start + 1);
  const total = end - start;
  const list = rows.length > 0 ? rows : [root];

  return (
    <div className="tm-waterfall" role="table" aria-label="Run timeline">
      <div className="tm-wf-row tm-wf-head" role="row">
        <span role="columnheader">Step</span>
        <span role="columnheader">Timeline · {formatMs(total)}</span>
        <span role="columnheader">Duration</span>
        <span role="columnheader">Tokens / cost</span>
      </div>
      {list.map((span) => {
        const left = ((span.startedAt - start) / total) * 100;
        const widthPct = Math.max(0.6, (span.durationMs / total) * 100);
        const name = span.kind === 'tool' ? span.toolName ?? 'tool' : modelLabel(span.model);
        const spanCost = formatCost(span);
        return (
          <div key={span.spanId} className="tm-wf-row" role="row">
            <span role="cell" className="tm-wf-name" title={span.error ?? name}>
              <em className={`tm-kind tm-kind-${span.kind}`}>{span.kind === 'tool' ? 'tool' : 'llm'}</em>
              {name}
              {span.status !== 'ok' ? <b className="tm-status-error"> · {span.status}</b> : null}
            </span>
            <span role="cell" className="tm-wf-track">
              <i
                className={`tm-wf-bar tm-wf-${span.kind}${span.status === 'error' ? ' error' : ''}`}
                style={{ left: `${left}%`, width: `${Math.min(widthPct, 100 - left)}%` }}
              />
            </span>
            <span role="cell" className="tm-num">{formatMs(span.durationMs)}</span>
            <span role="cell" className="tm-num">
              {span.kind === 'llm'
                ? `${(span.tokens.prompt + span.tokens.completion).toLocaleString()} tok${spanCost ? ` · ${spanCost}` : ''}`
                : '—'}
            </span>
          </div>
        );
      })}
    </div>
  );
}
