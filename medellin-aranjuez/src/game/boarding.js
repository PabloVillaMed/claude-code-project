// Subir y bajar de un vehículo con animación: ejecuta un plan de
// sim/boarding.js sobre el rig del personaje. La raíz del personaje cuelga
// del grupo del vehículo (se mueve con él si lo empujan) y en cada cuadro
// toma la pose del plan; los eventos del plan disparan los gestos del rig
// (abrir la puerta, sentarse, levantarse) y aplican su desplazamiento de
// cadera. Si el jugador acelera, frena, gira o camina, se adelanta (x3).

import { carEntryPlan, carExitPlan, motoEntryPlan, motoExitPlan, poseAt, fireEvents } from '../sim/boarding.js';

// Nombre del plan -> clip del rig.
const CLIP = { door: 'door', sit: 'sit_down', sitL: 'sit_down_l', stand: 'stand_up' };

export class Boarding {
  /**
   * `mode`: 'enter' | 'exit'. `from` (solo al subir): {x, z, yaw} del personaje
   * en el marco del vehículo. Devuelve null en `create` si el rig no tiene los
   * clips (muñeco procedural): entonces se sube / baja de una.
   */
  static create(rig, vehicle, mode, opts = {}) {
    const moto = vehicle.type === 'moto';
    const spec = vehicle.state.spec;
    const car = { width: spec.width, length: spec.length, seat: vehicle.view.seat };
    let plan = null;
    if (moto) plan = mode === 'enter' ? motoEntryPlan(car, opts.from) : motoExitPlan(car, opts.side ?? -1);
    else {
      const info = (n) => rig.clipInfo?.(CLIP[n]) ?? null;
      const clips = { door: info('door'), sit: info('sit'), sitL: info('sitL'), stand: info('stand') };
      if (mode === 'enter' && clips.sit?.end && clips.sitL?.end) plan = carEntryPlan(car, opts.from, clips, { hurry: opts.hurry });
      else if (mode === 'exit' && clips.stand?.end) plan = carExitPlan(car, clips, opts.side ?? -1);
    }
    if (!plan || !rig.hasClip?.('idle')) return null;
    return new Boarding(rig, vehicle, plan, mode);
  }

  constructor(rig, vehicle, plan, mode) {
    this.rig = rig;
    this.vehicle = vehicle;
    this.plan = plan;
    this.mode = mode;
    this.t = 0;
    this.next = 0;
    this.rate = 1;
    this.driving = null;
    this.handsFree = false;
    this.mount = false;
    this.done = false;
    rig.setWeapon?.(null);
    vehicle.view.group.add(rig.root);
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
      mountLift: this.mount ? p.k : 0,
    });
    if (this.t >= this.plan.total) this.done = true;
    return this.done;
  }

  /** Corta el plan (teletransporte, muerte, choque): el gesto en curso se va. */
  cancel() {
    this.done = true;
    this.rig.stopGesture?.(0.1);
  }

  _fire() {
    this.next = fireEvents(this.plan, this.next, this.t, (e) => {
      if (e.type === 'play') this.rig.play(CLIP[e.clip], { speed: e.speed, fadeIn: e.fadeIn ?? 0.2, hold: !!e.hold, instant: !!e.instant, mask: 'full' });
      else if (e.type === 'commit') this.rig.commitRootMotion(0.25);
      else if (e.type === 'seat') {
        this.driving = e.driving ?? null;
        this.handsFree = !!e.handsFree;
        this.mount = !!e.mount;
      }
    });
  }

  _place(p) {
    this.rig.root.position.set(p.x, p.y, p.z);
    this.rig.root.rotation.set(0, p.yaw, 0);
  }
}
