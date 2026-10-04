import { describe, expect, it } from 'vitest';
import { appendCardLines, formatMcqCardBlock } from './appendCardLines';
import {
  buildBasicFillPrompt,
  buildClozeFillPrompt,
  buildMcqFillPrompt,
  cardBlocksFromModel,
  parseClozeFillReply,
  parseFillReply,
  parseMcqOptionsReply,
} from './cardGeneration';
import { parseNoteCards } from './parseNoteCards';

describe('buildBasicFillPrompt', () => {
  it('asks for only the answer when Front is given', () => {
    const prompt = buildBasicFillPrompt('answer', 'What does PCIe stand for?');
    expect(prompt).toContain('Question: What does PCIe stand for?');
    expect(prompt).toContain('ONLY the short answer');
  });

  it('asks for only the question when Back is given', () => {
    const prompt = buildBasicFillPrompt('question', 'Peripheral Component Interconnect Express');
    expect(prompt).toContain('Answer: Peripheral Component Interconnect Express');
    expect(prompt).toContain('ONLY the question');
  });
});

describe('parseFillReply', () => {
  it('strips labels quotes and extra lines', () => {
    expect(parseFillReply('Answer: Peripheral Component Interconnect Express\n\nMore')).toBe(
      'Peripheral Component Interconnect Express',
    );
    expect(parseFillReply('"What does PCIe stand for?"')).toBe('What does PCIe stand for?');
  });
});

describe('cloze fill', () => {
  it('asks for one cloze sentence from a draft', () => {
    const prompt = buildClozeFillPrompt('mitochondria make ATP');
    expect(prompt).toContain('Draft: mitochondria make ATP');
    expect(prompt).toContain('{{mitochondria}}');
  });

  it('keeps a line that contains braces', () => {
    expect(parseClozeFillReply('Here is a card:\nThe {{mitochondria}} produces ATP.\n')).toBe(
      'The {{mitochondria}} produces ATP.',
    );
    expect(parseClozeFillReply('No blanks here')).toBe('');
  });
});

describe('mcq fill', () => {
  it('asks for checkbox options for a question', () => {
    const prompt = buildMcqFillPrompt('Which layer handles retransmission?');
    expect(prompt).toContain('Question: Which layer handles retransmission?');
    expect(prompt).toContain('- [x] Correct option');
  });

  it('parses checkbox options and requires a correct mark', () => {
    expect(
      parseMcqOptionsReply(['- [ ] Network', '- [x] Transport', '- [ ] Application', 'commentary'].join('\n')),
    ).toEqual([
      { text: 'Network', correct: false },
      { text: 'Transport', correct: true },
      { text: 'Application', correct: false },
    ]);
    expect(parseMcqOptionsReply('- [ ] A\n- [ ] B')).toEqual([]);
  });
});

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
