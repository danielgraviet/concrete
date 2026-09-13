import type {
  AiProvider,
  CompleteRequest,
  GenerateQuizRequest,
  QuizDocument,
} from './types';
import {
  QUIZ_GENERATION_SYSTEM_PROMPT,
  buildQuizGenerationUserPrompt,
} from './quizGenerationPrompt';
import { quizDocumentFromModelText } from './quizDocumentFromModelText';
import { truncateNoteContext } from './systemPrompt';
import {
  OPENROUTER_MODEL_DEFAULT,
  openRouterModelLabel,
} from './openRouterModels';

export {
  OPENROUTER_MODEL_DEFAULT,
  OPENROUTER_MODEL_DEEPSEEK_V4_FLASH,
  OPENROUTER_MODEL_LUNA,
  OPENROUTER_MODEL_GPT4O_MINI,
  OPENROUTER_MODEL_OPTIONS,
  isOpenRouterModelId,
  resolveOpenRouterModelId,
  openRouterModelLabel,
} from './openRouterModels';
export type { OpenRouterModelOption } from './openRouterModels';

export type ChatMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

export type OpenRouterChatRequest = {
  model?: string;
  messages: ChatMessage[];
  temperature?: number;
  max_tokens?: number;
};

function requireAiBridge() {
  if (typeof window === 'undefined' || !window.ai?.chatCompletions) {
    throw new Error(
      'OpenRouter is only available in the Electron app (AI bridge missing). Restart Electron after updating.',
    );
  }
  return window.ai;
}

/**
 * Live OpenRouter provider. API key stays in the Electron main process.
 * Quiz generation uses prompt engineering + markdown parse/guardrails.
 * Grading remains stubbed until the next pass.
 */
export class OpenRouterProvider implements AiProvider {
  readonly id = 'openrouter';
  readonly label: string;
  readonly model: string;

  constructor(model: string = OPENROUTER_MODEL_DEFAULT) {
    this.model = model;
    this.label = `OpenRouter (${openRouterModelLabel(model)})`;
  }

  async complete(request: CompleteRequest): Promise<string> {
    const ai = requireAiBridge();
    const messages: ChatMessage[] = [
      {
        role: 'user',
        content: request.context
          ? `${request.prompt}\n\nNote context:\n${truncateNoteContext(request.context)}`
          : request.prompt,
      },
    ];
    const result = await ai.chatCompletions({
      model: this.model,
      messages,
      temperature: 0.4,
      max_tokens: 2048,
    });
    return result.content;
  }

  async generateQuiz(request: GenerateQuizRequest): Promise<QuizDocument> {
    const ai = requireAiBridge();
    const topic = request.topic.trim() || 'Untitled';
    const userPrompt = buildQuizGenerationUserPrompt({
      topic,
      noteContext: request.noteContext
        ? truncateNoteContext(request.noteContext, 12000)
        : undefined,
      source: request.source ?? request.sources?.[0],
      sources: request.sources,
      types: request.types,
    });

    const result = await ai.chatCompletions({
      model: this.model,
      messages: [
        { role: 'system', content: QUIZ_GENERATION_SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.55,
      max_tokens: 4096,
    });

    const title = topic.startsWith('Quiz ') ? topic : `Quiz ${topic}`;
    return quizDocumentFromModelText(result.content, title);
  }
}

export async function isOpenRouterConfigured(): Promise<boolean> {
  if (typeof window === 'undefined' || !window.ai?.status) return false;
  try {
    const status = await window.ai.status();
    return Boolean(status.configured);
  } catch {
    return false;
  }
}
