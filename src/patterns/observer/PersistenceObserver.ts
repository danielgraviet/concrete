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

  /** Run the pending save immediately (if any). */
  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const fn = this.pendingSave;
    this.pendingSave = null;
    if (!fn || this.saving) return;

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
    }
  }

  update(event: EditorStateEvent): void {
    if (event.type === 'saved') {
      this.cancel();
    }
  }
}
