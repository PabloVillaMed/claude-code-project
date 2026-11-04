import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { classify, formatSummary, injectServiceWorker, listFiles, PLACEHOLDERS, planServiceWorker, REV_LENGTH, revision } from '../../scripts/web/swManifest.js';
import { handleSwKillSwitch, registerServiceWorker, secureOrigin } from '../../src/web/pwa.js';

const TEMPLATE = fs.readFileSync(new URL('../../src/web/sw-template.js', import.meta.url), 'utf8');
const SCOPE = 'https://pablovillamed.github.io/claude-code-project/';

describe('listas del service worker', () => {
  it('clasifica cada archivo de dist/', () => {
    const casos = {
      'index.html': 'precache',
      'manifest.webmanifest': 'precache',
      'icons/icon-192.png': 'precache',
      'assets/index-BoHH62dh.js': 'precache',
      'assets/engineWorklet-CtLFu6D4.js': 'precache',
      'assets/barlow-latin-400-normal-qiz4-Cze.woff2': 'precache',
      'assets/barlow-latin-400-normal-fsAxiSwU.woff': 'exclude',
      'assets/exportUnreal-CXQw6bZG.js': 'exclude',
      'models/personajes/male01.glb': 'precache',
      'models/armas/iconos/pistol.png': 'precache',
      'models/armas/CREDITOS.txt': 'exclude',
      'models/personajes/LICENSE-Rocketbox.md': 'exclude',
      'textures/red_brick/color.webp': 'precache',
      'textures/red_brick/hd/color.webp': 'runtime',
      'hdri/kloofendal_48d_partly_cloudy_puresky.hdr': 'precache',
      'hdri/kloofendal_48d_partly_cloudy_puresky_2k.hdr': 'runtime',
      'sounds/armas/pistola_1.ogg': 'precache',
      'sounds/motor/motor.json': 'precache',
      'sounds/historia/intro-1.ogg': 'precache',
      'sounds/voces/manifest.json': 'precache',
      'sounds/voces/apuntado-01-h1.ogg': 'runtime',
      'sounds/musica/manifest.json': 'precache',
      'sounds/musica/chill/pista-01.ogg': 'network',
      'sw.js': 'exclude',
      'assets/index-BoHH62dh.js.map': 'exclude',
      'raro.bin': null,
    };
    for (const [rel, kind] of Object.entries(casos)) expect(classify(rel), rel).toBe(kind);
  });

  it('revisiones deterministas: prefijo del SHA-256', () => {
    const a = revision(Buffer.from('hola parce'));
    expect(a).toHaveLength(REV_LENGTH);
    expect(a).toBe(revision(Buffer.from('hola parce')));
    expect(a).toBe(createHash('sha256').update('hola parce').digest('hex').slice(0, REV_LENGTH));
    expect(revision(Buffer.from('hola parce!'))).not.toBe(a);
  });

  it('arma las listas, los tamaños y un BUILD que solo cambia si cambia algo', () => {
    const files = [
      { rel: 'index.html', size: 1000, rev: 'aaa' },
      { rel: 'assets/index-1.js', size: 4000, rev: 'bbb' },
      { rel: 'assets/exportUnreal-1.js', size: 500, rev: 'zzz' },
      { rel: 'sounds/voces/x-h1.ogg', size: 300, rev: 'ccc' },
      { rel: 'sounds/musica/chill/a.ogg', size: 9000 },
      { rel: 'models/armas/CREDITOS.txt', size: 10 },
      { rel: 'raro.bin', size: 1 },
    ];
    const plan = planServiceWorker(files, { version: '3.3.0' });
    expect(plan.precache).toEqual({ 'assets/index-1.js': 'bbb', 'index.html': 'aaa' });
    expect(plan.runtime).toEqual({ 'sounds/voces/x-h1.ogg': 'ccc' });
    expect(plan.network).toEqual(['sounds/musica/chill/a.ogg']);
    expect(plan.excluded).toEqual(['assets/exportUnreal-1.js', 'models/armas/CREDITOS.txt']);
    expect(plan.unknown).toEqual(['raro.bin']);
    expect(plan.precacheBytes).toBe(5000);
    expect(plan.runtimeBytes).toBe(300);
    expect(plan.build).toMatch(/^[0-9a-f]{10}$/);
    // El orden de entrada no importa; cambiar una revisión o la versión, sí.
    expect(planServiceWorker([...files].reverse(), { version: '3.3.0' }).build).toBe(plan.build);
    expect(planServiceWorker(files.map((f) => (f.rel === 'index.html' ? { ...f, rev: 'aab' } : f)), { version: '3.3.0' }).build).not.toBe(plan.build);
    expect(planServiceWorker(files, { version: '3.4.0' }).build).not.toBe(plan.build);
    // Lo que va a la red o se excluye no cuenta en el BUILD.
    expect(planServiceWorker(files.filter((f) => f.rel !== 'sounds/musica/chill/a.ogg'), { version: '3.3.0' }).build).toBe(plan.build);
    expect(formatSummary(plan)).toMatch(/^Service worker: 2 archivos precargados \(0\.0 MB\), 1 bajo demanda/);
  });

  it('lee el disco: rutas con "/" y la revisión del contenido', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sw-dist-'));
    try {
      fs.mkdirSync(path.join(dir, 'models', 'armas'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'index.html'), '<html>');
      fs.writeFileSync(path.join(dir, 'models', 'armas', 'pistol.glb'), 'glb');
      const files = listFiles(dir);
      expect(files.map((f) => f.rel)).toEqual(['index.html', 'models/armas/pistol.glb']);
      expect(files[1].size).toBe(3);
      expect(planServiceWorker(files).precache['models/armas/pistol.glb']).toBe(revision(Buffer.from('glb')));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('inyecta versión, BUILD y listas en la plantilla (y exige cada marca una vez)', () => {
    for (const mark of Object.values(PLACEHOLDERS)) expect(TEMPLATE.split(mark)).toHaveLength(2);
    // La plantilla sin llenar es JS válido; la llena también.
    expect(() => new vm.Script(TEMPLATE)).not.toThrow();
    const code = injectServiceWorker(TEMPLATE, { version: '3.3.0', build: 'abc123', precache: { 'index.html': 'r1' }, runtime: { 'sounds/voces/a.ogg': 'r2' } });
    expect(() => new vm.Script(code)).not.toThrow();
    expect(code).toContain('const VERSION = "3.3.0";');
    expect(code).toContain('const BUILD = "abc123";');
    expect(code).toContain('const PRECACHE = {"index.html":"r1"};');
    expect(code).toContain('const RUNTIME = {"sounds/voces/a.ogg":"r2"};');
    for (const mark of Object.values(PLACEHOLDERS)) expect(code).not.toContain(mark);
    expect(() => injectServiceWorker('const VERSION = 1;', { version: '1', build: 'b', precache: {}, runtime: {} })).toThrow(/marca/);
  });
});

// ------------------------------------------------------------------------
// El SW generado, corriendo en node:vm con caché, red y eventos de mentiras.

class FakeCache {
  constructor() {
    this.map = new Map();
  }
  static key(req) {
    return typeof req === 'string' ? req : req.url;
  }
  async match(req) {
    const e = this.map.get(FakeCache.key(req));
    return e ? new Response(e.body.slice(0), { status: e.status, headers: e.headers }) : undefined;
  }
  async put(req, res) {
    this.map.set(FakeCache.key(req), { body: new Uint8Array(await res.arrayBuffer()), status: res.status, headers: [...res.headers] });
  }
  async keys() {
    return [...this.map.keys()].map((url) => ({ url }));
  }
  async delete(req) {
    return this.map.delete(FakeCache.key(req));
  }
}

class FakeCacheStorage {
  constructor() {
    this.all = new Map();
  }
  async open(name) {
    if (!this.all.has(name)) this.all.set(name, new FakeCache());
    return this.all.get(name);
  }
  async has(name) {
    return this.all.has(name);
  }
  async keys() {
    return [...this.all.keys()];
  }
  async delete(name) {
    return this.all.delete(name);
  }
  async match(req, { cacheName } = {}) {
    for (const name of cacheName ? [cacheName] : [...this.all.keys()]) {
      const hit = await this.all.get(name)?.match(req);
      if (hit) return hit;
    }
    return undefined;
  }
}

/** Servidor estático de mentiras: `files` es { ruta: contenido }; anota cada pedido. */
function fakeServer(files) {
  const calls = [];
  const fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    calls.push({ rel: url.startsWith(SCOPE) ? url.slice(SCOPE.length) : url, cache: init.cache });
    if (!url.startsWith(SCOPE)) throw new TypeError('Failed to fetch');
    const rel = new URL(url).pathname.slice(new URL(SCOPE).pathname.length) || 'index.html';
    if (!(rel in files)) return new Response('No encontrado', { status: 404 });
    return new Response(files[rel], { status: 200, headers: { 'content-type': 'application/octet-stream', 'content-encoding': 'gzip', 'content-length': '7' } });
  };
  return { fetch, calls, files };
}

function buildSw(files, version = '1.0.0') {
  const plan = planServiceWorker(
    Object.entries(files).map(([rel, data]) => ({ rel, size: data.length, data: Buffer.from(data) })),
    { version },
  );
  return { plan, code: injectServiceWorker(TEMPLATE, plan) };
}

/** Carga el SW en un contexto aislado y devuelve cómo dispararle eventos. */
function runSw(code, { caches, fetch }) {
  const listeners = {};
  const self = {
    registration: { scope: SCOPE },
    location: { href: `${SCOPE}sw.js` },
    crypto: globalThis.crypto,
    clients: { claim: vi.fn(async () => {}) },
    skipWaiting: vi.fn(async () => {}),
    addEventListener: (type, fn) => (listeners[type] ??= []).push(fn),
  };
  const quiet = { info() {}, warn() {}, log() {} };
  vm.runInContext(code, vm.createContext({ self, caches, fetch, Response, Headers, Request, URL, console: quiet }), { filename: 'sw.js' });
  const lifecycle = (type) => {
    let p = Promise.resolve();
    for (const fn of listeners[type]) fn({ waitUntil: (x) => (p = x) });
    return p;
  };
  return {
    self,
    install: () => lifecycle('install'),
    activate: () => lifecycle('activate'),
    message: (data) => listeners.message.forEach((fn) => fn({ data })),
    /** Pedido de la página: { intercepted, response() } */
    fetch(rel, { mode = 'cors', method = 'GET', headers = {}, url } = {}) {
      let responded = null;
      const later = [];
      const request = { url: url ?? SCOPE + rel, mode, method, headers: new Headers(headers) };
      for (const fn of listeners.fetch) fn({ request, respondWith: (p) => (responded = Promise.resolve(p)), waitUntil: (p) => later.push(p) });
      return {
        intercepted: !!responded,
        async response() {
          const r = await responded;
          await Promise.all(later);
          return r;
        },
      };
    },
  };
}

const V1 = {
  'index.html': '<html>v1</html>',
  'assets/index-AAA.js': 'console.log(1)',
  'assets/exportUnreal-X.js': 'export {}',
  'models/a.glb': 'GLB-modelo',
  'textures/t/color.webp': 'webp-normal',
  'textures/t/hd/color.webp': 'webp-hd',
  'hdri/cielo.hdr': 'hdr-1k',
  'hdri/cielo_2k.hdr': 'hdr-2k',
  'sounds/voces/manifest.json': '{}',
  'sounds/voces/hola-h1.ogg': 'voz-hola',
  'sounds/voces/chao-m1.ogg': 'voz-chao',
  'sounds/musica/manifest.json': '{"emisoras":{}}',
  'sounds/musica/chill/p1.ogg': 'pista',
  'manifest.webmanifest': '{"name":"x"}',
  'icons/icon-192.png': 'png',
  'models/armas/CREDITOS.txt': 'creditos',
};
// Versión 2: cambia el bundle (otro nombre) e index.html; lo demás sigue igual.
const V2 = { ...V1, 'index.html': '<html>v2</html>', 'assets/index-BBB.js': 'console.log(2)' };
delete V2['assets/index-AAA.js'];

describe('service worker generado', () => {
  it('install baja PRECACHE revalidando y guarda la revisión de cada respuesta', async () => {
    const caches = new FakeCacheStorage();
    const srv = fakeServer(V1);
    const { plan, code } = buildSw(V1);
    await runSw(code, { caches, fetch: srv.fetch }).install();
    const pre = Object.keys(plan.precache);
    expect(srv.calls.map((c) => c.rel).sort()).toEqual([...pre].sort());
    expect(srv.calls.every((c) => c.cache === 'no-cache')).toBe(true);
    expect(pre).not.toContain('assets/exportUnreal-X.js');
    expect(pre).not.toContain('sounds/voces/hola-h1.ogg');
    expect(pre).not.toContain('textures/t/hd/color.webp');
    const cache = caches.all.get(`medellin-${plan.build}`);
    expect(cache.map.size).toBe(pre.length);
    const r = await cache.match(`${SCOPE}models/a.glb`);
    expect(r.headers.get('x-sw-rev')).toBe(plan.precache['models/a.glb']);
    // El cuerpo ya viene descomprimido: no se guarda content-encoding.
    expect(r.headers.get('content-encoding')).toBeNull();
    expect(await r.text()).toBe('GLB-modelo');
  });

  it('una versión nueva copia lo que no cambió y solo baja lo que cambió; activate borra la vieja', async () => {
    const caches = new FakeCacheStorage();
    const v1 = buildSw(V1);
    await runSw(v1.code, { caches, fetch: fakeServer(V1).fetch }).install();
    await caches.open('medellin-runtime');
    await caches.open('otra-app'); // cachés ajenas no se tocan
    const srv = fakeServer(V2);
    const v2 = buildSw(V2, '1.1.0');
    const sw = runSw(v2.code, { caches, fetch: srv.fetch });
    await sw.install();
    expect(srv.calls.map((c) => c.rel).sort()).toEqual(['assets/index-BBB.js', 'index.html']);
    const nueva = caches.all.get(`medellin-${v2.plan.build}`);
    expect(nueva.map.size).toBe(Object.keys(v2.plan.precache).length);
    expect(await (await nueva.match(`${SCOPE}models/a.glb`)).text()).toBe('GLB-modelo');
    // Mientras espera, la vieja sigue ahí (sirve a las pestañas abiertas).
    expect(caches.all.has(`medellin-${v1.plan.build}`)).toBe(true);
    await sw.activate();
    expect([...caches.all.keys()].sort()).toEqual(['medellin-runtime', `medellin-${v2.plan.build}`, 'otra-app'].sort());
    expect(sw.self.clients.claim).toHaveBeenCalledOnce();
    // Nada de skipWaiting automático: solo con el mensaje.
    expect(sw.self.skipWaiting).not.toHaveBeenCalled();
    sw.message({ type: 'OTRA_COSA' });
    expect(sw.self.skipWaiting).not.toHaveBeenCalled();
    sw.message({ type: 'SKIP_WAITING' });
    expect(sw.self.skipWaiting).toHaveBeenCalledOnce();
  });

  it('si falla una descarga (o llega otra versión) la instalación falla', async () => {
    const { code } = buildSw(V1);
    const faltante = { ...V1 };
    delete faltante['models/a.glb'];
    await expect(runSw(code, { caches: new FakeCacheStorage(), fetch: fakeServer(faltante).fetch }).install()).rejects.toThrow(/404/);
    // El CDN aún entrega el archivo viejo: se reintenta saltando la caché y luego falla.
    const srv = fakeServer({ ...V1, 'models/a.glb': 'GLB-viejo' });
    await expect(runSw(code, { caches: new FakeCacheStorage(), fetch: srv.fetch }).install()).rejects.toThrow(/otra versión/);
    expect(srv.calls.filter((c) => c.rel === 'models/a.glb').map((c) => c.cache)).toEqual(['no-cache', 'reload']);
  });

  it('navegación → index.html de la caché, con cualquier query', async () => {
    const caches = new FakeCacheStorage();
    const { code } = buildSw(V1);
    const srv = fakeServer(V1);
    const sw = runSw(code, { caches, fetch: srv.fetch });
    await sw.install();
    await sw.activate();
    srv.calls.length = 0;
    for (const rel of ['', '?quality=baja', 'index.html', 'index.html?quality=baja&debug=1#x']) {
      const f = sw.fetch(rel, { mode: 'navigate' });
      expect(f.intercepted, rel).toBe(true);
      expect(await (await f.response()).text()).toBe('<html>v1</html>');
    }
    expect(srv.calls).toEqual([]);
    // Otras páginas dentro del alcance van a la red.
    expect(sw.fetch('docs/algo.html', { mode: 'navigate' }).intercepted).toBe(false);
    // Sin la caché (borrada a mano): a la red, sin romperse.
    caches.all.clear();
    expect(await (await sw.fetch('?quality=baja', { mode: 'navigate' }).response()).text()).toBe('<html>v1</html>');
    expect(srv.calls.map((c) => c.rel)).toEqual(['?quality=baja']);
  });

  it('PRECACHE sale de la caché; Range, música, POST y lo de afuera no se interceptan', async () => {
    const caches = new FakeCacheStorage();
    const { code } = buildSw(V1);
    const srv = fakeServer(V1);
    const sw = runSw(code, { caches, fetch: srv.fetch });
    await sw.install();
    srv.calls.length = 0;
    const glb = sw.fetch('models/a.glb?v=3');
    expect(glb.intercepted).toBe(true);
    expect(await (await glb.response()).text()).toBe('GLB-modelo');
    const man = sw.fetch('sounds/musica/manifest.json');
    expect(man.intercepted).toBe(true);
    expect(await (await man.response()).text()).toBe('{"emisoras":{}}');
    expect(srv.calls).toEqual([]);
    expect(sw.fetch('sounds/musica/chill/p1.ogg').intercepted).toBe(false);
    expect(sw.fetch('sounds/musica/chill/p1.ogg', { headers: { range: 'bytes=0-' } }).intercepted).toBe(false);
    expect(sw.fetch('models/a.glb', { headers: { range: 'bytes=100-' } }).intercepted).toBe(false);
    expect(sw.fetch('models/a.glb', { method: 'POST' }).intercepted).toBe(false);
    expect(sw.fetch('', { url: 'https://pablovillamed.github.io/otro-proyecto/models/a.glb' }).intercepted).toBe(false);
    expect(sw.fetch('', { url: 'https://cdn.example.com/x.js' }).intercepted).toBe(false);
    expect(sw.fetch('assets/exportUnreal-X.js').intercepted).toBe(false);
    expect(sw.fetch('sw.js').intercepted).toBe(false);
  });

  it('RUNTIME: la voz se baja la primera vez, se guarda y luego sale de la caché', async () => {
    const caches = new FakeCacheStorage();
    const { plan, code } = buildSw(V1);
    const srv = fakeServer(V1);
    const sw = runSw(code, { caches, fetch: srv.fetch });
    await sw.install();
    srv.calls.length = 0;
    const a = sw.fetch('sounds/voces/hola-h1.ogg');
    expect(a.intercepted).toBe(true);
    expect(await (await a.response()).text()).toBe('voz-hola');
    expect(srv.calls).toEqual([{ rel: 'sounds/voces/hola-h1.ogg', cache: 'no-cache' }]);
    const guardada = await caches.all.get('medellin-runtime').match(`${SCOPE}sounds/voces/hola-h1.ogg`);
    expect(guardada.headers.get('x-sw-rev')).toBe(plan.runtime['sounds/voces/hola-h1.ogg']);
    const b = sw.fetch('sounds/voces/hola-h1.ogg');
    expect(await (await b.response()).text()).toBe('voz-hola');
    expect(srv.calls).toHaveLength(1);
    // Texturas HD y cielo 2K también.
    expect(sw.fetch('textures/t/hd/color.webp').intercepted).toBe(true);
    expect(sw.fetch('hdri/cielo_2k.hdr').intercepted).toBe(true);
  });

  it('RUNTIME: revisión nueva se vuelve a bajar; sin red sirve la anterior; activate quita lo que ya no existe', async () => {
    const caches = new FakeCacheStorage();
    const v1 = buildSw(V1);
    const sw1 = runSw(v1.code, { caches, fetch: fakeServer(V1).fetch });
    await sw1.install();
    await sw1.activate();
    await (await sw1.fetch('sounds/voces/hola-h1.ogg')).response();
    await (await sw1.fetch('sounds/voces/chao-m1.ogg')).response();
    // v3: la voz "hola" cambió y "chao" ya no está.
    const V3 = { ...V1, 'sounds/voces/hola-h1.ogg': 'voz-hola-nueva' };
    delete V3['sounds/voces/chao-m1.ogg'];
    const v3 = buildSw(V3, '1.2.0');
    let online = true;
    const srv = fakeServer(V3);
    const sw3 = runSw(v3.code, { caches, fetch: (...a) => (online ? srv.fetch(...a) : Promise.reject(new TypeError('Failed to fetch'))) });
    await sw3.install();
    await sw3.activate();
    const runtime = caches.all.get('medellin-runtime');
    expect([...runtime.map.keys()]).toEqual([`${SCOPE}sounds/voces/hola-h1.ogg`]);
    online = false;
    expect(await (await sw3.fetch('sounds/voces/hola-h1.ogg').response()).text()).toBe('voz-hola');
    online = true;
    expect(await (await sw3.fetch('sounds/voces/hola-h1.ogg').response()).text()).toBe('voz-hola-nueva');
    expect((await runtime.match(`${SCOPE}sounds/voces/hola-h1.ogg`)).headers.get('x-sw-rev')).toBe(v3.plan.runtime['sounds/voces/hola-h1.ogg']);
  });
});

// ------------------------------------------------------------------------
// src/web/pwa.js con una ventana de mentiras.

function fakeWindow({ href = SCOPE, desktop, controller = {}, waiting = null, registerError } = {}) {
  const u = new URL(href);
  const reg = Object.assign(new EventTarget(), { waiting, installing: null, update: vi.fn(async () => {}), unregister: vi.fn(async () => true) });
  const container = Object.assign(new EventTarget(), {
    controller,
    register: vi.fn(async () => {
      if (registerError) throw registerError;
      return reg;
    }),
    getRegistrations: vi.fn(async () => [reg]),
  });
  const win = { location: { protocol: u.protocol, hostname: u.hostname, search: u.search, reload: vi.fn() }, navigator: { serviceWorker: container }, desktop };
  return { win, reg, container };
}

const worker = (state = 'installed') => Object.assign(new EventTarget(), { state, postMessage: vi.fn() });

describe('registro del service worker (pwa.js)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubEnv('PROD', true);
  });
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('registra ./sw.js con alcance ./ en https y revisa cada hora', async () => {
    const { win, reg, container } = fakeWindow();
    vi.stubGlobal('window', win);
    expect(await registerServiceWorker({ onUpdateReady() {} })).toBe(reg);
    expect(container.register).toHaveBeenCalledWith('./sw.js', { scope: './' });
    expect(reg.update).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    expect(reg.update).toHaveBeenCalledOnce();
  });

  it('no registra en desarrollo, en Electron, en ?autotest ni por http fuera de localhost', async () => {
    const casos = [
      [{}, false],
      [{ desktop: { quit() {} } }, true],
      [{ href: `${SCOPE}?autotest=1&quality=baja` }, true],
      [{ href: 'http://192.168.0.10:4173/' }, true],
      [{ href: 'file:///C:/juego/index.html' }, true],
    ];
    for (const [opts, prod] of casos) {
      vi.stubEnv('PROD', prod);
      const { win, container } = fakeWindow(opts);
      vi.stubGlobal('window', win);
      expect(await registerServiceWorker({})).toBeNull();
      expect(container.register).not.toHaveBeenCalled();
    }
    vi.stubEnv('PROD', true);
    const { win, container } = fakeWindow({ href: 'http://localhost:4173/?quality=baja' });
    vi.stubGlobal('window', win);
    await registerServiceWorker();
    expect(container.register).toHaveBeenCalledOnce();
    expect(secureOrigin({ protocol: 'http:', hostname: '127.0.0.1' })).toBe(true);
    expect(secureOrigin({ protocol: 'http:', hostname: 'ejemplo.com' })).toBe(false);
  });

  it('sin serviceWorker en el navegador no hace nada', async () => {
    vi.stubGlobal('window', { location: new URL(SCOPE), navigator: {} });
    expect(await registerServiceWorker({})).toBeNull();
  });

  it('?sw=0 desregistra lo que haya y no registra', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    const { win, reg, container } = fakeWindow({ href: `${SCOPE}?sw=0` });
    vi.stubGlobal('window', win);
    expect(await registerServiceWorker({})).toBeNull();
    expect(reg.unregister).toHaveBeenCalledOnce();
    expect(container.register).not.toHaveBeenCalled();
  });

  it('versión esperando al registrar → onUpdateReady(apply); apply activa y recarga una sola vez', async () => {
    const waiting = worker();
    const { win, container } = fakeWindow({ waiting });
    vi.stubGlobal('window', win);
    const onUpdateReady = vi.fn();
    await registerServiceWorker({ onUpdateReady });
    expect(onUpdateReady).toHaveBeenCalledOnce();
    const apply = onUpdateReady.mock.calls[0][0];
    // La instalación de la primera versión (claim) no recarga.
    container.dispatchEvent(new Event('controllerchange'));
    expect(win.location.reload).not.toHaveBeenCalled();
    expect(apply()).toBe(true);
    expect(waiting.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });
    // La versión nueva toma el control (así lo hace el navegador tras SKIP_WAITING).
    container.controller = waiting;
    container.dispatchEvent(new Event('controllerchange'));
    container.dispatchEvent(new Event('controllerchange'));
    expect(win.location.reload).toHaveBeenCalledOnce();
  });

  it('otra pestaña activó la versión nueva: avisa sin recargar y apply() recarga', async () => {
    const { win, reg, container } = fakeWindow();
    vi.stubGlobal('window', win);
    const onUpdateReady = vi.fn();
    await registerServiceWorker({ onUpdateReady });
    expect(onUpdateReady).not.toHaveBeenCalled();
    reg.waiting = null;
    container.controller = worker('activated');
    container.dispatchEvent(new Event('controllerchange'));
    expect(win.location.reload).not.toHaveBeenCalled();
    expect(onUpdateReady).toHaveBeenCalledOnce();
    const apply = onUpdateReady.mock.calls[0][0];
    expect(apply()).toBe(true);
    expect(win.location.reload).toHaveBeenCalledOnce();
  });

  it('primera visita: el service worker toma la página sin avisar ni recargar', async () => {
    const { win, container } = fakeWindow({ controller: null });
    vi.stubGlobal('window', win);
    const onUpdateReady = vi.fn();
    await registerServiceWorker({ onUpdateReady });
    container.controller = worker('activated');
    container.dispatchEvent(new Event('controllerchange'));
    expect(onUpdateReady).not.toHaveBeenCalled();
    expect(win.location.reload).not.toHaveBeenCalled();
  });

  it('?sw=0 desde el arranque (handleSwKillSwitch) desregistra aunque el juego no cargue', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    const { win, reg } = fakeWindow({ href: `${SCOPE}?sw=0` });
    expect(handleSwKillSwitch(win)).toBe(true);
    await vi.waitFor(() => expect(reg.unregister).toHaveBeenCalledOnce());
    const other = fakeWindow();
    expect(handleSwKillSwitch(other.win)).toBe(false);
    expect(other.reg.unregister).not.toHaveBeenCalled();
    vi.stubEnv('PROD', false);
    expect(handleSwKillSwitch(fakeWindow({ href: `${SCOPE}?sw=0` }).win)).toBe(false);
  });

  it('updatefound → installed avisa solo si la página ya tenía service worker', async () => {
    for (const [controller, avisa] of [[{}, 1], [null, 0]]) {
      const { win, reg } = fakeWindow({ controller });
      vi.stubGlobal('window', win);
      const onUpdateReady = vi.fn();
      await registerServiceWorker({ onUpdateReady });
      const w = worker('installing');
      reg.installing = w;
      reg.dispatchEvent(new Event('updatefound'));
      w.state = 'installed';
      reg.waiting = w;
      w.dispatchEvent(new Event('statechange'));
      w.dispatchEvent(new Event('statechange'));
      expect(onUpdateReady).toHaveBeenCalledTimes(avisa);
    }
  });

  it('nunca lanza: si el registro falla, avisa con console.warn (no console.error)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { win } = fakeWindow({ registerError: new Error('SecurityError') });
    vi.stubGlobal('window', win);
    await expect(registerServiceWorker({ onUpdateReady() {} })).resolves.toBeNull();
    expect(warn).toHaveBeenCalledOnce();
    expect(error).not.toHaveBeenCalled();
    // Un onUpdateReady que lanza tampoco rompe nada.
    const { win: win2 } = fakeWindow({ waiting: worker() });
    vi.stubGlobal('window', win2);
    await expect(
      registerServiceWorker({
        onUpdateReady() {
          throw new Error('ups');
        },
      }),
    ).resolves.not.toBeNull();
    expect(warn).toHaveBeenCalledTimes(2);
    expect(error).not.toHaveBeenCalled();
  });
});
