import {
  MDXEditor,
  headingsPlugin,
  listsPlugin,
  quotePlugin,
  thematicBreakPlugin,
  linkPlugin,
  codeBlockPlugin,
  codeMirrorPlugin,
  imagePlugin,
  tablePlugin,
  markdownShortcutPlugin,
  type MDXEditorMethods,
  type MDXEditorProps,
} from '@mdxeditor/editor';
import '@mdxeditor/editor/style.css';
import { acceptCompletion, completionStatus } from '@codemirror/autocomplete';
import { indentLess, indentMore } from '@codemirror/commands';
import { syntaxHighlighting } from '@codemirror/language';
import { Prec } from '@codemirror/state';
import { keymap } from '@codemirror/view';
import { classHighlighter } from '@lezer/highlight';
import {
  forwardRef,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  type ReactNode,
} from 'react';
import type { EditorCommandHandler } from './types';
import {
  buildImageMarkdownFromDataUrl,
  createImageHandlers,
  extractPastedImageDataUrl,
  type ImageEditingContext,
} from './images';
import { RUN_CODE_EVENT, runnableCodeBlockDescriptor } from './RunnableCodeBlock';
import { quoteExitPlugin } from './quote';
import { inlineCodeExitPlugin } from './inlineCode';
import { slashMenuPlugin } from './slash';
import {
  mathPlugin,
  normalizeMathMarkdown,
  normalizePastedMathMarkdown,
  preferOneLineDisplayMath,
} from './math';
import { arrowPlugin } from './arrow';
import { emDashPlugin } from './emDash/emDashPlugin';
import { cardShortcutsPlugin } from './cards/cardShortcutsPlugin';
import { tabIndentPlugin } from './tabIndent/tabIndentPlugin';

export type WysiwygEditorProps = {
  /** Stable id for the open document — remounts/syncs when it changes. */
  documentId?: string;
  /** Vault root, needed to save pasted/dropped/picked images beside the note. */
  vaultRoot?: string;
  /**
   * Bump when markdown was changed outside the editor (agent / disk reload)
   * so MDXEditor picks up the new source without remounting.
   */
  contentRevision?: number;
  markdown: string;
  onChange?: (markdown: string) => void;
  onBlur?: () => void;
  className?: string;
  readOnly?: boolean;
  /** Extra MDXEditor plugins appended after the defaults. */
  extraPlugins?: MDXEditorProps['plugins'];
  /** Override the full plugin list (defaults + extras ignored). */
  plugins?: MDXEditorProps['plugins'];
  /** Optional command bridge (palette / menus); not required for MVP. */
  onCommand?: EditorCommandHandler;
  placeholder?: string;
  children?: ReactNode;
};

export type WysiwygEditorHandle = {
  focus: () => void;
  getMarkdown: () => string;
  setMarkdown: (markdown: string) => void;
  /**
   * Insert markdown at the last caret position (restored on focus), or at the
   * end of the note when the editor was never focused. Leaves the caret after it.
   */
  insertMarkdown: (markdown: string) => void;
  /** Markdown of the current selection, or '' when nothing is selected. */
  getSelectionMarkdown: () => string;
};

type ImagePluginHandlers = {
  imageUploadHandler?: (file: File) => Promise<string>;
  imagePreviewHandler?: (src: string) => Promise<string>;
};

/** Detect ordered-list items in plain text copied from chat and document apps. */
function containsOrderedList(text: string): boolean {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  let itemCount = 0;
  let previousWasItem = false;
  for (const line of lines) {
    if (/^\s{0,3}\d+[.)]\s+\S/.test(line)) {
      itemCount += 1;
      previousWasItem = true;
    } else if (line.trim() === '' && previousWasItem) {
      // Chat apps often separate each list item with a blank line.
      continue;
    } else {
      previousWasItem = false;
    }
  }
  return itemCount >= 2;
}

/** Retain a copied heading or bold title when the ordered-list path uses plain text. */
function preservePastedTitleFormatting(text: string, html: string): string {
  if (!html || typeof DOMParser === 'undefined') return text;
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const title = [...doc.body.querySelectorAll('h1, h2, h3, h4, h5, h6, p')].find((element) =>
    /^H[1-6]$/.test(element.tagName) ||
    (element.tagName === 'P' && element.querySelector('strong, b')),
  );
  if (!title) return text;
  const titleText = title.textContent?.trim();
  if (!titleText) return text;
  const lines = text.split(/\r?\n/);
  const titleLine = lines.findIndex((line) => line.trim() === titleText);
  if (titleLine < 0) return text;
  const headingMatch = /^H([1-6])$/.exec(title.tagName);
  const formatted = headingMatch
    ? `${'#'.repeat(Number(headingMatch[1]))} ${titleText}`
    : `**${titleText}**`;
  lines[titleLine] = formatted;
  return lines.join('\n');
}

/** Default plugins matching the current App.tsx WYSIWYG setup. */
export function createDefaultWysiwygPlugins(
  imageHandlers?: ImagePluginHandlers,
): NonNullable<MDXEditorProps['plugins']> {
  return [
    headingsPlugin(),
    listsPlugin(),
    quotePlugin(),
    thematicBreakPlugin(),
    linkPlugin(),
    codeBlockPlugin({
      defaultCodeBlockLanguage: 'python',
      codeBlockEditorDescriptors: [runnableCodeBlockDescriptor],
    }),
    codeMirrorPlugin({
      // Stable `tok-*` classes so token colors follow the active theme via CSS.
      codeMirrorExtensions: [
        syntaxHighlighting(classHighlighter),
        // Tab accepts the open autocomplete suggestion; otherwise it indents.
        Prec.highest(
          keymap.of([
            {
              key: 'Tab',
              run: (view) =>
                completionStatus(view.state) === 'active'
                  ? acceptCompletion(view)
                  : indentMore(view),
            },
            { key: 'Shift-Tab', run: indentLess },
            {
              // Run the block (handled by RunnableCodeBlock's wrapper).
              key: 'Mod-Enter',
              run: (view) => {
                view.dom.dispatchEvent(new CustomEvent(RUN_CODE_EVENT, { bubbles: true }));
                return true;
              },
            },
          ]),
        ),
      ],
      codeBlockLanguages: {
        python: 'Python',
        typescript: 'TypeScript',
        text: 'Raw Text',
        '': 'Raw Text',
      },
    }),
    imagePlugin(imageHandlers),
    tablePlugin(),
    markdownShortcutPlugin(),
    mathPlugin(),
    arrowPlugin(),
    emDashPlugin(),
    slashMenuPlugin(),
    quoteExitPlugin(),
    inlineCodeExitPlugin(),
    cardShortcutsPlugin(),
    tabIndentPlugin(),
  ];
}

/** Leaner plugin set for very large notes (skips math/slash/runnable extras). */
export function createLiteWysiwygPlugins(): NonNullable<MDXEditorProps['plugins']> {
  return [
    headingsPlugin(),
    listsPlugin(),
    quotePlugin(),
    thematicBreakPlugin(),
    linkPlugin(),
    codeBlockPlugin({ defaultCodeBlockLanguage: 'text' }),
    codeMirrorPlugin({
      codeMirrorExtensions: [syntaxHighlighting(classHighlighter)],
      codeBlockLanguages: {
        python: 'Python',
        typescript: 'TypeScript',
        text: 'Raw Text',
        '': 'Raw Text',
      },
    }),
    markdownShortcutPlugin(),
    quoteExitPlugin(),
    inlineCodeExitPlugin(),
    emDashPlugin(),
    cardShortcutsPlugin(),
    tabIndentPlugin(),
  ];
}

/** Notes larger than this use the lite plugin set. */
export const LARGE_NOTE_CHARS = 350_000;

/**
 * Thin MDXEditor wrapper.
 * MDXEditor only applies the `markdown` prop on mount, so we remount (and
 * setMarkdown) whenever `documentId` changes.
 */
export const WysiwygEditor = forwardRef<WysiwygEditorHandle, WysiwygEditorProps>(
  function WysiwygEditor(
    {
      documentId,
      vaultRoot,
      contentRevision = 0,
      markdown,
      onChange,
      onBlur,
      className = 'wysiwyg',
      readOnly,
      extraPlugins,
      plugins: pluginsOverride,
      onCommand: _onCommand,
      placeholder,
    },
    ref,
  ) {
    const editorRef = useRef<MDXEditorMethods>(null);
    const markdownRef = useRef(markdown);
    markdownRef.current = markdown;

    // Read at upload/preview time so note switches never use a stale path —
    // the plugin list itself isn't rebuilt when vaultRoot/documentId change.
    const imageContextRef = useRef<ImageEditingContext>({ vaultRoot, notePath: documentId });
    imageContextRef.current = { vaultRoot, notePath: documentId };
    const imageHandlers = useMemo(
      () => createImageHandlers(() => imageContextRef.current),
      [],
    );

    useImperativeHandle(ref, () => ({
      focus: () => editorRef.current?.focus(),
      getMarkdown: () => {
        const raw = editorRef.current?.getMarkdown() ?? markdownRef.current;
        return preferOneLineDisplayMath(raw);
      },
      setMarkdown: (value: string) =>
        editorRef.current?.setMarkdown(normalizeMathMarkdown(value)),
      insertMarkdown: (value: string) => {
        const editor = editorRef.current;
        if (!editor) return;
        const markdown = normalizePastedMathMarkdown(value);
        // MDXEditor drops the selection when inserting into an unfocused
        // editor, so restore focus (and the saved selection) first.
        editor.focus(() => editor.insertMarkdown(markdown), { defaultSelection: 'rootEnd' });
      },
      getSelectionMarkdown: () => editorRef.current?.getSelectionMarkdown() ?? '',
    }));

    useLayoutEffect(() => {
      if (!documentId) return;
      editorRef.current?.setMarkdown(normalizeMathMarkdown(markdownRef.current));
      // The editor-wrap element is reused between notes. Reset its scroll
      // position so a newly opened document never inherits the prior note's
      // vertical offset.
      const editorWrap = editorRef.current
        ? document.querySelector<HTMLElement>('.editor-wrap')
        : null;
      if (editorWrap) editorWrap.scrollTop = 0;
    }, [documentId]);

    // External reloads (Codex / watcher) — same documentId, new disk content.
    useLayoutEffect(() => {
      if (!documentId || contentRevision <= 0) return;
      editorRef.current?.setMarkdown(normalizeMathMarkdown(markdownRef.current));
    }, [contentRevision, documentId]);

    const useLitePlugins = markdown.length >= LARGE_NOTE_CHARS;
    const plugins = useMemo(() => {
      if (pluginsOverride) return pluginsOverride;
      if (useLitePlugins) {
        console.info(
          `[perf] large note (${markdown.length} chars) — using lite editor plugins`,
        );
      }
      const base = useLitePlugins
        ? createLiteWysiwygPlugins()
        : createDefaultWysiwygPlugins(imageHandlers);
      return extraPlugins ? [...base, ...extraPlugins] : base;
    }, [pluginsOverride, extraPlugins, useLitePlugins, imageHandlers]);

    const initialMarkdown = useMemo(
      () => normalizeMathMarkdown(markdown),
      // Seed once per document mount; live edits flow through onChange.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [documentId],
    );

    return (
      <div
        onPasteCapture={(event) => {
          const imageDataUrl = extractPastedImageDataUrl(event.clipboardData);
          if (imageDataUrl) {
            event.preventDefault();
            event.stopPropagation();
            buildImageMarkdownFromDataUrl(imageDataUrl, imageHandlers.imageUploadHandler)
              .then((markdown) => editorRef.current?.insertMarkdown(markdown))
              .catch((error) => console.error('[image] pasted data URI failed', error));
            return;
          }
          const text = event.clipboardData.getData('text/plain');
          // Rich clipboard HTML from chat apps can be flattened by the editor's
          // paste conversion. Reinsert ordered Markdown directly so it stays an
          // ordered list instead of becoming bullets.
          if (containsOrderedList(text)) {
            event.preventDefault();
            event.stopPropagation();
            const html = event.clipboardData.getData('text/html');
            const formattedText = preservePastedTitleFormatting(text, html);
            editorRef.current?.insertMarkdown(normalizePastedMathMarkdown(formattedText));
            return;
          }
          // intercept LaTeX delimiters 
          if (!/\\\[|\\\(|\\\$[^\n]*?\\\$/.test(text)) return;
          event.preventDefault();
          event.stopPropagation();
          editorRef.current?.insertMarkdown(normalizePastedMathMarkdown(text));
        }}
        onClickCapture={(event) => {
          // Preserve normal clicks for editing; Command-click follows a link.
          if (!event.metaKey && !event.ctrlKey) return;
          const target = event.target;
          if (!(target instanceof Element)) return;
          const anchor = target.closest('a[href]');
          if (!(anchor instanceof HTMLAnchorElement)) return;
          event.preventDefault();
          event.stopPropagation();
          window.open(anchor.href, '_blank', 'noopener,noreferrer');
        }}
      >
        <MDXEditor
          key={documentId ?? 'editor'}
          ref={editorRef}
          className={className}
          markdown={initialMarkdown}
          onChange={(next) => onChange?.(preferOneLineDisplayMath(next))}
          onBlur={onBlur}
          readOnly={readOnly}
          placeholder={placeholder}
          plugins={plugins}
          // Popups (language picker, etc.) default to <body>, outside the theme
          // wrapper, so theme CSS variables wouldn't resolve there.
          overlayContainer={document.querySelector<HTMLElement>('.radix-themes')}
        />
      </div>
    );
  },
);
