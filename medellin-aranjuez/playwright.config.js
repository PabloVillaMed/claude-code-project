import { defineConfig } from '@playwright/test';

// En este contenedor se usa el Chromium preinstalado; en CI/Windows, el de Playwright.
const executablePath = process.env.PW_CHROMIUM || undefined;

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
  webServer: {
    command: 'node scripts/serve-cli.mjs',
    url: 'http://localhost:4190',
    reuseExistingServer: true,
    timeout: 30000,
  },
});
