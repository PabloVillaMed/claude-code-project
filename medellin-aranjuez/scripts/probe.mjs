// Capturas rápidas de verificación del mapa real: node scripts/probe.mjs <carpeta>
import { chromium } from '@playwright/test';
import { serveDist } from './serve.mjs';
import path from 'node:path';
const out = process.argv[2] ?? 'probe';
const PORT = +(process.env.SHOTS_PORT ?? 4191);
const server = await serveDist(PORT, path.resolve(process.env.DIST_DIR ?? 'dist'));
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message + '\n' + (e.stack ?? '')));
page.on('console', (m) => m.type() === 'error' && !m.text().includes('404') && errors.push(m.text()));
const t0 = Date.now();
await page.goto(`http://localhost:${PORT}/?autotest=1&quality=${process.env.Q ?? 'media'}`, { timeout: 600000 });
try {
  await page.waitForFunction(() => window.__game?.ready && window.__game.state().state === 'playing', null, { timeout: 600000 });
} catch (e) {
  console.log('NO CARGÓ', errors.join('\n'));
  process.exit(1);
}
console.log('cargó en', ((Date.now() - t0) / 1000).toFixed(0), 's');
const G = (fn, arg) => page.evaluate(fn, arg);
const frames = async (n) => {
  const s = await G(() => window.__game.frames);
  await page.waitForFunction((t) => window.__game.frames >= t, s + n, { timeout: 600000 });
};
const adv = (sec, input) => G(([s, i]) => window.__game.advance(s, i), [sec, input ?? null]);
const shot = async (name) => {
  await G(() => window.__game.clearMessages());
  await frames(3);
  await page.screenshot({ path: `${out}/${name}.png`, timeout: 600000 });
  const s = await G(() => window.__game.state());
  console.log(name, JSON.stringify({ x: +s.x.toFixed(1), z: +s.z.toFixed(1), peds: s.peds, veh: s.vehicles }));
};
const views = JSON.parse(process.env.VIEWS ?? 'null') ?? [
  ['spawn', null],
  ['moravia', { poi: 'moravia', dx: -10, dz: 25, yaw: 0, pitch: 0.05 }],
  ['metro', { poi: 'metro', dx: 0, dz: 0, yaw: -1.4, pitch: 0.15 }],
  ['mirador', { poi: 'mirador', dx: -6, dz: 0, yaw: Math.PI / 2, pitch: 0.0 }],
  ['iglesia', { poi: 'iglesia', dx: 0, dz: 12, yaw: Math.PI, pitch: 0.1 }],
  ['noche', { poi: 'parque', dx: 0, dz: 20, yaw: 0, pitch: 0.02, hour: 20.5 }],
];
await adv(3);
for (const [name, v] of views) {
  if (v) {
    await G((v) => {
      if (v.hour) window.__game.setTime(v.hour);
      const p = v.poi ? window.__game.pois().find((x) => x.id === v.poi) : { x: v.x, z: v.z };
      window.__game.teleport(p.x + (v.dx ?? 0), p.z + (v.dz ?? 0));
      window.__game.look(v.yaw ?? 0, v.pitch ?? 0);
    }, v);
    await adv(1.5);
    await G((v) => {
      const s = window.__game.state();
      if (v.cam) window.__game.aerial(s.x + v.cam[0], s.y + v.cam[1], s.z + v.cam[2], s.x + (v.at?.[0] ?? 0), s.y + (v.at?.[1] ?? 0), s.z + (v.at?.[2] ?? 0));
      else window.__game.aerial();
    }, v);
  }
  await shot(name);
}
console.log('ERRORES', errors.length ? errors.join('\n---\n') : 'ninguno');
await browser.close();
server.close?.();
process.exit(0);
