import { describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { strToU8, zipSync } from 'fflate';
import {
  importNotionExport,
  inspectNotionExport,
  mergeImportedFrontmatter,
  pageMetadata,
  parseCsv,
  safeRelative,
} from './notionImport.cjs';

async function tempDirectory() {
  return mkdtemp(path.join(os.tmpdir(), 'concrete-notion-test-'));
}

describe('Notion import helpers', () => {
  it('parses CSV rows and merges Notion metadata into frontmatter', () => {
    expect(parseCsv('Name,Tags,Course\nPhysics,"mechanics, motion",STEM')).toEqual([
      { Name: 'Physics', Tags: 'mechanics, motion', Course: 'STEM' },
    ]);
    const metadata = pageMetadata('# Physics\nTags: waves\n\nA note.', {
      Name: 'Physics',
      Tags: 'mechanics, motion',
      Course: 'STEM',
    });
    expect(metadata.tags).toEqual(['waves', 'mechanics', 'motion']);
    expect(metadata.properties).toEqual({ Course: 'STEM' });
    expect(mergeImportedFrontmatter('# Physics\n\nA note.', metadata.tags, metadata.properties)).toContain(
      'tags: ["waves", "mechanics", "motion"]',
    );
  });

  it('rejects unsafe relative paths', () => {
    expect(safeRelative('../outside.md')).toBeNull();
    expect(safeRelative('/outside.md')).toBeNull();
    expect(safeRelative('Notes/Physics.md')).toBe('Notes/Physics.md');
  });
});

describe('importNotionExport', () => {
  it('imports folders, tags, CSV properties, and all visible files without overwriting', async () => {
    const source = await tempDirectory();
    const destination = await tempDirectory();
    await mkdir(path.join(source, 'Export', 'Notes'), { recursive: true });
    await writeFile(
      path.join(source, 'Export', 'Notes', 'Physics.md'),
      '# Physics\n\nTags: waves\n\n![diagram](diagram.png)\n',
    );
    await writeFile(
      path.join(source, 'Export', 'Notes', 'Database.csv'),
      'Name,Tags,Course\nPhysics,"mechanics, motion",STEM\n',
    );
    await writeFile(path.join(source, 'Export', 'Notes', 'diagram.png'), 'asset');
    await writeFile(path.join(source, 'Export', 'Notes', 'unused.png'), 'unused');
    await mkdir(path.join(destination, 'Notes'), { recursive: true });
    await writeFile(path.join(destination, 'Notes', 'Existing.md'), 'keep me');
    await writeFile(path.join(source, 'Export', 'Notes', 'Existing.md'), 'replace me');

    const result = await importNotionExport(path.join(source, 'Export'), destination);
    const physics = await readFile(path.join(destination, 'Notes', 'Physics.md'), 'utf8');

    expect(result.importedNotes).toEqual(['Notes/Physics.md']);
    expect(result.skippedNotes).toEqual(['Notes/Existing.md']);
    expect(result.preservedFiles).toEqual(['Notes/Database.csv', 'Notes/diagram.png', 'Notes/unused.png']);
    expect(result.copiedAssets).toEqual(['Notes/diagram.png', 'Notes/unused.png']);
    expect(result.skippedFiles).toEqual([]);
    expect(physics).toContain('tags: ["waves", "mechanics", "motion"]');
    expect(physics).toContain('Course: "STEM"');
    expect(existsSync(path.join(destination, 'Notes', 'diagram.png'))).toBe(true);
    expect(existsSync(path.join(destination, 'Notes', 'unused.png'))).toBe(true);
    expect(existsSync(path.join(destination, 'Notes', 'Database.csv'))).toBe(true);
    expect(await readFile(path.join(destination, 'Notes', 'Existing.md'), 'utf8')).toBe('keep me');
  });

  it('imports a downloaded ZIP export and preserves nested paths', async () => {
    const root = await tempDirectory();
    const zipPath = path.join(root, 'notion-export.zip');
    const destination = path.join(root, 'Concrete');
    await writeFile(zipPath, zipSync({
      'Notion Export/Projects/Launch.md': strToU8('# Launch\n\n#planning'),
    }));

    const result = await importNotionExport(zipPath, destination);
    expect(result.importedNotes).toEqual(['Projects/Launch.md']);
    expect(await readFile(path.join(destination, 'Projects', 'Launch.md'), 'utf8')).toContain('# Launch');
    await expect(stat(path.join(destination, 'Projects'))).resolves.toBeTruthy();
  });

  it('omits obvious empty/unreadable files and asks about uncertain links', async () => {
    const source = await tempDirectory();
    const destination = await tempDirectory();
    await writeFile(path.join(source, 'Good.md'), '# Good\n\nContent');
    await writeFile(path.join(source, 'Empty.md'), '');
    await writeFile(path.join(source, 'Broken.md'), Buffer.from([0xff, 0xfe, 0xfd]));
    await writeFile(path.join(source, 'Uncertain.md'), '[Missing](missing.pdf)');

    const inspection = await inspectNotionExport(source);
    expect(inspection.obvious).toEqual([
      { path: 'Broken.md', reason: 'Unreadable UTF-8 text in Broken.md' },
      { path: 'Empty.md', reason: 'empty file' },
    ]);
    expect(inspection.uncertain).toEqual([
      { path: 'Uncertain.md', reason: 'missing local link: missing.pdf' },
    ]);

    const kept = await importNotionExport(source, destination);
    expect(kept.removedFiles).toEqual(['Broken.md', 'Empty.md']);
    expect(kept.uncertainFilesKept).toEqual(['Uncertain.md']);
    expect(existsSync(path.join(destination, 'Good.md'))).toBe(true);
    expect(existsSync(path.join(destination, 'Uncertain.md'))).toBe(true);
    expect(existsSync(path.join(destination, 'Empty.md'))).toBe(false);
    expect(existsSync(path.join(source, 'Empty.md'))).toBe(true);

    const cautious = await importNotionExport(source, path.join(destination, 'cautious'), { uncertainAction: 'remove' });
    expect(cautious.removedFiles).toEqual(['Broken.md', 'Empty.md', 'Uncertain.md']);
    expect(cautious.uncertainFilesKept).toEqual([]);
    expect(existsSync(path.join(destination, 'cautious', 'Uncertain.md'))).toBe(false);
  });
});
