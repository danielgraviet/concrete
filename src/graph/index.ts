export {
  parseWikilinks,
  resolveWikilink,
  normalizeNoteKey,
  extractOutgoingTargets,
} from './wikilinks';
export type { WikilinkRef } from './wikilinks';

export { NoteGraph, getBacklinksFor } from './NoteGraph';
export type { GraphNote, BacklinkHit } from './NoteGraph';

export { useBacklinks } from './useBacklinks';
