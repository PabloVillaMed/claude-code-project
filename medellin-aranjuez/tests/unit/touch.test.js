// Controles táctiles: matemática del joystick, mezcla de la fuente táctil con
// teclado / ratón / mando / entrada virtual y acciones de un solo cuadro.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Input, MOUSE_LOOK, STICK_AXIS_DEADZONE, STICK_DEADZONE, TOUCH_LOOK_GAIN, TouchInput, joystickVector, mergeActions, stickActions } from '../../src/game/input.js';
import { BUTTONS, buttonsFor, touchHelpText, touchMode } from '../../src/ui/touchControls.js';

const close = (a, b, eps = 1e-9) => expect(Math.abs(a - b)).toBeLessThan(eps);

describe('joystick', () => {
  it('quieto o sin radio no mueve', () => {
    expect(joystickVector(0, 0, 60)).toMatchObject({ x: 0, y: 0, push: 0 });
    expect(joystickVector(10, 10, 0)).toMatchObject({ x: 0, y: 0, push: 0 });
  });

  it('la zona muerta no mueve, pero cuenta cuánto se empuja', () => {
    const v = joystickVector(0, -60 * STICK_DEADZONE * 0.9, 60);
    expect(v.x).toBe(0);
    expect(v.y).toBe(0);
    expect(v.push).toBeGreaterThan(0);
  });

  it('se recorta al radio y la perilla no se sale', () => {
    const v = joystickVector(300, 0, 60);
    close(v.x, 1);
    close(v.y, 0);
    close(v.push, 1);
    close(v.knobX, 60);
    close(v.knobY, 0);
  });

  it('arriba en la pantalla (dy < 0) es adelante (y > 0)', () => {
    const v = joystickVector(0, -60, 60);
    close(v.y, 1);
    close(v.knobY, -60);
  });

  it('se reescala desde el borde de la zona muerta y conserva la dirección', () => {
    const v = joystickVector(30 * Math.SQRT1_2, -30 * Math.SQRT1_2, 60);
    const m = (0.5 - STICK_DEADZONE) / (1 - STICK_DEADZONE);
    close(Math.hypot(v.x, v.y), m);
    close(v.x, v.y);
    expect(v.x).toBeGreaterThan(0);
  });

  it('a pie: mueve y corre solo empujado hasta el borde (> 90 %)', () => {
    const walk = stickActions(joystickVector(0, -50, 60), false);
    expect(walk.moveY).toBeGreaterThan(0.7);
    expect(walk.sprint).toBe(false);
    const run = stickActions(joystickVector(0, -58, 60), false);
    expect(run.sprint).toBe(true);
    expect(run.steer).toBeUndefined();
    expect(run.throttle).toBeUndefined();
  });

  it('en vehículo: X gira, arriba acelera y abajo frena, analógicos', () => {
    const up = stickActions(joystickVector(0, -60, 60), true);
    close(up.throttle, 1);
    expect(up.brake).toBe(0);
    expect(up.steer).toBe(0);
    expect(up.moveY).toBeUndefined();
    const down = stickActions(joystickVector(0, 30, 60), true);
    expect(down.throttle).toBe(0);
    expect(down.brake).toBeGreaterThan(0.2);
    expect(down.brake).toBeLessThan(0.5);
    const left = stickActions(joystickVector(-60, 0, 60), true);
    close(left.steer, -1);
    expect(left.throttle).toBe(0);
    // Casi derecho hacia arriba: la zona muerta por eje no deja girar.
    const straight = stickActions({ x: STICK_AXIS_DEADZONE * 0.8, y: 0.9, push: 1 }, true);
    expect(straight.steer).toBe(0);
    expect(straight.throttle).toBeGreaterThan(0.85);
  });
});

describe('mergeActions', () => {
  const keyboard = () => ({ moveX: 1, moveY: 0, lookX: 0.01, lookY: 0, steer: 1, throttle: 0.4, brake: 0, fire: false, jump: true, reload: false, weaponCycle: 1, weaponSlot: 3 });

  it('sin fuente táctil no cambia nada', () => {
    expect(mergeActions(keyboard(), null)).toEqual(keyboard());
  });

  it('suma ejes y recorta a [-1, 1]; acelerador y freno toman el mayor; botones con O', () => {
    const a = mergeActions(keyboard(), { moveX: 0.8, moveY: -0.5, steer: 0.7, throttle: 0.9, brake: 0.3, fire: true, jump: false, reload: true, weaponCycle: 1 });
    expect(a.moveX).toBe(1);
    expect(a.moveY).toBe(-0.5);
    expect(a.steer).toBe(1);
    expect(a.throttle).toBe(0.9);
    expect(a.brake).toBe(0.3);
    expect(a.fire).toBe(true);
    expect(a.jump).toBe(true); // el teclado sigue mandando
    expect(a.reload).toBe(true);
    expect(a.weaponCycle).toBe(2);
    expect(a.weaponSlot).toBe(3); // sin número de arma táctil se respeta el del teclado
    const b = mergeActions(keyboard(), { throttle: 0.1, weaponSlot: 0 });
    expect(b.throttle).toBe(0.4);
    expect(b.weaponSlot).toBe(3);
    expect(mergeActions(keyboard(), { weaponSlot: 5 }).weaponSlot).toBe(5);
  });

  it('el giro del dedo usa la escala del ratón, la sensibilidad y el Y invertido', () => {
    const k = MOUSE_LOOK * TOUCH_LOOK_GAIN;
    const a = mergeActions({ lookX: 0, lookY: 0 }, { lookDx: 100, lookDy: 50 }, { sensitivity: 2, invertY: true });
    close(a.lookX, 100 * k * 2);
    close(a.lookY, -50 * k * 2);
    const b = mergeActions({ lookX: 0.1, lookY: 0 }, { lookDx: 10, lookDy: 10 });
    close(b.lookX, 0.1 + 10 * k);
    close(b.lookY, 10 * k);
  });
});

describe('TouchInput', () => {
  it('apagado no aporta nada', () => {
    const t = new TouchInput();
    t.press('fire');
    expect(t.poll()).toBeNull();
  });

  it('un toque rápido (bajar y subir entre cuadros) cuenta un cuadro; mantener sigue valiendo', () => {
    const t = new TouchInput();
    t.active = true;
    t.press('jump');
    t.release('jump');
    expect(t.poll().jump).toBe(true);
    t.endFrame();
    expect(t.poll().jump).toBe(false);
    t.press('fire');
    expect(t.poll()).toMatchObject({ fire: true, firePressed: true });
    t.endFrame();
    expect(t.poll()).toMatchObject({ fire: true, firePressed: false });
    t.release('fire');
    expect(t.poll().fire).toBe(false);
  });

  it('las acciones de un cuadro y el giro se consumen en endFrame; el cambio de arma se acumula', () => {
    const t = new TouchInput();
    t.active = true;
    t.tap('reload');
    t.tap('pause');
    t.tap('weaponCycle', 1);
    t.tap('weaponCycle', 1);
    t.addLook(12, -4);
    t.addLook(3, 1);
    const a = t.poll();
    expect(a).toMatchObject({ reload: true, pause: true, weaponCycle: 2, lookDx: 15, lookDy: -3 });
    t.endFrame();
    const b = t.poll();
    expect(b.reload).toBeUndefined();
    expect(b.pause).toBeUndefined();
    expect(b.weaponCycle).toBeUndefined();
    expect(b.lookDx).toBeUndefined();
  });

  it('apuntar y agacharse se alternan; saltar o correr levantan al agachado', () => {
    const t = new TouchInput();
    t.active = true;
    const v0 = t.version;
    expect(t.toggle('aim')).toBe(true);
    expect(t.toggle('crouch')).toBe(true);
    expect(t.version).toBe(v0 + 2);
    expect(t.poll()).toMatchObject({ aim: true, crouch: true });
    t.press('jump');
    expect(t.poll().crouch).toBe(false);
    t.release('jump');
    t.endFrame();
    t.toggle('crouch');
    t.radius = 60;
    t.setStick(0, -59);
    const a = t.poll();
    expect(a.sprint).toBe(true);
    expect(a.crouch).toBe(false);
    expect(t.toggles.crouch).toBe(false);
    expect(t.toggle('aim')).toBe(false);
  });

  it('en vehículo el joystick acelera y Disparar también apunta (drive-by)', () => {
    let veh = false;
    const t = new TouchInput({ isVehicle: () => veh });
    t.active = true;
    t.setStick(0, -60);
    expect(t.poll()).toMatchObject({ moveY: 1 });
    veh = true;
    t.press('fire');
    t.press('handbrake');
    const a = t.poll();
    expect(a.throttle).toBe(1);
    expect(a.moveY).toBeUndefined();
    expect(a).toMatchObject({ fire: true, aim: true, handbrake: true });
    expect(a.jump).toBeUndefined();
    t.toggle('aim');
    t.release('fire');
    t.endFrame();
    expect(t.poll().aim).toBe(false); // el apuntar alternable es de a pie
  });

  it('releaseAll suelta todo y reset también apaga los alternables', () => {
    const t = new TouchInput();
    t.active = true;
    t.press('fire');
    t.setStick(10, 10);
    t.toggle('aim');
    t.releaseAll();
    expect(t.poll()).toMatchObject({ fire: false, aim: true });
    expect(t.stick).toBeNull();
    t.reset();
    expect(t.poll().aim).toBe(false);
  });
});

describe('Input con la fuente táctil', () => {
  const saved = {};
  beforeAll(() => {
    for (const k of ['window', 'document']) saved[k] = globalThis[k];
    const noop = () => {};
    globalThis.window = { addEventListener: noop, removeEventListener: noop };
    globalThis.document = { addEventListener: noop, removeEventListener: noop, pointerLockElement: null };
  });
  afterAll(() => {
    for (const k of Object.keys(saved)) globalThis[k] = saved[k];
  });
  const make = () => {
    let locks = 0;
    const el = { addEventListener: () => {}, requestPointerLock: () => locks++ };
    const input = new Input(el);
    const touch = new TouchInput();
    touch.active = true;
    input.touch = touch;
    return { input, touch, locks: () => locks };
  };

  it('se suma al teclado y respeta la sensibilidad', () => {
    const { input, touch } = make();
    input.down.add('KeyW');
    input.sensitivity = 1.5;
    touch.setStick(-60, 0);
    touch.addLook(20, 0);
    const a = input.poll();
    expect(a.moveY).toBe(1);
    expect(a.moveX).toBe(-1);
    close(a.lookX, 20 * MOUSE_LOOK * TOUCH_LOOK_GAIN * 1.5);
  });

  it('la entrada virtual de las pruebas solo pisa las claves que trae', () => {
    const { input, touch } = make();
    touch.setStick(0, -60);
    touch.press('fire');
    input.virtual = { moveX: 0.5 };
    const a = input.poll();
    expect(a.moveX).toBe(0.5);
    expect(a.moveY).toBe(1); // lo táctil sigue
    expect(a.fire).toBe(true);
  });

  it('endFrame consume las acciones táctiles de un cuadro', () => {
    const { input, touch } = make();
    touch.tap('interact');
    touch.tap('enterVehicle');
    expect(input.poll()).toMatchObject({ interact: true, enterVehicle: true });
    input.endFrame();
    expect(input.poll()).toMatchObject({ interact: false, enterVehicle: false });
  });

  it('con los controles en pantalla no se pide el pointer lock', () => {
    const { input, touch, locks } = make();
    input.requestLock();
    expect(locks()).toBe(0);
    touch.active = false;
    input.requestLock();
    expect(locks()).toBe(1);
  });
});

describe('interfaz táctil (lógica pura)', () => {
  it('modo: solo jugando, sin entrada de cine; en cinemáticas, capa para saltar', () => {
    const g = { state: 'playing', intro: null, storyDir: { cinematic: null }, player: { inVehicle: false } };
    expect(touchMode(g, false)).toBeNull();
    expect(touchMode(g, true)).toBe('pie');
    expect(touchMode({ ...g, player: { inVehicle: true } }, true)).toBe('vehiculo');
    expect(touchMode({ ...g, storyDir: { cinematic: {} } }, true)).toBe('cine');
    expect(touchMode({ ...g, intro: {} }, true)).toBeNull();
    for (const state of ['menu', 'paused', 'map', 'shop', 'loading']) expect(touchMode({ ...g, state }, true)).toBeNull();
  });

  it('botones por modo, todos de 56 px o más', () => {
    const pie = buttonsFor('pie');
    for (const id of ['fire', 'aim', 'jump', 'crouch', 'reload', 'weapon', 'vehicle', 'use', 'emote', 'camera', 'map', 'pause']) expect(pie).toContain(id);
    expect(pie).not.toContain('handbrake');
    expect(pie).not.toContain('fullscreen');
    const veh = buttonsFor('vehiculo', { fullscreen: true });
    for (const id of ['handbrake', 'horn', 'exit', 'radio', 'fireVeh', 'camera', 'lookBehind', 'use', 'map', 'pause', 'fullscreen']) expect(veh).toContain(id);
    expect(veh).not.toContain('jump');
    // El caballito solo en moto.
    expect(veh).not.toContain('wheelie');
    expect(buttonsFor('vehiculo', { moto: true })).toContain('wheelie');
    const px = { s: 56, m: 64, l: 80 };
    for (const b of BUTTONS) expect(px[b.size ?? 's']).toBeGreaterThanOrEqual(56);
  });

  it('los botones del racimo no se tapan entre sí (en cada modo)', () => {
    const px = { s: 56, m: 64, l: 80 };
    for (const m of ['pie', 'veh']) {
      const list = BUTTONS.filter((b) => b.at && b.modes.includes(m));
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          const p = list[i];
          const q = list[j];
          const d = Math.hypot(p.at[0] - q.at[0], p.at[1] - q.at[1]);
          expect(d, `${p.id} / ${q.id}`).toBeGreaterThanOrEqual((px[p.size ?? 's'] + px[q.size ?? 's']) / 2);
        }
      }
    }
  });

  it('las ayudas nombran los botones táctiles en vez de las teclas', () => {
    expect(touchHelpText('Presiona <kbd>E</kbd> para curarte ($200).')).toBe('Toca <kbd>Usar</kbd> para curarte ($200).');
    expect(touchHelpText('<kbd>F</kbd> para subirte a un carro o moto, <kbd>M</kbd> mapa, <kbd>F1</kbd> controles.')).toBe('<kbd>Vehículo</kbd> para subirte a un carro o moto, <kbd>Mapa</kbd>, <kbd>Pausa</kbd> › Controles.');
    expect(touchHelpText('Súbete a la moto roja (<kbd>F</kbd>)')).toBe('Súbete a la moto roja (<kbd>Vehículo</kbd>)');
    // Ya traducido: no cambia (el observador del HUD no entra en bucle).
    const once = touchHelpText('Presiona <kbd>E</kbd> para comprar.');
    expect(touchHelpText(once)).toBe(once);
    expect(touchHelpText('<kbd>Ctrl</kbd> agacharse')).toBe('<kbd>Ctrl</kbd> agacharse');
  });
});
