import type {
  AiProvider,
  CompleteRequest,
  GenerateQuizRequest,
  GenerateQuizFollowUpRequest,
  GradeQuizRequest,
  GradeReport,
  QuizDocument,
} from './types';
import { TEACHER_SYSTEM_PROMPT } from './systemPrompt';
import { stubGenerateQuiz, stubGradeQuiz } from './quizStubs';

const CANNED: Record<string, string> = {
  summarize:
    'Here is a short summary of the note.\n\n1. Main idea in one sentence\n2. Two supporting points\n3. One open question to review later',
  flashcard:
    'Front: What is the core idea in this note?\nBack: Restate it in one plain sentence from the note.',
  quiz:
    'Q: What should you remember from this note?\nA) The main claim\nB) A side detail\nC) Something unrelated\nAnswer: A',
  explain:
    'Start with the definition in your own words. Then point at one example in the note. Stop there.',
  how:
    'Try this: write the smallest working example in the note. Check it once. Then expand only if needed.',
  default:
    'Got it. Ask one focused question about the note or Markdown and I will answer briefly.',
};

function pickResponse(prompt: string): string {
  const lower = prompt.toLowerCase();
  if (lower.includes('summar')) return CANNED.summarize;
  if (lower.includes('flash') || lower.includes('card')) return CANNED.flashcard;
  if (lower.includes('quiz') || lower.includes('question')) return CANNED.quiz;
  if (lower.includes('explain') || lower.includes('what is') || lower.includes('why ')) {
    return CANNED.explain;
  }
  if (lower.includes('how ') || lower.includes('how do')) return CANNED.how;
  return CANNED.default;
}

/** Deterministic canned responses for offline development. */
export class MockAiProvider implements AiProvider {
  readonly id = 'mock';
  readonly label = 'Mock tutor';

  async complete(request: CompleteRequest): Promise<string> {
    // Prefer the user line when the client wrapped the teacher system prompt.
    const userLine = /(?:^|\n)User:\s*([\s\S]*?)(?:\nNote context|\n*$)/.exec(request.prompt);
    const userPrompt = (userLine?.[1] ?? request.prompt).trim();
    const body = pickResponse(userPrompt);
    const hasCtx = Boolean(request.context?.trim()) || request.prompt.includes('Note context');
    const ctxHint = hasCtx ? '\n\n(Using your note context.)' : '';
    void TEACHER_SYSTEM_PROMPT;
    return `${body}${ctxHint}`;
  }

  async embed(text: string): Promise<number[]> {
    const dims = 8;
    const out = new Array<number>(dims).fill(0);
    for (let i = 0; i < text.length; i++) {
      out[i % dims] += text.charCodeAt(i) / 255;
    }
    const norm = Math.sqrt(out.reduce((s, v) => s + v * v, 0)) || 1;
    return out.map((v) => Math.round((v / norm) * 1000) / 1000);
  }

  async generateQuiz(request: GenerateQuizRequest): Promise<QuizDocument> {
    return stubGenerateQuiz(request);
  }

  async gradeQuiz(request: GradeQuizRequest): Promise<GradeReport> {
    return stubGradeQuiz(request);
  }

  async generateQuizFollowUp(_request: GenerateQuizFollowUpRequest): Promise<string> {
    return 'What reasoning led you to that answer?';
  }
}
