import { useMemo } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { escapeCurrencyDollars, normalizeMathMarkdown } from '../../editor/math';
import { CodeSnippet } from '../../quiz/CodeSnippet';

type HastNode = {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
  position?: { start: { offset?: number }; end: { offset?: number } };
};

function textOf(node: HastNode | undefined): string {
  if (!node) return '';
  if (node.type === 'text') return node.value ?? '';
  return (node.children ?? []).map(textOf).join('');
}

/**
 * Wraps each top-level block in `div.chat-block` tagged with its source
 * offsets, so a single equation, list or code block can be sent to the note
 * as the exact Markdown the model wrote.
 */
function rehypeSourceBlocks() {
  return (tree: HastNode) => {
    tree.children = (tree.children ?? []).map((child) => {
      const start = child.position?.start.offset;
      const end = child.position?.end.offset;
      if (child.type !== 'element' || start == null || end == null) return child;
      return {
        type: 'element',
        tagName: 'div',
        properties: { className: ['chat-block'], dataStart: start, dataEnd: end },
        children: [child],
      };
    });
  };
}

/** Same delimiter cleanup the editor applies, so rendered math matches inserted math. */
export function normalizeChatMarkdown(text: string): string {
  return normalizeMathMarkdown(escapeCurrencyDollars(text));
}

type Props = {
  text: string;
  /** When set, each block gets a hover button that inserts its Markdown. */
  onInsertBlock?: (markdown: string) => void;
};

/** Chat reply renderer: GFM, KaTeX math, highlighted code, per-block insert. */
export function ChatMarkdown({ text, onInsertBlock }: Props) {
  const source = useMemo(() => normalizeChatMarkdown(text), [text]);

  const components = useMemo<Components>(
    () => ({
      pre({ node }) {
        const code = (node?.children?.[0] ?? undefined) as HastNode | undefined;
        const className = code?.properties?.className;
        const classes = Array.isArray(className) ? (className as string[]) : [];
        // Display math is rendered by KaTeX before this runs; only real code is left.
        const language =
          classes.find((c) => c.startsWith('language-'))?.slice('language-'.length) ?? 'text';
        return <CodeSnippet language={language} code={textOf(code).replace(/\n$/, '')} />;
      },
      div({ node, className, children }) {
        const start = Number(node?.properties?.dataStart);
        const end = Number(node?.properties?.dataEnd);
        if (className !== 'chat-block' || !onInsertBlock || !Number.isFinite(start)) {
          return <div className={className}>{children}</div>;
        }
        return (
          <div className="chat-block">
            {children}
            <button
              type="button"
              className="chat-block-insert"
              title="Insert this block into the note"
              aria-label="Insert this block into the note"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => onInsertBlock(source.slice(start, end))}
            >
              +
            </button>
          </div>
        );
      },
    }),
    [onInsertBlock, source],
  );

  return (
    <div className="study-chat-markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeSourceBlocks, rehypeKatex]}
        components={components}
      >
        {source}
      </ReactMarkdown>
    </div>
  );
}
