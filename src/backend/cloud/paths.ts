/** Backend-neutral path helpers shared by every CloudRepository implementation. */

import { InvalidPathError } from './errors';

/** Normalize a vault-relative path: `\` → `/`, trim slashes, reject empty/`.`/`..` segments. */
export function normalizePath(raw: string): string {
  const path = String(raw ?? '')
    .replace(/\\/g, '/')
    .replace(/\/{2,}/g, '/')
    .replace(/^\/+|\/+$/g, '');
  if (!path) throw new InvalidPathError('Path is empty');
  if (path.split('/').some((part) => !part.trim() || part === '.' || part === '..')) {
    throw new InvalidPathError(`Invalid path "${raw}"`);
  }
  return path;
}

export function ensureMdExtension(path: string): string {
  return /\.md$/i.test(path) ? path : `${path}.md`;
}

/** `a/b/c.md` → `['a', 'a/b']`. */
export function ancestorFolders(path: string): string[] {
  const parts = path.split('/');
  const out: string[] = [];
  for (let i = 1; i < parts.length; i += 1) out.push(parts.slice(0, i).join('/'));
  return out;
}

/** True when `path` is strictly inside `folder`. */
export function isUnder(path: string, folder: string): boolean {
  return path.startsWith(`${folder}/`);
}

/** Replace the `from` prefix of `path` with `to` (path must equal or be under `from`). */
export function reprefix(path: string, from: string, to: string): string {
  return path === from ? to : `${to}${path.slice(from.length)}`;
}

/** Title used for a new note's default body: `Stats/Bayes.md` → `Bayes`. */
export function noteTitle(path: string): string {
  const base = path.split('/').pop() ?? path;
  return base.replace(/\.md$/i, '');
}

const encoder = new TextEncoder();

export function byteLength(text: string): number {
  return encoder.encode(text).length;
}

/**
 * Data keys (`.vault/srs.json`) contain `/` and `.`, which are illegal or
 * reserved in many id schemes (Firestore doc ids, URL segments). Encode to
 * `[A-Za-z0-9%-]` only — reversible, deterministic.
 */
export function encodeDataKey(key: string): string {
  if (!key) throw new InvalidPathError('Data key is empty');
  return encodeURIComponent(key).replace(
    /[._!~*'()]/g,
    (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`,
  );
}

export function decodeDataKey(encoded: string): string {
  return decodeURIComponent(encoded);
}
