import { useCallback, useEffect, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { $getNodeByKey, type NodeKey } from 'lexical';
import katex from 'katex';
import { $isMathNode } from './MathNode';

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
  const inputRef = useRef<HTMLInputElement>(null);
  const areaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

  useEffect(() => {
    if (!editing) return;
    const el = inline ? inputRef.current : areaRef.current;
    el?.focus();
    el?.select();
  }, [editing, inline]);

  const commit = useCallback(() => {
    const next = draft.trim();
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

  const onChange = (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setDraft(event.target.value);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Enter' && (inline || event.metaKey || event.ctrlKey)) {
      event.preventDefault();
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
        <input
          ref={inputRef}
          className="mv-math-input inline"
          value={draft}
          onChange={onChange}
          onBlur={commit}
          onKeyDown={onKeyDown}
          spellCheck={false}
          aria-label="Edit inline math"
        />
      );
    }
    return (
      <textarea
        ref={areaRef}
        className="mv-math-input block"
        rows={2}
        value={draft}
        onChange={onChange}
        onBlur={commit}
        onKeyDown={onKeyDown}
        spellCheck={false}
        aria-label="Edit display math"
      />
    );
  }

  let html = '';
  let error: string | null = null;
  // Notes sometimes write `\=` for equals; KaTeX treats `\=` differently.
  const latex = (value || '\\;').replace(/\\=/g, '=');
  try {
    html = katex.renderToString(latex, {
      throwOnError: false,
      displayMode: !inline,
      strict: 'ignore',
    });
  } catch (err) {
    error = err instanceof Error ? err.message : 'Invalid math';
  }

  return (
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
      ) : (
        <span dangerouslySetInnerHTML={{ __html: html }} />
      )}
    </span>
  );
}
