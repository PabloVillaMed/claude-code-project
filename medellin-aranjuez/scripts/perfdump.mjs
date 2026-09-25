// Desglose de triángulos y llamadas por malla visible: node scripts/perfdump.mjs [poi]
import { chromium } from '@playwright/test';
import { serveDist } from './serve.mjs';
import path from 'node:path';
const PORT = +(process.env.PERF_PORT ?? 4195);
const server = await serveDist(PORT, path.resolve(process.env.DIST_DIR ?? 'dist'));
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto(`http://localhost:${PORT}/?autotest=1&quality=alta`, { timeout: 600000 });
await page.waitForFunction(() => window.__game?.ready && window.__game.state().state === 'playing', null, { timeout: 600000 });
const poi = process.argv[2] ?? 'cayetano';
const out = await page.evaluate(async (poi) => {
  const p = window.__game.pois().find((q) => q.id === poi);
  window.__game.teleport(p.x, p.z + 6);
  window.__game.advance(1);
  await new Promise((r) => setTimeout(r, 3000));
  const g = window.__gameInstance;
  const cam = g.camera;
  cam.updateMatrixWorld();
  const agg = {};
  g.scene.traverseVisible((o) => {
    if (!o.isMesh && !o.isPoints && !o.isLine) return;
    const geo = o.geometry;
    if (!geo) return;
    const idx = geo.index ? geo.index.count : geo.attributes.position.count;
    const inst = o.isInstancedMesh ? o.count : 1;
    const tris = (idx / 3) * inst;
    let key = o.name || o.parent?.name || o.type;
    key = key.replace(/[0-9]+/g, '#');
    const a = (agg[key] ??= { n: 0, tris: 0 });
    a.n++;
    a.tris += tris;
  });
  return Object.entries(agg).sort((a, b) => b[1].tris - a[1].tris).slice(0, 30);
}, poi);
for (const [k, v] of out) console.log(k.padEnd(40), String(v.n).padStart(6), (v.tris / 1e6).toFixed(3) + ' M');
await browser.close();
server.close();
process.exit(0);
