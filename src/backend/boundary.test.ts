import { describe, expect, it } from 'vitest';

/**
 * Only `src/backend/electron/` may touch the Electron preload globals; every
 * other module goes through `getBackend()` so a web build can swap them out.
 */
const SOURCES = import.meta.glob<string>('/src/**/*.{ts,tsx,js,jsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
});

const BRIDGE =
  /window\s*(?:\.\s*|\[\s*['"])(vault|ai|sandbox|systemClipboard|perf|integrations)\b/;
const ALLOWED = (path: string) =>
  path.startsWith('/src/backend/electron/')
  || path === '/src/vite-env.d.ts'
  || path === '/src/backend/boundary.test.ts';

describe('backend boundary', () => {
  it('sees the source tree', () => {
    expect(Object.keys(SOURCES)).toContain('/src/App.tsx');
    expect(Object.keys(SOURCES)).toContain('/src/backend/electron/index.ts');
  });

  it('keeps Electron bridge globals inside src/backend/electron', () => {
    const offenders: string[] = [];
    for (const [path, source] of Object.entries(SOURCES)) {
      if (ALLOWED(path)) continue;
      source.split('\n').forEach((line, index) => {
        if (BRIDGE.test(line)) offenders.push(`${path}:${index + 1}: ${line.trim()}`);
      });
    }
    expect(offenders, 'Use getBackend() from src/backend instead of window bridge globals').toEqual([]);
  });
});
