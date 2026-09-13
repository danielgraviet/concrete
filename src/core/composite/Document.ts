import { createId, noteTitleFromPath } from '../types';
import { CompositeBlock, type BlockNode, type BlockVisitor } from './BlockNode';
import { findBlock, findParent } from './blocks';

/** Root composite for a note's block tree. */
export class Document extends CompositeBlock {
  readonly type = 'document' as const;

  constructor(id = createId('doc')) {
    super(id);
  }

  toMarkdown(): string {
    return this.children
      .map((c) => c.toMarkdown())
      .filter((s) => s.length > 0)
      .join('\n\n');
  }

  accept(visitor: BlockVisitor): void {
    visitor.visitDocument(this);
    for (const child of this.children) child.accept(visitor);
  }

  clone(): Document {
    const copy = new Document(this.id);
    for (const child of this.cloneChildren()) copy.add(child);
    return copy;
  }

  find(id: string): BlockNode | undefined {
    return findBlock(this, id);
  }

  findParentOf(id: string): BlockNode | undefined {
    return findParent(this, id);
  }

  /** Replace a direct or nested child, preserving position. */
  replaceBlock(id: string, next: BlockNode): boolean {
    const parent = this.findParentOf(id);
    if (!parent || !parent.isComposite) return false;
    const kids = [...parent.getChildren()];
    const index = kids.findIndex((c) => c.id === id);
    if (index < 0) return false;
    const existing = kids[index]!;
    parent.remove(existing);
    parent.add(next, index);
    return true;
  }

  static empty(): Document {
    return new Document();
  }
}

/**
 * Editable note originator used by Command and Memento layers.
 * Holds path metadata plus the composite document tree.
 */
export class NoteModel {
  constructor(
    public path: string,
    public document: Document = Document.empty(),
  ) {}

  get title(): string {
    return noteTitleFromPath(this.path);
  }

  toMarkdown(): string {
    return this.document.toMarkdown();
  }

  cloneDocument(): Document {
    return this.document.clone();
  }
}
