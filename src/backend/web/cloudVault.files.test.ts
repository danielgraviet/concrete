import { describe, expect, it, vi } from 'vitest';
import { InMemoryCloudRepository } from '../cloud/memory/InMemoryCloudRepository';
import { createCloudVault } from './cloudVault';
import { InMemoryFiles } from './memoryFiles';

const WS = 'u1';
const ROOT = 'cloud:u1';
const png = new Uint8Array([137, 80, 78, 71]);

function setup(opts: { pickFile?: (accept: string) => Promise<File | null> } = {}) {
  const repo = new InMemoryCloudRepository();
  const files = new InMemoryFiles();
  const extract = vi.fn(async () => ({ pages: ['p1'], totalPages: 1 }));
  const vault = createCloudVault({
    repo,
    getWorkspaceId: () => WS,
    installPageListeners: false,
    liveSync: false,
    files,
    pickFile: opts.pickFile,
    extractPdfPages: extract,
  });
  return { repo, files, vault, extract };
}

describe('createCloudVault with file storage', () => {
  it('saves images to .attachments beside the note with desktop-style naming', async () => {
    const { vault, files } = setup();
    expect(await vault.saveImage!(ROOT, 'Stats/Bayes.md', png, 'image/png', 'My Plot!.png')).toBe('.attachments/My-Plot.png');
    expect(await vault.saveImage!(ROOT, 'Stats/Other.md', png, 'image/png', 'My Plot!.png')).toBe('.attachments/My-Plot-2.png');
    expect(await vault.saveImage!(ROOT, 'Root.md', png, '', 'shot.JPEG')).toBe('.attachments/shot.jpeg');
    expect(await vault.saveImage!(ROOT, 'Root.md', png, 'image/webp', '')).toBe('.attachments/image.webp');
    expect([...files.entries.keys()].sort()).toEqual([
      '.attachments/image.webp',
      '.attachments/shot.jpeg',
      'Stats/.attachments/My-Plot-2.png',
      'Stats/.attachments/My-Plot.png',
    ]);
    expect(files.entries.get('.attachments/shot.jpeg')?.contentType).toBe('image/jpeg');
    await expect(vault.saveImage!(ROOT, 'A.md', png, 'text/html', 'x.html')).rejects.toThrow('Unsupported image type.');
    await expect(vault.saveImage!(ROOT, 'A.md', new Uint8Array(8 * 1024 * 1024 + 1), 'image/png', 'big.png')).rejects.toThrow('8 MB');
    vault.dispose();
  });

  it('tries the next name when the upload races an existing file', async () => {
    const { vault, files } = setup();
    await files.put('.attachments/a.png', png, 'image/png');
    vi.spyOn(files, 'list').mockResolvedValueOnce([]);
    expect(await vault.saveImage!(ROOT, 'N.md', png, 'image/png', 'a.png')).toBe('.attachments/a-2.png');
    vault.dispose();
  });

  it('reads images relative to the note as cached data URLs, with desktop fallbacks', async () => {
    const { vault, files } = setup();
    await files.put('Stats/.attachments/a b.png', png, 'image/png');
    await files.put('img/up.svg', new TextEncoder().encode('<svg/>'), 'image/svg+xml');
    const spy = vi.spyOn(files, 'getBytes');
    const url = await vault.readImageDataUrl!(ROOT, 'Stats/Bayes.md', '.attachments/a%20b.png');
    expect(url).toBe(`data:image/png;base64,${btoa(String.fromCharCode(...png))}`);
    expect(await vault.readImageDataUrl!(ROOT, 'Stats/Bayes.md', '<.attachments/a b.png>')).toBe(url);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(await vault.readImageDataUrl!(ROOT, 'Stats/Bayes.md', '../img/up.svg')).toMatch(/^data:image\/svg\+xml;base64,/);
    expect(await vault.readImageDataUrl!(ROOT, 'A.md', 'https://x.test/a.png')).toBe('');
    expect(await vault.readImageDataUrl!(ROOT, 'A.md', 'data:image/png;base64,AA')).toBe('');
    expect(await vault.readImageDataUrl!(ROOT, 'A.md', '../../etc/passwd')).toBe('');
    expect(await vault.readImageDataUrl!(ROOT, 'A.md', '.attachments/missing.png')).toBe('');
    vault.dispose();
  });

  it('returns a just-saved image without fetching it', async () => {
    const { vault, files } = setup();
    const src = await vault.saveImage!(ROOT, 'N.md', png, 'image/png', 'p.png');
    const spy = vi.spyOn(files, 'getBytes');
    expect(await vault.readImageDataUrl!(ROOT, 'N.md', src)).toMatch(/^data:image\/png;base64,/);
    expect(spy).not.toHaveBeenCalled();
    vault.dispose();
  });

  it('retries an image after a transient failure', async () => {
    const { vault, files } = setup();
    await files.put('.attachments/a.png', png, 'image/png');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(files, 'getBytes').mockRejectedValueOnce(new Error('offline'));
    expect(await vault.readImageDataUrl!(ROOT, 'N.md', '.attachments/a.png')).toBe('');
    expect(await vault.readImageDataUrl!(ROOT, 'N.md', '.attachments/a.png')).toMatch(/^data:image\/png/);
    warn.mockRestore();
    vault.dispose();
  });

  it('lists PDFs (and their folders) on open with one files call', async () => {
    const { vault, files, repo } = setup();
    await repo.writeNote(WS, 'A.md', 'a');
    await files.put('Papers/Deep/x.pdf', png, 'application/pdf');
    await files.put('Papers/.attachments/i.png', png, 'image/png');
    const spy = vi.spyOn(files, 'list');
    const result = await vault.open();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ root: ROOT, files: ['A.md'], pdfFiles: ['Papers/Deep/x.pdf'], folders: ['Papers', 'Papers/Deep'] });
    vault.dispose();
  });

  it('still lists the tree when file storage is down', async () => {
    const { vault, files } = setup();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(files, 'list').mockRejectedValue(new Error('down'));
    expect((await vault.list(ROOT)).pdfFiles).toEqual([]);
    warn.mockRestore();
    vault.dispose();
  });

  it('reads PDF bytes and extracts text with the 500 page cap', async () => {
    const { vault, files, extract } = setup();
    await files.put('Doc.pdf', png, 'application/pdf');
    expect(await vault.readPdf!(ROOT, 'Doc.pdf')).toEqual(png);
    await expect(vault.readPdf!(ROOT, 'Doc.png')).rejects.toThrow('Not a PDF file');
    expect(await vault.extractPdfText(ROOT, 'Doc.pdf')).toEqual({ pages: ['p1'], totalPages: 1 });
    expect(extract).toHaveBeenCalledWith(png, 500);
    vault.dispose();
  });

  it('imports a picked PDF into the folder without overwriting', async () => {
    const pdf = () => new File([png], 'Lecture 1.pdf', { type: 'application/pdf' });
    const picks: (File | null)[] = [pdf(), pdf(), null, new File(['x'], 'notes.txt', { type: 'text/plain' })];
    const accepts: string[] = [];
    const { vault, files } = setup({
      pickFile: async (accept) => {
        accepts.push(accept);
        return picks.shift() ?? null;
      },
    });
    expect(await vault.importFile(ROOT, 'Course')).toBe('Course/Lecture 1.pdf');
    expect(await vault.importFile(ROOT, 'Course')).toBe('Course/Lecture 1 2.pdf');
    expect(await vault.importFile(ROOT, 'Course')).toBeNull();
    await expect(vault.importFile(ROOT, '')).rejects.toThrow('Only PDF files');
    expect(accepts[0]).toContain('application/pdf');
    expect(files.entries.get('Course/Lecture 1.pdf')?.contentType).toBe('application/pdf');
    expect((await vault.list(ROOT)).pdfFiles).toEqual(['Course/Lecture 1 2.pdf', 'Course/Lecture 1.pdf']);
    vault.dispose();
  });

  it('renames and deletes PDFs through file storage only', async () => {
    const { vault, files, repo } = setup();
    await files.put('Doc.pdf', png, 'application/pdf');
    await vault.list(ROOT);
    const renameSpy = vi.spyOn(repo, 'rename');
    expect(await vault.rename(ROOT, 'Doc.pdf', 'Folder/Paper')).toBe('Folder/Paper.pdf');
    expect(renameSpy).not.toHaveBeenCalled();
    expect([...files.entries.keys()]).toEqual(['Folder/Paper.pdf']);
    expect(await vault.delete(ROOT, 'Folder/Paper.pdf')).toBe(true);
    expect(files.entries.size).toBe(0);
    vault.dispose();
  });

  it('moves and deletes attachments and PDFs with their folder', async () => {
    const { vault, files, repo } = setup();
    await repo.writeNote(WS, 'Stats/A.md', 'a');
    await files.put('Stats/.attachments/x.png', png, 'image/png');
    await files.put('Stats/Doc.pdf', png, 'application/pdf');
    await files.put('Statsy/keep.pdf', png, 'application/pdf');
    await vault.list(ROOT);
    expect(await vault.rename(ROOT, 'Stats', 'Math/Stats')).toBe('Math/Stats');
    expect([...files.entries.keys()].sort()).toEqual(['Math/Stats/.attachments/x.png', 'Math/Stats/Doc.pdf', 'Statsy/keep.pdf']);
    expect(await vault.readImageDataUrl!(ROOT, 'Math/Stats/A.md', '.attachments/x.png')).toMatch(/^data:image\/png/);
    await vault.delete(ROOT, 'Math');
    expect([...files.entries.keys()]).toEqual(['Statsy/keep.pdf']);
    expect(await repo.readNote(WS, 'Math/Stats/A.md')).toBeNull();
    vault.dispose();
  });

  it('renames and deletes folders that only hold PDFs', async () => {
    const { vault, files } = setup();
    await files.put('Only/x.pdf', png, 'application/pdf');
    await vault.list(ROOT);
    expect(await vault.rename(ROOT, 'Only', 'Moved')).toBe('Moved');
    expect([...files.entries.keys()]).toEqual(['Moved/x.pdf']);
    expect(await vault.delete(ROOT, 'Moved')).toBe(true);
    expect(files.entries.size).toBe(0);
    vault.dispose();
  });

  it('never blocks a folder operation when file storage fails', async () => {
    const { vault, files, repo } = setup();
    await repo.writeNote(WS, 'F/A.md', 'a');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(files, 'move').mockRejectedValue(new Error('down'));
    vi.spyOn(files, 'remove').mockRejectedValue(new Error('down'));
    expect(await vault.rename(ROOT, 'F', 'G')).toBe('G');
    expect(await vault.delete(ROOT, 'G')).toBe(true);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
    vault.dispose();
  });

  it('does not touch file storage for a single note rename', async () => {
    const { vault, files, repo } = setup();
    await repo.writeNote(WS, 'A.md', 'a');
    const spy = vi.spyOn(files, 'move');
    expect(await vault.rename(ROOT, 'A.md', 'B')).toBe('B.md');
    expect(spy).not.toHaveBeenCalled();
    vault.dispose();
  });
});
