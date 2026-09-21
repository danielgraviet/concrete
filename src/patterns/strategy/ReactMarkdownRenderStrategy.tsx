import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import type { RenderStrategy } from './types';
import { normalizeMathMarkdown } from '../../editor/math';
import { ensureKatexCss } from '../../editor/math/ensureKatexCss';

export type ReactMarkdownRenderProps = {
  markdown: string;
  className?: string;
};

function splitTwoColumnBlock(markdown: string) {
  // The outer block is greedy because its contents contain two inner :::column blocks.
  const match = /(^|\n):::columns[ \t]*\n([\s\S]*)\n:::[ \t]*(?=\n|$)/m.exec(markdown);
  if (!match) return null;
  const columns = [...match[2].matchAll(/:::column[ \t]*\n([\s\S]*?)\n:::[ \t]*(?=\n|$)/g)];
  if (columns.length !== 2) return null;
  const start = match.index + match[1].length;
  const end = start + match[0].length - match[1].length;
  return { before: markdown.slice(0, start), left: columns[0][1], right: columns[1][1], after: markdown.slice(end) };
}

function MarkdownFragment({ markdown }: { markdown: string }): ReactNode {
  const block = splitTwoColumnBlock(markdown);
  if (!block) return <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>{markdown}</ReactMarkdown>;
  return <>
    {block.before && <MarkdownFragment markdown={block.before} />}
    <div className="markdown-two-columns">
      <div className="markdown-two-column"><MarkdownFragment markdown={block.left} /></div>
      <div className="markdown-two-column"><MarkdownFragment markdown={block.right} /></div>
    </div>
    {block.after && <MarkdownFragment markdown={block.after} />}
  </>;
}

/**
 * Presentational component: GFM + math via remark/rehype.
 * KaTeX CSS is loaded on first math-capable preview.
 */
export function ReactMarkdownView({
  markdown,
  className,
}: ReactMarkdownRenderProps): ReactNode {
  const [cssReady, setCssReady] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void ensureKatexCss().then(() => {
      if (!cancelled) setCssReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const source = normalizeMathMarkdown(markdown);
  if (!cssReady) {
    return <div className={className ?? 'md-preview'}>{source}</div>;
  }

  return (
    <div className={className ?? 'md-preview'}>
      <MarkdownFragment markdown={source} />
    </div>
  );
}

/** RenderStrategy that uses ReactMarkdownView. */
export class ReactMarkdownRenderStrategy implements RenderStrategy {
  readonly id = 'react-markdown-gfm-math';

  render(markdown: string): ReactNode {
    return <ReactMarkdownView markdown={markdown} />;
  }
}
