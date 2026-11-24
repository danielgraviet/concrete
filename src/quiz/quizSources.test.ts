import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { NOT_PPTX_ERROR } from './pptxContext';
import {
  importQuizSource,
  isQuizSourceFile,
  loadQuizSourceContext,
  NOT_PDF_ERROR,
  PDF_TOO_LARGE_ERROR,
  SOURCE_MISSING_ERROR,
  UNSUPPORTED_SOURCE_ERROR,
  type QuizSourceStore,
} from './quizSources';

/**
 * State-based tests: a deck goes in through the public API, and the tests
 * check what the vault holds afterwards and what quiz context comes out.
 * The vault is an in-memory fake, not a mock: nothing asserts on calls.
 */

class FakeVault implements QuizSourceStore {
  readonly files = new Map<string, Uint8Array>();
  readonly data = new Map<string, string>();

  async exists(path: string): Promise<boolean> {
    return this.files.has(path);
  }
  async saveFile(path: string, bytes: Uint8Array): Promise<void> {
    this.files.set(path, bytes);
  }
  async readFile(path: string): Promise<Uint8Array | null> {
    return this.files.get(path) ?? null;
  }
  async readData(key: string): Promise<string | null> {
    return this.data.get(key) ?? null;
  }
  async writeData(key: string, text: string): Promise<void> {
    this.data.set(key, text);
  }
}

// The app's tsconfig has no Node types, so load fs dynamically behind a
// minimal type (as boundary.test.ts does).
interface NodeFs {
  readFileSync(file: URL): Uint8Array;
}
const nodeModule = (name: string): Promise<unknown> => import(/* @vite-ignore */ name);

let sampleBytes: Promise<Uint8Array> | undefined;

/** The sample deck's bytes, read once. */
function sampleDeck(): Promise<Uint8Array> {
  sampleBytes ??= nodeModule('node:fs').then(
    (fs) => new Uint8Array((fs as NodeFs).readFileSync(new URL('./__fixtures__/cell-membranes.pptx', import.meta.url))),
  );
  return sampleBytes;
}

function slideMarkers(context: string): number[] {
  return [...context.matchAll(/^\[slide (\d+)\]/gm)].map((match) => Number(match[1]));
}

describe('isQuizSourceFile', () => {
  it('accepts PowerPoint decks in any letter case', () => {
    expect(isQuizSourceFile('Lectures/Week 1.pptx')).toBe(true);
    expect(isQuizSourceFile('Week 1.PPTX')).toBe(true);
  });

  it('rejects notes, PDFs and legacy .ppt files', () => {
    expect(isQuizSourceFile('Week 1.md')).toBe(false);
    expect(isQuizSourceFile('Week 1.pdf')).toBe(false);
    expect(isQuizSourceFile('Week 1.ppt')).toBe(false);
  });
});

describe('importQuizSource', () => {
  it('saves the deck in Sources/ and reports its slide count', async () => {
    const vault = new FakeVault();
    const bytes = await sampleDeck();

    const imported = await importQuizSource(vault, { name: 'cell-membranes.pptx', bytes });

    expect(imported).toEqual({
      path: 'Sources/cell-membranes.pptx',
      kind: 'pptx',
      unitCount: 24,
      storedOriginal: true,
    });
    expect(vault.files.get('Sources/cell-membranes.pptx')).toEqual(bytes);
  });

  it('never overwrites a deck with the same name', async () => {
    const vault = new FakeVault();
    const bytes = await sampleDeck();

    await importQuizSource(vault, { name: 'cell-membranes.pptx', bytes });
    const second = await importQuizSource(vault, { name: 'cell-membranes.pptx', bytes });

    expect(second.path).toBe('Sources/cell-membranes 2.pptx');
    expect([...vault.files.keys()].sort()).toEqual(['Sources/cell-membranes 2.pptx', 'Sources/cell-membranes.pptx']);
  });

  it('keeps only the extracted text when the deck is over the storage limit', async () => {
    const vault = new FakeVault();
    const bytes = await sampleDeck();

    const imported = await importQuizSource(vault, { name: 'cell-membranes.pptx', bytes }, { maxStoredBytes: 1_000 });
    const context = await loadQuizSourceContext(vault, imported.path, '5', 10_000);

    expect(imported.storedOriginal).toBe(false);
    expect(vault.files.size).toBe(0);
    expect(slideMarkers(context)).toEqual([5]);
  });

  it('rejects a legacy .ppt and stores nothing', async () => {
    const vault = new FakeVault();
    const legacy = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);

    await expect(importQuizSource(vault, { name: 'Old deck.ppt', bytes: legacy })).rejects.toThrow(NOT_PPTX_ERROR);
    expect(vault.files.size).toBe(0);
    expect(vault.data.size).toBe(0);
  });

  it('rejects a corrupt .pptx and stores nothing', async () => {
    const vault = new FakeVault();
    const corrupt = zipSync({ 'word/document.xml': strToU8('<w:document/>') });

    await expect(importQuizSource(vault, { name: 'Broken.pptx', bytes: corrupt })).rejects.toThrow(NOT_PPTX_ERROR);
    expect(vault.files.size).toBe(0);
    expect(vault.data.size).toBe(0);
  });

  it('saves a PDF in Sources/ next to imported decks', async () => {
    const vault = new FakeVault();
    const bytes = strToU8('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF\n');

    const imported = await importQuizSource(vault, { name: 'Lecture 3.pdf', bytes });

    expect(imported).toEqual({ path: 'Sources/Lecture 3.pdf', kind: 'pdf', unitCount: null, storedOriginal: true });
    expect(vault.files.get('Sources/Lecture 3.pdf')).toEqual(bytes);
  });

  it('never overwrites a PDF with the same name', async () => {
    const vault = new FakeVault();
    const bytes = strToU8('%PDF-1.4\n%%EOF\n');

    await importQuizSource(vault, { name: 'Lecture 3.PDF', bytes });
    const second = await importQuizSource(vault, { name: 'Lecture 3.PDF', bytes });

    expect(second.path).toBe('Sources/Lecture 3 2.PDF');
    expect(vault.files.size).toBe(2);
  });

  it('rejects a PDF over the storage limit and stores nothing', async () => {
    const vault = new FakeVault();
    const bytes = strToU8('%PDF-1.7\n' + 'x'.repeat(2_000));

    await expect(importQuizSource(vault, { name: 'Huge.pdf', bytes }, { maxStoredBytes: 1_000 })).rejects.toThrow(
      PDF_TOO_LARGE_ERROR,
    );
    expect(vault.files.size).toBe(0);
  });

  it('rejects a file named .pdf that is not a PDF and stores nothing', async () => {
    const vault = new FakeVault();

    await expect(
      importQuizSource(vault, { name: 'Notes.pdf', bytes: strToU8('<html>not a pdf</html>') }),
    ).rejects.toThrow(NOT_PDF_ERROR);
    expect(vault.files.size).toBe(0);
  });

  it('rejects file types it cannot read and stores nothing', async () => {
    const vault = new FakeVault();

    await expect(importQuizSource(vault, { name: 'Talk.key', bytes: new Uint8Array([1, 2, 3]) })).rejects.toThrow(
      UNSUPPORTED_SOURCE_ERROR,
    );
    expect(vault.files.size).toBe(0);
    expect(vault.data.size).toBe(0);
  });
});

describe('loadQuizSourceContext', () => {
  it('uses only the slides in the range', async () => {
    const vault = new FakeVault();
    const { path } = await importQuizSource(vault, { name: 'cell-membranes.pptx', bytes: await sampleDeck() });

    const context = await loadQuizSourceContext(vault, path, '14, 21', 10_000);

    expect(slideMarkers(context)).toEqual([14, 21]);
  });

  it('uses the whole deck when the range is blank', async () => {
    const vault = new FakeVault();
    const { path } = await importQuizSource(vault, { name: 'cell-membranes.pptx', bytes: await sampleDeck() });

    const context = await loadQuizSourceContext(vault, path, '  ', 100_000);

    expect(slideMarkers(context)).toContain(1);
    expect(slideMarkers(context)).toContain(21);
  });

  it('stays within the character budget', async () => {
    const vault = new FakeVault();
    const { path } = await importQuizSource(vault, { name: 'cell-membranes.pptx', bytes: await sampleDeck() });

    const context = await loadQuizSourceContext(vault, path, '', 2_000);

    expect(context.length).toBeLessThanOrEqual(2_000);
  });

  it('rejects a range past the last slide', async () => {
    const vault = new FakeVault();
    const { path } = await importQuizSource(vault, { name: 'cell-membranes.pptx', bytes: await sampleDeck() });

    await expect(loadQuizSourceContext(vault, path, '20-30', 10_000)).rejects.toThrow(
      'Slide 30 is past the end of the deck (24 slides).',
    );
  });

  it('still works after the original deck is removed', async () => {
    const vault = new FakeVault();
    const { path } = await importQuizSource(vault, { name: 'cell-membranes.pptx', bytes: await sampleDeck() });
    const before = await loadQuizSourceContext(vault, path, '', 10_000);

    vault.files.delete(path);
    const after = await loadQuizSourceContext(vault, path, '', 10_000);

    expect(after).toBe(before);
  });

  it('reads a deck that was added to the vault directly, and caches it', async () => {
    const vault = new FakeVault();
    vault.files.set('Lectures/cell-membranes.pptx', await sampleDeck());

    const context = await loadQuizSourceContext(vault, 'Lectures/cell-membranes.pptx', '5', 10_000);
    vault.files.delete('Lectures/cell-membranes.pptx');
    const cached = await loadQuizSourceContext(vault, 'Lectures/cell-membranes.pptx', '5', 10_000);

    expect(slideMarkers(context)).toEqual([5]);
    expect(cached).toBe(context);
  });

  it('explains when the deck is gone and nothing was cached', async () => {
    const vault = new FakeVault();

    await expect(loadQuizSourceContext(vault, 'Sources/missing.pptx', '', 10_000)).rejects.toThrow(
      SOURCE_MISSING_ERROR,
    );
  });
});
