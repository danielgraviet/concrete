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
      if (text.includes('->')) node.setTextContent(text.replace(/->/g, '→'));
    }),
  [editor]);

  return null;
}

export const arrowPlugin = realmPlugin({
  init(realm) {
    realm.pub(addComposerChild$, ArrowComposer);
  },
});
