import type { Backend, BackendCapabilities } from '../types';

/**
 * The ONLY module in `src/` allowed to touch the Electron preload globals
 * (`window.vault`, `window.ai`, …). Enforced by `src/backend/boundary.test.ts`.
 *
 * Members are getters that read `window.*` on every access, so behavior is
 * identical to the old direct reads: a bridge missing in demo mode reads as
 * undefined, and non-DOM environments (vitest/node) never throw.
 */
function bridges(): Window | undefined {
  return typeof window === 'undefined' ? undefined : window;
}

export function createElectronBackend(): Backend {
  const capabilities: BackendCapabilities = {
    get localAgents() {
      return typeof bridges()?.ai?.agentRun === 'function';
    },
    get revealInFolder() {
      return typeof bridges()?.vault?.revealInFolder === 'function';
    },
    get openWithOsApp() {
      return typeof bridges()?.vault?.openPath === 'function';
    },
    get diskImport() {
      const vault = bridges()?.vault;
      return typeof vault?.importObsidian === 'function'
        && typeof vault.importNotion === 'function'
        && typeof vault.importFile === 'function';
    },
    get nativePdfExport() {
      return typeof bridges()?.vault?.exportNotePdf === 'function';
    },
    get localTelemetry() {
      return typeof bridges()?.ai?.telemetry === 'function';
    },
    get sandbox() {
      return Boolean(bridges()?.sandbox);
    },
    get apiKeySettings() {
      return typeof bridges()?.ai?.setApiKey === 'function';
    },
  };

  return {
    target: 'desktop',
    get vault() {
      return bridges()?.vault;
    },
    get ai() {
      return bridges()?.ai;
    },
    get sandbox() {
      return bridges()?.sandbox;
    },
    get clipboard() {
      return bridges()?.systemClipboard;
    },
    get perf() {
      return bridges()?.perf;
    },
    get integrations() {
      return bridges()?.integrations;
    },
    capabilities,
  };
}
