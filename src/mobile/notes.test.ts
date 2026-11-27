import { describe, expect, it } from 'vitest';
import { groupNotes } from './notes';

describe('groupNotes', () => {
  it('separates root notes from folder notes', () => {
    const { rootFiles, folders } = groupNotes(['Welcome.md', 'Stats/Overview.md', 'Stats/Regression.md']);
    expect(rootFiles).toEqual(['Welcome.md']);
    expect(folders).toEqual([['Stats', ['Stats/Overview.md', 'Stats/Regression.md']]]);
  });

  it('groups only by top-level folder and keeps insertion order within a folder', () => {
    const { folders } = groupNotes([
      'Machine Learning/Deep/Notes.md',
      'Machine Learning/Basics.md',
      'Stats/Overview.md',
    ]);
    expect(folders).toEqual([
      ['Machine Learning', ['Machine Learning/Deep/Notes.md', 'Machine Learning/Basics.md']],
      ['Stats', ['Stats/Overview.md']],
    ]);
  });

  it('sorts folders alphabetically', () => {
    const { folders } = groupNotes(['Zebra/Notes.md', 'Alpha/Notes.md']);
    expect(folders.map(([folder]) => folder)).toEqual(['Alpha', 'Zebra']);
  });

  it('returns empty groups for an empty vault', () => {
    expect(groupNotes([])).toEqual({ rootFiles: [], folders: [] });
  });
});
