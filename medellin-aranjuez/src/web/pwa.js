// Service worker de la versión web (dist/sw.js, lo genera el build desde
// src/web/sw-template.js): el juego queda guardado para jugar sin conexión y
// las versiones nuevas esperan a que el jugador las acepte.
//
// Contrato: registra dist/sw.js solo en el build de producción servido por
// http(s), fuera de Electron y fuera de las pruebas automáticas. Cuando hay una
// versión nueva instalada y esperando, llama a `onUpdateReady(apply)`; `apply()`
// la activa y recarga la página.
//
// Para depurar: ?sw=0 desregistra el service worker que haya y no registra
// ninguno (la página siguiente ya carga todo de la red).

const HOUR = 60 * 60 * 1000;

// console.warn y no console.error: las pruebas e2e fallan con cualquier error en consola.
const warn = (msg, err) => console.warn(`[pwa] ${msg}`, err?.message ?? err ?? '');

/** https, o http en la máquina propia (los navegadores solo dejan SW en contexto seguro). */
export function secureOrigin(loc) {
  if (loc?.protocol === 'https:') return true;
  const h = loc?.hostname ?? '';
  return loc?.protocol === 'http:' && (h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h.endsWith('.localhost'));
}

async function unregisterAll(container) {
  const regs = (await container.getRegistrations?.()) ?? [];
  await Promise.all(regs.map((r) => r.unregister()));
  if (regs.length) console.info(`[pwa] ?sw=0: ${regs.length} service worker desregistrado; la próxima carga va sin caché.`);
}

/**
 * ?sw=0 apenas arranca la página (antes de crear el juego): así sirve también
 * cuando el juego no llega a cargar, que es cuando más hace falta. Devuelve si
 * se pidió.
 */
export function handleSwKillSwitch(win = globalThis.window) {
  try {
    if (!import.meta.env.PROD) return false;
    const container = win?.navigator?.serviceWorker;
    if (!container || new URLSearchParams(win.location.search).get('sw') !== '0') return false;
    unregisterAll(container).catch((err) => warn('?sw=0: no se pudo desregistrar:', err));
    return true;
  } catch {
    return false;
  }
}

/** Avisa (una vez por versión) cuando hay un SW nuevo instalado y esperando. */
function watchUpdates(win, reg, onUpdateReady) {
  const container = win.navigator.serviceWorker;
  // Quien controlaba esta página al cargarla (null en la primera visita).
  const initial = container.controller;
  let notified = null;
  let applied = false;
  let reloading = false;
  const reload = () => {
    if (reloading) return;
    reloading = true;
    win.location.reload();
  };
  const apply = () => {
    const waiting = reg.waiting;
    if (waiting) {
      // Se recarga UNA vez, cuando la versión nueva ya controla la página.
      applied = true;
      waiting.postMessage({ type: 'SKIP_WAITING' });
      return true;
    }
    // Ya la activó otra pestaña: esta página tiene el código viejo, basta recargar.
    if (initial && container.controller && container.controller !== initial) {
      reload();
      return true;
    }
    return false;
  };
  const tell = (worker) => {
    if (!worker || worker === notified || typeof onUpdateReady !== 'function') return;
    notified = worker;
    try {
      onUpdateReady(apply);
    } catch (err) {
      warn('onUpdateReady falló:', err);
    }
  };
  const notify = () => tell(reg.waiting);
  // La versión nueva tomó el control: si la pidió esta pestaña se recarga; si
  // fue otra, aquí se avisa igual (sin recargar en plena partida). En la primera
  // visita el SW toma la página con clients.claim(): eso no es una versión nueva.
  container.addEventListener('controllerchange', () => {
    if (!initial || container.controller === initial) return;
    if (applied) reload();
    else tell(container.controller);
  });
  // Ya había una versión nueva esperando de una visita anterior.
  if (reg.waiting) notify();
  reg.addEventListener('updatefound', () => {
    const w = reg.installing;
    // Sin controller es la primera instalación: no hay nada que actualizar.
    w?.addEventListener('statechange', () => {
      if (w.state === 'installed' && container.controller) notify();
    });
  });
}

/**
 * Registra el service worker si corresponde. Nunca lanza: si algo falla lo
 * anota con console.warn y devuelve null.
 * @param {{ onUpdateReady?: (apply: () => boolean) => void }} [opts]
 * @returns {Promise<ServiceWorkerRegistration|null>}
 */
export async function registerServiceWorker({ onUpdateReady } = {}) {
  try {
    // `npm run dev` no toca service workers (ni para desregistrar).
    if (!import.meta.env.PROD) return null;
    const win = globalThis.window;
    const nav = win?.navigator;
    if (!nav || !('serviceWorker' in nav)) return null;
    const loc = win.location;
    const params = new URLSearchParams(loc.search);
    if (params.get('sw') === '0') {
      await unregisterAll(nav.serviceWorker);
      return null;
    }
    // Electron sirve dist/ desde el disco (app://juego): no necesita caché.
    if (win.desktop || params.has('autotest') || !secureOrigin(loc)) return null;
    const reg = await nav.serviceWorker.register('./sw.js', { scope: './' });
    watchUpdates(win, reg, onUpdateReady);
    // Mientras la pestaña siga abierta, se revisa cada hora si hay versión nueva.
    setInterval(() => {
      Promise.resolve()
        .then(() => reg.update())
        .catch(() => {}); // sin conexión: se intenta en la próxima
    }, HOUR);
    return reg;
  } catch (err) {
    warn('No se pudo registrar el service worker:', err);
    return null;
  }
}
