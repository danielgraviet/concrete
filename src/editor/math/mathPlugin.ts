import {
  realmPlugin,
  addActivePlugin$,
  addImportVisitor$,
  addExportVisitor$,
  addLexicalNode$,
  addSyntaxExtension$,
  addMdastExtension$,
  addToMarkdownExtension$,
  addComposerChild$,
} from '@mdxeditor/editor';
import { math } from 'micromark-extension-math';
import { mathFromMarkdown, mathToMarkdown } from 'mdast-util-math';
import { MathNode } from './MathNode';
import {
  MdastInlineMathVisitor,
  MdastMathVisitor,
  LexicalMathVisitor,
} from './visitors';
import { MathShortcutComposer } from './MathShortcutComposer';

/**
 * `$inline$` and `$$display$$` math via micromark/mdast + KaTeX.
 */
export const mathPlugin = realmPlugin({
  init(realm) {
    realm.pubIn({
      [addActivePlugin$]: 'math',
      [addSyntaxExtension$]: math(),
      [addMdastExtension$]: mathFromMarkdown(),
      [addToMarkdownExtension$]: mathToMarkdown(),
      [addImportVisitor$]: [MdastInlineMathVisitor, MdastMathVisitor],
      [addExportVisitor$]: LexicalMathVisitor,
      [addLexicalNode$]: MathNode,
      [addComposerChild$]: MathShortcutComposer,
    });
  },
});
