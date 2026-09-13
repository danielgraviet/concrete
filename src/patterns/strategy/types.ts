import type { ReactNode } from 'react';

/** Markdown document after deserialize: optional YAML frontmatter + body. */
export type MarkdownDocument = {
  frontmatter: Record<string, unknown>;
  body: string;
  /** Original raw markdown (including frontmatter fence when present). */
  raw: string;
};

/**
 * Block-oriented view for future structured editors.
 * For MVP, blocks are a flat list of markdown segments.
 */
export type MarkdownBlock = {
  id?: string;
  type: string;
  markdown: string;
};

export type SerializeInput = MarkdownDocument | MarkdownBlock[] | string;

export interface MarkdownSerializeStrategy {
  /** Serialize a document, blocks, or plain string to markdown text. */
  serialize(input: SerializeInput): string;
  /** Parse markdown into a document (frontmatter + body). */
  deserialize(markdown: string): MarkdownDocument;
}

export interface RenderStrategy {
  /** Stable id for the registry. */
  readonly id: string;
  /** Render markdown to a React node (implemented by concrete strategies). */
  render(markdown: string): ReactNode;
}
