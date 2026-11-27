import { getBackend } from '../backend';
import type { AppSettings } from '../settings';
import { resolveOpenRouterModelId } from './openRouterModels';
import { ChatModelProvider, LocalEchoProvider, MockAiProvider } from './index';

/**
 * The live AI provider for the current settings. Web has one live provider:
 * OpenRouter through the AI proxy Worker, with the model picked in Settings
 * (the Worker enforces its allowlist).
 */
export function resolveAiProvider(settings: AppSettings) {
  if (getBackend().target === 'web') {
    return new ChatModelProvider('openrouter', resolveOpenRouterModelId(settings.openRouterModelId));
  }
  switch (settings.providerId) {
    case 'openrouter':
      return new ChatModelProvider('openrouter', settings.openRouterModelId);
    case 'claude':
      return new ChatModelProvider('claude', settings.claudeModelId);
    case 'codex':
      return new ChatModelProvider('codex');
    case 'local-echo':
      return new LocalEchoProvider();
    default:
      return new MockAiProvider();
  }
}
