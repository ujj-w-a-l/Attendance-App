import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  return {
    plugins: [react(), tailwindcss()],
    define: {
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    build: {
      outDir: 'dist',
      // Ensure WASM files are not inlined so they can be fetched separately
      assetsInlineLimit: 0,
      rollupOptions: {
        output: {
          // Put sql.js in its own chunk. Otherwise esbuild's minifier
          // reuses short module-scope variable names (xs, $t, Yt, nl, …)
          // between React and sql.js's emscripten runtime, and one side
          // silently overwrites the other's globals. On Android that
          // corrupts sql.js's parameter binding (strings bind as NULL,
          // triggering "NOT NULL constraint failed").
          manualChunks(id) {
            if (id.includes('/sql.js/') || id.includes('\\sql.js\\')) {
              return 'sql-js';
            }
          },
        },
      },
    },
    optimizeDeps: {
      exclude: ['sql.js'],
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify -- file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      headers: {
        // Required for SharedArrayBuffer used by sql.js
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Cross-Origin-Embedder-Policy': 'require-corp',
      },
    },
  };
});
