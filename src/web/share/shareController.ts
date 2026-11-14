import type { ShareTarget } from './types';

type Listener = (target: ShareTarget | null) => void;

/**
 * Tiny store connecting the app's "Share…" actions to the dialog host that
 * `startWeb` renders beside the app (so App.tsx imports no share UI).
 */
export interface ShareController {
  open(target: ShareTarget): void;
  close(): void;
  current(): ShareTarget | null;
  subscribe(listener: Listener): () => void;
}

export function createShareController(): ShareController {
  let target: ShareTarget | null = null;
  const listeners = new Set<Listener>();
  const set = (next: ShareTarget | null) => {
    target = next;
    for (const listener of [...listeners]) listener(next);
  };
  return {
    open: (next) => set(next),
    close: () => set(null),
    current: () => target,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
