import type {
  AiProvider,
  CompleteRequest,
  GenerateQuizRequest,
  GenerateQuizFollowUpRequest,
  GradeQuizRequest,
  GradeReport,
  QuizDocument,
} from './types';
import { buildTeacherCompletePrompt, truncateNoteContext } from './systemPrompt';
import { MockAiProvider } from './MockAiProvider';
import { stubGenerateQuiz, stubGradeQuiz } from './quizStubs';

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

  generateQuiz(request: GenerateQuizRequest): Promise<QuizDocument> {
    if (this.provider.generateQuiz) {
      return this.provider.generateQuiz(request);
    }
    return Promise.resolve(stubGenerateQuiz(request));
  }

  generateQuizFollowUp(request: GenerateQuizFollowUpRequest): Promise<string> {
    if (this.provider.generateQuizFollowUp) {
      return this.provider.generateQuizFollowUp(request);
    }
    return Promise.resolve('What reasoning led you to that answer?');
  }

  gradeQuiz(request: GradeQuizRequest): Promise<GradeReport> {
    if (this.provider.gradeQuiz) {
      return this.provider.gradeQuiz(request);
    }
    return Promise.resolve(stubGradeQuiz(request));
  }
}

/** Shared singleton for app-wide use. */
export const aiClient = new AiClient();
