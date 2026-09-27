export type {
  CompleteRequest,
  AiProvider,
  GenerateQuizRequest,
  GenerateQuizFollowUpRequest,
  GradeQuizRequest,
  GradeReport,
  QuizDocument,
} from './types';
export { MockAiProvider } from './MockAiProvider';
export { LocalEchoProvider } from './LocalEchoProvider';
export {
  ChatModelProvider,
  isChatBackendId,
  OPENROUTER_MODEL_DEEPSEEK_V4_FLASH,
  OPENROUTER_MODEL_DEFAULT,
  OPENROUTER_MODEL_LUNA,
  OPENROUTER_MODEL_GPT4O_MINI,
  OPENROUTER_MODEL_OPTIONS,
  isOpenRouterModelId,
  resolveOpenRouterModelId,
  openRouterModelLabel,
} from './ChatModelProvider';
export type { ChatBackendId, OpenRouterModelOption } from './ChatModelProvider';
export {
  CLAUDE_MODEL_DEFAULT,
  CLAUDE_MODEL_OPTIONS,
  resolveClaudeModelId,
  claudeModelLabel,
} from './claudeModels';
export { AiClient, aiClient } from './AiClient';
export { stubGenerateQuiz, stubGradeQuiz } from './quizStubs';
export {
  QUIZ_GENERATION_SYSTEM_PROMPT,
  buildQuizGenerationUserPrompt,
} from './quizGenerationPrompt';
export {
  quizDocumentFromModelText,
  extractQuizMarkdown,
} from './quizDocumentFromModelText';
export { AiPanel } from './AiPanel';
// AiOrb is lazy-loaded from App.
export {
  TEACHER_SYSTEM_PROMPT,
  NOTE_CONTEXT_LIMIT,
  truncateNoteContext,
  buildTeacherCompletePrompt,
} from './systemPrompt';
export { setSlashAiHandler, handoffSlashToAi } from './slashHandoff';
export type { SlashAiHandler } from './slashHandoff';
