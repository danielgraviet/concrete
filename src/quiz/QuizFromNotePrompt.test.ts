import { describe, expect, it } from 'vitest';
import { noteHasQuizMaterial, notePathKey, quizSourceFromMarkdown } from './QuizFromNotePrompt';

describe('QuizFromNotePrompt helpers', () => {
  it('ignores a title-only note', () => {
    expect(noteHasQuizMaterial('# Ideas\n\nCapture quickly.')).toBe(false);
  });

  it('accepts a short paragraph', () => {
    const body = `# Notes\n\n${'Cells store state. '.repeat(8)}`;
    expect(noteHasQuizMaterial(body)).toBe(true);
  });

  it('reads the quiz source path', () => {
    const markdown = '---\ntype: quiz\nsource: Stats/Overview.md\nrubric: "Be precise."\n---\n# Quiz\n';
    expect(quizSourceFromMarkdown(markdown)).toBe('stats/overview.md');
    expect(notePathKey('Stats/Overview.md')).toBe(quizSourceFromMarkdown(markdown));
  });

  it('returns null when a file is not a sourced quiz', () => {
    expect(quizSourceFromMarkdown('# Just a note\n\nHello.')).toBeNull();
  });
});
