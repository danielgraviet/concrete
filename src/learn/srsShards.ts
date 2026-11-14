/**
 * On-disk layout of review state (format v2).
 *
 *   .vault/srs-v2-manifest.json     { version: 2, shards, days, quizzes, quizSyncAt }
 *   .vault/srs-v2-shard-00.json     { version: 2, shard: 0, cards: { [id]: StoredCard } }
 *   ...
 *   .vault/srs-v2-shard-63.json
 *
 * Card state is spread over SHARD_COUNT files by a stable hash of the card id,
 * so no single file grows with the size of the vault and a save rewrites only
 * the shards whose cards changed (plus the manifest when global fields did).
 *
 * The names are flat (no `srs/v2/` folder) because the desktop `readData`/
 * `writeData` IPC only accepts files directly inside `.vault/`
 * (`^\.vault\/[\w.-]+\.(json|jsonl)$` in electron/main.cjs).
 *
 * Why 64 shards: the web version stores each data file as one Firestore
 * document, rejected above 900 KB. A stored card is its id (~11 chars), note
 * path, fingerprint (the normalized front/cloze text) and FSRS state: about
 * 250–350 bytes typically, ~600 bytes for long cloze paragraphs. At 50k cards,
 * 64 shards hold ~780 cards each on average (hash spread adds a few percent:
 * the binomial σ is ~28 cards), i.e. ~270 KB typical and ~500 KB even if every
 * card were a long one, comfortably under 900 KB. 32 shards would put a
 * long-card 50k vault at ~950 KB, over the limit. More shards cost one extra
 * read each when the store loads (65 reads per load at 64), which the 50k
 * reads/day free tier absorbs easily; writes per save don't depend on N.
 * The manifest holds the per-day stats (pruned to 400 days, ~25 KB) and quiz
 * toggles (one short entry per quiz file), both small.
 *
 * The manifest records the count a vault was written with and the store keeps
 * using it, so changing SHARD_COUNT only affects new vaults. (Re-sharding an
 * existing vault in place would need versioned file names to stay crash-safe.)
 */

export const SHARD_COUNT = 64;
export const MANIFEST_FILE = '.vault/srs-v2-manifest.json';
/** Format v1: everything in one file. Migrated to v2 on first load. */
export const LEGACY_FILE = '.vault/srs.json';
export const LOG_FILE = '.vault/srs-log.jsonl';

export function shardFile(index: number): string {
  return `.vault/srs-v2-shard-${String(index).padStart(2, '0')}.json`;
}

/**
 * 32-bit FNV-1a over the id's UTF-16 code units. Must never change: it
 * decides which file a card's history lives in.
 */
export function hashCardId(id: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < id.length; i += 1) {
    hash = Math.imul(hash ^ id.charCodeAt(i), 0x01000193);
  }
  return hash >>> 0;
}

export function shardOf(id: string, count = SHARD_COUNT): number {
  return hashCardId(id) % count;
}
