import { BaseSubject } from './BaseSubject';
import type { EditorSelection, EditorStateEvent } from './types';

/**
 * Subject for editor lifecycle: content, dirty/saved, selection.
 * Call the mutators from the editor controller; observers react.
 */
export class EditorStateSubject extends BaseSubject<EditorStateEvent> {
  private content = '';
  private dirty = false;
  private selection: EditorSelection | null = null;

  getContent(): string {
    return this.content;
  }

  isDirty(): boolean {
    return this.dirty;
  }

  getSelection(): EditorSelection | null {
    return this.selection;
  }

  setContent(next: string, options?: { markDirty?: boolean }): void {
    const previous = this.content;
    if (previous === next) return;
    this.content = next;
    this.notify({ type: 'content', content: next, previous });
    if (options?.markDirty !== false) {
      this.setDirty(true);
    }
  }

  /** Replace content without marking dirty (e.g. load from disk). */
  loadContent(next: string): void {
    const previous = this.content;
    this.content = next;
    if (previous !== next) {
      this.notify({ type: 'content', content: next, previous });
    }
    this.setDirty(false);
  }

  setDirty(isDirty: boolean): void {
    if (this.dirty === isDirty) return;
    this.dirty = isDirty;
    this.notify({ type: 'dirty', isDirty });
  }

  markSaved(content?: string): void {
    if (content !== undefined) {
      this.content = content;
    }
    this.setDirty(false);
    this.notify({ type: 'saved', content: this.content, at: Date.now() });
  }

  setSelection(selection: EditorSelection | null): void {
    const same =
      (this.selection === null && selection === null) ||
      (this.selection !== null &&
        selection !== null &&
        this.selection.from === selection.from &&
        this.selection.to === selection.to &&
        this.selection.text === selection.text);
    if (same) return;
    this.selection = selection;
    this.notify({ type: 'selection', selection });
  }
}
