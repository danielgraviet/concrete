import type { BlockType } from '../types';

/** Visitor over the document / block tree. */
export interface BlockVisitor {
  visitDocument(node: BlockNode): void;
  visitHeading(node: BlockNode): void;
  visitParagraph(node: BlockNode): void;
  visitList(node: BlockNode): void;
  visitListItem(node: BlockNode): void;
  visitQuote(node: BlockNode): void;
  visitCode(node: BlockNode): void;
  visitThematicBreak(node: BlockNode): void;
  visitWikilink(node: BlockNode): void;
  visitTag(node: BlockNode): void;
  visitQuizCard(node: BlockNode): void;
}

/**
 * Component in the Composite pattern.
 * Leaves ignore child mutations; composites own a child list.
 */
export interface BlockNode {
  readonly id: string;
  readonly type: BlockType;
  /** True when this node may own children. */
  readonly isComposite: boolean;

  add(child: BlockNode, index?: number): void;
  remove(child: BlockNode): boolean;
  getChild(index: number): BlockNode | undefined;
  getChildren(): readonly BlockNode[];
  toMarkdown(): string;
  accept(visitor: BlockVisitor): void;
  clone(): BlockNode;
}

export abstract class BaseBlock implements BlockNode {
  abstract readonly type: BlockType;
  readonly isComposite: boolean = false;

  constructor(readonly id: string) {}

  add(_child: BlockNode, _index?: number): void {
    throw new Error(`${this.type} is a leaf and cannot contain children`);
  }

  remove(_child: BlockNode): boolean {
    return false;
  }

  getChild(_index: number): BlockNode | undefined {
    return undefined;
  }

  getChildren(): readonly BlockNode[] {
    return [];
  }

  abstract toMarkdown(): string;
  abstract accept(visitor: BlockVisitor): void;
  abstract clone(): BlockNode;
}

export abstract class CompositeBlock extends BaseBlock {
  override readonly isComposite = true;
  protected children: BlockNode[] = [];

  add(child: BlockNode, index?: number): void {
    if (index === undefined || index >= this.children.length) {
      this.children.push(child);
      return;
    }
    const at = Math.max(0, index);
    this.children.splice(at, 0, child);
  }

  remove(child: BlockNode): boolean {
    const index = this.children.findIndex((c) => c.id === child.id);
    if (index < 0) return false;
    this.children.splice(index, 1);
    return true;
  }

  getChild(index: number): BlockNode | undefined {
    return this.children[index];
  }

  getChildren(): readonly BlockNode[] {
    return this.children;
  }

  protected cloneChildren(): BlockNode[] {
    return this.children.map((c) => c.clone());
  }
}
