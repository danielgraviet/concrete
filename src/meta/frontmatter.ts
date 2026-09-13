/**
 * Minimal YAML frontmatter parser for simple `key: value` and tag lists.
 * Not a full YAML implementation — enough for vault MVP metadata.
 */

export type Frontmatter = Record<string, unknown>;

export type ParsedDocument = {
  frontmatter: Frontmatter;
  body: string;
  /** Raw YAML between fences, or empty. */
  raw: string;
};

const FENCE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

export function splitFrontmatter(content: string): ParsedDocument {
  if (!content.startsWith('---')) {
    return { frontmatter: {}, body: content, raw: '' };
  }
  const match = FENCE.exec(content);
  if (!match) {
    return { frontmatter: {}, body: content, raw: '' };
  }
  const raw = match[1];
  return {
    frontmatter: parseSimpleYaml(raw),
    body: content.slice(match[0].length),
    raw,
  };
}

export function parseFrontmatter(content: string): Frontmatter {
  return splitFrontmatter(content).frontmatter;
}

/**
 * Parse a constrained YAML subset:
 * - `key: value`
 * - `key: [a, b]`
 * - `key:\n  - a\n  - b`
 * - quoted strings, booleans, numbers
 */
export function parseSimpleYaml(raw: string): Frontmatter {
  const result: Frontmatter = {};
  const lines = raw.split(/\r?\n/);
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (/^\s*$/.test(line) || /^\s*#/.test(line)) {
      i += 1;
      continue;
    }

    const kv = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line);
    if (!kv) {
      i += 1;
      continue;
    }

    const key = kv[1];
    const rest = kv[2].trim();

    if (rest === '' || rest === '|' || rest === '>') {
      // Possibly a block list
      const items: string[] = [];
      let j = i + 1;
      while (j < lines.length) {
        const listItem = /^\s*-\s+(.*)$/.exec(lines[j]);
        if (!listItem) break;
        items.push(unquote(listItem[1].trim()));
        j += 1;
      }
      if (items.length > 0) {
        result[key] = items;
        i = j;
        continue;
      }
      result[key] = rest === '' ? null : rest;
      i += 1;
      continue;
    }

    if (rest.startsWith('[') && rest.endsWith(']')) {
      result[key] = parseInlineList(rest);
      i += 1;
      continue;
    }

    result[key] = coerceScalar(rest);
    i += 1;
  }

  return result;
}

function parseInlineList(raw: string): string[] {
  const inner = raw.slice(1, -1).trim();
  if (!inner) return [];
  return inner.split(',').map((part) => unquote(part.trim())).filter(Boolean);
}

function coerceScalar(value: string): string | number | boolean | null {
  const v = unquote(value);
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (v === 'null' || v === '~') return null;
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  return v;
}

function unquote(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}
