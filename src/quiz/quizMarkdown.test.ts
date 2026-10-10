import { describe, expect, it } from 'vitest';
import { parseQuizMarkdown } from './parseQuizMarkdown';
import { serializeQuizMarkdown } from './serializeQuizMarkdown';
import type { QuizDocument } from './types';

describe('quiz markdown round trip', () => {
  it('preserves question data and frontmatter across every question type', () => {
    const quiz: QuizDocument = {
      title: 'Reading code and language',
      source: 'notes/Chapter: 1.md',
      rubric: `Check the reasoning.
Allow other valid approaches.`,
      questions: [
        {
          id: 'mcq-1',
          type: 'mcq',
          prompt: 'Which values are even?',
          options: [
            { id: 'a', text: '2', correct: true },
            { id: 'b', text: '3', correct: false },
            { id: 'c', text: '4', correct: true },
          ],
        },
        {
          id: 'cloze-1',
          type: 'cloze',
          prompt: 'Water freezes at {{0}} degrees Celsius.',
          answers: ['0'],
          explanation: 'At standard pressure, ice and liquid water meet at this temperature.',
        },
        {
          id: 'cloze-2',
          type: 'cloze',
          prompt: 'A triangle has {{three}} sides.',
          answers: ['three'],
        },
        {
          id: 'open-1',
          type: 'open',
          prompt: 'Why do plants need sunlight?',
          answer: 'They use light energy to make sugars through photosynthesis.',
          keyPoints: ['light provides energy', 'photosynthesis makes sugars'],
        },
        {
          id: 'code-1',
          type: 'code',
          kind: 'find-bug',
          language: 'typescript',
          prompt: 'What does this string contain?',
          snippet: 'const fence = "```";\nconsole.log(fence);',
          expected: 'The string contains three backticks.',
          keyPoints: ['the literal is preserved'],
          explanation: 'The surrounding markdown fence uses tildes.',
          verified: true,
        },
      ],
    };

    const markdown = serializeQuizMarkdown(quiz);
    const parsed = parseQuizMarkdown(markdown);

    expect(parsed).toEqual({
      title: quiz.title,
      source: quiz.source,
      rubric: 'Check the reasoning. Allow other valid approaches.',
      questions: [
        {
          id: 'q-1',
          type: 'mcq',
          prompt: 'Which values are even?',
          options: [
            { id: 'q-1-opt-1', text: '2', correct: true },
            { id: 'q-1-opt-2', text: '3', correct: false },
            { id: 'q-1-opt-3', text: '4', correct: true },
          ],
        },
        {
          id: 'q-2',
          type: 'cloze',
          prompt: 'Water freezes at {{0}} degrees Celsius.',
          answers: ['0'],
          explanation: 'At standard pressure, ice and liquid water meet at this temperature.',
        },
        {
          id: 'q-3',
          type: 'cloze',
          prompt: 'A triangle has {{three}} sides.',
          answers: ['three'],
        },
        {
          id: 'q-4',
          type: 'open',
          prompt: 'Why do plants need sunlight?',
          answer: 'They use light energy to make sugars through photosynthesis.',
          keyPoints: ['light provides energy', 'photosynthesis makes sugars'],
        },
        {
          id: 'q-5',
          type: 'code',
          kind: 'find-bug',
          language: 'typescript',
          prompt: 'What does this string contain?',
          snippet: 'const fence = "```";\nconsole.log(fence);',
          expected: 'The string contains three backticks.',
          keyPoints: ['the literal is preserved'],
          explanation: 'The surrounding markdown fence uses tildes.',
          verified: true,
        },
      ],
    });
    expect(markdown).toContain('~~~~typescript');
    expect(markdown).toContain('source: "notes/Chapter: 1.md"');
  });
});
