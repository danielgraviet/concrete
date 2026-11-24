/**
 * Quiz sources beyond notes and PDFs (PowerPoint now, Word next).
 *
 * Importing saves the original into `Sources/` (when it fits the storage
 * limit) and always caches the extracted slides under `.vault/`, so later
 * quizzes from the same deck never re-parse it, and still work if the
 * original was too large to keep or has been removed.
 */
import { parsePageRange } from './pdfContext';
import { buildPptxContext, NOT_PPTX_ERROR, parsePptx, type PptxSlide } from './pptxContext';

export const UNSUPPORTED_SOURCE_ERROR = 'Concrete can make quizzes from .pptx decks, PDFs and notes. This file type is not supported yet.';

export const NOT_PDF_ERROR = 'This file is not a readable PDF.';

export const PDF_TOO_LARGE_ERROR = 'This PDF is larger than the 20 MB upload limit.';

export const SOURCE_MISSING_ERROR = 'This source file is no longer in the vault. Add it again to make a quiz from it.';

/** Where imported source files are saved. */
export const SOURCES_FOLDER = 'Sources';

/** Vault storage the source pipeline needs. Desktop and web each provide one. */
export interface QuizSourceStore {
  exists(path: string): Promise<boolean>;
  saveFile(path: string, bytes: Uint8Array): Promise<void>;
  readFile(path: string): Promise<Uint8Array | null>;
  /** Small app data under `.vault/` (e.g. `.vault/source-ab12.json`). */
  readData(key: string): Promise<string | null>;
  writeData(key: string, text: string): Promise<void>;
}

export type ImportedSource = {
  /** Vault path of the source (the original may be absent; see `storedOriginal`). */
  path: string;
  kind: 'pptx' | 'pdf';
  /** Slides in a deck; null for PDFs (pages are counted when the quiz is made). */
  unitCount: number | null;
  storedOriginal: boolean;
};

type CachedSource = { version: 1; path: string; kind: 'pptx'; slides: PptxSlide[] };

const CACHE_VERSION = 1;

function extension(name: string): string {
  const base = name.split('/').pop() ?? name;
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : '';
}

/** True for files that go through this pipeline (decks), not notes or PDFs. */
export function isQuizSourceFile(name: string): boolean {
  return extension(name) === 'pptx';
}

/** Stable `.vault/` key for a source path (FNV-1a; data keys allow only [\w.-]). */
function cacheKey(path: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < path.length; i += 1) {
    hash ^= path.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `.vault/source-${(hash >>> 0).toString(16).padStart(8, '0')}.json`;
}

async function readCache(store: QuizSourceStore, path: string): Promise<PptxSlide[] | null> {
  const text = await store.readData(cacheKey(path));
  if (!text) return null;
  try {
    const cached = JSON.parse(text) as Partial<CachedSource>;
    // Different path means a hash collision; older versions are re-parsed.
    if (cached.version !== CACHE_VERSION || cached.path !== path || !Array.isArray(cached.slides)) return null;
    return cached.slides;
  } catch {
    return null;
  }
}

async function writeCache(store: QuizSourceStore, path: string, slides: PptxSlide[]): Promise<void> {
  const cached: CachedSource = { version: CACHE_VERSION, path, kind: 'pptx', slides };
  await store.writeData(cacheKey(path), JSON.stringify(cached));
}

/** First free `Sources/<name>`, then `Sources/<stem> 2.<ext>`, `… 3` and so on. */
async function freeSourcePath(store: QuizSourceStore, name: string): Promise<string> {
  const base = (name.split(/[/\\]/).pop() ?? name).trim() || 'Deck.pptx';
  const dot = base.lastIndexOf('.');
  const stem = dot > 0 ? base.slice(0, dot) : base;
  const ext = dot > 0 ? base.slice(dot) : '';
  for (let n = 1; ; n += 1) {
    const path = `${SOURCES_FOLDER}/${n === 1 ? base : `${stem} ${n}${ext}`}`;
    // A cached entry counts as taken too, so an over-limit import is not overwritten.
    if (!(await store.exists(path)) && !(await readCache(store, path))) return path;
  }
}

function looksLikePdf(bytes: Uint8Array): boolean {
  // The header may follow a little junk; readers accept it within the first 1 KB.
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 1024));
  return head.includes('%PDF-');
}

/** PDFs keep their original only (text is extracted when a quiz is made). */
async function importPdf(
  store: QuizSourceStore,
  file: { name: string; bytes: Uint8Array },
  options: { maxStoredBytes?: number },
): Promise<ImportedSource> {
  if (!looksLikePdf(file.bytes)) throw new Error(NOT_PDF_ERROR);
  if (options.maxStoredBytes !== undefined && file.bytes.length > options.maxStoredBytes) {
    throw new Error(PDF_TOO_LARGE_ERROR);
  }
  const path = await freeSourcePath(store, file.name);
  await store.saveFile(path, file.bytes);
  return { path, kind: 'pdf', unitCount: null, storedOriginal: true };
}

/**
 * Parse a picked file, save it under `Sources/` and cache its slides.
 * Nothing is stored if the file cannot be read.
 */
export async function importQuizSource(
  store: QuizSourceStore,
  file: { name: string; bytes: Uint8Array },
  options: { maxStoredBytes?: number } = {},
): Promise<ImportedSource> {
  const ext = extension(file.name);
  if (ext === 'ppt') throw new Error(NOT_PPTX_ERROR);
  if (ext === 'pdf') return importPdf(store, file, options);
  if (ext !== 'pptx') throw new Error(UNSUPPORTED_SOURCE_ERROR);

  const { slides } = await parsePptx(file.bytes);
  const path = await freeSourcePath(store, file.name);
  const storedOriginal = options.maxStoredBytes === undefined || file.bytes.length <= options.maxStoredBytes;
  if (storedOriginal) await store.saveFile(path, file.bytes);
  await writeCache(store, path, slides);
  return { path, kind: 'pptx', unitCount: slides.length, storedOriginal };
}

/** A source deck's slides: from the cache, else parsed from the original (and cached). */
export async function loadQuizSourceSlides(store: QuizSourceStore, path: string): Promise<PptxSlide[]> {
  const cached = await readCache(store, path);
  if (cached) return cached;
  const bytes = await store.readFile(path);
  if (!bytes) throw new Error(SOURCE_MISSING_ERROR);
  const { slides } = await parsePptx(bytes);
  await writeCache(store, path, slides);
  return slides;
}

/** Parse "3-10, 15" against the deck; blank means every slide. */
function slideNumbers(range: string, total: number): number[] {
  const numbers = parsePageRange(range);
  if (numbers.length === 0) return Array.from({ length: total }, (_, i) => i + 1);
  const last = numbers[numbers.length - 1];
  if (last > total) throw new Error(`Slide ${last} is past the end of the deck (${total} slides).`);
  return numbers;
}

/** Quiz context for a source deck: the slides in `range`, fitted to `budgetChars`. */
export async function loadQuizSourceContext(
  store: QuizSourceStore,
  path: string,
  range: string,
  budgetChars: number,
): Promise<string> {
  if (!isQuizSourceFile(path)) throw new Error(UNSUPPORTED_SOURCE_ERROR);
  const slides = await loadQuizSourceSlides(store, path);
  return buildPptxContext(slides, slideNumbers(range, slides.length), budgetChars);
}
