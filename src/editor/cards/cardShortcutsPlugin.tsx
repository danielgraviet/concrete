import { useEffect } from 'react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { realmPlugin, addComposerChild$ } from '@mdxeditor/editor';
import {
  $getSelection,
  $isRangeSelection,
  $isTextNode,
  COMMAND_PRIORITY_HIGH,
  KEY_DOWN_COMMAND,
  type LexicalEditor,
} from 'lexical';

/** Wrap the selection in `{{…}}` (or insert an empty blank with the caret inside). */
export function insertClozeBlank(editor: LexicalEditor): void {
  editor.update(() => {
    const selection = $getSelection();
    if (!$isRangeSelection(selection)) return;
    const text = selection.getTextContent();
    if (text.includes('\n')) return;
    selection.insertText(`{{${text}}}`);
    if (!text) {
      // Step back inside the braces so the answer can be typed.
      const anchor = selection.anchor;
      const node = anchor.getNode();
      if ($isTextNode(node)) {
        const offset = Math.max(0, anchor.offset - 2);
        selection.setTextNodeRange(node, offset, node, offset);
      }
    }
  });
}

/** Turn the current line into a card: caret goes to the end followed by ` :: `. */
export function insertCardSeparator(editor: LexicalEditor): void {
  editor.update(() => {
    const selection = $getSelection();
    if (!$isRangeSelection(selection)) return;
    const block = selection.anchor.getNode().getTopLevelElement();
    const last = block?.getLastDescendant();
    if (last && $isTextNode(last)) {
      const end = last.getTextContentSize();
      selection.setTextNodeRange(last, end, last, end);
      const trimmed = last.getTextContent().replace(/\s+$/, '');
      if (trimmed.endsWith('::')) return;
      selection.insertText(last.getTextContent().endsWith(' ') ? ':: ' : ' :: ');
    } else {
      // Empty line: lay out ` :: ` and put the caret before it for the question.
      selection.insertText(' :: ');
      const node = selection.anchor.getNode();
      if ($isTextNode(node)) selection.setTextNodeRange(node, 0, node, 0);
    }
  });
}

/** ⌘⇧C: cloze blank from the selection · ⌘⇧K: start a `Question :: Answer` card on this line. */
function CardShortcuts(): null {
  const [editor] = useLexicalComposerContext();
  useEffect(
    () =>
      editor.registerCommand(
        KEY_DOWN_COMMAND,
        (event: KeyboardEvent) => {
          if (!(event.metaKey || event.ctrlKey) || !event.shiftKey || event.altKey) return false;
          const key = event.key.toLowerCase();
          if (key === 'c') {
            event.preventDefault();
            insertClozeBlank(editor);
            return true;
          }
          if (key === 'k') {
            event.preventDefault();
            insertCardSeparator(editor);
            return true;
          }
          return false;
        },
        COMMAND_PRIORITY_HIGH,
      ),
    [editor],
  );
  return null;
}

export const cardShortcutsPlugin = realmPlugin({
  init(realm) {
    realm.pub(addComposerChild$, CardShortcuts);
  },
});
