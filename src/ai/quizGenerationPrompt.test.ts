import { describe, expect, it } from 'vitest';
import {
  QUIZ_GENERATION_SYSTEM_PROMPT,
  buildQuizGenerationUserPrompt,
} from './quizGenerationPrompt';
import { QUIZ_GENERATION_SYSTEM_PROMPT_V1 } from './quizPrompts/v1';

describe('quiz generation system prompt', () => {
  it('requires standalone, accurate questions with balanced MCQ options', () => {
    expect(QUIZ_GENERATION_SYSTEM_PROMPT).toContain('STANDALONE RULES');
    expect(QUIZ_GENERATION_SYSTEM_PROMPT).toContain('ACCURACY RULES');
    expect(QUIZ_GENERATION_SYSTEM_PROMPT).toContain('MCQ OPTION RULES');
  });

  it('keeps the v1 prompt frozen for comparison', () => {
    expect(QUIZ_GENERATION_SYSTEM_PROMPT_V1).not.toBe(QUIZ_GENERATION_SYSTEM_PROMPT);
    expect(QUIZ_GENERATION_SYSTEM_PROMPT_V1).toContain(
      'Ground every item in the provided note context when present.',
    );
    expect(QUIZ_GENERATION_SYSTEM_PROMPT_V1).not.toContain('STANDALONE RULES');
  });
});

describe('buildQuizGenerationUserPrompt', () => {
  it('treats note context as material to verify, not as authoritative', () => {
    const prompt = buildQuizGenerationUserPrompt({
      topic: 'TCP',
      noteContext: 'TCP uses a three-way handshake.',
      mcqCount: 2,
    });

    expect(prompt).not.toContain('authoritative');
    expect(prompt).toContain('verify its facts');
    expect(prompt).toContain('make sense on its own, without the note');
    expect(prompt).toContain('TCP uses a three-way handshake.');
  });
});
