import { afterEach, describe, expect, it } from 'vitest';
import { clearQuizDraft, loadQuizDraft, saveQuizDraft } from './draft';

const memory = new Map<string, string>();

afterEach(() => {
  memory.clear();
});

function installMemoryStorage() {
  const storage = {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => {
      memory.set(key, value);
    },
    removeItem: (key: string) => {
      memory.delete(key);
    },
  };
  Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true });
}

describe('quiz drafts', () => {
  it('restores an in-progress attempt and drops it after submit', () => {
    installMemoryStorage();
    saveQuizDraft('vault', {
      path: 'Quiz Notes.md',
      sessionSeed: 'Quiz Notes.md:1:abc',
      startedAt: 10,
      responses: { q1: { questionId: 'q1', type: 'open', text: 'half written' } },
    });

    expect(loadQuizDraft('vault', 'Quiz Notes.md')).toMatchObject({
      sessionSeed: 'Quiz Notes.md:1:abc',
      responses: { q1: { text: 'half written' } },
    });
    expect(loadQuizDraft('other', 'Quiz Notes.md')).toBeNull();

    clearQuizDraft('vault', 'Quiz Notes.md');
    expect(loadQuizDraft('vault', 'Quiz Notes.md')).toBeNull();
  });
});
