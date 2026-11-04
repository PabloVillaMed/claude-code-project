// El juego dentro de una pestaña del navegador: que los atajos del navegador
// no se coman las teclas del juego (Ctrl agacha y W avanza, pero Ctrl+W cierra
// la pestaña), que no se pierda la partida al cerrar o esconder la pestaña y
// que el navegador no borre el guardado. En la app de escritorio (Electron) no
// hay pestañas ni atajos del navegador: ahí solo se guarda y se pausa.
//
// Las dependencias (ventana, documento, navegador, juego) se inyectan para
// poder probarlo en Node con objetos falsos.

/** Estados con una partida en curso (ver Game.setState). */
export const IN_PROGRESS = new Set(['playing', 'paused', 'map', 'shop']);

// Teclas sueltas que el navegador usa para algo: F3 buscar, F5 recargar, F6
// barra de direcciones, F7 navegación con cursor, F10 barra de menú, Backspace
// atrás (navegadores viejos), / y ' búsqueda rápida de Firefox. F11 lo maneja
// main.js (pantalla completa del juego) y F12 se deja para las herramientas.
const BROWSER_KEYS = new Set(['F3', 'F5', 'F6', 'F7', 'F10', 'Backspace', 'Slash', 'Quote']);
const FREE_KEYS = new Set(['F11', 'F12']);
// Ctrl+Mayús+I / J: herramientas de desarrollo (no estorban al jugar).
const DEVTOOLS = new Set(['KeyI', 'KeyJ']);
const isAlt = (code) => code === 'AltLeft' || code === 'AltRight';
// Keyboard Lock solo de lo que el navegador no deja cancelar: Ctrl+W cerrar,
// Ctrl+T y Ctrl+N abrir pestaña o ventana, y Esc (pausa sin salir de pantalla
// completa). Sin Tab, Alt ni la tecla Windows: Alt+Tab y Win siguen siendo del sistema.
export const LOCKED_KEYS = ['KeyW', 'KeyT', 'KeyN', 'Escape'];

/**
 * ¿Hay que quitarle al navegador esta tecla mientras se juega? Toda
 * combinación con Ctrl/Cmd (Ctrl+D marcador, Ctrl+S guardar página, Ctrl+F
 * buscar, Ctrl+R recargar, Ctrl+1…6 cambiar de pestaña…), Alt (en Firefox y
 * Windows abre la barra de menú; Alt+← es "atrás") y las teclas de función
 * del navegador. preventDefault no detiene el evento: el juego lo sigue viendo.
 * Ctrl+W, Ctrl+T y Ctrl+N no se pueden cancelar así (para eso está el
 * Keyboard Lock en pantalla completa y la confirmación de beforeunload).
 */
export function isBrowserShortcut(e) {
  const code = e.code ?? '';
  if (FREE_KEYS.has(code)) return false;
  if (e.ctrlKey || e.metaKey) return !(e.shiftKey && DEVTOOLS.has(code));
  if (e.altKey || isAlt(code)) return true;
  return BROWSER_KEYS.has(code);
}

/**
 * Pide almacenamiento persistente para que el navegador no borre el guardado
 * ni la caché del juego cuando le falte espacio. Chrome lo concede solo (según
 * el uso del sitio o si está instalado); Firefox puede preguntar. Devuelve si
 * quedó persistente; nunca lanza.
 */
export async function requestPersistentStorage(nav = globalThis.navigator) {
  const storage = nav?.storage;
  if (!storage?.persist) return false;
  try {
    if (await storage.persisted?.()) return true;
    return !!(await storage.persist());
  } catch {
    return false;
  }
}

/**
 * Instala los guardas. Con `autotest` no hace nada (las pruebas manejan la
 * página a su antojo). Devuelve `{ dispose, lockKeyboard, unlockKeyboard }`.
 * @param {{ game: object, win?: Window, doc?: Document, nav?: Navigator, autotest?: boolean, desktopApp?: boolean }} deps
 */
export function installBrowserGuards({ game, win = globalThis.window, doc = win?.document, nav = win?.navigator, autotest = false, desktopApp = !!win?.desktop } = {}) {
  const off = [];
  const on = (target, type, fn, opts) => {
    if (!target?.addEventListener) return;
    target.addEventListener(type, fn, opts);
    off.push(() => target.removeEventListener(type, fn, opts));
  };
  const guards = {
    keyboardLocked: false,
    dispose() {
      for (const f of off.splice(0)) f();
    },
    // Keyboard Lock (Chrome/Edge): en pantalla completa Ctrl+W, Ctrl+T, Ctrl+N
    // y Esc le llegan al juego; mantener Esc sale de la pantalla completa.
    lockKeyboard() {
      const kb = nav?.keyboard;
      if (!kb?.lock) return;
      try {
        Promise.resolve(kb.lock(LOCKED_KEYS)).then(
          () => (guards.keyboardLocked = true),
          () => {},
        );
      } catch {
        // sin permiso (iframe) o no soportado: el navegador se queda con sus atajos
      }
    },
    unlockKeyboard() {
      try {
        nav?.keyboard?.unlock?.();
      } catch {
        // nada que soltar
      }
      guards.keyboardLocked = false;
    },
  };
  if (autotest || !win || !game) return guards;

  const playing = () => game.state === 'playing';
  const inProgress = () => IN_PROGRESS.has(game.state);
  // Como el autoguardado: muerto no se guarda (quedaría la salud en cero).
  const save = () => {
    try {
      if (!game.player?.dead) game.save();
    } catch (err) {
      console.warn('No se pudo guardar la partida:', err);
    }
  };

  if (!desktopApp) {
    // Fase de captura: antes que el navegador decida, sin stopPropagation
    // (el juego escucha keydown en la misma ventana).
    on(
      win,
      'keydown',
      (e) => {
        if (playing() && isBrowserShortcut(e)) e.preventDefault();
      },
      true,
    );
    on(
      win,
      'keyup',
      (e) => {
        if (playing() && (isAlt(e.code) || e.code === 'F10')) e.preventDefault();
      },
      true,
    );
    // Ctrl+rueda (y el pellizco del touchpad) hace zoom a la página.
    on(
      win,
      'wheel',
      (e) => {
        if (playing() && e.ctrlKey) e.preventDefault();
      },
      { capture: true, passive: false },
    );
    // Cerrar o recargar la pestaña con partida: se guarda y se pregunta. Si
    // la tarjeta de video se reinició, el juego recarga solo: sin pregunta.
    on(win, 'beforeunload', (e) => {
      if (!inProgress() || game.contextLost) return;
      save();
      e.preventDefault();
      e.returnValue = '';
    });
    on(doc, 'fullscreenchange', () => (doc.fullscreenElement ? guards.lockKeyboard() : guards.unlockKeyboard()));
  }

  // pagehide sí llega en Safari/iOS (beforeunload no) y al congelar la pestaña.
  on(win, 'pagehide', () => {
    if (inProgress()) save();
  });
  // Cambiar de pestaña, minimizar o bloquear el celular: pausa (que guarda y
  // suspende el audio). En el celular la pestaña puede morir en segundo plano.
  on(doc, 'visibilitychange', () => {
    if (doc.visibilityState !== 'hidden') return;
    if (playing()) game.pause();
    else if (inProgress()) save();
  });

  return guards;
}
