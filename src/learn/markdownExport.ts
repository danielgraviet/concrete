import type { Flashcard } from './types';

/**
 * Optional helper: export cards as Markdown with frontmatter (type: flashcard).
 * Not used for MVP persistence (cards live in .vault/cards.json / localStorage).
 */
export function cardsToMarkdown(cards: Flashcard[]): string {
  return cards
    .map((card) => {
      const tags =
        card.tags.length > 0
          ? `\ntags: [${card.tags.map((t) => JSON.stringify(t)).join(', ')}]`
          : '';
      return `---
type: flashcard
id: ${card.id}
notePath: ${JSON.stringify(card.notePath)}${tags}
createdAt: ${card.createdAt}
ease: ${card.scheduling.ease}
interval: ${card.scheduling.interval}
repetitions: ${card.scheduling.repetitions}
dueAt: ${card.scheduling.dueAt}
---

## Front

${card.front}

## Back

${card.back}
`;
    })
    .join('\n');
}
