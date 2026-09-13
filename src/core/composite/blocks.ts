import {
  createId,
  type HeadingLevel,
  type QuizCardData,
} from '../types';
import {
  BaseBlock,
  CompositeBlock,
  type BlockNode,
  type BlockVisitor,
} from './BlockNode';

function escapeFence(code: string): string {
  return code.replace(/^```/gm, '\\```');
}

export class HeadingBlock extends BaseBlock {
  readonly type = 'heading' as const;

  constructor(
    id: string,
    public level: HeadingLevel,
    public text: string,
  ) {
    super(id);
  }

  toMarkdown(): string {
    return `${'#'.repeat(this.level)} ${this.text}`;
  }

  accept(visitor: BlockVisitor): void {
    visitor.visitHeading(this);
  }

  clone(): HeadingBlock {
    return new HeadingBlock(this.id, this.level, this.text);
  }
}

export class ParagraphBlock extends BaseBlock {
  readonly type = 'paragraph' as const;

  constructor(id: string, public text: string) {
    super(id);
  }

  toMarkdown(): string {
    return this.text;
  }

  accept(visitor: BlockVisitor): void {
    visitor.visitParagraph(this);
  }

  clone(): ParagraphBlock {
    return new ParagraphBlock(this.id, this.text);
  }
}

export class ListItemBlock extends CompositeBlock {
  readonly type = 'listItem' as const;

  constructor(
    id: string,
    public text: string,
    public checked: boolean | null = null,
  ) {
    super(id);
  }

  toMarkdown(orderedMarker?: string): string {
    const marker = orderedMarker ?? '-';
    const box =
      this.checked === null ? '' : this.checked ? '[x] ' : '[ ] ';
    const head = `${marker} ${box}${this.text}`.trimEnd();
    if (this.children.length === 0) return head;
    const nested = this.children
      .map((c) =>
        c
          .toMarkdown()
          .split('\n')
          .map((line) => `  ${line}`)
          .join('\n'),
      )
      .join('\n');
    return `${head}\n${nested}`;
  }

  accept(visitor: BlockVisitor): void {
    visitor.visitListItem(this);
    for (const child of this.children) child.accept(visitor);
  }

  clone(): ListItemBlock {
    const copy = new ListItemBlock(this.id, this.text, this.checked);
    for (const child of this.cloneChildren()) copy.add(child);
    return copy;
  }
}

export class ListBlock extends CompositeBlock {
  readonly type = 'list' as const;

  constructor(id: string, public ordered: boolean) {
    super(id);
  }

  toMarkdown(): string {
    return this.children
      .map((child, index) => {
        if (child instanceof ListItemBlock) {
          return child.toMarkdown(this.ordered ? `${index + 1}.` : '-');
        }
        return child.toMarkdown();
      })
      .join('\n');
  }

  accept(visitor: BlockVisitor): void {
    visitor.visitList(this);
    for (const child of this.children) child.accept(visitor);
  }

  clone(): ListBlock {
    const copy = new ListBlock(this.id, this.ordered);
    for (const child of this.cloneChildren()) copy.add(child);
    return copy;
  }
}

export class QuoteBlock extends CompositeBlock {
  readonly type = 'quote' as const;

  constructor(id: string, public text: string = '') {
    super(id);
  }

  toMarkdown(): string {
    const body =
      this.children.length > 0
        ? this.children.map((c) => c.toMarkdown()).join('\n\n')
        : this.text;
    return body
      .split('\n')
      .map((line) => `> ${line}`)
      .join('\n');
  }

  accept(visitor: BlockVisitor): void {
    visitor.visitQuote(this);
    for (const child of this.children) child.accept(visitor);
  }

  clone(): QuoteBlock {
    const copy = new QuoteBlock(this.id, this.text);
    for (const child of this.cloneChildren()) copy.add(child);
    return copy;
  }
}

export class CodeBlock extends BaseBlock {
  readonly type = 'code' as const;

  constructor(
    id: string,
    public language: string,
    public code: string,
  ) {
    super(id);
  }

  toMarkdown(): string {
    return `\`\`\`${this.language}\n${escapeFence(this.code)}\n\`\`\``;
  }

  accept(visitor: BlockVisitor): void {
    visitor.visitCode(this);
  }

  clone(): CodeBlock {
    return new CodeBlock(this.id, this.language, this.code);
  }
}

export class ThematicBreakBlock extends BaseBlock {
  readonly type = 'thematicBreak' as const;

  toMarkdown(): string {
    return '---';
  }

  accept(visitor: BlockVisitor): void {
    visitor.visitThematicBreak(this);
  }

  clone(): ThematicBreakBlock {
    return new ThematicBreakBlock(this.id);
  }
}

export class WikilinkBlock extends BaseBlock {
  readonly type = 'wikilink' as const;

  constructor(
    id: string,
    public target: string,
    public label: string = '',
  ) {
    super(id);
  }

  toMarkdown(): string {
    return this.label && this.label !== this.target
      ? `[[${this.target}|${this.label}]]`
      : `[[${this.target}]]`;
  }

  accept(visitor: BlockVisitor): void {
    visitor.visitWikilink(this);
  }

  clone(): WikilinkBlock {
    return new WikilinkBlock(this.id, this.target, this.label);
  }
}

export class TagBlock extends BaseBlock {
  readonly type = 'tag' as const;

  constructor(id: string, public name: string) {
    super(id);
  }

  toMarkdown(): string {
    const n = this.name.replace(/^#/, '');
    return `#${n}`;
  }

  accept(visitor: BlockVisitor): void {
    visitor.visitTag(this);
  }

  clone(): TagBlock {
    return new TagBlock(this.id, this.name);
  }
}

export class QuizCardBlock extends BaseBlock {
  readonly type = 'quizCard' as const;

  constructor(
    id: string,
    public notePath: string,
    public front: string,
    public back: string,
    public tags: string[] = [],
    public createdAt: number = Date.now(),
  ) {
    super(id);
  }

  toData(): QuizCardData {
    return {
      id: this.id,
      notePath: this.notePath,
      front: this.front,
      back: this.back,
      tags: [...this.tags],
      createdAt: this.createdAt,
    };
  }

  toMarkdown(): string {
    const tagLine =
      this.tags.length > 0 ? `\ntags: ${this.tags.join(', ')}` : '';
    return `\`\`\`quiz\nfront: ${this.front}\nback: ${this.back}${tagLine}\n\`\`\``;
  }

  accept(visitor: BlockVisitor): void {
    visitor.visitQuizCard(this);
  }

  clone(): QuizCardBlock {
    return new QuizCardBlock(
      this.id,
      this.notePath,
      this.front,
      this.back,
      [...this.tags],
      this.createdAt,
    );
  }
}

/** Walk the tree and return the first node with the given id. */
export function findBlock(
  root: BlockNode,
  id: string,
): BlockNode | undefined {
  if (root.id === id) return root;
  for (const child of root.getChildren()) {
    const found = findBlock(child, id);
    if (found) return found;
  }
  return undefined;
}

/** Locate the parent composite that directly owns `id`. */
export function findParent(
  root: BlockNode,
  id: string,
): BlockNode | undefined {
  for (const child of root.getChildren()) {
    if (child.id === id) return root;
    const nested = findParent(child, id);
    if (nested) return nested;
  }
  return undefined;
}

export function createHeading(
  level: HeadingLevel,
  text: string,
  id = createId('h'),
): HeadingBlock {
  return new HeadingBlock(id, level, text);
}

export function createParagraph(
  text: string,
  id = createId('p'),
): ParagraphBlock {
  return new ParagraphBlock(id, text);
}
