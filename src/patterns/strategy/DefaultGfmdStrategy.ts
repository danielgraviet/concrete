import type {
  MarkdownBlock,
  MarkdownDocument,
  MarkdownSerializeStrategy,
  SerializeInput,
} from './types';

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

/** Split `---` YAML frontmatter from the markdown body (no gray-matter). */
export function splitFrontmatter(markdown: string): {
  yaml: string | null;
  body: string;
} {
  const match = FRONTMATTER_RE.exec(markdown);
  if (!match) return { yaml: null, body: markdown };
  return { yaml: match[1] ?? '', body: markdown.slice(match[0].length) };
}

/**
 * Minimal YAML subset: key: value lines, quoted strings, booleans, numbers,
 * null, nested maps via indentation, and arrays via `- item`.
 */
export function parseSimpleYaml(yaml: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const lines = yaml.split(/\r?\n/);
  let i = 0;

  const parseScalar = (raw: string): unknown => {
    const v = raw.trim();
    if (v === '' || v === 'null' || v === '~') return null;
    if (v === 'true') return true;
    if (v === 'false') return false;
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      return v.slice(1, -1);
    }
    if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
    return v;
  };

  while (i < lines.length) {
    const line = lines[i]!;
    if (!line.trim() || line.trimStart().startsWith('#')) {
      i += 1;
      continue;
    }

    const kv = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (!kv) {
      i += 1;
      continue;
    }

    const key = kv[1]!;
    const rest = kv[2]!;

    if (rest === '' || rest === '|' || rest === '>') {
      const children: string[] = [];
      i += 1;
      while (i < lines.length) {
        const next = lines[i]!;
        if (next.trim() === '') {
          children.push(next);
          i += 1;
          continue;
        }
        if (/^\s+/.test(next)) {
          children.push(next.replace(/^\s+/, ''));
          i += 1;
          continue;
        }
        break;
      }
      if (children.some((c) => c.trimStart().startsWith('- '))) {
        result[key] = children
          .filter((c) => c.trimStart().startsWith('- '))
          .map((c) => parseScalar(c.replace(/^\s*-\s*/, '')));
      } else if (children.some((c) => /^[A-Za-z0-9_-]+:/.test(c.trim()))) {
        result[key] = parseSimpleYaml(children.join('\n'));
      } else {
        result[key] = children.join('\n').trim() || null;
      }
      continue;
    }

    result[key] = parseScalar(rest);
    i += 1;
  }

  return result;
}

function formatScalar(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'boolean' || typeof value === 'number') return String(value);
  if (typeof value === 'string') {
    const needsQuote = /[:#\n]|^\s|\s$/.test(value);
    return needsQuote ? `"${value.replace(/"/g, '\\"')}"` : value;
  }
  return String(value);
}

/** Stringify a flat/nested plain object to a small YAML subset. */
export function stringifySimpleYaml(data: Record<string, unknown>, indent = ''): string {
  const lines: string[] = [];

  for (const [key, value] of Object.entries(data)) {
    if (Array.isArray(value)) {
      lines.push(`${indent}${key}:`);
      for (const item of value) {
        if (item !== null && typeof item === 'object' && !Array.isArray(item)) {
          lines.push(`${indent}  -`);
          const nested = stringifySimpleYaml(
            item as Record<string, unknown>,
            `${indent}    `,
          );
          if (nested) lines.push(nested);
        } else {
          lines.push(`${indent}  - ${formatScalar(item)}`);
        }
      }
    } else if (value !== null && typeof value === 'object') {
      lines.push(`${indent}${key}:`);
      const nested = stringifySimpleYaml(
        value as Record<string, unknown>,
        `${indent}  `,
      );
      if (nested) lines.push(nested);
    } else {
      lines.push(`${indent}${key}: ${formatScalar(value)}`);
    }
  }

  return lines.join('\n');
}

function isDocument(input: SerializeInput): input is MarkdownDocument {
  return (
    typeof input === 'object' &&
    input !== null &&
    !Array.isArray(input) &&
    'body' in input &&
    'frontmatter' in input
  );
}

function isBlocks(input: SerializeInput): input is MarkdownBlock[] {
  return Array.isArray(input);
}

/**
 * Default GFM-oriented serialize strategy with YAML frontmatter support.
 * Body is treated as GFM markdown; no AST rewrite in MVP.
 */
export class DefaultGfmdStrategy implements MarkdownSerializeStrategy {
  serialize(input: SerializeInput): string {
    if (typeof input === 'string') return input;

    if (isBlocks(input)) {
      return input.map((b) => b.markdown).join('\n\n');
    }

    if (isDocument(input)) {
      const fm = input.frontmatter;
      if (Object.keys(fm).length === 0) return input.body;
      const yaml = stringifySimpleYaml(fm);
      const body = input.body.replace(/^\n/, '');
      return `---\n${yaml}\n---\n${body}`;
    }

    return '';
  }

  deserialize(markdown: string): MarkdownDocument {
    const { yaml, body } = splitFrontmatter(markdown);
    const frontmatter = yaml ? parseSimpleYaml(yaml) : {};
    return { frontmatter, body, raw: markdown };
  }
}
