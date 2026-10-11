import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.js'],
    environment: 'node',
    // Generar el mapa real completo toma unos segundos la primera vez.
    testTimeout: 60000,
  },
});
