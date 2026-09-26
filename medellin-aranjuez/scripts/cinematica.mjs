// Capturas de la cinemática de entrada (historia, capítulo 1):
//   npx vite build && node scripts/cinematica.mjs <carpeta>
import { chromium } from '@playwright/test';
import { serveDist } from './serve.mjs';
import fs from 'node:fs';
import path from 'node:path';

const out = process.argv[2] ?? 'cinematica';
fs.mkdirSync(out, { recursive: true });
const PORT = +(process.env.SHOTS_PORT ?? 4193);
const server = await serveDist(PORT, path.resolve(process.env.DIST_DIR ?? 'dist'));
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && !m.text().includes('404') && errors.push(m.text()));
await page.goto(`http://localhost:${PORT}/?autotest=1&quality=${process.env.Q ?? 'media'}`, { timeout: 600000 });
await page.waitForFunction(() => window.__game?.ready && window.__game.state().state === 'playing', null, { timeout: 600000 });
const G = (fn, arg) => page.evaluate(fn, arg);
await G(() => window.__game.playIntro());
const times = (process.env.TIMES ?? '3,9.5,13,19,24,29,35,41,47,53').split(',').map(Number);
let t = 0;
for (const at of times) {
  await G((s) => window.__game.advance(s), at - t);
  t = at;
  await page.waitForTimeout(700); // transiciones CSS de fundidos y títulos
  const st = await G(() => window.__game.story());
  const name = `t${String(at).replace('.', '_')}`;
  await page.screenshot({ path: `${out}/${name}.png` });
  console.log(name, JSON.stringify(st));
  if (!st.cinematic) break;
}
console.log('ERRORES', errors.length ? errors.join('\n') : 'ninguno');
await browser.close();
server.close?.();
process.exit(0);
