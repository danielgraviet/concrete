import type { BlockNode } from '../composite/BlockNode';
import {
  HeadingBlock,
  ParagraphBlock,
} from '../composite/blocks';
import type { Document, NoteModel } from '../composite/Document';
import { createId, type HeadingLevel } from '../types';
import type { EditorCommand } from './CommandHistory';

export type { EditorCommand } from './CommandHistory';

function assertParent(
  document: Document,
  blockId: string,
): { parent: BlockNode; index: number; block: BlockNode } {
  const parent = document.findParentOf(blockId);
  const block = document.find(blockId);
  if (!parent || !block) {
    throw new Error(`Block not found: ${blockId}`);
  }
  const index = parent.getChildren().findIndex((c) => c.id === blockId);
  if (index < 0) throw new Error(`Block not found in parent: ${blockId}`);
  return { parent, index, block };
}

/** Insert a block under a composite parent (defaults to document root). */
export class InsertBlockCommand implements EditorCommand {
  readonly label = 'Insert block';
  private inserted = false;

  constructor(
    private readonly document: Document,
    private readonly block: BlockNode,
    private readonly parentId?: string,
    private readonly index?: number,
  ) {}

  execute(): void {
    const parent = this.parentId
      ? this.document.find(this.parentId)
      : this.document;
    if (!parent || !parent.isComposite) {
      throw new Error('Insert target is not a composite block');
    }
    parent.add(this.block, this.index);
    this.inserted = true;
  }

  undo(): void {
    if (!this.inserted) return;
    const parent = this.parentId
      ? this.document.find(this.parentId)
      : this.document;
    parent?.remove(this.block);
    this.inserted = false;
  }
}

/** Remove a block from its parent. */
export class DeleteBlockCommand implements EditorCommand {
  readonly label = 'Delete block';
  private snapshot: { parentId: string; index: number; block: BlockNode } | null =
    null;

  constructor(
    private readonly document: Document,
    private readonly blockId: string,
  ) {}

  execute(): void {
    const { parent, index, block } = assertParent(this.document, this.blockId);
    this.snapshot = { parentId: parent.id, index, block: block.clone() };
    parent.remove(block);
  }

  undo(): void {
    if (!this.snapshot) return;
    const parent =
      this.snapshot.parentId === this.document.id
        ? this.document
        : this.document.find(this.snapshot.parentId);
    if (!parent || !parent.isComposite) return;
    parent.add(this.snapshot.block.clone(), this.snapshot.index);
    this.snapshot = null;
  }
}

/** Replace the text content of a heading, paragraph, list item, quote, or code block. */
export class ReplaceTextCommand implements EditorCommand {
  readonly label = 'Replace text';
  private previous: string | null = null;

  constructor(
    private readonly document: Document,
    private readonly blockId: string,
    private readonly nextText: string,
  ) {}

  execute(): void {
    const block = this.document.find(this.blockId);
    if (!block) throw new Error(`Block not found: ${this.blockId}`);
    this.previous = readText(block);
    writeText(block, this.nextText);
  }

  undo(): void {
    if (this.previous === null) return;
    const block = this.document.find(this.blockId);
    if (!block) return;
    writeText(block, this.previous);
    this.previous = null;
  }
}

/** Rename the note path on a NoteModel (filesystem rename is left to the app layer). */
export class RenameNoteCommand implements EditorCommand {
  readonly label = 'Rename note';
  private previousPath: string | null = null;

  constructor(
    private readonly note: NoteModel,
    private readonly nextPath: string,
  ) {}

  execute(): void {
    this.previousPath = this.note.path;
    this.note.path = this.nextPath;
  }

  undo(): void {
    if (this.previousPath === null) return;
    this.note.path = this.previousPath;
    this.previousPath = null;
  }
}

/**
 * Toggle a paragraph ↔ heading, or cycle heading level when already a heading.
 * Pass `level` to force a specific heading level (paragraph → heading).
 */
export class ToggleHeadingCommand implements EditorCommand {
  readonly label = 'Toggle heading';
  private previous: BlockNode | null = null;
  private nextId: string | null = null;

  constructor(
    private readonly document: Document,
    private readonly blockId: string,
    private readonly level: HeadingLevel = 1,
  ) {}

  execute(): void {
    const current = this.document.find(this.blockId);
    if (!current) throw new Error(`Block not found: ${this.blockId}`);

    this.previous = current.clone();
    let next: BlockNode;

    if (current instanceof HeadingBlock) {
      if (this.level !== current.level) {
        next = new HeadingBlock(current.id, this.level, current.text);
      } else {
        next = new ParagraphBlock(current.id, current.text);
      }
    } else if (current instanceof ParagraphBlock) {
      next = new HeadingBlock(current.id, this.level, current.text);
    } else {
      const text = readText(current);
      next = new HeadingBlock(createId('h'), this.level, text);
    }

    this.nextId = next.id;
    if (!this.document.replaceBlock(current.id, next)) {
      throw new Error(`Unable to replace block: ${this.blockId}`);
    }
  }

  undo(): void {
    if (!this.previous || !this.nextId) return;
    this.document.replaceBlock(this.nextId, this.previous.clone());
    this.previous = null;
    this.nextId = null;
  }
}

function readText(block: BlockNode): string {
  if ('text' in block && typeof (block as { text: unknown }).text === 'string') {
    return (block as { text: string }).text;
  }
  if ('code' in block && typeof (block as { code: unknown }).code === 'string') {
    return (block as { code: string }).code;
  }
  return block.toMarkdown();
}

function writeText(block: BlockNode, text: string): void {
  if ('text' in block) {
    (block as { text: string }).text = text;
    return;
  }
  if ('code' in block) {
    (block as { code: string }).code = text;
    return;
  }
  throw new Error(`Block type ${block.type} has no mutable text`);
}
