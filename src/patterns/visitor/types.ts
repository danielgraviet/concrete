/**
 * Local Block-like types so visitors compile even if src/core/composite
 * is missing. When core BlockNode.accept(visitor) exists, pass those nodes
 * through the same DocumentVisitor interface.
 */

export type BlockKind =
  | 'document'
  | 'heading'
  | 'paragraph'
  | 'list'
  | 'listItem'
  | 'code'
  | 'quote'
  | 'thematicBreak'
  | 'text';

export interface BlockNode {
  kind: BlockKind;
  /** Raw / plain text for this block (headings, paragraphs, code, etc.). */
  text?: string;
  /** Heading level 1–6. */
  level?: number;
  children?: BlockNode[];
  /** Optional Composite accept — present when wired to src/core. */
  accept?(visitor: DocumentVisitor): void;
}

/** Duck-typed node from core composite or local markdown walk. */
export type VisitableNode = BlockNode & {
  kind: string;
  accept?(visitor: DocumentVisitor): void;
};

/**
 * Visitor for document structure.
 * Prefer kind-specific methods when present; otherwise use visit(node).
 */
export interface DocumentVisitor {
  visit?(node: VisitableNode): void;
  visitDocument?(node: VisitableNode): void;
  visitHeading?(node: VisitableNode): void;
  visitParagraph?(node: VisitableNode): void;
  visitList?(node: VisitableNode): void;
  visitListItem?(node: VisitableNode): void;
  visitCode?(node: VisitableNode): void;
  visitQuote?(node: VisitableNode): void;
  visitThematicBreak?(node: VisitableNode): void;
  visitText?(node: VisitableNode): void;
}

/** Note payload passed into indexing / link visitors. */
export type NoteInput = {
  path: string;
  content: string;
  /** Optional display title; defaults to basename without .md */
  title?: string;
};

export function noteTitle(path: string, content?: string, explicit?: string): string {
  if (explicit?.trim()) return explicit.trim();
  if (content) {
    const heading = content.match(/^#\s+(.+)$/m);
    if (heading?.[1]) return heading[1].trim();
  }
  const base = path.split(/[/\\]/).pop() ?? path;
  return base.replace(/\.md$/i, '');
}
