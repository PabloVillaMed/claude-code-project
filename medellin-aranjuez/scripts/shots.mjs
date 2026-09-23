// Recorre una sesión de juego guionizada y guarda capturas reales.
// La jugabilidad se simula con __game.advance() y solo se espera el render
// en el momento de cada captura (el render por software es lento).
// Uso: node scripts/shots.mjs <carpeta> [calidad] [ancho] [alto] [pasos]
import { chromium } from '@playwright/test';
import { serveDist } from './serve.mjs';

const out = process.argv[2] ?? 'shots';
const quality = process.argv[3] ?? 'media';
const W = +(process.argv[4] ?? 1280);
const H = +(process.argv[5] ?? 720);
const steps = (process.argv[6] ?? 'all').split(',');
const want = (k) => steps.includes('all') || steps.includes(k);

const server = await serveDist(4181);
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: W, height: H } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && !m.text().includes('404') && errors.push(m.text()));
await page.goto(`http://localhost:4181/?autotest=1&quality=${quality}`);
await page.waitForFunction(() => window.__game?.ready && window.__game.state().state === 'playing', null, { timeout: 600000 });
const G = (fn, arg) => page.evaluate(fn, arg);
const frames = async (n) => {
  const start = await G(() => window.__game.frames);
  await page.waitForFunction((t) => window.__game.frames >= t, start + n, { timeout: 600000 });
};
const adv = (sec, input) => G(([s, i]) => window.__game.advance(s, i), [sec, input ?? null]);
const shot = async (name, clear = true) => {
  if (clear) await G(() => window.__game.clearMessages());
  await frames(3);
  await page.screenshot({ path: `${out}/${name}.png` });
  const s = await G(() => window.__game.state());
  console.log('captura', name, JSON.stringify({ x: +s.x.toFixed(1), z: +s.z.toFixed(1), vehiculo: s.vehicleType, kmh: +s.speedKmh.toFixed(0), arma: s.weapon, estrellas: s.wanted, peatones: s.peds, vehiculos: s.vehicles }));
};

await adv(4);
if (want('spawn')) await shot('01-parque-aranjuez');
if (want('walk')) {
  await adv(2.5, { moveY: 1, moveX: 0.3, sprint: true });
  await adv(0.3);
  await shot('02-corriendo-por-el-parque');
}
if (want('street')) {
  await G(() => { window.__game.teleport(-35, 30.5); window.__game.look(-Math.PI / 2 + 0.25, -0.08); });
  await adv(8, { moveY: 1 });
  await shot('03-calle-del-barrio');
}
if (want('aim')) {
  await G(() => { window.__game.giveAll(); window.__game.look(Math.PI / 2, -0.05); });
  await adv(0.5, { weaponSlot: 6 });
  await adv(1, { aim: true });
  await shot('04-apuntando-fusil');
  await adv(0.12, { aim: true, fire: true });
  await shot('05-disparando', false);
  await adv(0.5);
}
if (want('wheel')) {
  await adv(0.2, { weaponWheel: true, lookX: 0.02 });
  await shot('06-rueda-de-armas', false);
  await adv(0.2);
}
if (want('drive')) {
  await G(() => { window.__game.teleport(0, 30.5); window.__game.spawnVehicle('taxi'); window.__game.enterNearest(20); });
  await adv(4, { throttle: 1 });
  await adv(0.5, { throttle: 0.6, steer: 0.1 });
  await shot('07-taxi-amarillo');
}
if (want('moto')) {
  await G(() => { window.__game.exitVehicle(); window.__game.teleport(210, 40); window.__game.spawnVehicle('moto'); window.__game.enterNearest(20); });
  await adv(3, { throttle: 1 });
  await adv(0.6, { throttle: 1, steer: 0.5 });
  await shot('08-moto');
}
if (want('mirador')) {
  await G(() => { window.__game.exitVehicle(); const p = window.__game.pois().find((x) => x.id === 'mirador'); window.__game.teleport(p.x - 16, p.z + 2); window.__game.look(Math.PI / 2, 0.02); });
  await adv(1.5);
  await shot('09-mirador-del-valle');
}
if (want('botanico')) {
  await G(() => { const p = window.__game.pois().find((x) => x.id === 'botanico'); window.__game.teleport(p.x - 6, p.z - 2); window.__game.look(-Math.PI / 2 - 0.4, 0.25); });
  await adv(1.5);
  await shot('10-jardin-botanico-orquideorama');
}
if (want('metro')) {
  await G(() => { const p = window.__game.pois().find((x) => x.id === 'metro'); window.__game.teleport(p.x + 26, p.z + 40); window.__game.look(0.75, 0.2); });
  await adv(1.5);
  await shot('11-metro-estacion-universidad');
}
if (want('police')) {
  await G(() => { window.__game.teleport(0, 30.5); window.__game.addWanted(3); window.__game.look(Math.PI, -0.1); });
  await adv(14);
  await shot('12-persecucion-policial');
}
if (want('night')) {
  await G(() => { window.__game.setTime(20.2); window.__game.teleport(-35, 30.5); window.__game.look(-Math.PI / 2 + 0.3, -0.02); });
  await adv(2);
  await shot('13-aranjuez-de-noche');
}
if (want('map')) {
  await G(() => { window.__game.setTime(16.5); });
  await page.keyboard.press('KeyM');
  await frames(3);
  await page.screenshot({ path: `${out}/14-mapa.png` });
  console.log('captura 14-mapa');
}
console.log('ERRORES', JSON.stringify(errors.slice(0, 20)));
await browser.close();
server.close();
process.exit(0);
