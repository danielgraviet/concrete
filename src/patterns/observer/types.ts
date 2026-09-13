/** Core Observer interfaces for editor & persistence notifications. */

export interface Observer<TEvent> {
  update(event: TEvent): void;
}

export interface Subject<TEvent> {
  attach(observer: Observer<TEvent>): void;
  detach(observer: Observer<TEvent>): void;
  notify(event: TEvent): void;
}

export type EditorSelection = {
  from: number;
  to: number;
  text?: string;
};

export type EditorStateEvent =
  | { type: 'content'; content: string; previous: string }
  | { type: 'dirty'; isDirty: boolean }
  | { type: 'saved'; content: string; at: number }
  | { type: 'selection'; selection: EditorSelection | null };

export type PersistenceEvent =
  | { type: 'save-scheduled'; delayMs: number }
  | { type: 'save-started' }
  | { type: 'save-completed'; ok: boolean; error?: string }
  | { type: 'save-cancelled' };

/** External vault/file change that should sync into the editor. */
export type VaultSyncEvent = {
  path: string;
  content: string;
  reason: 'external-write' | 'reload' | 'watch';
};
