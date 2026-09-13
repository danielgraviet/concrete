import {
  parseFrontmatter,
  splitFrontmatter,
  type Frontmatter,
  type ParsedDocument,
} from './frontmatter';
import { extractTags, normalizeTag, uniqueTags } from './tags';

export type NoteMetaInput = {
  path: string;
  content: string;
};

/**
 * Vault-wide frontmatter + tags service.
 */
export class MetaService {
  private byPath = new Map<
    string,
    { frontmatter: Frontmatter; tags: string[]; body: string }
  >();

  build(notes: NoteMetaInput[]): this {
    this.byPath.clear();
    for (const note of notes) {
      const parsed = splitFrontmatter(note.content);
      this.byPath.set(note.path, {
        frontmatter: parsed.frontmatter,
        tags: extractTags(note.content),
        body: parsed.body,
      });
    }
    return this;
  }

  getFrontmatter(path: string): Frontmatter {
    return this.byPath.get(path)?.frontmatter ?? parseFrontmatter('');
  }

  getTags(path?: string): string[] {
    if (path) {
      return this.byPath.get(path)?.tags ?? [];
    }
    const all: string[] = [];
    for (const entry of this.byPath.values()) {
      all.push(...entry.tags);
    }
    return uniqueTags(all);
  }

  /** Paths that include the given tag (frontmatter or inline). */
  getNotesWithTag(tag: string): string[] {
    const key = normalizeTag(tag);
    const paths: string[] = [];
    for (const [path, entry] of this.byPath) {
      if (entry.tags.includes(key)) paths.push(path);
    }
    return paths;
  }

  /** tag → note paths inverted index */
  getTagIndex(): Map<string, string[]> {
    const index = new Map<string, string[]>();
    for (const [path, entry] of this.byPath) {
      for (const tag of entry.tags) {
        const list = index.get(tag) ?? [];
        list.push(path);
        index.set(tag, list);
      }
    }
    return index;
  }

  parse(content: string): ParsedDocument {
    return splitFrontmatter(content);
  }
}

export function getFrontmatter(content: string): Frontmatter {
  return parseFrontmatter(content);
}

export function getTags(content: string): string[] {
  return extractTags(content);
}
