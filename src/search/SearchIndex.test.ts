import { describe, expect, it, vi } from 'vitest';
import { SearchIndex } from './SearchIndex';

const vault: Array<readonly [string, string]> = [
  ['Neural Networks.md', '# Neural Networks\n\nLayers of weights.\n'],
  ['ML/Optimizers.md', '# Optimizers\n\n## Gradient descent\n\nStep against the gradient.\n'],
  ['ML/Notes.md', '# Notes\n\nTraining a neural model uses gradient descent on batches.\n'],
  ['Cooking.md', '# Cooking\n\nNothing about networks here.\n'],
];

function indexOf(entries = vault): SearchIndex {
  const index = new SearchIndex();
  index.replaceAll(entries);
  return index;
}

const paths = (index: SearchIndex, q: string) => index.query(q).map((r) => r.path);

describe('SearchIndex', () => {
  it('ranks title over heading over body', () => {
    const index = indexOf([
      ['Body.md', '# Body\n\nmentions gradient once'],
      ['Heading.md', '# Heading\n\n## Gradient\n\ntext'],
      ['Gradient.md', '# Gradient\n\ntext'],
    ]);
    const results = index.query('gradient');
    expect(results.map((r) => [r.path, r.field])).toEqual([
      ['Gradient.md', 'title'],
      ['Heading.md', 'heading'],
      ['Body.md', 'body'],
    ]);
  });

  it('returns nothing for blank queries', () => {
    expect(indexOf().query('   ')).toEqual([]);
  });

  it('reports the heading as snippet and the first matching line', () => {
    const [hit] = indexOf().query('descent').filter((r) => r.path === 'ML/Optimizers.md');
    expect(hit).toMatchObject({ field: 'heading', snippet: 'Gradient descent', line: 2 });

    const [body] = indexOf().query('batches');
    expect(body).toMatchObject({ path: 'ML/Notes.md', field: 'body', line: 2 });
    expect(body.snippet).toBeUndefined();
  });

  it('reports matched terms, expanding prefixes and preferring a heading phrase', () => {
    const index = indexOf();
    const notes = index.query('neur').find((r) => r.path === 'ML/Notes.md');
    expect(notes?.matches).toEqual(['neural']);
    const optimizers = index.query('gradient descent').find((r) => r.path === 'ML/Optimizers.md');
    expect(optimizers?.matches[0]).toBe('gradient descent');
  });

  it('matches the last term as a prefix for search-as-you-type', () => {
    expect(paths(indexOf(), 'neur')).toEqual(['Neural Networks.md', 'ML/Notes.md']);
  });

  it('ranks an exact term above a prefix match', () => {
    const index = indexOf([
      ['A.md', '# A\n\ngrad student'],
      ['B.md', '# B\n\ngradient'],
    ]);
    expect(paths(index, 'grad')).toEqual(['A.md', 'B.md']);
  });

  it('boosts notes containing the exact phrase', () => {
    const index = indexOf([
      ['Scattered.md', '# Scattered\n\ndescent comes before gradient'],
      ['Phrase.md', '# Phrase\n\nuse gradient descent'],
    ]);
    expect(paths(index, 'gradient descent')).toEqual(['Phrase.md', 'Scattered.md']);
  });

  it('matches title substrings', () => {
    expect(paths(indexOf(), 'timiz')).toEqual(['ML/Optimizers.md']);
  });

  it('ignores frontmatter, hidden files and non-markdown files', () => {
    const index = indexOf([
      ['Meta.md', '---\ntags: secret\n---\n# Meta\n\nvisible'],
      ['AGENTS.md', '# Agents\n\nsecret'],
      ['paper.pdf', 'secret'],
    ]);
    expect(index.query('secret')).toEqual([]);
    expect(paths(index, 'visible')).toEqual(['Meta.md']);
  });

  it('re-indexes a single note on update', () => {
    const index = indexOf();
    index.update('Cooking.md', '# Cooking\n\nPasta with gradient sauce.');
    expect(paths(index, 'networks')).not.toContain('Cooking.md');
    expect(paths(index, 'pasta')).toEqual(['Cooking.md']);
  });

  it('removes notes and drops notes missing from the file list', () => {
    const index = indexOf();
    index.remove('Cooking.md');
    expect(paths(index, 'cooking')).toEqual([]);
    index.retain(['ML/Notes.md']);
    expect(index.size).toBe(1);
    expect(paths(index, 'gradient')).toEqual(['ML/Notes.md']);
  });

  it('gives the same results incrementally as from a full rebuild', () => {
    const incremental = new SearchIndex();
    for (const [path, content] of vault) incremental.update(path, `${content}\nstale words`);
    for (const [path, content] of vault) incremental.update(path, content);
    const rebuilt = indexOf();
    for (const q of ['gradient', 'neural networks', 'opt', 'stale']) {
      expect(incremental.query(q)).toEqual(rebuilt.query(q));
    }
  });

  it('notifies subscribers and bumps the version on change', () => {
    const index = new SearchIndex();
    const listener = vi.fn();
    const unsubscribe = index.subscribe(listener);
    index.update('A.md', '# A');
    expect(listener).toHaveBeenCalledTimes(1);
    expect(index.getVersion()).toBe(1);
    index.remove('missing.md');
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    index.remove('A.md');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('respects the result limit', () => {
    const entries = Array.from({ length: 10 }, (_, i) => [`N${i}.md`, `# N${i}\n\nshared`] as const);
    expect(indexOf(entries).query('shared', 3)).toHaveLength(3);
  });
});
