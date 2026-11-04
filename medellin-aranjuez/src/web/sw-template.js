// Service worker de Medellín: Aranjuez (script clásico, NO módulo: así lo
// registra cualquier navegador). El build lo copia a dist/sw.js llenando
// VERSION, BUILD y las listas (scripts/web/swManifest.js + vite-plugin-sw.js);
// la plantilla sin llenar no precarga nada.
//
//  - install: baja lo necesario para arrancar y jugar sin conexión (PRECACHE)
//    a la caché 'medellin-<BUILD>'. Lo que no cambió desde la versión anterior
//    (misma revisión) se copia de su caché: una versión nueva solo baja lo que
//    cambió. Lo que cambió se pide revalidando (GitHub Pages manda
//    max-age=600) y se verifica contra su revisión (SHA-256).
//  - Voces, texturas HD y el cielo 2K se guardan la primera vez que se usan
//    (RUNTIME, caché 'medellin-runtime').
//  - La música de la radio va directo a la red (streaming con pedidos Range).
//  - La versión nueva queda esperando hasta que la página la active con el
//    mensaje SKIP_WAITING (el jugador decide; ver src/web/pwa.js).
//  - Si algo falla, el pedido va a la red como si no hubiera service worker.

/* eslint-env serviceworker */
'use strict';

const VERSION = '%VERSION%';
const BUILD = '%BUILD%';
const PRECACHE = /* %PRECACHE% */ {};
const RUNTIME = /* %RUNTIME% */ {};

const PREFIX = 'medellin-';
const CACHE = PREFIX + BUILD;
const RUNTIME_CACHE = PREFIX + 'runtime';
const REV_HEADER = 'x-sw-rev'; // revisión guardada en cada respuesta de la caché
const CONCURRENCY = 6;
const MATCH = { ignoreVary: true };

// Las listas van relativas al alcance (sin barra inicial): sirven igual bajo
// /medellin-aranjuez/ que en la raíz. Las claves son URLs absolutas, tal
// como las normaliza el navegador.
const SCOPE = self.registration ? self.registration.scope : new URL('./', self.location.href).href;
const toKey = (rel) => new URL(rel, SCOPE).href;
const PRE = new Map(Object.entries(PRECACHE).map(([rel, rev]) => [toKey(rel), rev]));
const RUN = new Map(Object.entries(RUNTIME).map(([rel, rev]) => [toKey(rel), rev]));
const INDEX = toKey('index.html');
const MUSICA = toKey('sounds/musica/');

/** URL sin query ni fragmento (?quality=baja no cambia el archivo). */
function keyOf(url) {
  const u = new URL(url);
  u.search = '';
  u.hash = '';
  return u.href;
}

const ours = (name) => name.startsWith(PREFIX) && name !== CACHE && name !== RUNTIME_CACHE;

/** Hex del SHA-256 (los primeros `len` caracteres); null si no hay crypto.subtle. */
async function digest(buf, len) {
  const subtle = self.crypto && self.crypto.subtle;
  if (!subtle) return null;
  const h = new Uint8Array(await subtle.digest('SHA-256', buf));
  let s = '';
  for (let i = 0; i < Math.ceil(len / 2); i++) s += h[i].toString(16).padStart(2, '0');
  return s.slice(0, len);
}

/** Respuesta para guardar: el cuerpo ya leído, sus cabeceras y la revisión. */
function stamp(body, res, rev) {
  const headers = new Headers(res.headers);
  // El cuerpo ya viene descomprimido: esas dos cabeceras ya no le corresponden.
  headers.delete('content-encoding');
  headers.delete('content-length');
  headers.set(REV_HEADER, rev);
  return new Response(body, { status: 200, statusText: 'OK', headers });
}

/** Corre `fn` sobre `items` con `n` a la vez; la primera falla corta el resto. */
async function pool(items, n, fn) {
  let next = 0;
  let failed = null;
  const worker = async () => {
    while (!failed && next < items.length) {
      const item = items[next++];
      try {
        await fn(item);
      } catch (err) {
        failed = failed || err;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
  if (failed) throw failed;
}

/** Baja un archivo de PRECACHE revalidando y verifica que sea la revisión pedida. */
async function download(key, rev) {
  // 'no-cache' revalida con el servidor (304 si la copia local sigue vigente);
  // si aun así llega otra versión (copia vieja en el CDN), 'reload' la salta.
  for (const cache of ['no-cache', 'reload']) {
    const res = await fetch(key, { cache, credentials: 'same-origin' });
    if (!res.ok) throw new Error('HTTP ' + res.status + ': ' + key);
    const body = await res.arrayBuffer();
    const got = await digest(body, rev.length);
    if (got === null || got === rev) return stamp(body, res, rev);
  }
  throw new Error('El servidor entregó otra versión de ' + key + ' (¿caché del CDN?)');
}

async function hasRev(cache, key, rev) {
  const hit = await cache.match(key, MATCH);
  return !!hit && hit.headers.get(REV_HEADER) === rev;
}

async function install() {
  const cache = await caches.open(CACHE);
  // Cachés de versiones anteriores, la más nueva primero.
  const names = (await caches.keys()).filter(ours).reverse();
  const olds = await Promise.all(names.map((n) => caches.open(n)));
  let copied = 0;
  let fetched = 0;
  await pool([...PRE], CONCURRENCY, async ([key, rev]) => {
    // Ya está (un intento anterior de esta misma versión que se cortó).
    if (await hasRev(cache, key, rev)) return;
    for (const old of olds) {
      const hit = await old.match(key, MATCH);
      if (hit && hit.headers.get(REV_HEADER) === rev) {
        await cache.put(key, hit);
        copied++;
        return;
      }
    }
    await cache.put(key, await download(key, rev));
    fetched++;
  });
  // Otra versión que se activó mientras tanto pudo borrar esta caché.
  if (!(await caches.has(CACHE))) throw new Error('La caché ' + CACHE + ' desapareció durante la instalación');
  console.info('[sw] ' + VERSION + ' (' + BUILD + '): ' + PRE.size + ' archivos listos sin conexión (' + fetched + ' bajados, ' + copied + ' copiados de la versión anterior)');
}

/** Borra de la caché de uso lo que esta versión ya no tiene (lo que cambió se renueva al pedirlo). */
async function pruneRuntime() {
  const cache = await caches.open(RUNTIME_CACHE);
  for (const req of await cache.keys()) {
    if (!RUN.has(keyOf(req.url))) await cache.delete(req);
  }
}

async function activate() {
  try {
    for (const name of await caches.keys()) if (ours(name)) await caches.delete(name);
    await pruneRuntime();
  } catch (err) {
    console.warn('[sw] Limpieza de cachés incompleta:', err && err.message);
  }
  await self.clients.claim();
}

/** Respuesta de una caché o, si no está o algo falla, de la red. */
async function cached(cacheName, key, req) {
  try {
    const hit = await caches.match(key, { cacheName, ignoreVary: true });
    if (hit) return hit;
  } catch (err) {
    // a la red
  }
  return fetch(req);
}

async function store(cache, key, rev, res) {
  try {
    const body = await res.arrayBuffer();
    const got = await digest(body, rev.length);
    if (got !== null && got !== rev) return; // el servidor aún no tiene esta versión: no se guarda
    await cache.put(key, stamp(body, res, rev));
  } catch (err) {
    // sin espacio o sin caché: solo no queda guardado
  }
}

/** Voces, texturas HD, cielo 2K: de la caché si es la misma revisión; si no, de la red y se guarda. */
async function fromRuntime(event, key, rev) {
  const req = event.request;
  let cache = null;
  let stale = null;
  try {
    cache = await caches.open(RUNTIME_CACHE);
    const hit = await cache.match(key, MATCH);
    if (hit) {
      if (hit.headers.get(REV_HEADER) === rev) return hit;
      stale = hit;
    }
  } catch (err) {
    cache = null;
  }
  let res;
  try {
    // Revalidando: la copia del navegador puede ser de la versión anterior.
    res = await fetch(key, { cache: 'no-cache', credentials: 'same-origin' });
  } catch (err) {
    if (stale) return stale; // sin conexión: mejor la versión anterior que nada
    return fetch(req);
  }
  if (cache && res.status === 200) event.waitUntil(store(cache, key, rev, res.clone()));
  return res;
}

self.addEventListener('install', (event) => {
  event.waitUntil(install());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(activate());
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || !req.url.startsWith(SCOPE)) return;
  let key;
  try {
    key = keyOf(req.url);
  } catch (err) {
    return;
  }
  if (req.mode === 'navigate') {
    // El juego es una sola página: la raíz o index.html, con cualquier query.
    if (key === SCOPE || key === INDEX) event.respondWith(cached(CACHE, INDEX, req));
    return;
  }
  // Pedidos por rangos (<audio> de la radio) y la música: directo a la red.
  if (req.headers && req.headers.has('range')) return;
  if (PRE.has(key)) {
    event.respondWith(cached(CACHE, key, req));
    return;
  }
  if (key.startsWith(MUSICA)) return;
  const rev = RUN.get(key);
  if (rev) event.respondWith(fromRuntime(event, key, rev));
});
