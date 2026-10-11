// Pruebas de extremo a extremo: el juego real corriendo en Chromium, con
// teclado y ratón simulados. Se usa calidad baja porque el render de CI es
// por software (SwiftShader).
import { test, expect } from '@playwright/test';

// Una sola página compartida; si una prueba falla, las demás igual se ejecutan.

let page;
let S;
let S2;
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
  // Calles reales del mapa donde probar (rectas y largas, cerca de San Cayetano).
  S = await G(() => window.__game.streetSpot(0));
  S2 = await G(() => window.__game.streetSpot(3));
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
  await G((S) => {
    window.__game.teleport(S.x, S.z);
    window.__game.look(S.yaw); // mirar a lo largo de la calle
  }, S);
  await frames(3);
  const a = await st();
  await page.keyboard.down('KeyW');
  await frames(20);
  await page.keyboard.up('KeyW');
  await frames(4);
  const b = await st();
  const walked = Math.hypot(b.x - a.x, b.z - a.z);
  expect(walked).toBeGreaterThan(2.5);
  // Fue hacia donde miraba (adelante = (-sin yaw, -cos yaw)).
  expect((b.x - a.x) * -Math.sin(S.yaw) + (b.z - a.z) * -Math.cos(S.yaw)).toBeGreaterThan(2);

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
  await G((S) => {
    window.__game.teleport(S.x, S.z);
    const v = window.__game.spawnVehicle('taxi');
    // Pararse junto a la puerta (a la derecha del vehículo).
    window.__game.teleport(v.x + Math.cos(v.heading) * 1.9, v.z - Math.sin(v.heading) * 1.9);
  }, S);
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
  await G((S2) => {
    window.__game.teleport(S2.x, S2.z);
    window.__game.spawnVehicle('moto');
  }, S2);
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

test('radio: suena al subirse, Q / Z cambian de emisora, se calla en pausa y al bajarse', async () => {
  await G((S) => {
    window.__game.teleport(S.x, S.z);
    const v = window.__game.spawnVehicle('sedan');
    window.__game.teleport(v.x + Math.cos(v.heading) * 1.9, v.z - Math.sin(v.heading) * 1.9);
  }, S);
  await frames(2);
  let r = await G(() => window.__game.radio());
  expect(r.encendida).toBe(false); // a pie no suena la radio
  await page.keyboard.press('KeyF');
  await frames(3);
  expect((await st()).inVehicle).toBe(true);
  await page.waitForFunction(() => window.__game.radio().cargada && window.__game.radio().encendida, null, { timeout: 60000 });
  r = await G(() => window.__game.radio());
  expect(r.dial).toBeGreaterThanOrEqual(0);
  expect(r.emisora).toBe(r.emisoras[r.dial]);
  expect(r.pista).toBeTruthy();
  await page.waitForFunction(() => window.__game.radio().reproduciendo, null, { timeout: 60000 });
  await expect(page.locator('#radio-hud .r-nombre')).not.toBeEmpty();
  // Q: siguiente emisora (con su letrero); Z: vuelve a la anterior.
  await page.keyboard.press('KeyQ');
  await frames(3);
  const r2 = await G(() => window.__game.radio());
  expect(r2.dial).toBe(r.dial + 1 < r.emisoras.length ? r.dial + 1 : -1);
  await expect(page.locator('#radio-hud .r-nombre')).toHaveText(new RegExp(r2.emisoraNombre.split(' ')[0], 'i'));
  await page.keyboard.press('KeyZ');
  await frames(3);
  expect((await G(() => window.__game.radio())).dial).toBe(r.dial);
  // El dial pasa por "Radio apagada".
  let off = null;
  for (let i = 0; i <= r.emisoras.length && off == null; i++) {
    await page.keyboard.press('KeyQ');
    await frames(2);
    const x = await G(() => window.__game.radio());
    if (x.dial === -1) off = x;
  }
  expect(off?.encendida).toBe(false);
  await page.keyboard.press('KeyQ');
  await frames(3);
  expect((await G(() => window.__game.radio())).encendida).toBe(true);
  // En pausa se detiene.
  await G(() => window.__game.pause());
  await frames(3);
  expect((await G(() => window.__game.radio())).reproduciendo).toBe(false);
  await G(() => window.__game.resume());
  await frames(3);
  // Al bajarse se apaga.
  await G(() => window.__game.exitVehicle());
  await page.waitForFunction(() => !window.__game.radio().encendida && window.__game.radio().ganancia < 0.05, null, { timeout: 30000 });
  expect(errors).toEqual([]);
});

test('animaciones: subirse y bajarse del carro con animación, gestos con G', async () => {
  await G((S) => {
    window.__game.teleport(S.x, S.z);
    const v = window.__game.spawnVehicle('taxi');
    window.__game.teleport(v.x - Math.cos(v.heading) * 2.2, v.z + Math.sin(v.heading) * 2.2);
    window.__game.setAnimatedBoarding(true);
  }, S);
  await frames(2);
  await page.keyboard.press('KeyF');
  await frames(2);
  expect((await st()).inVehicle).toBe(true);
  expect((await G(() => window.__game.boarding()))?.mode).toBe('enter');
  await G(() => window.__game.advance(4));
  expect(await G(() => window.__game.boarding())).toBe(null);
  // Bajarse: queda afuera de una vez (lógica) y el personaje termina de levantarse.
  await G(() => window.__gameInstance.exitVehicle());
  let s = await st();
  expect(s.inVehicle).toBe(false);
  expect((await G(() => window.__game.boarding()))?.mode).toBe('exit');
  await G(() => window.__game.advance(3));
  s = await st();
  expect(await G(() => window.__game.boarding())).toBe(null);
  expect(s.blocked).toBe(false);
  await G(() => window.__game.setAnimatedBoarding(false));
  await page.keyboard.press('KeyG');
  await frames(3);
  expect(await G(() => window.__game.playerGesture())).toBe('wave');
  expect(errors).toEqual([]);
});

test('vida de barrio: picadito en la cancha, ropa en el balcón y todos huyen con un disparo', async () => {
  // Cancha: aparece el partido cerca del jugador y el balón se mueve.
  const f = await G(() => {
    const c = window.__game.pois().find((p) => p.id === 'cancha');
    window.__game.teleport(c.x, c.z);
    const s = window.__game.activitySpot('futbol', false);
    window.__game.teleport(s.x + s.frame.nx * (s.frame.hv + 8), s.z + s.frame.nz * (s.frame.hv + 8));
    return s;
  });
  expect(f).not.toBe(null);
  const futbol = () => G(() => window.__game.activities().active.find((a) => a.kind === 'futbol') ?? null);
  await G(() => window.__game.advance(4));
  let m = await futbol();
  expect(m).not.toBe(null);
  expect(m.peds).toBeGreaterThanOrEqual(6);
  const b0 = m.info.ball;
  await G(() => window.__game.advance(4));
  m = await futbol();
  expect(Math.hypot(m.info.ball.u - b0.u, m.info.ball.v - b0.v)).toBeGreaterThan(0.5);
  // Un disparo al aire: el partido se deshace y los jugadores salen corriendo.
  await G((f) => window.__gameInstance.world.addThreat(f.x, f.z, 60, 1), f);
  await G(() => window.__game.advance(1));
  m = await futbol();
  expect(m === null || m.ended).toBe(true);
  // Balcón: la señora de la ropa queda parada sobre la losa (no en el andén).
  const r = await G(() => {
    const s = window.__game.activitySpot('ropa');
    const fx = -Math.sin(s.yaw);
    const fz = -Math.cos(s.yaw);
    window.__game.teleport(s.x + fx * 8, s.z + fz * 8);
    return s;
  });
  await G(() => window.__game.advance(3));
  const ropa = await G((r) => {
    const g = window.__gameInstance;
    const p = g.world.peds.find((q) => q.act && q.act.spot.kind === 'ropa' && Math.hypot(q.act.spot.x - r.x, q.act.spot.z - r.z) < 0.1);
    return p ? { y: p.y, rootY: p.rig.root.position.y } : null;
  }, r);
  expect(ropa).not.toBe(null);
  expect(ropa.rootY).toBeCloseTo(r.y, 1);
  expect(r.y - r.gy).toBeGreaterThan(2);
  expect(errors).toEqual([]);
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

test('locales: en Mandingas La 92 se pide comida y se acepta el encargo', async () => {
  await G(() => {
    const g = window.__gameInstance;
    g.player.health = 40;
    g.addMoney(1000);
    const p = window.__game.pois().find((x) => x.id === 'mandingas92');
    window.__game.teleport(p.x, p.z);
  });
  await frames(3);
  await page.keyboard.press('KeyE');
  await expect(page.locator('#shop')).toBeVisible();
  await expect(page.locator('#shop-title')).toHaveText('Mandingas La 92');
  await page.locator('#shop-items button').first().click();
  expect((await st()).health).toBeGreaterThan(40);
  await page.locator('#shop-items button', { hasText: 'Aceptar' }).click();
  await expect(page.locator('#shop')).toBeHidden();
  await frames(3);
  expect((await st()).mission).toBe('mandingas');
  // De vuelta en la calle recibe lo que pidió (y después se lo come).
  expect(['take', 'drink']).toContain(await G(() => window.__game.playerGesture()));
  await G(() => {
    const g = window.__gameInstance;
    g._handleMissionEvents(g.missions.cancel());
  });
});

test('ropa: en Gorras y Tenis La 52 se compra una gorra, se pone, se quita y queda guardada', async () => {
  await G(() => {
    window.__gameInstance.addMoney(2000);
    const p = window.__game.pois().find((x) => x.id === 'gorras52');
    window.__game.teleport(p.x, p.z);
  });
  await frames(3);
  await page.keyboard.press('KeyE');
  await expect(page.locator('#shop')).toBeVisible();
  await expect(page.locator('#shop-title')).toHaveText('Gorras y Tenis La 52');
  await expect(page.locator('#shop-kicker')).toHaveText('Almacén de ropa');
  const m0 = (await st()).money;
  // La fila de la gorra por su nombre exacto (la de "Quitarse la gorra" también la menciona).
  const row = page.locator('.shop-item').filter({ has: page.locator('.name', { hasText: /^Gorra plana roja$/ }) });
  await expect(row.locator('button')).toHaveText('$90');
  await row.locator('button').click();
  await expect(row.locator('button')).toHaveText('Puesto');
  expect((await st()).money).toBe(m0 - 90);
  expect((await G(() => window.__game.outfit())).outfit.cabeza).toBe('gorra-plana-roja');
  // La gorra va pegada al hueso de la cabeza del avatar.
  const onHead = () => G(() => {
    let bone = null;
    window.__gameInstance.player.rig.root.traverse((o) => {
      if (o.name === 'ropa-gorra-plana-roja') bone = o.parent?.name ?? null;
    });
    return bone;
  });
  expect(await onHead()).toBe('Bip01_Head');
  // Quitársela y volvérsela a poner (ya es suya: gratis).
  await page.locator('.shop-item', { hasText: 'Quitarse la gorra' }).locator('button').click();
  expect((await G(() => window.__game.outfit())).outfit.cabeza).toBeUndefined();
  expect(await onHead()).toBe(null);
  await expect(row.locator('button')).toHaveText('Ponerse');
  await row.locator('button').click();
  expect((await st()).money).toBe(m0 - 90);
  await page.locator('button[data-action="close-shop"]').click();
  await expect(page.locator('#shop')).toBeHidden();
  // Queda en el guardado.
  const saved = await G(() => JSON.parse(localStorage.getItem('aranjuez.save.v1')).ropa);
  expect(saved.outfit.cabeza).toBe('gorra-plana-roja');
  expect(saved.owned).toContain('gorra-plana-roja');
});

test('policía: con estrellas aparecen patrullas', async () => {
  await G((S) => {
    window.__game.teleport(S.x, S.z);
    window.__game.addWanted(2);
  }, S);
  // La primera patrulla llega en cuanto el despacho la asigna; con el render
  // por software cada cuadro tarda distinto, así que se espera a que aparezca.
  await page.waitForFunction(() => window.__game.state().police >= 1, null, { timeout: 180000 });
  const s = await st();
  expect(s.wanted).toBeGreaterThanOrEqual(2);
  expect(s.police).toBeGreaterThanOrEqual(1);
});

test('de noche: faros encendidos; el derrape deja marcas', async () => {
  await G((S) => {
    window.__game.setTime(21);
    window.__game.teleport(S.x, S.z);
    window.__game.spawnVehicle('sedan');
    window.__game.enterNearest(20);
  }, S);
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

test('cámara: X cambia de hombro, primera persona desde Configuración y vista de vehículo por defecto', async () => {
  const cam = () =>
    G(() => {
      const g = window.__gameInstance;
      const c = g.camera.position;
      const yaw = g.camRig.yaw;
      const p = g.player;
      // Lado de la cámara respecto a la mirada: > 0 a la derecha del jugador.
      return { side: (c.x - p.x) * Math.cos(yaw) - (c.z - p.z) * Math.sin(yaw), dy: c.y - p.y, view: g.camRig.footViewName, veh: g.camRig.vehicleViewName };
    });
  await G(([x, z]) => window.__game.teleport(x, z), [S.x, S.z]);
  await G(() => window.__game.look(0, -0.1));
  await frames(20);
  const a = await cam();
  await page.keyboard.press('KeyX');
  await frames(25);
  const b = await cam();
  expect(Math.sign(a.side)).not.toBe(Math.sign(b.side));
  await page.keyboard.press('KeyX');
  // Configuración: primera persona y capó por defecto.
  await page.keyboard.press('Escape');
  await frames(2);
  await page.locator('#pause [data-action="settings"]').click();
  await page.locator('#set-fp').check();
  await page.locator('#set-vehview').selectOption('capo');
  await page.locator('#set-smooth').fill('0.8');
  await expect(page.locator('#set-smooth-val')).toHaveText('80 %');
  const saved = await G(() => JSON.parse(localStorage.getItem('aranjuez.settings.v1')));
  expect(saved.firstPerson).toBe(true);
  expect(saved.vehicleView).toBe('capo');
  await page.locator('#settings [data-action="back"]').click();
  await page.locator('#pause [data-action="resume"]').click();
  await frames(2);
  for (let i = 0; i < 4 && (await cam()).view !== 'primera'; i++) {
    await page.keyboard.press('KeyV');
    await frames(3);
  }
  await frames(10);
  const fp = await cam();
  expect(fp.view).toBe('primera');
  expect(fp.dy).toBeGreaterThan(1.3);
  expect(fp.dy).toBeLessThan(1.8);
  expect(fp.veh).toBe('capo');
  // Dejar la cámara y la configuración como estaban.
  await G(() => {
    const g = window.__gameInstance;
    Object.assign(g.settings, { firstPerson: false, vehicleView: 'cerca', camSmoothing: 0.5 });
    g._appliedVehicleView = null;
    g.applyCameraSettings();
  });
  expect((await cam()).view).toBe('normal');
  expect(errors).toEqual([]);
});

test('pájaros: palomas en el parque que se espantan con un tiro; gallinazos de día', async () => {
  await G(() => window.__game.setTime(12));
  const home = await G(() => window.__game.birds().homes.find((h) => h.id === 'parque'));
  expect(home).toBeTruthy();
  await G(([x, z]) => window.__game.teleport(x, z), [home.x + 25, home.z]);
  await frames(2);
  let b = await G(() => window.__game.advanceBirds(2));
  const h = b.homes.find((q) => q.id === 'parque');
  expect(h.active).toBe(true);
  expect(h.n).toBeGreaterThan(3);
  expect(h.state).toBe('ground');
  expect(b.vultures).toBeGreaterThan(0);
  await frames(3);
  expect((await G(() => window.__game.birds())).drawn).toBeGreaterThan(3);
  // Un tiro cerca (el mismo evento que emite el combate).
  await G(([x, z]) => window.__gameInstance.events.emit('shot', { x, z, by: 'player', weapon: 'pistol' }), [home.x + 10, home.z]);
  b = await G(() => window.__game.advanceBirds(2));
  const h2 = b.homes.find((q) => q.id === 'parque');
  expect(h2.state).toBe('fly');
  expect(h2.flying).toBe(h2.n);
  expect(errors).toEqual([]);
});

test('cielo: nubes según la hora y el cielo se rehornea solo si el sol se mueve', async () => {
  const sky = () => G(() => ({ cover: window.__gameInstance.env.cover, bakes: window.__gameInstance.env.skyDome.bakes }));
  await G(() => window.__game.setTime(8));
  await frames(3);
  const morning = await sky();
  await G(() => window.__game.setTime(15.5));
  await frames(3);
  const afternoon = await sky();
  expect(afternoon.cover).toBeGreaterThan(morning.cover);
  expect(afternoon.bakes).toBeGreaterThan(morning.bakes);
  await G(() => window.__game.pause());
  await frames(5);
  const paused = await sky();
  await frames(10);
  expect((await sky()).bakes).toBe(paused.bakes);
  await G(() => window.__game.resume());
  await G(() => window.__game.setTime(20));
  await frames(3);
  expect(await G(() => window.__gameInstance.env.night)).toBeGreaterThan(0.9);
  await G(() => window.__game.setTime(16.5));
  expect(errors).toEqual([]);
});
