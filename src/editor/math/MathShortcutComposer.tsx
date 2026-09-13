import { useEffect } from 'react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import {
  $createTextNode,
  $getSelection,
  $isRangeSelection,
  $isTextNode,
  type TextNode,
} from 'lexical';
import { $createMathNode } from './MathNode';

/**
 * Convert a trailing `$...$` or `$$...$$` in the current text node into a MathNode.
 */
function $convertTrailingMath(textNode: TextNode): boolean {
  const text = textNode.getTextContent();

  const display = /(.*)\$\$([^$]+)\$\$$/.exec(text);
  if (display) {
    const before = display[1];
    const latex = display[2].trim();
    if (!latex) return false;
    const math = $createMathNode(latex, false);
    if (before) {
      textNode.setTextContent(before);
      textNode.insertAfter(math);
    } else {
      textNode.replace(math);
    }
    math.selectNext(0, 0);
    return true;
  }

  const inline = /(.*(?:^|[^$]))\$([^$\n]+)\$(?!\$)$/.exec(text);
  if (inline) {
    const before = inline[1];
    const latex = inline[2].trim();
    if (!latex) return false;
    const math = $createMathNode(latex, true);
    if (before) {
      textNode.setTextContent(before);
      textNode.insertAfter(math);
    } else {
      textNode.replace(math);
    }
    // Keep a trailing space convenience after inline math when converting.
    const space = $createTextNode(' ');
    math.insertAfter(space);
    space.select();
    return true;
  }

  return false;
}

export function MathShortcutComposer(): null {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    return editor.registerUpdateListener(({ editorState, dirtyElements, dirtyLeaves, tags }) => {
      if (tags.has('historic') || tags.has('collaboration')) return;
      if (dirtyElements.size === 0 && dirtyLeaves.size === 0) return;

      const shouldConvert = editorState.read(() => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection) || !selection.isCollapsed()) return false;
        const node = selection.anchor.getNode();
        if (!$isTextNode(node)) return false;
        const text = node.getTextContent();
        return /\$\$[^$]+\$\$$/.test(text) || /(?:^|[^$])\$[^$\n]+\$$/.test(text);
      });

      if (!shouldConvert) return;

      queueMicrotask(() => {
        editor.update(() => {
          const selection = $getSelection();
          if (!$isRangeSelection(selection) || !selection.isCollapsed()) return;
          const node = selection.anchor.getNode();
          if ($isTextNode(node)) $convertTrailingMath(node);
        });
      });
    });
  }, [editor]);

  return null;
}
