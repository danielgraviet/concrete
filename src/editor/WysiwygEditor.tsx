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
  markdownShortcutPlugin,
  type MDXEditorMethods,
  type MDXEditorProps,
} from '@mdxeditor/editor';
import '@mdxeditor/editor/style.css';
import {
  forwardRef,
  useImperativeHandle,
  useMemo,
  useRef,
  type ReactNode,
} from 'react';
import type { EditorCommandHandler } from './types';
import { quoteExitPlugin } from './quote';
import { slashMenuPlugin } from './slash';

export type WysiwygEditorProps = {
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
    codeBlockPlugin({ defaultCodeBlockLanguage: 'javascript' }),
    codeMirrorPlugin({
      codeBlockLanguages: {
        js: 'JavaScript',
        javascript: 'JavaScript',
        ts: 'TypeScript',
        typescript: 'TypeScript',
        tsx: 'TSX',
        jsx: 'JSX',
        css: 'CSS',
        html: 'HTML',
        json: 'JSON',
        md: 'Markdown',
        python: 'Python',
        rust: 'Rust',
        go: 'Go',
        shell: 'Shell',
        text: 'Plain Text',
        '': 'Plain Text',
      },
    }),
    imagePlugin(),
    markdownShortcutPlugin(),
    slashMenuPlugin(),
    quoteExitPlugin(),
  ];
}

/**
 * Thin MDXEditor wrapper: reliable WYSIWYG Markdown editing with room for
 * more plugins and a command callback for later Command-pattern integration.
 */
export const WysiwygEditor = forwardRef<WysiwygEditorHandle, WysiwygEditorProps>(
  function WysiwygEditor(
    {
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

    useImperativeHandle(ref, () => ({
      focus: () => editorRef.current?.focus(),
      getMarkdown: () => editorRef.current?.getMarkdown() ?? markdown,
      setMarkdown: (value: string) => editorRef.current?.setMarkdown(value),
    }));

    const plugins = useMemo(() => {
      if (pluginsOverride) return pluginsOverride;
      const base = createDefaultWysiwygPlugins();
      return extraPlugins ? [...base, ...extraPlugins] : base;
    }, [pluginsOverride, extraPlugins]);

    return (
      <MDXEditor
        ref={editorRef}
        className={className}
        markdown={markdown}
        onChange={onChange}
        onBlur={onBlur}
        readOnly={readOnly}
        placeholder={placeholder}
        plugins={plugins}
      />
    );
  },
);
