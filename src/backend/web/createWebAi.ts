import type { AiBackend } from '../types';
import { AiProxyError, type AiProxyChatRequest, type AiProxyChatResult, type AiProxyClient } from './aiProxyClient';

/** Display name for the server-chosen model (the proxy ignores client model ids). */
export const WEB_AI_MODEL_LABEL = 'Concrete AI';

const DESKTOP_ONLY = 'Not available on web';

/**
 * Map the desktop request shape onto the proxy's. `backend` / `model` are
 * ignored (the Worker picks the model); `temperature`, `provider`,
 * `reasoning` and `capture` have no proxy equivalent and are dropped.
 */
export function toProxyRequest(request: AiChatCompletionsRequest): AiProxyChatRequest {
  const lastTurn = [...request.messages].reverse().find((m) => m.role !== 'system');
  if (lastTurn?.role === 'assistant') {
    // The proxy (and Claude) don't support assistant prefill.
    throw new AiProxyError('bad_request', 0, {
      detail: 'conversation must end with a user message',
      message: 'AI request must end with a user message (assistant prefill is not supported on web).',
    });
  }
  return {
    messages: request.messages.map(({ role, content }) => ({ role, content })),
    ...(typeof request.max_tokens === 'number' ? { max_tokens: request.max_tokens } : {}),
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

/** `AiBackend` (the desktop AI bridge shape) that talks to the Concrete AI proxy Worker. */
export function createWebAi(client: AiProxyClient): AiBackend {
  const deltaListeners = new Set<(event: AiChatDeltaEvent) => void>();
  const streams = new Map<string, AbortController>();

  const status = async (): Promise<AiStatus> => {
    const signedIn = await client.hasToken();
    return {
      configured: signedIn,
      provider: 'claude',
      model: WEB_AI_MODEL_LABEL,
      message: signedIn ? 'Signed in — AI runs on Concrete AI.' : 'Sign in to use AI features.',
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

    chatCompletions: async (request) => toResult(await client.chat(toProxyRequest(request))),

    chatStream: async (request) => {
      const { streamId } = request;
      const body = toProxyRequest(request);
      streams.get(streamId)?.abort();
      const controller = new AbortController();
      streams.set(streamId, controller);
      try {
        const result = await client.chatStream(
          body,
          (text) => {
            for (const listener of [...deltaListeners]) listener({ streamId, text });
          },
          { signal: controller.signal },
        );
        return toResult(result);
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

    // Local-only desktop features: harmless empties on web.
    activity: async () => [],
    trajectories: async () => [],
    activityClear: async () => false,
    telemetry: async () => [],
    telemetryClear: async () => false,
    recordActivity: async () => false,

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
