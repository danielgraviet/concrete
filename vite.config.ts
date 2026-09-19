import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { visualizer } from 'rollup-plugin-visualizer';

export default defineConfig({
  // Relative paths so the packaged Electron app can load from file://
  base: './',
  plugins: [
    react(),
    ...(process.env.ANALYZE === '1'
      ? [
          visualizer({
            filename: 'docs/bundle-stats.html',
            gzipSize: true,
            brotliSize: true,
            template: 'treemap',
          }),
        ]
      : []),
  ],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/@mdxeditor') || id.includes('node_modules/lexical')) {
            return 'editor';
          }
          if (id.includes('node_modules/katex') || id.includes('node_modules/rehype-katex')) {
            return 'katex';
          }
          if (id.includes('node_modules/@codemirror') || id.includes('node_modules/@lezer')) {
            return 'codemirror';
          }
          if (id.includes('node_modules/@radix-ui')) {
            return 'radix';
          }
        },
      },
    },
  },
  optimizeDeps: {
    include: [
      'lexical',
      '@lexical/list',
      '@lexical/rich-text',
      '@lexical/selection',
      '@lexical/react/LexicalComposerContext',
      '@lexical/react/LexicalTypeaheadMenuPlugin',
      '@mdxeditor/editor',
      '@mdxeditor/gurx',
    ],
  },
});
