// Escena de prueba de la vegetación: busca un claro en el mapa, planta filas
// de cada especie (window.__vegetacion, ver src/render/vegetation.js) y guarda
// capturas de cerca y en contexto.
// Uso: DIST_DIR=dist node scripts/vegetacion-escena.mjs <carpeta> [calidad]
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';
import { serveDist } from './serve.mjs';

const out = process.argv[2] ?? 'shots-vegetacion';
const quality = process.argv[3] ?? 'alta';
fs.mkdirSync(out, { recursive: true });
const PORT = +(process.env.SHOTS_PORT ?? 4185);
const server = await serveDist(PORT, process.env.DIST_DIR ? path.resolve(process.env.DIST_DIR) : undefined);
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('error', e.message));
await page.goto(`http://localhost:${PORT}/?autotest=1&quality=${quality}`, { timeout: 600000 });
await page.waitForFunction(() => window.__game?.ready && window.__game.state().state === 'playing' && window.__vegetacion, null, { timeout: 600000 });
const G = (fn, arg) => page.evaluate(fn, arg);
const frames = async (n) => {
  const s = await G(() => window.__game.frames);
  await page.waitForFunction((t) => window.__game.frames >= t, s + n, { timeout: 600000 });
};
const shot = async (name) => {
  await G(() => window.__game.clearMessages());
  await frames(3);
  await page.screenshot({ path: `${out}/${name}.png`, timeout: 600000 });
  console.log('captura', name);
};

// Claro: rectángulo de 90 × 50 m sin colisiones, lo más cerca del parque.
const spot = await G(() => {
  const g = window.__gameInstance;
  const col = g.city.collision;
  const park = window.__game.pois().find((p) => p.id === 'parque') ?? { x: 0, z: 0 };
  let best = null;
  for (let r = 0; r < 900 && !best; r += 30) {
    for (let a = 0; a < Math.PI * 2 && !best; a += Math.PI / 8) {
      const cx = park.x + Math.cos(a) * r;
      const cz = park.z + Math.sin(a) * r;
      let ok = true;
      for (let x = -45; x <= 45 && ok; x += 5) for (let z = -25; z <= 25 && ok; z += 5) ok = !col.pointBlocked(cx + x, cz + z);
      if (ok) best = { x: cx, z: cz };
    }
  }
  return best;
});
console.log('claro', JSON.stringify(spot));
if (!spot) throw new Error('No hay claro para la escena');

/** Planta una fila perpendicular a la vista, a `dist` m del jugador, y encuadra. */
async function row(name, props, { dist, back = 0, pitch = -0.05, spacing }) {
  await G(([spot, props, dist, back, pitch, spacing]) => {
    const g = window.__gameInstance;
    window.__game.teleport(spot.x, spot.z + 20 + back);
    window.__game.look(0, pitch);
    window.__game.advance(0.5);
    const cam = g.camera;
    const f = cam.getWorldDirection(new cam.position.constructor());
    f.y = 0;
    f.normalize();
    const side = { x: -f.z, z: f.x };
    const p0 = window.__game.state();
    const n = props.length;
    const list = props.map((p, i) => {
      const o = (i - (n - 1) / 2) * spacing;
      const rot = p.rot === 'facing' ? Math.atan2(-f.x, -f.z) : p.rot;
      return { ...p, rot, x: p0.x + f.x * dist + side.x * o, z: p0.z + f.z * dist + side.z * o };
    });
    g.scene.getObjectByName('escena-vegetacion')?.removeFromParent();
    const root = new g.cityRenderer.root.constructor();
    root.name = 'escena-vegetacion';
    g.scene.add(root);
    const r = g.cityRenderer;
    const saved = r.root;
    r.root = root;
    window.__vegetacion.build(r, list);
    r.root = saved;
    window.__game.advance(0.2);
  }, [spot, props, dist, back, pitch, spacing]);
  await shot(name);
}

const T = (kind, scale = 1) => ({ type: 'tree', kind, scale });
const S = (kind, extra = {}) => ({ type: 'shrub', kind, ...extra });
await row('01-palmas', [T('palmaReal'), T('palma'), T('palmaAreca'), T('platano'), T('guadua')], { dist: 32, spacing: 11, pitch: 0.12 });
await row('02-arboles-sombra', [T('mango'), T('saman'), T('aguacate'), T('ficus')], { dist: 42, spacing: 17, pitch: 0.1 });
await row('03-arboles-flor-y-patio', [T('carbonero'), T('almendro'), T('guayabo'), T('guayacan'), T('ceiba')], { dist: 40, spacing: 14, pitch: 0.1 });
await row('04-arbustos', [S('seto', { len: 3, rot: 'facing' }), S('croton'), S('heliconia'), S('buganvilia'), S('helecho'), S('monstera')], { dist: 9, spacing: 2.8, pitch: -0.12 });
await row('05-pasto-maleza-enredadera', [{ type: 'grass', kind: 'pasto', r: 2.5, density: 3 }, { type: 'grass', kind: 'maleza', r: 2.5, density: 2 }, { type: 'climber', rot: 'facing', w: 4, h: 3 }], { dist: 9, spacing: 5.5, pitch: -0.15 });
// Jardín (polígono) con árboles alrededor, como lo pediría el generador.
await G((spot) => {
  const g = window.__gameInstance;
  g.scene.getObjectByName('escena-vegetacion')?.removeFromParent();
  const root = new g.cityRenderer.root.constructor();
  root.name = 'escena-vegetacion';
  g.scene.add(root);
  const r = g.cityRenderer;
  const saved = r.root;
  r.root = root;
  const cx = spot.x, cz = spot.z;
  const poly = [[cx - 12, cz - 6], [cx + 10, cz - 8], [cx + 13, cz + 5], [cx - 4, cz + 9], [cx - 13, cz + 4]];
  const trees = [['mango', -8, -3], ['palmaReal', 9, -5], ['saman', 2, 14], ['palma', -10, 6], ['carbonero', 14, 8], ['guayacan', -16, -9]].map(([kind, dx, dz]) => ({ type: 'tree', kind, x: cx + dx, z: cz + dz, keepKind: true }));
  window.__vegetacion.buildVegetation(r, trees, [{ type: 'garden', poly, grass: true }]);
  r.root = saved;
  window.__game.teleport(cx, cz + 22);
  window.__game.look(0, 0.05);
  window.__game.advance(0.3);
}, spot);
await shot('06-jardin-poligono');
const n = await G(() => {
  let n = 0;
  window.__gameInstance.scene.getObjectByName('escena-vegetacion').traverse((o) => o.isInstancedMesh && n++);
  return n;
});
console.log('mallas instanciadas en la escena', n);
await browser.close();
server.close();
process.exit(0);
