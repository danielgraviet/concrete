/**
 * Synchronous "save now" hooks for when the page is hidden or unloading.
 *
 * The editor debounces autosave (~800 ms). If the tab closes inside that
 * window the edit never reaches the vault. Registered flushers run on
 * `visibilitychange` (hidden), `pagehide` and `beforeunload`, in the capture
 * phase so they run before other listeners on those events (the web shell's
 * unload warning and the cloud vault's own flush). A flusher must hand its
 * pending change to the vault synchronously; on web the cloud vault journals
 * it to localStorage inside that same call.
 */

type Flusher = () => void;

const flushers = new Set<Flusher>();
let installed = false;

/** Run every registered flusher now. Errors are logged, never thrown. */
export function runPageExitFlushes(): void {
  for (const flush of [...flushers]) {
    try {
      flush();
    } catch (error) {
      console.warn('[editor] flush on page exit failed', error);
    }
  }
}

const onVisibility = () => {
  if (document.visibilityState === 'hidden') runPageExitFlushes();
};

function install(): void {
  if (installed || typeof window === 'undefined' || typeof document === 'undefined') return;
  installed = true;
  document.addEventListener('visibilitychange', onVisibility, { capture: true });
  window.addEventListener('pagehide', runPageExitFlushes, { capture: true });
  window.addEventListener('beforeunload', runPageExitFlushes, { capture: true });
}

/** Register `flush`; returns the unregister function. */
export function registerPageExitFlush(flush: Flusher): () => void {
  flushers.add(flush);
  install();
  return () => {
    flushers.delete(flush);
  };
}
