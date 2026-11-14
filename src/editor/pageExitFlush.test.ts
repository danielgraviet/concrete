import { describe, expect, it, vi } from 'vitest';
import { PersistenceObserver } from '../patterns/observer/PersistenceObserver';
import { registerPageExitFlush, runPageExitFlushes } from './pageExitFlush';

describe('page exit flush', () => {
  it('pushes a debounced editor save into the vault synchronously', () => {
    vi.useFakeTimers();
    try {
      const persistence = new PersistenceObserver({ debounceMs: 800 });
      const written: string[] = [];
      // Mirrors App.tsx: saveFn calls vault.write before its first await.
      persistence.scheduleSave(async () => {
        written.push('latest text');
        await Promise.resolve();
      });
      const off = registerPageExitFlush(() => void persistence.flush());
      runPageExitFlushes();
      expect(written).toEqual(['latest text']); // no timers, no microtasks needed
      off();
      persistence.scheduleSave(() => {
        written.push('again');
      });
      runPageExitFlushes();
      expect(written).toEqual(['latest text']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps a save requested while another save is running', async () => {
    const persistence = new PersistenceObserver({ debounceMs: 800 });
    const written: string[] = [];
    let release!: () => void;
    persistence.scheduleSave(() => new Promise<void>((resolve) => (release = resolve)));
    const first = persistence.flush();
    persistence.scheduleSave(() => {
      written.push('second');
    });
    void persistence.flush(); // used to drop the pending save
    release();
    await first;
    await Promise.resolve();
    expect(written).toEqual(['second']);
  });

  it('a throwing flusher does not stop the others', () => {
    const calls: string[] = [];
    const offA = registerPageExitFlush(() => {
      throw new Error('boom');
    });
    const offB = registerPageExitFlush(() => calls.push('b'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    runPageExitFlushes();
    expect(calls).toEqual(['b']);
    offA();
    offB();
    warn.mockRestore();
  });
});
