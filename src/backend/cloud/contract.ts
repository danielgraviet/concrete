/**
 * Shared behavioural contract for every CloudRepository implementation.
 * A new backend (Postgres, HTTP, ...) passes when this suite passes.
 *
 *   runCloudRepositoryContract('InMemory', async () => ({ repo: new InMemoryCloudRepository(), ws: 'u1' }));
 */

import { describe, expect, it, vi } from 'vitest';
import { MAX_PAYLOAD_BYTES, type CloudRepository, type CloudWatchEvent } from './CloudRepository';
import { ConflictError, InvalidPathError, NotFoundError, PayloadTooLargeError, PermissionError } from './errors';

export interface ContractHarness {
  repo: CloudRepository;
  /** A fresh, empty workspace the current user owns. */
  ws: string;
  /** A second workspace the same repo can write to (owner isolation + share ownership checks). */
  otherWs?: string;
  /** A workspace the current user must NOT be able to touch (expects PermissionError). */
  foreignWs?: string;
  /** Delay after subscribing before mutating, for backends whose first snapshot is async. */
  watchSettleMs?: number;
  cleanup?: () => Promise<void>;
}

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function runCloudRepositoryContract(name: string, setup: () => Promise<ContractHarness>, timeoutMs = 20_000): void {
  async function withHarness(fn: (h: ContractHarness) => Promise<void>): Promise<void> {
    const h = await setup();
    try {
      await fn(h);
    } finally {
      await h.cleanup?.();
    }
  }
  const test = (title: string, fn: (h: ContractHarness) => Promise<void>) =>
    it(title, () => withHarness(fn), timeoutMs);

  describe(`CloudRepository contract: ${name}`, () => {
    describe('notes', () => {
      test('starts empty', async ({ repo, ws }) => {
        expect(await repo.listTree(ws)).toEqual({ notes: [], folders: [] });
        expect(await repo.readNote(ws, 'Missing.md')).toBeNull();
      });

      test('writeNote upserts and keeps a stable id', async ({ repo, ws }) => {
        await repo.writeNote(ws, 'Hello.md', 'first');
        expect(await repo.readNote(ws, 'Hello.md')).toBe('first');
        const [before] = (await repo.listTree(ws)).notes;
        expect(before.path).toBe('Hello.md');
        expect(before.size).toBe(5);
        expect(before.updatedAt).toMatch(ISO);
        expect(before.id).toBeTruthy();

        await repo.writeNote(ws, 'Hello.md', 'second — ünïcode');
        const tree = await repo.listTree(ws);
        expect(tree.notes).toHaveLength(1);
        expect(tree.notes[0].id).toBe(before.id);
        expect(tree.notes[0].size).toBe(new TextEncoder().encode('second — ünïcode').length);
        expect(await repo.readNote(ws, '/Hello.md')).toBe('second — ünïcode');
      });

      test('writeNote into a nested path implies its folders', async ({ repo, ws }) => {
        await repo.writeNote(ws, 'A/B/C.md', 'x');
        expect((await repo.listTree(ws)).folders).toEqual(['A', 'A/B']);
      });

      test('createNote appends .md, writes a title, creates parents, rejects duplicates', async ({ repo, ws }) => {
        expect(await repo.createNote(ws, 'Stats/Bayes')).toBe('Stats/Bayes.md');
        expect(await repo.readNote(ws, 'Stats/Bayes.md')).toBe('# Bayes\n\n');
        expect(await repo.createNote(ws, 'Top.md', 'custom')).toBe('Top.md');
        expect(await repo.readNote(ws, 'Top.md')).toBe('custom');
        const tree = await repo.listTree(ws);
        expect(tree.notes.map((n) => n.path)).toEqual(['Stats/Bayes.md', 'Top.md']);
        expect(tree.folders).toEqual(['Stats']);
        await expect(repo.createNote(ws, 'Stats/Bayes.md')).rejects.toBeInstanceOf(ConflictError);
        await expect(repo.createNote(ws, 'Stats/Bayes')).rejects.toBeInstanceOf(ConflictError);
      });

      test('rejects invalid paths', async ({ repo, ws }) => {
        await expect(repo.writeNote(ws, '', 'x')).rejects.toBeInstanceOf(InvalidPathError);
        await expect(repo.writeNote(ws, 'a/../b.md', 'x')).rejects.toBeInstanceOf(InvalidPathError);
      });
    });

    describe('folders', () => {
      test('mkdir is nested and idempotent; empty folders are listed', async ({ repo, ws }) => {
        expect(await repo.mkdir(ws, 'Empty/Deep/')).toBe('Empty/Deep');
        expect(await repo.mkdir(ws, 'Empty/Deep')).toBe('Empty/Deep');
        expect(await repo.listTree(ws)).toEqual({ notes: [], folders: ['Empty', 'Empty/Deep'] });
      });

      test('folders survive deleting their last note', async ({ repo, ws }) => {
        await repo.createNote(ws, 'Keep/Only');
        await repo.remove(ws, 'Keep/Only.md');
        expect((await repo.listTree(ws)).folders).toEqual(['Keep']);
      });
    });

    describe('rename', () => {
      test('renames a note, keeping its id and body', async ({ repo, ws }) => {
        await repo.writeNote(ws, 'Old.md', 'body');
        const [{ id }] = (await repo.listTree(ws)).notes;
        expect(await repo.rename(ws, 'Old.md', 'Sub/New')).toBe('Sub/New.md');
        expect(await repo.readNote(ws, 'Old.md')).toBeNull();
        expect(await repo.readNote(ws, 'Sub/New.md')).toBe('body');
        const tree = await repo.listTree(ws);
        expect(tree.notes.map((n) => [n.id, n.path])).toEqual([[id, 'Sub/New.md']]);
        expect(tree.folders).toEqual(['Sub']);
      });

      test('rename to an existing note conflicts; missing source is NotFound', async ({ repo, ws }) => {
        await repo.writeNote(ws, 'A.md', 'a');
        await repo.writeNote(ws, 'B.md', 'b');
        await expect(repo.rename(ws, 'A.md', 'B.md')).rejects.toBeInstanceOf(ConflictError);
        await expect(repo.rename(ws, 'Nope.md', 'C.md')).rejects.toBeInstanceOf(NotFoundError);
        expect(await repo.readNote(ws, 'B.md')).toBe('b');
      });

      test('folder rename moves every child, including empty subfolders', async ({ repo, ws }) => {
        await repo.writeNote(ws, 'Stats/Bayes.md', 'bayes');
        await repo.writeNote(ws, 'Stats/Deep/Prior.md', 'prior');
        await repo.mkdir(ws, 'Stats/EmptyChild');
        await repo.writeNote(ws, 'Statistics/Other.md', 'sibling with shared prefix');
        await repo.writeNote(ws, 'Stats.md', 'note named like the folder');

        expect(await repo.rename(ws, 'Stats', 'Math/Probability')).toBe('Math/Probability');

        const tree = await repo.listTree(ws);
        expect(tree.notes.map((n) => n.path)).toEqual([
          'Math/Probability/Bayes.md',
          'Math/Probability/Deep/Prior.md',
          'Statistics/Other.md',
          'Stats.md',
        ]);
        expect(tree.folders).toEqual([
          'Math',
          'Math/Probability',
          'Math/Probability/Deep',
          'Math/Probability/EmptyChild',
          'Statistics',
        ]);
        expect(await repo.readNote(ws, 'Math/Probability/Deep/Prior.md')).toBe('prior');
      });

      test('folder rename into itself or onto an existing folder fails', async ({ repo, ws }) => {
        await repo.writeNote(ws, 'X/a.md', 'a');
        await repo.mkdir(ws, 'Y');
        await expect(repo.rename(ws, 'X', 'X/inner')).rejects.toBeInstanceOf(InvalidPathError);
        await expect(repo.rename(ws, 'X', 'Y')).rejects.toBeInstanceOf(ConflictError);
        await expect(repo.rename(ws, 'Nope', 'Z')).rejects.toBeInstanceOf(NotFoundError);
      });
    });

    describe('remove', () => {
      test('removes a single note', async ({ repo, ws }) => {
        await repo.writeNote(ws, 'Gone.md', 'x');
        await repo.remove(ws, 'Gone.md');
        expect(await repo.readNote(ws, 'Gone.md')).toBeNull();
        await expect(repo.remove(ws, 'Gone.md')).rejects.toBeInstanceOf(NotFoundError);
      });

      test('removes a folder recursively without touching prefix siblings', async ({ repo, ws }) => {
        await repo.writeNote(ws, 'Trash/a.md', 'a');
        await repo.writeNote(ws, 'Trash/Deep/b.md', 'b');
        await repo.mkdir(ws, 'Trash/Empty');
        await repo.writeNote(ws, 'TrashCan/keep.md', 'keep');
        await repo.remove(ws, 'Trash');
        expect(await repo.listTree(ws)).toMatchObject({
          notes: [{ path: 'TrashCan/keep.md' }],
          folders: ['TrashCan'],
        });
        await expect(repo.remove(ws, 'Trash')).rejects.toBeInstanceOf(NotFoundError);
      });
    });

    describe('app data', () => {
      test('read/write/append/delete with path-like keys', async ({ repo, ws }) => {
        const key = '.vault/srs.json';
        expect(await repo.readData(ws, key)).toBeNull();
        await repo.writeData(ws, key, '{"version":1}');
        expect(await repo.readData(ws, key)).toBe('{"version":1}');
        await repo.writeData(ws, key, '{"version":2}');
        expect(await repo.readData(ws, key)).toBe('{"version":2}');

        const log = '.vault/srs-log.jsonl';
        await repo.appendData(ws, log, '{"a":1}\n');
        await repo.appendData(ws, log, '{"a":2}\n');
        expect(await repo.readData(ws, log)).toBe('{"a":1}\n{"a":2}\n');

        await repo.deleteData(ws, key);
        expect(await repo.readData(ws, key)).toBeNull();
        await repo.deleteData(ws, key); // no-op when absent
        expect(await repo.readData(ws, log)).toBe('{"a":1}\n{"a":2}\n');
        // Similar-looking keys do not collide after encoding.
        await repo.writeData(ws, '.vault/srs_json', 'other');
        expect(await repo.readData(ws, '.vault/srs.json')).toBeNull();
      });
    });

    describe('size limits', () => {
      const big = 'x'.repeat(MAX_PAYLOAD_BYTES + 1);

      test('oversized note and data writes throw PayloadTooLargeError naming the target', async ({ repo, ws }) => {
        const noteErr = await repo.writeNote(ws, 'Huge.md', big).catch((e: unknown) => e);
        expect(noteErr).toBeInstanceOf(PayloadTooLargeError);
        expect((noteErr as Error).message).toContain('Huge.md');
        expect(await repo.readNote(ws, 'Huge.md')).toBeNull();

        const dataErr = await repo.writeData(ws, '.vault/cards.json', big).catch((e: unknown) => e);
        expect(dataErr).toBeInstanceOf(PayloadTooLargeError);
        expect((dataErr as Error).message).toContain('.vault/cards.json');

        await expect(repo.appendData(ws, '.vault/log.jsonl', big)).rejects.toBeInstanceOf(PayloadTooLargeError);
        await expect(
          repo.createShare(ws, { kind: 'note', title: 'big', payload: big }),
        ).rejects.toBeInstanceOf(PayloadTooLargeError);
      });

      test('append-only logs may grow past the per-record limit', async ({ repo, ws }) => {
        const key = '.vault/srs-log.jsonl';
        const line = (ch: string) => `${ch.repeat(400_000)}\n`;
        await repo.appendData(ws, key, line('a'));
        await repo.appendData(ws, key, line('b'));
        await repo.appendData(ws, key, line('c')); // exceeds one record → rolls over
        await repo.appendData(ws, key, 'tail\n');
        const expected = line('a') + line('b') + line('c') + 'tail\n';
        expect(await repo.readData(ws, key)).toBe(expected);
        expect((await repo.exportWorkspace(ws)).data).toEqual([{ key, text: expected }]);

        await repo.writeData(ws, key, 'reset\n');
        expect(await repo.readData(ws, key)).toBe('reset\n');
        await repo.appendData(ws, key, 'more\n');
        expect(await repo.readData(ws, key)).toBe('reset\nmore\n');
        await repo.deleteData(ws, key);
        expect(await repo.readData(ws, key)).toBeNull();
        expect((await repo.exportWorkspace(ws)).data).toEqual([]);
      });
    });

    describe('shares', () => {
      test('create, read (structured payload), list, delete', async ({ repo, ws }) => {
        const payload = { cards: [{ q: 'Q1', a: 'A1' }], grid: [[1, 2], [3, 4]], meta: { n: null, ok: true } };
        const { shareId: first } = await repo.createShare(ws, { kind: 'deck', title: 'Deck', payload });
        await sleep(5);
        const { shareId: second } = await repo.createShare(ws, { kind: 'note', title: 'Note', payload: '# Hi' });

        const share = await repo.getShare(first);
        expect(share).toMatchObject({ shareId: first, ownerWs: ws, kind: 'deck', title: 'Deck', payload });
        expect(share!.createdAt).toMatch(ISO);

        const mine = await repo.listMyShares(ws);
        expect(mine.map((s) => s.shareId)).toEqual([second, first]);
        expect(mine[0]).not.toHaveProperty('payload');

        expect(await repo.getShare('does-not-exist')).toBeNull();
        await repo.deleteShare(ws, first);
        expect(await repo.getShare(first)).toBeNull();
        await expect(repo.deleteShare(ws, first)).rejects.toBeInstanceOf(NotFoundError);
        expect((await repo.listMyShares(ws)).map((s) => s.shareId)).toEqual([second]);
      });

      test('only the owner can delete; workspaces are isolated', async ({ repo, ws, otherWs }) => {
        if (!otherWs) return;
        const { shareId } = await repo.createShare(ws, { kind: 'quiz', title: 'Quiz', payload: [] });
        await expect(repo.deleteShare(otherWs, shareId)).rejects.toBeInstanceOf(PermissionError);
        expect(await repo.listMyShares(otherWs)).toEqual([]);
        expect(await repo.getShare(shareId)).not.toBeNull();

        await repo.writeNote(ws, 'Mine.md', 'mine');
        expect(await repo.readNote(otherWs, 'Mine.md')).toBeNull();
        expect((await repo.listTree(otherWs)).notes).toEqual([]);
      });
    });

    test('foreign workspaces are rejected with PermissionError', async ({ repo, foreignWs }) => {
      if (!foreignWs) return;
      await expect(repo.listTree(foreignWs)).rejects.toBeInstanceOf(PermissionError);
      await expect(repo.writeNote(foreignWs, 'x.md', 'x')).rejects.toBeInstanceOf(PermissionError);
      await expect(repo.readData(foreignWs, '.vault/srs.json')).rejects.toBeInstanceOf(PermissionError);
    });

    test('exportWorkspace returns notes, folders and data', async ({ repo, ws }) => {
      await repo.writeNote(ws, 'B/two.md', '2');
      await repo.writeNote(ws, 'one.md', '1');
      await repo.mkdir(ws, 'Empty');
      await repo.writeData(ws, '.vault/cards.json', '{}');
      await repo.appendData(ws, '.vault/srs-log.jsonl', 'l1\n');
      expect(await repo.exportWorkspace(ws)).toEqual({
        notes: [
          { path: 'B/two.md', body: '2' },
          { path: 'one.md', body: '1' },
        ],
        folders: ['B', 'Empty'],
        data: [
          { key: '.vault/cards.json', text: '{}' },
          { key: '.vault/srs-log.jsonl', text: 'l1\n' },
        ],
      });
    });

    test('watch reports add/change/unlink/addDir/unlinkDir', async ({ repo, ws, watchSettleMs }) => {
      if (!repo.watch) return;
      const events: CloudWatchEvent[] = [];
      const stop = repo.watch(ws, (e) => events.push(e));
      try {
        if (watchSettleMs) await sleep(watchSettleMs);
        await repo.writeNote(ws, 'W.md', 'a');
        await vi.waitFor(() => expect(events).toContainEqual({ type: 'add', path: 'W.md' }), { timeout: 5000 });
        await repo.writeNote(ws, 'W.md', 'b');
        await vi.waitFor(() => expect(events).toContainEqual({ type: 'change', path: 'W.md' }), { timeout: 5000 });
        await repo.rename(ws, 'W.md', 'V.md');
        await vi.waitFor(
          () => {
            expect(events).toContainEqual({ type: 'unlink', path: 'W.md' });
            expect(events).toContainEqual({ type: 'add', path: 'V.md' });
          },
          { timeout: 5000 },
        );
        await repo.mkdir(ws, 'Dir');
        await vi.waitFor(() => expect(events).toContainEqual({ type: 'addDir', path: 'Dir' }), { timeout: 5000 });
        await repo.remove(ws, 'Dir');
        await vi.waitFor(() => expect(events).toContainEqual({ type: 'unlinkDir', path: 'Dir' }), { timeout: 5000 });
        await repo.remove(ws, 'V.md');
        await vi.waitFor(() => expect(events).toContainEqual({ type: 'unlink', path: 'V.md' }), { timeout: 5000 });
      } finally {
        stop();
      }
      const count = events.length;
      await repo.writeNote(ws, 'After.md', 'x');
      await sleep(50);
      expect(events.length).toBe(count);
    });
  });
}
