import { describe, expect, it } from 'vitest';
import * as spans from '../../electron/telemetrySpans.cjs';

describe('normalizeUsage', () => {
  it('reads OpenRouter usage with cost, cache, and reasoning', () => {
    expect(spans.normalizeUsage({
      prompt_tokens: 1097,
      completion_tokens: 653,
      cost: 0.00018336,
      prompt_tokens_details: { cached_tokens: 100, cache_write_tokens: 5 },
      completion_tokens_details: { reasoning_tokens: 499 },
    })).toEqual({
      tokens: { prompt: 1097, completion: 653, reasoning: 499, cacheRead: 100, cacheWrite: 5 },
      costUsd: 0.00018336,
    });
  });

  it('adds Anthropic cache tokens into prompt', () => {
    const { tokens } = spans.normalizeUsage({
      input_tokens: 10, output_tokens: 50, cache_read_input_tokens: 900, cache_creation_input_tokens: 90,
    });
    expect(tokens).toEqual({ prompt: 1000, completion: 50, reasoning: 0, cacheRead: 900, cacheWrite: 90 });
  });

  it('treats Codex input_tokens as already including cached', () => {
    const { tokens, costUsd } = spans.normalizeUsage({
      input_tokens: 2000, cached_input_tokens: 1500, output_tokens: 300, reasoning_output_tokens: 120,
    });
    expect(tokens).toEqual({ prompt: 2000, completion: 300, reasoning: 120, cacheRead: 1500, cacheWrite: 0 });
    expect(costUsd).toBeNull();
  });

  it('returns zeros for missing or redacted usage', () => {
    expect(spans.normalizeUsage(null).tokens.prompt).toBe(0);
    expect(spans.normalizeUsage({ input_tokens: '[REDACTED]', cached_input_tokens: '[REDACTED]' }).tokens.prompt).toBe(0);
  });
});

describe('createSpanCollector', () => {
  it('turns a Claude stream into llm and tool spans with allocated cost', () => {
    const collector = spans.createSpanCollector({ traceId: 't1', backend: 'claude', model: 'claude', startedAt: 0 });
    collector.ingest({ type: 'system', subtype: 'init', model: 'claude-sonnet-5' }, 10);
    collector.ingest({
      type: 'assistant',
      message: { id: 'm1', model: 'claude-sonnet-5', usage: { input_tokens: 100, output_tokens: 20 }, content: [{ type: 'tool_use', id: 'tu1', name: 'mcp__concrete__set_theme' }] },
    }, 1000);
    collector.ingest({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'tu1' }] } }, 1500);
    collector.ingest({
      type: 'assistant',
      message: { id: 'm2', model: 'claude-sonnet-5', usage: { input_tokens: 280, output_tokens: 100 }, content: [{ type: 'text', text: 'done' }] },
    }, 3000);
    collector.ingest({ type: 'result', total_cost_usd: 0.05, modelUsage: { 'claude-sonnet-5': { costUSD: 0.05 } } }, 3001);
    const result = collector.finish({ status: 'ok', endedAt: 3100 });

    const run = result.find((span) => span.kind === 'agent_run')!;
    const llm = result.filter((span) => span.kind === 'llm');
    const tool = result.find((span) => span.kind === 'tool')!;
    expect(run).toMatchObject({ costUsd: 0.05, durationMs: 3100, llmCalls: 2, toolCalls: 1 });
    expect(llm.map((span) => span.durationMs)).toEqual([1000, 1500]);
    expect(llm.reduce((sum, span) => sum + (span.costUsd ?? 0), 0)).toBeCloseTo(0.05);
    expect(llm[0].costUsd).toBeCloseTo(0.05 * (120 / 500));
    expect(tool).toMatchObject({ toolName: 'set_theme', startedAt: 1000, durationMs: 500, status: 'ok', parentId: run.spanId });
  });

  it('turns a Codex stream into a turn span and tool spans', () => {
    const collector = spans.createSpanCollector({ traceId: 't2', backend: 'codex', model: 'codex', startedAt: 0 });
    collector.ingest({ type: 'turn.started' }, 5);
    collector.ingest({ type: 'item.started', item: { id: 'i1', type: 'command_execution' } }, 100);
    collector.ingest({ type: 'item.completed', item: { id: 'i1', type: 'command_execution', exit_code: 1 } }, 400);
    collector.ingest({ type: 'item.completed', item: { id: 'i2', type: 'agent_message' } }, 450);
    collector.ingest({ type: 'turn.completed', usage: { input_tokens: 2000, cached_input_tokens: 1500, output_tokens: 300 } }, 900);
    const result = collector.finish({ status: 'ok', endedAt: 1000 });

    const llm = result.filter((span) => span.kind === 'llm');
    const tools = result.filter((span) => span.kind === 'tool');
    expect(llm).toHaveLength(1);
    expect(llm[0]).toMatchObject({ startedAt: 5, durationMs: 895, costUsd: null, costSource: 'unpriced' });
    expect(llm[0].tokens.cacheRead).toBe(1500);
    expect(tools).toEqual([expect.objectContaining({ toolName: 'shell', durationMs: 300, status: 'error' })]);
  });
});

describe('spansFromLegacyActivity', () => {
  it('keeps finished calls and skips start markers', () => {
    const result = spans.spansFromLegacyActivity([
      { requestId: 'a', operation: 'quiz_grading', status: 'started', startedAt: 1 },
      { requestId: 'a', operation: 'quiz_grading', status: 'success', startedAt: 1, durationMs: 900, model: 'x/y', usage: { prompt_tokens: 5, completion_tokens: 6, cost: 0.001 } },
      { requestId: 'b', operation: 'quiz_grading', status: 'error', startedAt: 2, durationMs: 50, error: 'boom' },
    ]);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ backend: 'openrouter', source: 'quiz_grading', status: 'ok', costUsd: 0.001 });
    expect(result[1]).toMatchObject({ status: 'error', error: 'boom', costUsd: null });
  });
});
