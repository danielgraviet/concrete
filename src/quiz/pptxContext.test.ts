import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import {
  buildPptxContext,
  NO_SLIDE_TEXT_ERROR,
  NOT_PPTX_ERROR,
  parsePptx,
  type PptxSlide,
} from './pptxContext';

/**
 * State-based tests: each one feeds a deck in and checks what comes out.
 * Nothing is mocked; the real sample deck covers messy real-world input and a
 * tiny generated deck covers cases the sample lacks (notes, odd slide order).
 */

const SAMPLE_DECK = new URL('./__fixtures__/cell-membranes.pptx', import.meta.url);
const SAMPLE_FOOTER = 'AS Biology. Foundation. Cell membranes and Transport';

// The app's tsconfig has no Node types (it targets the browser), so load fs
// dynamically behind a minimal type, as boundary.test.ts does.
interface NodeFs {
  readFileSync(file: URL): Uint8Array;
}

const nodeModule = (name: string): Promise<unknown> => import(/* @vite-ignore */ name);

async function readBytes(file: URL): Promise<Uint8Array> {
  const fs = (await nodeModule('node:fs')) as NodeFs;
  return new Uint8Array(fs.readFileSync(file));
}

let sampleDeck: ReturnType<typeof parsePptx> | undefined;

/** The parsed sample deck, read once and shared by the tests that need it. */
async function sampleSlides(): Promise<PptxSlide[]> {
  sampleDeck ??= readBytes(SAMPLE_DECK).then(parsePptx);
  return (await sampleDeck).slides;
}

function slide(slides: PptxSlide[], number: number): PptxSlide {
  const found = slides.find((s) => s.number === number);
  if (!found) throw new Error(`No slide ${number}`);
  return found;
}

function slideMarkers(context: string): number[] {
  return [...context.matchAll(/^\[slide (\d+)\]/gm)].map((match) => Number(match[1]));
}

type FakeSlide = { file: number; title: string; body: string[]; notes?: string };

const P = 'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
const A = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"';
const R = 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const RELS = 'xmlns="http://schemas.openxmlformats.org/package/2006/relationships"';
const REL_TYPE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

function shape(placeholder: string, paragraphs: string[]): string {
  const paras = paragraphs.map((text) => `<a:p><a:r><a:t>${text}</a:t></a:r></a:p>`).join('');
  return `<p:sp><p:nvSpPr><p:cNvPr id="1" name="s"/><p:cNvSpPr/><p:nvPr>${placeholder}</p:nvPr></p:nvSpPr><p:txBody>${paras}</p:txBody></p:sp>`;
}

/** Build a minimal .pptx whose slides appear in the given order. */
function makePptx(slides: FakeSlide[]): Uint8Array {
  const files: Record<string, Uint8Array> = {};
  const ids = slides
    .map((s, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 1}"/>`)
    .join('');
  files['ppt/presentation.xml'] = strToU8(
    `<?xml version="1.0"?><p:presentation ${P} ${R}><p:sldIdLst>${ids}</p:sldIdLst></p:presentation>`,
  );
  const presRels = slides
    .map((s, i) => `<Relationship Id="rId${i + 1}" Type="${REL_TYPE}/slide" Target="slides/slide${s.file}.xml"/>`)
    .join('');
  files['ppt/_rels/presentation.xml.rels'] = strToU8(`<?xml version="1.0"?><Relationships ${RELS}>${presRels}</Relationships>`);

  for (const s of slides) {
    files[`ppt/slides/slide${s.file}.xml`] = strToU8(
      `<?xml version="1.0"?><p:sld ${P} ${A} ${R}><p:cSld><p:spTree>` +
        shape('<p:ph type="title"/>', [s.title]) +
        shape('<p:ph type="body" idx="1"/>', s.body) +
        `</p:spTree></p:cSld></p:sld>`,
    );
    if (s.notes !== undefined) {
      files[`ppt/slides/_rels/slide${s.file}.xml.rels`] = strToU8(
        `<?xml version="1.0"?><Relationships ${RELS}><Relationship Id="rId1" Type="${REL_TYPE}/notesSlide" Target="../notesSlides/notesSlide${s.file}.xml"/></Relationships>`,
      );
      files[`ppt/notesSlides/notesSlide${s.file}.xml`] = strToU8(
        `<?xml version="1.0"?><p:notes ${P} ${A} ${R}><p:cSld><p:spTree>` +
          shape('<p:ph type="sldImg"/>', []) +
          shape('<p:ph type="body" idx="1"/>', [s.notes]) +
          shape('<p:ph type="sldNum" idx="5"/>', [String(s.file)]) +
          `</p:spTree></p:cSld></p:notes>`,
      );
    }
  }
  return zipSync(files);
}

describe('parsePptx on the sample deck', () => {
  it('reads every slide, numbered in presentation order', async () => {
    const slides = await sampleSlides();
    expect(slides.map((s) => s.number)).toEqual(Array.from({ length: 24 }, (_, i) => i + 1));
  });

  it('takes each slide title from its title placeholder', async () => {
    const slides = await sampleSlides();
    expect(slide(slides, 5).title).toBe('Cell membrane');
    expect(slide(slides, 14).title).toBe('Fluid mosaic model');
  });

  it('keeps body paragraphs as lines, without repeating the title', async () => {
    const slides = await sampleSlides();
    const summary = slide(slides, 21);
    expect(summary.lines).toContain('The average thickness of the membrane is 7nm.');
    expect(summary.lines).not.toContain('Summary');
  });

  it('drops footers and slide numbers from every slide', async () => {
    const slides = await sampleSlides();
    for (const s of slides) {
      expect(s.lines).not.toContain(SAMPLE_FOOTER);
      expect(s.lines).not.toContain(String(s.number));
    }
  });

  it('collapses tabs and runs of spaces inside a line', async () => {
    const slides = await sampleSlides();
    expect(slide(slides, 4).lines).toContain('Phospholipids Solution Pinocytosis');
    expect(slides.flatMap((s) => s.lines).some((line) => /\t| {2}/.test(line))).toBe(false);
  });

  it('treats speaker notes that only hold the slide number as empty', async () => {
    const slides = await sampleSlides();
    expect(slides.map((s) => s.notes)).toEqual(slides.map(() => ''));
  });

  it('counts pictures, including on slides with no text', async () => {
    const slides = await sampleSlides();
    expect(slide(slides, 11)).toMatchObject({ title: '', lines: [], imageCount: 1 });
    expect(slide(slides, 5).imageCount).toBe(0);
  });
});

describe('parsePptx on generated decks', () => {
  it('follows the presentation order, not the slide file names', async () => {
    const deck = makePptx([
      { file: 2, title: 'First shown', body: ['a'] },
      { file: 1, title: 'Second shown', body: ['b'] },
    ]);

    const { slides } = await parsePptx(deck);

    expect(slides.map((s) => [s.number, s.title])).toEqual([
      [1, 'First shown'],
      [2, 'Second shown'],
    ]);
  });

  it('reads speaker notes without the notes slide number', async () => {
    const deck = makePptx([
      { file: 1, title: 'Osmosis', body: ['Water moves'], notes: 'Water moves toward the lower water potential.' },
    ]);

    const { slides } = await parsePptx(deck);

    expect(slides[0].notes).toBe('Water moves toward the lower water potential.');
  });

  it('rejects bytes that are not a zip, such as a legacy .ppt', async () => {
    const legacyPpt = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 0, 0]);

    await expect(parsePptx(legacyPpt)).rejects.toThrow(NOT_PPTX_ERROR);
  });

  it('rejects a zip that is not a presentation', async () => {
    const notADeck = zipSync({ 'word/document.xml': strToU8('<w:document/>') });

    await expect(parsePptx(notADeck)).rejects.toThrow(NOT_PPTX_ERROR);
  });
});

describe('buildPptxContext', () => {
  const everySlide = Array.from({ length: 24 }, (_, i) => i + 1);

  it('marks each slide with its number and title, followed by its lines', async () => {
    const slides = await sampleSlides();
    const context = buildPptxContext(slides, [5], 10_000);

    expect(context).toBe(
      [
        '[slide 5] Cell membrane',
        'All living things are surrounded by a membrane.',
        'A cell membrane is also known as plasma membrane.',
        'Controls exchange of materials such as nutrients and waste between cells and their environment.',
        'Has other important functions for example to enable cells to receive hormones.',
        'To understand the function of anything in biology, you must study the structure first!',
      ].join('\n'),
    );
  });

  it('includes only the selected slides', async () => {
    const slides = await sampleSlides();
    const context = buildPptxContext(slides, [14, 21], 10_000);

    expect(slideMarkers(context)).toEqual([14, 21]);
  });

  it('leaves out slides that have no text', async () => {
    const slides = await sampleSlides();
    const context = buildPptxContext(slides, everySlide, 100_000);

    expect(slideMarkers(context)).not.toContain(11);
    expect(slideMarkers(context)).toContain(10);
  });

  it('adds speaker notes under the slide they belong to', async () => {
    const { slides: noted } = await parsePptx(
      makePptx([{ file: 1, title: 'Osmosis', body: ['Water moves'], notes: 'Toward lower water potential.' }]),
    );

    const context = buildPptxContext(noted, [1], 10_000);

    expect(context).toBe('[slide 1] Osmosis\nWater moves\nNotes: Toward lower water potential.');
  });

  it('fits the budget while still covering the start and end of the selection', async () => {
    const slides = await sampleSlides();
    const context = buildPptxContext(slides, everySlide, 1_500);
    const markers = slideMarkers(context);

    expect(context.length).toBeLessThanOrEqual(1_500);
    expect(Math.min(...markers)).toBeLessThanOrEqual(5);
    expect(Math.max(...markers)).toBeGreaterThanOrEqual(19);
  });

  it('refuses a selection with no text', async () => {
    const slides = await sampleSlides();
    expect(() => buildPptxContext(slides, [11], 10_000)).toThrow(NO_SLIDE_TEXT_ERROR);
  });
});
