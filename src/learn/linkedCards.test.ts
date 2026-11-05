import { describe, expect, it } from 'vitest';
import { cardsFromNote, draftsFromLinkedCards, withIds } from './buildCards';
import { CardIndex } from './CardIndex';
import { linkedCardEdit } from './editCard';
import type { LinkedCard, LinkedCardInput } from './LinkedCards';
import { extractFlashcardSection, planNoteMigration } from './migrateFlashcards';

const PATH = 'Stats/U7-P2.md';

const NOTE = `# Probability

Body text {{not}} in the section.

## Flashcards

{{Standard error}} decreases as sample size grows

What is the multiplication rule, and how can you tell whether two events are independent? :: General rule (always valid when $P(A)>0$):

$$P(A\\text{ and }B)=P(A)\\times P(B\\mid A)$$

If A and B are independent:

$$P(B\\mid A)=P(B)$$

Key intuition: Independence means knowing A happened does not change the probability of B.

Two events, A and B, each have probability 0.30 and are mutually exclusive. What is:
$P(A\\mid B)?$ :: 0! if B happens, A cannot happen.

?mcq
A cloud provider charges according to:

$$f(X)=X^2$$

What is $E[f(X)]$?

* [ ] 25
* [x] 34

Term ::: Definition

# Exam Traps

1. Importance is not effect size.
`;

const linked = (card: LinkedCardInput, uid = 'u1'): LinkedCard =>
  ({ ...card, uid, path: PATH, created: 0 }) as LinkedCard;

describe('extractFlashcardSection', () => {
  const section = extractFlashcardSection(NOTE)!;

  it('keeps multi-paragraph answers with math intact', () => {
    const rule = section.cards[1].input;
    expect(rule).toMatchObject({ kind: 'basic', front: 'What is the multiplication rule, and how can you tell whether two events are independent?' });
    expect(rule.kind === 'basic' && rule.back).toBe(
      'General rule (always valid when $P(A)>0$):\n\n$$P(A\\text{ and }B)=P(A)\\times P(B\\mid A)$$\n\nIf A and B are independent:\n\n$$P(B\\mid A)=P(B)$$\n\nKey intuition: Independence means knowing A happened does not change the probability of B.',
    );
  });

  it('keeps a multi-line front, multi-paragraph MCQ prompts and two-way cards', () => {
    expect(section.cards.map((card) => card.input.kind)).toEqual(['cloze', 'basic', 'basic', 'mcq', 'basic']);
    expect(section.cards[2].input).toMatchObject({ front: 'Two events, A and B, each have probability 0.30 and are mutually exclusive. What is:\n$P(A\\mid B)?$' });
    expect(section.cards[3].input).toMatchObject({
      kind: 'mcq',
      prompt: 'A cloud provider charges according to:\n\n$$f(X)=X^2$$\n\nWhat is $E[f(X)]$?',
      options: [{ text: '25', correct: false }, { text: '34', correct: true }],
    });
    expect(section.cards[4].input).toEqual({ kind: 'basic', front: 'Term', back: 'Definition', reverse: true });
  });

  it('removes only the section from the note', () => {
    expect(section.markdown).toBe('# Probability\n\nBody text {{not}} in the section.\n\n# Exam Traps\n\n1. Importance is not effect size.\n');
  });

  it('ignores notes without a section', () => {
    expect(extractFlashcardSection('# Note\n\nQ :: A\n')).toBeNull();
  });
});

describe('planNoteMigration', () => {
  it('pairs every old card with the card that replaces it', () => {
    const plan = planNoteMigration(PATH, NOTE, [])!;
    expect(plan.problem).toBeNull();
    expect(plan.unpaired).toEqual([]);
    const before = cardsFromNote(PATH, NOTE);
    expect(plan.before.map((c) => c.id)).toEqual(before.map((c) => c.id));
    // Every old card is carried over; unchanged fronts keep their id.
    expect(plan.pairs).toHaveLength(before.length);
    for (const [b, a] of plan.pairs) {
      const old = plan.before[b];
      const next = plan.after[a];
      expect(next.kind).toBe(old.kind);
      if (old.kind === 'basic' && old.front.startsWith('What is the multiplication')) expect(next.id).toBe(old.id);
    }
    // The MCQ was never read as a card before (blank line before its options); now it is.
    expect(plan.after.filter((c) => c.kind === 'mcq')).toHaveLength(1);
  });
});

describe('linked cards in the index', () => {
  it('come after note cards and get the same ids as identical note cards', () => {
    const index = new CardIndex();
    index.replaceAll([[PATH, 'Q :: A']]);
    index.setLinked([linked({ kind: 'basic', front: 'Front', back: 'Line one\n\n$$x^2$$' })]);
    const cards = index.note(PATH)!.cards;
    expect(cards.map((c) => c.source.origin)).toEqual(['note', 'linked']);
    expect(cards[1]).toMatchObject({ kind: 'basic', back: 'Line one\n\n$$x^2$$' });
    expect(cards[1].id).toBe(cardsFromNote(PATH, 'Front :: whatever')[0].id);
  });

  it('survive the note being re-read or removed', () => {
    const index = new CardIndex();
    index.setLinked([linked({ kind: 'cloze', text: '{{a}} and {{b}}' })]);
    index.replaceAll([[PATH, '# Empty']]);
    expect(index.note(PATH)!.cards).toHaveLength(2);
    index.retain([]);
    expect(index.all()).toHaveLength(2);
  });

  it('edits a reversed card the right way round', () => {
    const stored = linked({ kind: 'basic', front: 'Term', back: 'Definition', reverse: true });
    const [, reverse] = withIds(draftsFromLinkedCards([stored]));
    const result = linkedCardEdit(reverse, stored, { kind: 'basic', front: 'Definition 2', back: 'Term' });
    expect(result).toEqual({ ok: true, input: { kind: 'basic', front: 'Term', back: 'Definition 2', reverse: true } });
  });
});
