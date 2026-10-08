import { describe, expect, it } from 'vitest';
import { asBlockquote, chatHistory } from './history';
import type { StudyChatMessage } from './threadStore';

const msg = (partial: Partial<StudyChatMessage> & Pick<StudyChatMessage, 'role' | 'text'>): StudyChatMessage => ({
  id: Math.random().toString(36),
  mode: 'chat',
  ...partial,
});

describe('chatHistory', () => {
  it('folds excerpts into the question and drops log and failed replies', () => {
    const history = chatHistory([
      msg({ role: 'user', text: 'What is entropy?', quote: 'S = k ln W' }),
      msg({ role: 'assistant', text: 'A count of microstates.' }),
      msg({ role: 'log', text: 'Thinking…', mode: 'agent' }),
      msg({ role: 'user', text: 'Why log?' }),
      msg({ role: 'assistant', text: 'network error', error: true }),
    ]);
    expect(history).toEqual([
      { role: 'user', content: 'About this part of my note:\n"""\nS = k ln W\n"""\n\nWhat is entropy?' },
      { role: 'assistant', content: 'A count of microstates.' },
      { role: 'user', content: 'Why log?' },
    ]);
  });

  it('marks note changes and agent requests so one session can span notes and modes', () => {
    const history = chatHistory([
      msg({ role: 'user', text: 'Explain this', notePath: 'A.md' }),
      msg({ role: 'assistant', text: 'Sure.' }),
      msg({ role: 'user', text: 'More', notePath: 'A.md' }),
      msg({ role: 'user', text: 'Add a summary', notePath: 'B.md', mode: 'agent' }),
      msg({ role: 'assistant', text: 'Done.', mode: 'agent' }),
    ]);
    expect(history.map((turn) => turn.content)).toEqual([
      '(Now viewing note: A.md)\n\nExplain this',
      'Sure.',
      'More',
      '(Now viewing note: B.md)\n\n(Sent to the editing agent)\n\nAdd a summary',
      'Done.',
    ]);
  });
});

describe('asBlockquote', () => {
  it('prefixes every line, keeping blank lines inside the quote', () => {
    expect(asBlockquote('One\n\n$$x^2$$\n')).toBe('> One\n>\n> $$x^2$$');
  });
});
