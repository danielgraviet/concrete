import { describe, expect, it } from 'vitest';
import type { QuizAttempt } from './history';
import {
  loadRemoteProgress,
  MAX_PROGRESS_FILE_CHARS,
  mergeProgress,
  PROGRESS_MANIFEST,
  syncProgress,
  type Progress,
  type ProgressRemote,
} from './progressSync';

/**
 * State-based tests: progress goes in through the public API and the tests
 * check what the remote holds afterwards and what comes back out. The remote
 * is an in-memory fake that enforces the cloud's per-record size limit.
 */

class FakeRemote implements ProgressRemote {
  readonly data = new Map<string, string>();
  async readData(key: string): Promise<string | null> {
    return this.data.get(key) ?? null;
  }
  async writeData(key: string, text: string): Promise<void> {
    if (text.length > MAX_PROGRESS_FILE_CHARS) throw new Error(`"${key}" is too large`);
    this.data.set(key, text);
  }
  snapshot(): Record<string, string> {
    return Object.fromEntries([...this.data].sort(([a], [b]) => a.localeCompare(b)));
  }
}

const DAY = 24 * 60 * 60 * 1000;
const NOV_1 = Date.UTC(2026, 10, 1, 12);
const OCT_1 = Date.UTC(2026, 9, 1, 12);

function attempt(id: string, completedAt: number, extra: Partial<QuizAttempt> = {}): QuizAttempt {
  return {
    id,
    quizPath: `Quizzes/${id}.md`,
    quizTitle: id,
    sourcePaths: [],
    startedAt: completedAt - 60_000,
    completedAt,
    score: 8,
    maxScore: 10,
    percent: 80,
    questionCount: 10,
    perQuestion: [{ questionId: 'q1', score: 1, maxScore: 1, correct: true, prompt: 'What is 2+2?', answer: '4' }],
    stubbed: false,
    ...extra,
  };
}

function progress(partial: Partial<Progress>): Progress {
  return { attempts: [], days: [], recent: [], ...partial };
}

const ids = (p: Progress) => p.attempts.map((a) => a.id);

describe('mergeProgress', () => {
  it('unions attempts by id, oldest first, without duplicates', () => {
    const a = progress({ attempts: [attempt('b', NOV_1 + DAY), attempt('a', NOV_1)] });
    const b = progress({ attempts: [attempt('a', NOV_1), attempt('c', NOV_1 + 2 * DAY)] });

    expect(ids(mergeProgress(a, b))).toEqual(['a', 'b', 'c']);
  });

  it('unions active days, sorted, dropping malformed entries', () => {
    const merged = mergeProgress(
      progress({ days: ['2026-11-03', '2026-11-01', 'garbage'] }),
      progress({ days: ['2026-11-01', '2026-09-15'] }),
    );

    expect(merged.days).toEqual(['2026-09-15', '2026-11-01', '2026-11-03']);
  });

  it('keeps this device’s recent files first, then the other device’s, capped at 50', () => {
    const remoteRecent = Array.from({ length: 60 }, (_, i) => `r${i}.md`);
    const merged = mergeProgress(
      progress({ recent: ['b.md', 'a.md'] }),
      progress({ recent: ['a.md', 'c.md', ...remoteRecent] }),
    );

    expect(merged.recent.slice(0, 3)).toEqual(['b.md', 'a.md', 'c.md']);
    expect(merged.recent).toHaveLength(50);
    expect(new Set(merged.recent).size).toBe(50);
  });

  it('prefers a graded copy of an attempt over one still waiting for AI grading', () => {
    const pending = attempt('a', NOV_1, { score: 0, percent: 0, pendingAiGrade: {} as QuizAttempt['pendingAiGrade'] });
    const graded = attempt('a', NOV_1, { score: 9, percent: 90 });

    expect(mergeProgress(progress({ attempts: [pending] }), progress({ attempts: [graded] })).attempts).toEqual([graded]);
    expect(mergeProgress(progress({ attempts: [graded] }), progress({ attempts: [pending] })).attempts).toEqual([graded]);
  });

  it('prefers the copy that still has answer details over a trimmed one', () => {
    const detailed = attempt('a', NOV_1);
    const trimmed = attempt('a', NOV_1, {
      perQuestion: [{ questionId: 'q1', score: 1, maxScore: 1, correct: true }],
    });

    expect(mergeProgress(progress({ attempts: [trimmed] }), progress({ attempts: [detailed] })).attempts).toEqual([detailed]);
  });
});

describe('syncProgress', () => {
  it('uploads local progress to an empty remote and reads it back unchanged', async () => {
    const remote = new FakeRemote();
    const local = progress({
      attempts: [attempt('a', OCT_1), attempt('b', NOV_1)],
      days: ['2026-10-01', '2026-11-01'],
      recent: ['Notes/x.md'],
    });

    const merged = await syncProgress(remote, local);

    expect(merged).toEqual(local);
    expect(await loadRemoteProgress(remote)).toEqual(local);
  });

  it('merges two devices so both end up with everything', async () => {
    const remote = new FakeRemote();
    const laptop = progress({ attempts: [attempt('a', OCT_1)], days: ['2026-10-01'], recent: ['a.md'] });
    const browser = progress({ attempts: [attempt('b', NOV_1)], days: ['2026-11-01'], recent: ['b.md'] });

    await syncProgress(remote, laptop);
    const browserResult = await syncProgress(remote, browser);
    const laptopResult = await syncProgress(remote, laptop);

    expect(ids(browserResult)).toEqual(['a', 'b']);
    expect(ids(laptopResult)).toEqual(['a', 'b']);
    expect(laptopResult.days).toEqual(['2026-10-01', '2026-11-01']);
    expect((await loadRemoteProgress(remote)).recent).toEqual(['a.md', 'b.md']);
  });

  it('stores each month of attempts in its own file next to a small manifest', async () => {
    const remote = new FakeRemote();

    await syncProgress(remote, progress({ attempts: [attempt('a', OCT_1), attempt('b', NOV_1)] }));

    const keys = [...remote.data.keys()].sort();
    expect(keys).toContain(PROGRESS_MANIFEST);
    expect(keys.filter((key) => key !== PROGRESS_MANIFEST)).toHaveLength(2);
    for (const key of keys) expect(key).toMatch(/^\.vault\/[\w.-]+\.json$/);
  });

  it('keeps every score when a month is over the size limit, trimming answer details from the oldest', async () => {
    const remote = new FakeRemote();
    const bulky = 'x'.repeat(20_000);
    const heavyMonth = Array.from({ length: 60 }, (_, i) =>
      attempt(`n${String(i).padStart(2, '0')}`, NOV_1 + i * 60_000, {
        perQuestion: [{ questionId: 'q1', score: 1, maxScore: 1, correct: true, prompt: bulky, answer: bulky }],
      }),
    );

    await syncProgress(remote, progress({ attempts: heavyMonth }));
    const stored = await loadRemoteProgress(remote);

    expect(ids(stored)).toEqual(heavyMonth.map((a) => a.id));
    expect(stored.attempts.map((a) => a.score)).toEqual(heavyMonth.map((a) => a.score));
    expect(stored.attempts[0].perQuestion[0].prompt).toBeUndefined();
    expect(stored.attempts.at(-1)?.perQuestion[0].prompt).toBe(bulky);
  });

  it('treats corrupt remote data as empty and repairs it from this device', async () => {
    const remote = new FakeRemote();
    remote.data.set(PROGRESS_MANIFEST, '{not json');
    const local = progress({ attempts: [attempt('a', NOV_1)], days: ['2026-11-01'] });

    const merged = await syncProgress(remote, local);

    expect(merged).toEqual(local);
    expect(await loadRemoteProgress(remote)).toEqual(local);
  });

  it('leaves the remote untouched when syncing the same progress again', async () => {
    const remote = new FakeRemote();
    const local = progress({ attempts: [attempt('a', OCT_1), attempt('b', NOV_1)], days: ['2026-11-01'], recent: ['a.md'] });

    const first = await syncProgress(remote, local);
    const before = remote.snapshot();
    const second = await syncProgress(remote, first);

    expect(second).toEqual(first);
    expect(remote.snapshot()).toEqual(before);
  });
});
