import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AiClient } from '../AiClient';
import { setBackendForTesting } from '../../backend';
import type { Backend } from '../../backend/types';
import type { VaultListResult } from '../../vault/types';
import { runWebVaultAgent } from './StudyChatPane';

afterEach(() => {
  setBackendForTesting(null);
});

describe('runWebVaultAgent', () => {
  it('executes move actions before returning a done response', async () => {
    const moves = [
      ['Stats/Comparing Models.md', 'Stats/Unit 2 — Model Selection/Comparing Models (Additional).md'],
      ['Stats/Quiz 2: Stat_220_Midterm_Practice.md', 'Stats/Unit 6 — Statistical Inference/Quiz 2: Stat_220_Midterm_Practice.md'],
      ['Stats/Quiz Stat_220_Midterm_Practice.md', 'Stats/Unit 6 — Statistical Inference/Quiz Stat_220_Midterm_Practice.md'],
      ['Stats/Practice_Resampling.pdf', 'Stats/Unit 1 — Statistical Foundations/Practice_Resampling (Additional).pdf'],
      ['Stats/Practice_Trees.pdf', 'Stats/Unit 5 — Beyond Linear Models/Practice_Trees (Additional).pdf'],
      ['Stats/Stat_220_Midterm_Practice.pdf', 'Stats/Unit 6 — Statistical Inference/Stat_220_Midterm_Practice (Additional).pdf'],
    ] as const;
    const tree: VaultListResult = {
      files: moves.filter(([from]) => from.endsWith('.md')).map(([from]) => from),
      pdfFiles: moves.filter(([from]) => from.endsWith('.pdf')).map(([from]) => from),
      folders: [
        'Stats',
        'Stats/Unit 1 — Statistical Foundations',
        'Stats/Unit 2 — Model Selection',
        'Stats/Unit 5 — Beyond Linear Models',
        'Stats/Unit 6 — Statistical Inference',
      ],
    };
    const vault = {
      list: vi.fn(async () => ({ ...tree, files: [...tree.files], pdfFiles: [...tree.pdfFiles], folders: [...tree.folders] })),
      rename: vi.fn(async (_root: string, from: string, to: string) => {
        const list = from.endsWith('.pdf') ? tree.pdfFiles : tree.files;
        list.splice(list.indexOf(from), 1, to);
        return to;
      }),
    };
    setBackendForTesting({ target: 'web', vault, capabilities: {} } as unknown as Backend);

    const plan = {
      done: true,
      actions: moves.map(([from, to]) => ({ type: 'move', from, to })),
      response: 'Moved all six files.',
    };
    const client = {
      chat: vi.fn().mockResolvedValue(`${JSON.stringify(plan)}\n${JSON.stringify({ requestId: 'metadata' })}`),
    } as unknown as AiClient;
    const result = await runWebVaultAgent({
      client,
      root: 'root',
      history: [{ role: 'user', content: 'Move these files.' }],
      signal: new AbortController().signal,
      onProgress: vi.fn(),
    });

    expect(vault.rename).toHaveBeenCalledTimes(6);
    for (const [from, to] of moves) expect(vault.rename).toHaveBeenCalledWith('root', from, to);
    expect(result.changed).toHaveLength(6);
    expect(result.response).toBe('Moved all six files.');
  });

  it('does not report a move as complete when the refreshed tree did not change', async () => {
    const vault = {
      list: vi.fn(async () => ({ files: ['Stats/Source.md'], pdfFiles: [], folders: ['Stats', 'Stats/Unit 1'] })),
      rename: vi.fn(async () => 'Stats/Unit 1/Source.md'),
    };
    setBackendForTesting({ target: 'web', vault, capabilities: {} } as unknown as Backend);
    const client = {
      chat: vi.fn().mockResolvedValue(JSON.stringify({
        done: true,
        actions: [{ type: 'move', from: 'Stats/Source.md', to: 'Stats/Unit 1/Source.md' }],
        response: 'Moved it.',
      })),
    } as unknown as AiClient;

    await expect(runWebVaultAgent({
      client,
      root: 'root',
      history: [{ role: 'user', content: 'Move the file.' }],
      signal: new AbortController().signal,
      onProgress: vi.fn(),
    })).rejects.toThrow('Move could not be verified: Stats/Source.md → Stats/Unit 1/Source.md');
  });
});
