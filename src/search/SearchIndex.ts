import { stripFrontmatter } from '../patterns/visitor/walkMarkdown';
import { tokenize } from '../patterns/visitor/IndexingVisitor';
import { noteTitle } from '../patterns/visitor/types';
import { isHiddenVaultFile } from '../vault/fileTree';

export type SearchNote = {
  path: string;
  content: string;
  title?: string;
};

export type SearchMatchField = 'title' | 'heading' | 'body';

export type SearchResult = {
  path: string;
  title: string;
  score: number;
  field: SearchMatchField;
  /** Indexed terms (or the phrase) that matched, best first; drives highlighting. */
  matches: string[];
  /** Title or matching heading. Body snippets are resolved lazily by the UI. */
  snippet?: string;
  /** 0-based line (after frontmatter) of the first heading/body match. */
  line?: number;
};

type Heading = { text: string; lower: string; line: number };

type IndexedNote = {
  path: string;
  title: string;
  titleLower: string;
  titleTerms: Set<string>;
  headings: Heading[];
  headingTerms: Set<string>;
  /** Body term → token positions, for phrase matching without keeping the body. */
  bodyPositions: Map<string, number[]>;
  /** Body term → first line it appears on. */
  bodyLines: Map<string, number>;
};

const TITLE_WEIGHT = 100;
const HEADING_WEIGHT = 40;
const BODY_WEIGHT = 10;
/** Partial (prefix) matches on the last query term score at this fraction. */
const PREFIX_FACTOR = 0.5;
/** Shortest last term expanded as a prefix, and how many vocabulary terms it may expand to. */
const MIN_PREFIX_LENGTH = 2;
const MAX_PREFIX_EXPANSIONS = 64;

const FIELD_RANK: Record<SearchMatchField, number> = { body: 0, heading: 1, title: 2 };

function stronger(current: SearchMatchField, next: SearchMatchField): SearchMatchField {
  return FIELD_RANK[next] > FIELD_RANK[current] ? next : current;
}

function indexNote(path: string, content: string, explicitTitle?: string): IndexedNote {
  const title = noteTitle(path, content, explicitTitle);
  const headings: Heading[] = [];
  const bodyPositions = new Map<string, number[]>();
  const bodyLines = new Map<string, number>();

  let position = 0;
  stripFrontmatter(content)
    .split(/\r?\n/)
    .forEach((text, line) => {
      const heading = /^#{1,6}\s+(.*)$/.exec(text);
      if (heading) {
        const value = heading[1].trim();
        headings.push({ text: value, lower: value.toLowerCase(), line });
      }
      for (const term of tokenize(text)) {
        const positions = bodyPositions.get(term);
        if (positions) positions.push(position);
        else bodyPositions.set(term, [position]);
        if (!bodyLines.has(term)) bodyLines.set(term, line);
        position += 1;
      }
    });

  return {
    path,
    title,
    titleLower: title.toLowerCase(),
    titleTerms: new Set(tokenize(title)),
    headings,
    headingTerms: new Set(headings.flatMap((h) => tokenize(h.text))),
    bodyPositions,
    bodyLines,
  };
}

function termsOf(note: IndexedNote): Set<string> {
  return new Set([...note.titleTerms, ...note.headingTerms, ...note.bodyPositions.keys()]);
}

/** True when `terms` appear consecutively somewhere in the body. */
function bodyHasPhrase(note: IndexedNote, terms: string[]): boolean {
  const starts = note.bodyPositions.get(terms[0]);
  if (!starts) return false;
  const rest = terms.slice(1).map((term) => new Set(note.bodyPositions.get(term) ?? []));
  return starts.some((start) => rest.every((positions, i) => positions.has(start + i + 1)));
}

/**
 * Incremental full-text / title search over vault notes.
 * Holds an inverted index rather than note bodies, so memory stays bounded
 * and one note can be re-indexed without rebuilding the vault.
 * Ranking: title match > heading match > body match.
 */
export class SearchIndex {
  private notes = new Map<string, IndexedNote>();
  /** Term → paths of notes containing it in title, headings or body. */
  private postings = new Map<string, Set<string>>();
  private listeners = new Set<() => void>();
  version = 0;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getVersion = (): number => this.version;

  /** Replace the whole index (vault opened / file list changed). */
  replaceAll(entries: Array<readonly [string, string]>): void {
    this.notes.clear();
    this.postings.clear();
    for (const [path, content] of entries) this.ingest(path, content);
    this.emit();
  }

  /** Build from note payloads; convenient for tests and one-off indexes. */
  build(notes: SearchNote[]): this {
    this.notes.clear();
    this.postings.clear();
    for (const note of notes) this.ingest(note.path, note.content, note.title);
    this.emit();
    return this;
  }

  /** Re-index one note. */
  update(path: string, content: string): void {
    this.ingest(path, content);
    this.emit();
  }

  remove(path: string): void {
    if (!this.notes.has(path)) return;
    this.drop(path);
    this.emit();
  }

  /** Drop notes no longer in the vault's file list. */
  retain(paths: string[]): void {
    const keep = new Set(paths);
    let changed = false;
    for (const path of [...this.notes.keys()]) {
      if (!keep.has(path)) {
        this.drop(path);
        changed = true;
      }
    }
    if (changed) this.emit();
  }

  get size(): number {
    return this.notes.size;
  }

  query(q: string, limit = 50): SearchResult[] {
    const raw = q.trim();
    if (!raw) return [];

    const terms = tokenize(raw);
    const phrase = raw.toLowerCase();
    const prefixes = this.expandPrefix(terms[terms.length - 1]);
    const results: SearchResult[] = [];

    for (const path of this.candidates(terms, prefixes, phrase)) {
      const result = this.score(this.notes.get(path)!, terms, prefixes, phrase);
      if (result) results.push(result);
    }

    results.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
    return results.slice(0, limit);
  }

  private score(
    note: IndexedNote,
    terms: string[],
    prefixes: string[],
    phrase: string,
  ): SearchResult | null {
    let score = 0;
    let field: SearchMatchField = 'body';
    let heading: Heading | undefined;
    let line: number | undefined;

    const firstLine = (candidate: number | undefined) => {
      if (candidate !== undefined && (line === undefined || candidate < line)) line = candidate;
    };
    const headingWith = (term: string) =>
      note.headings.find((h) => tokenize(h.text).includes(term));

    if (note.titleLower.includes(phrase)) {
      score += TITLE_WEIGHT * 2;
      field = stronger(field, 'title');
    }

    const matches: string[] = [];
    const contains = (term: string) =>
      note.titleTerms.has(term) || note.headingTerms.has(term) || note.bodyPositions.has(term);
    const prefixHit = () =>
      prefixes.find((p) => note.titleTerms.has(p))
      ?? prefixes.find((p) => note.headingTerms.has(p))
      ?? prefixes.find((p) => note.bodyPositions.has(p));

    terms.forEach((term, i) => {
      if (note.titleLower.includes(term)) {
        score += TITLE_WEIGHT;
        field = stronger(field, 'title');
        matches.push(term);
        return;
      }
      const hit = contains(term) ? term : i === terms.length - 1 ? prefixHit() : undefined;
      if (!hit) return;
      const factor = hit === term ? 1 : PREFIX_FACTOR;
      matches.push(hit);
      if (note.titleTerms.has(hit)) {
        score += TITLE_WEIGHT * factor;
        field = stronger(field, 'title');
      } else if (note.headingTerms.has(hit)) {
        score += HEADING_WEIGHT * factor;
        field = stronger(field, 'heading');
        heading ??= headingWith(hit);
        firstLine(heading?.line);
      } else {
        score += BODY_WEIGHT * factor;
        firstLine(note.bodyLines.get(hit));
      }
    });

    // Phrase boost for multi-word queries.
    if (terms.length > 1) {
      const phraseHeading = note.headings.find((h) => h.lower.includes(phrase));
      if (phraseHeading) {
        score += HEADING_WEIGHT;
        field = stronger(field, 'heading');
        heading = phraseHeading;
        firstLine(phraseHeading.line);
        matches.unshift(phrase);
      } else if (bodyHasPhrase(note, terms)) {
        score += BODY_WEIGHT / 2;
      }
    }

    if (score <= 0) return null;

    const snippet = field === 'title' ? note.title : field === 'heading' ? heading?.text : undefined;
    return {
      path: note.path,
      title: note.title,
      score,
      field,
      matches,
      ...(snippet ? { snippet } : {}),
      ...(field !== 'title' && line !== undefined ? { line } : {}),
    };
  }

  /** Notes that can possibly score: any exact/prefix term hit, or a title substring hit. */
  private candidates(terms: string[], prefixes: string[], phrase: string): Set<string> {
    const out = new Set<string>();
    for (const term of [...terms, ...prefixes]) {
      for (const path of this.postings.get(term) ?? []) out.add(path);
    }
    for (const note of this.notes.values()) {
      if (out.has(note.path)) continue;
      if (note.titleLower.includes(phrase) || terms.some((t) => note.titleLower.includes(t))) {
        out.add(note.path);
      }
    }
    return out;
  }

  /** Vocabulary terms that extend `term`, for search-as-you-type. */
  private expandPrefix(term: string | undefined): string[] {
    if (!term || term.length < MIN_PREFIX_LENGTH) return [];
    const out: string[] = [];
    for (const candidate of this.postings.keys()) {
      if (candidate === term || !candidate.startsWith(term)) continue;
      out.push(candidate);
      if (out.length >= MAX_PREFIX_EXPANSIONS) break;
    }
    return out;
  }

  private ingest(path: string, content: string, title?: string): void {
    this.drop(path);
    if (isHiddenVaultFile(path) || !/\.md$/i.test(path)) return;
    const note = indexNote(path, content, title);
    this.notes.set(path, note);
    for (const term of termsOf(note)) {
      const paths = this.postings.get(term);
      if (paths) paths.add(path);
      else this.postings.set(term, new Set([path]));
    }
  }

  private drop(path: string): void {
    const note = this.notes.get(path);
    if (!note) return;
    for (const term of termsOf(note)) {
      const paths = this.postings.get(term);
      if (!paths) continue;
      paths.delete(path);
      if (paths.size === 0) this.postings.delete(term);
    }
    this.notes.delete(path);
  }

  private emit(): void {
    this.version += 1;
    for (const listener of this.listeners) listener();
  }
}
