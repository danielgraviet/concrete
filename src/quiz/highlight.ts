import { LanguageDescription } from '@codemirror/language';
import { languages } from '@codemirror/language-data';
import { classHighlighter, highlightTree } from '@lezer/highlight';

export type HighlightSpan = { text: string; className: string };

/**
 * Tokenize code with the same CodeMirror grammars the editor uses. Returns
 * spans carrying `tok-*` classes, or null when the language is unknown.
 */
export async function highlightCode(code: string, language: string): Promise<HighlightSpan[] | null> {
  const description = LanguageDescription.matchLanguageName(languages, language, true);
  if (!description) return null;
  const support = await description.load();
  const tree = support.language.parser.parse(code);

  const spans: HighlightSpan[] = [];
  let position = 0;
  highlightTree(tree, classHighlighter, (from, to, classes) => {
    if (from > position) spans.push({ text: code.slice(position, from), className: '' });
    spans.push({ text: code.slice(from, to), className: classes });
    position = to;
  });
  if (position < code.length) spans.push({ text: code.slice(position), className: '' });
  return spans;
}
