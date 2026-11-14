import { describe, expect, it, vi } from 'vitest';
import { CARDS_LEGACY_FILE, CARDS_MANIFEST_FILE, CARDS_SHARD_COUNT, cardShardOf, cardsShardFile } from './cardShards';
import { LinkedCardStore, type LinkedCardDataAdapter } from './LinkedCardStore';
import type { LinkedCard } from './LinkedCards';

const LIMIT = 900_000;
const IPC_NAME = /^\.vault\/[\w.-]+\.(?:json|jsonl)$/;

function memoryAdapter(initial: Record<string, string> = {}, { canRemove = true } = {}) {
  const files = new Map(Object.entries(initial));
  const adapter = {
    read: vi.fn(async (name: string) => files.get(name) ?? null),
    write: vi.fn(async (name: string, content: string) => {
      files.set(name, content);
    }),
    ...(canRemove
      ? {
          remove: vi.fn(async (name: string) => {
            files.delete(name);
          }),
        }
      : {}),
  } satisfies LinkedCardDataAdapter;
  return { files, adapter };
}

function bytes(text: string): number {
  return new TextEncoder().encode(text).length;
}

/** A v1 card with roughly `size` bytes of content. */
function legacyCard(n: number, size = 300): LinkedCard {
  const filler = `card ${n} explains conditional probability and independence. `.repeat(Math.ceil(size / 60));
  if (n % 3 === 0) return { kind: 'cloze', text: `{{c1::${filler.slice(0, size)}}}`, uid: `lc-${n}-uid`, path: `Notes/Unit ${n % 9}.md`, created: 1000 + n };
  if (n % 3 === 1) {
    return {
      kind: 'mcq',
      prompt: filler.slice(0, size / 2),
      options: [
        { text: filler.slice(0, size / 4), correct: true },
        { text: filler.slice(0, size / 4), correct: false },
      ],
      uid: `lc-${n}-uid`,
      path: `Notes/Unit ${n % 9}.md`,
      created: 1000 + n,
    };
  }
  return { kind: 'basic', front: filler.slice(0, size / 2), back: filler.slice(0, size / 2), uid: `lc-${n}-uid`, path: `Notes/Unit ${n % 9}.md`, created: 1000 + n };
}

function legacyText(count: number, size?: number): string {
  return JSON.stringify({ version: 1, cards: Array.from({ length: count }, (_, i) => legacyCard(i, size)), migratedAt: 42 }, null, 2);
}

async function loaded(adapter: LinkedCardDataAdapter): Promise<LinkedCardStore> {
  const store = new LinkedCardStore('/vault', adapter);
  await store.load();
  return store;
}

function shardWrites(adapter: ReturnType<typeof memoryAdapter>['adapter']): string[] {
  return adapter.write.mock.calls.map(([name]) => name).filter((name) => name !== CARDS_MANIFEST_FILE);
}

describe('linked card shard layout', () => {
  it('only uses file names the desktop data IPC accepts', () => {
    expect(CARDS_MANIFEST_FILE).toMatch(IPC_NAME);
    expect(CARDS_LEGACY_FILE).toMatch(IPC_NAME);
    for (let i = 0; i < CARDS_SHARD_COUNT; i += 1) expect(cardsShardFile(i)).toMatch(IPC_NAME);
    expect(new Set(Array.from({ length: CARDS_SHARD_COUNT }, (_, i) => cardsShardFile(i))).size).toBe(CARDS_SHARD_COUNT);
  });
});

describe('LinkedCardStore storage (v2 shards)', () => {
  it('round-trips cards, folders and migratedAt in creation order', async () => {
    const { files, adapter } = memoryAdapter();
    const store = await loaded(adapter);
    const a = await store.add('A.md', { kind: 'basic', front: 'Q1', back: 'A1', reverse: true }, 5);
    const many = await store.addMany(
      Array.from({ length: 30 }, (_, i) => ({ path: 'B.md', input: { kind: 'cloze' as const, text: `{{c1::x${i}}}` } })),
      5,
    );
    await store.addToFolder('Inbox', { kind: 'mcq', prompt: 'Pick', options: [{ text: 'a', correct: true }, { text: 'b', correct: false }] }, 6);
    await store.markMigrated(99);
    await store.update(many[3].uid, { kind: 'cloze', text: '{{c1::edited}}' });
    await store.remove([many[10].uid]);

    expect(files.has(CARDS_LEGACY_FILE)).toBe(false);
    const reopened = memoryAdapter(Object.fromEntries(files));
    const again = await loaded(reopened.adapter);
    expect(again.all()).toEqual(store.all());
    expect(again.all()[0]).toEqual(a);
    expect(again.all().map((c) => c.uid)).toEqual(store.all().map((c) => c.uid));
    expect(again.migratedAt).toBe(99);
    expect(again.isWritable).toBe(true);

    // New cards after a reload still go to the end.
    const late = await again.add('C.md', { kind: 'basic', front: 'late', back: 'x' });
    const third = await loaded(memoryAdapter(Object.fromEntries(reopened.files)).adapter);
    expect(third.all().at(-1)?.uid).toBe(late.uid);
    expect(third.all()).toHaveLength(store.all().length + 1);
  });

  it('writes only the shards of touched cards (manifest only when migratedAt changes)', async () => {
    const { files, adapter } = memoryAdapter({ [CARDS_LEGACY_FILE]: legacyText(500) });
    const store = await loaded(adapter);
    expect(files.has(CARDS_MANIFEST_FILE)).toBe(true);
    adapter.write.mockClear();

    const card = await store.add('A.md', { kind: 'basic', front: 'Q', back: 'A' });
    expect(adapter.write.mock.calls.map(([name]) => name)).toEqual([cardsShardFile(cardShardOf(card.uid))]);
    adapter.write.mockClear();

    const target = store.all()[7];
    await store.update(target.uid, { kind: 'basic', front: 'new', back: 'new' });
    expect(adapter.write.mock.calls.map(([name]) => name)).toEqual([cardsShardFile(cardShardOf(target.uid))]);
    adapter.write.mockClear();

    const gone = [store.all()[1], store.all()[2]];
    await store.remove(gone.map((c) => c.uid));
    expect(new Set(shardWrites(adapter))).toEqual(new Set(gone.map((c) => cardsShardFile(cardShardOf(c.uid)))));
    expect(adapter.write.mock.calls.map(([name]) => name)).not.toContain(CARDS_MANIFEST_FILE);
    adapter.write.mockClear();

    // Renaming a note rewrites only shards holding its cards.
    await store.renamePath('Notes/Unit 4.md', 'Notes/Unit Four.md', 'file');
    const movedShards = new Set(store.all().filter((c) => c.path === 'Notes/Unit Four.md').map((c) => cardsShardFile(cardShardOf(c.uid))));
    expect(new Set(shardWrites(adapter))).toEqual(movedShards);
    expect(movedShards.size).toBeLessThan(CARDS_SHARD_COUNT);
    adapter.write.mockClear();

    await store.markMigrated(7);
    expect(adapter.write.mock.calls.map(([name]) => name)).toEqual([CARDS_MANIFEST_FILE]);
  });

  it('migrates a legacy cards.json: all shards, then the manifest, then deletes the legacy file', async () => {
    const legacy = legacyText(200);
    const { files, adapter } = memoryAdapter({ [CARDS_LEGACY_FILE]: legacy });
    const store = await loaded(adapter);

    const names = adapter.write.mock.calls.map(([name]) => name);
    expect(names).toHaveLength(CARDS_SHARD_COUNT + 1);
    expect(names.at(-1)).toBe(CARDS_MANIFEST_FILE);
    expect(adapter.remove).toHaveBeenCalledWith(CARDS_LEGACY_FILE);
    expect(adapter.remove!.mock.invocationCallOrder[0]).toBeGreaterThan(adapter.write.mock.invocationCallOrder.at(-1)!);
    expect(files.has(CARDS_LEGACY_FILE)).toBe(false);

    const original = (JSON.parse(legacy) as { cards: LinkedCard[] }).cards;
    expect(store.all()).toEqual(original);
    expect(store.migratedAt).toBe(42);
    const again = await loaded(memoryAdapter(Object.fromEntries(files)).adapter);
    expect(again.all()).toEqual(original);
    expect(again.migratedAt).toBe(42);
  });

  it('recovers from a crash between the shards and the manifest with no loss', async () => {
    const legacy = legacyText(300);
    const { files, adapter } = memoryAdapter({ [CARDS_LEGACY_FILE]: legacy });
    adapter.write.mockImplementation(async (name, content) => {
      if (name === CARDS_MANIFEST_FILE) throw new Error('crash');
      files.set(name, content);
    });
    const first = await loaded(adapter);
    expect(files.has(CARDS_MANIFEST_FILE)).toBe(false);
    expect(files.has(CARDS_LEGACY_FILE)).toBe(true);
    expect(files.has(cardsShardFile(0))).toBe(true);
    expect(first.all()).toHaveLength(300);

    // Rerun (new session): migrates again from the untouched legacy file.
    const rerun = memoryAdapter(Object.fromEntries(files));
    const second = await loaded(rerun.adapter);
    const original = (JSON.parse(legacy) as { cards: LinkedCard[] }).cards;
    expect(second.all()).toEqual(original);
    expect(rerun.files.has(CARDS_MANIFEST_FILE)).toBe(true);
    expect(rerun.files.has(CARDS_LEGACY_FILE)).toBe(false);
    const third = await loaded(memoryAdapter(Object.fromEntries(rerun.files)).adapter);
    expect(third.all()).toEqual(original);
  });

  it('finishes a failed migration on the next change in the same session', async () => {
    const { files, adapter } = memoryAdapter({ [CARDS_LEGACY_FILE]: legacyText(50) });
    let fail = true;
    adapter.write.mockImplementation(async (name, content) => {
      if (fail && name === CARDS_MANIFEST_FILE) throw new Error('offline');
      files.set(name, content);
    });
    const store = await loaded(adapter);
    fail = false;
    adapter.write.mockClear();
    const card = await store.add('A.md', { kind: 'basic', front: 'Q', back: 'A' });
    expect(adapter.write.mock.calls.map(([name]) => name)).toHaveLength(CARDS_SHARD_COUNT + 1);
    expect(files.has(CARDS_LEGACY_FILE)).toBe(false);
    const again = await loaded(memoryAdapter(Object.fromEntries(files)).adapter);
    expect(again.all()).toHaveLength(51);
    expect(again.all().at(-1)?.uid).toBe(card.uid);
  });

  it('leaves the legacy file in place (and ignored) when the backend cannot delete', async () => {
    const { files, adapter } = memoryAdapter({ [CARDS_LEGACY_FILE]: legacyText(20) }, { canRemove: false });
    const store = await loaded(adapter);
    expect(files.has(CARDS_LEGACY_FILE)).toBe(true);
    expect(files.has(CARDS_MANIFEST_FILE)).toBe(true);
    await store.remove([store.all()[0].uid]);

    const rerun = memoryAdapter(Object.fromEntries(files), { canRemove: false });
    const again = await loaded(rerun.adapter);
    expect(again.all()).toHaveLength(19);
    expect(rerun.adapter.read).not.toHaveBeenCalledWith(CARDS_LEGACY_FILE);
    expect(rerun.adapter.write).not.toHaveBeenCalled();
  });

  it('never writes when storage cannot be read', async () => {
    for (const broken of [CARDS_MANIFEST_FILE, cardsShardFile(5)]) {
      const { files, adapter } = memoryAdapter();
      const seed = await loaded(adapter);
      await seed.addMany(Array.from({ length: 200 }, (_, i) => ({ path: 'A.md', input: { kind: 'basic' as const, front: `${i}`, back: 'x' } })));
      const snapshot = Object.fromEntries(files);

      const failing = memoryAdapter(snapshot);
      failing.adapter.read.mockImplementation(async (name: string) => {
        if (name === broken) throw new Error('EIO');
        return failing.files.get(name) ?? null;
      });
      const store = await loaded(failing.adapter);
      expect(store.isLoaded).toBe(true);
      expect(store.isWritable).toBe(false);
      await expect(store.add('A.md', { kind: 'basic', front: 'Q', back: 'A' })).rejects.toThrow(broken);
      expect(failing.adapter.write).not.toHaveBeenCalled();
      expect(Object.fromEntries(failing.files)).toEqual(snapshot);
    }
  });

  it('never overwrites an unreadable legacy file or shard', async () => {
    const { adapter } = memoryAdapter({ [CARDS_LEGACY_FILE]: '{ not json' });
    const store = await loaded(adapter);
    expect(store.isWritable).toBe(false);
    await expect(store.add('A.md', { kind: 'basic', front: 'Q', back: 'A' })).rejects.toThrow(CARDS_LEGACY_FILE);
    expect(adapter.write).not.toHaveBeenCalled();

    const corrupt = memoryAdapter({ [CARDS_MANIFEST_FILE]: JSON.stringify({ version: 2, shards: 64 }), [cardsShardFile(3)]: 'garbage' });
    const second = await loaded(corrupt.adapter);
    expect(second.isWritable).toBe(false);
    expect(corrupt.adapter.write).not.toHaveBeenCalled();
  });

  it('rewrites a shard after a failed save so disk matches memory', async () => {
    const { files, adapter } = memoryAdapter();
    const store = await loaded(adapter);
    await store.add('A.md', { kind: 'basic', front: 'keep', back: 'x' });
    adapter.write.mockImplementationOnce(async () => {
      throw new Error('offline');
    });
    await expect(store.add('A.md', { kind: 'basic', front: 'lost', back: 'x' })).rejects.toThrow('offline');
    expect(store.all()).toHaveLength(1);
    await store.add('B.md', { kind: 'basic', front: 'second', back: 'x' });
    const again = await loaded(memoryAdapter(Object.fromEntries(files)).adapter);
    expect(again.all().map((c) => (c.kind === 'basic' ? c.front : ''))).toEqual(['keep', 'second']);
  });

  it('keeps every shard under the 900 KB document limit with 20k large cards', async () => {
    const count = 20_000;
    const { files, adapter } = memoryAdapter({ [CARDS_LEGACY_FILE]: legacyText(count, 1500) });
    const store = await loaded(adapter);
    expect(store.all()).toHaveLength(count);
    const avg = bytes(JSON.stringify(store.all())) / count;
    expect(avg).toBeGreaterThan(1400);
    let largest = 0;
    for (const [name, text] of files) {
      expect(name).toMatch(IPC_NAME);
      largest = Math.max(largest, bytes(text));
    }
    expect(largest).toBeLessThan(LIMIT);
    // Comfortable headroom, not just squeaking by.
    expect(largest).toBeLessThan(LIMIT * 0.7);
  });
});
