/**
 * Keeps quiz history, active days and recent files in sync with the vault's
 * `.vault/` data: disk on desktop, the signed-in account's cloud on web.
 * Each device merges its local copy in (see progressSync), so a new browser
 * profile or device adds to the shared progress instead of replacing it.
 */
import { useEffect, useRef } from 'react';
import { getBackend } from '../backend';
import type { DailyActivityStore } from './dailyActivity';
import type { QuizHistoryStore } from './history';
import { syncProgress, type ProgressRemote } from './progressSync';

const SYNC_DELAY_MS = 2_000;
/** Days recorded before a vault was open (same browser, same person). */
const PRE_VAULT_DAYS_KEY = 'mv:daily-activity:__default__';

function remoteFor(root: string): ProgressRemote | null {
  const api = getBackend().vault;
  if (!root || !api?.readData || !api.writeData) return null;
  const { readData, writeData } = api;
  return {
    readData: (key) => readData(root, key),
    writeData: async (key, text) => {
      await writeData(root, key, text);
    },
  };
}

function preVaultDays(): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(PRE_VAULT_DAYS_KEY) || '[]');
    return Array.isArray(parsed) ? parsed.filter((day): day is string => typeof day === 'string') : [];
  } catch {
    return [];
  }
}

type Options = {
  root: string | null;
  history: QuizHistoryStore;
  activity: DailyActivityStore;
  recent: string[];
  setRecent: (paths: string[]) => void;
};

export function useProgressSync({ root, history, activity, recent, setRecent }: Options): void {
  const recentRef = useRef(recent);
  recentRef.current = recent;
  const setRecentRef = useRef(setRecent);
  setRecentRef.current = setRecent;
  const scheduleRef = useRef<() => void>(() => {});
  /** Recents last read from or written to the vault; adopting them needs no new sync. */
  const syncedRecentRef = useRef<string | null>(null);

  useEffect(() => {
    const remote = remoteFor(root ?? '');
    if (!remote) return undefined;
    let disposed = false;
    let running = false;
    let again = false;
    let applying = false;
    let timer: number | undefined;

    const run = async () => {
      if (running) {
        again = true;
        return;
      }
      running = true;
      try {
        const merged = await syncProgress(remote, {
          attempts: history.getAll(),
          days: [...activity.getDays(), ...preVaultDays()],
          recent: recentRef.current,
        });
        if (disposed) return;
        applying = true;
        try {
          history.mergeAttempts(merged.attempts);
          activity.mergeDays(merged.days);
          syncedRecentRef.current = merged.recent.join('\n');
          if (merged.recent.join('\n') !== recentRef.current.join('\n')) setRecentRef.current(merged.recent);
        } finally {
          applying = false;
        }
      } catch (error) {
        console.warn('[progress] sync failed; will retry on the next change', error);
      } finally {
        running = false;
        if (again && !disposed) {
          again = false;
          schedule();
        }
      }
    };

    const schedule = () => {
      if (applying || disposed) return;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => void run(), SYNC_DELAY_MS);
    };
    scheduleRef.current = schedule;

    const flush = () => {
      if (document.visibilityState !== 'hidden' || timer === undefined) return;
      window.clearTimeout(timer);
      timer = undefined;
      void run();
    };

    void run();
    const unsubscribeHistory = history.subscribe(schedule);
    const unsubscribeActivity = activity.subscribe(schedule);
    document.addEventListener('visibilitychange', flush);
    return () => {
      disposed = true;
      window.clearTimeout(timer);
      scheduleRef.current = () => {};
      unsubscribeHistory();
      unsubscribeActivity();
      document.removeEventListener('visibilitychange', flush);
    };
  }, [root, history, activity]);

  // Opening a file reorders recents; sync that too.
  const recentKey = recent.join('\n');
  useEffect(() => {
    if (recentKey !== syncedRecentRef.current) scheduleRef.current();
  }, [recentKey]);
}
