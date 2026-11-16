import { describe, expect, it, vi } from 'vitest';
import { ReviewStateStore, type ReviewDataAdapter } from './ReviewStateStore';
import { Scheduler } from './scheduler';
import { hashCardId, LEGACY_FILE, LOG_FILE, MANIFEST_FILE, SHARD_COUNT, shardFile, shardOf } from './srsShards';
import type { BasicCard, SrsFile, StoredCard } from './types';

const T0 = new Date(2026, 0, 5, 12).getTime();
const LIMIT = 900_000;
const scheduler = new Scheduler(0.9);

function memoryAdapter(initial: Record<string, string> = {}, { canRemove = true } = {}) {
  const files = new Map(Object.entries(initial));
  const adapter = {
    read: vi.fn(async (name: string) => files.get(name) ?? null),
    write: vi.fn(async (name: string, content: string) => {
      files.set(name, content);
    }),
    append: vi.fn(async (name: string, line: string) => {
      files.set(name, (files.get(name) ?? '') + line);
    }),
    ...(canRemove
      ? {
          remove: vi.fn(async (name: string) => {
            files.delete(name);
          }),
        }
      : {}),
  } satisfies ReviewDataAdapter;
  return { files, adapter };
}

function card(n: number, path = 'Notes/Deck.md'): BasicCard {
  return { kind: 'basic', id: `card${n}`, front: `Front ${n}`, back: `Back ${n}`, source: { path, line: n, origin: 'note' } };
}

function bytes(text: string): number {
  return new TextEncoder().encode(text).length;
}

/** A realistic v1 entry: reviewed card with a long-ish path and fingerprint. */
function storedCard(n: number, fpLength = 120): StoredCard {
  return {
    path: `Courses/Statistics/Unit ${n % 12}/Lesson ${n % 40} - Probability rules.md`,
    kind: 'basic',
    fp: `b|${`question ${n} about conditional probability and independence `.repeat(8).slice(0, fpLength)}`,
    sched: {
      due: T0 + n * 3_600_000,
      stability: 12.3456789,
      difficulty: 5.4321987,
      elapsed_days: 7,
      scheduled_days: 14,
      learning_steps: 0,
      reps: 9,
      lapses: 1,
      state: 2,
      last_review: T0 - 86_400_000,
    },
  };
}

function legacyFile(count: number, fpLength?: number): SrsFile {
  const cards: SrsFile['cards'] = {};
  for (let i = 0; i < count; i += 1) cards[`id${i.toString(36)}x${(i * 2654435761) >>> 0}`] = storedCard(i, fpLength);
  return {
    version: 1,
    cards,
    days: { '2026-01-04': { newSeen: 3, reviews: 40, again: 2 } },
    quizzes: { 'Quiz A.md': { enabled: true } },
    quizSyncAt: 1234,
  };
}

async function save(store: ReviewStateStore): Promise<void> {
  store.flush();
  await store.whenSaved();
}

describe('card id hashing', () => {
  it('is stable across runs (values must never change)', () => {
    expect(hashCardId('')).toBe(0x811c9dc5);
    expect(hashCardId('a')).toBe(0xe40c292c);
    expect(hashCardId('foobar')).toBe(0xbf9cf968);
    expect(shardOf('foobar')).toBe(0xbf9cf968 % SHARD_COUNT);
    expect(shardFile(3)).toBe('.vault/srs-v2-shard-03.json');
  });

  it('spreads ids roughly evenly', () => {
    const counts = new Array<number>(SHARD_COUNT).fill(0);
    for (let i = 0; i < 64_000; i += 1) counts[shardOf(`k${i.toString(36)}`)] += 1;
    for (const c of counts) expect(Math.abs(c - 1000)).toBeLessThan(150);
  });

  it('only uses file names the desktop data IPC accepts', () => {
    const allowed = /^\.vault\/[\w.-]+\.(?:json|jsonl)$/;
    for (const name of [MANIFEST_FILE, LEGACY_FILE, LOG_FILE, shardFile(0), shardFile(SHARD_COUNT - 1)]) expect(name).toMatch(allowed);
  });
});

describe('ReviewStateStore storage (v2 shards)', () => {
  it('round-trips cards, day stats and quiz state', async () => {
    const { adapter, files } = memoryAdapter();
    const store = new ReviewStateStore('/vault', adapter);
    await store.load();
    for (let i = 0; i < 50; i += 1) store.review(card(i), i % 3 === 0 ? 'again' : 'good', T0, scheduler);
    store.setQuizEnabled('Quiz B.md', true);
    store.enroll([], T0, 999);
    await save(store);

    expect(files.has(MANIFEST_FILE)).toBe(true);
    expect(files.has(LEGACY_FILE)).toBe(false);
    expect(files.get(LOG_FILE)?.trim().split('\n')).toHaveLength(50);

    const reloaded = new ReviewStateStore('/vault', adapter);
    await reloaded.load();
    expect(JSON.parse(reloaded.snapshot())).toEqual(JSON.parse(store.snapshot()));
    expect(reloaded.today(T0)).toEqual({ newSeen: 50, reviews: 50, again: 17 });
    expect(reloaded.isQuizEnabled('Quiz B.md')).toBe(true);
    expect(reloaded.quizSyncAt).toBe(999);
    expect(reloaded.get('card7')?.sched).toEqual(store.get('card7')?.sched);
  });

  it('writes only the dirty shard (plus the manifest when global fields change)', async () => {
    const { adapter } = memoryAdapter();
    const store = new ReviewStateStore('/vault', adapter);
    await store.load();
    for (let i = 0; i < 200; i += 1) store.review(card(i), 'good', T0, scheduler);
    await save(store);
    adapter.write.mockClear();

    store.review(card(5), 'good', T0 + 60_000, scheduler);
    await save(store);
    expect(adapter.write.mock.calls.map(([name]) => name)).toEqual([shardFile(shardOf('card5')), MANIFEST_FILE]);

    // A card-only change (reset) leaves the manifest alone.
    adapter.write.mockClear();
    store.reset('card9');
    await save(store);
    expect(adapter.write.mock.calls.map(([name]) => name)).toEqual([shardFile(shardOf('card9'))]);

    // A global-only change writes just the manifest.
    adapter.write.mockClear();
    store.setQuizEnabled('Quiz C.md', true);
    await save(store);
    expect(adapter.write.mock.calls.map(([name]) => name)).toEqual([MANIFEST_FILE]);

    // Nothing changed: nothing written.
    adapter.write.mockClear();
    store.reconcile(Array.from({ length: 200 }, (_, i) => card(i)).filter((c) => c.id !== 'card9'), T0);
    await save(store);
    expect(adapter.write).not.toHaveBeenCalled();
  });

  it('keeps the debounce: many quick reviews become one save', async () => {
    vi.useFakeTimers();
    try {
      const { adapter } = memoryAdapter();
      const store = new ReviewStateStore('/vault', adapter);
      await store.load();
      store.review(card(1), 'good', T0, scheduler);
      store.review(card(2), 'good', T0, scheduler);
      expect(adapter.write).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(450);
      await store.whenSaved();
      const names = adapter.write.mock.calls.map(([name]) => name);
      expect(names.filter((n) => n === MANIFEST_FILE)).toHaveLength(1);
      expect(names.at(-1)).toBe(MANIFEST_FILE);
    } finally {
      vi.useRealTimers();
    }
  });

  it('migrates a legacy srs.json: all shards, then the manifest, then deletes the legacy file', async () => {
    const legacy = legacyFile(500);
    const { adapter, files } = memoryAdapter({ [LEGACY_FILE]: JSON.stringify(legacy) });
    const store = new ReviewStateStore('/vault', adapter);
    await store.load();

    const names = adapter.write.mock.calls.map(([name]) => name);
    expect(names).toHaveLength(SHARD_COUNT + 1);
    expect(names.at(-1)).toBe(MANIFEST_FILE);
    expect(new Set(names.slice(0, -1))).toEqual(new Set(Array.from({ length: SHARD_COUNT }, (_, i) => shardFile(i))));
    expect(adapter.remove).toHaveBeenCalledWith(LEGACY_FILE);
    expect(files.has(LEGACY_FILE)).toBe(false);
    expect(JSON.parse(store.snapshot())).toEqual(legacy);

    const reloaded = new ReviewStateStore('/vault', adapter);
    await reloaded.load();
    expect(JSON.parse(reloaded.snapshot())).toEqual(legacy);
  });

  it('retries cleanly after a crash between the shards and the manifest', async () => {
    const legacy = legacyFile(300);
    const { adapter, files } = memoryAdapter({ [LEGACY_FILE]: JSON.stringify(legacy) });
    // Pre-existing stale shard from some earlier interrupted attempt.
    files.set(shardFile(0), JSON.stringify({ version: 2, shard: 0, cards: { ghost: storedCard(1) } }));

    // "Crash": the manifest write never completes.
    adapter.write.mockImplementation(async (name, content) => {
      if (name === MANIFEST_FILE) throw new Error('process killed');
      files.set(name, content);
    });
    const crashed = new ReviewStateStore('/vault', adapter);
    await crashed.load();
    expect(files.has(MANIFEST_FILE)).toBe(false);
    expect(files.has(LEGACY_FILE)).toBe(true);
    expect(adapter.remove).not.toHaveBeenCalled();

    // Next launch: v2 is still absent, so it migrates again from the legacy file.
    adapter.write.mockReset().mockImplementation(async (name, content) => {
      files.set(name, content);
    });
    const store = new ReviewStateStore('/vault', adapter);
    await store.load();
    expect(files.has(MANIFEST_FILE)).toBe(true);
    expect(files.has(LEGACY_FILE)).toBe(false);
    expect(JSON.parse(store.snapshot())).toEqual(legacy);
    expect(store.get('ghost')).toBeUndefined();

    const reloaded = new ReviewStateStore('/vault', adapter);
    await reloaded.load();
    expect(JSON.parse(reloaded.snapshot())).toEqual(legacy);
  });

  it('finishes a failed migration on the next save in the same session', async () => {
    const legacy = legacyFile(40);
    const { adapter, files } = memoryAdapter({ [LEGACY_FILE]: JSON.stringify(legacy) });
    let failManifest = true;
    adapter.write.mockImplementation(async (name, content) => {
      if (name === MANIFEST_FILE && failManifest) throw new Error('offline');
      files.set(name, content);
    });
    const store = new ReviewStateStore('/vault', adapter);
    await store.load();
    expect(files.has(LEGACY_FILE)).toBe(true);

    failManifest = false;
    store.review(card(1), 'good', T0, scheduler);
    await save(store);
    expect(files.has(MANIFEST_FILE)).toBe(true);
    expect(files.has(LEGACY_FILE)).toBe(false);

    const reloaded = new ReviewStateStore('/vault', adapter);
    await reloaded.load();
    expect(Object.keys(JSON.parse(reloaded.snapshot()).cards)).toHaveLength(41);
  });

  it('leaves the legacy file in place when the backend cannot delete', async () => {
    const legacy = legacyFile(10);
    const { adapter, files } = memoryAdapter({ [LEGACY_FILE]: JSON.stringify(legacy) }, { canRemove: false });
    const store = new ReviewStateStore('/vault', adapter);
    await store.load();
    expect(files.has(MANIFEST_FILE)).toBe(true);
    expect(files.has(LEGACY_FILE)).toBe(true);

    // The manifest wins on the next load; the stale legacy file is ignored.
    store.reset(Object.keys(legacy.cards)[0]);
    await save(store);
    const reloaded = new ReviewStateStore('/vault', adapter);
    await reloaded.load();
    expect(Object.keys(JSON.parse(reloaded.snapshot()).cards)).toHaveLength(9);
  });

  it('never writes when storage cannot be read', async () => {
    const { adapter, files } = memoryAdapter({ [LEGACY_FILE]: JSON.stringify(legacyFile(5)) });
    adapter.read.mockRejectedValueOnce(new Error('EIO'));
    const store = new ReviewStateStore('/vault', adapter);
    await store.load();
    store.review(card(1), 'good', T0, scheduler);
    await save(store);
    expect(adapter.write).not.toHaveBeenCalled();
    expect(files.has(LEGACY_FILE)).toBe(true);
  });

  it('does not overwrite a shard that failed to read', async () => {
    const { adapter, files } = memoryAdapter();
    const store = new ReviewStateStore('/vault', adapter);
    await store.load();
    store.review(card(1), 'good', T0, scheduler);
    await save(store);
    const shard = shardFile(shardOf('card1'));
    const before = files.get(shard);

    adapter.read.mockImplementation(async (name) => {
      if (name === shard) throw new Error('EIO');
      return files.get(name) ?? null;
    });
    const reloaded = new ReviewStateStore('/vault', adapter);
    await reloaded.load();
    adapter.write.mockClear();
    reloaded.review(card(1), 'again', T0 + 60_000, scheduler);
    await save(reloaded);
    expect(adapter.write.mock.calls.map(([name]) => name)).toEqual([MANIFEST_FILE]);
    expect(files.get(shard)).toBe(before);
  });

  it('keeps every shard under the 900 KB document limit for large vaults', async () => {
    for (const [count, fpLength] of [
      [20_000, 120],
      [50_000, 300],
    ] as const) {
      const legacy = legacyFile(count, fpLength);
      const legacyText = JSON.stringify(legacy);
      const { adapter, files } = memoryAdapter({ [LEGACY_FILE]: legacyText });
      const store = new ReviewStateStore('/vault', adapter);
      await store.load();

      const sizes = Array.from({ length: SHARD_COUNT }, (_, i) => bytes(files.get(shardFile(i)) ?? ''));
      const max = Math.max(...sizes);
      expect(max).toBeLessThan(LIMIT);
      expect(bytes(files.get(MANIFEST_FILE) ?? '')).toBeLessThan(LIMIT);
      // Sanity: the old single file would have blown the limit.
      expect(bytes(legacyText)).toBeGreaterThan(LIMIT);
      if (count === 50_000) expect(max).toBeLessThan(LIMIT * 0.6);
      expect(Object.keys(JSON.parse(store.snapshot()).cards)).toHaveLength(count);
    }
  });
});
