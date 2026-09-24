// Desglose de triángulos y llamadas por tipo de objeto (qué cuesta más).
import { chromium } from '@playwright/test';
import { serveDist } from './serve.mjs';

const server = await serveDist(4184);
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto('http://localhost:4184/?autotest=1&quality=alta');
await page.waitForFunction(() => window.__game?.ready && window.__game.state().state === 'playing', null, { timeout: 600000 });
const rows = await page.evaluate(() => {
  const g = window.__gameInstance;
  const out = {};
  g.scene.traverseVisible((o) => {
    if (!o.isMesh && !o.isPoints && !o.isLine) return;
    const geo = o.geometry;
    const tris = geo.index ? geo.index.count / 3 : (geo.attributes.position?.count ?? 0) / 3;
    const inst = o.isInstancedMesh ? o.count : 1;
    // Categoría: nombre del ancestro más cercano con nombre, o tipo.
    let p = o;
    let key = '';
    while (p && !key) {
      key = p.name;
      p = p.parent;
    }
    key = (key || o.type) + (o.isSkinnedMesh ? ' [skinned]' : '') + (o.isInstancedMesh ? ' [inst]' : '');
    const r = (out[key] ??= { objs: 0, tris: 0, shadowTris: 0 });
    r.objs++;
    r.tris += tris * inst;
    if (o.castShadow) r.shadowTris += tris * inst;
  });
  return Object.entries(out).sort((a, b) => b[1].tris - a[1].tris).slice(0, 30);
});
for (const [k, r] of rows) console.log(k.slice(0, 40).padEnd(42), String(r.objs).padStart(5), (r.tris / 1e6).toFixed(3).padStart(8), 'M', (r.shadowTris / 1e6).toFixed(3).padStart(8), 'M sombra');
await browser.close();
server.close();
process.exit(0);
