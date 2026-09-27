import type { CardDraft, ReviewCard } from './types';

/** Lowercased, whitespace-collapsed text so formatting-only edits keep a card's id. */
export function normalizeCardText(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

/** 53-bit FNV-1a style hash → short base36 id. Deterministic across runs. */
export function hashText(text: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ code, 0x01000193);
    h2 = Math.imul(h2 ^ code, 0x5bd1e995);
  }
  const high = (h2 >>> 0) & 0x1fffff;
  return (high * 0x100000000 + (h1 >>> 0)).toString(36);
}

/** Text that identifies a card's content, used for ids and for re-attaching history. */
export function cardFingerprint(card: CardDraft | ReviewCard): string {
  switch (card.kind) {
    case 'basic':
      return `b|${normalizeCardText(card.front)}`;
    case 'cloze':
      return `c|${card.group}|${normalizeCardText(card.text)}`;
    case 'mcq':
      return `m|${normalizeCardText(card.question.prompt)}`;
  }
}

export function cardIdFor(fingerprint: string): string {
  return hashText(fingerprint);
}

function bigrams(text: string): Map<string, number> {
  const grams = new Map<string, number>();
  for (let i = 0; i < text.length - 1; i += 1) {
    const gram = text.slice(i, i + 2);
    grams.set(gram, (grams.get(gram) ?? 0) + 1);
  }
  return grams;
}

/** Sørensen–Dice similarity on character bigrams (0…1). */
export function similarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const left = bigrams(a);
  const right = bigrams(b);
  let overlap = 0;
  for (const [gram, count] of left) {
    overlap += Math.min(count, right.get(gram) ?? 0);
  }
  return (2 * overlap) / (a.length - 1 + b.length - 1);
}
