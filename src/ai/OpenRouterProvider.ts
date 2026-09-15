import type {
  AiProvider,
  CompleteRequest,
  GenerateQuizRequest,
  GradeQuizRequest,
  GradeReport,
  QuizDocument,
} from './types';
import {
  QUIZ_GENERATION_SYSTEM_PROMPT,
  buildQuizGenerationUserPrompt,
} from './quizGenerationPrompt';
import { quizDocumentFromModelText } from './quizDocumentFromModelText';
import { truncateNoteContext } from './systemPrompt';
import { stubGradeQuiz } from './quizStubs';
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
      operation: 'complete',
      capture: 'full',
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
      mcqCount: request.mcqCount,
      clozeCount: request.clozeCount,
      openCount: request.openCount,
      difficulty: request.difficulty,
      customRubric: request.customRubric,
    });

    const result = await ai.chatCompletions({
      model: this.model,
      messages: [
        { role: 'system', content: QUIZ_GENERATION_SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.55,
      max_tokens: 4096,
      operation: 'quiz_generation',
      metadata: {
        topic,
        sourceCount: request.sources?.length ?? (request.source ? 1 : 0),
        requestedCounts: {
          mcq: request.mcqCount ?? 0,
          cloze: request.clozeCount ?? 0,
          open: request.openCount ?? 0,
        },
      },
      capture: 'full',
    });

    const title = topic.startsWith('Quiz ') ? topic : `Quiz ${topic}`;
    return quizDocumentFromModelText(result.content, title);
  }

  async gradeQuiz(request: GradeQuizRequest): Promise<GradeReport> {
    const openItems = request.quiz.questions
      .filter((question) => question.type === 'open')
      .map((question) => ({ question, response: request.responses.find((r) => r.questionId === question.id) }));
    const baseline = stubGradeQuiz(request);
    if (openItems.length === 0) return baseline;
    const ai = requireAiBridge();
    const prompt = `Grade the open-ended quiz answers below. Return ONLY JSON with this shape: {"results":[{"questionId":"...","score":0,"feedback":"..."}]}.
Score each answer from 0 to 1 using the rubric. Be concise and specific. Do not award credit for an empty answer.
Rubric: ${request.rubric?.trim() || 'Score correctness, conceptual precision, and use of required terms. Partial credit is allowed.'}

${openItems.map(({ question, response }) => `Question ID: ${question.id}\nQuestion: ${question.prompt}\nReference answer: ${question.answer}\nStudent answer: ${response?.type === 'open' ? response.text : '(no answer)'}`).join('\n\n')}`;
    const result = await ai.chatCompletions({
      model: this.model,
      operation: 'quiz_grading',
      metadata: { openQuestionCount: openItems.length },
      capture: 'full',
      messages: [{ role: 'system', content: 'You are a careful quiz grader. Follow the requested JSON format exactly.' }, { role: 'user', content: prompt }],
      temperature: 0,
      max_tokens: 1200,
    });
    let parsed: { results?: Array<{ questionId?: string; score?: number; feedback?: string }> } = {};
    try {
      const json = result.content.replace(/^```json\s*/i, '').replace(/\s*```$/, '').trim();
      parsed = JSON.parse(json) as typeof parsed;
    } catch {
      return baseline;
    }
    const graded = new Map((parsed.results ?? []).map((item) => [item.questionId, item]));
    return {
      ...baseline,
      perQuestion: baseline.perQuestion.map((item) => {
        const aiGrade = graded.get(item.questionId);
        if (!aiGrade) return item;
        const score = Math.max(0, Math.min(1, Number(aiGrade.score) || 0));
        return { ...item, score, feedback: aiGrade.feedback?.trim() || item.feedback };
      }),
      stubbed: false,
    };
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
