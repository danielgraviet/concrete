export type {
  BlockKind,
  BlockNode,
  DocumentVisitor,
  VisitableNode,
  NoteInput,
} from './types';
export { noteTitle } from './types';

export {
  acceptNode,
  dispatch,
  stripFrontmatter,
  parseMarkdownBlocks,
  walkMarkdown,
  walkDocument,
} from './walkMarkdown';

export { IndexingVisitor, tokenize } from './IndexingVisitor';
export type { TermIndex } from './IndexingVisitor';

export {
  BacklinksVisitor,
  parseWikilinks,
  buildNoteResolver,
  WIKILINK_RE,
} from './BacklinksVisitor';
export type { WikilinkRef, LinkMaps } from './BacklinksVisitor';

export { AiContextVisitor } from './AiContextVisitor';
export type { AiExcerpt, AiContextPack } from './AiContextVisitor';
