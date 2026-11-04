import { describe, expect, it, vi } from 'vitest';
import { defaultQuality, detectPlatform, hasWebGL2, isHandheld, platform } from '../../src/web/platform.js';

// Ventana falsa: agente de usuario, puntos táctiles, consultas de medios y lo
// que haya de pantalla completa / pointer lock en el documento.
function fakeWin({ ua, touchPoints = 0, media = [], uaData, desktop, standalone, touchEvents = false, fullscreen = true, pointerLock = true }) {
  const documentElement = {};
  if (fullscreen) documentElement.requestFullscreen = () => Promise.resolve();
  if (pointerLock) documentElement.requestPointerLock = () => {};
  const win = {
    navigator: { userAgent: ua, maxTouchPoints: touchPoints, userAgentData: uaData, standalone },
    matchMedia: (q) => ({ matches: media.includes(q) }),
    document: { fullscreenEnabled: fullscreen ? true : undefined, documentElement },
  };
  if (desktop) win.desktop = desktop;
  if (touchEvents) win.ontouchstart = null;
  return win;
}

const MOUSE = ['(pointer: fine)', '(any-pointer: fine)', '(hover: hover)'];
const TOUCH = ['(pointer: coarse)', '(any-pointer: coarse)'];
const CHROME_WIN = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';

describe('plataforma: dónde corre el juego', () => {
  it('app de escritorio (Electron)', () => {
    const p = detectPlatform(fakeWin({ ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) MedellinAranjuez/3.3.0 Chrome/140.0.0.0 Electron/44.4.5 Safari/537.36', media: MOUSE, uaData: { mobile: false }, desktop: { quit() {} } }));
    expect(p).toMatchObject({ desktopApp: true, touchPrimary: false, hasTouch: false, mobile: false, ios: false, fullscreen: true, pointerLock: true });
    expect(isHandheld(p)).toBe(false);
    expect(defaultQuality(p)).toBe('alta');
  });

  it('navegador de escritorio con mouse', () => {
    const p = detectPlatform(fakeWin({ ua: CHROME_WIN, media: MOUSE, uaData: { mobile: false } }));
    expect(p).toMatchObject({ desktopApp: false, touchPrimary: false, hasTouch: false, mobile: false, ios: false, standalone: false, fullscreen: true, pointerLock: true });
    expect(defaultQuality(p)).toBe('alta');
  });

  it('laptop táctil con mouse: tiene pantalla táctil pero se juega con mouse', () => {
    const p = detectPlatform(fakeWin({ ua: CHROME_WIN, touchPoints: 10, media: [...MOUSE, '(any-pointer: coarse)'], uaData: { mobile: false }, touchEvents: true }));
    expect(p).toMatchObject({ desktopApp: false, touchPrimary: false, hasTouch: true, mobile: false, pointerLock: true });
    expect(isHandheld(p)).toBe(false);
    expect(defaultQuality(p)).toBe('alta');
  });

  it('celular Android', () => {
    const p = detectPlatform(fakeWin({ ua: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36', touchPoints: 5, media: TOUCH, uaData: { mobile: true }, touchEvents: true }));
    expect(p).toMatchObject({ desktopApp: false, touchPrimary: true, hasTouch: true, mobile: true, ios: false, fullscreen: true, pointerLock: false });
    expect(isHandheld(p)).toBe(true);
    expect(defaultQuality(p)).toBe('baja');
  });

  it('iPhone: sin API de pantalla completa ni pointer lock; instalado en la pantalla de inicio', () => {
    const ua = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1';
    const p = detectPlatform(fakeWin({ ua, touchPoints: 5, media: TOUCH, touchEvents: true, fullscreen: false, pointerLock: false }));
    expect(p).toMatchObject({ desktopApp: false, touchPrimary: true, hasTouch: true, mobile: true, ios: true, standalone: false, fullscreen: false, pointerLock: false });
    expect(defaultQuality(p)).toBe('baja');
    expect(detectPlatform(fakeWin({ ua, touchPoints: 5, media: TOUCH, standalone: true, fullscreen: false })).standalone).toBe(true);
  });

  it('iPad con iPadOS, que se presenta como un Mac', () => {
    const ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15';
    const p = detectPlatform(fakeWin({ ua, touchPoints: 5, media: TOUCH, touchEvents: true }));
    expect(p).toMatchObject({ desktopApp: false, touchPrimary: true, mobile: true, ios: true, pointerLock: false });
    expect(defaultQuality(p)).toBe('baja');
    // Un Mac de verdad (sin pantalla táctil) no es un iPad.
    const mac = detectPlatform(fakeWin({ ua, media: MOUSE }));
    expect(mac).toMatchObject({ ios: false, mobile: false, touchPrimary: false, pointerLock: true });
    expect(defaultQuality(mac)).toBe('alta');
  });

  it('PWA instalada (display-mode) y Electron en una tableta Windows', () => {
    expect(detectPlatform(fakeWin({ ua: CHROME_WIN, media: [...MOUSE, '(display-mode: standalone)'] })).standalone).toBe(true);
    const surface = detectPlatform(fakeWin({ ua: CHROME_WIN, touchPoints: 10, media: TOUCH, desktop: {} }));
    expect(surface.touchPrimary).toBe(true);
    expect(isHandheld(surface)).toBe(false);
  });

  it('sin ventana (Node) o con matchMedia roto no falla', () => {
    const none = detectPlatform(null);
    expect(Object.values(none).every((v) => v === false)).toBe(true);
    expect(platform.desktopApp).toBe(false); // en Node no hay window
    const broken = fakeWin({ ua: CHROME_WIN });
    broken.matchMedia = () => {
      throw new Error('no');
    };
    expect(() => detectPlatform(broken)).not.toThrow();
    expect(detectPlatform(broken).touchPrimary).toBe(false);
  });
});

describe('plataforma: WebGL 2', () => {
  const doc = (getContext) => ({ createElement: () => ({ getContext }) });

  it('crea un contexto de prueba y lo suelta', () => {
    const loseContext = vi.fn();
    const gl = { getExtension: (n) => (n === 'WEBGL_lose_context' ? { loseContext } : null) };
    expect(hasWebGL2(doc((kind) => (kind === 'webgl2' ? gl : null)))).toBe(true);
    expect(loseContext).toHaveBeenCalledTimes(1);
  });

  it('sin WebGL 2 o si el navegador lanza, devuelve false', () => {
    expect(hasWebGL2(doc(() => null))).toBe(false);
    expect(
      hasWebGL2(
        doc(() => {
          throw new Error('Error creating WebGL context');
        }),
      ),
    ).toBe(false);
    expect(hasWebGL2(undefined)).toBe(false);
  });
});
