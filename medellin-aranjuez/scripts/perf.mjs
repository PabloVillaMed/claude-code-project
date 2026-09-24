// Mide llamadas de dibujo, triángulos y ms de CPU por frame en varios puntos
// del mapa. Uso: node scripts/perf.mjs [calidad]
import { chromium } from '@playwright/test';
import { serveDist } from './serve.mjs';

const quality = process.argv[2] ?? 'alta';
const PORT = +(process.env.PERF_PORT ?? 4183);
const server = await serveDist(PORT, process.env.DIST_DIR ? (await import('node:path')).resolve(process.env.DIST_DIR) : undefined);
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto(`http://localhost:${PORT}/?autotest=1&quality=${quality}`, { timeout: 600000 });
await page.waitForFunction(() => window.__game?.ready && window.__game.state().state === 'playing', null, { timeout: 600000 });
const G = (fn, arg) => page.evaluate(fn, arg);
const frames = async (n) => {
  const s = await G(() => window.__game.frames);
  await page.waitForFunction((t) => window.__game.frames >= t, s + n, { timeout: 600000 });
};
// Puntos de medición: lugares del mapa (por id) o coordenadas de calle.
const spots = [
  ['parque', 'parque', 0],
  ['calle', [-35, 30.5], -Math.PI / 2],
  ['botanico', 'botanico', -0.8],
  ['mirador', 'mirador', Math.PI / 2],
];
for (const [name, where, yaw] of spots) {
  await G(([where, yaw]) => {
    const p = typeof where === 'string' ? window.__game.pois().find((q) => q.id === where) : { x: where[0], z: where[1] };
    window.__game.teleport(p.x, p.z + (typeof where === 'string' ? 6 : 0));
    window.__game.look(yaw, -0.1);
    window.__game.advance(1);
  }, [where, yaw]);
  await frames(12);
  const p = await G(() => window.__game.perf());
  console.log(name.padEnd(9), `llamadas ${Math.round(p.calls)}`.padEnd(15), `triángulos ${(p.triangles / 1e6).toFixed(2)} M`.padEnd(20), `update ${p.updateMs.toFixed(1)} ms`, `geom ${p.geometries} tex ${p.textures} prog ${p.programs}`);
}
await browser.close();
server.close();
process.exit(0);
