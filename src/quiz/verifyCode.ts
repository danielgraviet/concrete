import { getSandboxStatus, runSandboxCode } from '../sandbox';
import { normalizeOutput } from './codeOutput';
import type { CodeQuestion, QuizDocument, QuizQuestion } from './types';

export type VerifyCodeSummary = {
  doc: QuizDocument;
  sandboxAvailable: boolean;
  /** predict-output questions whose expected output came from a real run. */
  verified: number;
  /** Dropped because the snippet failed, timed out, or was non-deterministic. */
  dropped: number;
  /** Kept without running (no runner, unsupported language, or infrastructure error). */
  unverified: number;
};

type Outcome = { question: QuizQuestion | null; kind: 'verified' | 'dropped' | 'unverified' | 'skipped' };

async function verifyOne(
  question: CodeQuestion,
  languages: string[],
  providerId: string,
): Promise<Outcome> {
  if (question.kind !== 'predict-output') return { question, kind: 'skipped' };
  const language = question.language.toLowerCase();
  const supported = languages.some((l) => l === language || (l === 'typescript' && language === 'ts'));
  if (!supported || !question.snippet.trim()) return { question, kind: 'unverified' };

  // Never start a multi-minute image build in the middle of quiz generation.
  const request = { language: question.language, code: question.snippet, timeoutMs: 8000, allowBuild: false };
  const [first, second] = await Promise.all([
    runSandboxCode(request, providerId),
    runSandboxCode(request, providerId),
  ]);

  // Runner/infra failures (no exit code, not a timeout) say nothing about the snippet.
  const infra = (r: typeof first) => !r.ok && r.exitCode === null && !r.timedOut;
  if (infra(first) || infra(second)) return { question, kind: 'unverified' };

  const a = normalizeOutput(first.stdout);
  const b = normalizeOutput(second.stdout);
  if (!first.ok || !second.ok || !a || a !== b) return { question: null, kind: 'dropped' };
  return { question: { ...question, expected: a, verified: true }, kind: 'verified' };
}

/**
 * Check generated code questions against a real run. predict-output answers are
 * replaced with the actual output; snippets that error, hang, or vary between
 * runs are dropped. Without a runner the questions are kept, unverified.
 */
export async function verifyCodeQuestions(
  doc: QuizDocument,
  providerId: string,
): Promise<VerifyCodeSummary> {
  const hasCode = doc.questions.some((q) => q.type === 'code');
  const status = hasCode ? await getSandboxStatus(providerId) : null;
  const summary: VerifyCodeSummary = {
    doc,
    sandboxAvailable: Boolean(status?.available),
    verified: 0,
    dropped: 0,
    unverified: 0,
  };
  if (!hasCode) return summary;

  const outcomes = await Promise.all(
    doc.questions.map(async (question): Promise<Outcome> => {
      if (question.type !== 'code') return { question, kind: 'skipped' };
      if (!status?.available) {
        return { question, kind: question.kind === 'predict-output' ? 'unverified' : 'skipped' };
      }
      return verifyOne(question, status.languages, providerId);
    }),
  );

  for (const outcome of outcomes) {
    if (outcome.kind === 'verified') summary.verified += 1;
    else if (outcome.kind === 'dropped') summary.dropped += 1;
    else if (outcome.kind === 'unverified') summary.unverified += 1;
  }
  summary.doc = {
    ...doc,
    questions: outcomes.flatMap((o) => (o.question ? [o.question] : [])),
  };
  return summary;
}
