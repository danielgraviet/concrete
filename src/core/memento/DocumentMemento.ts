import type { Document } from '../composite/Document';
import type { NoteModel } from '../composite/Document';

/**
 * Opaque snapshot of a note's path + document tree.
 * Independent of the Command undo stack.
 */
export class DocumentMemento {
  private constructor(
    private readonly path: string,
    private readonly document: Document,
    private readonly label: string | undefined,
    private readonly timestamp: number,
  ) {}

  static capture(
    note: NoteModel,
    label?: string,
    timestamp = Date.now(),
  ): DocumentMemento {
    return new DocumentMemento(
      note.path,
      note.cloneDocument(),
      label,
      timestamp,
    );
  }

  getPath(): string {
    return this.path;
  }

  getLabel(): string | undefined {
    return this.label;
  }

  getTimestamp(): number {
    return this.timestamp;
  }

  /** Markdown at the time of capture (derived from the cloned tree). */
  getMarkdown(): string {
    return this.document.toMarkdown();
  }

  /** Apply this snapshot onto a live note model. */
  restore(note: NoteModel): void {
    note.path = this.path;
    note.document = this.document.clone();
  }
}
