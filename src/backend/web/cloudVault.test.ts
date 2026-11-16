import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InMemoryCloudRepository } from '../cloud/memory/InMemoryCloudRepository';
import { PayloadTooLargeError } from '../cloud/errors';
import { createCloudVault, type CloudVault } from './cloudVault';

const WS = 'u1';
const ROOT = 'cloud:u1';

function setup(opts: { onSaveError?: (path: string, error: Error) => void; maxPayloadBytes?: number } = {}) {
  const repo = new InMemoryCloudRepository({ maxPayloadBytes: opts.maxPayloadBytes });
  const vault = createCloudVault({
    repo,
    getWorkspaceId: () => WS,
    onSaveError: opts.onSaveError,
    flushDelayMs: 2500,
    installPageListeners: false,
  });
  return { repo, vault };
}

/** Let microtasks (repo writes, watch emits) run. */
async function settle(): Promise<void> {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
}

describe('createCloudVault', () => {
  let vault: CloudVault | null = null;

  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vault?.dispose();
    vault = null;
    vi.useRealTimers();
  });

  it('opens with a synthetic root and the tree from listTree', async () => {
    const ctx = setup();
    vault = ctx.vault;
    await ctx.repo.writeNote(WS, 'Stats/A.md', 'a');
    await ctx.repo.mkdir(WS, 'Empty');
    const result = await vault.restore();
    expect(result).toEqual({ root: ROOT, files: ['Stats/A.md'], pdfFiles: [], folders: ['Empty', 'Stats'] });
    expect(await vault.ensureDefault()).toEqual(result);
  });

  it('coalesces 10 writes into one repo write after the idle delay', async () => {
    const ctx = setup();
    vault = ctx.vault;
    const spy = vi.spyOn(ctx.repo, 'writeNote');
    for (let i = 0; i < 10; i += 1) {
      await vault.write(ROOT, 'A.md', `v${i}`);
      vi.advanceTimersByTime(500);
    }
    expect(spy).not.toHaveBeenCalled();
    expect(vault.hasPendingWrites()).toBe(true);
    await vi.advanceTimersByTimeAsync(2500);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(WS, 'A.md', 'v9');
    expect(await ctx.repo.readNote(WS, 'A.md')).toBe('v9');
    expect(vault.hasPendingWrites()).toBe(false);
  });

  it('flushes at maxWait even while writes keep coming', async () => {
    const repo = new InMemoryCloudRepository();
    vault = createCloudVault({ repo, getWorkspaceId: () => WS, flushDelayMs: 2500, maxWaitMs: 5000, installPageListeners: false });
    const spy = vi.spyOn(repo, 'writeNote');
    for (let i = 0; i < 12; i += 1) {
      await vault.write(ROOT, 'A.md', `v${i}`);
      await vi.advanceTimersByTimeAsync(500);
    }
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('reads its own buffered writes (notes and data)', async () => {
    const ctx = setup();
    vault = ctx.vault;
    await ctx.repo.writeNote(WS, 'A.md', 'old');
    const readSpy = vi.spyOn(ctx.repo, 'readNote');
    await vault.write(ROOT, 'A.md', 'new');
    expect(await vault.read(ROOT, 'A.md')).toBe('new');
    expect(readSpy).not.toHaveBeenCalled();
    await vault.writeData!(ROOT, '.vault/srs.json', '{"a":1}');
    expect(await vault.readData!(ROOT, '.vault/srs.json')).toBe('{"a":1}');
    expect(await ctx.repo.readData(WS, '.vault/srs.json')).toBeNull();
  });

  it('caches note bodies after the first read', async () => {
    const ctx = setup();
    vault = ctx.vault;
    await ctx.repo.writeNote(WS, 'A.md', 'body');
    const readSpy = vi.spyOn(ctx.repo, 'readNote');
    expect(await vault.read(ROOT, 'A.md')).toBe('body');
    expect(await vault.read(ROOT, 'A.md')).toBe('body');
    expect(readSpy).toHaveBeenCalledTimes(1);
  });

  it('flushes pending writes before rename and delete', async () => {
    const ctx = setup();
    vault = ctx.vault;
    await ctx.repo.writeNote(WS, 'A.md', 'old');
    await vault.write(ROOT, 'A.md', 'edited');
    expect(await vault.rename(ROOT, 'A.md', 'B.md')).toBe('B.md');
    expect(await ctx.repo.readNote(WS, 'B.md')).toBe('edited');
    expect(await vault.read(ROOT, 'B.md')).toBe('edited');

    await vault.write(ROOT, 'B.md', 'doomed');
    const writeSpy = vi.spyOn(ctx.repo, 'writeNote');
    await vault.delete(ROOT, 'B.md');
    expect(await ctx.repo.readNote(WS, 'B.md')).toBeNull();
    await vi.advanceTimersByTimeAsync(5000);
    expect(writeSpy).not.toHaveBeenCalled();
    expect(vault.hasPendingWrites()).toBe(false);
  });

  it('flushes pending writes under a folder before renaming it', async () => {
    const ctx = setup();
    vault = ctx.vault;
    await ctx.repo.writeNote(WS, 'F/A.md', 'old');
    await vault.write(ROOT, 'F/A.md', 'edited');
    await vault.rename(ROOT, 'F', 'G');
    expect(await ctx.repo.readNote(WS, 'G/A.md')).toBe('edited');
  });

  it('batches appendData lines per key into one append', async () => {
    const ctx = setup();
    vault = ctx.vault;
    const spy = vi.spyOn(ctx.repo, 'appendData');
    await vault.appendData!(ROOT, 'log.jsonl', '{"a":1}\n');
    await vault.appendData!(ROOT, 'log.jsonl', '{"a":2}\n');
    await vault.appendData!(ROOT, 'other.jsonl', 'x\n');
    await vi.advanceTimersByTimeAsync(2500);
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy).toHaveBeenCalledWith(WS, 'log.jsonl', '{"a":1}\n{"a":2}\n');
    expect(await vault.readData!(ROOT, 'log.jsonl')).toBe('{"a":1}\n{"a":2}\n');
  });

  it('readData includes pending appends', async () => {
    const ctx = setup();
    vault = ctx.vault;
    await ctx.repo.appendData(WS, 'log.jsonl', 'a\n');
    await vault.appendData!(ROOT, 'log.jsonl', 'b\n');
    expect(await vault.readData!(ROOT, 'log.jsonl')).toBe('a\nb\n');
  });

  it('flushAll writes everything immediately', async () => {
    const ctx = setup();
    vault = ctx.vault;
    await vault.write(ROOT, 'A.md', 'a');
    await vault.writeData!(ROOT, 'k.json', '{}');
    await vault.appendData!(ROOT, 'log.jsonl', 'l\n');
    await vault.flushAll();
    expect(await ctx.repo.readNote(WS, 'A.md')).toBe('a');
    expect(await ctx.repo.readData(WS, 'k.json')).toBe('{}');
    expect(await ctx.repo.readData(WS, 'log.jsonl')).toBe('l\n');
    expect(vault.hasPendingWrites()).toBe(false);
  });

  it('retries a failed write once, then reports it and keeps the change', async () => {
    const onSaveError = vi.fn();
    const ctx = setup({ onSaveError });
    vault = ctx.vault;
    const spy = vi.spyOn(ctx.repo, 'writeNote').mockRejectedValue(new Error('offline'));
    await vault.write(ROOT, 'A.md', 'a');
    await vault.flushAll();
    expect(spy).toHaveBeenCalledTimes(2);
    expect(onSaveError).toHaveBeenCalledWith('A.md', expect.objectContaining({ message: 'offline' }));
    expect(vault.hasPendingWrites()).toBe(true);

    spy.mockRestore();
    await vault.flushAll();
    expect(await ctx.repo.readNote(WS, 'A.md')).toBe('a');
  });

  it('succeeds when the retry works', async () => {
    const onSaveError = vi.fn();
    const ctx = setup({ onSaveError });
    vault = ctx.vault;
    vi.spyOn(ctx.repo, 'writeNote').mockRejectedValueOnce(new Error('blip'));
    await vault.write(ROOT, 'A.md', 'a');
    await vault.flushAll();
    expect(onSaveError).not.toHaveBeenCalled();
    expect(await ctx.repo.readNote(WS, 'A.md')).toBe('a');
  });

  it('reports PayloadTooLargeError without retrying and names the key', async () => {
    const onSaveError = vi.fn();
    const ctx = setup({ onSaveError, maxPayloadBytes: 10 });
    vault = ctx.vault;
    const spy = vi.spyOn(ctx.repo, 'writeData');
    await vault.writeData!(ROOT, '.vault/srs.json', 'x'.repeat(50));
    await vault.flushAll();
    expect(spy).toHaveBeenCalledTimes(1);
    const [path, error] = onSaveError.mock.calls[0];
    expect(path).toBe('.vault/srs.json');
    expect(error).toBeInstanceOf(PayloadTooLargeError);
    expect(error.message).toContain('.vault/srs.json');
    expect(vault.hasPendingWrites()).toBe(false);
  });

  it('maps watch events with the root and suppresses echoes of its own writes', async () => {
    const ctx = setup();
    vault = ctx.vault;
    await ctx.repo.writeNote(WS, 'A.md', 'a');
    await vault.open();
    const events: VaultWatchEvent[] = [];
    vault.onWatch((event) => events.push(event));

    await vault.write(ROOT, 'A.md', 'mine');
    await vault.flushAll();
    await settle();
    expect(events).toEqual([]);

    await ctx.repo.writeNote(WS, 'A.md', 'theirs'); // another device
    await ctx.repo.writeNote(WS, 'Dir/New.md', 'n');
    await settle();
    expect(events).toEqual([
      { type: 'change', path: 'A.md', root: ROOT },
      { type: 'addDir', path: 'Dir', root: ROOT },
      { type: 'add', path: 'Dir/New.md', root: ROOT },
    ]);
    // The remote change invalidated the cache.
    expect(await vault.read(ROOT, 'A.md')).toBe('theirs');
  });

  it('keeps buffered local edits when a remote change arrives', async () => {
    const ctx = setup();
    vault = ctx.vault;
    await ctx.repo.writeNote(WS, 'A.md', 'a');
    await vault.open();
    await vault.write(ROOT, 'A.md', 'local');
    await ctx.repo.writeNote(WS, 'A.md', 'remote');
    await settle();
    expect(await vault.read(ROOT, 'A.md')).toBe('local');
  });

  it('stops delivering after watchStop / unsubscribe', async () => {
    const ctx = setup();
    vault = ctx.vault;
    await vault.open();
    const cb = vi.fn();
    const off = vault.onWatch(cb);
    off();
    await ctx.repo.writeNote(WS, 'X.md', 'x');
    await settle();
    expect(cb).not.toHaveBeenCalled();
    vault.onWatch(cb);
    await vault.watchStop();
    await ctx.repo.writeNote(WS, 'Y.md', 'y');
    await settle();
    expect(cb).not.toHaveBeenCalled();
  });

  it('rejects desktop-only methods', async () => {
    const ctx = setup();
    vault = ctx.vault;
    await expect(vault.openPath(ROOT, 'a')).rejects.toThrow('Not available on web');
    await expect(vault.importObsidian(ROOT)).rejects.toThrow('Not available on web');
    expect(vault.saveImage).toBeUndefined();
    expect(vault.readPdf).toBeUndefined();
  });
});
