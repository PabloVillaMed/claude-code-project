import { describe, expect, it, vi } from 'vitest';
import { IN_PROGRESS, installBrowserGuards, isBrowserShortcut, requestPersistentStorage } from '../../src/web/browserGuards.js';

// Ventana y documento falsos: lo justo de addEventListener y un dispatch que
// devuelve el evento para ver si quedó cancelado.
class FakeTarget {
  constructor(props = {}) {
    Object.assign(this, props);
    this.listeners = [];
  }
  addEventListener(type, fn, opts) {
    this.listeners.push({ type, fn, opts });
  }
  removeEventListener(type, fn) {
    this.listeners = this.listeners.filter((l) => l.type !== type || l.fn !== fn);
  }
  dispatch(type, props = {}) {
    const e = {
      type,
      defaultPrevented: false,
      preventDefault() {
        this.defaultPrevented = true;
      },
      ...props,
    };
    for (const l of [...this.listeners]) if (l.type === type) l.fn(e);
    return e;
  }
}

function fakeGame(state) {
  return {
    state,
    player: { dead: false },
    saves: 0,
    pauses: 0,
    save() {
      this.saves++;
    },
    pause() {
      this.pauses++;
      this.state = 'paused';
      this.save();
    },
  };
}

function setup({ state = 'playing', autotest = false, desktopApp = false, keyboard } = {}) {
  const doc = new FakeTarget({ visibilityState: 'visible', fullscreenElement: null });
  const nav = { keyboard };
  const win = new FakeTarget({ document: doc, navigator: nav });
  const game = fakeGame(state);
  const guards = installBrowserGuards({ game, win, doc, nav, autotest, desktopApp });
  return { win, doc, nav, game, guards };
}

const key = (code, mods = {}) => ({ code, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...mods });
const tick = () => new Promise((r) => setTimeout(r, 0));

describe('navegador: atajos que se le quitan al navegador', () => {
  it('Ctrl/Cmd + tecla, Alt y las teclas de función del navegador sí; las del juego, F11 y F12 no', () => {
    for (const e of [key('KeyW', { ctrlKey: true }), key('KeyD', { ctrlKey: true }), key('KeyS', { metaKey: true }), key('KeyR', { ctrlKey: true }), key('Digit1', { ctrlKey: true }), key('ControlLeft', { ctrlKey: true }), key('AltLeft'), key('AltRight'), key('ArrowLeft', { altKey: true }), key('F3'), key('F5'), key('F6'), key('F7'), key('F10'), key('Backspace'), key('Slash'), key('Quote')]) {
      expect(isBrowserShortcut(e), JSON.stringify(e)).toBe(true);
    }
    for (const e of [key('KeyW'), key('KeyC'), key('Space'), key('Escape'), key('Tab'), key('F1'), key('F11'), key('F12'), key('KeyI', { ctrlKey: true, shiftKey: true }), key('KeyJ', { ctrlKey: true, shiftKey: true })]) {
      expect(isBrowserShortcut(e), JSON.stringify(e)).toBe(false);
    }
  });

  it('jugando: cancela Ctrl+W, Ctrl+D y Alt (en captura y sin detener el evento), pero no W ni F12', () => {
    const { win } = setup();
    const down = win.listeners.find((l) => l.type === 'keydown');
    expect(down.opts).toBe(true); // fase de captura
    expect(win.dispatch('keydown', key('KeyW', { ctrlKey: true })).defaultPrevented).toBe(true);
    expect(win.dispatch('keydown', key('KeyD', { ctrlKey: true })).defaultPrevented).toBe(true);
    expect(win.dispatch('keydown', key('AltLeft', { altKey: true })).defaultPrevented).toBe(true);
    expect(win.dispatch('keyup', key('AltLeft')).defaultPrevented).toBe(true);
    expect(win.dispatch('keydown', key('KeyW')).defaultPrevented).toBe(false);
    expect(win.dispatch('keydown', key('F12')).defaultPrevented).toBe(false);
    expect(win.dispatch('keydown', key('F11')).defaultPrevented).toBe(false);
    // Ctrl+rueda (zoom de la página) también.
    expect(win.dispatch('wheel', { ctrlKey: true }).defaultPrevented).toBe(true);
    expect(win.dispatch('wheel', { ctrlKey: false }).defaultPrevented).toBe(false);
  });

  it('en el menú o en pausa el navegador conserva sus atajos', () => {
    for (const state of ['menu', 'paused', 'map', 'shop', 'loading']) {
      const { win } = setup({ state });
      expect(win.dispatch('keydown', key('KeyD', { ctrlKey: true })).defaultPrevented).toBe(false);
      expect(win.dispatch('keyup', key('AltLeft')).defaultPrevented).toBe(false);
      expect(win.dispatch('wheel', { ctrlKey: true }).defaultPrevented).toBe(false);
    }
  });
});

describe('navegador: cerrar, recargar u ocultar la pestaña', () => {
  it('beforeunload guarda y pide confirmación solo con partida en curso', () => {
    expect([...IN_PROGRESS].sort()).toEqual(['map', 'paused', 'playing', 'shop']);
    for (const state of IN_PROGRESS) {
      const { win, game } = setup({ state });
      const e = win.dispatch('beforeunload');
      expect(e.defaultPrevented, state).toBe(true);
      expect(e.returnValue).toBe('');
      expect(game.saves).toBe(1);
    }
    for (const state of ['menu', 'loading']) {
      const { win, game } = setup({ state });
      const e = win.dispatch('beforeunload');
      expect(e.defaultPrevented, state).toBe(false);
      expect(e.returnValue).toBeUndefined();
      expect(game.saves).toBe(0);
    }
  });

  it('beforeunload: muerto pregunta sin guardar; si la GPU se reinició, recarga sin preguntar', () => {
    const a = setup();
    a.game.player.dead = true;
    expect(a.win.dispatch('beforeunload').defaultPrevented).toBe(true);
    expect(a.game.saves).toBe(0);
    const b = setup();
    b.game.contextLost = true;
    expect(b.win.dispatch('beforeunload').defaultPrevented).toBe(false);
  });

  it('pagehide guarda si había partida', () => {
    const a = setup({ state: 'map' });
    a.win.dispatch('pagehide');
    expect(a.game.saves).toBe(1);
    const b = setup({ state: 'menu' });
    b.win.dispatch('pagehide');
    expect(b.game.saves).toBe(0);
  });

  it('al ocultarse la pestaña pausa solo si se está jugando', () => {
    const a = setup();
    a.doc.visibilityState = 'hidden';
    a.doc.dispatch('visibilitychange');
    expect(a.game.pauses).toBe(1);
    expect(a.game.state).toBe('paused');
    // Al volver a la pestaña no se reanuda sola.
    a.doc.visibilityState = 'visible';
    a.doc.dispatch('visibilitychange');
    expect(a.game.pauses).toBe(1);
    expect(a.game.state).toBe('paused');

    const b = setup({ state: 'shop' });
    b.doc.visibilityState = 'hidden';
    b.doc.dispatch('visibilitychange');
    expect(b.game.pauses).toBe(0);
    expect(b.game.saves).toBe(1);

    const c = setup({ state: 'menu' });
    c.doc.visibilityState = 'hidden';
    c.doc.dispatch('visibilitychange');
    expect(c.game.pauses + c.game.saves).toBe(0);
  });
});

describe('navegador: pruebas automáticas y app de escritorio', () => {
  it('con autotest no instala nada', () => {
    const { win, doc, game } = setup({ autotest: true });
    expect(win.listeners).toEqual([]);
    expect(doc.listeners).toEqual([]);
    expect(win.dispatch('keydown', key('KeyW', { ctrlKey: true })).defaultPrevented).toBe(false);
    expect(win.dispatch('beforeunload').defaultPrevented).toBe(false);
    doc.visibilityState = 'hidden';
    doc.dispatch('visibilitychange');
    expect(game.pauses + game.saves).toBe(0);
  });

  it('en Electron no toca los atajos ni pregunta al cerrar, pero sí pausa al minimizar', () => {
    const { win, doc, game } = setup({ desktopApp: true });
    expect(win.dispatch('keydown', key('KeyD', { ctrlKey: true })).defaultPrevented).toBe(false);
    expect(win.dispatch('beforeunload').defaultPrevented).toBe(false);
    expect(doc.listeners.some((l) => l.type === 'fullscreenchange')).toBe(false);
    doc.visibilityState = 'hidden';
    doc.dispatch('visibilitychange');
    expect(game.pauses).toBe(1);
  });

  it('dispose quita los oyentes', () => {
    const { win, doc, guards, game } = setup();
    guards.dispose();
    expect(win.listeners).toEqual([]);
    expect(doc.listeners).toEqual([]);
    expect(win.dispatch('beforeunload').defaultPrevented).toBe(false);
    expect(game.saves).toBe(0);
  });
});

describe('navegador: Keyboard Lock en pantalla completa', () => {
  it('bloquea el teclado al entrar a pantalla completa y lo suelta al salir', async () => {
    const keyboard = { lock: vi.fn(() => Promise.resolve()), unlock: vi.fn() };
    const { doc, guards } = setup({ state: 'menu', keyboard });
    doc.fullscreenElement = {};
    doc.dispatch('fullscreenchange');
    expect(keyboard.lock).toHaveBeenCalledTimes(1);
    // Solo lo que el navegador no deja cancelar: Alt+Tab y Win siguen siendo del sistema.
    expect(keyboard.lock).toHaveBeenCalledWith(['KeyW', 'KeyT', 'KeyN', 'Escape']);
    await tick();
    expect(guards.keyboardLocked).toBe(true);
    doc.fullscreenElement = null;
    doc.dispatch('fullscreenchange');
    expect(keyboard.unlock).toHaveBeenCalledTimes(1);
    expect(guards.keyboardLocked).toBe(false);
  });

  it('sin la API (Firefox, Safari) o si la rechaza, no falla', async () => {
    const a = setup();
    a.doc.fullscreenElement = {};
    expect(() => a.doc.dispatch('fullscreenchange')).not.toThrow();
    const keyboard = { lock: vi.fn(() => Promise.reject(new Error('NotAllowedError'))), unlock: vi.fn(() => {
      throw new Error('raro');
    }) };
    const b = setup({ keyboard });
    b.doc.fullscreenElement = {};
    b.doc.dispatch('fullscreenchange');
    await tick();
    expect(b.guards.keyboardLocked).toBe(false);
    b.doc.fullscreenElement = null;
    expect(() => b.doc.dispatch('fullscreenchange')).not.toThrow();
    const c = setup({ keyboard: { lock: () => {
      throw new Error('sin permiso');
    } } });
    c.doc.fullscreenElement = {};
    expect(() => c.doc.dispatch('fullscreenchange')).not.toThrow();
  });
});

describe('navegador: almacenamiento persistente', () => {
  it('lo pide una vez si no está ya persistido y nunca lanza', async () => {
    expect(await requestPersistentStorage({})).toBe(false);
    expect(await requestPersistentStorage(undefined)).toBe(false);
    const ya = { storage: { persisted: vi.fn(async () => true), persist: vi.fn(async () => true) } };
    expect(await requestPersistentStorage(ya)).toBe(true);
    expect(ya.storage.persist).not.toHaveBeenCalled();
    const nuevo = { storage: { persisted: vi.fn(async () => false), persist: vi.fn(async () => true) } };
    expect(await requestPersistentStorage(nuevo)).toBe(true);
    expect(nuevo.storage.persist).toHaveBeenCalledTimes(1);
    const negado = { storage: { persisted: async () => false, persist: async () => false } };
    expect(await requestPersistentStorage(negado)).toBe(false);
    const roto = { storage: { persist: async () => {
      throw new Error('SecurityError');
    } } };
    expect(await requestPersistentStorage(roto)).toBe(false);
  });
});
