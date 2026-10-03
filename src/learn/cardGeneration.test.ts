import { describe, expect, it } from 'vitest';
import { appendCardLines, formatMcqCardBlock } from './appendCardLines';
import { buildCardGenerationPrompt, cardBlocksFromModel } from './cardGeneration';
import { draftFromComposer } from './CreateCardsPanel';
import { parseNoteCards } from './parseNoteCards';

describe('cardBlocksFromModel', () => {
  it('keeps basic, cloze, and ?mcq blocks from model output', () => {
    const text = [
      'What is TCP? :: A transport protocol',
      '',
      'The {{window}} grows exponentially in slow start.',
      '',
      '?mcq',
      'Which controls retransmission?',
      '- [ ] IP',
      '- [x] TCP',
      '- [ ] UDP',
      '',
      'Not a card',
    ].join('\n');
    const blocks = cardBlocksFromModel(text);
    expect(blocks).toHaveLength(3);
    expect(parseNoteCards(blocks[0])[0]).toMatchObject({ kind: 'basic' });
    expect(parseNoteCards(blocks[1])[0]).toMatchObject({ kind: 'cloze' });
    expect(parseNoteCards(blocks[2])[0]).toMatchObject({ kind: 'mcq' });
  });
});

describe('appendCardLines', () => {
  it('appends a ?mcq block under ## Flashcards', () => {
    const block = formatMcqCardBlock('Pick one', [
      { text: 'A', correct: false },
      { text: 'B', correct: true },
    ]);
    const next = appendCardLines('# Note\n\nBody', [block]);
    expect(next).toContain('## Flashcards');
    expect(parseNoteCards(next)).toHaveLength(1);
  });
});

describe('buildCardGenerationPrompt', () => {
  it('puts the typed draft front and center with mcq format rules', () => {
    const prompt = buildCardGenerationPrompt('mcq', 'congestion control — AIMD', []);
    expect(prompt).toContain('USER DRAFT:');
    expect(prompt).toContain('congestion control — AIMD');
    expect(prompt).toContain('?mcq');
    expect(prompt).toContain('Only multiple-choice cards.');
  });
});

describe('draftFromComposer', () => {
  it('builds a draft from Front and Back fields', () => {
    expect(
      draftFromComposer('basic', {
        front: 'What is TCP?',
        back: 'Transport protocol',
        cloze: '',
        mcqPrompt: '',
        mcqOptions: [],
      }),
    ).toBe('Front: What is TCP?\nBack: Transport protocol');
  });
});
