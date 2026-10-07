import { parseFrontmatter } from '../meta/frontmatter';
import { toPosixPath } from '../vault/fileTree';

const QUIZ_MATERIAL_CHARS = 80;

/** Stable key for comparing a note path with a quiz `source` field. */
export function notePathKey(path: string): string {
  return toPosixPath(path).trim().toLowerCase();
}

/** True when a note has enough prose to be worth quizzing. */
export function noteHasQuizMaterial(markdown: string): boolean {
  const text = markdown
    .replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*]\([^)]*\)/g, ' ')
    .replace(/\[[^\]]*]\([^)]*\)/g, ' ')
    .replace(/[#>*_~\-|[\]()`]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length >= QUIZ_MATERIAL_CHARS;
}

/** Source note path stored on a quiz file, or null when it has none. */
export function quizSourceFromMarkdown(markdown: string): string | null {
  const source = parseFrontmatter(markdown).source;
  if (typeof source !== 'string') return null;
  const key = notePathKey(source);
  return key || null;
}

/**
 * End-of-note quiz action. Renders nothing until the note is long enough,
 * and stays hidden once a quiz already exists for it.
 */
export function QuizFromNotePrompt({
  markdown,
  alreadyQuizzed,
  onGenerate,
}: {
  markdown: string;
  alreadyQuizzed: boolean;
  onGenerate: () => void;
}) {
  if (alreadyQuizzed || !noteHasQuizMaterial(markdown)) return null;
  return (
    <button type="button" className="quiz-from-note" onClick={onGenerate}>
      Generate a quiz from this note
    </button>
  );
}
