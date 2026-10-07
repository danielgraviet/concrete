import { escapeCurrencyDollars, normalizeMathMarkdown } from '../editor/math';

const FENCE_RE = /^(```+|~~~+)/;

function clozeAnswer(inner: string): string {
  const parts = inner.split('::').map((part) => part.trim());
  if (parts.length === 1) return parts[0];
  if (parts.length >= 3) return parts[1];
  if (/^c?\d+$/.test(parts[0])) return parts[1];
  return parts[0];
}

/** Turn a vault note into the markdown the PDF view renders. */
export function prepareNoteMarkdown(markdown: string): string {
  const body = markdown.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
  let inFence = false;
  const lines = body.split('\n').map((line) => {
    if (FENCE_RE.test(line.trim())) {
      inFence = !inFence;
      return line;
    }
    if (inFence) return line;
    if (/^:::(?:columns|column)?\s*$/.test(line.trim())) return '';
    return line
      .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
      .replace(/\[\[([^\]]+)\]\]/g, '$1')
      .replace(/\{\{([^{}]+)\}\}/g, (_match, inner: string) => `**${clozeAnswer(inner)}**`);
  });
  return normalizeMathMarkdown(escapeCurrencyDollars(lines.join('\n')));
}

export function noteExportTitle(markdown: string, notePath: string): string {
  const heading = markdown.match(/^#\s+(.+)$/m);
  if (heading) {
    const title = heading[1].replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2').replace(/[[\]]/g, '').trim();
    if (title) return title.slice(0, 90);
  }
  const base = notePath.split('/').pop() ?? notePath;
  return base.replace(/\.md$/i, '') || 'Note';
}
