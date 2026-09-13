/** File-backed quiz domain types (distinct from flashcard SRS). */

export type QuestionType = 'mcq' | 'cloze' | 'open';

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
};

export type OpenQuestion = {
  id: string;
  type: 'open';
  prompt: string;
  /** Reference answer for the grader. */
  answer: string;
};

export type QuizQuestion = McqQuestion | ClozeQuestion | OpenQuestion;

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
  | OpenQuestion;

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

export type QuizResponse = McqResponse | ClozeResponse | OpenResponse;

export type QuestionGrade = {
  questionId: string;
  score: number;
  maxScore: number;
  feedback: string;
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
};

export type GradeQuizRequest = {
  quiz: QuizDocument;
  responses: QuizResponse[];
  rubric?: string;
};
