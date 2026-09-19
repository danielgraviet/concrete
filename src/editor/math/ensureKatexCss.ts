/** Lazily load KaTeX CSS once (fonts + stylesheet are ~0.8MB+). */
let katexCssPromise: Promise<void> | null = null;

export function ensureKatexCss(): Promise<void> {
  if (!katexCssPromise) {
    katexCssPromise = import('katex/dist/katex.min.css').then(() => undefined);
  }
  return katexCssPromise;
}
