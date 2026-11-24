/**
 * Turn a PowerPoint (.pptx) deck into compact quiz-generation context.
 *
 * A .pptx is a zip of XML parts. Only the XML is inflated (media under
 * `ppt/media/` is skipped), so even decks with hundreds of MB of images parse
 * in a few MB of memory. Pure functions with no DOM, so they run the same in
 * Electron, the browser and tests.
 */
import { strFromU8, unzipSync } from 'fflate';

export const NOT_PPTX_ERROR =
  'This file is not a PowerPoint (.pptx) deck. Save it as .pptx (not the older .ppt) or export it to PDF.';

export const NO_SLIDE_TEXT_ERROR =
  'The selected slides have no text, so a quiz cannot be made from them.';

export type PptxSlide = {
  /** 1-based position in the presentation. */
  number: number;
  title: string;
  lines: string[];
  notes: string;
  imageCount: number;
};

export type PptxDeck = { slides: PptxSlide[] };

/** Placeholders that hold slide chrome, not content. */
const CHROME_PLACEHOLDERS = new Set(['ftr', 'sldNum', 'dt', 'hdr', 'sldImg']);
const TITLE_PLACEHOLDERS = new Set(['title', 'ctrTitle']);
/** A line on at least this share of slides is a running footer or banner. */
const REPEAT_SHARE = 0.6;
/** Below this, a slide excerpt is too short to ask good questions about. */
const MIN_EXCERPT_CHARS = 400;
const SLIDE_SEPARATOR = '\n\n';

type Parts = Record<string, string>;

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (whole, code: string) => {
    switch (code.toLowerCase()) {
      case 'amp': return '&';
      case 'lt': return '<';
      case 'gt': return '>';
      case 'quot': return '"';
      case 'apos': return "'";
      default: {
        const value = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
        return Number.isFinite(value) ? String.fromCodePoint(value) : whole;
      }
    }
  });
}

function collapse(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** Every `<tag ...>...</tag>` (or self-closing) element; `tag` must not nest within itself. */
function elements(xml: string, tag: string): string[] {
  const pattern = new RegExp(`<${tag}(?=[\\s/>])[^>]*?(?:/>|>[\\s\\S]*?</${tag}>)`, 'g');
  return xml.match(pattern) ?? [];
}

function attribute(element: string, name: string): string | undefined {
  const match = new RegExp(`\\s${name}="([^"]*)"`).exec(element.slice(0, element.indexOf('>') + 1));
  return match ? decodeEntities(match[1]) : undefined;
}

/** Text of each `<a:p>` paragraph: runs joined, line breaks and tabs as spaces. */
function paragraphs(xml: string): string[] {
  return elements(xml, 'a:p')
    .map((para) =>
      collapse(
        decodeEntities(
          para
            // Breaks and tabs may be self-closing or wrap their own run properties.
            .replace(/<a:(br|tab)\b[^>]*?(?:\/>|>[\s\S]*?<\/a:\1>)/g, '<a:t> </a:t>')
            .match(/<a:t(?:\s[^>]*)?>[^<]*<\/a:t>/g)
            ?.map((run) => run.replace(/<[^>]+>/g, ''))
            .join('') ?? '',
        ),
      ),
    )
    .filter(Boolean);
}

function placeholderType(shape: string): string | undefined {
  const ph = /<p:ph\b[^>]*>/.exec(shape);
  if (!ph) return undefined;
  return attribute(ph[0], 'type') ?? 'body';
}

/** Resolve a relationship target ("../notesSlides/x.xml") against the part's folder. */
function resolveTarget(fromFolder: string, target: string): string {
  if (target.startsWith('/')) return target.slice(1);
  const parts = fromFolder.split('/').filter(Boolean);
  for (const segment of target.split('/')) {
    if (segment === '..') parts.pop();
    else if (segment !== '.') parts.push(segment);
  }
  return parts.join('/');
}

/** Relationships of a part, as id → { type, target path }. */
function relationships(parts: Parts, partPath: string): Map<string, { type: string; path: string }> {
  const folder = partPath.slice(0, partPath.lastIndexOf('/'));
  const file = partPath.slice(partPath.lastIndexOf('/') + 1);
  const xml = parts[`${folder}/_rels/${file}.rels`] ?? '';
  const rels = new Map<string, { type: string; path: string }>();
  for (const rel of elements(xml, 'Relationship')) {
    const id = attribute(rel, 'Id');
    const target = attribute(rel, 'Target');
    if (!id || !target || attribute(rel, 'TargetMode') === 'External') continue;
    rels.set(id, { type: attribute(rel, 'Type') ?? '', path: resolveTarget(folder, target) });
  }
  return rels;
}

function tableRows(xml: string): string[] {
  return elements(xml, 'a:tr')
    .map((row) =>
      elements(row, 'a:tc')
        .map((cell) => paragraphs(cell).join(' '))
        .filter(Boolean)
        .join(' | '),
    )
    .filter(Boolean);
}

function readSlide(xml: string): { title: string; lines: string[]; imageCount: number } {
  const titles: string[] = [];
  const lines: string[] = [];
  for (const shape of elements(xml, 'p:sp')) {
    const type = placeholderType(shape);
    if (type && CHROME_PLACEHOLDERS.has(type)) continue;
    const text = paragraphs(shape);
    if (type && TITLE_PLACEHOLDERS.has(type)) titles.push(...text);
    else lines.push(...text);
  }
  for (const frame of elements(xml, 'p:graphicFrame')) lines.push(...tableRows(frame));
  return {
    title: collapse(titles.join(' ')),
    lines,
    imageCount: elements(xml, 'p:pic').length,
  };
}

function readNotes(xml: string | undefined): string {
  if (!xml) return '';
  return collapse(
    elements(xml, 'p:sp')
      .filter((shape) => placeholderType(shape) === 'body')
      .flatMap(paragraphs)
      .join(' '),
  );
}

/** Drop lines (e.g. a typed-in footer) that repeat on most slides. */
function dropRepeatedLines(slides: PptxSlide[]): PptxSlide[] {
  if (slides.length < 3) return slides;
  const counts = new Map<string, number>();
  for (const slide of slides) {
    for (const line of new Set(slide.lines)) counts.set(line, (counts.get(line) ?? 0) + 1);
  }
  const repeated = new Set([...counts].filter(([, n]) => n / slides.length >= REPEAT_SHARE).map(([line]) => line));
  if (!repeated.size) return slides;
  return slides.map((slide) => ({ ...slide, lines: slide.lines.filter((line) => !repeated.has(line)) }));
}

function unzipXml(bytes: Uint8Array): Parts {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes, { filter: (file) => /\.(xml|rels)$/i.test(file.name) });
  } catch {
    throw new Error(NOT_PPTX_ERROR);
  }
  const parts: Parts = {};
  for (const [name, data] of Object.entries(files)) parts[name] = strFromU8(data);
  return parts;
}

/** Slides in presentation order with their title, body lines, speaker notes and picture count. */
export async function parsePptx(bytes: Uint8Array): Promise<PptxDeck> {
  const parts = unzipXml(bytes);
  const presentation = parts['ppt/presentation.xml'];
  if (!presentation) throw new Error(NOT_PPTX_ERROR);

  const presentationRels = relationships(parts, 'ppt/presentation.xml');
  const slidePaths = elements(presentation, 'p:sldId')
    .map((id) => presentationRels.get(attribute(id, 'r:id') ?? '')?.path)
    .filter((path): path is string => Boolean(path && parts[path]));

  const slides = slidePaths.map((path, i): PptxSlide => {
    const notesPath = [...relationships(parts, path).values()].find((rel) => rel.type.endsWith('/notesSlide'))?.path;
    return { number: i + 1, ...readSlide(parts[path]), notes: readNotes(notesPath ? parts[notesPath] : undefined) };
  });
  return { slides: dropRepeatedLines(slides) };
}

function renderSlide(slide: PptxSlide): string {
  const marker = slide.title ? `[slide ${slide.number}] ${slide.title}` : `[slide ${slide.number}]`;
  return [marker, ...slide.lines, ...(slide.notes ? [`Notes: ${slide.notes}`] : [])].join('\n');
}

function truncate(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const cut = text.slice(0, Math.max(0, limit - 1));
  const space = cut.lastIndexOf(' ');
  return `${space > limit * 0.8 ? cut.slice(0, space) : cut}…`;
}

/**
 * Fit the selected slides into `budgetChars`. Slides without text are left
 * out. When the text is too long, keep slides evenly spread from the first to
 * the last of the selection so the quiz covers the whole deck. Each slide is
 * marked `[slide N] Title`.
 */
export function buildPptxContext(slides: PptxSlide[], slideNumbers: number[], budgetChars: number): string {
  const wanted = new Set(slideNumbers);
  const chosen = slides
    .filter((slide) => wanted.has(slide.number))
    .filter((slide) => slide.title || slide.lines.length || slide.notes)
    .sort((a, b) => a.number - b.number);
  const rendered = chosen.map(renderSlide);
  const textLength = chosen.reduce(
    (sum, slide) => sum + slide.title.length + slide.notes.length + slide.lines.join('').length,
    0,
  );
  if (textLength < 20) throw new Error(NO_SLIDE_TEXT_ERROR);

  const full = rendered.join(SLIDE_SEPARATOR);
  if (full.length <= budgetChars) return full;

  const fit = Math.max(1, Math.min(rendered.length, Math.floor(budgetChars / MIN_EXCERPT_CHARS)));
  const picks =
    fit === 1
      ? [0]
      : [...new Set(Array.from({ length: fit }, (_, i) => Math.round((i * (rendered.length - 1)) / (fit - 1))))];
  const perSlide = Math.floor((budgetChars - SLIDE_SEPARATOR.length * (picks.length - 1)) / picks.length);
  return picks.map((i) => truncate(rendered[i], Math.max(1, perSlide))).join(SLIDE_SEPARATOR);
}
