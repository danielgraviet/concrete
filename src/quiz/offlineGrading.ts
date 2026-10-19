import { normalize } from '../ai/quizStubs';
import type { GradeReport, QuizDocument, QuizResponse } from './types';

/** Grade only the quiz types that can be scored deterministically on device. */
export function gradeQuizOffline(quiz: QuizDocument, responses: Record<string, QuizResponse>): GradeReport {
  const perQuestion: GradeReport['perQuestion'] = [];
  for (const question of quiz.questions) {
    const response = responses[question.id];
    if (question.type === 'mcq') {
      const selected = new Set(response?.type === 'mcq' ? response.selectedIds : []);
      const correct = new Set(question.options.filter((option) => option.correct).map((option) => option.id));
      const exact = selected.size === correct.size && [...correct].every((id) => selected.has(id));
      const partial = [...selected].some((id) => correct.has(id));
      perQuestion.push({
        questionId: question.id,
        score: exact ? 1 : partial ? 0.5 : 0,
        maxScore: 1,
        feedback: exact ? 'Correct.' : partial ? 'Partially correct. Review the options you missed.' : 'Incorrect. Revisit the related note section.',
      });
    } else if (question.type === 'cloze') {
      const fills = response?.type === 'cloze' ? response.fills : [];
      const score = question.answers.reduce((total, answer, index) => total + (normalize(fills[index] ?? '') === normalize(answer) ? 1 : 0), 0);
      perQuestion.push({
        questionId: question.id,
        score,
        maxScore: Math.max(question.answers.length, 1),
        feedback: score === question.answers.length ? 'All blanks correct.' : score > 0 ? 'Some blanks need another look.' : 'Blanks did not match the expected terms.',
      });
    }
  }
  const score = perQuestion.reduce((sum, item) => sum + item.score, 0);
  const maxScore = perQuestion.reduce((sum, item) => sum + item.maxScore, 0);
  const deferred = quiz.questions.length - perQuestion.length;
  const percent = maxScore ? Math.round((score / maxScore) * 100) : 0;
  return {
    score,
    maxScore,
    percent,
    feedback: deferred
      ? `${perQuestion.length ? '' : 'No MCQ or cloze items to grade locally. '}${deferred} written or code ${deferred === 1 ? 'answer is' : 'answers are'} saved for optional AI grading.`
      : 'Graded locally on this device.',
    perQuestion,
    stubbed: false,
  };
}
