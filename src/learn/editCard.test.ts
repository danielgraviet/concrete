import { describe, expect, it } from 'vitest';
import type { QuizQuestion } from '../quiz/types';
import { cardsFromNote, cardsFromQuiz } from './buildCards';
import { applyCardEdit, quizQuestionForCard } from './editCard';
import { parseNoteCards } from './parseNoteCards';
import { ReviewSession } from './ReviewSession';
import { ReviewStateStore } from './ReviewStateStore';
import { Scheduler } from './scheduler';
import type { ReviewCard } from './types';

const PATH = 'Bio.md';

function cardAt(markdown: string, index: number): ReviewCard {
  return cardsFromNote(PATH, markdown)[index];
}

function edited(result: ReturnType<typeof applyCardEdit>) {
  if (!result.ok) throw new Error(result.error);
  return result;
}

describe('applyCardEdit', () => {
  it('shortens an inline answer in place, keeping the list marker and the id', () => {
    const md = '# Cells\n\n- What makes ATP? :: The mitochondria, via a long and winding explanation\nNext line';
    const result = edited(applyCardEdit(md, cardAt(md, 0), { kind: 'basic', front: 'What makes ATP?', back: 'Mitochondria' }));
    expect(result.markdown).toBe('# Cells\n\n- What makes ATP? :: Mitochondria\nNext line');
    expect(result.card.id).toBe(cardAt(md, 0).id);
  });

  it('moves history to the new id when the front changes', () => {
    const md = 'Old question :: Answer';
    const card = cardAt(md, 0);
    const result = edited(applyCardEdit(md, card, { kind: 'basic', front: 'A completely different prompt', back: 'Answer' }));
    expect(result.card.id).not.toBe(card.id);
    expect(result.migrations).toEqual([{ from: card.id, to: result.card.id }]);
  });

  it('turns an inline card into a multi-line card when the answer gets a line break', () => {
    const md = 'Intro\n\nQ :: A\n\nOutro';
    const result = edited(applyCardEdit(md, cardAt(md, 0), { kind: 'basic', front: 'Q', back: 'Line one\nLine two' }));
    expect(result.markdown).toBe('Intro\n\nQ\n?\nLine one\nLine two\n\nOutro');
    expect(parseNoteCards(result.markdown)).toEqual([{ kind: 'basic', front: 'Q', back: 'Line one\nLine two', line: 2 }]);
  });

  it('rewrites a multi-line card, including a trailing code block', () => {
    const md = ['What prints?', '?', 'A long answer', '', '```py', 'print(1)', '```', '', 'After'].join('\n');
    const result = edited(applyCardEdit(md, cardAt(md, 0), { kind: 'basic', front: 'What prints?', back: '1' }));
    expect(result.markdown).toBe('What prints?\n?\n1\n\nAfter');
  });

  it('edits the reverse of a paired card, writing it back the right way round', () => {
    const md = 'Mitochondria ::: Powerhouse of the cell, which is a phrase everyone knows';
    const reverse = cardAt(md, 1);
    const forward = cardAt(md, 0);
    const result = edited(applyCardEdit(md, reverse, { kind: 'basic', front: 'Powerhouse', back: 'Mitochondria' }));
    expect(result.markdown).toBe('Mitochondria ::: Powerhouse');
    // The forward card's id is its front, which didn't change.
    expect(result.migrations).toContainEqual({ from: forward.id, to: forward.id });
    expect(result.migrations).toContainEqual({ from: reverse.id, to: result.card.id });
  });

  it('edits cloze text, keeping each group with its history', () => {
    const md = 'The {{c1::mitochondria, an organelle}} makes {{c2::ATP}}.';
    const [first, second] = cardsFromNote(PATH, md);
    const result = edited(applyCardEdit(md, second, { kind: 'cloze', text: 'The {{c1::mitochondria}} makes {{c2::ATP}}.' }));
    const after = cardsFromNote(PATH, result.markdown);
    expect(result.migrations).toEqual([
      { from: first.id, to: after[0].id },
      { from: second.id, to: after[1].id },
    ]);
    expect(result.card.id).toBe(after[1].id);
  });

  it('refuses edits that would not parse back as the same card', () => {
    const md = 'Q :: A';
    const card = cardAt(md, 0);
    expect(applyCardEdit(md, card, { kind: 'basic', front: 'Q', back: 'para one\n\npara two' }).ok).toBe(false);
    expect(applyCardEdit(md, card, { kind: 'basic', front: 'Q', back: '  ' }).ok).toBe(false);
    expect(applyCardEdit('Reworded in the note :: A', card, { kind: 'basic', front: 'Q', back: 'B' }).ok).toBe(false);
  });

  it('refuses a cloze edit that drops every blank', () => {
    const md = 'The {{answer}} here.';
    expect(applyCardEdit(md, cardAt(md, 0), { kind: 'cloze', text: 'No blanks now.' }).ok).toBe(false);
  });
});

describe('rekeying history after an edit', () => {
  it('keeps the schedule and the queue position under the new id', () => {
    const md = 'First question :: One\nSecond question :: Two';
    const cards = cardsFromNote(PATH, md);
    const store = new ReviewStateStore('');
    const scheduler = new Scheduler();
    const now = Date.UTC(2026, 0, 1, 12);
    store.review(cards[1], 'good', now - 86_400_000 * 10, scheduler);
    const before = store.get(cards[1].id)!.sched;

    const result = edited(applyCardEdit(md, cards[1], { kind: 'basic', front: 'Second question, reworded', back: 'Two' }));
    const next = cardsFromNote(PATH, result.markdown);
    const session = new ReviewSession(cards, store, scheduler, { retention: 0.9, newPerDay: 20, maxReviewsPerDay: 200, typeCloze: false }, now);
    store.rekey(result.migrations, next);
    session.rekey(result.migrations, next);

    expect(store.get(cards[1].id)).toBeUndefined();
    expect(store.get(result.card.id)?.sched).toEqual(before);
    expect(store.get(result.card.id)?.fp).toBe('b|second question, reworded');
    expect(session.queueOf(result.card.id)).toBe('learning');
    expect(session.current(now)).toMatchObject({ id: result.card.id, front: 'Second question, reworded' });
  });
});

describe('editing quiz cards', () => {
  const quiz = [
    '---',
    'type: quiz',
    'rubric: "Score it."',
    '---',
    '',
    '# RL',
    '',
    '## Q1 · open',
    '',
    'Why bound a replay buffer?',
    '',
    '### Answer',
    '',
    'A very long answer that goes on about memory, staleness and sampling cost at length.',
    '',
    '### Key points',
    '',
    '- Unbounded memory growth',
    '- Stale experiences',
    '',
    '## Q2 · code',
    '',
    'kind: scale',
    '',
    'What happens after millions of steps?',
    '',
    '```python',
    'replay_buffer = []',
    '```',
    '',
    '### Answer',
    '',
    'Memory grows without bound and old experience goes stale, so a long explanation follows.',
    '',
    '## Q3 · mcq',
    '',
    'Pick one',
    '',
    '- [x] Right',
    '- [ ] Wrong',
    '',
  ].join('\n');
  const QUIZ = 'Quiz RL.md';

  it('shortens a code question answer, rewriting only that section and keeping the id', () => {
    const cards = cardsFromQuiz(QUIZ, quiz);
    const found = quizQuestionForCard(quiz, cards[1])!;
    expect(found.question.type).toBe('code');
    const question = { ...found.question, expected: 'Memory grows without bound; use a deque(maxlen=…).' } as QuizQuestion;
    const result = edited(applyCardEdit(quiz, cards[1], { kind: 'quiz', question }));
    expect(result.card.id).toBe(cards[1].id);
    expect(result.markdown).toContain('### Answer\n\nMemory grows without bound; use a deque(maxlen=…).\n\n## Q3 · mcq');
    // Other questions are untouched.
    expect(result.markdown.split('## Q2')[0]).toBe(quiz.split('## Q2')[0]);
    expect(result.markdown.split('## Q3')[1]).toBe(quiz.split('## Q3')[1]);
    expect(cardsFromQuiz(QUIZ, result.markdown).map((c) => c.id)).toEqual(cards.map((c) => c.id));
  });

  it('moves history when an open question’s prompt changes, and trims key points', () => {
    const cards = cardsFromQuiz(QUIZ, quiz);
    const { question } = quizQuestionForCard(quiz, cards[0])!;
    if (question.type !== 'open') throw new Error('expected open');
    const result = edited(
      applyCardEdit(quiz, cards[0], {
        kind: 'quiz',
        question: { ...question, prompt: 'Why should a replay buffer be bounded?', answer: 'Memory and staleness.', keyPoints: ['Memory', ' '] },
      }),
    );
    expect(result.migrations[0]).toEqual({ from: cards[0].id, to: result.card.id });
    expect(result.card.id).not.toBe(cards[0].id);
    expect(result.card).toMatchObject({ kind: 'basic', back: 'Memory and staleness.\n\n- Memory' });
  });

  it('refuses an mcq with no correct option', () => {
    const cards = cardsFromQuiz(QUIZ, quiz);
    const { question } = quizQuestionForCard(quiz, cards[2])!;
    if (question.type !== 'mcq') throw new Error('expected mcq');
    const result = applyCardEdit(quiz, cards[2], {
      kind: 'quiz',
      question: { ...question, options: question.options.map((o) => ({ ...o, correct: false })) },
    });
    expect(result.ok).toBe(false);
  });
});
