const crypto = require('node:crypto');

/**
 * AI telemetry spans. One finished record per LLM call, tool call, or agent
 * run, normalized across OpenRouter, Claude, and Codex so the activity page can
 * aggregate them without knowing each provider's usage shape.
 *
 * Token convention: `prompt` is every input token (cache reads and writes
 * included); `cacheRead` / `cacheWrite` are subsets of it. `reasoning` is a
 * subset of `completion`.
 */

const num = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : 0);

function emptyTokens() {
  return { prompt: 0, completion: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 };
}

/** OpenAI-style usage (OpenRouter, Codex chat). */
function fromOpenAiUsage(usage) {
  return {
    prompt: num(usage.prompt_tokens),
    completion: num(usage.completion_tokens),
    reasoning: num(usage.completion_tokens_details?.reasoning_tokens),
    cacheRead: num(usage.prompt_tokens_details?.cached_tokens),
    cacheWrite: num(usage.prompt_tokens_details?.cache_write_tokens),
  };
}

/** Anthropic usage: input_tokens excludes cache reads and writes. */
function fromAnthropicUsage(usage) {
  const cacheRead = num(usage.cache_read_input_tokens);
  const cacheWrite = num(usage.cache_creation_input_tokens);
  return {
    prompt: num(usage.input_tokens) + cacheRead + cacheWrite,
    completion: num(usage.output_tokens),
    reasoning: 0,
    cacheRead,
    cacheWrite,
  };
}

/** Codex SDK usage: input_tokens already includes cached_input_tokens. */
function fromCodexUsage(usage) {
  return {
    prompt: num(usage.input_tokens),
    completion: num(usage.output_tokens),
    reasoning: num(usage.reasoning_output_tokens),
    cacheRead: num(usage.cached_input_tokens),
    cacheWrite: num(usage.cache_write_input_tokens),
  };
}

/**
 * Normalize any provider's usage blob into `{ tokens, costUsd }`. Unknown
 * shapes yield zero tokens and a null cost rather than throwing.
 */
function normalizeUsage(usage) {
  if (!usage || typeof usage !== 'object') return { tokens: emptyTokens(), costUsd: null };
  let tokens;
  if ('prompt_tokens' in usage || 'completion_tokens' in usage) tokens = fromOpenAiUsage(usage);
  else if ('cache_read_input_tokens' in usage || 'cache_creation_input_tokens' in usage) tokens = fromAnthropicUsage(usage);
  else if ('cached_input_tokens' in usage || 'reasoning_output_tokens' in usage) tokens = fromCodexUsage(usage);
  else if ('input_tokens' in usage) tokens = fromAnthropicUsage(usage);
  else tokens = emptyTokens();
  const costUsd = typeof usage.cost === 'number' ? usage.cost : null;
  return { tokens, costUsd };
}

function newId() {
  return crypto.randomUUID();
}

function totalTokens(tokens) {
  return tokens.prompt + tokens.completion;
}

/** Claude tool names arrive as mcp__server__tool; keep the readable tail. */
function shortToolName(name) {
  if (typeof name !== 'string') return 'tool';
  const parts = name.split('__');
  return parts.length >= 3 ? parts.slice(2).join('__') : name;
}

function codexToolName(item) {
  switch (item.type) {
    case 'mcp_tool_call': return String(item.tool || 'mcp_tool');
    case 'command_execution': return 'shell';
    case 'file_change': return 'edit_file';
    case 'web_search': return 'web_search';
    default: return null;
  }
}

/**
 * Builds spans for one agent run from the raw provider event stream. Feed it
 * every event with `ingest(event, atMs)`; call `finish()` once for the list of
 * spans (run span first). `atMs` defaults to now, so replaying a recorded
 * trajectory with its timestamps produces the same timeline.
 */
function createSpanCollector({ traceId, backend, model, source = 'agent', startedAt = Date.now(), costSource = 'provider' }) {
  const runSpanId = newId();
  const tools = new Map();
  const finishedTools = [];
  const llmById = new Map();
  let lastBoundary = startedAt;
  let resolvedModel = model || backend;
  let runCost = null;
  let runModelUsage = null;
  let turnCount = 0;

  const base = () => ({ traceId, parentId: runSpanId, backend, source });

  function closeLlm(id, at) {
    const entry = llmById.get(id);
    if (entry && entry.endedAt === null) entry.endedAt = at;
  }

  function ingest(event, at = Date.now()) {
    if (!event || typeof event !== 'object') return;

    // Claude Agent SDK messages.
    if (event.type === 'system' && event.subtype === 'init' && typeof event.model === 'string') {
      resolvedModel = event.model;
      return;
    }
    if (event.type === 'assistant' && event.message) {
      const message = event.message;
      const id = message.id || newId();
      let entry = llmById.get(id);
      if (!entry) {
        entry = { startedAt: lastBoundary, endedAt: null, model: message.model || resolvedModel, usage: null };
        llmById.set(id, entry);
      }
      if (message.usage) entry.usage = message.usage;
      entry.endedAt = at;
      for (const block of message.content ?? []) {
        if (block.type === 'tool_use') {
          tools.set(block.id, { name: shortToolName(block.name), startedAt: at });
        }
      }
      lastBoundary = at;
      return;
    }
    if (event.type === 'user' && Array.isArray(event.message?.content)) {
      for (const block of event.message.content) {
        if (block.type !== 'tool_result') continue;
        const pending = tools.get(block.tool_use_id);
        if (!pending) continue;
        tools.delete(block.tool_use_id);
        finishedTools.push({ ...pending, endedAt: at, status: block.is_error ? 'error' : 'ok' });
      }
      lastBoundary = at;
      return;
    }
    if (event.type === 'result') {
      if (typeof event.total_cost_usd === 'number') runCost = event.total_cost_usd;
      if (event.modelUsage && typeof event.modelUsage === 'object') runModelUsage = event.modelUsage;
      return;
    }

    // Codex SDK thread events.
    if (event.type === 'turn.started') {
      turnCount += 1;
      llmById.set(`turn-${turnCount}`, { startedAt: at, endedAt: null, model: resolvedModel, usage: null });
      return;
    }
    if (event.type === 'turn.completed' || event.type === 'turn.failed') {
      const entry = llmById.get(`turn-${turnCount}`);
      if (entry) {
        entry.usage = event.usage ?? null;
        entry.endedAt = at;
        if (event.type === 'turn.failed') entry.status = 'error';
      }
      return;
    }
    if ((event.type === 'item.started' || event.type === 'item.completed') && event.item) {
      const name = codexToolName(event.item);
      if (!name) return;
      if (event.type === 'item.started') {
        tools.set(event.item.id, { name, startedAt: at });
      } else {
        const pending = tools.get(event.item.id) ?? { name, startedAt: at };
        tools.delete(event.item.id);
        const failed = event.item.status === 'failed' || Boolean(event.item.error)
          || (typeof event.item.exit_code === 'number' && event.item.exit_code !== 0);
        finishedTools.push({ ...pending, endedAt: at, status: failed ? 'error' : 'ok' });
      }
    }
  }

  function finish({ status = 'ok', error = null, endedAt = Date.now() } = {}) {
    for (const id of llmById.keys()) closeLlm(id, endedAt);

    const llmSpans = [...llmById.values()].map((entry) => {
      const { tokens, costUsd } = normalizeUsage(entry.usage);
      return {
        ...base(),
        spanId: newId(),
        kind: 'llm',
        model: entry.model || resolvedModel,
        startedAt: entry.startedAt,
        durationMs: Math.max(0, entry.endedAt - entry.startedAt),
        status: entry.status ?? 'ok',
        tokens,
        costUsd,
        costSource: costUsd === null ? 'unpriced' : costSource,
      };
    });

    // Claude reports cost per model for the whole run; spread it across that
    // model's calls by token share so per-call charts still add up.
    if (runModelUsage) {
      for (const [modelId, usage] of Object.entries(runModelUsage)) {
        const spans = llmSpans.filter((span) => span.model === modelId);
        const cost = num(usage?.costUSD);
        if (spans.length === 0) continue;
        const weight = spans.reduce((sum, span) => sum + totalTokens(span.tokens), 0);
        for (const span of spans) {
          span.costUsd = weight > 0 ? (cost * totalTokens(span.tokens)) / weight : cost / spans.length;
          span.costSource = costSource === 'subscription' ? 'subscription' : 'estimated';
        }
      }
    }

    const toolSpans = [
      ...finishedTools,
      ...[...tools.values()].map((pending) => ({ ...pending, endedAt, status: status === 'ok' ? 'ok' : 'cancelled' })),
    ].map((tool) => ({
      ...base(),
      spanId: newId(),
      kind: 'tool',
      model: null,
      toolName: tool.name,
      startedAt: tool.startedAt,
      durationMs: Math.max(0, tool.endedAt - tool.startedAt),
      status: tool.status,
      tokens: emptyTokens(),
      costUsd: null,
      costSource: 'unpriced',
    }));

    const runTokens = emptyTokens();
    for (const span of llmSpans) {
      for (const key of Object.keys(runTokens)) runTokens[key] += span.tokens[key];
    }
    const pricedLlm = llmSpans.filter((span) => span.costUsd !== null);
    const runSpan = {
      traceId,
      spanId: runSpanId,
      parentId: null,
      kind: 'agent_run',
      backend,
      source,
      model: resolvedModel,
      startedAt,
      durationMs: Math.max(0, endedAt - startedAt),
      status,
      ...(error ? { error: String(error).slice(0, 500) } : {}),
      tokens: runTokens,
      costUsd: runCost ?? (pricedLlm.length ? pricedLlm.reduce((sum, span) => sum + span.costUsd, 0) : null),
      costSource: runCost !== null || pricedLlm.length ? costSource : 'unpriced',
      llmCalls: llmSpans.length,
      toolCalls: toolSpans.length,
    };

    return [runSpan, ...llmSpans, ...toolSpans].sort((a, b) => a.startedAt - b.startedAt);
  }

  return { traceId, ingest, finish };
}

/** A single chat completion as one span. */
function chatSpan({ requestId, operation, backend, model, startedAt, durationMs, status, error, usage, costSource = 'provider', finishReason = null }) {
  const { tokens, costUsd } = normalizeUsage(usage);
  return {
    traceId: requestId,
    spanId: requestId,
    parentId: null,
    kind: 'llm',
    backend,
    source: operation,
    model: model ?? backend,
    startedAt,
    durationMs,
    status,
    ...(error ? { error: String(error).slice(0, 500) } : {}),
    ...(finishReason ? { finishReason } : {}),
    tokens,
    costUsd,
    costSource: costUsd === null ? 'unpriced' : costSource,
  };
}

/** Convert legacy ai-activity.jsonl end records into spans (one-time backfill). */
function spansFromLegacyActivity(records) {
  return records
    .filter((record) => record && (record.status === 'success' || record.status === 'error') && typeof record.startedAt === 'number')
    .filter((record) => typeof record.operation === 'string' && !record.operation.startsWith('renderer') && record.durationMs !== undefined)
    .map((record) => chatSpan({
      requestId: String(record.requestId ?? newId()),
      operation: record.operation,
      backend: record.backend ?? 'openrouter',
      model: record.model ?? null,
      startedAt: record.startedAt,
      durationMs: num(record.durationMs),
      status: record.status === 'success' ? 'ok' : 'error',
      error: record.error ?? null,
      usage: record.usage ?? null,
      finishReason: record.finishReason ?? null,
    }));
}

/** Rebuild spans from a recorded agent trajectory (JSONL records). */
function spansFromTrajectory(records) {
  const started = records.find((record) => record.type === 'trajectory.started');
  if (!started) return [];
  const startedAt = Date.parse(started.timestamp);
  const collector = createSpanCollector({
    traceId: started.trajectoryId,
    backend: started.provider,
    model: started.provider,
    startedAt,
  });
  for (const record of records) {
    if (record.type === 'provider.event') collector.ingest(record.event, Date.parse(record.timestamp));
  }
  const finished = records.find((record) => record.type === 'trajectory.finished');
  return collector.finish({
    status: finished?.status === 'success' ? 'ok' : finished ? 'error' : 'cancelled',
    error: finished?.error ?? null,
    endedAt: finished ? Date.parse(finished.timestamp) : startedAt,
  });
}

module.exports = {
  normalizeUsage,
  createSpanCollector,
  chatSpan,
  spansFromLegacyActivity,
  spansFromTrajectory,
};
