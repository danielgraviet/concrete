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
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
      >
        {source}
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
