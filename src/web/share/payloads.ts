/**
 * Pure builders and readers for share payloads (see `./types`). No I/O: the
 * collectors in `./collect` read the workspace and call these.
 */

import type { JsonValue, ShareKind } from '../../backend/cloud/CloudRepository';
import type { LinkedCard } from '../../learn/LinkedCards';
import { parseNoteCardSpans } from '../../learn/parseNoteCards';
import type { ReviewCard } from '../../learn/types';
import { parseQuizMarkdown } from '../../quiz/parseQuizMarkdown';
import {
  SHARE_SCHEMA_VERSION,
  type DeckPayload,
  type FolderPayload,
  type NotePayload,
  type QuizPayload,
  type SharedCard,
  type SharedNote,
  type SharePayloadByKind,
} from './types';

/**
 * Stay well under the repository's ~900 KB record limit: the payload is
 * stored as a JSON string next to a few metadata fields.
 */
export const MAX_SHARE_BYTES = 850_000;

/** Firestore rules cap share titles at 500 characters. */
export const MAX_SHARE_TITLE = 200;

export class ShareTooLargeError extends Error {
  constructor(
    readonly bytes: number,
    readonly limit = MAX_SHARE_BYTES,
  ) {
    super(
      `This is too big to share (${Math.ceil(bytes / 1024)} KB; the limit is ${Math.floor(limit / 1024)} KB). ` +
        'Try sharing a smaller folder or individual notes.',
    );
    this.name = 'ShareTooLargeError';
  }
}

export class UnsupportedShareError extends Error {
  constructor(message = 'This link was made with a newer version of Concrete, or it is damaged.') {
    super(message);
    this.name = 'UnsupportedShareError';
  }
}

const encoder = new TextEncoder();

export function jsonBytes(value: unknown): number {
  return encoder.encode(JSON.stringify(value)).length;
}

/** Throws ShareTooLargeError when the serialized payload is over the limit. */
export function assertShareSize(payload: unknown, limit = MAX_SHARE_BYTES): void {
  const bytes = jsonBytes(payload);
  if (bytes > limit) throw new ShareTooLargeError(bytes, limit);
}

/** Drop `undefined` and anything else JSON would not keep. */
export function toJson<T>(value: T): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue;
}

export function shareTitle(raw: string): string {
  const title = raw.replace(/\s+/g, ' ').trim() || 'Untitled';
  return title.length > MAX_SHARE_TITLE ? `${title.slice(0, MAX_SHARE_TITLE - 1)}…` : title;
}

function baseName(path: string): string {
  return path.split('/').pop() ?? path;
}

export function titleFromPath(path: string): string {
  return baseName(path).replace(/\.md$/i, '') || 'Untitled';
}

function relativeTo(folder: string, path: string): string {
  if (!folder) return path;
  return path.startsWith(`${folder}/`) ? path.slice(folder.length + 1) : path;
}

// ── Builders ────────────────────────────────────────────────────────────────

export function buildNotePayload(path: string, markdown: string): NotePayload {
  const payload: NotePayload = { schemaVersion: SHARE_SCHEMA_VERSION, path: baseName(path), markdown };
  assertShareSize(payload);
  return payload;
}

/**
 * `notes` are full workspace paths under `folder`; they are stored relative
 * to it. Hidden app data (`.vault/…`) and non-markdown files are skipped.
 */
export function buildFolderPayload(folder: string, notes: SharedNote[], limit = MAX_SHARE_BYTES): FolderPayload {
  const kept = notes
    .filter((note) => /\.md$/i.test(note.path) && !note.path.split('/').some((part) => part.startsWith('.')))
    .map((note) => ({ path: relativeTo(folder, note.path), markdown: note.markdown }))
    .sort((a, b) => a.path.localeCompare(b.path));
  const payload: FolderPayload = { schemaVersion: SHARE_SCHEMA_VERSION, folder: baseName(folder) || 'Notes', notes: kept };
  assertShareSize(payload, limit);
  return payload;
}

function linkedContent(card: LinkedCard): SharedCard | null {
  if (card.kind === 'basic') {
    return { kind: 'basic', front: card.front, back: card.back, ...(card.reverse ? { reverse: true } : {}), origin: 'linked' };
  }
  if (card.kind === 'cloze') return { kind: 'cloze', text: card.text, origin: 'linked' };
  if (card.kind === 'mcq') {
    return {
      kind: 'mcq',
      prompt: card.prompt,
      options: card.options.map((option) => ({ text: option.text, correct: option.correct })),
      origin: 'linked',
    };
  }
  return null;
}

function reviewCardContent(card: ReviewCard): SharedCard {
  if (card.kind === 'basic') return { kind: 'basic', front: card.front, back: card.back, origin: 'quiz' };
  if (card.kind === 'cloze') return { kind: 'cloze', text: card.text, origin: 'quiz' };
  return {
    kind: 'mcq',
    prompt: card.question.prompt,
    options: card.question.options.map((option) => ({ text: option.text, correct: option.correct })),
    origin: 'quiz',
  };
}

export type DeckPayloadInput = {
  label: string;
  /** Deck folder (for folder decks); note and card paths are stored relative to it. */
  folder?: string;
  /** The deck's review cards (already filtered to the deck). */
  cards: ReviewCard[];
  /** Every linked card in the workspace (only those in `cards` are used). */
  linkedCards: LinkedCard[];
  /** Markdown of the notes holding the deck's inline cards, by workspace path. */
  noteMarkdown: Record<string, string>;
};

/** Note paths whose markdown a deck payload needs (notes with inline cards). */
export function deckSourceNotePaths(cards: ReviewCard[]): string[] {
  return [...new Set(cards.filter((card) => card.source.origin === 'note').map((card) => card.source.path))].sort();
}

/**
 * Card content only: no ids tied to the sharer's history, no scheduling.
 * Inline note cards are listed for display (once per card, reverses and
 * extra cloze groups collapsed) and their notes included so they come along
 * on duplicate.
 */
export function buildDeckPayload(input: DeckPayloadInput, limit = MAX_SHARE_BYTES): DeckPayload {
  const folder = input.folder ?? '';
  const out: SharedCard[] = [];
  const notes: SharedNote[] = [];
  const linkedByUid = new Map(input.linkedCards.map((card) => [card.uid, card]));
  const seenLinked = new Set<string>();
  const seenQuiz = new Set<string>();

  const notePaths = deckSourceNotePaths(input.cards);
  const included = new Set<string>();
  for (const path of notePaths) {
    const markdown = input.noteMarkdown[path];
    if (markdown === undefined) continue;
    included.add(path);
    const rel = relativeTo(folder, path);
    notes.push({ path: rel, markdown });
    const seenCloze = new Set<string>();
    for (const span of parseNoteCardSpans(markdown)) {
      if (span.reverse) continue;
      if (span.kind === 'basic') {
        out.push({ kind: 'basic', front: span.front, back: span.back, ...(span.paired ? { reverse: true } : {}), origin: 'note', sourcePath: rel });
      } else if (span.kind === 'cloze') {
        if (seenCloze.has(span.text)) continue;
        seenCloze.add(span.text);
        out.push({ kind: 'cloze', text: span.text, origin: 'note', sourcePath: rel });
      } else if (span.options.some((option) => option.correct)) {
        out.push({ kind: 'mcq', prompt: span.prompt, options: span.options.map((o) => ({ text: o.text, correct: o.correct })), origin: 'note', sourcePath: rel });
      }
    }
  }

  for (const card of input.cards) {
    const source = card.source;
    if (source.origin === 'linked') {
      if (!source.uid || seenLinked.has(source.uid)) continue;
      seenLinked.add(source.uid);
      const linked = linkedByUid.get(source.uid);
      const content = linked ? linkedContent(linked) : null;
      if (!content) continue;
      out.push(linked?.path && included.has(linked.path) ? { ...content, sourcePath: relativeTo(folder, linked.path) } : content);
    } else if (source.origin === 'quiz') {
      const content = reviewCardContent(card);
      const key = JSON.stringify(content);
      if (seenQuiz.has(key)) continue; // cloze questions yield one card per blank group
      seenQuiz.add(key);
      out.push(content);
    }
  }

  const payload: DeckPayload = { schemaVersion: SHARE_SCHEMA_VERSION, label: input.label, cards: out, notes };
  assertShareSize(payload, limit);
  return payload;
}

/**
 * Quiz content only (questions, options, answers, explanations, rubric).
 * Attempts and scores live in quiz history, never in the quiz note, and the
 * `source` link to the sharer's note is dropped.
 */
export function buildQuizPayload(path: string, markdown: string): QuizPayload {
  const doc = parseQuizMarkdown(markdown);
  const payload: QuizPayload = {
    schemaVersion: SHARE_SCHEMA_VERSION,
    path: baseName(path),
    quiz: {
      title: doc.title || titleFromPath(path),
      rubric: doc.rubric,
      questions: JSON.parse(JSON.stringify(doc.questions)) as QuizPayload['quiz']['questions'],
    },
  };
  assertShareSize(payload);
  return payload;
}

// ── Reader (viewer / duplicate side) ────────────────────────────────────────

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isNote(value: unknown): value is SharedNote {
  return isObject(value) && typeof value.path === 'string' && typeof value.markdown === 'string';
}

function isCard(value: unknown): value is SharedCard {
  if (!isObject(value)) return false;
  if (value.kind === 'basic') return typeof value.front === 'string' && typeof value.back === 'string';
  if (value.kind === 'cloze') return typeof value.text === 'string';
  if (value.kind === 'mcq') return typeof value.prompt === 'string' && Array.isArray(value.options);
  return false;
}

/** Validate a stored payload for `kind`. Throws UnsupportedShareError. */
export function readSharePayload<K extends ShareKind>(kind: K, payload: unknown): SharePayloadByKind[K] {
  if (!isObject(payload) || typeof payload.schemaVersion !== 'number') throw new UnsupportedShareError();
  if (payload.schemaVersion > SHARE_SCHEMA_VERSION) throw new UnsupportedShareError();
  const p = payload;
  switch (kind) {
    case 'note':
      if (typeof p.path === 'string' && typeof p.markdown === 'string') return p as SharePayloadByKind[K];
      break;
    case 'folder':
      if (typeof p.folder === 'string' && Array.isArray(p.notes) && p.notes.every(isNote)) return p as SharePayloadByKind[K];
      break;
    case 'deck':
      if (typeof p.label === 'string' && Array.isArray(p.cards) && Array.isArray(p.notes) && p.notes.every(isNote)) {
        return { ...p, cards: p.cards.filter(isCard) } as SharePayloadByKind[K];
      }
      break;
    case 'quiz':
      if (typeof p.path === 'string' && isObject(p.quiz) && Array.isArray(p.quiz.questions)) return p as SharePayloadByKind[K];
      break;
  }
  throw new UnsupportedShareError();
}
