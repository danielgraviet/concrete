import { useEffect } from 'react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { realmPlugin, addComposerChild$ } from '@mdxeditor/editor';
import { $isQuoteNode, type QuoteNode } from '@lexical/rich-text';
import { $findMatchingParent } from '@lexical/utils';
import {
  $createParagraphNode,
  $getSelection,
  $isParagraphNode,
  $isRangeSelection,
  COMMAND_PRIORITY_LOW,
  KEY_ENTER_COMMAND,
  type ParagraphNode,
} from 'lexical';

function $isBlank(node: { getTextContent: () => string }): boolean {
  return node.getTextContent() === '';
}

/** Drop an empty trailing line and place a paragraph after the quote. */
function $exitQuoteAfter(quote: QuoteNode, emptyParagraph?: ParagraphNode): void {
  emptyParagraph?.remove();
  const next = $createParagraphNode();
  quote.insertAfter(next);
  if (quote.getChildrenSize() === 0) {
    quote.remove();
  }
  next.selectStart();
}

/**
 * Notion/Docs-style quote exit: Enter on an empty quote line leaves the
 * blockquote. Shift+Enter is left to Lexical (soft break).
 */
export function QuoteExitComposer(): null {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    return editor.registerCommand(
      KEY_ENTER_COMMAND,
      (event) => {
        if (event !== null && event.shiftKey) {
          return false;
        }

        const selection = $getSelection();
        if (!$isRangeSelection(selection) || !selection.isCollapsed()) {
          return false;
        }

        const anchorNode = selection.anchor.getNode();
        const paragraph = $findMatchingParent(anchorNode, $isParagraphNode);

        // Nested model (common after mdast import): QuoteNode > ParagraphNode
        if (paragraph !== null) {
          const parent = paragraph.getParent();
          if (
            $isQuoteNode(parent) &&
            $isBlank(paragraph) &&
            parent.getLastChild() === paragraph
          ) {
            event?.preventDefault();
            $exitQuoteAfter(parent, paragraph);
            return true;
          }
          return false;
        }

        // Flat model (slash / toolbar convert): QuoteNode with inline children
        const quote = $findMatchingParent(anchorNode, $isQuoteNode);
        if (quote !== null && $isBlank(quote)) {
          event?.preventDefault();
          const next = $createParagraphNode();
          quote.replace(next);
          next.selectStart();
          return true;
        }

        return false;
      },
      COMMAND_PRIORITY_LOW,
    );
  }, [editor]);

  return null;
}

/** Registers Enter-to-exit-blockquote behavior inside MDXEditor. */
export const quoteExitPlugin = realmPlugin({
  init(realm) {
    realm.pub(addComposerChild$, QuoteExitComposer);
  },
});
