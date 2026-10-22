import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { settingsStore } from '../settings';
import { CardIndex } from './CardIndex';
import { queueCounts, type QueueCounts } from './ReviewSession';
import { ReviewStateStore } from './ReviewStateStore';
import { Scheduler } from './scheduler';
import type { ReviewCard, ReviewSettings } from './types';

const RECONCILE_DELAY_MS = 1500;

export type ReviewSystem = {
  index: CardIndex;
  store: ReviewStateStore;
  scheduler: Scheduler;
  settings: ReviewSettings;
  /** Every card in the vault that is in review (inactive quiz questions excluded). */
  cards: ReviewCard[];
  /** Today's queue for the whole vault. */
  due: QueueCounts;
  /** Bumps when cards, history or the clock change, for memoizing derived counts. */
  revision: string;
};

/**
 * Wires the card index (what cards exist) to the review store (their history)
 * for one vault, and keeps the two consistent as notes change.
 */
export function useReviewSystem(root: string | null): ReviewSystem {
  const index = useMemo(() => new CardIndex(), [root]);
  const store = useMemo(() => new ReviewStateStore(root ?? ''), [root]);
  const [settings, setSettings] = useState<ReviewSettings>(() => settingsStore.get().review);
  const [minute, setMinute] = useState(() => Math.floor(Date.now() / 60_000));

  useEffect(() => settingsStore.subscribe((next) => setSettings(next.review)), []);

  useEffect(() => {
    void store.load();
    const flush = () => store.flush();
    window.addEventListener('beforeunload', flush);
    return () => {
      window.removeEventListener('beforeunload', flush);
      store.flush();
    };
  }, [store]);

  // Cards come due as time passes.
  useEffect(() => {
    const timer = window.setInterval(() => setMinute(Math.floor(Date.now() / 60_000)), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const indexVersion = useSyncExternalStore(index.subscribe, index.getVersion);
  const storeVersion = useSyncExternalStore(store.subscribe, store.getVersion);
  const scheduler = useMemo(() => new Scheduler(settings.retention), [settings.retention]);

  // Re-attach history to edited/moved cards once the whole vault has been read.
  useEffect(() => {
    if (!index.complete || !store.isLoaded) return;
    const timer = window.setTimeout(() => store.reconcile(index.all(), Date.now()), RECONCILE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [index, store, indexVersion, store.isLoaded]);

  const cards = useMemo(
    () => index.all().filter((card) => store.isActive(card)),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- versions drive recomputation
    [index, store, indexVersion, storeVersion],
  );
  const due = useMemo(
    () => queueCounts(cards, store, settings, Date.now()),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- minute tick re-evaluates due times
    [cards, store, settings, storeVersion, minute],
  );

  return {
    index,
    store,
    scheduler,
    settings,
    cards,
    due,
    revision: `${indexVersion}:${storeVersion}:${minute}`,
  };
}
