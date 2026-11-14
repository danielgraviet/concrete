import { useEffect, useRef, useState, type ReactNode } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { escapeCurrencyDollars, normalizeMathMarkdown } from '../../editor/math';
import { ensureKatexCss } from '../../editor/math/ensureKatexCss';
import { renderMermaid } from '../../integrations/mermaid/MermaidCodeBlock';
import { CodeSnippet } from '../../quiz/CodeSnippet';

type HastText = { type: string; value?: string; children?: HastText[] };
type HastElement = { properties?: { className?: string[] | string }; children?: HastText[] };

function textOf(node: HastText | undefined): string {
  if (!node) return '';
  if (node.type === 'text') return node.value ?? '';
  return (node.children ?? []).map(textOf).join('');
}

function MermaidBlock({ code }: { code: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [svg, setSvg] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const root = ref.current?.closest('.radix-themes') ?? document.documentElement;
    const dark = root.classList.contains('dark') || root.classList.contains('dark-theme');
    renderMermaid(code, dark ? 'dark' : 'default')
      .then((out) => !cancelled && setSvg(out))
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [code]);
  if (failed) return <CodeSnippet language="mermaid" code={code} />;
  // mermaid runs with securityLevel 'strict', which sanitizes the SVG.
  if (svg) return <div className="share-mermaid" dangerouslySetInnerHTML={{ __html: svg }} />;
  return (
    <div ref={ref} className="share-mermaid share-muted">
      Rendering diagram…
    </div>
  );
}

const components: Components = {
  pre({ node }) {
    const code = (node?.children?.[0] ?? undefined) as HastElement | undefined;
    const className = code?.properties?.className;
    const classes = Array.isArray(className) ? className : className ? [className] : [];
    const language = classes.find((c) => c.startsWith('language-'))?.slice('language-'.length) ?? 'text';
    const text = textOf(code as HastText).replace(/\n$/, '');
    if (language === 'mermaid') return <MermaidBlock code={text} />;
    return <CodeSnippet language={language} code={text} />;
  },
  // Links inside a share point at the sharer's workspace; keep them inert except web URLs.
  a({ href, children }) {
    if (href && /^https?:\/\//i.test(href)) {
      return (
        <a href={href} target="_blank" rel="noreferrer noopener">
          {children}
        </a>
      );
    }
    return <span className="share-inert-link">{children}</span>;
  },
  img({ src, alt }) {
    return typeof src === 'string' && /^(https?:|data:image\/)/i.test(src) ? <img src={src} alt={alt ?? ''} /> : <span>{alt}</span>;
  },
};

/** `[[Wiki links]]` render as plain text; frontmatter is hidden. */
function prepare(markdown: string): string {
  const body = markdown.replace(/^---\n[\s\S]*?\n---\n?/, '');
  return normalizeMathMarkdown(escapeCurrencyDollars(body.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_m, target, label) => label ?? target)));
}

/** Read-only markdown for shared notes: GFM, math, highlighted code, mermaid. */
export function ShareMarkdown({ markdown, className = 'share-markdown' }: { markdown: string; className?: string }): ReactNode {
  const [cssReady, setCssReady] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void ensureKatexCss().then(() => !cancelled && setCssReady(true));
    return () => {
      cancelled = true;
    };
  }, []);
  return (
    <div className={className}>
      {cssReady ? (
        <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]} components={components}>
          {prepare(markdown)}
        </ReactMarkdown>
      ) : (
        <pre className="share-markdown-fallback">{markdown}</pre>
      )}
    </div>
  );
}
