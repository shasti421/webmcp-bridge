import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

/**
 * Chrome extension Vite config.
 *
 * Content script, service worker, and tool injector are built as
 * self-contained IIFE bundles (no code-splitting) because Chrome
 * runs them in isolated contexts. The panel is built as a standard
 * HTML entry with ES module output.
 */
export default defineConfig({
  plugins: [react()],
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    minify: false,
    rollupOptions: {
      input: {
        'content-script': resolve(__dirname, 'src/content-script/index.ts'),
        'service-worker': resolve(__dirname, 'src/service-worker/index.ts'),
        'tool-injector': resolve(__dirname, 'src/tool-injector/index.ts'),
        panel: resolve(__dirname, 'panel.html'),
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
        // Inline all dynamic imports so content-script and service-worker
        // are self-contained (Chrome can't load chunks in these contexts)
        inlineDynamicImports: false,
        // Ensure side-effect code is preserved (bootstrap calls)
        preserveModules: false,
      },
      // chrome global APIs shouldn't be bundled
      external: ['chrome'],
      // Prevent tree-shaking of bootstrap side effects
      treeshake: {
        moduleSideEffects: true,
      },
    },
  },
});
