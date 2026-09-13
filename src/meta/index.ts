export {
  splitFrontmatter,
  parseFrontmatter,
  parseSimpleYaml,
} from './frontmatter';
export type { Frontmatter, ParsedDocument } from './frontmatter';

export {
  extractTags,
  extractInlineTags,
  frontmatterTags,
  normalizeTag,
  uniqueTags,
  tagsFromFrontmatterValue,
  INLINE_TAG_RE,
} from './tags';

export { MetaService, getFrontmatter, getTags } from './MetaService';
export type { NoteMetaInput } from './MetaService';
