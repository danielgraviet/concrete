/** File-backed quiz domain types (distinct from flashcard SRS). */

export type QuestionType = 'mcq' | 'cloze' | 'open' | 'code';

export type McqOption = {
  /** Stable id used for grading — never display letter. */
  id: string;
  text: string;
  correct: boolean;
};

export type McqQuestion = {
  id: string;
  type: 'mcq';
  prompt: string;
  options: McqOption[];
};

export type ClozeQuestion = {
  id: string;
  type: 'cloze';
  /** Prompt with `{{answer}}` blanks. */
  prompt: string;
  /** Answers in blank order. */
  answers: string[];
  /** Why the answer fits; context for the grader. */
  explanation?: string;
};

export type OpenQuestion = {
  id: string;
  type: 'open';
  prompt: string;
  /** Reference answer for the grader. */
  answer: string;
  /** Ideas a strong answer covers; graded by coverage, not wording. */
  keyPoints?: string[];
};

/** What a code-reading question asks about its snippet. */
/**
 * predict-output: run-and-verify. find-bug / complexity / scale: explain-it-back,
 * scored against `keyPoints`. `scale` asks what happens as the input grows.
 */
export type CodeKind = 'predict-output' | 'find-bug' | 'complexity' | 'scale';

export const CODE_KINDS: readonly CodeKind[] = ['predict-output', 'find-bug', 'complexity', 'scale'];

export type CodeQuestion = {
  id: string;
  type: 'code';
  kind: CodeKind;
  /** Fence language of the snippet (python, typescript …). */
  language: string;
  prompt: string;
  snippet: string;
  /** predict-output: exact stdout. Otherwise: reference answer for the grader. */
  expected: string;
  /** Ideas a strong explanation covers (explain-it-back kinds). */
  keyPoints?: string[];
  explanation?: string;
  /** True when `expected` came from actually running the snippet. */
  verified?: boolean;
};

export type QuizQuestion = McqQuestion | ClozeQuestion | OpenQuestion | CodeQuestion;

export type QuizDocument = {
  title: string;
  source?: string;
  rubric: string;
  questions: QuizQuestion[];
};

/** Presented MCQ option with a display letter assigned after shuffle. */
export type PresentedMcqOption = McqOption & {
  letter: string;
};

export type PresentedMcqQuestion = Omit<McqQuestion, 'options'> & {
  options: PresentedMcqOption[];
};

export type PresentedQuestion =
  | PresentedMcqQuestion
  | ClozeQuestion
  | OpenQuestion
  | CodeQuestion;

export type McqResponse = {
  questionId: string;
  type: 'mcq';
  /** Selected option ids. */
  selectedIds: string[];
};

export type ClozeResponse = {
  questionId: string;
  type: 'cloze';
  /** Filled blanks in order. */
  fills: string[];
};

export type OpenResponse = {
  questionId: string;
  type: 'open';
  text: string;
};

export type CodeResponse = {
  questionId: string;
  type: 'code';
  text: string;
};

export type QuizResponse = McqResponse | ClozeResponse | OpenResponse | CodeResponse;

export type QuestionGrade = {
  questionId: string;
  score: number;
  maxScore: number;
  feedback: string;
  correctAnswer?: string;
  /** Key points the answer did not cover. */
  missing?: string[];
  /** A "why?" probe the judge wants answered before finalizing this grade. */
  followUp?: string;
  /** The probe and the student's reply, once answered. */
  probe?: { question: string; answer: string };
};

export type GradeReport = {
  score: number;
  maxScore: number;
  percent: number;
  feedback: string;
  perQuestion: QuestionGrade[];
  /** True when grader is a stub / mock. */
  stubbed: boolean;
};

export type GenerateQuizRequest = {
  topic: string;
  noteContext?: string;
  /** Primary / first source path (frontmatter). */
  source?: string;
  /** All source note paths included in context. */
  sources?: string[];
  types?: QuestionType[];
  mcqCount?: number;
  clozeCount?: number;
  openCount?: number;
  codeCount?: number;
  difficulty?: 'easy' | 'medium' | 'hard';
  customRubric?: string;
};

export type GradeQuizRequest = {
  quiz: QuizDocument;
  responses: QuizResponse[];
  rubric?: string;
  /** Optional practice follow-up answers, scored with the original response. */
  followUps?: Array<{ questionId: string; question: string; answer: string }>;
};

export type GenerateQuizFollowUpRequest = {
  question: string;
  studentAnswer: string;
  feedback: string;
  missing: string[];
};
