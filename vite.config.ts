import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
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
