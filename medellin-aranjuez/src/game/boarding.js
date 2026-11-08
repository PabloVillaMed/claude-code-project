// Subir y bajar de un vehículo con animación: ejecuta un plan de
// sim/boarding.js sobre el rig del personaje. La raíz del personaje cuelga
// del grupo del vehículo (se mueve con él si lo empujan) y en cada cuadro
// toma la pose del plan; los eventos del plan disparan los gestos del rig
// (abrir la puerta, sentarse, levantarse) y aplican su desplazamiento de
// cadera. Si el jugador acelera, frena, gira o camina, se adelanta (x3).
// La cámara hace la transición con cameraBlend (ver cameraRig: ctx.board).

import { carEntryPlan, carExitPlan, motoEntryPlan, motoExitPlan, poseAt, fireEvents } from '../sim/boarding.js';

/** s en que el gesto ya recorrido (con su desplazamiento de cadera aplicado) se desvanece en la base. */
export const BOARD_COMMIT_FADE = 0.4;
/** s del desvanecimiento del gesto si la subida / bajada se corta a la mitad. */
export const BOARD_CANCEL_FADE = 0.15;
/**
 * s en que, ya de pie tras bajarse, la raíz dibujada alcanza la lógica (el
 * punto de bajada lo corrige la colisión unos cm): sin salto al soltar el plan.
 */
export const BOARD_SETTLE = 0.3;
/** m: más lejos que esto (teletransporte, reaparición), no se suaviza. */
export const BOARD_SETTLE_MAX = 1.2;

// Nombre del plan -> clip del rig.
const CLIP = { door: 'door', sit: 'sit_down', sitL: 'sit_down_l', stand: 'stand_up' };

export class Boarding {
  /**
   * `mode`: 'enter' | 'exit'. `from` (solo al subir): {x, z, yaw} del personaje
   * en el marco del vehículo. Devuelve null en `create` si el rig no tiene los
   * clips (muñeco procedural): entonces se sube / baja de una. `passenger`
   * (solo carro): de copiloto, con `seat` (el puesto, en el marco del
   * vehículo) y `side` (la puerta): las manos quedan sueltas, sin timón.
   */
  static create(rig, vehicle, mode, opts = {}) {
    const moto = vehicle.type === 'moto';
    const spec = vehicle.state.spec;
    const car = { width: spec.width, length: spec.length, seat: opts.seat ?? vehicle.view.seat };
    let plan = null;
    if (moto) plan = mode === 'enter' ? motoEntryPlan(car, opts.from, { hurry: opts.hurry }) : motoExitPlan(car, opts.side ?? -1);
    else {
      const info = (n) => rig.clipInfo?.(CLIP[n]) ?? null;
      const clips = { door: info('door'), sit: info('sit'), sitL: info('sitL'), stand: info('stand') };
      if (mode === 'enter' && clips.sit?.end && clips.sitL?.end) plan = carEntryPlan(car, opts.from, clips, { hurry: opts.hurry, side: opts.side });
      else if (mode === 'exit' && clips.stand?.end) plan = carExitPlan(car, clips, opts.side ?? -1);
    }
    if (!plan || !rig.hasClip?.('idle')) return null;
    return new Boarding(rig, vehicle, plan, mode, !moto && !!opts.passenger);
  }

  constructor(rig, vehicle, plan, mode, passenger = false) {
    this.rig = rig;
    this.vehicle = vehicle;
    this.plan = plan;
    this.mode = mode;
    this.passenger = passenger;
    this.t = 0;
    this.next = 0;
    this.rate = 1;
    this.driving = null;
    this.handsFree = false;
    this.mount = false;
    this.mountSide = -1;
    this.mountPlant = null; // x (marco del vehículo) del pie de apoyo al montarse / bajarse
    this.done = false;
    this.order = rig.root.rotation.order;
    rig.setWeapon?.(null);
    vehicle.view.group.add(rig.root);
    // Yaw primero y luego el contragiro de la pendiente del vehículo (_place).
    rig.root.rotation.order = 'ZXY';
    this._fire();
    this._place(poseAt(plan, 0));
  }

  /** Pose final de la raíz en el marco del vehículo. */
  get final() {
    return this.plan.final;
  }

  /** Avanza el plan y anima el rig. `skip`: el jugador tiene afán. Devuelve true al terminar. */
  update(dt, skip = false) {
    if (this.done) return true;
    if (skip) this.rate = 3;
    const step = dt * this.rate;
    this.t = Math.min(this.plan.total, this.t + step);
    this._fire();
    const p = poseAt(this.plan, this.t);
    this._place(p);
    this.rig.animate(step, {
      speed: p.walk ? p.speed : 0,
      onGround: true,
      driving: this.driving,
      handsFree: this.handsFree,
      // Peso de la postura sentada que lleva el plan (sin saltos al sentarse o levantarse).
      seatW: p.seat,
      mountLift: this.mount ? (p.lift ?? 0) : 0,
      mountSide: this.mount ? this.mountSide : undefined,
      mountPlant: this.mountPlant,
    });
    // El vehículo se inclina un poco con el peso del que se monta o se sienta.
    this.vehicle.view.boardTilt = p.tilt ?? 0;
    if (this.t >= this.plan.total) this.done = true;
    return this.done;
  }

  /**
   * Transición de la cámara: w (0 a pie … 1 en el vehículo, suavizado), dónde
   * va el personaje animado (en planta la cadera; la altura, la del piso bajo la
   * raíz: la cámara lo sigue mientras camina a la puerta o se baja) y el
   * vehículo. `out` se reutiliza.
   */
  cameraBlend(out = {}) {
    const k = this.plan.total > 0 ? Math.min(1, this.t / this.plan.total) : 1;
    const e = k * k * k * (k * (k * 6 - 15) + 10); // arranca y termina sin saltos
    const s = this.vehicle.state;
    const r = this.rig.root.position;
    // Punto del piso bajo la raíz (y local 0) en el mundo, con la matriz del
    // grupo del vehículo (en pendiente queda a la altura del andén).
    const m = this.vehicle.view.group.matrixWorld.elements;
    out.enter = this.mode === 'enter';
    out.w = out.enter ? e : 1 - e;
    out.x = m[0] * r.x + m[8] * r.z + m[12];
    out.y = m[1] * r.x + m[9] * r.z + m[13];
    out.z = m[2] * r.x + m[10] * r.z + m[14];
    // En planta, la cadera dibujada (la raíz salta al aplicar el desplazamiento
    // de cadera de un gesto; el cuerpo no).
    // (Solo la cadena de padres de la pelvis: unos pocos nodos.)
    const pb = this.rig.bones?.Bip01_Pelvis;
    if (pb) {
      pb.updateWorldMatrix(true, false);
      out.x = pb.matrixWorld.elements[12];
      out.z = pb.matrixWorld.elements[14];
    }
    out.vx = s.x;
    out.vy = s.y;
    out.vz = s.z;
    out.heading = s.heading;
    out.size = s.spec.length;
    out.moto = this.vehicle.type === 'moto';
    return out;
  }

  /** Corta el plan (teletransporte, muerte, choque): el gesto en curso se va. */
  cancel() {
    // Terminado normalmente, el gesto ya se está desvaneciendo (commit): no se apura.
    if (this.t < this.plan.total) this.rig.stopGesture?.(BOARD_CANCEL_FADE);
    this.done = true;
    this.vehicle.view.boardTilt = 0;
    this.rig.root.rotation.order = this.order;
  }

  _fire() {
    this.next = fireEvents(this.plan, this.next, this.t, (e) => {
      if (e.type === 'play') this.rig.play(CLIP[e.clip], { speed: e.speed, fadeIn: e.fadeIn ?? 0.2, hold: !!e.hold, instant: !!e.instant, mask: 'full' });
      else if (e.type === 'commit') this.rig.commitRootMotion(BOARD_COMMIT_FADE);
      else if (e.type === 'seat') {
        this.driving = e.driving ?? null;
        this.handsFree = !!e.handsFree || this.passenger;
        this.mount = !!e.mount;
        if (e.side) this.mountSide = e.side;
        if (e.plant != null) this.mountPlant = e.plant;
      }
    });
  }

  _place(p) {
    this.rig.root.position.set(p.x, p.y, p.z);
    // De pie, derecho aunque el vehículo esté en una pendiente (o se hunda con
    // el peso): contragiro del cabeceo y el alabeo del grupo; sentado, con el
    // vehículo. Pasa de uno a otro con el peso de la postura sentada.
    const u = 1 - (p.seat ?? (this.driving ? 1 : 0));
    const g = this.vehicle.view.group.rotation;
    this.rig.root.rotation.set(-g.x * u, p.yaw, -g.z * u);
  }
}
