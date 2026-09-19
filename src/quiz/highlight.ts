import { LanguageDescription } from '@codemirror/language';

/**
 * Quiz / preview highlighting languages only — avoids bundling the full
 * `@codemirror/language-data` pack (~143 languages).
 */
const QUIZ_LANGUAGES: LanguageDescription[] = [
  LanguageDescription.of({
    name: 'JavaScript',
    alias: ['js', 'javascript', 'jsx', 'mjs', 'cjs'],
    extensions: ['js', 'mjs', 'cjs'],
    load() {
      return import('@codemirror/lang-javascript').then((m) => m.javascript());
    },
  }),
  LanguageDescription.of({
    name: 'TypeScript',
    alias: ['ts', 'typescript', 'tsx'],
    extensions: ['ts', 'tsx'],
    load() {
      return import('@codemirror/lang-javascript').then((m) =>
        m.javascript({ typescript: true }),
      );
    },
  }),
  LanguageDescription.of({
    name: 'Python',
    alias: ['py', 'python'],
    extensions: ['py'],
    load() {
      return import('@codemirror/lang-python').then((m) => m.python());
    },
  }),
  LanguageDescription.of({
    name: 'JSON',
    alias: ['json'],
    extensions: ['json'],
    load() {
      return import('@codemirror/lang-json').then((m) => m.json());
    },
  }),
  LanguageDescription.of({
    name: 'Markdown',
    alias: ['md', 'markdown'],
    extensions: ['md'],
    load() {
      return import('@codemirror/lang-markdown').then((m) => m.markdown());
    },
  }),
  LanguageDescription.of({
    name: 'HTML',
    alias: ['html', 'htm'],
    extensions: ['html', 'htm'],
    load() {
      return import('@codemirror/lang-html').then((m) => m.html());
    },
  }),
  LanguageDescription.of({
    name: 'CSS',
    alias: ['css'],
    extensions: ['css'],
    load() {
      return import('@codemirror/lang-css').then((m) => m.css());
    },
  }),
  LanguageDescription.of({
    name: 'SQL',
    alias: ['sql'],
    extensions: ['sql'],
    load() {
      return import('@codemirror/lang-sql').then((m) => m.sql());
    },
  }),
  LanguageDescription.of({
    name: 'Java',
    alias: ['java'],
    extensions: ['java'],
    load() {
      return import('@codemirror/lang-java').then((m) => m.java());
    },
  }),
  LanguageDescription.of({
    name: 'C++',
    alias: ['cpp', 'c++', 'cxx'],
    extensions: ['cpp', 'cc', 'cxx', 'hpp'],
    load() {
      return import('@codemirror/lang-cpp').then((m) => m.cpp());
    },
  }),
  LanguageDescription.of({
    name: 'Go',
    alias: ['go', 'golang'],
    extensions: ['go'],
    load() {
      return import('@codemirror/lang-go').then((m) => m.go());
    },
  }),
  LanguageDescription.of({
    name: 'Rust',
    alias: ['rs', 'rust'],
    extensions: ['rs'],
    load() {
      return import('@codemirror/lang-rust').then((m) => m.rust());
    },
  }),
  LanguageDescription.of({
    name: 'YAML',
    alias: ['yaml', 'yml'],
    extensions: ['yaml', 'yml'],
    load() {
      return import('@codemirror/lang-yaml').then((m) => m.yaml());
    },
  }),
];

export type HighlightSpan = { text: string; className: string };

/**
 * Tokenize code with CodeMirror grammars used by the editor. Returns
 * spans carrying `tok-*` classes, or null when the language is unknown.
 */
export async function highlightCode(
  code: string,
  language: string,
): Promise<HighlightSpan[] | null> {
  const description = LanguageDescription.matchLanguageName(
    QUIZ_LANGUAGES,
    language,
    true,
  );
  if (!description) return null;
  const support = await description.load();
  const tree = support.language.parser.parse(code);

  const spans: HighlightSpan[] = [];
  let position = 0;
  const { classHighlighter, highlightTree } = await import('@lezer/highlight');
  highlightTree(tree, classHighlighter, (from, to, classes) => {
    if (from > position) spans.push({ text: code.slice(position, from), className: '' });
    spans.push({ text: code.slice(from, to), className: classes });
    position = to;
  });
  if (position < code.length) spans.push({ text: code.slice(position), className: '' });
  return spans;
}
