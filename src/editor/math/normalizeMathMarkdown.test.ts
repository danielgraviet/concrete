import { describe, expect, it } from 'vitest';
import { escapeCurrencyDollars } from './normalizeMathMarkdown';

describe('escapeCurrencyDollars', () => {
  it('escapes prices that would pair into one formula', () => {
    expect(escapeCurrencyDollars('fell from about +$53k alone to about +$23.5k when')).toBe(
      'fell from about +\\$53k alone to about +\\$23.5k when',
    );
    expect(escapeCurrencyDollars('- drops from about $53k to $23.5k.')).toBe('- drops from about \\$53k to \\$23.5k.');
  });

  it('keeps real inline and display math', () => {
    const md = 'Let $x^2$ and $y$ cost $5, then $$a+b$$ holds.\n$$\nc $ d\n$$';
    expect(escapeCurrencyDollars(md)).toBe('Let $x^2$ and $y$ cost \\$5, then $$a+b$$ holds.\n$$\nc $ d\n$$');
  });

  it('leaves code and already-escaped dollars alone', () => {
    const md = 'Run `echo $HOME` for \\$5.\n```sh\necho $1 $2\n```';
    expect(escapeCurrencyDollars(md)).toBe(md);
  });
});
