import {
  CodeBlock,
  HeadingBlock,
  ListBlock,
  ListItemBlock,
  ParagraphBlock,
  QuizCardBlock,
  QuoteBlock,
  TagBlock,
  ThematicBreakBlock,
  WikilinkBlock,
} from '../composite/blocks';
import type { BlockNode } from '../composite/BlockNode';
import {
  createId,
  type BlockCreateProps,
  type BlockType,
  type CodeProps,
  type HeadingLevel,
  type HeadingProps,
  type ListItemProps,
  type ListProps,
  type ParagraphProps,
  type QuizCardProps,
  type QuoteProps,
  type TagProps,
  type WikilinkProps,
} from '../types';

/** Factory for concrete block nodes. */
export class BlockFactory {
  static create(type: BlockType, props: BlockCreateProps = {}): BlockNode {
    switch (type) {
      case 'heading': {
        const p = props as HeadingProps;
        return new HeadingBlock(
          createId('h'),
          (p.level ?? 1) as HeadingLevel,
          p.text ?? '',
        );
      }
      case 'paragraph': {
        const p = props as ParagraphProps;
        return new ParagraphBlock(createId('p'), p.text ?? '');
      }
      case 'list': {
        const p = props as ListProps;
        const list = new ListBlock(createId('l'), p.ordered ?? false);
        for (const item of p.items ?? []) {
          list.add(new ListItemBlock(createId('li'), item));
        }
        return list;
      }
      case 'listItem': {
        const p = props as ListItemProps;
        return new ListItemBlock(
          createId('li'),
          p.text ?? '',
          p.checked ?? null,
        );
      }
      case 'quote': {
        const p = props as QuoteProps;
        return new QuoteBlock(createId('q'), p.text ?? '');
      }
      case 'code': {
        const p = props as CodeProps;
        return new CodeBlock(createId('c'), p.language ?? '', p.code ?? '');
      }
      case 'thematicBreak':
        return new ThematicBreakBlock(createId('hr'));
      case 'wikilink': {
        const p = props as WikilinkProps;
        return new WikilinkBlock(
          createId('w'),
          p.target ?? '',
          p.label ?? '',
        );
      }
      case 'tag': {
        const p = props as TagProps;
        return new TagBlock(createId('t'), p.name ?? '');
      }
      case 'quizCard': {
        const p = props as QuizCardProps;
        return new QuizCardBlock(
          createId('qc'),
          p.notePath ?? '',
          p.front ?? '',
          p.back ?? '',
          p.tags ?? [],
          p.createdAt ?? Date.now(),
        );
      }
      case 'document':
        throw new Error('Use Document.empty() for document roots');
      default: {
        const _exhaustive: never = type;
        throw new Error(`Unknown block type: ${_exhaustive}`);
      }
    }
  }
}
