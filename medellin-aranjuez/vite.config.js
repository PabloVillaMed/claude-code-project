import { defineConfig } from 'vite';

// `base: './'` para que el build funcione empaquetado dentro de Electron.
export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    target: 'es2022',
    chunkSizeWarningLimit: 2000,
    assetsInlineLimit: 0,
  },
  server: { port: 5173 },
});
