import type { MdastImportVisitor, LexicalExportVisitor } from '@mdxeditor/editor';
import { $createParagraphNode } from 'lexical';
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
  visitNode({ mdastNode, lexicalParent }) {
    const math = $createMathNode(sanitizeLatexEquals(mdastNode.value), false);
    const paragraph = $createParagraphNode();
    paragraph.append(math);
    // Flow math always lands as its own paragraph under root / current parent.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (lexicalParent as any).append(paragraph);
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
