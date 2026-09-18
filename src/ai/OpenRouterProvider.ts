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
import { normalize as normalizeAnswer, stubGradeQuiz } from './quizStubs';
import {
  OPENROUTER_MODEL_DEFAULT,
  OPENROUTER_MODEL_DEEPSEEK_V4_FLASH,
  OPENROUTER_MODEL_LUNA,
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

const MAX_PROBES = 3;

const KEY_POINT_RULES = `When key points are listed, score mainly by how many the student meaningfully covers, giving credit for equivalent ideas in different words. Reasoning matters: naming a term without explaining why it applies earns at most half credit for that point. Never reward padding or vague statements.`;

const PROBE_RULES = `FOLLOW-UP PROBES
For open-ended and code answers with a score between 0.2 and 0.75 (vague, partial, naming a technique without saying why, or missing a key point while showing a foothold), set "followUp" to ONE short probing question (max 25 words) that pushes the student to explain the gap, for example "Why would that break once the data no longer fits in memory?" or "What would you change to fix it, and why does that help?". Do not reveal the answer or name the missing key point. Set "followUp" to null when the answer is already strong (score above 0.75) or empty or irrelevant (score below 0.2).`;

function keyPointText(points: string[] | undefined): string {
  return points?.length ? `Key points:\n${points.map((p) => `- ${p}`).join('\n')}\n` : '';
}

function followUpText(followUp: { question: string; answer: string } | undefined): string {
  return followUp
    ? `\nFollow-up asked: ${followUp.question}\nStudent's follow-up answer: ${followUp.answer || '(no answer)'}`
    : '';
}

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
      codeCount: request.codeCount,
      difficulty: request.difficulty,
      customRubric: request.customRubric,
    });

    const messages: ChatMessage[] = [
      { role: 'system', content: QUIZ_GENERATION_SYSTEM_PROMPT },
      { role: 'user', content: userPrompt },
    ];
    const metadata = {
      topic,
      sourceCount: request.sources?.length ?? (request.source ? 1 : 0),
      requestedCounts: {
        mcq: request.mcqCount ?? 0,
        cloze: request.clozeCount ?? 0,
        open: request.openCount ?? 0,
        code: request.codeCount ?? 0,
      },
    };

    let result;
    try {
      result = await ai.chatCompletions({
        model: this.model,
        messages,
        temperature: 0.55,
        max_tokens: 4096,
        operation: 'quiz_generation',
        metadata,
        capture: 'full',
      });
    } catch (primaryError) {
      // DeepSeek V4 Flash can occasionally return an empty completion. Retry
      // the same quiz request on Luna, but keep other model failures visible.
      if (this.model !== OPENROUTER_MODEL_DEEPSEEK_V4_FLASH) throw primaryError;
      result = await ai.chatCompletions({
        model: OPENROUTER_MODEL_LUNA,
        messages,
        temperature: 0.55,
        max_tokens: 4096,
        operation: 'quiz_generation_fallback',
        metadata: {
          ...metadata,
          fallbackFrom: this.model,
          fallbackReason: primaryError instanceof Error ? primaryError.message : String(primaryError),
        },
        capture: 'full',
      });
    }

    const title = topic.startsWith('Quiz ') ? topic : `Quiz ${topic}`;
    try {
      return quizDocumentFromModelText(result.content, title);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // The API call succeeded, so keep the raw reply where the user can read it.
      void ai
        .recordActivity?.({
          operation: 'quiz_parse_failure',
          status: 'error',
          requestId: result.requestId,
          model: result.model,
          error: message,
          responseText: result.content,
          metadata,
        })
        ?.catch(() => {});
      throw new Error(`${message} The raw model reply is saved under Settings → AI Activity.`);
    }
  }

  async gradeQuiz(request: GradeQuizRequest): Promise<GradeReport> {
    const baseline = stubGradeQuiz(request);
    const responseFor = (id: string) => request.responses.find((r) => r.questionId === id);

    // Second pass: only re-grade questions whose follow-up probe was answered.
    const followUps = new Map((request.followUps ?? []).map((f) => [f.questionId, f]));
    const secondPass = followUps.size > 0;
    const inScope = (id: string) => !secondPass || followUps.has(id);
    const probing = Boolean(request.allowProbes) && !secondPass;

    const openItems = request.quiz.questions.flatMap((question) => {
      const response = responseFor(question.id);
      return question.type === 'open' && inScope(question.id) ? [{ question, response }] : [];
    });
    // Cloze goes to the judge only when the exact-match baseline missed a blank
    // and the student actually typed something for it.
    const clozeItems = request.quiz.questions.flatMap((question) => {
      const response = responseFor(question.id);
      if (secondPass || question.type !== 'cloze' || response?.type !== 'cloze') return [];
      const base = baseline.perQuestion.find((g) => g.questionId === question.id);
      if (!base || base.score >= base.maxScore) return [];
      if (!response.fills.some((fill) => fill.trim())) return [];
      return [{ question, response }];
    });
    // Code answers: predict-output that already matched needs no judge. A miss
    // goes to the judge only to forgive formatting; other kinds need the judge.
    const codeItems = request.quiz.questions.flatMap((question) => {
      const response = responseFor(question.id);
      if (question.type !== 'code' || response?.type !== 'code' || !response.text.trim()) return [];
      if (!inScope(question.id)) return [];
      const base = baseline.perQuestion.find((g) => g.questionId === question.id);
      if (question.kind === 'predict-output' && (secondPass || !base || base.score >= base.maxScore)) return [];
      return [{ question, response }];
    });
    if (openItems.length === 0 && clozeItems.length === 0 && codeItems.length === 0) return baseline;

    const ai = requireAiBridge();
    const sections: string[] = [];
    if (openItems.length > 0) {
      sections.push(
        `OPEN-ENDED ANSWERS\nScore each from 0 to 1 using the rubric. Do not award credit for an empty answer.\nRubric: ${request.rubric?.trim() || 'Score correctness, conceptual precision, and use of required terms. Partial credit is allowed.'}\n${KEY_POINT_RULES}\n\n${openItems.map(({ question, response }) => `Question ID: ${question.id}\nQuestion: ${question.prompt}\nReference answer: ${question.answer}\n${keyPointText(question.keyPoints)}Student answer: ${response?.type === 'open' ? response.text : '(no answer)'}${followUpText(followUps.get(question.id))}`).join('\n\n')}`,
      );
    }
    if (clozeItems.length > 0) {
      sections.push(
        `FILL-IN-THE-BLANK ANSWERS\nThe student fills blanks from memory, so grade for understanding, not string matching. Score EACH blank separately and return them in order as "blanks": [..] (one score per blank), plus a one-sentence "feedback".
Cloze rubric, per blank:
- 1.0: same meaning as the expected answer. Accept synonyms, paraphrases, abbreviations, acronym vs. full name, singular/plural, tense, casing, punctuation, spelling slips, and an equally valid term that fits the sentence and is true per the source.
- 0.5: right idea but too vague/general, incomplete (e.g. one word of a two-part term), or the correct concept in a clearly wrong form.
- 0: wrong, unrelated, contradicts the sentence, or blank.
Never require the exact wording. Never give credit for an empty blank. In feedback, name the expected term only for blanks that missed.

${clozeItems.map(({ question, response }) => `Question ID: ${question.id}\nSentence: ${question.prompt}\nExpected blanks (in order): ${JSON.stringify(question.answers)}\n${question.explanation ? `Why: ${question.explanation}\n` : ''}Student blanks (in order): ${JSON.stringify(question.answers.map((_, i) => response.fills[i] ?? ''))}`).join('\n\n')}`,
      );
    }
    if (codeItems.length > 0) {
      sections.push(
        `CODE-READING ANSWERS
Score each answer from 0 to 1 and give one sentence of feedback.
- predict-output: the expected output comes from really running the code. Give 1 if the student's answer is the same output apart from trivial formatting (whitespace, quote style, surrounding text like "Output:", None vs null-style naming). Give 0 if any value, order, or line differs.
- find-bug: 1 if they identify the actual bug (line or cause) and a valid fix; 0.5 if they find the right spot but not why or how to fix it; 0 otherwise.
- complexity: 1 if the Big-O matches and the reasoning is sound; 0.5 for the right Big-O without reasoning; 0 otherwise.
- scale: the student explains what happens when the input grows dramatically. Score by how well they identify the bottleneck (memory, time, or both), explain WHY it breaks at scale, and propose a sound fix. Any valid approach counts (generator, streaming, chunking, heap, hash set, external sort, bounded cache, backpressure); do not require the reference solution. Naming a technique without the reasoning earns at most 0.5.
${KEY_POINT_RULES}

${codeItems.map(({ question, response }) => `Question ID: ${question.id}\nKind: ${question.kind}\nQuestion: ${question.prompt}\n${question.snippet.trim() ? `Code (${question.language}):\n${question.snippet}\n` : ''}Expected: ${question.expected}\n${keyPointText(question.keyPoints)}${question.explanation ? `Why: ${question.explanation}\n` : ''}Student answer: ${response.text}${followUpText(followUps.get(question.id))}`).join('\n\n')}`,
      );
    }
    const probeRules = probing
      ? PROBE_RULES
      : secondPass
        ? 'These questions had a follow-up probe. Grade the original answer and the follow-up answer TOGETHER as the student\'s total understanding. Set "followUp" to null.'
        : 'Set "followUp" to null.';
    const prompt = `Grade the quiz answers below. Return ONLY JSON with this shape: {"results":[{"questionId":"...","score":0,"blanks":[0],"missing":["..."],"followUp":null,"feedback":"..."}]}. Omit "blanks" for open-ended and code answers; omit "score" for fill-in-the-blank answers. For open-ended and code answers with key points, "missing" lists the key points the student did not cover (short strings; empty array if all covered). Be concise and specific.

${probeRules}

${sections.join('\n\n---\n\n')}`;
    const result = await ai.chatCompletions({
      model: this.model,
      operation: 'quiz_grading',
      metadata: {
        openQuestionCount: openItems.length,
        clozeQuestionCount: clozeItems.length,
        codeQuestionCount: codeItems.length,
      },
      capture: 'full',
      messages: [{ role: 'system', content: 'You are a fair, careful quiz grader. Follow the requested JSON format exactly.' }, { role: 'user', content: prompt }],
      temperature: 0,
      max_tokens: 2600,
    });
    let parsed: {
      results?: Array<{
        questionId?: string;
        score?: number;
        blanks?: number[];
        missing?: unknown;
        followUp?: unknown;
        feedback?: string;
      }>;
    } = {};
    try {
      const json = result.content.replace(/^```json\s*/i, '').replace(/\s*```$/, '').trim();
      parsed = JSON.parse(json) as typeof parsed;
    } catch {
      return baseline;
    }
    const clamp = (n: unknown) => Math.max(0, Math.min(1, Number(n) || 0));
    const graded = new Map((parsed.results ?? []).map((item) => [item.questionId, item]));
    const clozeIds = new Set(clozeItems.map(({ question }) => question.id));
    const codeById = new Map(codeItems.map(({ question }) => [question.id, question]));
    const perQuestion = baseline.perQuestion.map((item) => {
      const aiGrade = graded.get(item.questionId);
      if (!aiGrade) return item;
      const feedback = aiGrade.feedback?.trim() || item.feedback;
      if (clozeIds.has(item.questionId)) {
        if (!Array.isArray(aiGrade.blanks)) return item;
        // Judge may only raise the exact-match score, never lower it.
        const question = request.quiz.questions.find((q) => q.id === item.questionId);
        const response = responseFor(item.questionId);
        if (question?.type !== 'cloze' || response?.type !== 'cloze') return item;
        const judged = question.answers.reduce((sum, answer, i) => {
          const exact = normalizeAnswer(response.fills[i] ?? '') === normalizeAnswer(answer);
          return sum + (exact ? 1 : clamp(aiGrade.blanks?.[i]));
        }, 0);
        return { ...item, score: Math.min(item.maxScore, judged), feedback };
      }
      const codeQuestion = codeById.get(item.questionId);
      if (codeQuestion?.kind === 'predict-output') {
        // Output questions have a ground-truth baseline: the judge may only forgive formatting.
        return { ...item, score: Math.max(item.score, clamp(aiGrade.score)), feedback };
      }
      // Explain-it-back answers (open + find-bug / complexity / scale): score, gaps, optional probe.
      const missing = Array.isArray(aiGrade.missing)
        ? aiGrade.missing.filter((m): m is string => typeof m === 'string' && m.trim().length > 0).slice(0, 6)
        : [];
      const followUp =
        probing && typeof aiGrade.followUp === 'string' && aiGrade.followUp.trim()
          ? aiGrade.followUp.trim().slice(0, 300)
          : undefined;
      const followed = followUps.get(item.questionId);
      return {
        ...item,
        score: clamp(aiGrade.score),
        feedback,
        ...(missing.length ? { missing } : {}),
        ...(followUp ? { followUp } : {}),
        ...(followed ? { probe: { question: followed.question, answer: followed.answer } } : {}),
      };
    });
    // Cap probes per quiz: keep the first few, drop the rest.
    let probeBudget = MAX_PROBES;
    for (let i = 0; i < perQuestion.length; i += 1) {
      if (!perQuestion[i].followUp) continue;
      if (probeBudget > 0) probeBudget -= 1;
      else perQuestion[i] = { ...perQuestion[i], followUp: undefined };
    }
    // Totals must follow the judged per-question scores, not the exact-match baseline.
    const score = perQuestion.reduce((sum, item) => sum + item.score, 0);
    const maxScore = baseline.maxScore;
    const percent = Math.round((score / maxScore) * 100);
    const rubric = request.rubric?.trim() || request.quiz.rubric;
    return {
      score,
      maxScore,
      percent,
      feedback: `Graded ${percent}%. ${rubric}`,
      perQuestion,
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
