import { stripFrontmatter } from '../patterns/visitor/walkMarkdown';
import { tokenize } from '../patterns/visitor/IndexingVisitor';
import { noteTitle } from '../patterns/visitor/types';

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
  snippet?: string;
};

type IndexedNote = {
  path: string;
  title: string;
  titleTerms: Set<string>;
  headingTerms: Set<string>;
  bodyTerms: Set<string>;
  headings: string[];
  body: string;
};

const TITLE_WEIGHT = 100;
const HEADING_WEIGHT = 40;
const BODY_WEIGHT = 10;

function extractHeadings(content: string): string[] {
  const body = stripFrontmatter(content);
  const headings: string[] = [];
  for (const line of body.split(/\r?\n/)) {
    const m = /^(#{1,6})\s+(.*)$/.exec(line);
    if (m) headings.push(m[2].trim());
  }
  return headings;
}

function snippetAround(text: string, terms: string[], maxLen = 120): string | undefined {
  const lower = text.toLowerCase();
  for (const term of terms) {
    const idx = lower.indexOf(term.toLowerCase());
    if (idx === -1) continue;
    const start = Math.max(0, idx - 40);
    const end = Math.min(text.length, idx + term.length + 80);
    let snip = text.slice(start, end).replace(/\s+/g, ' ').trim();
    if (start > 0) snip = `…${snip}`;
    if (end < text.length) snip = `${snip}…`;
    if (snip.length > maxLen) snip = `${snip.slice(0, maxLen - 1)}…`;
    return snip;
  }
  return undefined;
}

/**
 * Full-text / title search over vault notes.
 * Ranking: title match > heading match > body match.
 */
export class SearchIndex {
  private notes: IndexedNote[] = [];

  build(notes: SearchNote[]): this {
    this.notes = notes.map((note) => {
      const title = noteTitle(note.path, note.content, note.title);
      const body = stripFrontmatter(note.content);
      const headings = extractHeadings(note.content);
      return {
        path: note.path,
        title,
        titleTerms: new Set(tokenize(title)),
        headingTerms: new Set(tokenize(headings.join(' '))),
        bodyTerms: new Set(tokenize(body)),
        headings,
        body,
      };
    });
    return this;
  }

  query(q: string, limit = 50): SearchResult[] {
    const raw = q.trim();
    if (!raw) return [];

    const terms = tokenize(raw);
    const phrase = raw.toLowerCase();
    const results: SearchResult[] = [];

    for (const note of this.notes) {
      let score = 0;
      let field: SearchMatchField = 'body';

      const titleLower = note.title.toLowerCase();
      if (titleLower === phrase || titleLower.includes(phrase)) {
        score += TITLE_WEIGHT * 2;
        field = 'title';
      }

      for (const term of terms) {
        if (note.titleTerms.has(term) || titleLower.includes(term)) {
          score += TITLE_WEIGHT;
          field = 'title';
        } else if (note.headingTerms.has(term)) {
          score += HEADING_WEIGHT;
          if (field !== 'title') field = 'heading';
        } else if (note.bodyTerms.has(term)) {
          score += BODY_WEIGHT;
        }
      }

      // Phrase boost in headings / body
      if (phrase.length > 2) {
        if (note.headings.some((h) => h.toLowerCase().includes(phrase))) {
          score += HEADING_WEIGHT;
          if (field !== 'title') field = 'heading';
        } else if (note.body.toLowerCase().includes(phrase)) {
          score += BODY_WEIGHT / 2;
        }
      }

      if (score <= 0) continue;

      const snippet =
        field === 'title'
          ? note.title
          : field === 'heading'
            ? note.headings.find((h) =>
                terms.some((t) => h.toLowerCase().includes(t)) ||
                h.toLowerCase().includes(phrase),
              )
            : snippetAround(note.body, terms.length ? terms : [phrase]);

      results.push({
        path: note.path,
        title: note.title,
        score,
        field,
        ...(snippet ? { snippet } : {}),
      });
    }

    results.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
    return results.slice(0, limit);
  }
}
