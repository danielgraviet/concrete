import { createElectronBackend } from './electron';
import { createWebBackend } from './web';
import type { Backend } from './types';

export type * from './types';

function createBackend(): Backend {
  const target = import.meta.env?.VITE_TARGET ?? 'desktop';
  return target === 'web' ? createWebBackend() : createElectronBackend();
}

let current: Backend | null = null;

/** The platform backend for this build (memoized). */
export function getBackend(): Backend {
  current ??= createBackend();
  return current;
}

/** Replace the backend in tests; `null` restores the default on next `getBackend()`. */
export function setBackendForTesting(backend: Backend | null): void {
  current = backend;
}
