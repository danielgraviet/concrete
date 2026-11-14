import { BaseSubject } from './BaseSubject';
import type { EditorStateEvent, Observer, PersistenceEvent } from './types';

export type SaveFn = () => void | Promise<void>;

export type PersistenceObserverOptions = {
  /** Debounce window in ms (default 800). */
  debounceMs?: number;
};

/**
 * Observes editor dirty/content events and schedules debounced autosave.
 * Also exposes scheduleSave(fn) for imperative / blur / Cmd+S paths.
 */
export class PersistenceObserver
  extends BaseSubject<PersistenceEvent>
  implements Observer<EditorStateEvent>
{
  private readonly debounceMs: number;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pendingSave: SaveFn | null = null;
  private saving = false;
  private flushAfterSave = false;

  constructor(options: PersistenceObserverOptions = {}) {
    super();
    this.debounceMs = options.debounceMs ?? 800;
  }

  /** Debounced autosave API — call with the save function to run. */
  scheduleSave(fn: SaveFn): void {
    this.pendingSave = fn;
    if (this.timer) clearTimeout(this.timer);
    this.notify({ type: 'save-scheduled', delayMs: this.debounceMs });
    this.timer = setTimeout(() => {
      void this.flush();
    }, this.debounceMs);
  }

  /** Cancel a pending debounced save. */
  cancel(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.pendingSave = null;
    this.notify({ type: 'save-cancelled' });
  }

  /**
   * Run the pending save immediately (if any). The save function is called
   * synchronously, so a flush from a page-exit handler reaches the vault
   * before the handler returns. While a save is running, the pending one is
   * kept and runs when it finishes (it used to be dropped).
   */
  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const fn = this.pendingSave;
    if (!fn) return;
    if (this.saving) {
      this.flushAfterSave = true;
      return;
    }
    this.pendingSave = null;

    this.saving = true;
    this.notify({ type: 'save-started' });
    try {
      await fn();
      this.notify({ type: 'save-completed', ok: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.notify({ type: 'save-completed', ok: false, error: message });
    } finally {
      this.saving = false;
      if (this.flushAfterSave) {
        this.flushAfterSave = false;
        if (this.pendingSave) void this.flush();
      }
    }
  }

  update(event: EditorStateEvent): void {
    if (event.type === 'saved') {
      this.cancel();
    }
  }
}
