import { useEffect } from 'react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { realmPlugin, addComposerChild$ } from '@mdxeditor/editor';
import {
  $getSelection,
  $isRangeSelection,
  $isTextNode,
  COMMAND_PRIORITY_HIGH,
  KEY_ENTER_COMMAND,
} from 'lexical';

function $selectionInInlineCode(): boolean {
  const selection = $getSelection();
  if (!$isRangeSelection(selection)) return false;
  if (selection.hasFormat('code')) return true;
  const node = selection.anchor.getNode();
  return $isTextNode(node) && node.hasFormat('code');
}

/**
 * Inline code is single-line only: Enter leaves the code span and continues
 * as normal paragraph text.
 */
export function InlineCodeExitComposer(): null {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    return editor.registerCommand(
      KEY_ENTER_COMMAND,
      (event) => {
        if (!$selectionInInlineCode()) {
          return false;
        }

        event?.preventDefault();

        const selection = $getSelection();
        if (!$isRangeSelection(selection)) {
          return false;
        }

        // Drop code from the typing format so the new line is plain text.
        if (selection.hasFormat('code')) {
          selection.toggleFormat('code');
        }

        selection.insertParagraph();

        const next = $getSelection();
        if ($isRangeSelection(next)) {
          if (next.hasFormat('code')) {
            next.toggleFormat('code');
          }
          const node = next.anchor.getNode();
          if ($isTextNode(node) && node.hasFormat('code')) {
            node.toggleFormat('code');
          }
        }

        return true;
      },
      COMMAND_PRIORITY_HIGH,
    );
  }, [editor]);

  return null;
}

/** Registers Enter-to-exit-inline-code behavior inside MDXEditor. */
export const inlineCodeExitPlugin = realmPlugin({
  init(realm) {
    realm.pub(addComposerChild$, InlineCodeExitComposer);
  },
});
