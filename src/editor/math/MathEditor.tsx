import { useCallback, useEffect, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { ContextMenu } from '@radix-ui/themes';
import { $getNodeByKey, type NodeKey } from 'lexical';
import katex from 'katex';
import { $isMathNode } from './MathNode';
import { CACHED_EQUATIONS, formatEquationLatex, resolveEquation } from './equationResolver';
import { ensureKatexCss } from './ensureKatexCss';

function equationSuggestion(prompt: string): [string, string] | null {
  const query = prompt.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  if (!query) return null;
  const match = Object.entries(CACHED_EQUATIONS).find(([name]) => name.startsWith(query) || query.includes(name));
  return match ?? null;
}

type Props = {
  value: string;
  inline: boolean;
  nodeKey: NodeKey;
};

/**
 * Renders KaTeX; double-click (or Enter/F2) to edit the LaTeX source.
 */
export function MathEditor({ value, inline, nodeKey }: Props) {
  const [editor] = useLexicalComposerContext();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const draftRef = useRef(value);
  const inputRef = useRef<HTMLInputElement>(null);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const [generating, setGenerating] = useState(false);
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

  useEffect(() => {
    if (!editing) {
      setDraft(value);
      // Slash-command math starts with a temporary placeholder. Enter edit
      // mode immediately so the first keystroke replaces it.
      if (value === 'formula') setEditing(true);
    }
  }, [value, editing]);

  useEffect(() => {
    if (!editing) return;
    const el = inline ? inputRef.current : areaRef.current;
    el?.focus();
    el?.select();
  }, [editing, inline]);

  const commit = useCallback((value = draftRef.current) => {
    const next = value.trim();
    editor.update(() => {
      const node = $getNodeByKey(nodeKey);
      if (!$isMathNode(node)) return;
      if (!next) {
        node.remove();
        return;
      }
      if (next !== node.getValue()) node.setValue(next);
    });
    setEditing(false);
  }, [draft, editor, nodeKey]);

  const generate = async () => {
    if (!draft.trim() || generating) return;
    setGenerating(true);
    try {
      const latex = await resolveEquation(draft);
      if (latex) setDraft(latex);
    } finally {
      setGenerating(false);
    }
  };

  const onChange = (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    draftRef.current = event.target.value;
    setDraft(event.target.value);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    const suggestion = equationSuggestion(draft);
    if (event.key === 'Tab' && suggestion) {
      event.preventDefault();
      draftRef.current = suggestion[1];
      setDraft(suggestion[1]);
      return;
    }
    if (
      event.key === 'Enter' &&
      (inline || !event.shiftKey)
    ) {
      event.preventDefault();
      if (event.metaKey || event.ctrlKey) {
        void generate();
        return;
      }
      commit();
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      setDraft(value);
      setEditing(false);
    }
  };

  if (editing) {
    if (inline) {
      return (
        <div className="mv-math-editing">
          {equationSuggestion(draft) ? <div className="mv-math-suggestion">Tab ↹ {equationSuggestion(draft)?.[0]}</div> : null}
          <input ref={inputRef} className="mv-math-input inline" value={draft} onChange={onChange} onBlur={() => setTimeout(() => commit(), 0)} onKeyDown={onKeyDown} spellCheck={false} aria-label="Edit inline math" />
        </div>
      );
    }
    return (
      <div className="mv-math-editing">
        {equationSuggestion(draft) ? <div className="mv-math-suggestion">Tab ↹ {equationSuggestion(draft)?.[0]}</div> : null}
        <textarea ref={areaRef} className="mv-math-input block" rows={2} value={draft} onChange={onChange} onBlur={() => setTimeout(() => commit(), 0)} onKeyDown={onKeyDown} spellCheck={false} aria-label="Edit display math" />
      </div>
    );
  }

  let html = '';
  let error: string | null = null;
  // Notes sometimes write `\=` for equals; KaTeX treats `\=` differently.
  const latex = formatEquationLatex((value || '\\;').replace(/\\=/g, '='));
  try {
    html = katex.renderToString(latex, {
      throwOnError: false,
      displayMode: !inline,
      strict: 'ignore',
    });
  } catch (err) {
    error = err instanceof Error ? err.message : 'Invalid math';
  }

  const remove = () => {
    editor.update(() => {
      const node = $getNodeByKey(nodeKey);
      if ($isMathNode(node)) node.remove();
    });
  };

  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger>
        <span
          className={inline ? 'mv-math-render inline' : 'mv-math-render block'}
          title="Double-click to edit LaTeX"
          onDoubleClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            setEditing(true);
          }}
        >
          {error ? (
            <span className="mv-math-error">{error}</span>
          ) : cssReady ? (
            <span dangerouslySetInnerHTML={{ __html: html }} />
          ) : (
            <span className="mv-math-fallback">{value || '…'}</span>
          )}
        </span>
      </ContextMenu.Trigger>
      <ContextMenu.Content size="1" variant="soft">
        <ContextMenu.Item color="red" onSelect={remove}>
          Delete equation
        </ContextMenu.Item>
      </ContextMenu.Content>
    </ContextMenu.Root>
  );
}
