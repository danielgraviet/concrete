import { useEffect, useRef, useState } from 'react';
import { CodeMirrorEditor, type CodeBlockEditorDescriptor, type CodeBlockEditorProps } from '@mdxeditor/editor';
import { MermaidViewer } from './MermaidViewer';
import { normalizeMermaid } from './normalizeMermaid';
import './mermaid.css';

type MermaidApi = typeof import('mermaid')['default'];

let mermaidPromise: Promise<MermaidApi> | null = null;
let configuredTheme: 'dark' | 'default' | null = null;
let renderCounter = 0;

/** Lazy-load mermaid (it is large) and re-initialize only when the theme changes. */
async function loadMermaid(theme: 'dark' | 'default'): Promise<MermaidApi> {
  mermaidPromise ??= import('mermaid').then((module) => module.default);
  const mermaid = await mermaidPromise;
  if (configuredTheme !== theme) {
    mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme });
    configuredTheme = theme;
  }
  return mermaid;
}

/** Render mermaid source to an SVG string. Exported for tests / other renderers. */
export async function renderMermaid(code: string, theme: 'dark' | 'default'): Promise<string> {
  const mermaid = await loadMermaid(theme);
  const id = `concrete-mermaid-${++renderCounter}`;
  try {
    const { svg } = await mermaid.render(id, normalizeMermaid(code));
    return svg;
  } finally {
    // mermaid leaves a temporary container behind when rendering fails.
    document.getElementById(`d${id}`)?.remove();
    document.getElementById(id)?.remove();
  }
}

function useIsDark(ref: React.RefObject<HTMLElement | null>): boolean {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const root = ref.current?.closest('.radix-themes') ?? document.documentElement;
    const update = () => setDark(root.classList.contains('dark') || root.classList.contains('dark-theme'));
    update();
    const observer = new MutationObserver(update);
    observer.observe(root, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, [ref]);
  return dark;
}

type RenderState =
  | { status: 'loading' }
  | { status: 'ok'; svg: string }
  | { status: 'error'; message: string };

export function MermaidCodeBlock(props: CodeBlockEditorProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const dark = useIsDark(rootRef);
  const [editing, setEditing] = useState(() => !props.code.trim());
  const [state, setState] = useState<RenderState>({ status: 'loading' });
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    const code = props.code.trim();
    if (!code) {
      setState({ status: 'error', message: 'Empty diagram — add Mermaid source.' });
      return;
    }
    let cancelled = false;
    // Debounce so typing in the source editor doesn't re-render on every keystroke.
    const timer = setTimeout(() => {
      renderMermaid(code, dark ? 'dark' : 'default')
        .then((svg) => { if (!cancelled) setState({ status: 'ok', svg }); })
        .catch((error: unknown) => {
          if (!cancelled) setState({ status: 'error', message: error instanceof Error ? error.message : String(error) });
        });
    }, 250);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [props.code, dark]);

  return (
    <div className="mermaid-code-block" ref={rootRef}>
      <div className="mermaid-code-toolbar" contentEditable={false}>
        <span className="mermaid-code-label">Mermaid diagram</span>
        <span className="mermaid-code-actions">
          {state.status === 'ok' ? (
            <button
              type="button"
              className="mermaid-code-toggle"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => setExpanded(true)}
            >
              Expand
            </button>
          ) : null}
          <button
            type="button"
            className="mermaid-code-toggle"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => setEditing((value) => !value)}
          >
            {editing ? 'Hide source' : 'Edit source'}
          </button>
        </span>
      </div>
      <div className="mermaid-code-preview" contentEditable={false}>
        {state.status === 'loading' ? <div className="mermaid-code-message">Rendering diagram…</div> : null}
        {state.status === 'error' ? (
          <div className="mermaid-code-error">
            <pre>{state.message}</pre>
            {!editing ? (
              <button type="button" className="mermaid-code-toggle" onClick={() => setEditing(true)}>Fix source</button>
            ) : null}
          </div>
        ) : null}
        {state.status === 'ok' ? (
          <div
            className="mermaid-code-svg"
            title="Click to expand"
            onClick={() => setExpanded(true)}
            dangerouslySetInnerHTML={{ __html: state.svg }}
          />
        ) : null}
      </div>
      {expanded && state.status === 'ok' ? (
        <MermaidViewer svg={state.svg} anchor={rootRef.current} onClose={() => setExpanded(false)} />
      ) : null}
      {editing ? <div className="mermaid-code-source"><CodeMirrorEditor {...props} /></div> : null}
    </div>
  );
}

export const mermaidCodeBlockDescriptor: CodeBlockEditorDescriptor = {
  priority: 5,
  match: (language) => language?.toLowerCase() === 'mermaid',
  Editor: MermaidCodeBlock,
};
