import type { ReactNode } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { normalizeMathMarkdown } from '../editor/math';
import { CodeSnippet } from './CodeSnippet';

type HastText = { type: string; value?: string; children?: HastText[] };
type HastElement = {
  properties?: { className?: string[] | string };
  children?: HastText[];
};

function textOf(node: HastText | undefined): string {
  if (!node) return '';
  if (node.type === 'text') return node.value ?? '';
  return (node.children ?? []).map(textOf).join('');
}

const baseComponents: Components = {
  // Fenced blocks become the shared highlighted snippet.
  pre({ node }) {
    const code = (node?.children?.[0] ?? undefined) as HastElement | undefined;
    const className = code?.properties?.className;
    const classes = Array.isArray(className) ? className : className ? [className] : [];
    const language = classes.find((c) => c.startsWith('language-'))?.slice('language-'.length) ?? 'text';
    return <CodeSnippet language={language} code={textOf(code as HastText).replace(/\n$/, '')} />;
  },
  code({ children }) {
    return <code className="quiz-inline-code">{children}</code>;
  },
};

const inlineComponents: Components = {
  ...baseComponents,
  // Options and feedback flow inside other elements, so drop the paragraph wrapper.
  p: ({ children }) => <>{children}</>,
};

/**
 * Renders quiz text (prompts, options, feedback): fenced code with highlighting,
 * inline `code`, emphasis, lists, tables and math. `inline` is for text that
 * sits inside another element.
 */
export function QuizMarkdown({ children, inline = false }: { children: string; inline?: boolean }): ReactNode {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkMath]}
      rehypePlugins={[rehypeKatex]}
      components={inline ? inlineComponents : baseComponents}
    >
      {normalizeMathMarkdown(children)}
    </ReactMarkdown>
  );
}
