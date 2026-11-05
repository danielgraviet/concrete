/**
 * One-time move of app-written `## Flashcards` sections out of notes and into
 * `.vault/cards.json`.
 *
 * Those sections were written as `Front :: Back` with the whole back pasted
 * after `::`, but note parsing only reads the rest of that one line, so answers
 * with blank lines, math blocks or lists were cut short. Here a card's back runs
 * until the next card starts, so the whole answer comes back.
 */
import { cardFingerprint } from './cardId';
import { draftsFromLinkedCards, draftsFromNote, withIds } from './buildCards';
import { cleanLinkedInput, linkedInputProblem, type LinkedCard, type LinkedCardInput } from './LinkedCards';
import {
  classifyLines,
  frontmatterEnd,
  maskInline,
  MCQ_OPTION_RE,
  MCQ_SEP_RE,
  MULTILINE_SEP_RE,
  parseClozeBlanks,
  splitOn,
  stripLinePrefix,
  type Line,
  type ParsedMcqOption,
} from './parseNoteCards';
import type { ReviewCard } from './types';

const SECTION_RE = /^\s{0,3}##\s+Flashcards\s*$/i;
const SECTION_END_RE = /^\s{0,3}#{1,2}\s+/;

export type SectionCard = { input: LinkedCardInput; start: number; end: number };

export type FlashcardSection = {
  /** Line of the `## Flashcards` heading and the line after the section. */
  heading: number;
  end: number;
  cards: SectionCard[];
  /** The note with the section removed (text that wasn't a card stays). */
  markdown: string;
};

type Para = { start: number; end: number };

type Kind =
  | { type: 'mcq' }
  | { type: 'inline'; line: number; front: string; back: string; reverse: boolean }
  | { type: 'block'; line: number; reverse: boolean }
  | { type: 'cloze' }
  | { type: 'text' };

function paragraphKind(raw: string[], lines: Line[], para: Para): Kind {
  if (!lines[para.start].code && MCQ_SEP_RE.test(raw[para.start])) return { type: 'mcq' };
  for (let k = para.start; k < para.end; k += 1) {
    if (lines[k].code) continue;
    const text = raw[k];
    if (k > para.start && MULTILINE_SEP_RE.test(text)) {
      return { type: 'block', line: k, reverse: text.trim() === '??' };
    }
    const masked = maskInline(text);
    const reversed = splitOn(text, masked, ':::');
    const pair = reversed ?? splitOn(text, masked, '::');
    if (pair) {
      const before = raw.slice(para.start, k);
      const front = [...before, pair[0]].map((l, i) => (i === 0 ? stripLinePrefix(l) : l)).join('\n').trim();
      if (front && pair[1].trim()) return { type: 'inline', line: k, front, back: pair[1], reverse: Boolean(reversed) };
    }
  }
  const prose = raw.slice(para.start, para.end).filter((_, i) => !lines[para.start + i].code).join('\n');
  return parseClozeBlanks(prose).length ? { type: 'cloze' } : { type: 'text' };
}

const join = (raw: string[], from: number, to: number) => raw.slice(from, to).join('\n').trim();

/** Find the first app-written `## Flashcards` section and split it into cards. */
export function extractFlashcardSection(markdown: string): FlashcardSection | null {
  const newline = markdown.includes('\r\n') ? '\r\n' : '\n';
  const raw = markdown.replace(/\r\n?/g, '\n').split('\n');
  const lines = classifyLines(raw, frontmatterEnd(raw));
  const heading = lines.findIndex((line, i) => !line.code && SECTION_RE.test(raw[i]));
  if (heading < 0) return null;
  let end = heading + 1;
  while (end < raw.length && (lines[end].code || !SECTION_END_RE.test(raw[end]))) end += 1;

  const paras: Para[] = [];
  for (let i = heading + 1; i < end; ) {
    if (!lines[i].code && !raw[i].trim()) {
      i += 1;
      continue;
    }
    let j = i;
    while (j < end && (lines[j].code || raw[j].trim())) j += 1;
    paras.push({ start: i, end: j });
    i = j;
  }

  const cards: SectionCard[] = [];
  const leftover: Para[] = [];
  const kinds = paras.map((para) => paragraphKind(raw, lines, para));
  const startsCard = (index: number) => kinds[index].type !== 'text';

  for (let p = 0; p < paras.length; ) {
    const para = paras[p];
    const kind = kinds[p];

    if (kind.type === 'mcq') {
      // Prompt runs (across blank lines and math) up to the first option line.
      let i = para.start + 1;
      while (i < end && (lines[i].code || !MCQ_OPTION_RE.test(raw[i]))) {
        if (!lines[i].code && (MCQ_SEP_RE.test(raw[i]) || SECTION_END_RE.test(raw[i]))) break;
        i += 1;
      }
      const optionsStart = i;
      const options: ParsedMcqOption[] = [];
      while (i < end && !lines[i].code) {
        const match = MCQ_OPTION_RE.exec(raw[i]);
        if (!match) break;
        options.push({ text: match[2].trim(), correct: match[1].toLowerCase() === 'x' });
        i += 1;
      }
      const input: LinkedCardInput = { kind: 'mcq', prompt: join(raw, para.start + 1, optionsStart), options };
      if (options.length && !linkedInputProblem(cleanLinkedInput(input))) {
        cards.push({ input, start: para.start, end: i });
      } else {
        // Not a usable question: keep its text in the note.
        leftover.push({ start: para.start, end: Math.max(i, para.end) });
      }
      p += 1;
      while (p < paras.length && paras[p].start < i) {
        // Paragraphs swallowed by the prompt/options; keep any tail after the options.
        if (paras[p].end > i) leftover.push({ start: i, end: paras[p].end });
        p += 1;
      }
      continue;
    }

    if (kind.type === 'text') {
      leftover.push(para);
      p += 1;
      continue;
    }

    // Basic and cloze cards keep every following plain paragraph, up to the next card.
    let q = p + 1;
    while (q < paras.length && !startsCard(q)) q += 1;
    const stop = paras[q - 1].end;

    let input: LinkedCardInput;
    if (kind.type === 'inline') {
      const back = [kind.back, ...raw.slice(kind.line + 1, stop)].join('\n').trim();
      input = { kind: 'basic', front: kind.front, back, ...(kind.reverse ? { reverse: true } : {}) };
    } else if (kind.type === 'block') {
      const front = raw.slice(para.start, kind.line).map((l, i) => (i === 0 ? stripLinePrefix(l) : l)).join('\n').trim();
      input = { kind: 'basic', front, back: join(raw, kind.line + 1, stop), ...(kind.reverse ? { reverse: true } : {}) };
    } else {
      input = { kind: 'cloze', text: [stripLinePrefix(raw[para.start]), ...raw.slice(para.start + 1, stop)].join('\n').trim() };
    }
    if (linkedInputProblem(cleanLinkedInput(input))) {
      for (let k = p; k < q; k += 1) leftover.push(paras[k]);
    } else {
      cards.push({ input, start: para.start, end: stop });
    }
    p = q;
  }

  if (cards.length === 0) return null;

  const head = raw.slice(0, heading);
  while (head.length && !head[head.length - 1].trim()) head.pop();
  const kept = leftover.map((para) => raw.slice(para.start, para.end).join('\n'));
  const tail = raw.slice(end);
  while (tail.length && !tail[tail.length - 1].trim()) tail.pop();
  const parts = [head.join('\n'), ...kept, ...(tail.length ? [tail.join('\n')] : [])].filter((part) => part.trim());
  const body = parts.join('\n\n');
  const ending = /\n\s*$/.test(markdown) && body ? '\n' : '';
  return { heading, end, cards, markdown: `${body}${ending}`.replace(/\n/g, newline) };
}

export type NotePlan = {
  path: string;
  markdown: string;
  inputs: LinkedCardInput[];
  /** The note's cards now, and what they will be once migrated (in index order). */
  before: ReviewCard[];
  after: ReviewCard[];
  /** Index into `before` → index into `after`: the same card. */
  pairs: Array<[number, number]>;
  /** Cards in `before` with no counterpart (only allowed when they have no history). */
  unpaired: ReviewCard[];
  /** Cards outside the section that wouldn't come back unchanged. */
  problem: string | null;
};

/** Pending uid for the i-th migrated card, before the store assigns a real one. */
export const pendingUid = (i: number) => `pending-${i}`;

/**
 * Work out a note's migration: new note text, the cards to store, and which
 * existing card each new card continues (so its review history moves with it).
 */
export function planNoteMigration(path: string, markdown: string, linked: LinkedCard[]): NotePlan | null {
  const section = extractFlashcardSection(markdown);
  if (!section) return null;
  const mine = linked.filter((card) => card.path === path);
  const noteBefore = draftsFromNote(path, markdown);
  const noteAfter = draftsFromNote(path, section.markdown);
  const linkedDrafts = draftsFromLinkedCards(mine);
  const inputs = section.cards.map((card) => cleanLinkedInput(card.input));
  const pending = inputs.map((input, i) => ({ ...input, uid: pendingUid(i), path, created: 0 }) as LinkedCard);
  const before = withIds([...noteBefore, ...linkedDrafts]);
  const after = withIds([...noteAfter, ...linkedDrafts, ...draftsFromLinkedCards(pending)]);

  const pairs: Array<[number, number]> = [];
  const unpaired: ReviewCard[] = [];
  let problem: string | null = null;

  // Cards outside the section, then cards already linked: unchanged, same order.
  const inSection = (card: ReviewCard) => card.source.line > section.heading && card.source.line < section.end;
  const outsideBefore = before.map((card, i) => [card, i] as const).filter(([card], i) => i < noteBefore.length && !inSection(card));
  if (outsideBefore.length !== noteAfter.length) problem = 'cards outside the Flashcards section would change';
  outsideBefore.forEach(([card, i], k) => {
    if (k >= noteAfter.length || cardFingerprint(card) !== cardFingerprint(after[k])) {
      problem = 'cards outside the Flashcards section would change';
      return;
    }
    pairs.push([i, k]);
  });
  linkedDrafts.forEach((_, k) => pairs.push([noteBefore.length + k, noteAfter.length + k]));

  // Section cards: each old card pairs with a new card built from the block it sat in.
  const used = new Set<number>();
  before.forEach((card, i) => {
    if (i >= noteBefore.length || !inSection(card)) return;
    const block = section.cards.findIndex((c) => card.source.line >= c.start && card.source.line < c.end);
    const candidates = after
      .map((next, k) => [next, k] as const)
      .filter(([next, k]) => !used.has(k) && next.source.uid === pendingUid(block) && next.kind === card.kind);
    const match =
      (card.kind === 'cloze' ? candidates.find(([next]) => next.kind === 'cloze' && next.group === card.group) : undefined) ??
      candidates[0];
    if (block < 0 || !match) {
      unpaired.push(card);
      return;
    }
    used.add(match[1]);
    pairs.push([i, match[1]]);
  });

  return { path, markdown: section.markdown, inputs, before, after, pairs, unpaired, problem };
}
