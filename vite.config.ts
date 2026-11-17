import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

/**
 * The production build ships a strict CSP meta tag (see index.html).
 * Vite's dev server injects its own inline preamble for HMR, so the tag is
 * removed while serving and always present in the built app.
 */
function stripCspInDev() {
  return {
    name: 'strip-csp-in-dev',
    apply: 'serve' as const,
    transformIndexHtml(html: string) {
      return html.replace(/<meta[\s\S]*?Content-Security-Policy[\s\S]*?>/i, '');
    },
  };
}

export default defineConfig({
  // Relative base so the built index.html works from file:// inside Electron.
  base: './',
  plugins: [react(), stripCspInDev()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
  },
});
