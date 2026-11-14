import { describe, expect, it } from 'vitest';
import { InMemoryCloudRepository } from '../cloud/memory/InMemoryCloudRepository';
import { createCloudVault } from './cloudVault';
import { createWebBackend } from './index';
import { InMemoryFiles } from './memoryFiles';

describe('web capabilities', () => {
  it('turns fileImport on only for a vault with file storage, never diskImport', () => {
    const backend = createWebBackend();
    expect(backend.capabilities.fileImport).toBe(false);
    const base = { repo: new InMemoryCloudRepository(), getWorkspaceId: () => 'u', installPageListeners: false, liveSync: false };
    const plain = createCloudVault(base);
    backend.vault = plain;
    expect(backend.capabilities.fileImport).toBe(false);
    const withFiles = createCloudVault({ ...base, files: new InMemoryFiles() });
    backend.vault = withFiles;
    expect(backend.capabilities.fileImport).toBe(true);
    expect(backend.capabilities.diskImport).toBe(false);
    plain.dispose();
    withFiles.dispose();
  });
});
