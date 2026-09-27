import { cardFingerprint, similarity } from './cardId';
import type { ReviewCard, StoredCard } from './types';

/** Same note: a reworded card keeps its history if it still mostly matches. */
const SAME_NOTE_MIN = 0.5;
/** Different note (moved card, renamed note): only near-identical text. */
const OTHER_NOTE_MIN = 0.9;

export type Migration = { from: string; to: string };

/**
 * Card ids come from card text, so editing a card gives it a new id. Pair each
 * card that has no history with a vanished card (an "orphan") of the same kind
 * whose text is similar, and hand the history over. Best matches win first.
 */
export function planMigrations(cards: ReviewCard[], stored: Record<string, StoredCard>): Migration[] {
  const present = new Set(cards.map((card) => card.id));
  const orphans = Object.entries(stored).filter(([id, entry]) => !present.has(id) && entry.sched);
  if (orphans.length === 0) return [];
  const newcomers = cards.filter((card) => !stored[card.id]);
  if (newcomers.length === 0) return [];

  const pairs: Array<{ score: number; from: string; to: string }> = [];
  for (const card of newcomers) {
    const fp = cardFingerprint(card);
    for (const [id, entry] of orphans) {
      if (entry.kind !== card.kind) continue;
      const sameNote = entry.path === card.source.path;
      const score = similarity(entry.fp, fp);
      if (score >= (sameNote ? SAME_NOTE_MIN : OTHER_NOTE_MIN)) {
        pairs.push({ score: score + (sameNote ? 1 : 0), from: id, to: card.id });
      }
    }
  }
  pairs.sort((a, b) => b.score - a.score);

  const usedFrom = new Set<string>();
  const usedTo = new Set<string>();
  const migrations: Migration[] = [];
  for (const pair of pairs) {
    if (usedFrom.has(pair.from) || usedTo.has(pair.to)) continue;
    usedFrom.add(pair.from);
    usedTo.add(pair.to);
    migrations.push({ from: pair.from, to: pair.to });
  }
  return migrations;
}
