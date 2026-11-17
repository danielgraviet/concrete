import type { AiBackend, VaultBackend } from '../types';
import { AiProxyError, type AiProxyChatRequest, type AiProxyChatResult, type AiProxyClient } from './aiProxyClient';
import type { TelemetrySpan } from '../../telemetry/types';
import {
  appendWebAiActivity,
  appendWebAiTelemetry,
  clearWebAiActivity,
  clearWebAiTelemetry,
  readWebAiActivity,
  readWebAiTelemetry,
} from './webAiActivity';

/** Display name for web AI (the proxy forwards to OpenRouter; the model is picked in Settings). */
export const WEB_AI_MODEL_LABEL = 'OpenRouter';

const DESKTOP_ONLY = 'Not available on web';

/**
 * Map the desktop request shape onto the proxy's. `model`, `temperature`,
 * `provider` and `reasoning` pass through (the Worker allowlists the model and
 * sanitizes the rest); `backend` and `capture` have no proxy equivalent.
 */
export function toProxyRequest(request: AiChatCompletionsRequest): AiProxyChatRequest {
  return {
    messages: request.messages.map(({ role, content }) => ({ role, content })),
    ...(typeof request.model === 'string' && request.model ? { model: request.model } : {}),
    ...(typeof request.max_tokens === 'number' ? { max_tokens: request.max_tokens } : {}),
    ...(typeof request.temperature === 'number' ? { temperature: request.temperature } : {}),
    ...(request.provider ? { provider: request.provider } : {}),
    ...(request.reasoning ? { reasoning: request.reasoning } : {}),
    ...(request.operation ? { operation: request.operation } : {}),
    ...(request.metadata ? { metadata: request.metadata } : {}),
  };
}

function toResult(result: AiProxyChatResult): AiChatCompletionsResult {
  return {
    content: result.content,
    model: result.model,
    usage: result.usage,
    ...(result.requestId ? { requestId: result.requestId } : {}),
  };
}

function objectOf(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function numeric(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
}

function usageTokens(value: unknown): TelemetrySpan['tokens'] {
  const usage = objectOf(value);
  const promptDetails = objectOf(usage.prompt_tokens_details);
  const completionDetails = objectOf(usage.completion_tokens_details);
  return {
    prompt: numeric(usage.prompt_tokens ?? usage.input_tokens),
    completion: numeric(usage.completion_tokens ?? usage.output_tokens),
    reasoning: numeric(completionDetails.reasoning_tokens),
    cacheRead: numeric(promptDetails.cached_tokens ?? promptDetails.cache_read_tokens),
    cacheWrite: numeric(promptDetails.cache_write_tokens),
  };
}

async function recordCall(
  getVault: () => VaultBackend | undefined,
  request: AiChatCompletionsRequest,
  startedAt: number,
  result?: AiProxyChatResult,
  error?: unknown,
): Promise<void> {
  const vault = getVault();
  if (!vault) return;
  const completedAt = Date.now();
  const content = result?.content ?? '';
  const model = result?.model ?? request.model ?? WEB_AI_MODEL_LABEL;
  const operation = request.operation ?? 'chat_completion';
  const status = error ? 'error' : 'success';
  let capturedChars = 0;
  const messages = request.messages.map((message) => {
    const remaining = Math.max(0, 24_000 - capturedChars);
    const limit = request.capture === 'full' ? Math.min(5000, remaining) : Math.min(500, remaining);
    const content = String(message.content).slice(0, limit);
    capturedChars += content.length;
    return { ...message, content };
  });
  await appendWebAiActivity(vault, {
    requestId: result?.requestId ?? `${startedAt}-${Math.random().toString(36).slice(2, 8)}`,
    operation,
    startedAt,
    completedAt,
    durationMs: completedAt - startedAt,
    status,
    backend: 'openrouter',
    model,
    temperature: request.temperature ?? null,
    maxTokens: request.max_tokens ?? null,
    promptChars: request.messages.reduce((sum, message) => sum + String(message.content).length, 0),
    responseChars: content.length,
    usage: result?.usage ?? null,
    metadata: request.metadata ?? null,
    messages,
    ...(request.capture === 'full' ? { responseText: content.slice(0, 20000) } : {}),
    ...(error ? { error: error instanceof Error ? error.message : String(error) } : {}),
  });
  const usage = objectOf(result?.usage);
  const cost = typeof usage.cost === 'number' && Number.isFinite(usage.cost) ? usage.cost : null;
  await appendWebAiTelemetry(vault, {
    traceId: result?.requestId ?? `${startedAt}`,
    spanId: crypto.randomUUID(),
    parentId: null,
    kind: 'llm',
    backend: 'openrouter',
    source: operation,
    model,
    startedAt,
    durationMs: completedAt - startedAt,
    status: error ? 'error' : 'ok',
    ...(error ? { error: error instanceof Error ? error.message : String(error) } : {}),
    tokens: usageTokens(result?.usage),
    costUsd: cost,
    costSource: cost === null ? 'unpriced' : 'provider',
  });
}

/** `AiBackend` (the desktop AI bridge shape) that talks to the Concrete AI proxy Worker. */
export function createWebAi(client: AiProxyClient, getVault: () => VaultBackend | undefined = () => undefined): AiBackend {
  const deltaListeners = new Set<(event: AiChatDeltaEvent) => void>();
  const streams = new Map<string, AbortController>();

  const status = async (): Promise<AiStatus> => {
    const signedIn = await client.hasToken();
    return {
      configured: signedIn,
      provider: 'openrouter',
      model: WEB_AI_MODEL_LABEL,
      message: signedIn ? 'Signed in — AI runs on OpenRouter.' : 'Sign in to use AI features.',
    };
  };

  return {
    status,
    setApiKey: () => Promise.reject(new Error(DESKTOP_ONLY)),
    ping: async () => {
      try {
        const ok = await client.health();
        return { ok, status: ok ? 200 : 0, model: WEB_AI_MODEL_LABEL, keySuffix: '' };
      } catch (err) {
        return {
          ok: false,
          status: err instanceof AiProxyError ? err.status : 0,
          model: WEB_AI_MODEL_LABEL,
          keySuffix: '',
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },

    chatCompletions: async (request) => {
      const startedAt = Date.now();
      try {
        const result = await client.chat(toProxyRequest(request));
        await recordCall(getVault, request, startedAt, result);
        return toResult(result);
      } catch (error) {
        await recordCall(getVault, request, startedAt, undefined, error);
        throw error;
      }
    },

    chatStream: async (request) => {
      const { streamId } = request;
      const body = toProxyRequest(request);
      streams.get(streamId)?.abort();
      const controller = new AbortController();
      streams.set(streamId, controller);
      const startedAt = Date.now();
      try {
        const result = await client.chatStream(
          body,
          (text) => {
            for (const listener of [...deltaListeners]) listener({ streamId, text });
          },
          { signal: controller.signal },
        );
        await recordCall(getVault, request, startedAt, result);
        return toResult(result);
      } catch (error) {
        await recordCall(getVault, request, startedAt, undefined, error);
        throw error;
      } finally {
        if (streams.get(streamId) === controller) streams.delete(streamId);
      }
    },
    chatCancel: async (streamId) => {
      const controller = streams.get(streamId);
      if (!controller) return false;
      controller.abort();
      streams.delete(streamId);
      return true;
    },
    onChatDelta: (callback) => {
      deltaListeners.add(callback);
      return () => {
        deltaListeners.delete(callback);
      };
    },

    // Web activity is stored in the signed-in account's cloud vault app data.
    activity: async () => {
      const vault = getVault();
      return vault ? readWebAiActivity(vault) : [];
    },
    trajectories: async () => [],
    activityClear: async () => {
      const vault = getVault();
      return vault ? clearWebAiActivity(vault) : false;
    },
    telemetry: async () => {
      const vault = getVault();
      return vault ? readWebAiTelemetry(vault) : [];
    },
    telemetryClear: async () => {
      const vault = getVault();
      return vault ? clearWebAiTelemetry(vault) : false;
    },
    recordActivity: async (event) => {
      const vault = getVault();
      if (!vault) return false;
      const now = Date.now();
      return appendWebAiActivity(vault, {
        requestId: event.requestId ?? `${now}-renderer`,
        operation: event.operation,
        startedAt: now,
        completedAt: now,
        durationMs: 0,
        status: event.status === 'error' ? 'error' : 'info',
        backend: 'openrouter',
        ...(event.model ? { model: event.model } : {}),
        ...(event.error ? { error: event.error } : {}),
        ...(event.responseText ? { responseText: event.responseText.slice(0, 20000) } : {}),
        metadata: event.metadata ?? null,
      });
    },

    agentStatus: async () => ({
      available: false,
      authenticated: false,
      cliPath: null,
      message: 'Local agents are only available in the desktop app.',
    }),
    agentRun: () => Promise.reject(new Error(DESKTOP_ONLY)),
    agentCancel: async () => false,
    onAgentProgress: () => () => {},
    onSetTheme: () => () => {},
  };
}
