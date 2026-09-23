import { chromium } from '@playwright/test';
import { serveDist } from './serve.mjs';
const server = await serveDist(4175);
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
page.on('console', (m) => console.log('console', m.type(), m.text().slice(0, 300)));
page.on('pageerror', (e) => console.log('pageerror', e.message, e.stack?.slice(0, 500)));
await page.goto(`http://localhost:4175/?autotest=1&quality=${process.argv[2] ?? 'baja'}`);
for (let i = 0; i < 40; i++) {
  await page.waitForTimeout(3000);
  const r = await page.evaluate(() => ({ bar: document.getElementById('load-bar')?.style.width, st: window.__game?.state?.().state, fps: window.__game?.state?.().fps }));
  console.log(i, JSON.stringify(r));
  if (r.st === 'playing' && i > 3) break;
}
await page.screenshot({ path: process.argv[3] ?? '/tmp/p.png' });
await browser.close();
server.close();
process.exit(0);
