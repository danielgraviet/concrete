import { describe, expect, it } from 'vitest';
import { highlightSegments, lineSnippet } from './snippets';

describe('lineSnippet', () => {
  it('returns the plain text of a line, counting lines after frontmatter', () => {
    const md = '---\ntags: x\n---\n# Title\n\n- **Gradient** descent uses `lr`';
    expect(lineSnippet(md, 2, ['gradient'])).toBe('Gradient descent uses lr');
    expect(lineSnippet(md, 0, [])).toBe('Title');
  });

  it('windows long lines around the first match with ellipses', () => {
    const line = `${'lead '.repeat(40)}needle${' tail'.repeat(40)}`;
    const snippet = lineSnippet(line, 0, ['needle']);
    expect(snippet.startsWith('…')).toBe(true);
    expect(snippet.endsWith('…')).toBe(true);
    expect(snippet).toContain('needle');
    expect(snippet.length).toBeLessThanOrEqual(142);
  });

  it('returns an empty string for a line past the end', () => {
    expect(lineSnippet('one line', 5, ['x'])).toBe('');
  });
});

describe('highlightSegments', () => {
  it('marks every case-insensitive occurrence of each term', () => {
    expect(highlightSegments('Neural nets and NEURAL maps', ['neural'])).toEqual([
      { text: 'Neural', match: true },
      { text: ' nets and ', match: false },
      { text: 'NEURAL', match: true },
      { text: ' maps', match: false },
    ]);
  });

  it('merges overlapping and adjacent matches', () => {
    expect(highlightSegments('gradient descent', ['gradient descent', 'descent'])).toEqual([
      { text: 'gradient descent', match: true },
    ]);
    expect(highlightSegments('abcd', ['ab', 'cd'])).toEqual([{ text: 'abcd', match: true }]);
  });

  it('returns plain text when there is nothing to highlight', () => {
    expect(highlightSegments('plain', [])).toEqual([{ text: 'plain', match: false }]);
    expect(highlightSegments('', ['x'])).toEqual([]);
  });
});
