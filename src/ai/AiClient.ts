import type { AiProvider, CompleteRequest } from './types';
import { buildTeacherCompletePrompt, truncateNoteContext } from './systemPrompt';
import { MockAiProvider } from './MockAiProvider';

/**
 * Thin façade — swap providers via setProvider / getProvider.
 * Injects the teacher system prompt before every complete call.
 */
export class AiClient {
  private provider: AiProvider;

  constructor(provider: AiProvider = new MockAiProvider()) {
    this.provider = provider;
  }

  setProvider(provider: AiProvider): void {
    this.provider = provider;
  }

  getProvider(): AiProvider {
    return this.provider;
  }

  complete(request: CompleteRequest): Promise<string> {
    const context = request.context ? truncateNoteContext(request.context) : undefined;
    return this.provider.complete({
      prompt: buildTeacherCompletePrompt(request.prompt, context),
      context,
    });
  }

  embed(text: string): Promise<number[] | null> {
    if (!this.provider.embed) return Promise.resolve(null);
    return this.provider.embed(text);
  }
}

/** Shared singleton for app-wide use. */
export const aiClient = new AiClient();
