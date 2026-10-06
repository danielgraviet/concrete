import { joinNotePath, noteTitle, toPosixPath } from '../vault/fileTree';

/** Filename (or full relative path) is a quiz file when the basename starts with `Quiz `. */
export function isQuizFileName(name: string): boolean {
  const base = toPosixPath(name).split('/').pop() ?? name;
  return /^Quiz /.test(base.replace(/\.md$/i, '')) || /^Quiz .+\.md$/i.test(base);
}

export function isQuizPath(relativePath: string): boolean {
  return isQuizFileName(relativePath);
}

/** Ensure a display title becomes `Quiz <title>` without double-prefixing. */
export function quizFileTitle(descriptiveTitle: string): string {
  const cleaned = descriptiveTitle.trim().replace(/\.md$/i, '');
  if (!cleaned) return 'Quiz Untitled';
  if (/^Quiz\s+/i.test(cleaned)) {
    const rest = cleaned.replace(/^Quiz\s+/i, '').trim() || 'Untitled';
    return `Quiz ${rest}`;
  }
  return `Quiz ${cleaned}`;
}

export function quizDisplayTitle(relativePath: string): string {
  return noteTitle(relativePath);
}

/**
 * Pick a quiz filename that does not collide with an existing note.
 * The first quiz keeps `Quiz <title>`; later ones are `Quiz 2: <title>`, `Quiz 3: <title>`, …
 */
export function nextQuizTitle(
  title: string,
  folder: string,
  existingPaths: readonly string[],
): string {
  const rest = quizFileTitle(title).replace(/^Quiz\s+/i, '').trim() || 'Untitled';
  const taken = new Set(existingPaths.map((path) => path.toLowerCase()));
  const free = (label: string) => {
    const relative = joinNotePath(folder, label);
    return Boolean(relative) && !taken.has(relative.toLowerCase());
  };
  const first = `Quiz ${rest}`;
  if (free(first)) return first;
  for (let n = 2; n < 1000; n += 1) {
    const label = `Quiz ${n}: ${rest}`;
    if (free(label)) return label;
  }
  return `Quiz ${Date.now()}: ${rest}`;
}
