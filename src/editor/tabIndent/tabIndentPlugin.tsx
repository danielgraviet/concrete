import { useEffect } from 'react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { addComposerChild$, realmPlugin } from '@mdxeditor/editor';
import { $isListItemNode } from '@lexical/list';
import { $findMatchingParent, $getNearestBlockElementAncestorOrThrow } from '@lexical/utils';
import {
  $getSelection,
  $isRangeSelection,
  COMMAND_PRIORITY_HIGH,
  KEY_TAB_COMMAND,
} from 'lexical';

function TabIndentComposer(): null {
  const [editor] = useLexicalComposerContext();

  useEffect(
    () =>
      editor.registerCommand(
        KEY_TAB_COMMAND,
        (event) => {
          if (event.shiftKey) return false;
          let selection = $getSelection();
          if (!$isRangeSelection(selection)) return false;
          let anchorNode = selection.anchor.getNode();
          // lists still nest like before
          if ($findMatchingParent(anchorNode, $isListItemNode)) return false;

          // padding indent doesn't save to markdown, so type a real tab instead
          event.preventDefault();
          if (!selection.isCollapsed()) {
            // text is selected, so indent from the start of the line
            let block = $getNearestBlockElementAncestorOrThrow(anchorNode);
            block.selectStart();
            selection = $getSelection();
            if (!$isRangeSelection(selection)) return true;
          }
          selection.insertText('\t');
          return true;
        },
        COMMAND_PRIORITY_HIGH,
      ),
    [editor],
  );

  return null;
}

export const tabIndentPlugin = realmPlugin({
  init(realm) {
    realm.pub(addComposerChild$, TabIndentComposer);
  },
});