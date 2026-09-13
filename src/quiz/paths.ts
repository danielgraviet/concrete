import { noteTitle, toPosixPath } from '../vault/fileTree';

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
