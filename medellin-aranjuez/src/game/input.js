// Entrada unificada: teclado + ratón (con pointer lock) y mando (Xbox/XInput
// en Windows vía Gamepad API). Usa `event.code` para funcionar con teclados
// en español (ES/LatAm) igual que con US.

const DEADZONE = 0.18;

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
    try {
      const r = this.el.requestPointerLock?.({ unadjustedMovement: true });
      if (r && r.catch) r.catch(() => this.el.requestPointerLock?.());
    } catch {
      this.el.requestPointerLock?.();
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
      lookBehind: k('KeyC'),
      throttle: k('KeyW') || k('ArrowUp') ? 1 : 0,
      brake: k('KeyS') || k('ArrowDown') ? 1 : 0,
      steer: (k('KeyD') || k('ArrowRight') ? 1 : 0) - (k('KeyA') || k('ArrowLeft') ? 1 : 0),
      phone: h('KeyT'),
      help: h('F1'),
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
        // L3 correr/pito, R3 cámara, cruceta ↑ interactuar, View mapa, Menu pausa.
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
        a.weaponCycle += (bh(5) ? 1 : 0) - (bh(4) ? 1 : 0);
        a.weaponWheel ||= b(4) && b(5);
        a.pause ||= bh(9);
        a.map ||= bh(8);
        a.camera ||= bh(11);
        a.throttle = Math.max(a.throttle, bv(7));
        a.brake = Math.max(a.brake, bv(6));
        a.steer += ax(0);
        a.horn ||= b(10);
      }
      this.padPrev = pad.buttons.map((x) => x.pressed);
    }

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
    if (this.virtual) {
      // Acciones de un solo frame en la entrada virtual.
      for (const key of ['reload', 'interact', 'enterVehicle', 'map', 'pause', 'camera', 'firePressed', 'phone', 'help']) delete this.virtual[key];
      if (this.virtual.weaponSlot) this.virtual.weaponSlot = 0;
      if (this.virtual.weaponCycle) this.virtual.weaponCycle = 0;
      if (this.virtual.lookX) this.virtual.lookX = 0;
      if (this.virtual.lookY) this.virtual.lookY = 0;
    }
  }
}
