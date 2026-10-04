import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ReloadIcon } from '@radix-ui/react-icons';
import { Button } from '@radix-ui/themes';
import { CandleChart, Legend, StackedBars, Waterfall, type SeriesDef } from './charts';
import {
  OTHER,
  RANGES,
  formatCount,
  formatMs,
  formatPercent,
  formatUsd,
  spansForTrace,
  summarize,
  type Kpi,
  type RangeId,
  type Slice,
  type TelemetrySummary,
} from './summary';
import type { TelemetrySpan } from './types';
import './telemetry.css';

type Tab = 'overview' | 'runs' | 'log';

const seriesColor = (index: number, label: string) => (label === OTHER ? 'var(--tm-other)' : `var(--tm-s${index + 1})`);

const SOURCE_LABELS: Record<string, string> = {
  agent: 'Agent',
  complete: 'Tutor chat',
  quiz_generation: 'Quiz generation',
  quiz_generation_fallback: 'Quiz generation (retry)',
  quiz_grading: 'Quiz grading',
  quiz_grading_fallback: 'Quiz grading (retry)',
  quiz_followup_generation: 'Quiz follow-up',
  create_card_fill: 'Card generation',
};

export const sourceLabel = (source: string) => SOURCE_LABELS[source] ?? source.replace(/_/g, ' ');

function Delta({ kpi, format, points }: { kpi: Kpi; format: (value: number) => string; points?: boolean }) {
  if (kpi.previous === null) return <span className="tm-delta">No prior data</span>;
  const diff = kpi.value - kpi.previous;
  if (points) {
    // Rates compare in percentage points; a relative change of a ratio misleads.
    const pp = diff * 100;
    return (
      <span className="tm-delta" title={`Previous period: ${format(kpi.previous)}`}>
        {pp > 0 ? '▲' : pp < 0 ? '▼' : '■'} {pp > 0 ? '+' : ''}{pp.toFixed(1)} pts vs previous
      </span>
    );
  }
  if (kpi.previous === 0) {
    return <span className="tm-delta">{diff === 0 ? '■ No change' : `▲ ${format(kpi.value)} vs none`}</span>;
  }
  const pct = (diff / kpi.previous) * 100;
  const arrow = diff > 0 ? '▲' : diff < 0 ? '▼' : '■';
  return (
    <span className="tm-delta" title={`Previous period: ${format(kpi.previous)}`}>
      {arrow} {diff > 0 ? '+' : ''}{pct.toFixed(0)}% vs previous
    </span>
  );
}

function StatTile({ label, kpi, format, note, points }: {
  label: string;
  kpi: Kpi;
  format: (value: number) => string;
  note?: string;
  points?: boolean;
}) {
  return (
    <div className="tm-tile">
      <small>{label}</small>
      <strong>{format(kpi.value)}</strong>
      <Delta kpi={kpi} format={format} points={points} />
      {note ? <span className="tm-note">{note}</span> : null}
    </div>
  );
}

function BreakdownCard({ title, total, slices, format, colorFor }: {
  title: string;
  total: string;
  slices: Slice[];
  format: (value: number) => string;
  colorFor: (label: string) => string;
}) {
  const sum = slices.reduce((acc, slice) => acc + slice.value, 0);
  return (
    <section className="tm-card tm-breakdown">
      <header>
        <h3>{title}</h3>
        <strong>{total}</strong>
      </header>
      {sum > 0 ? (
        <div className="tm-proportion" aria-hidden="true">
          {slices.map((slice) => (
            <i key={slice.label} style={{ flex: `${slice.value / sum} 1 0`, background: colorFor(slice.label) }} />
          ))}
        </div>
      ) : null}
      <ul>
        {slices.length === 0 ? <li className="tm-muted">Nothing recorded</li> : slices.map((slice) => (
          <li key={slice.label}>
            <span className="tm-swatch" style={{ background: colorFor(slice.label) }} />
            <span className="tm-ellipsis">{slice.label}</span>
            <b>{format(slice.value)}</b>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ChartCard({ title, subtitle, legend, children }: {
  title: string;
  subtitle?: string;
  legend?: SeriesDef[];
  children: ReactNode;
}) {
  return (
    <section className="tm-card">
      <header className="tm-card-head">
        <div>
          <h3>{title}</h3>
          {subtitle ? <p className="tm-muted">{subtitle}</p> : null}
        </div>
        {legend && legend.length > 1 ? <Legend series={legend} /> : null}
      </header>
      {children}
    </section>
  );
}

function Overview({ summary }: { summary: TelemetrySummary }) {
  const [candleMetric, setCandleMetric] = useState<'latency' | 'cost'>('latency');
  const modelSeries: SeriesDef[] = summary.series.map((label, index) => ({ key: label, label, color: seriesColor(index, label) }));
  const modelColor = (label: string) => {
    const index = summary.series.indexOf(label);
    return index >= 0 ? seriesColor(index, label) : 'var(--tm-other)';
  };
  const tokenSeries: SeriesDef[] = [
    { key: 'uncached', label: 'Prompt', color: 'var(--tm-s1)' },
    { key: 'cached', label: 'Cached prompt', color: 'var(--tm-s2)' },
    { key: 'output', label: 'Completion', color: 'var(--tm-s3)' },
    { key: 'reasoning', label: 'Reasoning', color: 'var(--tm-s4)' },
  ];
  const cacheSeries: SeriesDef[] = [
    { key: 'uncached', label: 'Uncached', color: 'var(--tm-s1)' },
    { key: 'cached', label: 'Cached', color: 'var(--tm-s2)' },
  ];
  const { kpis } = summary;
  const subscriptionNote = summary.includesSubscription ? 'Includes notional cost of CLI-login runs' : undefined;

  return (
    <>
      <div className="tm-tiles">
        <StatTile label="Total spend" kpi={kpis.spend} format={formatUsd} note={subscriptionNote} />
        <StatTile label="Requests" kpi={kpis.requests} format={formatCount} />
        <StatTile label="Token volume" kpi={kpis.tokens} format={formatCount} />
        <StatTile label="Cache hit rate" kpi={kpis.cacheHitRate} format={formatPercent} points />
        <StatTile label="Blended $/1M" kpi={kpis.blendedPerMillion} format={formatUsd} />
      </div>

      <div className="tm-grid-3">
        <BreakdownCard title="Spend" total={formatUsd(kpis.spend.value)} slices={summary.breakdowns.spend} format={formatUsd} colorFor={modelColor} />
        <BreakdownCard title="Requests" total={formatCount(kpis.requests.value)} slices={summary.breakdowns.requests} format={formatCount} colorFor={modelColor} />
        <BreakdownCard title="Tokens" total={formatCount(kpis.tokens.value)} slices={summary.breakdowns.tokens} format={formatCount} colorFor={modelColor} />
      </div>

      <section className="tm-card">
        <header className="tm-card-head">
          <div>
            <h3>{candleMetric === 'latency' ? 'Latency per call' : 'Cost per call'}</h3>
            <p className="tm-muted">Wick: min to max · body: p25 to p75 · line: median · bars: call volume</p>
          </div>
          <div className="tm-segmented" role="radiogroup" aria-label="Candle metric">
            {(['latency', 'cost'] as const).map((metric) => (
              <button
                key={metric}
                type="button"
                role="radio"
                aria-checked={candleMetric === metric}
                className={candleMetric === metric ? 'selected' : ''}
                onClick={() => setCandleMetric(metric)}
              >
                {metric === 'latency' ? 'Latency' : 'Cost'}
              </button>
            ))}
          </div>
        </header>
        <CandleChart
          buckets={summary.buckets}
          candles={candleMetric === 'latency' ? summary.latencyCandles : summary.costCandles}
          format={candleMetric === 'latency' ? formatMs : formatUsd}
          label={candleMetric === 'latency' ? 'Distribution of call latency per period' : 'Distribution of cost per call per period'}
        />
      </section>

      <div className="tm-grid-2">
        <ChartCard title="Spend by model" legend={modelSeries}>
          <StackedBars buckets={summary.buckets} series={modelSeries} values={summary.spendByModel} format={formatUsd} label="Spend by model over time" />
        </ChartCard>
        <ChartCard title="Requests by model" legend={modelSeries}>
          <StackedBars buckets={summary.buckets} series={modelSeries} values={summary.requestsByModel} format={formatCount} label="Requests by model over time" />
        </ChartCard>
        <ChartCard title="Token breakdown" legend={tokenSeries}>
          <StackedBars
            buckets={summary.buckets}
            series={tokenSeries}
            values={summary.tokenTypes.map((t) => [t.uncached, t.cached, t.output, t.reasoning])}
            format={formatCount}
            label="Prompt, cached, completion and reasoning tokens over time"
          />
        </ChartCard>
        <ChartCard title="Prompt token caching" legend={cacheSeries}>
          <StackedBars
            buckets={summary.buckets}
            series={cacheSeries}
            values={summary.tokenTypes.map((t) => [t.uncached, t.cached])}
            format={formatCount}
            label="Uncached and cached prompt tokens over time"
          />
        </ChartCard>
      </div>

      <section className="tm-card">
        <header className="tm-card-head"><h3>Top features</h3></header>
        <table className="tm-table">
          <thead>
            <tr>
              <th>Feature</th><th className="tm-num">Requests</th><th className="tm-num">Errors</th>
              <th className="tm-num">Tokens</th><th className="tm-num">Spend</th><th className="tm-num">p50 latency</th>
            </tr>
          </thead>
          <tbody>
            {summary.sources.length === 0 ? (
              <tr><td colSpan={6} className="tm-muted">No calls in this period</td></tr>
            ) : summary.sources.map((row) => (
              <tr key={row.source}>
                <td>{sourceLabel(row.source)}</td>
                <td className="tm-num">{row.requests}</td>
                <td className="tm-num">{row.errors || '—'}</td>
                <td className="tm-num">{formatCount(row.tokens)}</td>
                <td className="tm-num">{formatUsd(row.spend)}</td>
                <td className="tm-num">{formatMs(row.p50Ms)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}

function costLabel(costUsd: number | null, costSource: TelemetrySpan['costSource']) {
  if (costUsd === null) return null;
  return `${formatUsd(costUsd)}${costSource === 'subscription' ? ' (sub)' : costSource === 'estimated' ? ' (est)' : ''}`;
}

function Runs({ spans, summary }: { spans: TelemetrySpan[]; summary: TelemetrySummary }) {
  const [selected, setSelected] = useState<string | null>(null);
  const traces = summary.traces.slice(0, 200);
  const current = selected ?? traces[0]?.traceId ?? null;
  const detail = useMemo(() => (current ? spansForTrace(spans, current) : []), [spans, current]);
  const row = traces.find((trace) => trace.traceId === current);

  return (
    <div className="tm-runs">
      <section className="tm-card tm-runs-list">
        <table className="tm-table tm-table-select">
          <thead>
            <tr>
              <th>Time</th><th>Feature</th><th>Model</th><th className="tm-num">Steps</th>
              <th className="tm-num">Duration</th><th className="tm-num">Tokens</th><th className="tm-num">Cost</th>
            </tr>
          </thead>
          <tbody>
            {traces.length === 0 ? (
              <tr><td colSpan={7} className="tm-muted">No runs in this period</td></tr>
            ) : traces.map((trace) => (
              <tr
                key={trace.traceId}
                className={trace.traceId === current ? 'selected' : ''}
                onClick={() => setSelected(trace.traceId)}
                tabIndex={0}
                onKeyDown={(event) => { if (event.key === 'Enter') setSelected(trace.traceId); }}
              >
                <td>{new Date(trace.startedAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</td>
                <td>
                  {sourceLabel(trace.source)}
                  {trace.status !== 'ok' ? <span className="tm-status-error"> · {trace.status}</span> : null}
                </td>
                <td className="tm-ellipsis" title={trace.model}>{trace.model}</td>
                <td className="tm-num">{trace.llmCalls}{trace.toolCalls ? ` + ${trace.toolCalls} tools` : ''}</td>
                <td className="tm-num">{formatMs(trace.durationMs)}</td>
                <td className="tm-num">{formatCount(trace.tokens)}</td>
                <td className="tm-num">{costLabel(trace.costUsd, trace.costSource) ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      {row ? (
        <section className="tm-card tm-runs-detail">
          <header className="tm-card-head">
            <div>
              <h3>{sourceLabel(row.source)} · {row.backend}</h3>
              <p className="tm-muted">
                {new Date(row.startedAt).toLocaleString()} · {formatMs(row.durationMs)} · {row.llmCalls} LLM call{row.llmCalls === 1 ? '' : 's'}, {row.toolCalls} tool call{row.toolCalls === 1 ? '' : 's'}
              </p>
            </div>
          </header>
          {row.error ? <p className="tm-error-text">{row.error}</p> : null}
          <Waterfall spans={detail} formatCost={(span) => costLabel(span.costUsd, span.costSource)} />
        </section>
      ) : null}
    </div>
  );
}

type Trajectory = { file: string; records: Array<Record<string, unknown>>; location: string };

/** The raw request log and agent trajectories, kept for debugging prompts and replies. */
function RawLog() {
  const [activity, setActivity] = useState<Array<Record<string, unknown>>>([]);
  const [trajectories, setTrajectories] = useState<Trajectory[]>([]);

  const load = useCallback(() => {
    void window.ai?.activity?.().then(setActivity).catch(() => setActivity([]));
    void window.ai?.trajectories?.().then(setTrajectories).catch(() => setTrajectories([]));
  }, []);
  useEffect(load, [load]);

  return (
    <div className="tm-log">
      <section className="tm-card">
        <header className="tm-card-head">
          <h3>Recent API calls ({activity.length})</h3>
          <Button type="button" size="1" variant="soft" color="gray" onClick={() => window.ai?.activityClear?.().then(() => setActivity([]))}>
            Clear log
          </Button>
        </header>
        <div className="mv-ai-activity-list">
          {activity.length === 0 ? <p className="tm-muted">No API calls recorded yet.</p> : activity.map((event, index) => (
            <details key={`${String(event.requestId ?? index)}-${String(event.status ?? '')}`}>
              <summary>
                {String(event.operation ?? 'request')} · {String(event.status ?? '')} · {event.durationMs ? `${String(event.durationMs)}ms` : '—'}
                {typeof event.error === 'string' ? ` · ${event.error.slice(0, 80)}` : ''}
              </summary>
              {typeof event.responseText === 'string' ? (
                <>
                  <p className="tm-muted">Raw model response</p>
                  <pre>{event.responseText}</pre>
                </>
              ) : null}
              <pre>{JSON.stringify({ ...event, responseText: undefined, messages: undefined }, null, 2)}</pre>
              {Array.isArray(event.messages) ? (
                <details>
                  <summary>Prompt sent</summary>
                  <pre>
                    {(event.messages as Array<{ role?: string; content?: string }>)
                      .map((m) => `[${m.role}]\n${m.content}`)
                      .join('\n\n')}
                  </pre>
                </details>
              ) : null}
            </details>
          ))}
        </div>
      </section>
      <section className="tm-card">
        <header className="tm-card-head"><h3>Agent trajectories ({trajectories.length})</h3></header>
        <div className="mv-ai-activity-list">
          {trajectories.length === 0 ? <p className="tm-muted">No agent trajectories recorded yet.</p> : trajectories.map((trajectory) => (
            <details key={trajectory.file}>
              <summary>{trajectory.file} · {trajectory.records.length} events · {trajectory.location}</summary>
              <pre>{JSON.stringify(trajectory.records, null, 2)}</pre>
            </details>
          ))}
        </div>
      </section>
    </div>
  );
}

/** AI usage dashboard (Settings → AI Activity): spend, tokens, latency, and per-run traces. */
export function TelemetryView() {
  const [spans, setSpans] = useState<TelemetrySpan[] | null>(null);
  const [range, setRange] = useState<RangeId>('7d');
  const [tab, setTab] = useState<Tab>('overview');
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(() => {
    setNow(Date.now());
    if (typeof window.ai?.telemetry !== 'function') {
      setSpans([]);
      return;
    }
    void window.ai.telemetry().then(setSpans).catch(() => setSpans([]));
  }, []);
  useEffect(load, [load]);

  const summary = useMemo(() => (spans ? summarize(spans, range, now) : null), [spans, range, now]);

  const clear = async () => {
    if (!window.confirm('Clear all AI telemetry? Usage charts will start empty.')) return;
    await window.ai?.telemetryClear?.();
    load();
  };

  return (
    <div className="tm-page">
      <header className="tm-header">
        <div className="tm-header-left">
          <div>
            <h1>AI Activity</h1>
            <p className="tm-muted">Usage across every model call Concrete makes</p>
          </div>
        </div>
        <div className="tm-header-right">
          <div className="tm-segmented" role="radiogroup" aria-label="Time range">
            {RANGES.map((item) => (
              <button
                key={item.id}
                type="button"
                role="radio"
                aria-checked={range === item.id}
                className={range === item.id ? 'selected' : ''}
                onClick={() => setRange(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>
          <button type="button" className="tm-icon-button" onClick={load} aria-label="Refresh" title="Refresh">
            <ReloadIcon />
          </button>
          <Button type="button" size="1" variant="soft" color="gray" onClick={() => void clear()}>
            Clear
          </Button>
        </div>
      </header>

      <nav className="tm-tabs" role="tablist" aria-label="AI Activity sections">
        {([['overview', 'Overview'], ['runs', 'Runs'], ['log', 'Raw log']] as const).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            className={tab === id ? 'selected' : ''}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </nav>

      <main className="tm-body">
        {tab === 'log' ? <RawLog /> : !summary || !spans ? (
          <p className="tm-muted">Loading…</p>
        ) : spans.length === 0 ? (
          <div className="tm-empty">
            <strong>No AI calls recorded yet</strong>
            <p>Generate a quiz, grade an answer, or run the agent and usage will show up here.</p>
          </div>
        ) : tab === 'overview' ? (
          <Overview summary={summary} />
        ) : (
          <Runs spans={spans} summary={summary} />
        )}
      </main>
    </div>
  );
}
