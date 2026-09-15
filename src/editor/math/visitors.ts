import type { MdastImportVisitor, LexicalExportVisitor } from '@mdxeditor/editor';
import { $createMathNode, $isMathNode, type MathNode } from './MathNode';
import { sanitizeLatexEquals } from './normalizeMathMarkdown';

type InlineMathMdast = {
  type: 'inlineMath';
  value: string;
};

type MathMdast = {
  type: 'math';
  value: string;
  meta?: string | null;
};

/** `$...$` → inline KaTeX node */
export const MdastInlineMathVisitor: MdastImportVisitor<InlineMathMdast> = {
  testNode: 'inlineMath',
  visitNode({ mdastNode, actions }) {
    actions.addAndStepInto(
      $createMathNode(sanitizeLatexEquals(mdastNode.value), true),
    );
  },
};

/** `$$...$$` flow math → display KaTeX node (wrapped in a paragraph) */
export const MdastMathVisitor: MdastImportVisitor<MathMdast> = {
  testNode: 'math',
  visitNode({ mdastNode, actions }) {
    const math = $createMathNode(sanitizeLatexEquals(mdastNode.value), false);
    // A block MathNode is itself a valid top-level Lexical node. Wrapping it
    // in a paragraph causes MDXEditor to retain the importer-created wrapper,
    // which renders as duplicate math blocks.
    actions.addAndStepInto(math);
  },
};

export const LexicalMathVisitor: LexicalExportVisitor<
  MathNode,
  InlineMathMdast | MathMdast
> = {
  testLexicalNode: $isMathNode,
  visitLexicalNode({ lexicalNode, mdastParent, actions }) {
    if (lexicalNode.getInline()) {
      actions.appendToParent(mdastParent, {
        type: 'inlineMath',
        value: lexicalNode.getValue(),
      } as InlineMathMdast);
      return;
    }
    actions.appendToParent(mdastParent, {
      type: 'math',
      value: lexicalNode.getValue(),
      meta: null,
    } as MathMdast);
  },
};
