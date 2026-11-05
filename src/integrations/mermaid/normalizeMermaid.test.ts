import { describe, expect, it } from 'vitest';
import { normalizeMermaid } from './normalizeMermaid';

describe('normalizeMermaid', () => {
  it('escapes semicolons in sequence diagram messages and notes', () => {
    const src = [
      'sequenceDiagram',
      '    Runner->>Runner: Check capacity; prepare network',
      '    API-->>User: a; b',
      '    Note over A,B: one; two',
      '    participant A as Alpha',
    ].join('\n');
    expect(normalizeMermaid(src)).toBe([
      'sequenceDiagram',
      '    Runner->>Runner: Check capacity#59; prepare network',
      '    API-->>User: a#59; b',
      '    Note over A,B: one#59; two',
      '    participant A as Alpha',
    ].join('\n'));
  });

  it('leaves existing entity codes alone', () => {
    const src = 'sequenceDiagram\n    A->>B: x#59; y #quot;q#quot;';
    expect(normalizeMermaid(src)).toBe(src);
  });

  it('does not touch other diagram types', () => {
    const src = 'flowchart LR\n    A-->B; B-->C';
    expect(normalizeMermaid(src)).toBe(src);
  });
});
