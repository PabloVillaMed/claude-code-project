// Prueba de resistencia: juega varios minutos simulados recorriendo el mapa y
// anota memoria (JS, geometrías, texturas, programas), objetos en escena y
// tiempo por cuadro. Uso: npx vite build && node scripts/soak.mjs [minutos]
import { chromium } from '@playwright/test';
import { serveDist } from './serve.mjs';
import path from 'node:path';

const MIN = +(process.argv[2] ?? 6);
const PORT = +(process.env.SHOTS_PORT ?? 4198);
const server = await serveDist(PORT, path.resolve(process.env.DIST_DIR ?? 'dist'));
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-precise-memory-info', '--js-flags=--expose-gc'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && !m.text().includes('404') && errors.push(`[${m.type()}] ${m.text().slice(0, 200)}`));
await page.goto(`http://localhost:${PORT}/?autotest=1&quality=${process.env.Q ?? 'media'}`, { timeout: 600000 });
await page.waitForFunction(() => window.__game?.ready && window.__game.state().state === 'playing', null, { timeout: 600000 });
const G = (fn, a) => page.evaluate(fn, a);
const sample = () =>
  G(() => {
    if (window.gc) window.gc();
    const g = window.__gameInstance;
    const r = g.renderer.info;
    let objs = 0;
    g.scene.traverse(() => objs++);
    const audioNodes = g.audio?.ctx ? g.audio.ctx.state : '-';
    return {
      t: +(g.stats.playTime ?? 0).toFixed(0),
      heapMB: performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(1) : -1,
      geo: r.memory.geometries,
      tex: r.memory.textures,
      prog: r.programs?.length ?? 0,
      objs,
      peds: g.world.peds.length,
      veh: g.world.vehicles.length,
      markers: g.effects.markers.size,
      dom: document.getElementsByTagName('*').length,
      calls: Math.round(g.perf?.calls ?? 0),
      upd: +(g.perf?.updateMs ?? 0).toFixed(2),
      audio: audioNodes,
    };
  });
// TRACK=1: anota dónde se crea cada geometría que nunca se libera (con un
// build sin minificar los nombres de las funciones salen en la pila:
// npx vite build --minify false --outDir dist-debug && DIST_DIR=dist-debug TRACK=1 node scripts/soak.mjs).
if (process.env.TRACK) {
  await G(() => {
    let proto = null;
    window.__gameInstance.scene.traverse((o) => {
      if (proto || !o.geometry) return;
      for (let p = Object.getPrototypeOf(o.geometry); p; p = Object.getPrototypeOf(p)) if (Object.prototype.hasOwnProperty.call(p, 'setAttribute')) proto = p;
    });
    const live = (window.__geoTrack = new Map());
    const set = proto.setAttribute;
    const dispose = proto.dispose;
    proto.setAttribute = function (...a) {
      if (!live.has(this.id) && !this.__seen) {
        this.__seen = true;
        const st = new Error().stack.split('\n').slice(2, 7).map((l) => l.trim().replace(/\(?https?:\/\/[^/]+\//, '(').replace(/^at /, '')).join(' < ');
        live.set(this.id, { st, ref: new WeakRef(this) });
      }
      return set.apply(this, a);
    };
    proto.dispose = function () {
      live.delete(this.id);
      return dispose.call(this);
    };
  });
}
const pois = await G(() => window.__game.pois().map((p) => ({ x: p.x, z: p.z, id: p.id })));
const rows = [await sample()];
console.log(JSON.stringify(rows[0]));
const steps = Math.round((MIN * 60) / 20);
for (let i = 0; i < steps; i++) {
  const p = pois[(i * 7) % pois.length];
  // Teletransporte, caminar y a veces disparar o subirse a un carro: todo lo que crea y destruye cosas.
  await G(([p, i]) => {
    const g = window.__game;
    g.teleport(p.x, p.z);
    if (i % 3 === 1) g.addWanted?.(1);
    if (i % 4 === 2) {
      const v = window.__gameInstance.world.nearestVehicle?.(p.x, p.z, 60);
      if (v) window.__gameInstance.enterVehicle(v);
    }
  }, [p, i]);
  for (let k = 0; k < 4; k++) {
    await G(([i, k]) => window.__game.advance(5, { moveY: 1, moveX: k % 2 ? 0.3 : -0.3, sprint: true, fire: i % 5 === 0 && k === 1, throttle: 1, steer: k % 2 ? 0.4 : -0.4 }), [i, k]);
    await page.waitForTimeout(150); // cuadros reales (render)
  }
  await G(() => {
    const g = window.__gameInstance;
    if (g.player.inVehicle) g.exitVehicle(true);
    g.wanted?.clear?.();
  });
  const s = await sample();
  rows.push(s);
  console.log(JSON.stringify(s));
}
// Programas (sombreadores) por tipo de material: si uno crece sin parar, ahí hay una fuga.
const progs = await G(() => {
  const by = {};
  for (const p of window.__gameInstance.renderer.info.programs ?? []) by[p.name] = (by[p.name] ?? 0) + 1;
  return by;
});
console.log('PROGRAMAS', JSON.stringify(progs));
if (process.env.TRACK) {
  const groups = await G(() => {
    if (window.gc) window.gc();
    const inScene = new Set();
    window.__gameInstance.scene.traverse((o) => o.geometry && inScene.add(o.geometry.id));
    const by = {};
    for (const [id, e] of window.__geoTrack) {
      const g = e.ref.deref();
      const k = (g ? (inScene.has(id) ? 'escena ' : 'FUERA ') : 'recogida ') + e.st;
      by[k] = (by[k] ?? 0) + 1;
    }
    return Object.entries(by).sort((a, b) => b[1] - a[1]).slice(0, 25);
  });
  console.log('GEOMETRIAS VIVAS (creadas durante la prueba, sin liberar):');
  for (const [k, n] of groups) console.log(String(n).padStart(5), k.slice(0, 600));
}
console.log('ERRORES', errors.length ? [...new Set(errors)].slice(0, 30).join('\n') : 'ninguno');
await browser.close();
server.close?.();
process.exit(0);
