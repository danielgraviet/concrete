/**
 * "Duplicate to my workspace": copy a share's content into the recipient's
 * workspace under `Shared/`. Content only: review state starts fresh.
 */

import type { CloudRepository, ShareRecord, WorkspaceId } from '../../backend/cloud/CloudRepository';
import { ConflictError } from '../../backend/cloud/errors';
import type { LinkedCardInput } from '../../learn/LinkedCards';
import { quizFileTitle } from '../../quiz/paths';
import { serializeQuizMarkdown } from '../../quiz/serializeQuizMarkdown';
import { readSharePayload, titleFromPath } from './payloads';
import type { SharedCard, SharedNote } from './types';

export const SHARED_ROOT = 'Shared';

export type NewLinkedCard = { path: string; folder?: string; input: LinkedCardInput };

export interface DuplicateDeps {
  repo: CloudRepository;
  ws: WorkspaceId;
  /** Create app cards (the LinkedCardStore path). Required for decks with app cards. */
  addLinkedCards?: (items: NewLinkedCard[]) => Promise<void>;
}

export interface DuplicateResult {
  /** Note to open afterwards (the note, the quiz, or the first note of a folder/deck). */
  openPath: string | null;
  /** Folder created for folder/deck shares. */
  folder: string | null;
  /** Number of app cards created (decks). */
  cardsCreated: number;
}

/** Make a name safe as one path segment. */
export function safeSegment(name: string): string {
  const cleaned = name
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[.\s]+|[.\s]+$/g, '')
    .slice(0, 80)
    .trim();
  return cleaned || 'Untitled';
}

/** `base`, else `base 2`, `base 3`, … (case-insensitive against `taken`). */
export function uniqueName(base: string, taken: Iterable<string>): string {
  const lower = new Set([...taken].map((name) => name.toLowerCase()));
  if (!lower.has(base.toLowerCase())) return base;
  for (let n = 2; n < 10_000; n += 1) {
    const candidate = `${base} ${n}`;
    if (!lower.has(candidate.toLowerCase())) return candidate;
  }
  return `${base} ${Date.now()}`;
}

/** Create `<folder>/<name>.md`, renaming `name` on ConflictError. Returns the path. */
export async function createUniqueNote(
  repo: CloudRepository,
  ws: WorkspaceId,
  folder: string,
  name: string,
  body: string,
): Promise<string> {
  const tree = await repo.listTree(ws);
  const prefix = folder ? `${folder}/` : '';
  const taken = new Set(
    tree.notes.filter((note) => note.path.startsWith(prefix) && !note.path.slice(prefix.length).includes('/')).map((note) => titleFromPath(note.path)),
  );
  let candidate = uniqueName(name, taken);
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      return await repo.createNote(ws, `${prefix}${candidate}`, body);
    } catch (error) {
      if (!(error instanceof ConflictError)) throw error;
      taken.add(candidate);
      candidate = uniqueName(name, taken);
    }
  }
  throw new ConflictError(`Could not find a free name for "${name}".`);
}

/** A folder path under `parent` that no note or folder uses yet. */
export async function uniqueFolder(repo: CloudRepository, ws: WorkspaceId, parent: string, name: string): Promise<string> {
  const tree = await repo.listTree(ws);
  const prefix = parent ? `${parent}/` : '';
  const taken = new Set<string>();
  for (const folder of tree.folders) {
    if (folder.startsWith(prefix)) taken.add(folder.slice(prefix.length).split('/')[0]);
  }
  for (const note of tree.notes) {
    if (note.path.startsWith(prefix)) taken.add(note.path.slice(prefix.length).split('/')[0].replace(/\.md$/i, ''));
  }
  const folder = `${prefix}${uniqueName(name, taken)}`;
  return repo.mkdir(ws, folder);
}

function cleanRelative(path: string): string | null {
  const parts = path.split('/').filter((part) => part && part !== '.');
  if (!parts.length || parts.some((part) => part === '..' || part.startsWith('.'))) return null;
  const file = parts.pop()!;
  return [...parts.map(safeSegment), /\.md$/i.test(file) ? `${safeSegment(file.replace(/\.md$/i, ''))}.md` : `${safeSegment(file)}.md`].join('/');
}

async function writeNotes(repo: CloudRepository, ws: WorkspaceId, root: string, notes: SharedNote[]): Promise<Map<string, string>> {
  const written = new Map<string, string>();
  for (const note of notes) {
    const rel = cleanRelative(note.path);
    if (!rel) continue;
    const path = `${root}/${rel}`;
    await repo.writeNote(ws, path, note.markdown);
    written.set(note.path, path);
  }
  return written;
}

function linkedInput(card: SharedCard): LinkedCardInput {
  if (card.kind === 'basic') return { kind: 'basic', front: card.front, back: card.back, ...(card.reverse ? { reverse: true } : {}) };
  if (card.kind === 'cloze') return { kind: 'cloze', text: card.text };
  return { kind: 'mcq', prompt: card.prompt, options: card.options.map((o) => ({ text: o.text, correct: o.correct })) };
}

export async function duplicateShare(record: ShareRecord, deps: DuplicateDeps): Promise<DuplicateResult> {
  const { repo, ws } = deps;
  await repo.mkdir(ws, SHARED_ROOT);

  switch (record.kind) {
    case 'note': {
      const payload = readSharePayload('note', record.payload);
      const path = await createUniqueNote(repo, ws, SHARED_ROOT, safeSegment(titleFromPath(payload.path)), payload.markdown);
      return { openPath: path, folder: null, cardsCreated: 0 };
    }

    case 'quiz': {
      const payload = readSharePayload('quiz', record.payload);
      const markdown = serializeQuizMarkdown({ title: payload.quiz.title, rubric: payload.quiz.rubric, questions: payload.quiz.questions });
      // Quiz files are recognized by their `Quiz ` prefix.
      const name = safeSegment(quizFileTitle(titleFromPath(payload.path)));
      const path = await createUniqueNote(repo, ws, SHARED_ROOT, name, markdown);
      return { openPath: path, folder: null, cardsCreated: 0 };
    }

    case 'folder': {
      const payload = readSharePayload('folder', record.payload);
      const root = await uniqueFolder(repo, ws, SHARED_ROOT, safeSegment(record.title || payload.folder));
      const written = await writeNotes(repo, ws, root, payload.notes);
      return { openPath: [...written.values()].sort()[0] ?? null, folder: root, cardsCreated: 0 };
    }

    case 'deck': {
      const payload = readSharePayload('deck', record.payload);
      const root = await uniqueFolder(repo, ws, SHARED_ROOT, safeSegment(record.title || payload.label));
      const written = await writeNotes(repo, ws, root, payload.notes);
      // Inline (`note`) cards came along with their notes; recreate the rest as app cards.
      const items: NewLinkedCard[] = payload.cards
        .filter((card) => card.origin !== 'note')
        .map((card) => {
          const path = card.sourcePath ? written.get(card.sourcePath) : undefined;
          return path ? { path, input: linkedInput(card) } : { path: '', folder: root, input: linkedInput(card) };
        });
      if (items.length) {
        if (!deps.addLinkedCards) throw new Error('Cannot create flashcards here.');
        await deps.addLinkedCards(items);
      }
      return { openPath: [...written.values()].sort()[0] ?? null, folder: root, cardsCreated: items.length };
    }
  }
}
