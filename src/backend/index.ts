import { createElectronBackend } from './electron';
import type { Backend, BackendCapabilities } from './types';

export type * from './types';

const NO_CAPABILITIES: BackendCapabilities = {
  localAgents: false,
  revealInFolder: false,
  openWithOsApp: false,
  diskImport: false,
  nativePdfExport: false,
  localTelemetry: false,
  sandbox: false,
  apiKeySettings: false,
};

/**
 * Placeholder web backend: every service missing, every capability off.
 * Chosen over throwing so a `VITE_TARGET=web` build still renders the browser
 * demo mode (the same path the desktop renderer takes when bridges are absent).
 */
function createWebBackend(): Backend {
  return { target: 'web', capabilities: { ...NO_CAPABILITIES } };
}

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
