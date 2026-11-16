/**
 * On-disk layout of app-made (linked) cards (format v2).
 *
 *   .vault/cards-v2-manifest.json     { version: 2, shards, migratedAt? }
 *   .vault/cards-v2-shard-00.json     { version: 2, shard: 0, cards: [{ seq, card }] }
 *   ...
 *   .vault/cards-v2-shard-63.json
 *
 * Cards are spread over CARDS_SHARD_COUNT files by a stable hash of their
 * `uid`, so no single file grows with the number of cards and a change
 * rewrites only the shards holding the cards it touched. `seq` records
 * creation order (the order of the v1 array), which `all()` restores on load.
 *
 * Names are flat for the same reason as the review-state shards: the desktop
 * data IPC only accepts files directly inside `.vault/`
 * (`^\.vault\/[\w.-]+\.(json|jsonl)$` in electron/main.cjs).
 *
 * Why 64 shards: on the web each data file is one Firestore document, rejected
 * above 900 KB. A linked card holds its full content (front/back, cloze text,
 * MCQ options): ~0.3–1.5 KB as compact JSON. Planning for 20k cards at the
 * 1.5 KB high end is 30 MB in total. 32 shards would average ~625 cards,
 * ~940 KB: over the limit. 64 shards average ~313 cards (binomial σ ≈ 18), so
 * even a +4σ shard is ~330 cards ≈ 500 KB, leaving headroom for unusually long
 * cards. Each load reads 65 files; a save writes one shard per touched card
 * (usually one), plus the manifest only when `migratedAt` changes.
 *
 * The manifest records the count a vault was written with and the store keeps
 * using it, so changing CARDS_SHARD_COUNT only affects new vaults.
 */
import { hashCardId } from './srsShards';

export const CARDS_SHARD_COUNT = 64;
export const CARDS_MANIFEST_FILE = '.vault/cards-v2-manifest.json';
/** Format v1: every card in one file. Migrated to v2 on first load. */
export const CARDS_LEGACY_FILE = '.vault/cards.json';

export function cardsShardFile(index: number): string {
  return `.vault/cards-v2-shard-${String(index).padStart(2, '0')}.json`;
}

/** Which shard a card lives in. Uses the same (never-changing) FNV-1a hash as review state. */
export function cardShardOf(uid: string, count = CARDS_SHARD_COUNT): number {
  return hashCardId(uid) % count;
}
