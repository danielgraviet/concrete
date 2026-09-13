import type { AiProvider, CompleteRequest } from './types';

/** Returns a short tutor-style echo of the prompt (no network). */
export class LocalEchoProvider implements AiProvider {
  readonly id = 'local-echo';
  readonly label = 'Local echo';

  async complete(request: CompleteRequest): Promise<string> {
    const userLine = /(?:^|\n)User:\s*([\s\S]*?)(?:\nNote context|\n*$)/.exec(request.prompt);
    const prompt = (userLine?.[1] ?? request.prompt).trim();
    const preview = prompt.length > 120 ? `${prompt.slice(0, 117)}…` : prompt;
    const words = request.context?.trim().split(/\s+/).filter(Boolean).length ?? 0;
    const ctxHint = words > 0 ? ` Note context: ${words} words.` : '';
    return `Heard you. "${preview}"${ctxHint}\n\nReply with one concrete next step when you are ready.`;
  }
}
