export type SlashCommandId =
  | 'h1'
  | 'h2'
  | 'h3'
  | 'bullet'
  | 'numbered'
  | 'check'
  | 'quote'
  | 'code'
  | 'codeBlock'
  | 'math'
  | 'mathBlock'
  | 'image'
  | 'divider';

export type SlashCommand = {
  id: SlashCommandId;
  title: string;
  /** Exact tokens that auto-apply as soon as typed after `/` (e.g. h1). */
  aliases: string[];
  keywords: string[];
  symbol: string;
  hint: string;
};

export const SLASH_COMMANDS: SlashCommand[] = [
  {
    id: 'h1',
    title: 'Heading 1',
    aliases: ['h1'],
    keywords: ['heading', 'title'],
    symbol: 'H1',
    hint: 'Large section heading',
  },
  {
    id: 'h2',
    title: 'Heading 2',
    aliases: ['h2'],
    keywords: ['heading', 'subtitle'],
    symbol: 'H2',
    hint: 'Medium section heading',
  },
  {
    id: 'h3',
    title: 'Heading 3',
    aliases: ['h3'],
    keywords: ['heading'],
    symbol: 'H3',
    hint: 'Small section heading',
  },
  {
    id: 'bullet',
    title: 'Bulleted list',
    aliases: ['bullet', 'ul'],
    keywords: ['list', 'unordered'],
    symbol: '•',
    hint: 'Create a bullet list',
  },
  {
    id: 'numbered',
    title: 'Numbered list',
    aliases: ['numbered', 'ol', 'num'],
    keywords: ['ordered', 'list'],
    symbol: '1.',
    hint: 'Create a numbered list',
  },
  {
    id: 'check',
    title: 'Checklist',
    aliases: ['check', 'todo', 'task'],
    keywords: ['checkbox'],
    symbol: '☑',
    hint: 'Create a to-do checklist',
  },
  {
    id: 'quote',
    title: 'Quote',
    aliases: ['quote', 'blockquote'],
    keywords: ['callout'],
    symbol: '❝',
    hint: 'Insert a block quote',
  },
  {
    id: 'code',
    title: 'Inline code',
    aliases: ['code', 'inlinecode'],
    keywords: ['inline', 'monospace'],
    symbol: '`',
    hint: 'Format as inline code',
  },
  {
    id: 'codeBlock',
    title: 'Code block',
    aliases: ['codeblock', 'pre', 'fence'],
    keywords: ['snippet', 'block'],
    symbol: '<>',
    hint: 'Insert a fenced code block',
  },
  {
    id: 'math',
    title: 'Inline math',
    aliases: ['math', 'tex'],
    keywords: ['latex', 'equation', 'formula'],
    symbol: '∑',
    hint: 'Inline $formula$',
  },
  {
    id: 'mathBlock',
    title: 'Math block',
    aliases: ['mathblock', 'equation'],
    keywords: ['latex', 'display'],
    symbol: '∫',
    hint: 'Display math block',
  },
  {
    id: 'image',
    title: 'Image',
    aliases: ['image', 'img'],
    keywords: ['picture', 'photo'],
    symbol: '▣',
    hint: 'Embed an image by URL',
  },
  {
    id: 'divider',
    title: 'Divider',
    aliases: ['divider', 'hr'],
    keywords: ['line', 'thematic'],
    symbol: '—',
    hint: 'Insert a horizontal rule',
  },
];

/** Exact alias match → command (for instant apply on `/h1`). */
export function resolveExactSlashCommand(query: string): SlashCommand | null {
  const q = query.trim().toLowerCase();
  if (!q) return null;
  return (
    SLASH_COMMANDS.find(
      (command) => command.id.toLowerCase() === q || command.aliases.includes(q),
    ) ?? null
  );
}

/** True when another alias is longer and starts with this query (e.g. `math` vs `mathblock`). */
export function isAmbiguousSlashPrefix(query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return SLASH_COMMANDS.some((command) =>
    [command.id.toLowerCase(), ...command.aliases].some(
      (alias) => alias.startsWith(q) && alias.length > q.length,
    ),
  );
}

export function filterSlashCommands(query: string): SlashCommand[] {
  const q = query.trim().toLowerCase();
  if (!q) return SLASH_COMMANDS;
  // Multi-word queries are questions/directions, not format aliases.
  if (/\s/.test(q)) return [];
  return SLASH_COMMANDS.filter((command) => {
    if (command.id.toLowerCase().includes(q)) return true;
    if (command.title.toLowerCase().includes(q)) return true;
    if (command.aliases.some((alias) => alias.includes(q))) return true;
    return command.keywords.some((keyword) => keyword.includes(q));
  });
}

/**
 * True when `/query` should go to the tutor instead of a format command.
 * Exact aliases (h1, quote, …) stay formatting. Spaces or zero menu hits → AI.
 */
export function isFreeformSlashQuery(query: string): boolean {
  const q = query.trim();
  if (!q) return false;
  if (/\s/.test(q)) return true;
  const exact = resolveExactSlashCommand(q);
  if (exact && !isAmbiguousSlashPrefix(q)) return false;
  if (exact && isAmbiguousSlashPrefix(q)) return false;
  return filterSlashCommands(q).length === 0;
}
