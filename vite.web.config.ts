import { defineConfig, mergeConfig } from 'vite';
import baseConfig from './vite.config';

/**
 * Browser build of Concrete (`npm run dev:web` / `build:web`). Reuses the
 * desktop renderer config, then: absolute base path (served from a web origin,
 * not file://), `VITE_TARGET=web` so `src/backend` picks the web backend, and a
 * separate output dir so it never clobbers the Electron `dist/`.
 */
export default mergeConfig(
  baseConfig,
  defineConfig({
    base: '/',
    define: {
      'import.meta.env.VITE_TARGET': JSON.stringify('web'),
    },
    build: {
      outDir: 'dist-web',
      emptyOutDir: true,
    },
  }),
);
