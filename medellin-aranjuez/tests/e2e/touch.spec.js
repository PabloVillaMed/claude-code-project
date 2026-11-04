// Controles táctiles de punta a punta: el juego real en Chromium como un
// celular acostado (844×390, pantalla táctil). Los toques se simulan con CDP
// (Input.dispatchTouchEvent), que le llegan al juego como Pointer Events de
// tipo 'touch', igual que en un celular. `?touch=1` obliga a mostrar los
// controles (con ?autotest el juego arranca solo, sin el toque del menú).
import { test, expect } from '@playwright/test';

test.describe.configure({ mode: 'serial' });

let context;
let page;
let cdp;
let S;
const errors = [];
const G = (fn, arg) => page.evaluate(fn, arg);
const st = () => G(() => window.__game.state());
const ts = () => G(() => window.__gameInstance.touch?.state() ?? null);
const camYaw = () => G(() => window.__gameInstance.camRig.yaw);
async function frames(n) {
  const start = await G(() => window.__game.frames);
  await page.waitForFunction((t) => window.__game.frames >= t, start + n, { timeout: 600000 });
}

// Dedos sobre la pantalla: CDP quiere en cada evento todos los dedos que
// siguen puestos ([x, y, id]); un touchMove sin un dedo lo levanta.
const pts = (list) => list.map(([x, y, id = 1]) => ({ x, y, id, radiusX: 6, radiusY: 6, force: 1 }));
const touchStart = (list) => cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pts(list) });
const touchMove = (list) => cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pts(list) });
const touchEnd = () => cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
async function tap(x, y) {
  await touchStart([[x, y]]);
  await frames(1);
  await touchEnd();
}
/** Centro de un botón de los controles (por su data-id). */
async function center(id) {
  const box = await page.locator(`#touch [data-id="${id}"]`).boundingBox();
  expect(box, `botón ${id}`).toBeTruthy();
  return [box.x + box.width / 2, box.y + box.height / 2];
}
async function tapButton(id) {
  const [x, y] = await center(id);
  await tap(x, y);
}
/** Arrastra un dedo de `from` a `to` en `steps` pasos y lo deja puesto. */
async function dragAndHold(from, to, steps = 6, id = 1) {
  await touchStart([[from[0], from[1], id]]);
  for (let i = 1; i <= steps; i++) {
    const k = i / steps;
    await touchMove([[from[0] + (to[0] - from[0]) * k, from[1] + (to[1] - from[1]) * k, id]]);
  }
}

test.beforeAll(async ({ browser }, info) => {
  context = await browser.newContext({
    baseURL: info.project.use.baseURL ?? 'http://localhost:4190',
    viewport: { width: 844, height: 390 },
    hasTouch: true,
    isMobile: true,
  });
  page = await context.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/404|favicon/.test(m.text())) errors.push(m.text());
  });
  cdp = await context.newCDPSession(page);
  await page.goto('/?autotest=1&quality=baja&touch=1');
  await page.waitForFunction(() => window.__game?.ready && window.__game.state().state === 'playing', null, { timeout: 300000 });
  await frames(10);
  S = await G(() => window.__game.streetSpot(0));
});

test.afterAll(async () => {
  await context?.close();
});

test('con ?touch=1 se ven los controles a pie y el HUD se corre', async () => {
  await page.waitForFunction(() => window.__gameInstance.touch?.state().mode === 'pie', null, { timeout: 60000 });
  const t = await ts();
  expect(t.active).toBe(true);
  expect(t.visible).toBe(true);
  for (const id of ['fire', 'aim', 'jump', 'crouch', 'reload', 'weapon', 'vehicle', 'use', 'emote', 'camera', 'map', 'pause']) expect(t.buttons).toContain(id);
  expect(t.buttons).not.toContain('handbrake');
  await expect(page.locator('html')).toHaveClass(/touch-on/);
  await expect(page.locator('#touch [data-id="fire"]')).toBeVisible();
  await expect(page.locator('#touch [data-id="handbrake"]')).toBeHidden();
  // Botones de 56 px o más, dentro de la pantalla.
  for (const id of t.buttons) {
    const box = await page.locator(`#touch [data-id="${id}"]`).boundingBox();
    expect(box.width, id).toBeGreaterThanOrEqual(56);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(844);
    expect(box.y + box.height).toBeLessThanOrEqual(390);
  }
  // El minimapa sube (abajo a la izquierda va el joystick).
  const mm = await page.locator('#bottom-left').boundingBox();
  expect(mm.y).toBeLessThan(40);
  expect(errors).toEqual([]);
});

test('el joystick mueve al jugador hacia adelante (y empujado al borde, corre)', async () => {
  await G((S) => {
    window.__game.teleport(S.x, S.z);
    window.__game.look(S.yaw);
  }, S);
  await frames(3);
  const a = await st();
  await dragAndHold([150, 290], [150, 200]);
  await frames(3);
  const held = await ts();
  expect(held.stick.y).toBeGreaterThan(0.95);
  expect(held.stick.push).toBeGreaterThan(0.9);
  await frames(20);
  await touchEnd();
  await frames(3);
  const b = await st();
  expect((await ts()).stick).toBeNull();
  const moved = Math.hypot(b.x - a.x, b.z - a.z);
  expect(moved).toBeGreaterThan(2.5);
  expect((b.x - a.x) * -Math.sin(S.yaw) + (b.z - a.z) * -Math.cos(S.yaw)).toBeGreaterThan(2);
});

test('el pulgar junto al borde no mueve al jugador hasta que el dedo se mueva', async () => {
  const a = await st();
  // Esquina inferior izquierda: el centro del joystick se corre hacia adentro.
  await touchStart([[12, 384]]);
  await frames(8);
  const held = await ts();
  expect(held.stick.push).toBeLessThan(0.1);
  await touchEnd();
  await frames(2);
  const b = await st();
  expect(Math.hypot(b.x - a.x, b.z - a.z)).toBeLessThan(0.3);
});

/** Un punto de la mitad derecha sin botones encima (ahí el dedo mira). */
const freeLookPoint = () =>
  G(() => {
    for (let y = 120; y <= 300; y += 20)
      for (let x = Math.round(innerWidth * 0.55); x < innerWidth - 40; x += 20) {
        const el = document.elementFromPoint(x, y);
        if (el && !el.closest('.tc-btn')) return [x, y];
      }
    return null;
  });

test('arrastrar en la mitad derecha gira la cámara, con dos dedos a la vez', async () => {
  const y0 = await camYaw();
  const [lx, ly] = await freeLookPoint();
  // Un dedo en el joystick y otro mirando.
  await touchStart([[150, 300, 1]]);
  await touchStart([[150, 300, 1], [lx, ly, 2]]);
  for (let i = 1; i <= 6; i++) await touchMove([[150, 300, 1], [lx - i * 25, ly, 2]]);
  await frames(3);
  expect((await ts()).pointers).toBe(2);
  await touchEnd();
  await frames(2);
  const turned = Math.abs(Math.atan2(Math.sin((await camYaw()) - y0), Math.cos((await camYaw()) - y0)));
  expect(turned).toBeGreaterThan(0.3);
  expect((await ts()).pointers).toBe(0);
});

test('Saltar salta y Apuntar / Agachar se alternan', async () => {
  await frames(10);
  const y0 = (await st()).y;
  await tapButton('jump');
  let best = y0;
  for (let i = 0; i < 8; i++) {
    await frames(1);
    best = Math.max(best, (await st()).y);
  }
  expect(best).toBeGreaterThan(y0 + 0.2);
  await frames(30);
  await tapButton('aim');
  await frames(2);
  expect((await ts()).toggles.aim).toBe(true);
  await expect(page.locator('#touch [data-id="aim"]')).toHaveClass(/tc-on/);
  await tapButton('aim');
  await frames(2);
  expect((await ts()).toggles.aim).toBe(false);
  await tapButton('crouch');
  await frames(2);
  expect((await ts()).toggles.crouch).toBe(true);
  await tapButton('crouch');
  await frames(2);
  expect((await ts()).toggles.crouch).toBe(false);
});

test('Arma cambia de arma', async () => {
  await G(() => window.__game.giveAll());
  const w0 = (await st()).weapon;
  await tapButton('weapon');
  await frames(3);
  expect((await st()).weapon).not.toBe(w0);
});

test('en vehículo cambian los botones y el joystick acelera; Bajarse lo deja', async () => {
  await G((S) => {
    window.__game.teleport(S.x, S.z);
    window.__game.spawnVehicle('taxi');
  }, S);
  await frames(2);
  expect(await G(() => window.__game.enterNearest(10))).toBe(true);
  await page.waitForFunction(() => window.__gameInstance.touch.state().mode === 'vehiculo', null, { timeout: 60000 });
  const t = await ts();
  for (const id of ['handbrake', 'horn', 'exit', 'radio', 'fireVeh', 'camera', 'lookBehind', 'use', 'map', 'pause']) expect(t.buttons).toContain(id);
  expect(t.buttons).not.toContain('jump');
  await expect(page.locator('#touch [data-id="handbrake"]')).toBeVisible();
  await expect(page.locator('#touch [data-id="jump"]')).toBeHidden();
  await dragAndHold([150, 290], [150, 200]);
  await frames(40);
  const s = await st();
  await touchEnd();
  expect(s.inVehicle).toBe(true);
  expect(s.speedKmh).toBeGreaterThan(15);
  // Freno de mano hasta casi parar y bajarse.
  const [hx, hy] = await center('handbrake');
  await touchStart([[hx, hy]]);
  await frames(40);
  await touchEnd();
  await tapButton('exit');
  await page.waitForFunction(() => !window.__game.state().inVehicle, null, { timeout: 60000 });
  await page.waitForFunction(() => window.__gameInstance.touch.state().mode === 'pie', null, { timeout: 60000 });
});

test('Pausa esconde los controles; el mapa se cierra con su botón', async () => {
  await tapButton('pause');
  await page.waitForFunction(() => window.__game.state().state === 'paused', null, { timeout: 60000 });
  expect((await ts()).visible).toBe(false);
  await expect(page.locator('#touch')).toBeHidden();
  await G(() => window.__game.resume());
  await page.waitForFunction(() => window.__gameInstance.touch.state().visible, null, { timeout: 60000 });
  await tapButton('map');
  await page.waitForFunction(() => window.__game.state().state === 'map', null, { timeout: 60000 });
  const close = page.locator('#map-screen .tc-map-close');
  await expect(close).toBeVisible();
  const box = await close.boundingBox();
  expect(box.height).toBeGreaterThanOrEqual(56);
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForFunction(() => window.__game.state().state === 'playing', null, { timeout: 60000 });
  await expect(page.locator('#map-screen')).toBeHidden();
});

test('en una cinemática, tocar la pantalla la salta', async () => {
  await G(() => window.__game.playIntro());
  await page.waitForFunction(() => window.__game.story().cinematic, null, { timeout: 60000 });
  await page.waitForFunction(() => window.__gameInstance.touch.state().mode === 'cine', null, { timeout: 60000 });
  expect((await ts()).buttons).toEqual([]);
  await frames(5);
  await tap(420, 200);
  // Tras saltar queda la tarjeta de título (unos 3 s) y vuelve el juego.
  await page.waitForFunction(() => !window.__game.story().cinematic, null, { timeout: 120000 });
  await page.waitForFunction(() => window.__gameInstance.touch.state().mode === 'pie', null, { timeout: 60000 });
  expect(errors).toEqual([]);
});
