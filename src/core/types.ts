/** Shared domain types for Markdown Vault. */

export type BlockType =
  | 'document'
  | 'heading'
  | 'paragraph'
  | 'list'
  | 'listItem'
  | 'quote'
  | 'code'
  | 'thematicBreak'
  | 'wikilink'
  | 'tag'
  | 'quizCard';

export type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;
export type ListKind = 'ordered' | 'unordered';

export interface NoteRef {
  path: string;
  title: string;
}

export interface QuizCardData {
  id: string;
  notePath: string;
  front: string;
  back: string;
  tags: string[];
  createdAt: number;
}

export interface HeadingProps {
  level?: HeadingLevel;
  text?: string;
}

export interface ParagraphProps {
  text?: string;
}

export interface ListProps {
  ordered?: boolean;
  items?: string[];
}

export interface ListItemProps {
  text?: string;
  checked?: boolean | null;
}

export interface QuoteProps {
  text?: string;
}

export interface CodeProps {
  language?: string;
  code?: string;
}

export interface WikilinkProps {
  target?: string;
  label?: string;
}

export interface TagProps {
  name?: string;
}

export interface QuizCardProps {
  notePath?: string;
  front?: string;
  back?: string;
  tags?: string[];
  createdAt?: number;
}

export type BlockCreateProps =
  | HeadingProps
  | ParagraphProps
  | ListProps
  | ListItemProps
  | QuoteProps
  | CodeProps
  | WikilinkProps
  | TagProps
  | QuizCardProps
  | Record<string, never>;

export interface QuizCardSelection {
  notePath: string;
  front: string;
  back: string;
  tags?: string[];
}

let idSeq = 0;

/** Lightweight unique id for block / card instances. */
export function createId(prefix = 'b'): string {
  idSeq += 1;
  return `${prefix}_${Date.now().toString(36)}_${idSeq.toString(36)}`;
}

export function noteTitleFromPath(path: string): string {
  const base = path.split(/[/\\]/).pop() ?? path;
  return base.replace(/\.md$/i, '');
}
