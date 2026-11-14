/**
 * Read what a ShareTarget points at from the sharer's workspace and build
 * its payload. Reads go to the repository, so callers flush buffered vault
 * writes first (`WebAccount.flush`).
 */

import type { CloudRepository, CreateShareInput, WorkspaceId } from '../../backend/cloud/CloudRepository';
import { NotFoundError } from '../../backend/cloud/errors';
import { deckFilter } from '../../learn/decks';
import {
  MAX_SHARE_BYTES,
  ShareTooLargeError,
  buildDeckPayload,
  buildFolderPayload,
  buildNotePayload,
  buildQuizPayload,
  deckSourceNotePaths,
  shareTitle,
  titleFromPath,
  toJson,
} from './payloads';
import type { SharedNote, ShareTarget } from './types';

async function readRequired(repo: CloudRepository, ws: WorkspaceId, path: string): Promise<string> {
  const body = await repo.readNote(ws, path);
  if (body === null) throw new NotFoundError(`"${titleFromPath(path)}" no longer exists.`);
  return body;
}

/** Human title for the dialog and the share record. */
export function targetTitle(target: ShareTarget): string {
  switch (target.kind) {
    case 'note':
    case 'quiz':
      return shareTitle(titleFromPath(target.path));
    case 'folder':
      return shareTitle(target.path.split('/').pop() || 'Notes');
    case 'deck':
      return shareTitle(target.deck.label);
  }
}

export async function collectShare(repo: CloudRepository, ws: WorkspaceId, target: ShareTarget): Promise<CreateShareInput> {
  const title = targetTitle(target);
  switch (target.kind) {
    case 'note':
      return { kind: 'note', title, payload: toJson(buildNotePayload(target.path, await readRequired(repo, ws, target.path))) };

    case 'quiz':
      return { kind: 'quiz', title, payload: toJson(buildQuizPayload(target.path, await readRequired(repo, ws, target.path))) };

    case 'folder': {
      const tree = await repo.listTree(ws);
      const prefix = `${target.path}/`;
      const metas = tree.notes.filter((note) => note.path.startsWith(prefix) && /\.md$/i.test(note.path));
      // Fail fast on obviously huge folders before downloading every body.
      const estimated = metas.reduce((sum, note) => sum + note.size, 0);
      if (estimated > MAX_SHARE_BYTES) throw new ShareTooLargeError(estimated);
      const notes: SharedNote[] = [];
      for (const meta of metas) {
        const markdown = await repo.readNote(ws, meta.path);
        if (markdown !== null) notes.push({ path: meta.path, markdown });
      }
      return { kind: 'folder', title, payload: toJson(buildFolderPayload(target.path, notes)) };
    }

    case 'deck': {
      const cards = target.cards.filter(deckFilter(target.deck));
      const noteMarkdown: Record<string, string> = {};
      for (const path of deckSourceNotePaths(cards)) {
        const markdown = await repo.readNote(ws, path);
        if (markdown !== null) noteMarkdown[path] = markdown;
      }
      const payload = buildDeckPayload({
        label: target.deck.label,
        folder: target.deck.kind === 'folder' ? target.deck.folder : undefined,
        cards,
        linkedCards: target.linkedCards,
        noteMarkdown,
      });
      return { kind: 'deck', title, payload: toJson(payload) };
    }
  }
}
