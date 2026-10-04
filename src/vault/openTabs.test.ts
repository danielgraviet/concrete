import { describe, expect, it } from 'vitest';
import {
  closeNoteTab,
  MAX_OPEN_TABS,
  openNoteInTabs,
  renamePathsInTabs,
  tabAfterClose,
} from './openTabs';

describe('openNoteInTabs', () => {
  it('appends a new note and leaves an already-open note in place', () => {
    expect(openNoteInTabs(['a.md', 'b.md'], 'c.md')).toEqual(['a.md', 'b.md', 'c.md']);
    expect(openNoteInTabs(['a.md', 'b.md', 'c.md'], 'a.md')).toEqual(['a.md', 'b.md', 'c.md']);
  });

  it('caps at five open tabs by dropping the oldest', () => {
    const full = ['1.md', '2.md', '3.md', '4.md', '5.md'];
    expect(openNoteInTabs(full, '6.md')).toEqual(['2.md', '3.md', '4.md', '5.md', '6.md']);
    expect(openNoteInTabs(full, '6.md')).toHaveLength(MAX_OPEN_TABS);
  });
});

describe('closeNoteTab / tabAfterClose', () => {
  it('picks a neighbor after close', () => {
    const tabs = ['a.md', 'b.md', 'c.md'];
    expect(closeNoteTab(tabs, 'b.md')).toEqual(['a.md', 'c.md']);
    expect(tabAfterClose(tabs, 'b.md')).toBe('c.md');
    expect(tabAfterClose(tabs, 'c.md')).toBe('b.md');
    expect(tabAfterClose(['only.md'], 'only.md')).toBe(null);
  });
});

describe('renamePathsInTabs', () => {
  it('rewrites file and folder-prefixed paths', () => {
    expect(renamePathsInTabs(['a.md', 'old/x.md'], 'a.md', 'b.md')).toEqual(['b.md', 'old/x.md']);
    expect(renamePathsInTabs(['dir/a.md', 'other.md'], 'dir', 'new')).toEqual(['new/a.md', 'other.md']);
  });
});
