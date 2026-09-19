export type {
  ClozeQuestion,
  CodeKind,
  CodeQuestion,
  CodeResponse,
  ClozeResponse,
  GenerateQuizRequest,
  GradeQuizRequest,
  GradeReport,
  McqOption,
  McqQuestion,
  McqResponse,
  OpenQuestion,
  OpenResponse,
  PresentedMcqOption,
  PresentedMcqQuestion,
  PresentedQuestion,
  QuestionGrade,
  QuestionType,
  QuizDocument,
  QuizQuestion,
  QuizResponse,
} from './types';

export {
  isQuizFileName,
  isQuizPath,
  quizDisplayTitle,
  quizFileTitle,
} from './paths';
export { parseQuizMarkdown } from './parseQuizMarkdown';
export { serializeQuizMarkdown } from './serializeQuizMarkdown';
export {
  applyQuizGuardrails,
  quizDocumentToMarkdown,
  hasLetterPrefixedOptions,
} from './guardrails';
export {
  createRng,
  hashSeed,
  optionLetter,
  shuffleInPlace,
  shuffledCopy,
} from './shuffle';
export { presentQuiz, clozeSegments } from './present';
export { useQuizTake } from './useQuizTake';
export { QuizHistoryStore, buildQuizAttempt } from './history';
export type { QuizAttempt, QuestionAttempt, QuizHistoryFile } from './history';
export { QuizShell } from './QuizShell';
export { ProgressPanel } from './ProgressPanel';
export { QuizTakeView } from './QuizTakeView';
export { QuizEditView } from './QuizEditView';
export { QuizGradeView } from './QuizGradeView';
// GenerateQuizDialog is lazy-loaded from App.
export type { GenerateQuizDialogResult } from './GenerateQuizDialog';
export { verifyCodeQuestions } from './verifyCode';
export type { VerifyCodeSummary } from './verifyCode';
export { normalizeOutput } from './codeOutput';
