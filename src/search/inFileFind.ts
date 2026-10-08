/** Find text in the rendered editor without modifying its React-managed DOM. */
export function findTextRanges(root: HTMLElement, query: string): Range[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return [];

  const ranges: Range[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.textContent) return NodeFilter.FILTER_REJECT;
      if (node.parentElement?.closest('.find-bar, [aria-hidden="true"]')) {
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  while (walker.nextNode()) {
    const node = walker.currentNode;
    const text = node.textContent ?? '';
    const lower = text.toLocaleLowerCase();
    let from = 0;
    while (from < lower.length) {
      const index = lower.indexOf(needle, from);
      if (index < 0) break;
      const range = document.createRange();
      range.setStart(node, index);
      range.setEnd(node, index + needle.length);
      ranges.push(range);
      from = index + needle.length;
    }
  }
  return ranges;
}

type HighlightRegistry = {
  set(name: string, highlight: unknown): void;
  delete(name: string): void;
};

/** Apply named CSS highlights when the browser supports the CSS Highlight API. */
export function applyTextHighlights(all: Range[], active: Range | undefined): void {
  const css = (window as Window & { CSS?: { highlights?: HighlightRegistry } }).CSS;
  const HighlightConstructor = (window as Window & { Highlight?: new (...ranges: Range[]) => unknown }).Highlight;
  if (!css?.highlights || !HighlightConstructor) return;

  if (all.length) css.highlights.set('find-matches', new HighlightConstructor(...all));
  else css.highlights.delete('find-matches');
  if (active) css.highlights.set('find-active-match', new HighlightConstructor(active));
  else css.highlights.delete('find-active-match');
}

export function clearTextHighlights(): void {
  const highlights = (window as Window & { CSS?: { highlights?: HighlightRegistry } }).CSS?.highlights;
  highlights?.delete('find-matches');
  highlights?.delete('find-active-match');
}

/** Focus the editor at a match and scroll it into the visible editor area. */
export function revealTextRange(root: HTMLElement, range: Range): void {
  const container = range.startContainer;
  const parent = container instanceof Element ? container : container.parentElement;
  const editor = parent?.closest<HTMLElement>('[contenteditable="true"]')
    ?? root.querySelector<HTMLElement>('[contenteditable="true"]');
  editor?.focus({ preventScroll: true });

  const selection = window.getSelection();
  if (selection) {
    const caret = range.cloneRange();
    caret.collapse(true);
    selection.removeAllRanges();
    selection.addRange(caret);
  }

  const rect = range.getBoundingClientRect();
  const rootRect = root.getBoundingClientRect();
  if (rect.top < rootRect.top || rect.bottom > rootRect.bottom) {
    root.scrollBy({ top: rect.top - rootRect.top - root.clientHeight / 2, behavior: 'smooth' });
  }
}

const RENDER_SETTLE_FRAMES = 2;
const RENDER_TIMEOUT_FRAMES = 60;

/**
 * Resolve the ranges for `query` once the editor has rendered a newly
 * opened note. `isReady` gates on the note being loaded; a couple of extra
 * frames let the editor replace the previous note's DOM before we look.
 */
export function waitForTextRanges(
  getRoot: () => HTMLElement | null,
  query: string,
  isReady: () => boolean,
): Promise<Range[]> {
  return new Promise((resolve) => {
    let frames = 0;
    let readyFrames = 0;
    const tick = () => {
      frames += 1;
      if (isReady()) readyFrames += 1;
      const root = readyFrames > RENDER_SETTLE_FRAMES ? getRoot() : null;
      const ranges = root ? findTextRanges(root, query) : [];
      if (ranges.length || frames >= RENDER_TIMEOUT_FRAMES) resolve(ranges);
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}
