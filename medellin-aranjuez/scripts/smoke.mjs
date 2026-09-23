// Arranque rápido del juego en Chromium headless: errores de consola + capturas.
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';

const out = process.argv[2] ?? 'shots';
const server = spawn('npx', ['vite', 'preview', '--port', '4174', '--strictPort'], { stdio: 'pipe' });
await new Promise((r) => setTimeout(r, 2500));
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text()}`); });
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}\n${e.stack}`));
const q = process.argv[3] ?? 'media';
await page.goto(`http://localhost:4174/?autotest=1&quality=${q}`);
await page.waitForFunction(() => window.__game?.ready && window.__game.state().state === 'playing', null, { timeout: 180000 });
await page.waitForTimeout(3000);
await page.screenshot({ path: `${out}/01-spawn.png` });
const s0 = await page.evaluate(() => window.__game.state());
console.log('state0', JSON.stringify(s0));
await page.evaluate(() => window.__game.setInput({ moveY: 1, sprint: true }));
await page.waitForTimeout(2000);
await page.evaluate(() => window.__game.setInput(null));
const s1 = await page.evaluate(() => window.__game.state());
console.log('state1', JSON.stringify(s1));
await page.screenshot({ path: `${out}/02-walk.png` });
await page.evaluate(() => { window.__game.giveAll(); window.__game.setInput({ weaponSlot: 6, aim: true }); });
await page.waitForTimeout(800);
await page.evaluate(() => window.__game.setInput({ aim: true, fire: true }));
await page.waitForTimeout(600);
await page.screenshot({ path: `${out}/03-shoot.png` });
await page.evaluate(() => window.__game.setInput(null));
await page.evaluate(() => { window.__game.spawnVehicle('taxi'); });
await page.waitForTimeout(300);
const entered = await page.evaluate(() => window.__game.enterNearest(15));
console.log('entered', entered);
await page.evaluate(() => window.__game.setInput({ throttle: 1 }));
await page.waitForTimeout(3000);
await page.screenshot({ path: `${out}/04-drive.png` });
console.log('state2', JSON.stringify(await page.evaluate(() => window.__game.state())));
await page.evaluate(() => { window.__game.setInput(null); window.__game.setTime(20.5); });
await page.waitForTimeout(1500);
await page.screenshot({ path: `${out}/05-night.png` });
console.log('ERRORS:\n' + errors.slice(0, 30).join('\n'));
await browser.close();
server.kill();
