import type { NoteModel } from '../composite/Document';
import { DocumentMemento } from './DocumentMemento';

const DEFAULT_MAX = 50;

/**
 * Caretaker for document history snapshots.
 * Walk backward / forward independently of CommandHistory.
 */
export class HistoryCaretaker {
  private snapshots: DocumentMemento[] = [];
  private cursor = -1;

  constructor(private readonly maxSize: number = DEFAULT_MAX) {}

  /** Capture current note state and discard any redo branch. */
  save(note: NoteModel, label?: string): DocumentMemento {
    if (this.cursor < this.snapshots.length - 1) {
      this.snapshots = this.snapshots.slice(0, this.cursor + 1);
    }
    const memento = DocumentMemento.capture(note, label);
    this.snapshots.push(memento);
    if (this.snapshots.length > this.maxSize) {
      this.snapshots.shift();
    } else {
      this.cursor += 1;
    }
    // After a shift, cursor stays at last index
    this.cursor = this.snapshots.length - 1;
    return memento;
  }

  canRestorePrevious(): boolean {
    return this.cursor > 0;
  }

  canRestoreNext(): boolean {
    return this.cursor >= 0 && this.cursor < this.snapshots.length - 1;
  }

  /** Move to the previous snapshot and restore it. */
  restorePrevious(note: NoteModel): boolean {
    if (!this.canRestorePrevious()) return false;
    this.cursor -= 1;
    this.snapshots[this.cursor]!.restore(note);
    return true;
  }

  /** Move to the next snapshot and restore it. */
  restoreNext(note: NoteModel): boolean {
    if (!this.canRestoreNext()) return false;
    this.cursor += 1;
    this.snapshots[this.cursor]!.restore(note);
    return true;
  }

  /** Restore a specific snapshot by index without changing the cursor branch. */
  restoreAt(index: number, note: NoteModel): boolean {
    const memento = this.snapshots[index];
    if (!memento) return false;
    this.cursor = index;
    memento.restore(note);
    return true;
  }

  list(): readonly DocumentMemento[] {
    return this.snapshots;
  }

  get currentIndex(): number {
    return this.cursor;
  }

  clear(): void {
    this.snapshots = [];
    this.cursor = -1;
  }
}
