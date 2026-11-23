import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/postcss';
import { defineConfig, Plugin } from 'vite';

const root = path.dirname(fileURLToPath(import.meta.url));

// Files from public/ that the app needs before it can render anything offline.
const STATIC_SHELL = ['./manifest.webmanifest', './favicon.ico', './favicon-32.png', './favicon-192.png'];

// Fills sw-template.js in with the hashed asset names this build produced, so
// the shell can be precached by exact URL.
function serviceWorker(): Plugin {
  return {
    name: 'folio-service-worker',
    apply: 'build',
    generateBundle(_options, bundle) {
      const assets = Object.keys(bundle).filter((name) => !name.endsWith('.html')).map((name) => `./${name}`);
      const template = readFileSync(path.join(root, 'sw-template.js'), 'utf8');
      this.emitFile({
        type: 'asset',
        fileName: 'sw.js',
        source: template
          .replace('__BUILD_ID__', Date.now().toString(36))
          .replace('__SHELL__', JSON.stringify(['./index.html', ...assets, ...STATIC_SHELL])),
      });
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [react(), serviceWorker()],
  css: { postcss: { plugins: [tailwindcss()] } },
  resolve: { alias: { '@': root } },
  build: { outDir: 'pages-dist', emptyOutDir: true },
});
