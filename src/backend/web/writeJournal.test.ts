import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InMemoryCloudRepository } from '../cloud/memory/InMemoryCloudRepository';
import { createCloudVault, type CloudVault, type RecoveredCopy } from './cloudVault';
import {
  createWriteJournal,
  DEFAULT_LIVE_MS,
  type JournalEntry,
  type JournalStorage,
  type LockManagerLike,
} from './writeJournal';

const WS = 'u1';
const ROOT = 'cloud:u1';

class FakeStorage implements JournalStorage {
  map = new Map<string, string>();
  fail = false;
  getItem(key: string) {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    if (this.fail) throw new Error('QuotaExceededError');
    this.map.set(key, value);
  }
  removeItem(key: string) {
    this.map.delete(key);
  }
  keys() {
    return [...this.map.keys()];
  }
  entries(): JournalEntry[] {
    return [...this.map]
      .filter(([key]) => key.startsWith(`concrete:journal:${WS}:`))
      .map(([, value]) => JSON.parse(value) as JournalEntry);
  }
}

/** A real mutex, like navigator.locks. */
function fakeLocks(): LockManagerLike {
  let tail: Promise<unknown> = Promise.resolve();
  return {
    request<T>(_name: string, fn: () => Promise<T> | T): Promise<T> {
      const run = tail.then(() => fn());
      tail = run.catch(() => {});
      return run;
    },
  };
}

async function settle(): Promise<void> {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
}

const vaults: CloudVault[] = [];

function makeVault(
  repo: InMemoryCloudRepository,
  storage: JournalStorage,
  tabId: string,
  extra: { maxEntryChars?: number; locks?: LockManagerLike | null; onRecovered?: (c: RecoveredCopy[]) => void } = {},
) {
  const journal = createWriteJournal({
    storage,
    uid: WS,
    tabId,
    locks: extra.locks ?? null,
    maxEntryChars: extra.maxEntryChars,
    log: () => {},
  });
  const vault = createCloudVault({
    repo,
    getWorkspaceId: () => WS,
    journal,
    onRecovered: extra.onRecovered,
    installPageListeners: false,
    liveSync: false,
    onSaveError: () => {},
  });
  vaults.push(vault);
  return { vault, journal };
}

describe('write journal + cloud vault', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-14T12:00:00Z'));
  });
  afterEach(() => {
    vi.clearAllTimers();
    vaults.length = 0;
    vi.useRealTimers();
  });

  it('journals a buffered write synchronously, coalescing per path', () => {
    const repo = new InMemoryCloudRepository();
    const storage = new FakeStorage();
    const { vault } = makeVault(repo, storage, 'A');
    void vault.write(ROOT, 'A.md', 'one'); // not awaited: must already be journaled
    expect(storage.entries()).toMatchObject([{ kind: 'note', key: 'A.md', content: 'one', tab: 'A' }]);
    void vault.write(ROOT, 'A.md', 'two');
    void vault.writeData!(ROOT, '.vault/srs.json', '{}');
    void vault.appendData!(ROOT, '.vault/srs-log.jsonl', 'l1\n');
    void vault.appendData!(ROOT, '.vault/srs-log.jsonl', 'l2\n');
    const entries = storage.entries();
    expect(entries.filter((e) => e.kind === 'note').map((e) => e.content)).toEqual(['two']);
    expect(entries.filter((e) => e.kind === 'data').map((e) => e.content)).toEqual(['{}']);
    expect(entries.filter((e) => e.kind === 'append').map((e) => e.content)).toEqual(['l1\n', 'l2\n']);
    expect(vault.hasPendingWrites()).toBe(true);
    expect(vault.hasUnjournaledWrites()).toBe(false);
  });

  it('replays a killed tab in the next session (notes, data, appends) and clears the journal', async () => {
    const repo = new InMemoryCloudRepository();
    await repo.writeNote(WS, 'A.md', 'v1');
    vi.advanceTimersByTime(1000);
    const storage = new FakeStorage();
    const a = makeVault(repo, storage, 'A');
    await a.vault.restore();
    await a.vault.write(ROOT, 'A.md', 'v2');
    await a.vault.write(ROOT, 'New.md', 'brand new');
    await a.vault.writeData!(ROOT, '.vault/srs.json', '{"x":1}');
    await a.vault.appendData!(ROOT, '.vault/log.jsonl', 'r1\n');
    a.vault.dispose(); // tab closed (pagehide) before the flush; nothing was saved
    expect(await repo.readNote(WS, 'A.md')).toBe('v1');

    const b = makeVault(repo, storage, 'B');
    const opened = await b.vault.restore();
    expect(opened!.files).toContain('New.md');
    // Read-your-writes right away, whether or not the flush landed yet.
    expect(await b.vault.read(ROOT, 'A.md')).toBe('v2');
    await b.vault.flushAll();
    await settle();
    expect(await repo.readNote(WS, 'A.md')).toBe('v2');
    expect(await repo.readNote(WS, 'New.md')).toBe('brand new');
    expect(await repo.readData(WS, '.vault/srs.json')).toBe('{"x":1}');
    expect(await repo.readData(WS, '.vault/log.jsonl')).toBe('r1\n');
    expect(storage.entries()).toEqual([]);
  });

  it('replays a crashed tab (no pagehide) once its heartbeat is stale', async () => {
    const repo = new InMemoryCloudRepository();
    const storage = new FakeStorage();
    const a = makeVault(repo, storage, 'A');
    await a.vault.write(ROOT, 'A.md', 'crash');
    // crash: no flush, no heartbeat removal (its timers never fire: time is not advanced)
    const early = makeVault(repo, storage, 'B');
    await early.vault.restore();
    expect(await repo.readNote(WS, 'A.md')).toBeNull(); // A may still be alive
    vi.setSystemTime(Date.now() + DEFAULT_LIVE_MS + 1000);
    const late = makeVault(repo, storage, 'C');
    await late.vault.restore();
    await late.vault.flushAll();
    expect(await repo.readNote(WS, 'A.md')).toBe('crash');
  });

  it('clears an entry only after its write succeeded; a newer edit made during the flush survives', async () => {
    const repo = new InMemoryCloudRepository();
    const storage = new FakeStorage();
    const { vault, journal } = makeVault(repo, storage, 'A');
    let release!: () => void;
    const real = repo.writeNote.bind(repo);
    vi.spyOn(repo, 'writeNote').mockImplementationOnce(async (ws, path, body) => {
      await new Promise<void>((resolve) => (release = resolve));
      return real(ws, path, body);
    });
    await vault.write(ROOT, 'A.md', 'v1');
    const flushing = vault.flushAll();
    await settle();
    await vault.write(ROOT, 'A.md', 'v2'); // typed while v1 is in flight
    expect(storage.entries().map((e) => e.content).sort()).toEqual(['v1', 'v2']);
    release();
    await flushing;
    expect(await repo.readNote(WS, 'A.md')).toBe('v1');
    expect(storage.entries().map((e) => e.content)).toEqual(['v2']);

    // The tab dies now: v2 is replayed.
    vault.dispose();
    const b = makeVault(repo, storage, 'B');
    await b.vault.restore();
    await b.vault.flushAll();
    expect(await repo.readNote(WS, 'A.md')).toBe('v2');
    expect(storage.entries()).toEqual([]);
  });

  it('keeps the entry when the write fails', async () => {
    const repo = new InMemoryCloudRepository();
    const storage = new FakeStorage();
    const { vault } = makeVault(repo, storage, 'A');
    vi.spyOn(repo, 'writeNote').mockRejectedValue(new Error('offline'));
    await vault.write(ROOT, 'A.md', 'v1');
    await vault.flushAll();
    expect(storage.entries().map((e) => e.content)).toEqual(['v1']);
    expect(vault.hasPendingWrites()).toBe(true);
    expect(vault.hasUnjournaledWrites()).toBe(false);
  });

  it('saves a sibling unsaved copy when the remote note changed after the journaled edit', async () => {
    const repo = new InMemoryCloudRepository();
    await repo.writeNote(WS, 'Stats/Bayes.md', 'base');
    const storage = new FakeStorage();
    const a = makeVault(repo, storage, 'A');
    vi.advanceTimersByTime(1000);
    await a.vault.write(ROOT, 'Stats/Bayes.md', 'mine');
    a.vault.dispose(); // tab closed (pagehide) before the flush; nothing was saved
    vi.advanceTimersByTime(60_000);
    await repo.writeNote(WS, 'Stats/Bayes.md', 'theirs'); // another device, later

    const recovered = vi.fn();
    const b = makeVault(repo, storage, 'B', { onRecovered: recovered });
    const opened = await b.vault.restore();
    await b.vault.flushAll();
    expect(await repo.readNote(WS, 'Stats/Bayes.md')).toBe('theirs');
    const copy = opened!.files.find((f) => f.startsWith('Stats/Bayes (unsaved copy '));
    expect(copy).toMatch(/^Stats\/Bayes \(unsaved copy \d{4}-\d{2}-\d{2} \d{2}-\d{2}\)\.md$/);
    expect(await repo.readNote(WS, copy!)).toBe('mine');
    expect(await b.vault.read(ROOT, 'Stats/Bayes.md')).toBe('theirs');
    expect(recovered).toHaveBeenCalledWith([{ path: 'Stats/Bayes.md', copyPath: copy }]);
    expect(storage.entries()).toEqual([]);
  });

  it('drops an entry whose text the remote already has (saved just before the tab died)', async () => {
    const repo = new InMemoryCloudRepository();
    const storage = new FakeStorage();
    const a = makeVault(repo, storage, 'A');
    await a.vault.write(ROOT, 'A.md', 'same');
    a.vault.dispose(); // tab closed (pagehide) before the flush; nothing was saved
    vi.advanceTimersByTime(5000);
    await repo.writeNote(WS, 'A.md', 'same');
    const recovered = vi.fn();
    const b = makeVault(repo, storage, 'B', { onRecovered: recovered });
    const opened = await b.vault.restore();
    expect(opened!.files).toEqual(['A.md']);
    expect(recovered).not.toHaveBeenCalled();
    expect(storage.entries()).toEqual([]);
  });

  it('falls back to the unload warning when localStorage throws', async () => {
    const repo = new InMemoryCloudRepository();
    const storage = new FakeStorage();
    storage.fail = true;
    const { vault } = makeVault(repo, storage, 'A');
    await expect(vault.write(ROOT, 'A.md', 'v1')).resolves.toBe(true);
    expect(vault.hasUnjournaledWrites()).toBe(true);
    expect(await vault.read(ROOT, 'A.md')).toBe('v1');
    await vault.flushAll();
    expect(await repo.readNote(WS, 'A.md')).toBe('v1');
    expect(vault.hasUnjournaledWrites()).toBe(false);
  });

  it('warns for entries too large to journal, not for small ones', async () => {
    const repo = new InMemoryCloudRepository();
    const storage = new FakeStorage();
    const { vault } = makeVault(repo, storage, 'A', { maxEntryChars: 100 });
    await vault.write(ROOT, 'A.md', 'small');
    expect(vault.hasUnjournaledWrites()).toBe(false);
    await vault.writeData!(ROOT, '.vault/srs-0.json', 'x'.repeat(500));
    expect(vault.hasUnjournaledWrites()).toBe(true);
    expect(storage.entries().map((e) => e.key)).toEqual(['A.md']);
  });

  it('without a journal, the warning follows hasPendingWrites (previous behavior)', async () => {
    const repo = new InMemoryCloudRepository();
    const vault = createCloudVault({ repo, getWorkspaceId: () => WS, installPageListeners: false });
    vaults.push(vault);
    await vault.write(ROOT, 'A.md', 'v1');
    expect(vault.hasUnjournaledWrites()).toBe(true);
    await vault.flushAll();
    expect(vault.hasUnjournaledWrites()).toBe(false);
  });

  it('does not replay entries of a live tab, and two tabs never replay the same entry', async () => {
    const repo = new InMemoryCloudRepository();
    const storage = new FakeStorage();
    const locks = fakeLocks();
    const a = makeVault(repo, storage, 'A', { locks });
    await a.vault.write(ROOT, 'A.md', 'from A');
    await a.vault.appendData!(ROOT, '.vault/log.jsonl', 'line\n');

    // A is alive: B leaves its entries alone.
    const b = makeVault(repo, storage, 'B', { locks });
    await b.vault.restore();
    expect(await repo.readNote(WS, 'A.md')).toBeNull();
    expect(storage.entries().every((e) => e.tab === 'A')).toBe(true);

    // A closes without flushing; C and D open at the same time.
    a.vault.dispose(); // tab closed (pagehide) before the flush; nothing was saved
    const append = vi.spyOn(repo, 'appendData');
    const write = vi.spyOn(repo, 'writeNote');
    const c = makeVault(repo, storage, 'C', { locks });
    const d = makeVault(repo, storage, 'D', { locks });
    await Promise.all([c.vault.restore(), d.vault.restore()]);
    await Promise.all([c.vault.flushAll(), d.vault.flushAll()]);
    expect(write).toHaveBeenCalledTimes(1);
    expect(append).toHaveBeenCalledTimes(1);
    expect(await repo.readData(WS, '.vault/log.jsonl')).toBe('line\n');
    expect(storage.entries()).toEqual([]);
  });

  it('a tab only removes entries it still owns', () => {
    const storage = new FakeStorage();
    const a = createWriteJournal({ storage, uid: WS, tabId: 'A', locks: null });
    const entry = a.put(null, 'note', 'A.md', 'x')!;
    a.markClosed();
    const b = createWriteJournal({ storage, uid: WS, tabId: 'B', locks: null });
    expect(b.claimOrphans().map((e) => e.id)).toEqual([entry.id]);
    a.remove({ id: entry.id, seq: entry.seq }); // A comes back (e.g. bfcache) and confirms a save
    expect(storage.entries()).toHaveLength(1); // B's claimed entry is untouched
    expect(b.claimOrphans()).toEqual([]); // nothing to claim twice
  });

  it('keeps journals of different users apart', () => {
    const storage = new FakeStorage();
    const a = createWriteJournal({ storage, uid: 'u1', tabId: 'A', locks: null });
    a.put(null, 'note', 'A.md', 'x');
    a.markClosed();
    const other = createWriteJournal({ storage, uid: 'u2', tabId: 'B', locks: null });
    expect(other.claimOrphans()).toEqual([]);
  });
});
