import { describe, expect, it, vi } from 'vitest';
import { ChatSessionStore, memoryChatIO, SESSION_INDEX_FILE, sessionFile, sessionTitle } from './sessionStore';
import { legacyThreadFile, type StudyChatMessage } from './threadStore';

const user = (text: string, notePath?: string): StudyChatMessage => ({
  id: Math.random().toString(36),
  role: 'user',
  mode: 'chat',
  text,
  ...(notePath ? { notePath } : {}),
});
const reply = (text: string): StudyChatMessage => ({ id: Math.random().toString(36), role: 'assistant', mode: 'chat', text });
const log = (text: string): StudyChatMessage => ({ id: Math.random().toString(36), role: 'log', mode: 'agent', text });

async function freshStore(files = new Map<string, string>()) {
  const store = new ChatSessionStore(memoryChatIO(files));
  await store.load();
  return { store, files };
}

describe('ChatSessionStore', () => {
  it('keeps one session across notes and records each note it touched', async () => {
    const { store } = await freshStore();
    const id = store.ensureActive();
    store.update(id, (m) => [...m, user('What is entropy?', 'Physics.md'), reply('Disorder.')]);
    store.update(id, (m) => [...m, user('And in ML?', 'ML/Notes.md'), reply('Uncertainty.')]);
    expect(store.ensureActive()).toBe(id);
    expect(store.sessions()).toEqual([
      expect.objectContaining({ id, title: 'What is entropy?', notePaths: ['Physics.md', 'ML/Notes.md'] }),
    ]);
  });

  it('does not list a new chat until it has a question', async () => {
    const { store } = await freshStore();
    store.ensureActive();
    expect(store.sessions()).toEqual([]);
  });

  it('persists transcripts without agent logs and restores the active session', async () => {
    const { store, files } = await freshStore();
    const id = store.ensureActive();
    store.update(id, (m) => [...m, user('Add a summary', 'A.md'), log('Thinking…'), reply('Done.')]);
    store.save(id);
    await store.flush();

    const { store: reopened } = await freshStore(files);
    expect(reopened.activeId).toBe(id);
    expect(reopened.messages().map((m) => m.role)).toEqual(['user', 'assistant']);
  });

  it('startNew keeps the previous session in history and reopens it', async () => {
    const { store, files } = await freshStore();
    const first = store.ensureActive();
    store.update(first, (m) => [...m, user('First')]);
    store.save(first);
    store.startNew();
    expect(store.activeId).toBeNull();
    expect(store.messages()).toEqual([]);

    const second = store.ensureActive();
    store.update(second, (m) => [...m, user('Second')]);
    store.save(second);
    await store.flush();

    const { store: reopened } = await freshStore(files);
    expect(reopened.sessions().map((s) => s.title).sort()).toEqual(['First', 'Second']);
    await reopened.open(first);
    expect(reopened.activeId).toBe(first);
    expect(reopened.messages().map((m) => m.text)).toEqual(['First']);
  });

  it('removes a session and its file', async () => {
    const { store, files } = await freshStore();
    const id = store.ensureActive();
    store.update(id, (m) => [...m, user('Bye')]);
    store.save(id);
    await store.flush();
    store.remove(id);
    await store.flush();
    expect(store.sessions()).toEqual([]);
    expect(store.activeId).toBeNull();
    expect(files.has(sessionFile(id))).toBe(false);
    expect(JSON.parse(files.get(SESSION_INDEX_FILE)!).sessions).toEqual([]);
  });

  it('imports legacy per-note threads once, tagging messages with their note', async () => {
    const files = new Map<string, string>([
      [legacyThreadFile('A.md'), JSON.stringify({ version: 1, path: 'A.md', updatedAt: 5, messages: [user('Old question'), reply('Old answer')] })],
      // Hash collision guard: a file whose stored path is another note is ignored.
      [legacyThreadFile('B.md'), JSON.stringify({ version: 1, path: 'Other.md', updatedAt: 6, messages: [user('x')] })],
    ]);
    const { store } = await freshStore(files);
    await store.importLegacy(['A.md', 'B.md', 'C.md']);
    await store.importLegacy(['A.md']);
    await store.flush();

    const sessions = store.sessions();
    expect(sessions).toEqual([expect.objectContaining({ title: 'Old question', notePaths: ['A.md'], updatedAt: 5 })]);
    await store.open(sessions[0].id);
    expect(store.messages()[0]).toMatchObject({ text: 'Old question', notePath: 'A.md' });
    expect(files.has(legacyThreadFile('A.md'))).toBe(true);

    const { store: reopened } = await freshStore(files);
    await reopened.importLegacy(['A.md']);
    expect(reopened.sessions()).toHaveLength(1);
  });

  it('starts empty when the index is corrupt', async () => {
    const { store } = await freshStore(new Map([[SESSION_INDEX_FILE, '{nope']]));
    expect(store.sessions()).toEqual([]);
    expect(store.activeId).toBeNull();
  });

  it('notifies subscribers on change', async () => {
    const { store } = await freshStore();
    const listener = vi.fn();
    store.subscribe(listener);
    store.update(store.ensureActive(), (m) => [...m, user('Hi')]);
    expect(listener).toHaveBeenCalledTimes(2);
  });
});

describe('sessionTitle', () => {
  it('uses the first question on one line, truncated', () => {
    expect(sessionTitle([log('x'), user('  Explain\n\nentropy  ')])).toBe('Explain entropy');
    expect(sessionTitle([user('a'.repeat(80))])).toHaveLength(60);
    expect(sessionTitle([])).toBe('New chat');
  });
});
