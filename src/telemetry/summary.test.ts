import { describe, expect, it } from 'vitest';
import { bucketsFor, candle, modelLabel, OTHER, rankModels, summarize, topSlices, traceRows } from './summary';
import type { TelemetrySpan } from './types';

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date(2026, 9, 4, 15, 30).getTime();

let counter = 0;
function call(overrides: Partial<TelemetrySpan> = {}): TelemetrySpan {
  counter += 1;
  return {
    traceId: `t${counter}`,
    spanId: `s${counter}`,
    parentId: null,
    kind: 'llm',
    backend: 'openrouter',
    source: 'quiz_grading',
    model: 'vendor/model-a',
    startedAt: NOW - 1000,
    durationMs: 1000,
    status: 'ok',
    tokens: { prompt: 100, completion: 50, reasoning: 10, cacheRead: 40, cacheWrite: 0 },
    costUsd: 0.01,
    costSource: 'provider',
    ...overrides,
  };
}

describe('summary helpers', () => {
  it('strips provider prefixes from model ids', () => {
    expect(modelLabel('deepseek/deepseek-v4-flash')).toBe('deepseek-v4-flash');
    expect(modelLabel(null)).toBe('unknown');
  });

  it('computes candle quantiles', () => {
    expect(candle([4, 1, 3, 2, 5])).toEqual({ count: 5, min: 1, q1: 2, median: 3, q3: 4, max: 5 });
    expect(candle([])).toBeNull();
  });

  it('keeps the top three slices and folds the rest into Others', () => {
    const slices = topSlices(new Map([['a', 5], ['b', 4], ['c', 3], ['d', 2], ['e', 1], ['f', 0]]));
    expect(slices).toEqual([
      { label: 'a', value: 5 }, { label: 'b', value: 4 }, { label: 'c', value: 3 }, { label: 'Others', value: 3 },
    ]);
  });

  it('builds day buckets ending today', () => {
    const buckets = bucketsFor('7d', NOW);
    expect(buckets).toHaveLength(7);
    expect(new Date(buckets[6].start).getDate()).toBe(4);
    expect(buckets[6].end).toBeGreaterThan(NOW);
  });

  it('ranks models by spend so palette slots stay stable', () => {
    const order = rankModels([
      call({ model: 'cheap', costUsd: 0.001 }),
      call({ model: 'cheap', costUsd: 0.001 }),
      call({ model: 'pricey', costUsd: 1 }),
    ]);
    expect(order).toEqual(['pricey', 'cheap']);
  });
});

describe('summarize', () => {
  it('computes KPIs, deltas, and per-bucket series for llm spans only', () => {
    const spans = [
      call(),
      call({ startedAt: NOW - 2 * DAY, costUsd: 0.03, model: 'vendor/model-b' }),
      call({ startedAt: NOW - 8 * DAY, costUsd: 0.02 }),
      call({ kind: 'tool', toolName: 'shell', costUsd: null, tokens: { prompt: 0, completion: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 } }),
    ];
    const result = summarize(spans, '7d', NOW);
    expect(result.kpis.requests).toEqual({ value: 2, previous: 1 });
    expect(result.kpis.spend.value).toBeCloseTo(0.04);
    expect(result.kpis.tokens.value).toBe(300);
    expect(result.kpis.cacheHitRate.value).toBeCloseTo(80 / 200);
    expect(result.kpis.blendedPerMillion.value).toBeCloseTo((0.04 / 300) * 1e6);
    // All-time spend ties at $0.03; model-a has more requests, so it keeps slot 1.
    expect(result.series).toEqual(['model-a', 'model-b']);
    expect(result.spendByModel[6]).toEqual([0.01, 0]);
    expect(result.spendByModel[4]).toEqual([0, 0.03]);
    expect(result.tokenTypes[6]).toEqual({ uncached: 60, cached: 40, output: 40, reasoning: 10 });
    expect(result.sources).toEqual([expect.objectContaining({ source: 'quiz_grading', requests: 2 })]);
  });

  it('reports no prior data when nothing predates the range', () => {
    const result = summarize([call()], '7d', NOW);
    expect(result.kpis.spend.previous).toBeNull();
  });

  it('folds models beyond the six palette slots into Other', () => {
    const spans = Array.from({ length: 8 }, (_, i) => call({ model: `m${i}`, costUsd: 8 - i }));
    const result = summarize(spans, '7d', NOW);
    expect(result.series).toHaveLength(7);
    expect(result.series[6]).toBe(OTHER);
    expect(result.requestsByModel[6][6]).toBe(2);
  });
});

describe('traceRows', () => {
  it('rolls an agent run up with its llm and tool children', () => {
    const rows = traceRows([
      call({ traceId: 'run', spanId: 'root', kind: 'agent_run', source: 'agent', durationMs: 5000, costUsd: 0.05 }),
      call({ traceId: 'run', parentId: 'root', model: 'claude-sonnet-5', costUsd: 0.02, costSource: 'estimated' }),
      call({ traceId: 'run', parentId: 'root', model: 'claude-sonnet-5', costUsd: 0.03, costSource: 'estimated' }),
      call({ traceId: 'run', parentId: 'root', kind: 'tool', toolName: 'shell', costUsd: null }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ source: 'agent', model: 'claude-sonnet-5', llmCalls: 2, toolCalls: 1, tokens: 300, durationMs: 5000 });
    expect(rows[0].costUsd).toBeCloseTo(0.05);
  });
});
