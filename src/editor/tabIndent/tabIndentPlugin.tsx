import { useEffect } from 'react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { addComposerChild$, realmPlugin } from '@mdxeditor/editor';
import { $isListItemNode, $isListNode, ListNode } from '@lexical/list';
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

  // Indenting under a numbered list copies the parent's type ('number'),
  // so a nested item restarts at "1." instead of becoming a sub-bullet like
  // most editors (Word, Docs, Notion) do. Force any list nested one level
  // inside a numbered list to render as bullets.
  useEffect(
    () =>
      editor.registerNodeTransform(ListNode, (node) => {
        const parentItem = node.getParent();
        if (!$isListItemNode(parentItem)) return;
        const outerList = parentItem.getParent();
        if (!$isListNode(outerList)) return;
        if (outerList.getListType() === 'number' && node.getListType() !== 'bullet') {
          node.setListType('bullet');
        }
      }),
    [editor],
  );

  return null;
}

export const tabIndentPlugin = realmPlugin({
  init(realm) {
    realm.pub(addComposerChild$, TabIndentComposer);
  },
});