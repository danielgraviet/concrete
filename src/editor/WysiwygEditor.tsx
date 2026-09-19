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
import { RUN_CODE_EVENT, runnableCodeBlockDescriptor } from './RunnableCodeBlock';
import { quoteExitPlugin } from './quote';
import { inlineCodeExitPlugin } from './inlineCode';
import { slashMenuPlugin } from './slash';
import { mathPlugin, normalizeMathMarkdown, preferOneLineDisplayMath } from './math';
import { arrowPlugin } from './arrow';

export type WysiwygEditorProps = {
  /** Stable id for the open document — remounts/syncs when it changes. */
  documentId?: string;
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
};

/** Default plugins matching the current App.tsx WYSIWYG setup. */
export function createDefaultWysiwygPlugins(): NonNullable<MDXEditorProps['plugins']> {
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
    imagePlugin(),
    tablePlugin(),
    markdownShortcutPlugin(),
    mathPlugin(),
    arrowPlugin(),
    slashMenuPlugin(),
    quoteExitPlugin(),
    inlineCodeExitPlugin(),
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

    useImperativeHandle(ref, () => ({
      focus: () => editorRef.current?.focus(),
      getMarkdown: () => {
        const raw = editorRef.current?.getMarkdown() ?? markdownRef.current;
        return preferOneLineDisplayMath(raw);
      },
      setMarkdown: (value: string) =>
        editorRef.current?.setMarkdown(normalizeMathMarkdown(value)),
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
        : createDefaultWysiwygPlugins();
      return extraPlugins ? [...base, ...extraPlugins] : base;
    }, [pluginsOverride, extraPlugins, useLitePlugins, markdown.length]);

    const initialMarkdown = useMemo(
      () => normalizeMathMarkdown(markdown),
      // Seed once per document mount; live edits flow through onChange.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [documentId],
    );

    return (
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
    );
  },
);
