// Mide lo que cuesta el cielo: ms por dibujado del cielo solo (cúpula,
// nubes, estrellas y resplandor) a 1280×720 y ms de cada actualización del
// entorno (reflejos PMREM) a varias horas. Con SwiftShader (GPU por software)
// los milisegundos no son los de una tarjeta real, pero sí comparables entre
// versiones. Uso: node scripts/cielo-bench.mjs [calidad]  (DIST_DIR=otra carpeta)
import { chromium } from '@playwright/test';
import { serveDist } from './serve.mjs';
import path from 'node:path';

const quality = process.argv[2] ?? 'media';
const PORT = +(process.env.PERF_PORT ?? 4187);
const server = await serveDist(PORT, path.resolve(process.env.DIST_DIR ?? 'dist'));
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto(`http://localhost:${PORT}/?autotest=1&quality=${quality}`, { timeout: 600000 });
await page.waitForFunction(() => window.__game?.ready && window.__game.state().state === 'playing', null, { timeout: 600000 });

const res = await page.evaluate(() => {
  const g = window.__gameInstance;
  const env = g.env;
  const r = g.renderer;
  const gl = r.getContext();
  const px = new Uint8Array(4);
  const sync = () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
  // Solo los objetos del cielo, en una capa aparte.
  const objs = env.skyObjects ? env.skyObjects() : [env.sky, env.glow, env.stars];
  const LAYER = 31;
  for (const o of objs) o.layers.enable(LAYER);
  const cam = g.camera.clone();
  cam.layers.set(LAYER);
  cam.position.set(0, 60, 0);
  cam.lookAt(200, 90, 40); // mirando hacia arriba y al oriente: casi toda la pantalla es cielo
  const out = {};
  for (const h of [8, 12, 17.75, 20.5]) {
    env.setTime(h);
    env.update(0, cam.position);
    env.followCamera?.(cam.position);
    for (let i = 0; i < 3; i++) r.render(g.scene, cam);
    sync();
    const n = 30;
    const t0 = performance.now();
    for (let i = 0; i < n; i++) {
      env.update(1 / 60, cam.position); // la hora avanza como en el juego
      r.render(g.scene, cam);
    }
    sync();
    const draw = (performance.now() - t0) / n;
    // Actualización del entorno (reflejos): forzada.
    const t1 = performance.now();
    const m = 4;
    for (let i = 0; i < m; i++) {
      env.setTime(h + i * 0.01);
      env.update(0, cam.position);
    }
    sync();
    const envMs = (performance.now() - t1) / m;
    out[h] = { cieloMs: +draw.toFixed(2), actualizarEntornoMs: +envMs.toFixed(2) };
  }
  for (const o of objs) o.layers.disable(LAYER);
  return { out, programs: r.info.programs?.length };
});
console.log(quality, JSON.stringify(res, null, 1));
await browser.close();
server.close?.();
process.exit(0);
