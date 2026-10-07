import { describe, expect, it } from 'vitest';
import { noteExportTitle, prepareNoteMarkdown } from './prepareNoteMarkdown';

describe('prepareNoteMarkdown', () => {
  it('strips frontmatter, wikilinks, cloze, and column fences', () => {
    const markdown = [
      '---',
      'title: Hidden',
      '---',
      'See [[Projects|the project]] and [[Ideas]].',
      'The {{mitochondria}} makes ATP.',
      ':::columns',
      ':::column',
      '- Local',
      ':::',
      '```',
      'keep [[this]] and {{that}}',
      '```',
    ].join('\n');
    const prepared = prepareNoteMarkdown(markdown);
    expect(prepared).not.toContain('title: Hidden');
    expect(prepared).toContain('the project');
    expect(prepared).toContain('Ideas');
    expect(prepared).toContain('**mitochondria**');
    expect(prepared).not.toContain(':::');
    expect(prepared).toContain('keep [[this]] and {{that}}');
  });

  it('uses the first heading as the PDF title', () => {
    expect(noteExportTitle('# Forces and motion\n\nBody', 'Stats/Overview.md')).toBe('Forces and motion');
    expect(noteExportTitle('No heading', 'Stats/Overview.md')).toBe('Overview');
  });
});
