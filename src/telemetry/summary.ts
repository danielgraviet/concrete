import type { TelemetrySpan } from './types';

export type RangeId = '24h' | '7d' | '30d' | '90d';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

export const RANGES: ReadonlyArray<{ id: RangeId; label: string; buckets: number; bucketMs: number }> = [
  { id: '24h', label: '24h', buckets: 24, bucketMs: HOUR },
  { id: '7d', label: '7d', buckets: 7, bucketMs: DAY },
  { id: '30d', label: '30d', buckets: 30, bucketMs: DAY },
  { id: '90d', label: '90d', buckets: 90, bucketMs: DAY },
];

/** Six categorical slots for models; the rest fold into Other. */
export const MODEL_SLOTS = 6;
export const OTHER = 'Other';

export type Kpi = { value: number; previous: number | null };

export type Slice = { label: string; value: number };

export type Bucket = { start: number; end: number };

export type Candle = {
  count: number;
  min: number;
  q1: number;
  median: number;
  q3: number;
  max: number;
};

export type SourceRow = {
  source: string;
  requests: number;
  errors: number;
  tokens: number;
  spend: number;
  p50Ms: number;
};

export type TraceRow = {
  traceId: string;
  startedAt: number;
  durationMs: number;
  source: string;
  backend: string;
  model: string;
  status: TelemetrySpan['status'];
  error?: string;
  llmCalls: number;
  toolCalls: number;
  tokens: number;
  costUsd: number | null;
  costSource: TelemetrySpan['costSource'];
};

export type TelemetrySummary = {
  kpis: {
    spend: Kpi;
    requests: Kpi;
    tokens: Kpi;
    cacheHitRate: Kpi;
    blendedPerMillion: Kpi;
  };
  /** True when part of the spend is notional (CLI login, not billed per call). */
  includesSubscription: boolean;
  breakdowns: { spend: Slice[]; requests: Slice[]; tokens: Slice[] };
  buckets: Bucket[];
  /** Models drawn as series, in palette order; may end with Other. */
  series: string[];
  spendByModel: number[][];
  requestsByModel: number[][];
  tokenTypes: Array<{ uncached: number; cached: number; output: number; reasoning: number }>;
  latencyCandles: Array<Candle | null>;
  costCandles: Array<Candle | null>;
  sources: SourceRow[];
  traces: TraceRow[];
};

const totalTokens = (span: TelemetrySpan) => span.tokens.prompt + span.tokens.completion;
const cost = (span: TelemetrySpan) => span.costUsd ?? 0;

/** Drop the provider prefix (deepseek/deepseek-v4 → deepseek-v4). */
export function modelLabel(model: string | null | undefined): string {
  if (!model) return 'unknown';
  const slash = model.lastIndexOf('/');
  return slash >= 0 ? model.slice(slash + 1) : model;
}

/**
 * Stable palette order: models ranked by all-time spend, then requests. Color
 * follows the model, so switching ranges never repaints a series.
 */
export function rankModels(spans: TelemetrySpan[]): string[] {
  const totals = new Map<string, { spend: number; requests: number }>();
  for (const span of spans) {
    if (span.kind !== 'llm') continue;
    const key = modelLabel(span.model);
    const row = totals.get(key) ?? { spend: 0, requests: 0 };
    row.spend += cost(span);
    row.requests += 1;
    totals.set(key, row);
  }
  return [...totals.entries()]
    .sort((a, b) => b[1].spend - a[1].spend || b[1].requests - a[1].requests || a[0].localeCompare(b[0]))
    .map(([model]) => model);
}

/** Linear-interpolated quantile of an ascending array. */
export function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const position = (sorted.length - 1) * q;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

export function candle(values: number[]): Candle | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return {
    count: sorted.length,
    min: sorted[0],
    q1: quantile(sorted, 0.25),
    median: quantile(sorted, 0.5),
    q3: quantile(sorted, 0.75),
    max: sorted[sorted.length - 1],
  };
}

/** Top three by value, everything else summed as Others. */
export function topSlices(values: Map<string, number>, keep = 3): Slice[] {
  const sorted = [...values.entries()]
    .filter(([, value]) => value > 0)
    .sort((a, b) => b[1] - a[1]);
  const slices = sorted.slice(0, keep).map(([label, value]) => ({ label, value }));
  const rest = sorted.slice(keep).reduce((sum, [, value]) => sum + value, 0);
  if (rest > 0) slices.push({ label: 'Others', value: rest });
  return slices;
}

/** Bucket boundaries ending at the current hour or local day. */
export function bucketsFor(range: RangeId, now: number): Bucket[] {
  const spec = RANGES.find((item) => item.id === range) ?? RANGES[1];
  const end = new Date(now);
  if (spec.bucketMs === HOUR) end.setMinutes(0, 0, 0);
  else end.setHours(0, 0, 0, 0);
  const lastStart = end.getTime();
  const buckets: Bucket[] = [];
  for (let index = spec.buckets - 1; index >= 0; index -= 1) {
    const start = new Date(lastStart);
    if (spec.bucketMs === HOUR) start.setHours(start.getHours() - index);
    else start.setDate(start.getDate() - index);
    const next = new Date(start);
    if (spec.bucketMs === HOUR) next.setHours(next.getHours() + 1);
    else next.setDate(next.getDate() + 1);
    buckets.push({ start: start.getTime(), end: next.getTime() });
  }
  return buckets;
}

function kpiTotals(calls: TelemetrySpan[]) {
  const spend = calls.reduce((sum, span) => sum + cost(span), 0);
  const tokens = calls.reduce((sum, span) => sum + totalTokens(span), 0);
  const prompt = calls.reduce((sum, span) => sum + span.tokens.prompt, 0);
  const cached = calls.reduce((sum, span) => sum + span.tokens.cacheRead, 0);
  const pricedTokens = calls
    .filter((span) => span.costUsd !== null)
    .reduce((sum, span) => sum + totalTokens(span), 0);
  return {
    spend,
    requests: calls.length,
    tokens,
    cacheHitRate: prompt > 0 ? cached / prompt : 0,
    blendedPerMillion: pricedTokens > 0 ? (spend / pricedTokens) * 1_000_000 : 0,
  };
}

export function summarize(spans: TelemetrySpan[], range: RangeId, now = Date.now()): TelemetrySummary {
  const buckets = bucketsFor(range, now);
  const from = buckets[0].start;
  const to = buckets[buckets.length - 1].end;
  const window = to - from;
  const inRange = spans.filter((span) => span.startedAt >= from && span.startedAt < to);
  const calls = inRange.filter((span) => span.kind === 'llm');
  const previousCalls = spans.filter(
    (span) => span.kind === 'llm' && span.startedAt >= from - window && span.startedAt < from,
  );
  const hasPrevious = spans.some((span) => span.startedAt < from);

  const current = kpiTotals(calls);
  const previous = hasPrevious ? kpiTotals(previousCalls) : null;
  const kpi = (key: keyof typeof current): Kpi => ({ value: current[key], previous: previous ? previous[key] : null });

  const ranked = rankModels(spans);
  const palette = ranked.slice(0, MODEL_SLOTS);
  const present = new Set(calls.map((span) => modelLabel(span.model)));
  const series = palette.filter((model) => present.has(model));
  if ([...present].some((model) => !palette.includes(model))) series.push(OTHER);
  const seriesIndex = (span: TelemetrySpan) => {
    const index = series.indexOf(modelLabel(span.model));
    return index >= 0 ? index : series.indexOf(OTHER);
  };

  const bucketIndex = (at: number) => {
    for (let index = 0; index < buckets.length; index += 1) {
      if (at >= buckets[index].start && at < buckets[index].end) return index;
    }
    return -1;
  };

  const spendByModel = buckets.map(() => series.map(() => 0));
  const requestsByModel = buckets.map(() => series.map(() => 0));
  const tokenTypes = buckets.map(() => ({ uncached: 0, cached: 0, output: 0, reasoning: 0 }));
  const latencies: number[][] = buckets.map(() => []);
  const costs: number[][] = buckets.map(() => []);

  const spendBy = new Map<string, number>();
  const requestsBy = new Map<string, number>();
  const tokensBy = new Map<string, number>();
  const sourceRows = new Map<string, SourceRow & { durations: number[] }>();

  for (const span of calls) {
    const b = bucketIndex(span.startedAt);
    const s = seriesIndex(span);
    if (b >= 0 && s >= 0) {
      spendByModel[b][s] += cost(span);
      requestsByModel[b][s] += 1;
      const t = tokenTypes[b];
      t.cached += span.tokens.cacheRead;
      t.uncached += span.tokens.prompt - span.tokens.cacheRead;
      t.reasoning += span.tokens.reasoning;
      t.output += span.tokens.completion - span.tokens.reasoning;
      if (span.status === 'ok') latencies[b].push(span.durationMs);
      if (span.costUsd !== null) costs[b].push(span.costUsd);
    }

    const model = modelLabel(span.model);
    spendBy.set(model, (spendBy.get(model) ?? 0) + cost(span));
    requestsBy.set(model, (requestsBy.get(model) ?? 0) + 1);
    tokensBy.set(model, (tokensBy.get(model) ?? 0) + totalTokens(span));

    const row = sourceRows.get(span.source) ?? {
      source: span.source, requests: 0, errors: 0, tokens: 0, spend: 0, p50Ms: 0, durations: [],
    };
    row.requests += 1;
    if (span.status === 'error') row.errors += 1;
    row.tokens += totalTokens(span);
    row.spend += cost(span);
    row.durations.push(span.durationMs);
    sourceRows.set(span.source, row);
  }

  const sources = [...sourceRows.values()]
    .map(({ durations, ...row }) => ({ ...row, p50Ms: quantile([...durations].sort((a, b) => a - b), 0.5) }))
    .sort((a, b) => b.tokens - a.tokens || b.requests - a.requests);

  return {
    kpis: {
      spend: kpi('spend'),
      requests: kpi('requests'),
      tokens: kpi('tokens'),
      cacheHitRate: kpi('cacheHitRate'),
      blendedPerMillion: kpi('blendedPerMillion'),
    },
    includesSubscription: calls.some((span) => span.costSource === 'subscription' && span.costUsd),
    breakdowns: { spend: topSlices(spendBy), requests: topSlices(requestsBy), tokens: topSlices(tokensBy) },
    buckets,
    series,
    spendByModel,
    requestsByModel,
    tokenTypes,
    latencyCandles: latencies.map(candle),
    costCandles: costs.map(candle),
    sources,
    traces: traceRows(inRange),
  };
}

/** One row per agent run or standalone chat call, newest first. */
export function traceRows(spans: TelemetrySpan[]): TraceRow[] {
  const byTrace = new Map<string, TelemetrySpan[]>();
  for (const span of spans) {
    const list = byTrace.get(span.traceId) ?? [];
    list.push(span);
    byTrace.set(span.traceId, list);
  }
  const rows: TraceRow[] = [];
  for (const [traceId, list] of byTrace) {
    const root = list.find((span) => span.parentId === null) ?? list[0];
    const llm = list.filter((span) => span.kind === 'llm');
    const priced = llm.filter((span) => span.costUsd !== null);
    rows.push({
      traceId,
      startedAt: root.startedAt,
      durationMs: root.durationMs,
      source: root.source,
      backend: root.backend,
      model: modelLabel(root.kind === 'agent_run' ? (llm[0]?.model ?? root.model) : root.model),
      status: root.status,
      ...(root.error ? { error: root.error } : {}),
      llmCalls: llm.length,
      toolCalls: list.filter((span) => span.kind === 'tool').length,
      tokens: llm.reduce((sum, span) => sum + totalTokens(span), 0),
      costUsd: priced.length ? priced.reduce((sum, span) => sum + cost(span), 0) : null,
      costSource: priced[0]?.costSource ?? 'unpriced',
    });
  }
  return rows.sort((a, b) => b.startedAt - a.startedAt);
}

export function spansForTrace(spans: TelemetrySpan[], traceId: string): TelemetrySpan[] {
  return spans.filter((span) => span.traceId === traceId).sort((a, b) => a.startedAt - b.startedAt);
}

export function formatUsd(value: number): string {
  if (value === 0) return '$0';
  if (Math.abs(value) < 0.0001) return '<$0.0001';
  if (Math.abs(value) < 1) return `$${Number(value.toPrecision(2))}`;
  return `$${value.toFixed(2)}`;
}

export function formatCount(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1).replace(/\.0$/, '')}K`;
  return String(Math.round(value));
}

export function formatMs(value: number): string {
  if (value >= 60_000) return `${(value / 60_000).toFixed(1)}m`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}s`;
  return `${Math.round(value)}ms`;
}

export function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}
