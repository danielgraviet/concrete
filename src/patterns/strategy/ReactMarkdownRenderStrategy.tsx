import type { ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import type { RenderStrategy } from './types';

export type ReactMarkdownRenderProps = {
  markdown: string;
  className?: string;
};

/**
 * Presentational component: GFM + math via remark/rehype.
 * Import katex CSS at the app shell (`katex/dist/katex.min.css`).
 */
export function ReactMarkdownView({
  markdown,
  className,
}: ReactMarkdownRenderProps): ReactNode {
  return (
    <div className={className ?? 'md-preview'}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
      >
        {markdown}
      </ReactMarkdown>
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
