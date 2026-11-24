/**
 * The real vault behind `QuizSourceStore`: desktop disk or web cloud storage,
 * both through the backend's vault API.
 */
import { getBackend } from '../backend';
import type { QuizSourceStore } from './quizSources';

/** Web uploads share the files service's per-file limit (proxy `MAX_FILE_MB`). */
export const WEB_MAX_STORED_SOURCE_BYTES = 20 * 1024 * 1024;

/**
 * `knownPaths` is the vault's current document list; it answers `exists`
 * without another listing round trip. `saveDocument` never overwrites, so a
 * stale list cannot clobber a file.
 */
export function createVaultSourceStore(root: string, knownPaths: () => Iterable<string>): QuizSourceStore {
  const vault = () => {
    const api = getBackend().vault;
    if (!api) throw new Error('Open a vault to add slide decks.');
    return api;
  };
  const saved = new Set<string>();
  return {
    async exists(path) {
      return saved.has(path) || [...knownPaths()].includes(path);
    },
    async saveFile(path, bytes) {
      const api = vault();
      if (!api.saveDocument) throw new Error('Restart Concrete to add slide decks.');
      await api.saveDocument(root, path, bytes);
      saved.add(path);
    },
    async readFile(path) {
      const api = vault();
      if (!api.readDocument) return null;
      try {
        return await api.readDocument(root, path);
      } catch {
        return null;
      }
    },
    async readData(key) {
      return (await vault().readData?.(root, key)) ?? null;
    },
    async writeData(key, text) {
      const api = vault();
      if (!api.writeData) throw new Error('Restart Concrete to add slide decks.');
      await api.writeData(root, key, text);
    },
  };
}

/** Storage limit for originals: none on desktop, the upload limit on web. */
export function maxStoredSourceBytes(): number | undefined {
  return getBackend().target === 'web' ? WEB_MAX_STORED_SOURCE_BYTES : undefined;
}
