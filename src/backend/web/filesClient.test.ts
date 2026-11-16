import { describe, expect, it, vi } from 'vitest';
import { FilesClient, FilesError, filesErrorFromBody } from './filesClient';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function makeClient(fetchImpl: typeof fetch, token: string | null = 'tok-1') {
  return new FilesClient({ baseUrl: 'https://proxy.test/', getIdToken: async () => token, fetch: fetchImpl });
}

describe('FilesClient', () => {
  it('PUTs raw bytes with the token, content type and encoded path', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, { path: 'A B/.attachments/x.png', size: 3, contentType: 'image/png', uploaded: 'now' }),
    );
    const client = makeClient(fetchImpl as unknown as typeof fetch);
    const info = await client.put('A B/.attachments/x.png', new Uint8Array([1, 2, 3]), 'image/png', { ifAbsent: true });
    expect(info.size).toBe(3);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://proxy.test/v1/files/A%20B%2F.attachments%2Fx.png?ifAbsent=1');
    expect(init.method).toBe('PUT');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok-1');
    expect((init.headers as Record<string, string>)['content-type']).toBe('image/png');
  });

  it('gets bytes and blobs', async () => {
    const fetchImpl = vi.fn(async () => new Response(new Uint8Array([7, 8]), { status: 200 }));
    const client = makeClient(fetchImpl as unknown as typeof fetch);
    expect(await client.getBytes('a.png')).toEqual(new Uint8Array([7, 8]));
    expect((await client.getBlob('a.png')).size).toBe(2);
  });

  it('lists with a prefix and returns the file array', async () => {
    const files = [{ path: 'A/x.pdf', size: 1, contentType: 'application/pdf', uploaded: 'now' }];
    const fetchImpl = vi.fn(async () => jsonResponse(200, { files, truncated: false }));
    const client = makeClient(fetchImpl as unknown as typeof fetch);
    expect(await client.list('A/')).toEqual(files);
    expect((fetchImpl.mock.calls[0] as unknown as [string])[0]).toBe('https://proxy.test/v1/files?prefix=A%2F');
  });

  it('repeats move and recursive remove while the server reports truncated', async () => {
    const replies = [
      jsonResponse(200, { moved: 100, truncated: true }),
      jsonResponse(200, { moved: 5, truncated: false }),
      jsonResponse(200, { deleted: 1000, truncated: true }),
      jsonResponse(200, { deleted: 2, truncated: false }),
    ];
    const fetchImpl = vi.fn(async () => replies.shift()!);
    const client = makeClient(fetchImpl as unknown as typeof fetch);
    expect(await client.move('A', 'B')).toBe(105);
    const [, moveInit] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(moveInit.body))).toEqual({ from: 'A', to: 'B' });
    expect(await client.remove('A', { recursive: true })).toBe(1002);
    expect((fetchImpl.mock.calls[2] as unknown as [string])[0]).toBe('https://proxy.test/v1/files/A?recursive=1');
  });

  it('reads storage usage', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, { usedBytes: 5, limitBytes: 10 }));
    expect(await makeClient(fetchImpl as unknown as typeof fetch).storage()).toEqual({ usedBytes: 5, limitBytes: 10 });
  });

  it('throws unauthorized without a token and never calls fetch', async () => {
    const fetchImpl = vi.fn();
    const client = makeClient(fetchImpl as unknown as typeof fetch, null);
    await expect(client.list()).rejects.toMatchObject({ name: 'FilesError', code: 'unauthorized' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('maps network failures to a files-specific message', async () => {
    const client = makeClient((async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch);
    const err = await client.getBytes('a.png').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(FilesError);
    expect((err as FilesError).code).toBe('network_error');
    expect((err as FilesError).message).toContain('file storage');
  });

  it('maps quota, size and type errors to friendly messages', async () => {
    const MB = 1024 * 1024;
    const quota = filesErrorFromBody(413, { error: 'storage_quota_exceeded', usedBytes: 99 * MB, limitBytes: 100 * MB });
    expect(quota.code).toBe('storage_quota_exceeded');
    expect(quota.usage).toEqual({ usedBytes: 99 * MB, limitBytes: 100 * MB });
    expect(quota.message).toBe(
      'Your file storage is full (99 MB of 100 MB). Delete some images or PDFs to make room.',
    );
    expect(filesErrorFromBody(413, { error: 'too_large', limitBytes: 20 * MB }).message).toBe('That file is larger than 20 MB.');
    expect(filesErrorFromBody(415, { error: 'unsupported_type' }).message).toContain('PDFs');
    expect(filesErrorFromBody(404, null).code).toBe('not_found');

    const client = makeClient((async () =>
      jsonResponse(413, { error: 'storage_quota_exceeded', usedBytes: 1, limitBytes: 2 })) as unknown as typeof fetch);
    await expect(client.put('a.png', new Uint8Array([1]), 'image/png')).rejects.toMatchObject({
      code: 'storage_quota_exceeded',
      status: 413,
    });
  });
});
