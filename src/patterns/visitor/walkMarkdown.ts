import type { BlockNode, DocumentVisitor, VisitableNode } from './types';

/**
 * Dispatch a node to the appropriate visitor method.
 * Works with local BlockNode or core nodes that expose accept().
 */
export function acceptNode(node: VisitableNode, visitor: DocumentVisitor): void {
  if (typeof node.accept === 'function') {
    node.accept(visitor);
    return;
  }
  dispatch(node, visitor);
  for (const child of node.children ?? []) {
    acceptNode(child, visitor);
  }
}

export function dispatch(node: VisitableNode, visitor: DocumentVisitor): void {
  const kind = node.kind;
  switch (kind) {
    case 'document':
      visitor.visitDocument?.(node);
      break;
    case 'heading':
      visitor.visitHeading?.(node);
      break;
    case 'paragraph':
      visitor.visitParagraph?.(node);
      break;
    case 'list':
      visitor.visitList?.(node);
      break;
    case 'listItem':
      visitor.visitListItem?.(node);
      break;
    case 'code':
      visitor.visitCode?.(node);
      break;
    case 'quote':
      visitor.visitQuote?.(node);
      break;
    case 'thematicBreak':
      visitor.visitThematicBreak?.(node);
      break;
    case 'text':
      visitor.visitText?.(node);
      break;
    default:
      break;
  }
  visitor.visit?.(node);
}

/** Strip YAML frontmatter fences so visitors see body only. */
export function stripFrontmatter(content: string): string {
  if (!content.startsWith('---')) return content;
  const end = content.indexOf('\n---', 3);
  if (end === -1) return content;
  const after = content.slice(end + 4);
  return after.replace(/^\r?\n/, '');
}

/**
 * Lightweight markdown → BlockNode tree for string-based indexing.
 * Not a full CommonMark parser — enough for headings, lists, code, quotes.
 */
export function parseMarkdownBlocks(content: string): BlockNode {
  const body = stripFrontmatter(content);
  const lines = body.split(/\r?\n/);
  const children: BlockNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (/^\s*$/.test(line)) {
      i += 1;
      continue;
    }

    if (/^---+$/.test(line.trim()) || /^\*\*\*+$/.test(line.trim())) {
      children.push({ kind: 'thematicBreak' });
      i += 1;
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      children.push({
        kind: 'heading',
        level: heading[1].length,
        text: heading[2].trim(),
      });
      i += 1;
      continue;
    }

    if (/^```/.test(line)) {
      const codeLines: string[] = [];
      i += 1;
      while (i < lines.length && !/^```/.test(lines[i])) {
        codeLines.push(lines[i]);
        i += 1;
      }
      if (i < lines.length) i += 1;
      children.push({ kind: 'code', text: codeLines.join('\n') });
      continue;
    }

    if (/^>\s?/.test(line)) {
      const quoteLines: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        quoteLines.push(lines[i].replace(/^>\s?/, ''));
        i += 1;
      }
      children.push({ kind: 'quote', text: quoteLines.join('\n') });
      continue;
    }

    if (/^\s*([-*+]|\d+\.)\s+/.test(line)) {
      const items: BlockNode[] = [];
      while (i < lines.length && /^\s*([-*+]|\d+\.)\s+/.test(lines[i])) {
        items.push({
          kind: 'listItem',
          text: lines[i].replace(/^\s*([-*+]|\d+\.)\s+/, ''),
        });
        i += 1;
      }
      children.push({ kind: 'list', children: items });
      continue;
    }

    const para: string[] = [line];
    i += 1;
    while (
      i < lines.length &&
      !/^\s*$/.test(lines[i]) &&
      !/^(#{1,6})\s+/.test(lines[i]) &&
      !/^```/.test(lines[i]) &&
      !/^>\s?/.test(lines[i]) &&
      !/^\s*([-*+]|\d+\.)\s+/.test(lines[i]) &&
      !/^---+$/.test(lines[i].trim()) &&
      !/^\*\*\*+$/.test(lines[i].trim())
    ) {
      para.push(lines[i]);
      i += 1;
    }
    children.push({ kind: 'paragraph', text: para.join('\n') });
  }

  return { kind: 'document', children };
}

/** Walk a markdown string with a visitor (string-AST path). */
export function walkMarkdown(content: string, visitor: DocumentVisitor): BlockNode {
  const root = parseMarkdownBlocks(content);
  acceptNode(root, visitor);
  return root;
}

/** Walk either a BlockNode tree or markdown string. */
export function walkDocument(
  source: string | VisitableNode,
  visitor: DocumentVisitor,
): void {
  if (typeof source === 'string') {
    walkMarkdown(source, visitor);
    return;
  }
  acceptNode(source, visitor);
}
