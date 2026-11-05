// Entrada unificada: teclado + ratón (con pointer lock), mando (Xbox/XInput
// en Windows vía Gamepad API) y pantalla táctil (ui/touchControls.js pinta los
// controles y alimenta un TouchInput, que poll() mezcla con lo demás). Usa
// `event.code` para funcionar con teclados en español (ES/LatAm) igual que con US.

const DEADZONE = 0.18;

/** Radianes por píxel de ratón con sensibilidad 1 (la cámara gira con lookX / lookY). */
export const MOUSE_LOOK = 0.0022;
/**
 * El dedo recorre menos píxeles que el ratón para el mismo giro: con
 * sensibilidad 1, arrastrar media pantalla de un celular acostado (~400 px)
 * gira unos 150°.
 */
export const TOUCH_LOOK_GAIN = 3;

// Cómo entra cada acción de otra fuente (la táctil) en las de teclado/ratón/mando.
const SUMMED = new Set(['moveX', 'moveY', 'steer', 'lookX', 'lookY', 'weaponCycle']);
const MAXED = new Set(['throttle', 'brake']);
const clamp1 = (v) => Math.max(-1, Math.min(1, v || 0));

/**
 * Mezcla en `a` (acciones de teclado, ratón y mando) las de otra fuente `t`:
 * ejes y giros se suman, acelerador y freno toman el mayor (son analógicos
 * 0..1), los botones se combinan con O y el arma por número solo cuenta si
 * la otra fuente eligió una. `lookDx` / `lookDy` vienen en píxeles de dedo y
 * se pasan a radianes con la escala del ratón (× TOUCH_LOOK_GAIN), la
 * sensibilidad y el eje Y invertido. Recorta moveX / moveY / steer a [-1, 1].
 * Pura (se prueba en Node). Devuelve `a`.
 * @param {object} a
 * @param {object | null} t
 * @param {{ sensitivity?: number, invertY?: boolean }} [opts]
 */
export function mergeActions(a, t, { sensitivity = 1, invertY = false } = {}) {
  if (!t) return a;
  const k = MOUSE_LOOK * TOUCH_LOOK_GAIN * sensitivity;
  for (const key of Object.keys(t)) {
    const v = t[key];
    if (v === undefined || v === null) continue;
    if (key === 'lookDx') a.lookX = (a.lookX ?? 0) + v * k;
    else if (key === 'lookDy') a.lookY = (a.lookY ?? 0) + v * k * (invertY ? -1 : 1);
    else if (SUMMED.has(key)) a[key] = (a[key] ?? 0) + v;
    else if (MAXED.has(key)) a[key] = Math.max(a[key] ?? 0, v);
    else if (key === 'weaponSlot') {
      if (v) a.weaponSlot = v;
    } else if (typeof v === 'boolean') a[key] = !!a[key] || v;
    else if (typeof v === 'number') a[key] = (a[key] ?? 0) + v;
  }
  a.moveX = clamp1(a.moveX);
  a.moveY = clamp1(a.moveY);
  a.steer = clamp1(a.steer);
  return a;
}

// ---------------------------------------------------------------- joystick táctil

/** Zona muerta del joystick en pantalla (fracción del radio). */
export const STICK_DEADZONE = 0.14;
/** Empujado más allá de esta fracción del radio, a pie se corre. */
export const STICK_SPRINT = 0.9;
/** En vehículo, zona muerta por eje: ir derecho no gira y girar no acelera. */
export const STICK_AXIS_DEADZONE = 0.12;

/**
 * Joystick flotante: del desplazamiento del dedo desde el centro (px, con y
 * hacia abajo como en la pantalla) a un vector -1..1 con y hacia ARRIBA. Se
 * recorta al radio; dentro de la zona muerta no mueve y el resto se reescala
 * para arrancar suave desde su borde. `push` (0..1) es cuánto se empuja sin
 * zona muerta (para correr) y `knobX` / `knobY`, dónde se dibuja la perilla (px).
 */
export function joystickVector(dx, dy, radius, deadzone = STICK_DEADZONE) {
  const d = Math.hypot(dx, dy);
  if (!(radius > 0) || !(d > 0)) return { x: 0, y: 0, push: 0, knobX: 0, knobY: 0 };
  const push = Math.min(1, d / radius);
  const ux = dx / d;
  const uy = dy / d;
  const m = push <= deadzone ? 0 : (push - deadzone) / (1 - deadzone);
  return { x: ux * m, y: -uy * m, push, knobX: ux * push * radius, knobY: uy * push * radius };
}

/**
 * Lo que hace el joystick: a pie mueve (y empujado hasta el borde, corre);
 * en vehículo X gira y arriba / abajo son acelerador / freno analógicos
 * (abajo con el carro quieto es reversa, como la S).
 */
export function stickActions(v, inVehicle) {
  if (!v) return {};
  if (inVehicle) {
    const dz = STICK_AXIS_DEADZONE;
    const ax = (q) => (Math.abs(q) <= dz ? 0 : (q - Math.sign(q) * dz) / (1 - dz));
    const sx = ax(v.x);
    const sy = ax(v.y);
    return { steer: sx, throttle: Math.max(0, sy), brake: Math.max(0, -sy) };
  }
  return { moveX: v.x, moveY: v.y, sprint: v.push > STICK_SPRINT };
}

/**
 * Estado de los controles táctiles, sin DOM: la interfaz llama press /
 * release / tap / toggle / setStick / addLook e Input.poll lo mezcla. Un
 * toque rápido —bajar y subir el dedo entre dos cuadros— igual cuenta un
 * cuadro; las acciones de un solo cuadro y el giro de cámara acumulado se
 * consumen en endFrame (lo llama Input.endFrame).
 */
export class TouchInput {
  /** @param {{ isVehicle?: () => boolean }} [opts] */
  constructor({ isVehicle = () => false } = {}) {
    this.isVehicle = isVehicle;
    this.active = false; // controles en pantalla: poll() aporta y no se pide pointer lock
    this.radius = 60; // radio del joystick (px); la interfaz lo ajusta a la pantalla
    this.stick = null; // joystickVector(...) mientras haya un dedo en el joystick
    this.held = new Set(); // botones mantenidos
    this.fresh = new Set(); // presionados en este cuadro
    this.taps = new Map(); // acciones de un solo cuadro (clave → true | número)
    this.toggles = { aim: false, crouch: false };
    this.version = 0; // cambia con los alternables (la interfaz los repinta)
    this.lookDx = 0;
    this.lookDy = 0;
  }

  setStick(dx, dy) {
    this.stick = joystickVector(dx, dy, this.radius);
    return this.stick;
  }

  releaseStick() {
    this.stick = null;
  }

  press(key) {
    // Saltar estando agachado: primero se para (como en los juegos de celular).
    if (key === 'jump') this.setToggle('crouch', false);
    this.held.add(key);
    this.fresh.add(key);
  }

  release(key) {
    this.held.delete(key);
  }

  /** Acción de un solo cuadro; las numéricas (weaponCycle) se acumulan. */
  tap(key, value = true) {
    if (typeof value === 'number') this.taps.set(key, (this.taps.get(key) ?? 0) + value);
    else this.taps.set(key, value);
  }

  toggle(key) {
    this.setToggle(key, !this.toggles[key]);
    return this.toggles[key];
  }

  setToggle(key, on) {
    if (!!this.toggles[key] === !!on) return;
    this.toggles[key] = !!on;
    this.version++;
  }

  addLook(dx, dy) {
    this.lookDx += dx;
    this.lookDy += dy;
  }

  isDown(key) {
    return this.held.has(key) || this.fresh.has(key);
  }

  /** Acciones de este cuadro (parciales, para mergeActions) o null si los controles no están. */
  poll() {
    if (!this.active) return null;
    const veh = !!this.isVehicle();
    const t = stickActions(this.stick, veh);
    const d = (k) => this.isDown(k);
    t.fire = d('fire');
    t.firePressed = this.fresh.has('fire');
    if (veh) {
      // Disparar desde el vehículo es apuntar y disparar a la vez (clic der. + izq.).
      t.aim = t.fire;
      t.handbrake = d('handbrake');
      t.horn = d('horn');
      t.lookBehind = d('lookBehind');
    } else {
      // Al correr se para: agachado no se puede.
      if (t.sprint) this.setToggle('crouch', false);
      t.aim = this.toggles.aim;
      t.crouch = this.toggles.crouch;
      t.jump = d('jump');
    }
    for (const [k, v] of this.taps) t[k] = typeof v === 'number' ? (t[k] ?? 0) + v : t[k] || v;
    if (this.lookDx || this.lookDy) {
      t.lookDx = this.lookDx;
      t.lookDy = this.lookDy;
    }
    return t;
  }

  endFrame() {
    this.fresh.clear();
    this.taps.clear();
    this.lookDx = 0;
    this.lookDy = 0;
  }

  /** Suelta todo lo que se esté tocando (los alternables siguen como estaban). */
  releaseAll() {
    this.held.clear();
    this.fresh.clear();
    this.taps.clear();
    this.stick = null;
    this.lookDx = 0;
    this.lookDy = 0;
  }

  /** Todo apagado, alternables incluidos (al cambiar de modo o esconder los controles). */
  reset() {
    this.releaseAll();
    this.setToggle('aim', false);
    this.setToggle('crouch', false);
  }
}

export class Input {
  constructor(element) {
    this.el = element;
    this.down = new Set();
    this.pressed = new Set();
    this.mouse = { dx: 0, dy: 0, left: false, right: false, leftPressed: false, wheel: 0 };
    this.sensitivity = 1;
    this.invertY = false;
    this.locked = false;
    this.virtual = null; // pruebas automáticas
    this.touch = null; // TouchInput de los controles en pantalla (ui/touchControls.js)
    this.gamepad = null;
    this.padPrev = [];
    this.usingPad = false;

    this._onKeyDown = (e) => {
      if (e.repeat) return;
      if (['Tab', 'Space', 'ArrowUp', 'ArrowDown', 'F1'].includes(e.code)) e.preventDefault();
      this.down.add(e.code);
      this.pressed.add(e.code);
      this.usingPad = false;
    };
    this._onKeyUp = (e) => this.down.delete(e.code);
    this._onMouseMove = (e) => {
      if (!this.locked) return;
      this.mouse.dx += e.movementX;
      this.mouse.dy += e.movementY;
      this.usingPad = false;
    };
    this._onMouseDown = (e) => {
      if (e.button === 0) {
        this.mouse.left = true;
        this.mouse.leftPressed = true;
      }
      if (e.button === 2) this.mouse.right = true;
    };
    this._onMouseUp = (e) => {
      if (e.button === 0) this.mouse.left = false;
      if (e.button === 2) this.mouse.right = false;
    };
    this._onWheel = (e) => {
      this.mouse.wheel += Math.sign(e.deltaY);
    };
    this._onBlur = () => {
      this.down.clear();
      this.mouse.left = this.mouse.right = false;
    };
    this._onLockChange = () => {
      this.locked = document.pointerLockElement === this.el;
    };
    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('mousemove', this._onMouseMove);
    this.el.addEventListener('mousedown', this._onMouseDown);
    window.addEventListener('mouseup', this._onMouseUp);
    this.el.addEventListener('wheel', this._onWheel, { passive: true });
    this.el.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('blur', this._onBlur);
    document.addEventListener('pointerlockchange', this._onLockChange);
  }

  requestLock() {
    // Jugando con los dedos no hay cursor que capturar (y en Android el
    // pointer lock se quedaría con los toques).
    if (this.touch?.active) return;
    // Sin gesto del usuario (o con la ventana sin foco) el navegador rechaza la
    // captura (WrongDocumentError, NotAllowedError): no es un error del juego,
    // el siguiente clic en el canvas la vuelve a pedir.
    const quiet = (r) => r?.catch?.(() => {});
    const plain = () => {
      try {
        quiet(this.el.requestPointerLock?.());
      } catch {
        // navegador sin pointer lock
      }
    };
    try {
      const r = this.el.requestPointerLock?.({ unadjustedMovement: true });
      // Sin soporte para unadjustedMovement: se pide la captura normal.
      if (r?.catch) r.catch(plain);
    } catch {
      plain();
    }
  }

  exitLock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  key(code) {
    return this.down.has(code);
  }

  hit(code) {
    return this.pressed.has(code);
  }

  _pad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) if (p && p.connected) return p;
    return null;
  }

  /** Lee el estado de este frame y devuelve las acciones del juego. */
  poll() {
    const k = (c) => this.down.has(c);
    const h = (c) => this.pressed.has(c);
    const a = {
      moveX: (k('KeyD') ? 1 : 0) - (k('KeyA') ? 1 : 0),
      moveY: (k('KeyW') ? 1 : 0) - (k('KeyS') ? 1 : 0),
      lookX: this.mouse.dx * 0.0022 * this.sensitivity,
      lookY: this.mouse.dy * 0.0022 * this.sensitivity * (this.invertY ? -1 : 1),
      sprint: k('ShiftLeft') || k('ShiftRight'),
      walk: k('AltLeft'),
      jump: k('Space'),
      crouch: k('ControlLeft') || k('KeyC'),
      fire: this.mouse.left,
      firePressed: this.mouse.leftPressed,
      aim: this.mouse.right,
      reload: h('KeyR'),
      interact: h('KeyE'),
      enterVehicle: h('KeyF') || h('Enter'),
      weaponCycle: this.mouse.wheel,
      weaponSlot: 0,
      weaponWheel: k('Tab'),
      handbrake: k('Space'),
      horn: k('KeyH'),
      map: h('KeyM'),
      pause: h('Escape') || h('KeyP'),
      camera: h('KeyV'),
      shoulder: h('KeyX'),
      lookBehind: k('KeyC'),
      throttle: k('KeyW') || k('ArrowUp') ? 1 : 0,
      brake: k('KeyS') || k('ArrowDown') ? 1 : 0,
      steer: (k('KeyD') || k('ArrowRight') ? 1 : 0) - (k('KeyA') || k('ArrowLeft') ? 1 : 0),
      phone: h('KeyT'),
      help: h('F1'),
      emote: h('KeyG'),
      // Radio del vehículo: Q siguiente emisora, Z la anterior.
      radioNext: h('KeyQ'),
      radioPrev: h('KeyZ'),
    };
    for (let i = 1; i <= 6; i++) if (h(`Digit${i}`) || h(`Numpad${i}`)) a.weaponSlot = i;

    // Mando.
    const pad = this._pad();
    if (pad) {
      const ax = (i) => (Math.abs(pad.axes[i] ?? 0) > DEADZONE ? pad.axes[i] : 0);
      const b = (i) => !!pad.buttons[i]?.pressed;
      const bv = (i) => pad.buttons[i]?.value ?? 0;
      const bh = (i) => b(i) && !this.padPrev[i];
      const any = pad.buttons.some((x) => x.pressed) || pad.axes.some((v) => Math.abs(v) > 0.3);
      if (any) this.usingPad = true;
      if (this.usingPad) {
        a.moveX += ax(0);
        a.moveY += -ax(1);
        a.lookX += ax(2) * 0.045 * this.sensitivity;
        a.lookY += ax(3) * 0.035 * this.sensitivity * (this.invertY ? -1 : 1);
        // Xbox: A saltar, B agacharse/freno de mano, X recargar, Y subir/bajar,
        // LB/RB cambiar arma, LT apuntar/frenar, RT disparar/acelerar,
        // L3 correr/pito, R3 cámara, cruceta ↑ interactuar / ↓ gestos / ← hombro a pie, ← → emisora en vehículo, View mapa, Menu pausa.
        a.sprint ||= b(10);
        a.jump ||= b(0);
        a.crouch ||= b(1);
        a.handbrake ||= b(1);
        a.fire ||= bv(7) > 0.3;
        a.firePressed ||= bv(7) > 0.3 && !this.padPrev[7];
        a.aim ||= bv(6) > 0.3;
        a.reload ||= bh(2);
        a.enterVehicle ||= bh(3);
        a.interact ||= bh(12);
        a.emote ||= bh(13);
        a.weaponCycle += (bh(5) ? 1 : 0) - (bh(4) ? 1 : 0);
        a.weaponWheel ||= b(4) && b(5);
        a.pause ||= bh(9);
        a.map ||= bh(8);
        a.camera ||= bh(11);
        a.shoulder ||= bh(14);
        a.throttle = Math.max(a.throttle, bv(7));
        a.brake = Math.max(a.brake, bv(6));
        a.steer += ax(0);
        a.horn ||= b(10);
        // Cruceta ← → cambia de emisora (solo en vehículo).
        a.radioNext ||= bh(15);
        a.radioPrev ||= bh(14);
      }
      this.padPrev = pad.buttons.map((x) => x.pressed);
    }

    // Pantalla táctil: se suma a lo demás (ver mergeActions).
    if (this.touch) mergeActions(a, this.touch.poll(), this);

    // La entrada virtual de las pruebas solo pisa las claves que trae.
    if (this.virtual) Object.assign(a, this.virtual);
    a.moveX = Math.max(-1, Math.min(1, a.moveX));
    a.moveY = Math.max(-1, Math.min(1, a.moveY));
    a.steer = Math.max(-1, Math.min(1, a.steer));
    return a;
  }

  /** Limpia los eventos de un solo frame. */
  endFrame() {
    this.pressed.clear();
    this.mouse.dx = 0;
    this.mouse.dy = 0;
    this.mouse.wheel = 0;
    this.mouse.leftPressed = false;
    this.touch?.endFrame();
    if (this.virtual) {
      // Acciones de un solo frame en la entrada virtual.
      for (const key of ['reload', 'interact', 'enterVehicle', 'map', 'pause', 'camera', 'firePressed', 'phone', 'help', 'emote']) delete this.virtual[key];
      if (this.virtual.weaponSlot) this.virtual.weaponSlot = 0;
      if (this.virtual.weaponCycle) this.virtual.weaponCycle = 0;
      if (this.virtual.lookX) this.virtual.lookX = 0;
      if (this.virtual.lookY) this.virtual.lookY = 0;
    }
  }
}
