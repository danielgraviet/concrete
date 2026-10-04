import { describe, expect, it } from 'vitest';
import { cardsFromNote, cardsFromQuiz } from './buildCards';
import { clozeDisplaySegments, parseClozeBlanks, parseNoteCards } from './parseNoteCards';

describe('parseNoteCards', () => {
  it('reads basic and reversed single-line cards, stripping list markers', () => {
    const cards = parseNoteCards('# Net\n\n- What does TCP guarantee? :: Ordered delivery\nMitochondria ::: Powerhouse');
    expect(cards).toEqual([
      { kind: 'basic', front: 'What does TCP guarantee?', back: 'Ordered delivery', line: 2 },
      { kind: 'basic', front: 'Mitochondria', back: 'Powerhouse', line: 3 },
      { kind: 'basic', front: 'Powerhouse', back: 'Mitochondria', line: 3 },
    ]);
  });

  it('ignores :: without surrounding spaces, in inline code, and in code fences', () => {
    const md = [
      'Use std::vector for arrays.',
      'status:: done',
      'Call `a :: b` here',
      '```cpp',
      'x :: y',
      '{{nope}}',
      '```',
    ].join('\n');
    expect(parseNoteCards(md)).toEqual([]);
  });

  it('skips frontmatter', () => {
    expect(parseNoteCards('---\ntitle: a :: b\n---\nQ :: A')).toEqual([{ kind: 'basic', front: 'Q', back: 'A', line: 3 }]);
  });

  it('makes one cloze card per blank, grouping numbered blanks', () => {
    const cards = parseNoteCards('The {{mitochondria}} makes {{ATP}}.\n\n{{c1::Paris}} is in {{c1::France}}, on the {{2::Seine}}.');
    expect(cards.map((c) => (c.kind === 'cloze' ? [c.group, c.line] : null))).toEqual([
      ['#1', 0],
      ['#2', 0],
      ['1', 2],
      ['2', 2],
    ]);
  });

  it('parses cloze hints and ignores blanks inside inline math', () => {
    expect(parseClozeBlanks('{{c1::Ottawa::capital}} and $x^{{2}}$')).toEqual([
      { start: 0, end: 23, group: '1', answer: 'Ottawa', hint: 'capital' },
    ]);
  });

  it('reads multi-line cards, keeping a code block that follows the answer', () => {
    const md = ['Intro paragraph.', '', 'What does this print?', '?', 'It prints:', '', '```py', 'print(1)', '', '```', '', 'Unrelated text.'].join('\n');
    const cards = parseNoteCards(md);
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({ kind: 'basic', front: 'What does this print?', line: 2 });
    expect(cards[0].kind === 'basic' && cards[0].back).toBe('It prints:\n\n```py\nprint(1)\n\n```');
  });

  it('?? makes a reversed multi-line card', () => {
    expect(parseNoteCards('Front\n??\nBack')).toHaveLength(2);
  });

  it('reads note-native ?mcq blocks into multiple-choice cards', () => {
    const md = [
      '## Flashcards',
      '',
      '?mcq',
      'What layer handles retransmission?',
      '- [ ] Network',
      '- [x] Transport',
      '- [ ] Application',
      '',
      'Q :: A',
    ].join('\n');
    const cards = parseNoteCards(md);
    expect(cards[0]).toEqual({
      kind: 'mcq',
      prompt: 'What layer handles retransmission?',
      options: [
        { text: 'Network', correct: false },
        { text: 'Transport', correct: true },
        { text: 'Application', correct: false },
      ],
      line: 2,
    });
    expect(cards[1]).toMatchObject({ kind: 'basic', front: 'Q', back: 'A' });
    const built = cardsFromNote('nets.md', md);
    expect(built[0]).toMatchObject({ kind: 'mcq', source: { path: 'nets.md', origin: 'note', line: 2 } });
    expect(built[0].kind === 'mcq' && built[0].question.options.some((o) => o.correct)).toBe(true);
  });

  it('ignores ?mcq blocks without a correct option', () => {
    const md = '?mcq\nPrompt?\n- [ ] A\n- [ ] B';
    expect(parseNoteCards(md)).toEqual([]);
  });

  it('renders cloze segments hiding only the active group', () => {
    const segments = clozeDisplaySegments('{{a}} and {{b}}', '#2');
    expect(segments).toEqual([
      { type: 'blank', answer: 'a', hint: undefined, hidden: false },
      { type: 'text', value: ' and ' },
      { type: 'blank', answer: 'b', hint: undefined, hidden: true },
    ]);
  });
});

describe('card ids', () => {
  it('are stable across whitespace/case edits and unique for duplicates', () => {
    const a = cardsFromNote('n.md', 'Q  one :: A');
    const b = cardsFromNote('other.md', 'q one :: different answer');
    expect(a[0].id).toBe(b[0].id);
    const dup = cardsFromNote('n.md', 'Q :: A\nQ :: A');
    expect(dup[0].id).not.toBe(dup[1].id);
  });
});

describe('cardsFromQuiz', () => {
  it('turns quiz questions into cards with their heading lines', () => {
    const md = [
      '---',
      'title: Quiz Nets',
      '---',
      '## Q1 · mcq',
      'Which layer is TCP?',
      '- [ ] Network',
      '- [x] Transport',
      '',
      '## Q2 · cloze',
      'TCP uses a {{three}}-way {{handshake}}.',
      '',
      '## Q3 · open',
      'Why use UDP?',
      '### Answer',
      'Low latency.',
    ].join('\n');
    const cards = cardsFromQuiz('Quiz Nets.md', md);
    expect(cards.map((c) => [c.kind, c.source.line, c.source.origin])).toEqual([
      ['mcq', 3, 'quiz'],
      ['cloze', 8, 'quiz'],
      ['basic', 11, 'quiz'],
    ]);
    const cloze = cards[1];
    expect(cloze.kind === 'cloze' && parseClozeBlanks(cloze.text).every((b) => b.group === '1')).toBe(true);
  });

  it('hides a quiz blank that is wrapped in inline code', () => {
    const md = [
      '## Q1 · cloze',
      'In `[x for x in xs if c]`, the filter is the `{{if condition}}` clause.',
    ].join('\n');
    const [card] = cardsFromQuiz('Quiz Lists.md', md);
    expect(card.kind === 'cloze' && clozeDisplaySegments(card.text, card.group)).toEqual([
      { type: 'text', value: 'In `[x for x in xs if c]`, the filter is the ' },
      { type: 'blank', answer: '`if condition`', hint: undefined, hidden: true },
      { type: 'text', value: ' clause.' },
    ]);
  });
});
