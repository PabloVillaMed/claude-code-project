import { defineConfig } from 'vite';
import { serviceWorkerPlugin } from './scripts/web/vite-plugin-sw.js';

// Partes estables del JS: las librerías (three, postprocessing, n8ao) y el mapa
// (src/data/mapa.json, 2.9 MB) casi nunca cambian entre versiones; en archivos
// aparte conservan su nombre (hash del contenido) y el service worker, que
// compara la revisión de cada archivo, no las vuelve a bajar. Los exportadores
// de three (GLTFExporter) solo los usa el exportador de Unreal (import
// dinámico): se quedan en su chunk para no engordar el arranque.
const VENDOR = /[\\/]node_modules[\\/](three|postprocessing|n8ao)[\\/]/;
const SOLO_EXPORTADOR = /[\\/]examples[\\/]jsm[\\/]exporters[\\/]/;
const MAPA = /[\\/]src[\\/]data[\\/]mapa\.json$/;

// `base: './'` (rutas relativas) para que el mismo build funcione empaquetado
// dentro de Electron (app://juego/) y publicado bajo una subruta
// (GitHub Pages: /medellin-aranjuez/).
export default defineConfig({
  base: './',
  // Solo en `vite build`: escribe dist/sw.js con las listas de precarga.
  plugins: [serviceWorkerPlugin()],
  // JSON grande como JSON.parse('…') (más rápido de evaluar que un literal de
  // objeto). Solo se importan por defecto (mapa.json, package.json).
  json: { namedExports: false, stringify: true },
  build: {
    outDir: 'dist',
    target: 'es2022',
    chunkSizeWarningLimit: 3000, // el mapa (2.9 MB) va solo en su chunk
    assetsInlineLimit: 0,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: 'mapa', test: (id) => MAPA.test(id), priority: 2 },
            { name: 'vendor', test: (id) => VENDOR.test(id) && !SOLO_EXPORTADOR.test(id), priority: 1 },
          ],
        },
      },
    },
  },
  server: { port: 5173 },
});
