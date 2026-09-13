import type { DocumentVisitor, NoteInput, VisitableNode } from './types';
import { noteTitle } from './types';
import { walkDocument } from './walkMarkdown';

export type AiExcerpt = {
  kind: 'heading' | 'paragraph' | 'quote' | 'list';
  text: string;
  level?: number;
};

export type AiContextPack = {
  path: string;
  title: string;
  excerpts: AiExcerpt[];
};

/**
 * Extracts headings + key paragraphs for AI context packs.
 */
export class AiContextVisitor implements DocumentVisitor {
  private path = '';
  private title = '';
  private excerpts: AiExcerpt[] = [];
  private maxExcerpts: number;
  private minParagraphLength: number;

  constructor(options?: { maxExcerpts?: number; minParagraphLength?: number }) {
    this.maxExcerpts = options?.maxExcerpts ?? 12;
    this.minParagraphLength = options?.minParagraphLength ?? 40;
  }

  beginNote(path: string, title: string): void {
    this.path = path;
    this.title = title;
    this.excerpts = [];
  }

  visitHeading(node: VisitableNode): void {
    if (!node.text || this.excerpts.length >= this.maxExcerpts) return;
    this.excerpts.push({
      kind: 'heading',
      text: node.text.trim(),
      level: node.level ?? 1,
    });
  }

  visitParagraph(node: VisitableNode): void {
    this.pushBody('paragraph', node.text);
  }

  visitQuote(node: VisitableNode): void {
    this.pushBody('quote', node.text);
  }

  visitList(node: VisitableNode): void {
    if (this.excerpts.length >= this.maxExcerpts) return;
    const items = (node.children ?? [])
      .map((c) => c.text?.trim())
      .filter(Boolean) as string[];
    if (items.length === 0) return;
    this.excerpts.push({ kind: 'list', text: items.map((t) => `- ${t}`).join('\n') });
  }

  private pushBody(kind: 'paragraph' | 'quote', text?: string): void {
    if (!text || this.excerpts.length >= this.maxExcerpts) return;
    const trimmed = text.trim();
    if (trimmed.length < this.minParagraphLength) return;
    // Prefer early substantial paragraphs; skip pure wikilink-only lines
    if (/^\[\[.+\]\]$/.test(trimmed) && trimmed.length < 80) return;
    this.excerpts.push({ kind, text: trimmed });
  }

  result(): AiContextPack {
    return {
      path: this.path,
      title: this.title,
      excerpts: [...this.excerpts],
    };
  }

  extract(note: NoteInput): AiContextPack {
    const title = noteTitle(note.path, note.content, note.title);
    this.beginNote(note.path, title);
    walkDocument(note.content, this);
    return this.result();
  }

  extractAll(notes: NoteInput[]): AiContextPack[] {
    return notes.map((n) => this.extract(n));
  }
}
