import { useEffect } from 'react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { realmPlugin, addComposerChild$ } from '@mdxeditor/editor';
import { $isTextNode, TextNode } from 'lexical';

/** Converts the common ASCII arrow into one readable Unicode arrow. */
export function ArrowComposer(): null {
  const [editor] = useLexicalComposerContext();

  useEffect(() =>
    editor.registerNodeTransform(TextNode, (node) => {
      if (!$isTextNode(node)) return;
      const text = node.getTextContent();
      // Splicing the text preserves Lexical's selection offsets. Replacing the
      // whole node with setTextContent resets the caret to the start of it.
      const arrows = [...text.matchAll(/->|<-/g)];
      for (let matchIndex = arrows.length - 1; matchIndex >= 0; matchIndex -= 1) {
        const match = arrows[matchIndex];
        node.spliceText(match.index, 2, match[0] === '<-' ? '←' : '→', true);
      }
    }),
  [editor]);

  return null;
}

export const arrowPlugin = realmPlugin({
  init(realm) {
    realm.pub(addComposerChild$, ArrowComposer);
  },
});
