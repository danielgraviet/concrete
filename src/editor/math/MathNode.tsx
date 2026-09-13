import {
  DecoratorNode,
  type DOMConversionMap,
  type DOMExportOutput,
  type EditorConfig,
  type LexicalNode,
  type NodeKey,
  type SerializedLexicalNode,
  type Spread,
} from 'lexical';
import type { JSX } from 'react';
import { MathEditor } from './MathEditor';

export type SerializedMathNode = Spread<
  {
    type: 'math';
    version: 1;
    value: string;
    inline: boolean;
  },
  SerializedLexicalNode
>;

export class MathNode extends DecoratorNode<JSX.Element> {
  __value: string;
  __inline: boolean;

  static getType(): string {
    return 'math';
  }

  static clone(node: MathNode): MathNode {
    return new MathNode(node.__value, node.__inline, node.__key);
  }

  constructor(value: string, inline: boolean, key?: NodeKey) {
    super(key);
    this.__value = value;
    this.__inline = inline;
  }

  createDOM(_config: EditorConfig): HTMLElement {
    const element = document.createElement(this.__inline ? 'span' : 'div');
    element.className = this.__inline ? 'mv-math mv-math-inline' : 'mv-math mv-math-block';
    return element;
  }

  updateDOM(prev: MathNode): boolean {
    return prev.__inline !== this.__inline;
  }

  static importJSON(serialized: SerializedMathNode): MathNode {
    return $createMathNode(serialized.value, serialized.inline);
  }

  exportJSON(): SerializedMathNode {
    return {
      type: 'math',
      version: 1,
      value: this.__value,
      inline: this.__inline,
    };
  }

  static importDOM(): DOMConversionMap | null {
    return null;
  }

  exportDOM(): DOMExportOutput {
    const element = document.createElement(this.__inline ? 'span' : 'div');
    element.className = this.__inline ? 'mv-math mv-math-inline' : 'mv-math mv-math-block';
    element.textContent = this.__inline
      ? `$${this.__value}$`
      : `$$${this.__value}$$`;
    return { element };
  }

  isInline(): boolean {
    return this.__inline;
  }

  isKeyboardSelectable(): boolean {
    return true;
  }

  getValue(): string {
    return this.__value;
  }

  setValue(value: string): void {
    const writable = this.getWritable();
    writable.__value = value;
  }

  getInline(): boolean {
    return this.__inline;
  }

  decorate(): JSX.Element {
    return (
      <MathEditor
        value={this.__value}
        inline={this.__inline}
        nodeKey={this.getKey()}
      />
    );
  }
}

export function $createMathNode(value: string, inline: boolean): MathNode {
  return new MathNode(value, inline);
}

export function $isMathNode(
  node: LexicalNode | null | undefined,
): node is MathNode {
  return node instanceof MathNode;
}
