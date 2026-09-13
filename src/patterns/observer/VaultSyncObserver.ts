import { BaseSubject } from './BaseSubject';
import type { Observer, VaultSyncEvent } from './types';

/**
 * Interface for reacting to external file changes (watchers, reloads).
 * Implement update() to push new content into the editor when safe.
 */
export interface VaultSyncObserver extends Observer<VaultSyncEvent> {
  update(event: VaultSyncEvent): void;
}

/**
 * Broadcast subject for vault/file sync events.
 * Wire Electron watchers or IPC here; attach VaultSyncObserver implementations.
 */
export class VaultSyncSubject extends BaseSubject<VaultSyncEvent> {
  /** Convenience: emit an external write for a path. */
  emitExternalWrite(path: string, content: string): void {
    this.notify({ path, content, reason: 'external-write' });
  }

  emitReload(path: string, content: string): void {
    this.notify({ path, content, reason: 'reload' });
  }

  emitWatch(path: string, content: string): void {
    this.notify({ path, content, reason: 'watch' });
  }
}

/**
 * Default observer: applies external content via a callback when the note
 * is not dirty (or when force is true).
 */
export class DefaultVaultSyncObserver implements VaultSyncObserver {
  constructor(
    private readonly options: {
      getActivePath: () => string | null;
      isDirty: () => boolean;
      applyContent: (content: string) => void;
      /** When true, overwrite even if dirty. Default false. */
      force?: boolean;
    },
  ) {}

  update(event: VaultSyncEvent): void {
    const active = this.options.getActivePath();
    if (active !== null && active !== event.path) return;
    if (!this.options.force && this.options.isDirty()) return;
    this.options.applyContent(event.content);
  }
}
