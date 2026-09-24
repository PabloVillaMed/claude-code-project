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

const PORT = +(process.env.SHOTS_PORT ?? 4181);
// DIST_DIR permite capturar otra compilación (p. ej. mientras otro proceso reconstruye dist/).
const server = await serveDist(PORT, process.env.DIST_DIR ? (await import('node:path')).resolve(process.env.DIST_DIR) : undefined);
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: W, height: H } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && !m.text().includes('404') && errors.push(m.text()));
await page.goto(`http://localhost:${PORT}/?autotest=1&quality=${quality}`, { timeout: 600000 });
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
  await page.screenshot({ path: `${out}/${name}.png`, timeout: 600000 });
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
  // Por el andén de la Carrera 51 (Bolívar), mirando calle abajo con las fachadas a ambos lados.
  await G(() => { window.__game.teleport(-29.2, 26); window.__game.look(0, -0.08); });
  await adv(6, { moveY: 1 });
  await G(() => window.__game.look(0.38, -0.05));
  await adv(0.4);
  await shot('03-calle-del-barrio');
}
if (want('aim')) {
  await G(() => { window.__game.giveAll(); window.__game.teleport(-33, 12); window.__game.look(0.35, -0.05); });
  await adv(0.5, { weaponSlot: 6 });
  await adv(1, { aim: true });
  // Mantener la entrada durante el render de la captura.
  await G(() => window.__game.setInput({ aim: true }));
  await shot('04-apuntando-fusil');
  await G(() => window.__game.setInput({ aim: true, fire: true }));
  await shot('05-disparando', false);
  await G(() => window.__game.setInput(null));
  await adv(0.5);
}
if (want('wheel')) {
  await G(() => window.__game.setInput({ weaponWheel: true }));
  await shot('06-rueda-de-armas', false);
  await G(() => window.__game.setInput(null));
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
  await adv(0.4, { throttle: 1, steer: 0.15 });
  await shot('08-moto');
}
if (want('mirador')) {
  await G(() => { window.__game.exitVehicle(); const p = window.__game.pois().find((x) => x.id === 'mirador'); window.__game.teleport(p.x - 16, p.z + 2); window.__game.look(Math.PI / 2, 0.02); });
  await adv(1.5);
  await shot('09-mirador-del-valle');
}
if (want('horizonte')) {
  // Por las calles (oriente-occidente) se ven las montañas del valle al fondo.
  await G(() => { window.__game.exitVehicle(); window.__game.setTime(10); window.__game.teleport(245, -35); window.__game.look(Math.PI / 2, 0.03); });
  await adv(1.2);
  await shot('25-valle-hacia-occidente');
  await G(() => { window.__game.setTime(15); window.__game.teleport(-245, 35); window.__game.look(-Math.PI / 2, 0.06); });
  await adv(1.2);
  await shot('26-laderas-orientales');
  await G(() => { window.__game.setTime(11); window.__game.teleport(105, 175); window.__game.look(Math.PI * 0.72, 0.04); });
  await adv(1.2);
  await shot('27-valle-hacia-el-sur');
  await G(() => { window.__game.setTime(19.6); window.__game.teleport(245, -35); window.__game.look(Math.PI / 2, 0.02); });
  await adv(1.2);
  await shot('28-valle-de-noche');
  await G(() => window.__game.setTime(16.5));
}
if (want('botanico')) {
  await G(() => { const p = window.__game.pois().find((x) => x.id === 'botanico'); window.__game.teleport(p.x - 12, p.z + 10); window.__game.look(-0.9, 0.3); });
  await adv(1.5);
  await shot('10-jardin-botanico-orquideorama');
}
if (want('metro')) {
  await G(() => { const p = window.__game.pois().find((x) => x.id === 'metro'); window.__game.teleport(p.x + 16, p.z + 55); window.__game.look(0.35, 0.28); });
  await adv(1.5);
  await shot('11-metro-estacion-universidad');
}
if (want('police')) {
  await G(() => { window.__game.teleport(0, 30.5); window.__game.addWanted(3); window.__game.look(Math.PI, -0.1); });
  await adv(14);
  await shot('12-persecucion-policial');
}
if (want('busqueda')) {
  // Delito en la calle y huida: la policía no sabe dónde estás, solo dónde
  // te vieron. El minimapa muestra la zona de búsqueda.
  await G(() => { window.__game.teleport(0, 30.5); window.__game.addWanted(3); });
  await adv(2);
  await G(() => { window.__game.teleport(-105, -60); window.__game.look(Math.PI * 0.8, -0.05); });
  await adv(8);
  await shot('15-busqueda-policial-zona');
  await G(() => window.__gameInstance.wanted.clear());
  await adv(1);
}
for (const [id, name, dx, dz, yaw, pitch, hour] of [
  ['moravia', '16-morro-de-moravia', 30, 30, Math.PI / 4, 0.12],
  ['explora', '17-parque-explora', 5.5, 0, Math.PI / 2, 0.1, 10.5],
  ['cementerio', '18-cementerio-san-pedro', 0, -6, Math.PI, 0.05],
  ['museo', '19-casa-museo-pedro-nel-gomez', 0, 8, 0, 0.02],
]) {
  if (!want(id)) continue;
  await G(([id, dx, dz, yaw, pitch, hour]) => {
    if (hour) window.__game.setTime(hour);
    const p = window.__game.pois().find((x) => x.id === id);
    window.__game.teleport(p.x + dx, p.z + dz);
    window.__game.look(yaw, pitch);
  }, [id, dx, dz, yaw, pitch, hour]);
  await adv(1.5);
  await shot(name);
}
// Calle viva: mirar un elemento desde la calle (tipo de prop, índice, distancia, hora).
const viewProp = (type, k, dist, hour) =>
  G(([type, k, dist, hour]) => {
    const g = window.__gameInstance;
    g.env.setTime(hour);
    const list = g.city.props.filter((p) => p.type === type);
    const p = list[k % list.length];
    const rot = p.rot ?? 0;
    const fx = Math.sin(rot);
    const fz = Math.cos(rot);
    window.__game.teleport(p.x + fx * dist + Math.cos(rot) * 1.5, p.z + fz * dist - Math.sin(rot) * 1.5);
    window.__game.look(Math.atan2(fx, fz), 0.08);
    window.__game.advance(1.2);
  }, [type, k, dist, hour]);
if (want('vecinos')) {
  await viewProp('chair', 4, 5, 17);
  await adv(1);
  await shot('21-vecinos-sentados-frente-a-la-tienda');
}
if (want('paradero')) {
  await viewProp('busStop', 2, 5, 12);
  await shot('22-paradero-en-carabobo');
}
if (want('ventero')) {
  await viewProp('vendor', 0, 5, 10.5);
  await shot('23-ventero-en-el-parque');
}
if (want('derrape')) {
  await G(() => { window.__gameInstance.env.setTime(20.4); window.__game.teleport(-245, -150); window.__game.spawnVehicle('sedan'); window.__game.enterNearest(20); });
  await adv(3.5, { throttle: 1 });
  await adv(0.9, { throttle: 0.3, steer: 1, handbrake: true });
  await adv(0.4, { throttle: 0.6, steer: -0.5 });
  await shot('24-derrape-de-noche');
  await G(() => window.__game.exitVehicle());
}
if (want('night')) {
  await G(() => { window.__game.setTime(20.2); window.__game.teleport(-35, 30.5); window.__game.look(-Math.PI / 2 + 0.3, -0.02); });
  await adv(2);
  await shot('13-aranjuez-de-noche');
}
if (want('vehiculos')) {
  // Catálogo: cada tipo de vehículo con el jugador al volante, visto desde
  // tres cuartos delantero (verifica escala, ruedas, orientación y puesto).
  const tipos = (process.env.SHOTS_TIPOS ?? 'taxi,sedan,camioneta,policia,buseta,moto').split(',');
  const hora = +(process.env.SHOTS_HORA ?? 10.5);
  for (const [i, tipo] of tipos.entries()) {
    const h = await G(([t, x, hr]) => {
      window.__game.exitVehicle();
      window.__game.setTime(hr);
      window.__game.teleport(x, 30.5);
      const v = window.__game.spawnVehicle(t);
      window.__game.enterNearest(20);
      const pv = window.__gameInstance.player.vehicle;
      if (pv) pv.siren = pv.type === 'policia';
      return v.heading;
    }, [tipo, -35 - i * 22, hora]);
    await adv(0.2);
    await G(([yaw]) => {
      window.__gameInstance.camRig.zoomLevel = 2;
      window.__game.look(yaw, -0.12);
    }, [h + Math.PI - +(process.env.SHOTS_ANG ?? 0.75)]);
    await adv(0.2);
    await shot(`20-vehiculo-${tipo}${hora >= 19 || hora < 6 ? '-noche' : ''}`);
  }
  await G(() => {
    window.__game.exitVehicle();
    window.__gameInstance.camRig.zoomLevel = 0;
  });
}
if (want('menu')) {
  await G(() => { window.__game.setTime(17.2); window.__gameInstance.hud.show(false); window.__gameInstance.setState('menu'); });
  await frames(6);
  await page.screenshot({ path: `${out}/00-menu-principal.png`, timeout: 600000 });
  console.log('captura 00-menu-principal');
  await G(() => { window.__gameInstance.hud.show(true); window.__gameInstance.setState('playing'); });
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
