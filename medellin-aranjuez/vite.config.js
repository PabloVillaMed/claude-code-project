import { defineConfig } from 'vite';
import { serviceWorkerPlugin } from './scripts/web/vite-plugin-sw.js';

// `base: './'` (rutas relativas) para que el mismo build funcione empaquetado
// dentro de Electron (app://juego/) y publicado bajo una subruta
// (GitHub Pages: /medellin-aranjuez/).
export default defineConfig({
  base: './',
  // Solo en `vite build`: escribe dist/sw.js con las listas de precarga.
  plugins: [serviceWorkerPlugin()],
  build: {
    outDir: 'dist',
    target: 'es2022',
    chunkSizeWarningLimit: 2000,
    assetsInlineLimit: 0,
  },
  server: { port: 5173 },
});
