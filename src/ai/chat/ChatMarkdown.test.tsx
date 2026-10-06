import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ChatMarkdown, normalizeChatMarkdown } from './ChatMarkdown';

describe('ChatMarkdown', () => {
  it('renders LaTeX delimiters models emit as KaTeX', () => {
    const html = renderToStaticMarkup(
      <ChatMarkdown text={'Inline \\(a^2\\) and display:\n\n\\[E = mc^2\\]'} />,
    );
    expect(html).toContain('class="katex"');
    expect(html).toContain('katex-display');
    expect(html).not.toContain('\\[');
  });

  it('wraps each top-level block with an insert button when insertion is enabled', () => {
    const text = 'Intro paragraph.\n\n$$\\int_0^1 x\\,dx$$\n\n- one\n- two\n\n```python\nprint(1)\n```';
    const withInsert = renderToStaticMarkup(<ChatMarkdown text={text} onInsertBlock={() => {}} />);
    expect(withInsert.match(/class="chat-block"/g)).toHaveLength(4);
    expect(withInsert.match(/chat-block-insert/g)).toHaveLength(4);

    const readOnly = renderToStaticMarkup(<ChatMarkdown text={text} />);
    expect(readOnly).not.toContain('chat-block-insert');
  });

  it('normalizes math the same way the editor imports it', () => {
    expect(normalizeChatMarkdown('\\[x\\]')).toBe('$$\nx\n$$');
  });
});
