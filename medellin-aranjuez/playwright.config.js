import { defineConfig } from '@playwright/test';

// En este contenedor se usa el Chromium preinstalado; en CI/Windows, el de Playwright.
const executablePath = process.env.PW_CHROMIUM || undefined;

// Tres proyectos sobre el mismo build (dist/):
//  - juego:  la partida completa con ?autotest (teclado, ratón, misiones…).
//  - web:    el sitio como queda en GitHub Pages, bajo la subruta
//            /claude-code-project/: manifiesto, service worker y sin conexión.
//  - tactil: un celular acostado (844×390) con pantalla táctil.
// `npm run test:e2e` corre los tres; `npm run test:e2e:web` solo web y táctil.
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 15 * 60 * 1000,
  expect: { timeout: 120000 },
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:4190',
    viewport: { width: 800, height: 450 },
    launchOptions: {
      executablePath,
      args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
    },
  },
  projects: [
    { name: 'juego', testMatch: 'gameplay.spec.js', use: { baseURL: 'http://localhost:4190' } },
    { name: 'web', testMatch: 'web.spec.js', use: { baseURL: 'http://localhost:4191/claude-code-project/' } },
    {
      name: 'tactil',
      testMatch: 'touch.spec.js',
      use: { baseURL: 'http://localhost:4190', viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1 },
    },
  ],
  webServer: [
    {
      command: 'node scripts/serve-cli.mjs --port=4190',
      url: 'http://localhost:4190',
      reuseExistingServer: true,
      timeout: 30000,
    },
    {
      // Como GitHub Pages: solo responde bajo /claude-code-project/.
      command: 'node scripts/serve-cli.mjs --port=4191 --base=/claude-code-project/',
      url: 'http://localhost:4191/claude-code-project/',
      reuseExistingServer: true,
      timeout: 30000,
    },
  ],
});
