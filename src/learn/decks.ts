import type { ReviewCard } from './types';

/** A deck is a filter over the vault's cards — no deck files to maintain. */
export type Deck =
  | { kind: 'all'; label: string }
  | { kind: 'folder'; label: string; folder: string }
  | { kind: 'note'; label: string; path: string };

export const ALL_DECK: Deck = { kind: 'all', label: 'All cards' };

export function deckKey(deck: Deck): string {
  switch (deck.kind) {
    case 'all':
      return 'all';
    case 'folder':
      return `folder:${deck.folder}`;
    case 'note':
      return `note:${deck.path}`;
  }
}

export function deckFilter(deck: Deck): (card: ReviewCard) => boolean {
  switch (deck.kind) {
    case 'all':
      return () => true;
    case 'folder':
      return (card) => card.source.path.startsWith(`${deck.folder}/`);
    case 'note':
      return (card) => card.source.path === deck.path;
  }
}

/** Folder decks that contain at least one card. */
export function listDecks(cards: ReviewCard[]): Deck[] {
  const folders = new Set<string>();
  for (const card of cards) {
    const parts = card.source.path.split('/');
    for (let depth = 1; depth < parts.length; depth += 1) folders.add(parts.slice(0, depth).join('/'));
  }
  return [
    ...[...folders].sort().map((folder): Deck => ({ kind: 'folder', label: folder, folder })),
  ];
}
