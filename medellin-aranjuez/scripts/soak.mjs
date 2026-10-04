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
console.log('ERRORES', errors.length ? [...new Set(errors)].slice(0, 30).join('\n') : 'ninguno');
await browser.close();
server.close?.();
process.exit(0);
