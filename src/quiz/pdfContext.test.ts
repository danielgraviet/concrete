import { describe, expect, it } from 'vitest';
import { buildPdfContext, cleanPdfPages, NO_TEXT_ERROR, parsePageRange } from './pdfContext';

describe('cleanPdfPages', () => {
  it('drops running headers and page numbers', () => {
    const bodies = ['Cells have membranes.', 'DNA is a double helix.', 'Ribosomes make proteins.', 'ATP stores energy.'];
    const pages = bodies.map((body, i) => `Intro to Biology · Chapter 2\n${body}\nPage ${i + 1} of 4`);
    expect(cleanPdfPages(pages)).toEqual(bodies);
  });

  it('keeps repeated lines when there are too few pages to tell', () => {
    expect(cleanPdfPages(['Title\nBody one', 'Title\nBody two'])).toEqual([
      'Title\nBody one',
      'Title\nBody two',
    ]);
  });

  it('rejoins hyphenated words and collapses whitespace', () => {
    expect(cleanPdfPages(['The mito-\nchondria   is  the\npowerhouse'])).toEqual([
      'The mitochondria is the\npowerhouse',
    ]);
  });

  it('keeps hyphens before capitals (real compound terms)', () => {
    expect(cleanPdfPages(['Anglo-\nSaxon'])).toEqual(['Anglo-\nSaxon']);
  });
});

describe('parsePageRange', () => {
  it('parses ranges and singles, sorted and unique', () => {
    expect(parsePageRange('5, 1-3, 2')).toEqual([1, 2, 3, 5]);
  });

  it('treats empty input as every page', () => {
    expect(parsePageRange('  ', 3)).toEqual([1, 2, 3]);
    expect(parsePageRange('')).toEqual([]);
  });

  it('rejects bad syntax, reversed and out-of-range pages', () => {
    expect(() => parsePageRange('abc')).toThrow(/Invalid page range/);
    expect(() => parsePageRange('0')).toThrow(/Invalid/);
    expect(() => parsePageRange('5-3')).toThrow(/Invalid/);
    expect(() => parsePageRange('2-9', 4)).toThrow(/past the end/);
    expect(parsePageRange('2-9')).toHaveLength(8);
  });
});

describe('buildPdfContext', () => {
  const pages = Array.from({ length: 50 }, (_, i) => `Page ${i + 1} text. `.repeat(60));

  it('returns every selected page with tags when it fits', () => {
    const out = buildPdfContext(['alpha beta gamma delta', 'epsilon zeta eta'], [1, 2], 1000);
    expect(out).toBe('[p. 1]\nalpha beta gamma delta\n\n[p. 2]\nepsilon zeta eta');
  });

  it('samples evenly across the whole selection when over budget', () => {
    const out = buildPdfContext(pages, parsePageRange('', 50), 6000);
    expect(out.length).toBeLessThanOrEqual(6000);
    expect(out).toContain('[p. 1]');
    expect(out).toMatch(/\[p\. 4\d\]/);
  });

  it('only uses the requested pages', () => {
    const out = buildPdfContext(pages, [10, 11], 100000);
    expect(out).toContain('[p. 10]');
    expect(out).not.toContain('[p. 1]\n');
  });

  it('throws a clear error for scanned PDFs', () => {
    expect(() => buildPdfContext(['', ' ', ''], [1, 2, 3], 1000)).toThrow(NO_TEXT_ERROR);
  });
});
