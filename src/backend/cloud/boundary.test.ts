/**
 * Architecture guard: Firebase is an implementation detail. Only files under
 * src/backend/cloud/firebase/ may import `firebase` / `firebase/*` /
 * `@firebase/*`, so swapping to Postgres touches one folder.
 */

import { describe, expect, it } from 'vitest';

// Node built-ins are loaded dynamically: the project's tsconfig has no Node
// types (it targets the browser), and pulling them in globally would change
// DOM typings (e.g. setTimeout) for the whole app.
interface DirEntry {
  name: string;
  isDirectory(): boolean;
}
interface NodeFs {
  readdirSync(dir: string, options: { withFileTypes: true }): DirEntry[];
  readFileSync(file: string, encoding: 'utf8'): string;
}
const nodeModule = (name: string): Promise<unknown> => import(/* @vite-ignore */ name);

const here = decodeURIComponent(new URL('.', import.meta.url).pathname).replace(/\/$/, '');
const srcRoot = here.replace(/\/backend\/cloud$/, '');
const allowedDir = `${here}/firebase/`;
const self = decodeURIComponent(new URL(import.meta.url).pathname);

// `import ... from 'firebase/x'`, `export ... from "firebase"`, `import('firebase/x')`, `require('@firebase/x')`.
const FIREBASE_IMPORT =
  /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s+)['"](?:@firebase\/[^'"]+|firebase(?:\/[^'"]*)?)['"]/;

function sourceFiles(fs: NodeFs, dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules') out.push(...sourceFiles(fs, full));
    } else if (/\.(?:[cm]?[jt]sx?)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

describe('cloud backend boundary', () => {
  it('detects firebase imports (self-check)', () => {
    expect(FIREBASE_IMPORT.test(`import { getAuth } from 'firebase/auth';`)).toBe(true);
    expect(FIREBASE_IMPORT.test(`export * from "firebase/app"`)).toBe(true);
    expect(FIREBASE_IMPORT.test(`const m = await import('firebase/firestore')`)).toBe(true);
    expect(FIREBASE_IMPORT.test(`import 'firebase/firestore';`)).toBe(true);
    expect(FIREBASE_IMPORT.test(`import x from '@firebase/util'`)).toBe(true);
    expect(FIREBASE_IMPORT.test(`import { x } from './firebase'`)).toBe(false);
    expect(FIREBASE_IMPORT.test(`import { x } from './backend/cloud/firebase/index'`)).toBe(false);
  });

  it('only src/backend/cloud/firebase/ imports the Firebase SDK', async () => {
    const fs = (await nodeModule('node:fs')) as NodeFs;
    const files = sourceFiles(fs, srcRoot);
    expect(files.length).toBeGreaterThan(50); // sanity: we really scanned src/
    const offenders = files
      .filter((file) => !file.startsWith(allowedDir) && file !== self)
      .filter((file) => FIREBASE_IMPORT.test(fs.readFileSync(file, 'utf8')))
      .map((file) => file.slice(srcRoot.length + 1));
    expect(offenders).toEqual([]);
  });
});
