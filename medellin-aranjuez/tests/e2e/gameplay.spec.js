// Pruebas de extremo a extremo: el juego real corriendo en Chromium, con
// teclado y ratón simulados. Se usa calidad baja porque el render de CI es
// por software (SwiftShader).
import { test, expect } from '@playwright/test';

// Una sola página compartida; si una prueba falla, las demás igual se ejecutan.

let page;
const errors = [];
const G = (fn, arg) => page.evaluate(fn, arg);
const st = () => G(() => window.__game.state());
async function frames(n) {
  const start = await G(() => window.__game.frames);
  await page.waitForFunction((t) => window.__game.frames >= t, start + n, { timeout: 600000 });
}

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/404|favicon/.test(m.text())) errors.push(m.text());
  });
  await page.goto('/?autotest=1&quality=baja');
  await page.waitForFunction(() => window.__game?.ready && window.__game.state().state === 'playing', null, { timeout: 300000 });
  await frames(10);
});

test.afterAll(async () => {
  await page?.close();
});

test('arranca sin errores, con HUD, NPCs y tráfico', async () => {
  const s = await st();
  expect(s.state).toBe('playing');
  expect(s.health).toBe(100);
  expect(s.peds).toBeGreaterThan(5);
  expect(s.vehicles).toBeGreaterThan(10);
  expect(s.blocked).toBe(false);
  await expect(page.locator('#hud')).toBeVisible();
  await expect(page.locator('#money')).toContainText('$');
  await expect(page.locator('#minimap')).toBeVisible();
  expect(errors).toEqual([]);
});

test('movilidad a pie con teclado: caminar, correr y saltar', async () => {
  await G(() => {
    window.__game.teleport(0, 30.5);
    window.__game.look(Math.PI / 2); // mirar al oeste, por la calle
  });
  await frames(3);
  const a = await st();
  await page.keyboard.down('KeyW');
  await frames(20);
  await page.keyboard.up('KeyW');
  await frames(4);
  const b = await st();
  const walked = Math.hypot(b.x - a.x, b.z - a.z);
  expect(walked).toBeGreaterThan(2.5);
  expect(b.x).toBeLessThan(a.x); // fue hacia el oeste

  await page.keyboard.down('ShiftLeft');
  await page.keyboard.down('KeyW');
  await frames(20);
  await page.keyboard.up('KeyW');
  await page.keyboard.up('ShiftLeft');
  await frames(4);
  const c = await st();
  expect(Math.hypot(c.x - b.x, c.z - b.z)).toBeGreaterThan(walked * 1.3);

  const y0 = (await st()).y;
  await page.keyboard.down('Space');
  await frames(4);
  const mid = await st();
  await page.keyboard.up('Space');
  expect(mid.y).toBeGreaterThan(y0 + 0.3);
  expect(mid.onGround).toBe(false);
  await frames(30);
  const land = await st();
  expect(land.onGround).toBe(true);
  expect(land.blocked).toBe(false);
});

test('selección de armas con números y rueda del ratón, disparo y recarga', async () => {
  await G(() => window.__game.giveAll());
  await page.keyboard.press('Digit3');
  await frames(12);
  expect((await st()).weapon).toBe('pistol');
  await page.keyboard.press('Digit6');
  await frames(12);
  expect((await st()).weapon).toBe('rifle');
  await page.mouse.move(400, 225);
  await page.mouse.wheel(0, 100);
  await frames(3);
  expect((await st()).weapon).toBe('fists');
  await page.keyboard.press('Digit6');
  await frames(12);
  const before = (await st()).ammo.mag;
  // Disparar hacia el cielo (sin testigos cerca no hay delito asegurado).
  await G(() => window.__game.look(Math.PI / 2, 0.8));
  await page.mouse.down({ button: 'left' });
  await frames(6);
  await page.mouse.up({ button: 'left' });
  await frames(2);
  const after = (await st()).ammo.mag;
  expect(after).toBeLessThan(before);
  await page.keyboard.press('KeyR');
  await frames(50);
  expect((await st()).ammo.mag).toBe(30);
});

test('vehículos: subirse, conducir, frenar y bajarse', async () => {
  await G(() => {
    window.__game.teleport(0, 30.5);
    const v = window.__game.spawnVehicle('taxi');
    // Pararse junto a la puerta (a la derecha del vehículo).
    window.__game.teleport(v.x + Math.cos(v.heading) * 1.9, v.z - Math.sin(v.heading) * 1.9);
  });
  await frames(2);
  await page.keyboard.press('KeyF');
  await frames(3);
  let s = await st();
  expect(s.inVehicle).toBe(true);
  expect(s.vehicleType).toBeTruthy();
  const x0 = s.x;
  const z0 = s.z;
  await page.keyboard.down('KeyW');
  await frames(40);
  s = await st();
  expect(s.speedKmh).toBeGreaterThan(20);
  expect(Math.hypot(s.x - x0, s.z - z0)).toBeGreaterThan(8);
  await page.keyboard.up('KeyW');
  await page.keyboard.down('KeyS');
  await frames(40);
  await page.keyboard.up('KeyS');
  await page.keyboard.down('Space');
  await frames(20);
  await page.keyboard.up('Space');
  s = await st();
  expect(Math.abs(s.speedKmh)).toBeLessThan(25);
  await page.keyboard.press('KeyF');
  await frames(3);
  s = await st();
  expect(s.inVehicle).toBe(false);
  expect(s.blocked).toBe(false);
});

test('moto: aceleración y giro', async () => {
  await G(() => {
    window.__game.teleport(210, 40);
    window.__game.spawnVehicle('moto');
  });
  await frames(2);
  expect(await G(() => window.__game.enterNearest(10))).toBe(true);
  expect((await st()).vehicleType).toBe('moto');
  await page.keyboard.down('KeyW');
  await frames(25);
  const fast = await st();
  expect(fast.speedKmh).toBeGreaterThan(25);
  // Giro corto a la derecha: el rumbo cambia sin perder la moto.
  await page.keyboard.down('KeyD');
  await frames(6);
  await page.keyboard.up('KeyD');
  await page.keyboard.up('KeyW');
  const s = await st();
  const turned = Math.abs(Math.atan2(Math.sin(s.yaw - fast.yaw), Math.cos(s.yaw - fast.yaw)));
  expect(turned).toBeGreaterThan(0.08);
  expect(s.inVehicle).toBe(true);
  await G(() => window.__game.exitVehicle());
});

test('puntos de interés: descubrir un lugar da plata y queda registrado', async () => {
  const m0 = (await st()).money;
  await G(() => {
    const p = window.__game.pois().find((x) => x.id === 'museo');
    window.__game.teleport(p.x, p.z);
  });
  await frames(5);
  const s = await st();
  expect(s.discovered).toContain('museo');
  expect(s.money).toBeGreaterThan(m0);
  await expect(page.locator('#poi-banner')).toContainText('Pedro Nel');
});

test('misión Domicilio express completa de principio a fin', async () => {
  await G(() => {
    const p = window.__game.pois().find((x) => x.id === 'parque');
    window.__game.teleport(p.x, p.z);
  });
  await frames(3);
  await page.keyboard.press('KeyE');
  await frames(3);
  expect((await st()).mission).toBe('domicilio');
  const m0 = (await st()).money;
  await G(() => {
    const p = window.__game.pois().find((x) => x.id === 'museo');
    window.__game.teleport(p.x, p.z);
  });
  await frames(3);
  expect((await st()).missionStage).toBe(1);
  await G(() => {
    const p = window.__game.pois().find((x) => x.id === 'metro');
    window.__game.teleport(p.x, p.z);
  });
  await frames(3);
  const s = await st();
  expect(s.mission).toBe(null);
  expect(s.completed).toContain('domicilio');
  expect(s.money).toBeGreaterThanOrEqual(m0 + 900);
});

test('policía: con estrellas aparecen patrullas', async () => {
  await G(() => {
    window.__game.teleport(0, 30.5);
    window.__game.addWanted(2);
  });
  // La primera patrulla llega en cuanto el despacho la asigna; con el render
  // por software cada cuadro tarda distinto, así que se espera a que aparezca.
  await page.waitForFunction(() => window.__game.state().police >= 1, null, { timeout: 180000 });
  const s = await st();
  expect(s.wanted).toBeGreaterThanOrEqual(2);
  expect(s.police).toBeGreaterThanOrEqual(1);
});

test('de noche: faros encendidos; el derrape deja marcas', async () => {
  await G(() => {
    window.__game.setTime(21);
    window.__game.teleport(0, 30.5);
    window.__game.spawnVehicle('sedan');
    window.__game.enterNearest(20);
  });
  await G(() => window.__game.advance(3.5, { throttle: 1 }));
  await G(() => window.__game.advance(1, { throttle: 0.3, steer: 1, handbrake: true }));
  await frames(3);
  const l = await G(() => window.__game.lights());
  expect(l.night).toBeGreaterThan(0.5);
  expect(l.on).toBe(true);
  expect(l.pools).toBeGreaterThan(0); // luz de los faros sobre el asfalto
  expect(l.skids).toBeGreaterThan(0);
  await G(() => {
    window.__game.exitVehicle();
    window.__game.setTime(16.5);
  });
  await frames(2);
});

test('morir lleva al hospital y cobra la cuenta', async () => {
  // El hospital ya "descubierto": si no, reaparecer allí paga $100 de
  // descubrimiento y el saldo depende del orden de las pruebas.
  await G(() => window.__gameInstance.discovered.add('hospital'));
  const m0 = (await st()).money;
  await G(() => window.__game.damage(500));
  await frames(2);
  expect((await st()).dead).toBe(true);
  // 5 s de juego simulados (el render por software de CI es muy lento).
  await G(() => window.__game.advance(5.5));
  await frames(2);
  const s = await st();
  expect(s.dead).toBe(false);
  expect(s.health).toBe(100);
  expect(s.wanted).toBe(0);
  expect(s.money).toBeLessThan(m0);
  const h = await G(() => window.__game.pois().find((x) => x.id === 'hospital'));
  expect(Math.hypot(s.x - h.x, s.z - h.z)).toBeLessThan(3);
});

test('pausa y reanudar', async () => {
  await page.keyboard.press('Escape');
  await frames(2);
  expect((await st()).state).toBe('paused');
  await expect(page.locator('#pause')).toBeVisible();
  await page.locator('#pause [data-action="resume"]').click();
  await frames(2);
  expect((await st()).state).toBe('playing');
  expect(errors).toEqual([]);
});

test('configuración: brillo y pantalla completa', async () => {
  await page.keyboard.press('Escape');
  await frames(2);
  await page.locator('#pause [data-action="settings"]').click();
  await expect(page.locator('#settings')).toBeVisible();
  const exposure = () => G(() => window.__gameInstance.renderer.toneMappingExposure);
  const before = await exposure();
  // Subir el brillo al máximo sube la exposición en la misma proporción.
  await page.locator('#set-bright').fill('1.8');
  await frames(2);
  await expect(page.locator('#set-bright-val')).toHaveText('180 %');
  expect(await exposure()).toBeGreaterThan(before * 1.5);
  // Queda guardado para la próxima sesión.
  expect(await G(() => JSON.parse(localStorage.getItem('aranjuez.settings.v1')).brightness)).toBe(1.8);
  await page.locator('#set-bright').fill('1');
  await frames(2);
  // La casilla de pantalla completa pide el modo al navegador.
  await page.locator('#set-full').check();
  await page.waitForFunction(() => !!document.fullscreenElement, null, { timeout: 10000 });
  await page.keyboard.press('F11');
  await page.waitForFunction(() => !document.fullscreenElement, null, { timeout: 10000 });
  await expect(page.locator('#set-full')).not.toBeChecked();
  await page.locator('#settings [data-action="back"]').click();
  await page.locator('#pause [data-action="resume"]').click();
  await frames(2);
  expect((await st()).state).toBe('playing');
  expect(errors).toEqual([]);
});
