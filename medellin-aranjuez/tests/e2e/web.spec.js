// Pruebas de la versión web tal como queda en GitHub Pages: el build servido
// bajo la subruta /claude-code-project/ (https://pablovillamed.github.io/claude-code-project/),
// SIN ?autotest (arranca como lo ve un visitante, hasta el menú) y en calidad
// baja porque el render de CI es por software (puede tardar varios minutos).
// Revisa la app instalable (manifiesto e íconos), que no salga el botón Salir y
// que el service worker deje el juego andando sin conexión.
import { test, expect } from '@playwright/test';

const MIN = 60 * 1000;
const BASE_PATH = '/claude-code-project/';

let context;
let page;
let root; // URL absoluta de la subruta (baseURL del proyecto 'web')
const pageErrors = [];
const consoleErrors = [];
const outside = []; // pedidos al mismo servidor por fuera de la subruta
const failedResponses = [];

// El favicon lo pide el navegador en la raíz del dominio; los 404 de recursos
// se revisan aparte (assetReport y failedResponses), como en gameplay.spec.js.
const ignorable = (t) => /404|favicon/.test(t);
// Sin conexión fallan, a propósito, los pedidos que no están en caché (la radio).
const networkish = (t) => /ERR_INTERNET_DISCONNECTED|ERR_NETWORK|Failed to (load resource|fetch)|NetworkError|net::/i.test(t);

const toMenu = (p, timeout = 6 * MIN) => p.waitForFunction(() => window.__game?.ready && window.__game.state().state === 'menu', null, { timeout, polling: 500 });

test.beforeAll(async ({ browser }, testInfo) => {
  root = new URL(testInfo.project.use.baseURL ?? `http://localhost:4191${BASE_PATH}`).href;
  const origin = new URL(root).origin;
  // Contexto propio: el service worker y la caché no se mezclan con otras pruebas.
  context = await browser.newContext({ serviceWorkers: 'allow' });
  page = await context.newPage();
  page.on('pageerror', (e) => pageErrors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !ignorable(m.text())) consoleErrors.push(m.text());
  });
  page.on('request', (r) => {
    const u = new URL(r.url());
    // Los blob: (texturas decodificadas) comparten el origen pero no van al servidor.
    if (/^https?:$/.test(u.protocol) && u.origin === origin && !u.pathname.startsWith(BASE_PATH) && !/favicon/.test(u.pathname)) outside.push(r.url());
  });
  page.on('response', (r) => {
    if (r.status() >= 400 && !/favicon/.test(r.url())) failedResponses.push(`${r.status()} ${r.url()}`);
  });
  // El aviso al cerrar (beforeunload) no debe trancar la recarga.
  page.on('dialog', (d) => d.accept().catch(() => {}));
  await page.goto(new URL('?quality=baja', root).href);
  await toMenu(page);
});

test.afterAll(async () => {
  await context?.setOffline(false).catch(() => {});
  await context?.close();
});

test('arranca hasta el menú bajo la subruta, sin errores ni recursos fallidos', async () => {
  expect(new URL(page.url()).pathname).toBe(BASE_PATH);
  expect((await page.evaluate(() => window.__game.state())).state).toBe('menu');
  await expect(page.locator('#menu')).toBeVisible();
  const report = await page.evaluate(() => window.__gameInstance.assetReport);
  expect(report.loaded).toBeGreaterThan(0);
  expect(report.failed).toEqual([]);
  expect(outside, 'pedidos por fuera de /claude-code-project/ (rutas absolutas en vez de relativas)').toEqual([]);
  expect(failedResponses).toEqual([]);
  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test('manifiesto de la app instalable: JSON válido, con nombre e íconos que cargan', async () => {
  const link = page.locator('link[rel="manifest"]');
  await expect(link).toHaveCount(1, { timeout: 5000 }); // la página ya cargó: no hay que esperarlo
  const href = await link.evaluate((l) => l.href); // ya resuelta contra la página
  expect(href.startsWith(root), `el manifiesto (${href}) debe quedar bajo ${root}`).toBe(true);
  const res = await context.request.get(href);
  expect(res.status()).toBe(200);
  const manifest = JSON.parse(await res.text());
  expect(typeof manifest.name).toBe('string');
  expect(manifest.name.length).toBeGreaterThan(0);
  expect(Array.isArray(manifest.icons)).toBe(true);
  expect(manifest.icons.length).toBeGreaterThan(0);
  // start_url y scope se resuelven contra la URL del manifiesto: deben caer en la subruta.
  for (const k of ['start_url', 'scope']) {
    if (manifest[k] !== undefined) expect(new URL(manifest[k], href).href.startsWith(root), `${k}: ${manifest[k]}`).toBe(true);
  }
  for (const icon of manifest.icons) {
    const u = new URL(icon.src, href).href;
    expect(u.startsWith(root), u).toBe(true);
    const r = await context.request.get(u);
    expect(r.status(), u).toBe(200);
    expect(r.headers()['content-type'], u).toMatch(/^image\//);
  }
});

test('en la web no hay botón Salir', async () => {
  await expect(page.locator('#menu [data-action="play"]')).toBeVisible();
  await expect(page.locator('[data-action="quit"]')).toBeHidden();
});

test('service worker: precarga bajo la subruta y el juego vuelve a arrancar sin conexión', async () => {
  // Se registra cuando el juego ya cargó; la instalación baja la precarga.
  const reg = await page.evaluate(
    (ms) =>
      Promise.race([
        navigator.serviceWorker.ready.then((r) => ({ scope: r.scope, state: r.active?.state ?? null })),
        new Promise((res) => setTimeout(() => res(null), ms)),
      ]),
    4 * MIN,
  );
  expect(reg, 'no se registró ningún service worker').not.toBeNull();
  expect(reg.scope.endsWith(BASE_PATH), reg.scope).toBe(true);
  expect(['activating', 'activated']).toContain(reg.state);

  // La caché de precarga ('medellin-<BUILD>', no la de uso 'medellin-runtime…') con index.html.
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          const index = new URL('index.html', location.href).href;
          const dir = new URL('./', location.href).href;
          for (const k of await caches.keys()) {
            if (!k.startsWith('medellin-') || k.startsWith('medellin-runtime')) continue;
            const c = await caches.open(k);
            if ((await c.match(index, { ignoreSearch: true })) || (await c.match(dir, { ignoreSearch: true }))) return k;
          }
          return null;
        }),
      { timeout: 5 * MIN, intervals: [1000], message: 'no apareció la caché de precarga medellin-<BUILD> con index.html' },
    )
    .toBeTruthy();
  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);

  const marks = [pageErrors.length, consoleErrors.length];
  await context.setOffline(true);
  try {
    const res = await page.reload({ waitUntil: 'domcontentloaded', timeout: 2 * MIN });
    expect(res?.fromServiceWorker(), 'la página no salió del service worker').toBe(true);
    await toMenu(page);
    expect(await page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
    expect((await page.evaluate(() => window.__game.state())).state).toBe('menu');
    const report = await page.evaluate(() => window.__gameInstance.assetReport);
    expect(report.failed, 'recursos que no quedaron en la caché').toEqual([]);
    const errs = [...pageErrors.slice(marks[0]), ...consoleErrors.slice(marks[1])].filter((t) => !networkish(t));
    expect(errs).toEqual([]);
  } finally {
    await context.setOffline(false);
  }
});
