import { describe, expect, it } from 'vitest';
import { nextQuizTitle } from './paths';

describe('nextQuizTitle', () => {
  it('keeps the first quiz title when nothing else uses it', () => {
    expect(nextQuizTitle('Notes', 'Stats', ['Stats/Overview.md'])).toBe('Quiz Notes');
  });

  it('numbers the next quiz in the same folder', () => {
    expect(nextQuizTitle('Quiz Notes', 'Stats', ['Stats/Quiz Notes.md'])).toBe('Quiz 2: Notes');
  });

  it('skips numbers that are already taken', () => {
    expect(
      nextQuizTitle('Notes', '', ['Quiz Notes.md', 'Quiz 2: Notes.md', 'Quiz 4: Notes.md']),
    ).toBe('Quiz 3: Notes');
  });

  it('does not treat the same title in another folder as a clash', () => {
    expect(nextQuizTitle('Notes', 'Stats', ['Other/Quiz Notes.md'])).toBe('Quiz Notes');
  });
});
