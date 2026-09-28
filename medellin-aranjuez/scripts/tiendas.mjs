// Capturas de las vitrinas de los locales (de día y de noche), con llamadas
// de dibujo y triángulos de cada vista. Uso:
//   npx vite build && node scripts/tiendas.mjs <carpeta>
// VIEWS (JSON) cambia la lista: [[nombre, {kind|name, hour, dist, h, side, outfit}], ...]
//   kind / name: el local más cercano al parque de ese tipo o con ese nombre
//   dist: metros desde la vitrina; h: alto de la cámara; side: corrimiento lateral
//   outfit: ropa del jugador ({gorra: 'plana-negra', ...}); player: el jugador en cuadro
import { chromium } from '@playwright/test';
import { serveDist } from './serve.mjs';
import path from 'node:path';
import fs from 'node:fs';

const out = process.argv[2] ?? 'tiendas';
fs.mkdirSync(out, { recursive: true });
const PORT = +(process.env.SHOTS_PORT ?? 4193);
const server = await serveDist(PORT, path.resolve(process.env.DIST_DIR ?? 'dist'));
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message + '\n' + (e.stack ?? '')));
page.on('console', (m) => m.type() === 'error' && !m.text().includes('404') && errors.push(m.text()));
await page.goto(`http://localhost:${PORT}/?autotest=1&quality=${process.env.Q ?? 'media'}`, { timeout: 600000 });
await page.waitForFunction(() => window.__game?.ready && window.__game.state().state === 'playing', null, { timeout: 600000 });
const G = (fn, arg) => page.evaluate(fn, arg);
const frames = async (n) => {
  const s = await G(() => window.__game.frames);
  await page.waitForFunction((t) => window.__game.frames >= t, s + n, { timeout: 600000 });
};
const views = JSON.parse(process.env.VIEWS ?? 'null') ?? [
  ['tienda-dia', { kind: 'tienda', hour: 11 }],
  ['panaderia-dia', { kind: 'panaderia', hour: 11 }],
  ['drogueria-dia', { kind: 'drogueria', hour: 11 }],
  ['peluqueria-dia', { kind: 'peluqueria', hour: 11 }],
  ['cafeteria-dia', { kind: 'cafeteria', hour: 11 }],
  ['billares-noche', { kind: 'billares', hour: 20.5 }],
  ['tienda-noche', { kind: 'tienda', hour: 20.5 }],
  ['calle-noche', { kind: 'tienda', hour: 20.5, dist: 16, side: 6, h: 3 }],
];
await G(() => {
  window.__game.advance(2);
  window.__game.screenshotHudHidden(true);
});
const report = [];
for (const [name, v] of views) {
  const info = await G((v) => {
    const gm = window.__game;
    if (v.hour != null) gm.setTime(v.hour);
    const par = gm.pois().find((p) => p.id === 'parque');
    const list = gm.storefronts().filter((s) => (v.name ? s.name === v.name : !v.kind || s.kind === v.kind));
    list.sort((a, b) => Math.hypot(a.x - par.x, a.z - par.z) - Math.hypot(b.x - par.x, b.z - par.z));
    const s = list[v.pick ?? 0];
    if (!s) return null;
    const d = v.dist ?? 5.2;
    const side = v.side ?? 0;
    const rx = -s.nz;
    const rz = s.nx;
    if (v.outfit) gm.setOutfit(v.outfit);
    // El jugador: en cuadro (mirando a la cámara) o detrás de ella.
    const pd = v.player ? d - 2.4 : d + 3;
    gm.teleport(s.x + s.nx * pd + rx * (v.player ? 0.4 : 0), s.z + s.nz * pd + rz * (v.player ? 0.4 : 0));
    gm.look(Math.atan2(s.nx, s.nz), 0);
    gm.advance(1);
    if (v.player) gm.facePlayer(Math.atan2(-s.nx, -s.nz));
    const cx = s.x + s.nx * d + rx * side;
    const cz = s.z + s.nz * d + rz * side;
    gm.aerial(cx, s.y + (v.h ?? 1.6), cz, s.x + rx * side * 0.3, s.y + (v.player ? 1.1 : 1.35), s.z + rz * side * 0.3);
    return { name: s.name, kind: s.kind };
  }, v);
  if (!info) {
    console.log(name, 'sin local');
    continue;
  }
  await G(() => window.__game.clearMessages());
  await frames(8);
  const p = await G(() => window.__game.perf());
  await page.screenshot({ path: `${out}/${name}.png`, timeout: 600000 });
  const row = { view: name, local: info.name, calls: Math.round(p.calls), tris: +(p.triangles / 1e6).toFixed(3) };
  report.push(row);
  console.log(JSON.stringify(row));
}
fs.writeFileSync(`${out}/perf.json`, JSON.stringify(report, null, 1));
console.log('ERRORES', errors.length ? errors.join('\n---\n') : 'ninguno');
await browser.close();
server.close?.();
process.exit(0);
