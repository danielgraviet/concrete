import { applyQuizGuardrails } from '../quiz/guardrails';
import { parseQuizMarkdown } from '../quiz/parseQuizMarkdown';
import type { QuizDocument } from '../quiz/types';

/**
 * Pull quiz markdown out of a model reply (raw doc or fenced block),
 * parse it, and run generation guardrails.
 */
export function quizDocumentFromModelText(
  raw: string,
  fallbackTitle: string,
): QuizDocument {
  const markdown = extractQuizMarkdown(raw);
  const parsed = parseQuizMarkdown(markdown);

  if (!parsed.title || parsed.title === 'Quiz') {
    parsed.title = fallbackTitle.startsWith('Quiz ')
      ? fallbackTitle
      : `Quiz ${fallbackTitle}`;
  }

  if (parsed.questions.length === 0) {
    throw new Error(
      'Model response did not contain parseable quiz questions. Try again.',
    );
  }

  return applyQuizGuardrails(parsed, parsed.title);
}

export function extractQuizMarkdown(raw: string): string {
  const text = raw.trim();
  if (!text) {
    throw new Error('Empty model response');
  }

  // Unwrap only when the WHOLE reply is inside one markdown fence. Quizzes
  // contain their own fences (code questions), so a "first fence" match would
  // grab a snippet instead of the quiz.
  const wrapped = /^```(?:markdown|md)?[ \t]*\n([\s\S]*)\n```[ \t]*$/i.exec(text);
  const candidate = (wrapped?.[1] ?? text).trim();

  const fmStart = candidate.indexOf('---');
  if (fmStart >= 0) {
    return candidate.slice(fmStart).trim();
  }

  const heading = candidate.search(/^#\s+Quiz\b/m);
  if (heading >= 0) {
    return candidate.slice(heading).trim();
  }

  const qHeading = candidate.search(/^##\s+Q\d+/m);
  if (qHeading >= 0) {
    return `---\ntype: quiz\n---\n\n# Quiz\n\n${candidate.slice(qHeading).trim()}`;
  }

  return candidate;
}
