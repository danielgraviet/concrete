import { useEffect } from 'react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { addComposerChild$, realmPlugin } from '@mdxeditor/editor';
import {
  $getSelection,
  $isRangeSelection,
  $isTextNode,
  COMMAND_PRIORITY_HIGH,
  KEY_DOWN_COMMAND,
} from 'lexical';

function EmDashComposer(): null {
  const [editor] = useLexicalComposerContext();

  useEffect(
    () =>
      editor.registerCommand(
        KEY_DOWN_COMMAND,
        (event) => {
          if (event.key !== '-' || event.metaKey || event.ctrlKey || event.altKey) return false;
          const selection = $getSelection();
          if (!$isRangeSelection(selection) || !selection.isCollapsed()) return false;
          const node = selection.anchor.getNode();
          const offset = selection.anchor.offset;
          if (
            !$isTextNode(node) ||
            node.hasFormat('code') ||
            offset === 0 ||
            node.getTextContent()[offset - 1] !== '-'
          ) {
            return false;
          }

          // The keydown fires before Lexical inserts the second hyphen.
          event.preventDefault();
          selection.anchor.set(node.getKey(), offset - 1, 'text');
          selection.focus.set(node.getKey(), offset, 'text');
          selection.insertText('—');
          return true;
        },
        COMMAND_PRIORITY_HIGH,
      ),
    [editor],
  );

  return null;
}

/** Converts a typed `--` pair into an em dash (except inside inline code). */
export const emDashPlugin = realmPlugin({
  init(realm) {
    realm.pub(addComposerChild$, EmDashComposer);
  },
});
