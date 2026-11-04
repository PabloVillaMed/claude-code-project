// Qué hay donde corre el juego: app de escritorio (Electron) o navegador,
// pantalla táctil, celular, WebGL 2, pantalla completa. Todo se calcula una
// vez con `detectPlatform` (que recibe la ventana para poder probarlo en Node).

const media = (win, q) => {
  try {
    return !!win.matchMedia?.(q).matches;
  } catch {
    return false;
  }
};

/**
 * @param {Window} win
 * @returns {{ desktopApp: boolean, touchPrimary: boolean, hasTouch: boolean, mobile: boolean,
 *   ios: boolean, standalone: boolean, fullscreen: boolean, pointerLock: boolean }}
 */
export function detectPlatform(win = globalThis.window) {
  if (!win) return { desktopApp: false, touchPrimary: false, hasTouch: false, mobile: false, ios: false, standalone: false, fullscreen: false, pointerLock: false };
  const nav = win.navigator ?? {};
  const ua = String(nav.userAgent ?? '');
  const touchPoints = nav.maxTouchPoints ?? 0;
  // iPadOS se presenta como un Mac de escritorio, pero con pantalla táctil.
  const ios = /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/i.test(ua) && touchPoints > 1);
  const mobile = nav.userAgentData?.mobile ?? (ios || /Android|Mobile/i.test(ua));
  const touchPrimary = media(win, '(pointer: coarse)') || (touchPoints > 0 && !media(win, '(any-pointer: fine)'));
  const doc = win.document;
  return {
    desktopApp: !!win.desktop,
    touchPrimary,
    hasTouch: touchPoints > 0 || 'ontouchstart' in win,
    mobile: !!mobile,
    ios,
    standalone: media(win, '(display-mode: standalone)') || media(win, '(display-mode: fullscreen)') || nav.standalone === true,
    fullscreen: !!(doc?.fullscreenEnabled && doc.documentElement?.requestFullscreen),
    pointerLock: !!doc?.documentElement?.requestPointerLock && !touchPrimary,
  };
}

/** ¿El navegador puede crear un contexto WebGL 2? (el juego no corre sin él). */
export function hasWebGL2(doc = globalThis.document) {
  try {
    const c = doc.createElement('canvas');
    const gl = c.getContext('webgl2');
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
    return !!gl;
  } catch {
    return false;
  }
}

export const platform = detectPlatform();

/**
 * ¿Celular o tableta? (pantalla táctil como puntero principal o navegador
 * móvil, fuera de la app de escritorio). Una laptop táctil con mouse no lo es.
 */
export function isHandheld(p = platform) {
  return !p.desktopApp && (p.mobile || p.touchPrimary);
}

/** Calidad gráfica cuando no hay configuración guardada: Baja en celulares y tabletas. */
export function defaultQuality(p = platform) {
  return isHandheld(p) ? 'baja' : 'alta';
}
