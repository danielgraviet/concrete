import { afterEach, describe, expect, it } from 'vitest';
import { setBackendForTesting } from '../../backend';
import { InMemoryCloudRepository } from '../../backend/cloud/memory/InMemoryCloudRepository';
import { FakeAuthProvider } from '../../backend/cloud/AuthProvider';
import type { Backend } from '../../backend/types';
import { initWebBackend, resetWebSessionForTesting } from '../../backend/web/session';
import { cardsFromNote, draftsFromLinkedCards, withIds } from '../../learn/buildCards';
import type { LinkedCard } from '../../learn/LinkedCards';
import { LinkedCardStore } from '../../learn/LinkedCardStore';
import { cloudRootFor } from '../../backend/web/cloudVault';
import { parseQuizMarkdown } from '../../quiz/parseQuizMarkdown';
import { serializeQuizMarkdown } from '../../quiz/serializeQuizMarkdown';
import type { QuizDocument } from '../../quiz/types';
import { collectShare } from './collect';
import { duplicateShare, safeSegment, uniqueName } from './duplicate';
import { linkedCardWriter } from './linkedCards';
import {
  ShareTooLargeError,
  UnsupportedShareError,
  buildDeckPayload,
  buildFolderPayload,
  buildNotePayload,
  buildQuizPayload,
  readSharePayload,
} from './payloads';
import { parseShareRoute, shareUrl } from './route';
import { SHARE_SCHEMA_VERSION, type DeckPayload, type FolderPayload, type QuizPayload } from './types';

const REVIEW_STATE_KEYS = /"(sched|due|stability|difficulty|reps|lapses|last_review|enrolled|fp)"/;

const NOTE_WITH_CARDS = [
  '# Cells',
  '',
  'Powerhouse of the cell :: Mitochondria',
  '',
  'Term ::: Definition',
  '',
  'The {{c1::nucleus}} holds {{c2::DNA}}.',
  '',
].join('\n');

const QUIZ_DOC: QuizDocument = {
  title: 'Quiz Cells',
  source: 'Bio/Cells.md',
  rubric: 'Be precise.',
  questions: [
    {
      id: 'q1',
      type: 'mcq',
      prompt: 'Which organelle makes ATP?',
      options: [
        { id: 'a', text: 'Mitochondria', correct: true },
        { id: 'b', text: 'Ribosome', correct: false },
      ],
    },
    { id: 'q2', type: 'open', prompt: 'What does DNA store?', answer: 'Genetic information', keyPoints: ['genes'] },
  ],
};

function linked(overrides: Partial<LinkedCard> = {}): LinkedCard {
  return { uid: 'lc-1', kind: 'basic', front: 'What is ATP?', back: 'Energy currency', path: 'Bio/Cells.md', created: 1, ...overrides } as LinkedCard;
}

function fakeBackend(): Backend {
  return {
    target: 'web',
    capabilities: {
      localAgents: false,
      revealInFolder: false,
      openWithOsApp: false,
      diskImport: false,
      nativePdfExport: false,
      localTelemetry: false,
      sandbox: false,
      apiKeySettings: false,
    },
  };
}

afterEach(() => {
  resetWebSessionForTesting();
  setBackendForTesting(null);
});

describe('route', () => {
  it('parses /s/:shareId', () => {
    expect(parseShareRoute('/s/abc123')).toBe('abc123');
    expect(parseShareRoute('/s/abc_1-2/')).toBe('abc_1-2');
    expect(parseShareRoute('/')).toBeNull();
    expect(parseShareRoute('/s/')).toBeNull();
    expect(parseShareRoute('/s/a/b')).toBeNull();
    expect(parseShareRoute('/x/abc')).toBeNull();
    expect(parseShareRoute('/s/a%2Fb')).toBeNull();
  });

  it('builds share URLs', () => {
    expect(shareUrl('https://app.example/', 'abc')).toBe('https://app.example/s/abc');
  });
});

describe('payload builders', () => {
  it('note: schemaVersion, file name only', () => {
    const payload = buildNotePayload('Private/Bio/Cells.md', NOTE_WITH_CARDS);
    expect(payload).toEqual({ schemaVersion: SHARE_SCHEMA_VERSION, path: 'Cells.md', markdown: NOTE_WITH_CARDS });
  });

  it('folder: relative paths, skips hidden and non-markdown files', () => {
    const payload = buildFolderPayload('Bio', [
      { path: 'Bio/Cells.md', markdown: 'a' },
      { path: 'Bio/Sub/Genes.md', markdown: 'b' },
      { path: 'Bio/.vault/srs.json', markdown: '{}' },
      { path: 'Bio/scan.pdf', markdown: '' },
    ]);
    expect(payload.schemaVersion).toBe(SHARE_SCHEMA_VERSION);
    expect(payload.folder).toBe('Bio');
    expect(payload.notes.map((n) => n.path)).toEqual(['Cells.md', 'Sub/Genes.md']);
  });

  it('folder: size guard throws a friendly error', () => {
    const big = 'x'.repeat(2000);
    expect(() => buildFolderPayload('Bio', [{ path: 'Bio/A.md', markdown: big }], 1000)).toThrow(ShareTooLargeError);
    expect(() => buildFolderPayload('Bio', [{ path: 'Bio/A.md', markdown: big }], 1000)).toThrow(/too big to share/);
  });

  it('note: size guard', () => {
    expect(() => buildNotePayload('A.md', 'x'.repeat(900_000))).toThrow(ShareTooLargeError);
  });

  it('deck: card content only, no review state, inline cards come with their note', () => {
    const cards = [
      ...cardsFromNote('Bio/Cells.md', NOTE_WITH_CARDS),
      ...withIds(draftsFromLinkedCards([linked(), linked({ uid: 'lc-2', kind: 'cloze', text: 'ATP is made in {{mitochondria}}', path: '', folder: 'Bio' } as Partial<LinkedCard>)])),
    ];
    const payload = buildDeckPayload({
      label: 'Bio',
      folder: 'Bio',
      cards,
      linkedCards: [linked(), linked({ uid: 'lc-2', kind: 'cloze', text: 'ATP is made in {{mitochondria}}', path: '', folder: 'Bio' } as Partial<LinkedCard>), linked({ uid: 'lc-other', front: 'not in deck' })],
      noteMarkdown: { 'Bio/Cells.md': NOTE_WITH_CARDS },
    });
    expect(payload.schemaVersion).toBe(SHARE_SCHEMA_VERSION);
    expect(payload.notes).toEqual([{ path: 'Cells.md', markdown: NOTE_WITH_CARDS }]);
    const noteCards = payload.cards.filter((c) => c.origin === 'note');
    // basic, paired basic (reverse collapsed), one cloze for two groups
    expect(noteCards).toHaveLength(3);
    expect(noteCards[1]).toMatchObject({ kind: 'basic', front: 'Term', back: 'Definition', reverse: true });
    const linkedCards = payload.cards.filter((c) => c.origin === 'linked');
    expect(linkedCards).toEqual([
      { kind: 'basic', front: 'What is ATP?', back: 'Energy currency', origin: 'linked', sourcePath: 'Cells.md' },
      { kind: 'cloze', text: 'ATP is made in {{mitochondria}}', origin: 'linked' },
    ]);
    const json = JSON.stringify(payload);
    expect(json).not.toMatch(REVIEW_STATE_KEYS);
    expect(json).not.toContain('lc-1');
    expect(json).not.toContain('not in deck');
  });

  it('quiz: questions only, no attempts or source link', () => {
    const payload = buildQuizPayload('Bio/Quiz Cells.md', serializeQuizMarkdown(QUIZ_DOC));
    expect(payload.schemaVersion).toBe(SHARE_SCHEMA_VERSION);
    expect(payload.path).toBe('Quiz Cells.md');
    expect(payload.quiz.title).toBe('Quiz Cells');
    expect(payload.quiz.questions).toHaveLength(2);
    expect(payload.quiz.questions[0]).toMatchObject({ type: 'mcq', prompt: 'Which organelle makes ATP?' });
    const json = JSON.stringify(payload);
    expect(json).not.toContain('Bio/Cells.md');
    expect(json).not.toMatch(/"(attempts?|score|responses?|grade)"/);
  });

  it('reader rejects newer schema versions and malformed payloads', () => {
    expect(() => readSharePayload('note', { schemaVersion: 99, path: 'a', markdown: '' })).toThrow(UnsupportedShareError);
    expect(() => readSharePayload('folder', { schemaVersion: 1 })).toThrow(UnsupportedShareError);
    expect(readSharePayload('note', { schemaVersion: 1, path: 'a.md', markdown: 'x' }).markdown).toBe('x');
  });
});

describe('duplicate name resolution', () => {
  it('appends a number on conflict, case-insensitively', () => {
    expect(uniqueName('Cells', [])).toBe('Cells');
    expect(uniqueName('Cells', ['cells'])).toBe('Cells 2');
    expect(uniqueName('Cells', ['Cells', 'Cells 2', 'CELLS 3'])).toBe('Cells 4');
  });

  it('makes titles safe path segments', () => {
    expect(safeSegment('a/b: c?')).toBe('a b c');
    expect(safeSegment('  ..  ')).toBe('Untitled');
  });

  it('creates a unique note on conflict', async () => {
    const repo = new InMemoryCloudRepository();
    await repo.createNote('me', 'Shared/Cells', 'mine');
    const record = { shareId: 's1', ownerWs: 'o', kind: 'note' as const, title: 'Cells', createdAt: '', payload: { schemaVersion: 1, path: 'Cells.md', markdown: 'theirs' } };
    const first = await duplicateShare(record, { repo, ws: 'me' });
    const second = await duplicateShare(record, { repo, ws: 'me' });
    expect(first.openPath).toBe('Shared/Cells 2.md');
    expect(second.openPath).toBe('Shared/Cells 3.md');
    expect(await repo.readNote('me', 'Shared/Cells.md')).toBe('mine');
    expect(await repo.readNote('me', 'Shared/Cells 2.md')).toBe('theirs');
  });

  it('creates a unique folder on conflict', async () => {
    const repo = new InMemoryCloudRepository();
    await repo.mkdir('me', 'Shared/Bio');
    const payload: FolderPayload = { schemaVersion: 1, folder: 'Bio', notes: [{ path: 'Cells.md', markdown: 'x' }, { path: '../evil.md', markdown: 'no' }] };
    const result = await duplicateShare({ shareId: 's', ownerWs: 'o', kind: 'folder', title: 'Bio', createdAt: '', payload }, { repo, ws: 'me' });
    expect(result.folder).toBe('Shared/Bio 2');
    expect(result.openPath).toBe('Shared/Bio 2/Cells.md');
    const tree = await repo.listTree('me');
    expect(tree.notes.map((n) => n.path)).toEqual(['Shared/Bio 2/Cells.md']);
  });
});

describe('share → getShare → duplicate round trip', () => {
  it('works for note, folder, quiz and deck with fresh cards', async () => {
    const backend = fakeBackend();
    setBackendForTesting(backend);
    const session = await initWebBackend({ firebaseConfigured: false, backend });
    const repo = session.repo;
    expect(repo).toBeInstanceOf(InMemoryCloudRepository);
    expect(session.auth).toBeInstanceOf(FakeAuthProvider);
    const owner = 'owner-ws';

    await repo.writeNote(owner, 'Bio/Cells.md', NOTE_WITH_CARDS);
    await repo.writeNote(owner, 'Bio/Sub/Genes.md', '# Genes');
    await repo.writeNote(owner, 'Bio/Quiz Cells.md', serializeQuizMarkdown(QUIZ_DOC));
    // Owner's review state must never travel.
    await repo.writeData(owner, '.vault/srs-v2-0.json', JSON.stringify({ cards: { x: { sched: { due: 1 } } } }));

    const linkedCards = [linked()];
    const deckCards = [...cardsFromNote('Bio/Cells.md', NOTE_WITH_CARDS), ...withIds(draftsFromLinkedCards(linkedCards))];

    const shareIds: Record<string, string> = {};
    for (const target of [
      { kind: 'note' as const, path: 'Bio/Cells.md' },
      { kind: 'folder' as const, path: 'Bio' },
      { kind: 'quiz' as const, path: 'Bio/Quiz Cells.md' },
      { kind: 'deck' as const, deck: { kind: 'folder' as const, label: 'Bio', folder: 'Bio' }, cards: deckCards, linkedCards },
    ]) {
      const input = await collectShare(repo, owner, target);
      expect(JSON.stringify(input.payload)).not.toMatch(REVIEW_STATE_KEYS);
      shareIds[target.kind] = (await repo.createShare(owner, input)).shareId;
    }

    // Recipient signs in (FakeAuthProvider) and duplicates each share.
    await session.auth.signOut();
    const recipient = await session.auth.signInWithGoogle();
    expect(recipient.uid).not.toBe(owner);
    const deps = { repo, ws: recipient.uid, addLinkedCards: linkedCardWriter(session, recipient) };

    const noteRecord = await repo.getShare(shareIds.note);
    expect(noteRecord?.title).toBe('Cells');
    const note = await duplicateShare(noteRecord!, deps);
    expect(note.openPath).toBe('Shared/Cells.md');
    expect(await repo.readNote(recipient.uid, 'Shared/Cells.md')).toBe(NOTE_WITH_CARDS);

    const folder = await duplicateShare((await repo.getShare(shareIds.folder))!, deps);
    expect(folder.folder).toBe('Shared/Bio');
    expect(await repo.readNote(recipient.uid, 'Shared/Bio/Sub/Genes.md')).toBe('# Genes');
    expect((readSharePayload('folder', (await repo.getShare(shareIds.folder))!.payload) as FolderPayload).notes).toHaveLength(3);

    const quiz = await duplicateShare((await repo.getShare(shareIds.quiz))!, deps);
    expect(quiz.openPath).toBe('Shared/Quiz Cells.md');
    const quizBody = await repo.readNote(recipient.uid, quiz.openPath!);
    const parsed = parseQuizMarkdown(quizBody!);
    expect(parsed.questions.map((q) => q.prompt)).toEqual(QUIZ_DOC.questions.map((q) => q.prompt));
    expect(parsed.source).toBeUndefined();
    expect((readSharePayload('quiz', (await repo.getShare(shareIds.quiz))!.payload) as QuizPayload).quiz.questions).toHaveLength(2);

    const deckRecord = (await repo.getShare(shareIds.deck))!;
    expect((readSharePayload('deck', deckRecord.payload) as DeckPayload).cards.length).toBeGreaterThan(0);
    // Read cards back through LinkedCardStore's public API, straight from the repository
    // (bypassing the vault's caches) so this proves they were persisted.
    const storedCards = async () => {
      const store = new LinkedCardStore(cloudRootFor(recipient.uid), {
        read: (name) => repo.readData(recipient.uid, name),
        write: (name, content) => repo.writeData(recipient.uid, name, content),
      });
      await store.load();
      return store.all();
    };
    const before = (await storedCards()).length;
    const deck = await duplicateShare(deckRecord, deps);
    expect(deck.folder).toBe('Shared/Bio 2');
    expect(deck.cardsCreated).toBe(1);
    expect(await repo.readNote(recipient.uid, 'Shared/Bio 2/Cells.md')).toBe(NOTE_WITH_CARDS);
    const stored = await storedCards();
    expect(stored).toHaveLength(before + 1);
    const created = stored.at(-1)!;
    expect(created).toMatchObject({ kind: 'basic', front: 'What is ATP?', back: 'Energy currency', path: 'Shared/Bio 2/Cells.md' });
    expect(created.uid).not.toBe('lc-1');
    expect(JSON.stringify(created)).not.toMatch(REVIEW_STATE_KEYS);
    // Nothing about the owner's review history reached the recipient.
    expect(await repo.readData(recipient.uid, '.vault/srs-v2-0.json')).toBeNull();
  });

  it('getShare returns null for a deleted share', async () => {
    const repo = new InMemoryCloudRepository();
    const { shareId } = await repo.createShare('o', { kind: 'note', title: 'x', payload: buildNotePayload('x.md', 'x') as never });
    await repo.deleteShare('o', shareId);
    expect(await repo.getShare(shareId)).toBeNull();
  });
});
