import { describe, expect, it, vi } from 'vitest';
import { create, resolveTarget, shellQuote } from './daytonaRunner.cjs';

type SessionResponse = { exitCode?: number; stdout?: string; stderr?: string };

/** Fake @daytonaio/sdk: records sandbox creation and answers session commands. */
function fakeSdk(respond: (command: string) => SessionResponse | Promise<SessionResponse>) {
  const created: Array<Record<string, unknown>> = [];
  const deleted = vi.fn();
  const uploads: Array<{ path: string; body: string }> = [];
  const commands: string[] = [];
  const sandbox = {
    delete: deleted,
    fs: {
      uploadFile: async (file: Buffer, path: string) => {
        uploads.push({ path, body: file.toString('utf8') });
      },
    },
    process: {
      executeCommand: async () => ({ exitCode: 0, result: '' }),
      createSession: async () => {},
      deleteSession: async () => {},
      executeSessionCommand: async (_session: string, req: { command: string }) => {
        commands.push(req.command);
        return respond(req.command);
      },
    },
  };
  class Daytona {
    constructor(readonly config: { apiKey: string }) {}
    async create(params: Record<string, unknown>) {
      created.push({ ...params, apiKey: this.config.apiKey });
      return sandbox;
    }
  }
  return { loadSdk: () => ({ Daytona }), created, deleted, uploads, commands };
}

const withKey = () => 'test-key';

describe('daytona runner', () => {
  it('maps languages and aliases to a file and command', () => {
    expect(resolveTarget('py')).toMatchObject({ file: 'main.py', command: 'python3 -B main.py' });
    expect(resolveTarget('JS')).toMatchObject({ file: 'main.js', command: 'node main.js' });
    expect(resolveTarget('ts')).toMatchObject({ file: 'main.ts', command: 'node main.ts' });
    expect(resolveTarget('ruby')).toBeNull();
  });

  it('single-quotes shell arguments, escaping embedded quotes', () => {
    expect(shellQuote("it's")).toBe(`'it'\\''s'`);
  });

  it('runs a snippet in a network-blocked, ephemeral sandbox and keeps streams separate', async () => {
    const sdk = fakeSdk(() => ({ exitCode: 0, stdout: '42\n', stderr: 'warning\n' }));
    const runner = create({ apiKey: withKey, loadSdk: sdk.loadSdk });
    const result = await runner.run({ language: 'python', code: 'print(42)', timeoutMs: 5000 });

    expect(result).toMatchObject({ ok: true, stdout: '42\n', stderr: 'warning\n', exitCode: 0, timedOut: false });
    expect(sdk.created).toEqual([
      expect.objectContaining({ apiKey: 'test-key', ephemeral: true, networkBlockAll: true }),
    ]);
    expect(sdk.uploads[0]).toMatchObject({ body: 'print(42)' });
    expect(sdk.uploads[0].path).toBe('/tmp/concrete/main.py');
    expect(sdk.commands[0]).toContain('timeout 5 ');
  });

  it('gives every run a fresh sandbox and deletes it when the run is done', async () => {
    const sdk = fakeSdk(() => ({ exitCode: 0, stdout: '' }));
    const runner = create({ apiKey: withKey, loadSdk: sdk.loadSdk });
    await runner.run({ language: 'js', code: '1' });
    await runner.run({ language: 'ts', code: '2' });
    expect(sdk.created).toHaveLength(2);
    expect(sdk.deleted).toHaveBeenCalledTimes(2);
    expect(sdk.created[0]).toMatchObject({ autoStopInterval: 1, ttlMinutes: 10 });
  });

  it('deletes the sandbox when the run fails or times out', async () => {
    const sdk = fakeSdk(() => ({ exitCode: 124 }));
    await create({ apiKey: withKey, loadSdk: sdk.loadSdk }).run({ language: 'py', code: 'while True: pass' });
    expect(sdk.deleted).toHaveBeenCalledTimes(1);
  });

  it('reports the timeout exit status as a timeout', async () => {
    const sdk = fakeSdk(() => ({ exitCode: 124, stdout: '' }));
    const result = await create({ apiKey: withKey, loadSdk: sdk.loadSdk }).run({ language: 'py', code: 'while True: pass', timeoutMs: 2000 });
    expect(result).toMatchObject({ ok: false, timedOut: true, exitCode: null, error: 'Timed out after 2s' });
  });

  it('explains missing Python modules', async () => {
    const sdk = fakeSdk(() => ({ exitCode: 1, stderr: "ModuleNotFoundError: No module named 'torch'" }));
    const result = await create({ apiKey: withKey, loadSdk: sdk.loadSdk }).run({ language: 'py', code: 'import torch' });
    expect(result.error).toMatch(/"torch" isn't installed/);
  });

  it('retries once on a fresh sandbox when the warm one fails', async () => {
    let calls = 0;
    const sdk = fakeSdk(() => {
      calls += 1;
      if (calls === 1) throw new Error('sandbox not found');
      return { exitCode: 0, stdout: 'ok' };
    });
    const result = await create({ apiKey: withKey, loadSdk: sdk.loadSdk }).run({ language: 'py', code: 'print("ok")' });
    expect(result).toMatchObject({ ok: true, stdout: 'ok' });
    expect(sdk.created).toHaveLength(2);
    expect(sdk.deleted).toHaveBeenCalledTimes(2);
  });

  it('does not retry auth failures', async () => {
    class DaytonaAuthenticationError extends Error {}
    const sdk = fakeSdk(() => {
      throw new DaytonaAuthenticationError('401');
    });
    const result = await create({ apiKey: withKey, loadSdk: sdk.loadSdk }).run({ language: 'py', code: '1' });
    expect(result).toMatchObject({ ok: false, error: 'Daytona rejected the API key. Check it in Settings → Code execution.' });
    expect(sdk.created).toHaveLength(1);
  });

  it('is unavailable without a key and never contacts Daytona', async () => {
    const sdk = fakeSdk(() => ({ exitCode: 0 }));
    const runner = create({ apiKey: () => null, loadSdk: sdk.loadSdk });
    expect(await runner.status()).toMatchObject({ available: false });
    expect(await runner.run({ language: 'py', code: '1' })).toMatchObject({ ok: false, error: expect.stringMatching(/No Daytona API key/) });
    expect(sdk.created).toHaveLength(0);
  });

  it('deletes a still-running sandbox on dispose (app quit)', async () => {
    let finish: (value: SessionResponse) => void = () => {};
    const sdk = fakeSdk(() => new Promise<SessionResponse>((resolve) => { finish = resolve; }));
    const runner = create({ apiKey: withKey, loadSdk: sdk.loadSdk });
    const running = runner.run({ language: 'py', code: 'input()' });
    await vi.waitFor(() => expect(sdk.commands).toHaveLength(1));
    runner.dispose();
    expect(sdk.deleted).toHaveBeenCalledTimes(1);
    finish({ exitCode: 0 });
    await running;
  });
});
