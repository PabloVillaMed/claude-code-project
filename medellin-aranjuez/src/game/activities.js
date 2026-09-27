// Vida cotidiana del barrio: gente haciendo cosas cerca del jugador. La
// señora que cuelga la ropa en el balcón, el vecino que fuma o habla por
// celular recostado a la fachada, la que barre el andén, el dominó frente a
// la tienda, el que lava la moto y el picadito en la cancha o en la calle.
//
// Los lugares salen de sim/activities.js (deterministas); aquí se ponen en
// escena solo los más cercanos, dentro de un presupuesto de personas por
// calidad, y se retiran al alejarse. Cada persona es un PedEntity normal de
// world.js (`sim.fixed`, `ped.act` = la actividad): recibe balas, se asusta
// con los disparos y huye como cualquiera; si uno huye, el grupo se
// deshace. La pose por código va en render/activityPoses.js y la utilería
// (compartida) en render/activityProps.js.

import * as THREE from 'three';
import { ACTIVITY_COST, BALL, MATCH, activitySpots, createMatch, nudgeBall, pickNearSpots, stepMatch } from '../sim/activities.js';
import { FIDGETS } from '../sim/animSelect.js';
import { groundHeight, onRoad } from '../sim/terrain.js';
import { clamp, dampAngle, dist2D, forwardX, forwardZ, rightX, rightZ, yawFromDir } from '../sim/math.js';
import { makeRng } from '../sim/rng.js';
import { randomLook } from '../render/characterRig.js';
import { ballMesh, broomMesh, bucketMesh, buildClothesline, buildDominoTable, ragMesh, smallGoal, stoneGoal } from '../render/activityProps.js';
import { chestPoint, handsMid, poseHang, poseHoldBall, poseKeeper, poseKick, poseReach, poseRub, poseSweep } from '../render/activityPoses.js';

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();

/** Aspecto con el género pedido (null = cualquiera). */
function lookFor(rng, female, outfit = 'civil') {
  let look = randomLook(rng, outfit);
  for (let i = 0; i < 12 && female != null && !!look.female !== female; i++) look = randomLook(rng, outfit);
  return look;
}

// Los partidos van aparte (máximo por calidad): no le quitan cupo al resto.
const costOf = (s) => (s.kind === 'futbol' ? 0 : ACTIVITY_COST[s.kind] ?? 1);

export class Activities {
  constructor(world) {
    this.world = world;
    this.game = world.game;
    this.scene = world.scene;
    this.rng = makeRng(4242);
    this.spots = null;
    this.active = new Map(); // lugar -> actividad en escena
    this.timer = 0;
    this.clock = 0;
    this.enabled = true;
    // Motos parqueadas en el mismo orden que city.parkedVehicles.
    this.parked = world.vehicles.filter((v) => v.persistent);
  }

  _init() {
    const w = this.world;
    const col = w.city.collision;
    const isFree = (x, z) => !onRoad(x, z) && !col.pointBlocked(x, z) && !!w.blockAt(x, z);
    this.spots = activitySpots(w.city, { isFree, edges: w.graph.activeEdges });
  }

  /** Presupuesto de personas y de partidos a la vez según la calidad. */
  budget() {
    const q = this.world.quality;
    const peds = q.peds ?? 34;
    return { people: Math.round(peds * 0.4), matches: peds >= 40 ? 2 : 1, matchPlayers: peds >= 40 ? 10 : peds >= 30 ? 8 : 6, radius: Math.min(80, (q.pedDraw ?? 80) * 0.85) };
  }

  update(dt, player) {
    if (!this.enabled) return;
    if (!this.spots) this._init();
    this.clock += dt;
    this.timer -= dt;
    if (this.timer <= 0) {
      this.timer = 0.5;
      this._manage(player.x, player.z);
    }
    // Personajes nuevos de a poco (clonar un esqueleto cuesta): dos por cuadro.
    let n = 2;
    for (const a of this.active.values()) {
      while (n > 0 && a.queue.length) {
        a.queue.shift()();
        n--;
      }
    }
    for (const a of this.active.values()) a.update(Math.min(dt, 0.05), player);
  }

  _manage(px, pz) {
    const { people, matches, radius } = this.budget();
    for (const [spot, a] of this.active) {
      const d = dist2D(spot.x, spot.z, px, pz);
      if (d > radius * 1.25 || (a.ended && (d > 30 || a.t - a.endT > 40))) {
        a.dispose();
        this.active.delete(spot);
        // Si se deshizo (sustos), no vuelve enseguida.
        if (a.ended) spot.until = this.clock + 45;
      }
    }
    const picks = pickNearSpots(this.spots, px, pz, radius, people, { active: new Set(this.active.keys()), maxMatches: matches, costOf });
    for (const s of picks) {
      if ((s.until ?? 0) > this.clock) continue;
      const d = dist2D(s.x, s.z, px, pz);
      // Que no aparezcan en la cara del jugador (el balcón queda arriba: da igual).
      if (d < (s.kind === 'futbol' ? 18 : 10) && s.kind !== 'ropa') continue;
      const A = KINDS[s.kind];
      if (!A) continue;
      const a = new A(this, s);
      if (a.ended) {
        a.dispose();
        continue;
      }
      this.active.set(s, a);
    }
  }

  /** Resumen para pruebas y depuración. */
  summary() {
    const count = {};
    for (const s of this.spots ?? []) count[s.kind] = (count[s.kind] ?? 0) + 1;
    return {
      spots: count,
      active: [...this.active.values()].map((a) => ({ kind: a.spot.kind, x: a.spot.x, z: a.spot.z, y: a.spot.y ?? null, peds: a.peds.filter((p) => p.act === a).length, ended: a.ended, info: a.info?.() ?? null })),
    };
  }

  /** Lugar más cercano de un tipo (pruebas): {x, z, ...}. */
  nearest(kind, x, z, filter = () => true) {
    if (!this.spots) this._init();
    let best = null;
    let bd = Infinity;
    for (const s of this.spots) {
      if (s.kind !== kind || !filter(s)) continue;
      const d = dist2D(s.x, s.z, x, z);
      if (d < bd) {
        bd = d;
        best = s;
      }
    }
    return best;
  }

  dispose() {
    for (const a of this.active.values()) a.dispose();
    this.active.clear();
  }
}

// ------------------------------------------------------------------ base
class Activity {
  constructor(mgr, spot) {
    this.mgr = mgr;
    this.world = mgr.world;
    this.spot = spot;
    this.peds = [];
    this.objs = [];
    this.queue = [];
    this.ended = false;
    this.t = 0;
    this.endT = 0;
    this.rng = mgr.rng;
  }

  /** Objeto de utilería en la escena (se quita al terminar). */
  add(obj) {
    this.mgr.scene.add(obj);
    this.objs.push(obj);
    return obj;
  }

  /** Persona de la actividad (quieta para la simulación de peatones). */
  spawn(x, z, yaw, { female = null, outfit = 'civil', sit = false, elev = null, scale = 1 } = {}) {
    const look = lookFor(this.rng, female, outfit);
    if (scale !== 1) look.scale = scale;
    const ped = this.world.spawnPedAt(x, z, { outfit: 'civil', look });
    const s = ped.sim;
    s.fixed = true;
    s.sitting = sit;
    s.mode = 'idle';
    s.yaw = yaw;
    s.speed = 0;
    if (elev != null) s.elev = elev;
    ped.act = this;
    ped.rig.post = (rig, dt) => {
      if (ped.act === this) this.pose(ped, rig, dt);
    };
    this.peds.push(ped);
    return ped;
  }

  mine(p) {
    return p.act === this && this.world.peds.includes(p);
  }

  /** ¿Sigue armada? Si alguien huyó, murió o lo borraron, el grupo se deshace. */
  check() {
    if (this.ended) return false;
    const gone = this.peds.find((p) => !this.world.peds.includes(p) || !p.alive || !p.sim.fixed || p.act !== this);
    if (gone) {
      this.breakUp(gone.sim.fleeFrom ?? { x: gone.x, z: gone.z });
      return false;
    }
    return true;
  }

  breakUp(from = null) {
    if (this.ended) return;
    this.ended = true;
    this.endT = this.t;
    for (const p of this.peds) this.release(p, from);
    this.onEnd?.();
  }

  /** Suelta a la persona: vuelve a ser un peatón normal (asustado si hubo por qué). */
  release(p, from) {
    if (p.act !== this) return;
    p.act = null;
    p.rig.post = null;
    p.rig.forceProp = null;
    this.onRelease?.(p);
    if (!this.world.peds.includes(p) || !p.alive) return;
    const s = p.sim;
    if (s.elev != null) {
      // En un balcón no hay para dónde correr: se entra a la casa.
      this.world.removePed(p);
      return;
    }
    if (s.fixed) {
      s.fixed = false;
      s.sitting = false;
      if (from) {
        s.mode = 'flee';
        s.fleeFrom = { x: from.x, z: from.z };
        s.timer = 6 + this.rng.next() * 4;
      } else s.mode = 'walk';
    }
  }

  update(dt, player) {
    this.t += dt;
    if (!this.ended && this.check()) this.step(dt, player);
    else if (this.ended) this.stepEnded?.(dt, player);
  }

  step() {}

  /** Ajusta lo que el rig anima (world.js lo llama antes de rig.animate). */
  dress() {}

  pose() {}

  /** Susto (disparo, explosión): true si la actividad lo maneja por su cuenta. */
  threat() {
    return false;
  }

  dispose() {
    for (const p of this.peds) {
      if (p.act !== this) continue;
      p.act = null;
      p.rig.post = null;
      p.rig.forceProp = null;
      this.onRelease?.(p);
      if (this.world.peds.includes(p)) this.world.removePed(p);
    }
    for (const o of this.objs) {
      o.removeFromParent();
      o.traverse?.((m) => m.isInstancedMesh && m.dispose());
    }
    this.objs.length = 0;
  }
}

// ------------------------------------------------------------------ ropa
/**
 * Colgar la ropa en el balcón: va al platón, se agacha, saca una prenda,
 * camina hasta el siguiente espacio libre de la cuerda y la cuelga con los
 * brazos arriba. Con la cuerda llena se queda mirando la calle.
 */
class Ropa extends Activity {
  constructor(mgr, s) {
    super(mgr, s);
    this.floor = s.y;
    const lineY = s.y + 1.66;
    this.a = new THREE.Vector3(s.line.ax, lineY, s.line.az);
    this.b = new THREE.Vector3(s.line.bx, lineY, s.line.bz);
    this.dir = { x: s.dir.x, z: s.dir.z };
    // El platón en una punta del balcón (arrimado a la pared); ella se para
    // al lado para sacar la ropa y camina hasta la otra punta.
    const fx = -forwardX(s.yaw) * 0.12;
    const fz = -forwardZ(s.yaw) * 0.12;
    const basket = new THREE.Vector3(s.walk.x + fx, this.floor, s.walk.z + fz);
    this.p0 = { x: s.walk.x + this.dir.x * 0.5, z: s.walk.z + this.dir.z * 0.5 };
    this.p1 = { x: s.walk.x1, z: s.walk.z1 };
    this.basket = basket;
    this.line = buildClothesline(this.a, this.b, this.floor, basket, s.building % 7);
    this.add(this.line.group);
    this.add(this.line.hand);
    // Parte de la ropa ya está colgada.
    this.hung = Math.floor(((s.building * 2654435761) >>> 0) % 1000 / 1000 * Math.max(1, this.line.slots - 2));
    this.line.setHung(this.hung);
    this.ped = this.spawn(this.p0.x + this.dir.x * 0.4, this.p0.z + this.dir.z * 0.4, s.yaw, { female: true, elev: this.floor });
    this.phase = 'toBasket';
    this.pt = 0;
    this.h = { bend: 0, arms: 0, l: new THREE.Vector3(), r: new THREE.Vector3() };
    this.holding = false;
    this.inside = -1;
  }

  info() {
    return { phase: this.phase, hung: this.hung, slots: this.line.slots };
  }

  /** Punto de la baranda (sobre el camino) frente al espacio i de la cuerda. */
  _standAt(i) {
    const q = this.line.slotWorld(i, _v);
    // Proyección sobre el camino p0 -> p1.
    const dx = this.p1.x - this.p0.x;
    const dz = this.p1.z - this.p0.z;
    const L2 = dx * dx + dz * dz || 1;
    const t = clamp(((q.x - this.p0.x) * dx + (q.z - this.p0.z) * dz) / L2, 0, 1);
    return { x: this.p0.x + dx * t, z: this.p0.z + dz * t };
  }

  _walkTo(dt, x, z) {
    const s = this.ped.sim;
    const dx = x - s.x;
    const dz = z - s.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.05) {
      s.speed = 0;
      return true;
    }
    const sp = Math.min(0.85, d * 3);
    s.yaw = dampAngle(s.yaw, yawFromDir(dx, dz), 9, dt);
    s.x += (dx / d) * Math.min(d, sp * dt);
    s.z += (dz / d) * Math.min(d, sp * dt);
    s.speed = sp;
    return false;
  }

  _face(dt, yaw) {
    const s = this.ped.sim;
    s.yaw = dampAngle(s.yaw, yaw, 7, dt);
    return Math.abs(Math.atan2(Math.sin(yaw - s.yaw), Math.cos(yaw - s.yaw))) < 0.15;
  }

  step(dt) {
    const s = this.ped.sim;
    if (!this.ped.rig) return;
    this.pt += dt;
    const h = this.h;
    const full = this.hung >= this.line.slots;
    // Se entra a la casa (susto): da media vuelta, camina hasta la puerta y desaparece.
    if (this.inside >= 0) {
      this.inside += dt;
      h.arms = Math.max(0, h.arms - dt * 3);
      h.bend = Math.max(0, h.bend - dt * 3);
      this.holding = false;
      this._face(dt, this.spot.yaw + Math.PI);
      if (this.inside > 0.4) {
        s.x -= forwardX(this.spot.yaw) * 0.9 * dt;
        s.z -= forwardZ(this.spot.yaw) * 0.9 * dt;
        s.speed = 0.9;
      }
      if (this.inside > 1.3) {
        this.world.removePed(this.ped);
        this.breakUp(null);
      }
      return;
    }
    switch (this.phase) {
      case 'toBasket':
        h.arms = Math.max(0, h.arms - dt * 2.5);
        if (full) {
          this.phase = 'rest';
          this.pt = 0;
        } else if (this._walkTo(dt, this.p0.x, this.p0.z)) {
          this.phase = 'pick';
          this.pt = 0;
        }
        break;
      case 'pick': {
        s.speed = 0;
        // Mira al platón, se agacha, saca la prenda y se endereza.
        const ready = this._face(dt, yawFromDir(this.basket.x - s.x, this.basket.z - s.z));
        const k = this.pt;
        h.bend = k < 1.1 ? Math.min(1, k / 0.9) : Math.max(0, 1 - (k - 1.3) / 0.7);
        h.arms = k < 1.1 ? Math.min(1, k / 0.7) : Math.max(0.35, 1 - (k - 1.3) / 0.6);
        h.l.set(this.basket.x - this.dir.z * 0.1, this.floor + 0.3, this.basket.z + this.dir.x * 0.1);
        h.r.set(this.basket.x + this.dir.z * 0.1, this.floor + 0.3, this.basket.z - this.dir.x * 0.1);
        if (k > 1.2) this.holding = true;
        if (k > 2.1 && ready) {
          this.phase = 'toSlot';
          this.pt = 0;
        }
        break;
      }
      case 'toSlot': {
        h.bend = Math.max(0, h.bend - dt * 3);
        h.arms = Math.max(0, h.arms - dt * 2);
        const p = this._standAt(this.hung);
        if (this._walkTo(dt, p.x, p.z)) {
          this.phase = 'hang';
          this.pt = 0;
        }
        break;
      }
      case 'hang': {
        s.speed = 0;
        const ready = this._face(dt, this.spot.yaw);
        const k = this.pt;
        const slot = this.line.slotWorld(this.hung, _w);
        // Brazos arriba hasta la cuerda, acomodar la prenda (un meneíto) y bajar.
        h.arms = k < 0.7 ? k / 0.7 : k < 2.4 ? 1 : Math.max(0, 1 - (k - 2.4) / 0.5);
        const wig = k > 0.8 && k < 2.2 ? Math.sin(k * 9) * 0.03 : 0;
        h.l.set(slot.x - this.dir.x * 0.2, slot.y + 0.02 + wig, slot.z - this.dir.z * 0.2);
        h.r.set(slot.x + this.dir.x * 0.2, slot.y + 0.02 - wig, slot.z + this.dir.z * 0.2);
        if (k > 2.2 && this.holding) {
          this.holding = false;
          this.hung++;
          this.line.setHung(this.hung);
        }
        if (k > 2.9 && ready) {
          this.phase = 'toBasket';
          this.pt = 0;
        }
        break;
      }
      default:
        // Cuerda llena: mira la calle, de vez en cuando cambia de sitio.
        s.speed = 0;
        h.arms = Math.max(0, h.arms - dt * 2);
        this._face(dt, this.spot.yaw);
    }
  }

  dress(p, st) {
    st.fidget = this.phase === 'rest';
    // Brazos por código: sin gestos de relleno encima.
    if (this.h.arms > 0.05) st.upper = null;
  }

  pose(p, rig) {
    poseHang(rig, this.h);
    const hand = this.line.hand;
    hand.visible = this.holding && !!rig.bones?.Bip01_L_Hand;
    if (hand.visible) {
      handsMid(rig, hand.position);
      hand.position.y += 0.02;
      hand.rotation.set(0, this.ped.sim.yaw, 0);
      hand.material.color.setHex(this.line.colorOf(this.hung));
    }
  }

  threat(p) {
    if (this.inside < 0) this.inside = 0;
    return true;
  }
}

// ------------------------------------------------------------------ recostado a la pared
/** Fumando o hablando por celular recostado a la fachada, junto a la puerta. */
class Pared extends Activity {
  constructor(mgr, s) {
    super(mgr, s);
    const smoker = s.kind === 'fumar';
    this.smoker = smoker;
    this.ped = this.spawn(s.x, s.z, s.yaw, { female: smoker ? this.rng.chance(0.25) : null });
    if (smoker) this.ped.rig.forceProp = 'cig';
    this.nextDrag = 2 + this.rng.next() * 5;
    this.drag = -1;
    this.wisp = 0;
  }

  info() {
    return { smoker: this.smoker, drag: this.drag };
  }

  step(dt) {
    const p = this.ped;
    if (!this.smoker) return;
    const fx = this.mgr.game.effects;
    this.nextDrag -= dt;
    if (this.nextDrag <= 0 && !p.rig.gesture) {
      // Chupada: la mano a la boca (clip de beber) y luego el humo.
      p.rig.play('drink', { mask: 'upper', fadeIn: 0.45, fadeOut: 0.5, to: 2.9 });
      this.drag = 0;
      this.nextDrag = 7 + this.rng.next() * 7;
    }
    const cam = this.mgr.game.camera.position;
    const near = dist2D(cam.x, cam.z, p.x, p.z) < 30 && p.rig.root.visible;
    if (this.drag >= 0) {
      this.drag += dt;
      // Exhala: varias bocanadas desde la boca, hacia adelante y arriba.
      if (this.drag > 2.3 && this.drag < 3.4 && near && Math.random() < dt * 12) {
        const head = p.rig.bones?.Bip01_Head;
        if (head) {
          head.getWorldPosition(_v);
          _v.x += forwardX(p.sim.yaw) * 0.14;
          _v.z += forwardZ(p.sim.yaw) * 0.14;
          _v.y -= 0.02;
          fx?.puff(_v, 0.16, [0.82, 0.82, 0.84], 0.28, 0.35, 1.8);
        }
      }
      if (this.drag > 3.5) this.drag = -1;
    }
    // Hilito de humo de la punta.
    this.wisp -= dt;
    const cig = p.rig.props?.cig;
    if (cig?.visible && near) {
      const ember = cig.userData.ember;
      // De noche la brasa se ve más.
      ember.scale.setScalar(this.mgr.game.env?.night ? 1.6 : 1);
      if (this.wisp <= 0) {
        this.wisp = 0.45;
        ember.getWorldPosition(_v);
        fx?.puff(_v, 0.05, [0.78, 0.78, 0.8], 0.16, 0.3, 1.6);
      }
    }
  }

  dress(p, st) {
    st.bodyPitch = this.spot.lean ? 0.085 : 0;
    st.fidget = false;
    if (!st.upper) st.upper = this.smoker ? 'smoke_idle' : 'phone';
  }
}

// ------------------------------------------------------------------ barrer
/** Barriendo el andén frente a la casa: va y viene, la escoba de lado a lado. */
class Barrer extends Activity {
  constructor(mgr, s) {
    super(mgr, s);
    this.ped = this.spawn(s.x, s.z, s.yaw, { female: this.rng.chance(0.7) });
    this.broom = broomMesh();
    this.ped.rig.root.add(this.broom);
    this.dirSign = 1;
    this.sw = this.rng.next() * 5;
    this.pauseT = 0;
    this.dust = 0;
  }

  onRelease(p) {
    this.broom?.removeFromParent();
  }

  step(dt) {
    const s = this.ped.sim;
    const w = this.spot.walk;
    // Avanza despacio barriendo; en las puntas da la vuelta.
    const tx = this.dirSign > 0 ? w.x1 : w.x;
    const tz = this.dirSign > 0 ? w.z1 : w.z;
    const dx = tx - s.x;
    const dz = tz - s.z;
    const d = Math.hypot(dx, dz);
    this.pauseT -= dt;
    if (d < 0.15) {
      this.dirSign = -this.dirSign;
      this.pauseT = 1.2;
    }
    const want = yawFromDir(dx, dz);
    s.yaw = dampAngle(s.yaw, want, 3, dt);
    const aligned = Math.abs(Math.atan2(Math.sin(want - s.yaw), Math.cos(want - s.yaw))) < 0.3;
    const sp = this.pauseT > 0 || !aligned ? 0 : 0.28;
    if (d > 0.01 && sp > 0) {
      s.x += (dx / d) * sp * dt;
      s.z += (dz / d) * sp * dt;
    }
    s.speed = sp;
    this.sw += dt;
    // Polvito de vez en cuando.
    this.dust -= dt;
    if (this.dust <= 0 && this.ped.rig.root.visible) {
      this.dust = 0.9 + Math.random();
      this.broom.getWorldPosition(_v);
      this.mgr.game.effects?.puff(_v, 0.22, [0.55, 0.5, 0.42], 0.18, 0.25, 1.2);
    }
  }

  dress(p, st) {
    st.fidget = false;
    st.upper = null;
  }

  pose(p, rig) {
    poseSweep(rig, this.broom, this.sw);
  }
}

// ------------------------------------------------------------------ dominó
/** Dominó frente a la tienda: cuatro en la mesa y cada uno pone su ficha. */
class Domino extends Activity {
  constructor(mgr, s) {
    super(mgr, s);
    this.table = buildDominoTable(4);
    const g = this.table.group;
    const y = groundHeight(s.x, s.z);
    g.position.set(s.x, y, s.z);
    g.rotation.y = s.yaw;
    g.updateMatrixWorld(true);
    this.add(g);
    this.center = new THREE.Vector3(s.x, y + 0.75, s.z);
    const n = 3 + (((s.building * 97) >>> 0) % 2);
    this.tiles = ((s.building * 13) >>> 0) % 9;
    this.table.setTiles(this.tiles);
    this.turn = 0;
    this.nextPlay = 2 + this.rng.next() * 3;
    this.reachT = -1;
    this.roundEnd = -1;
    for (let i = 0; i < n; i++) {
      const seat = this.table.seatAt[i];
      const wp = g.localToWorld(new THREE.Vector3(seat.x, 0, seat.z));
      const yaw = seat.yaw + s.yaw;
      this.queue.push(() => {
        if (!this.ended) this.spawn(wp.x, wp.z, yaw, { sit: true, female: this.rng.chance(0.2) });
      });
    }
  }

  info() {
    return { tiles: this.tiles, players: this.peds.length };
  }

  step(dt) {
    if (!this.peds.length) return;
    this.nextPlay -= dt;
    if (this.roundEnd >= 0) {
      this.roundEnd += dt;
      if (this.roundEnd > 3.5) {
        this.roundEnd = -1;
        this.tiles = 0;
        this.table.setTiles(0);
      }
      return;
    }
    if (this.reachT >= 0) {
      this.reachT += dt;
      if (this.reachT > 0.75 && !this.placed) {
        this.placed = true;
        this.tiles++;
        this.table.setTiles(this.tiles);
      }
      if (this.reachT > 1.5) {
        this.reachT = -1;
        this.turn = (this.turn + 1) % this.peds.length;
        if (this.tiles >= 21) {
          // Se acabó la mano: el que ganó celebra, los demás se quejan.
          this.roundEnd = 0;
          this.peds.forEach((p, i) => p.rig.play(i === this.turn ? 'sit_table_shrug' : 'sit_table_think', { fadeIn: 0.3 }));
        }
      }
    } else if (this.nextPlay <= 0) {
      this.reachT = 0;
      this.placed = false;
      this.nextPlay = 3.5 + this.rng.next() * 4;
      this.peds[this.turn % this.peds.length]?.rig.stopGesture(0.2);
    }
  }

  dress(p, st) {
    st.seat = 'table';
    st.fidgets = FIDGETS.table;
    // Todos pendientes de la mesa (salvo que llegue alguien).
    if (!st.lookAt) st.lookAt = this.center;
  }

  pose(p, rig) {
    if (this.reachT < 0 || this.peds[this.turn % this.peds.length] !== p) return;
    const k = this.reachT;
    const w = k < 0.6 ? k / 0.6 : Math.max(0, 1 - (k - 0.9) / 0.6);
    // Punta de la culebra de fichas.
    _v.copy(this.center);
    _v.y += 0.02;
    poseReach(rig, _v, w);
  }
}

// ------------------------------------------------------------------ lavar la moto
/** Agachado junto a su moto parqueada, restregándola con un trapo; el balde al lado. */
class Lavar extends Activity {
  constructor(mgr, s) {
    super(mgr, s);
    this.veh = mgr.parked[s.vehicle];
    const v = this.veh;
    if (!v || v.driver || v.state.destroyed || mgr.world.vehicles.indexOf(v) < 0) {
      this.ended = true;
      return;
    }
    const st = v.state;
    this.at = { x: st.x, z: st.z };
    // El lado de la moto que da al andén.
    let side = 1;
    const px = (k) => st.x + rightX(st.heading) * 0.72 * k;
    const pz = (k) => st.z + rightZ(st.heading) * 0.72 * k;
    if (onRoad(px(1), pz(1)) && !onRoad(px(-1), pz(-1))) side = -1;
    const x = px(side);
    const z = pz(side);
    if (mgr.world.city.collision.pointBlocked(x, z)) {
      this.ended = true;
      return;
    }
    this.side = side;
    const yaw = yawFromDir(st.x - x, st.z - z);
    this.ped = this.spawn(x, z, yaw, { female: false });
    this.bucket = this.add(bucketMesh());
    const bx = x + forwardX(st.heading) * 0.55;
    const bz = z + forwardZ(st.heading) * 0.55;
    this.bucket.position.set(bx, groundHeight(bx, bz), bz);
    this.rag = ragMesh();
    this.rub = new THREE.Vector3();
    this.rt = this.rng.next() * 10;
    this.foam = 0;
  }

  onRelease() {
    this.rag?.removeFromParent();
  }

  step(dt) {
    const v = this.veh;
    const st = v.state;
    // Se llevaron la moto (o la quemaron): se acaba.
    if (v.driver || st.destroyed || Math.hypot(st.x - this.at.x, st.z - this.at.z) > 0.6) {
      this.breakUp({ x: st.x, z: st.z });
      return;
    }
    this.rt += dt;
    // Restriega a lo largo del tanque y el asiento, yendo y viniendo.
    const along = Math.sin(this.rt * 0.35) * 0.35;
    const gy = groundHeight(st.x, st.z);
    this.rub.set(st.x + forwardX(st.heading) * along + rightX(st.heading) * 0.2 * this.side, gy + 0.62, st.z + forwardZ(st.heading) * along + rightZ(st.heading) * 0.2 * this.side);
    this.foam -= dt;
    if (this.foam <= 0 && this.ped.rig.root.visible) {
      this.foam = 0.7 + Math.random() * 0.8;
      this.mgr.game.effects?.puff(this.rub, 0.12, [0.95, 0.96, 0.98], 0.35, 0.05, 1.2);
    }
  }

  dress(p, st) {
    st.crouching = true;
    st.fidget = false;
    if (!st.lookAt) st.lookAt = this.rub;
  }

  pose(p, rig) {
    poseRub(rig, this.rub, this.rt);
    const hand = rig.bones?.Bip01_R_Hand;
    if (hand && this.rag.parent !== hand) {
      hand.add(this.rag);
      this.rag.position.set(0.08, -0.03, 0);
    }
  }
}

// ------------------------------------------------------------------ fútbol
/**
 * El picadito: en la cancha (con arcos o arquitos) o en una calle tranquila
 * con piedras de arco. La simulación del partido es sim/activities.js; aquí
 * se pasa al mundo y se anima (patadas, arquero, celebración, balón).
 */
class Futbol extends Activity {
  constructor(mgr, s) {
    super(mgr, s);
    const f = s.frame;
    this.f = f;
    const n = Math.min(s.players, mgr.budget().matchPlayers);
    this.m = createMatch({ hu: f.hu, hv: f.hv, goalW: s.goalW, goalH: s.goalH ?? 1.2, goals: s.goals }, n, this.rng.next);
    this.ball = this.add(ballMesh(BALL.r));
    this.pedOf = new Array(n).fill(null);
    this.prev = new Array(n).fill('play');
    this.clear = 0;
    // Arcos: los de la cancha ya existen; si no, arquitos o piedras.
    if (s.goals !== 'porteria') {
      for (const sgn of [-1, 1]) {
        const o = this.add(s.goals === 'piedras' ? stoneGoal(s.goalW) : smallGoal(s.goalW, s.goalH));
        const p = this.toWorld(sgn * (f.hu + (s.goals === 'piedras' ? 0 : 0.05)), 0);
        o.position.set(p.x, groundHeight(p.x, p.z), p.z);
        // El arco mira hacia el centro del campo.
        o.rotation.y = Math.atan2(-sgn * f.ux, -sgn * f.uz);
      }
    }
    for (const pl of this.m.players) {
      this.queue.push(() => {
        if (this.ended) return;
        const w = this.toWorld(pl.u, pl.v);
        const young = this.rng.next();
        const ped = this.spawn(w.x, w.z, this.worldYaw(pl.yaw), { female: this.rng.chance(0.12), outfit: young < 0.35 ? 'gang' : 'civil', scale: young < 0.55 ? 0.86 + this.rng.next() * 0.1 : 1 });
        ped.player = pl;
        this.pedOf[pl.i] = ped;
      });
    }
    this.kickFx = 0;
  }

  info() {
    return { score: this.m.score, state: this.m.state, paused: this.m.paused, players: this.peds.length, ball: { u: this.m.ball.u, v: this.m.ball.v, y: this.m.ball.y } };
  }

  toWorld(u, v) {
    const f = this.f;
    return { x: f.x + f.ux * u + f.nx * v, z: f.z + f.uz * u + f.nz * v };
  }

  worldYaw(fy) {
    const du = -Math.sin(fy);
    const dv = -Math.cos(fy);
    const f = this.f;
    return yawFromDir(f.ux * du + f.nx * dv, f.uz * du + f.nz * dv);
  }

  toField(x, z) {
    const f = this.f;
    const dx = x - f.x;
    const dz = z - f.z;
    return { u: dx * f.ux + dz * f.uz, v: dx * f.nx + dz * f.nz };
  }

  /** En la calle: ¿viene un carro? (dentro del tramo o acercándose por él). */
  _carComing() {
    const f = this.f;
    for (const v of this.world.vehicles) {
      const s = v.state;
      if (Math.abs(s.x - f.x) > f.hu + 40 || Math.abs(s.z - f.z) > f.hu + 40) continue;
      const q = this.toField(s.x, s.z);
      if (Math.abs(q.v) > f.hv + 2 || Math.abs(q.u) > f.hu + 30) continue;
      const moving = Math.abs(s.forwardSpeed) > 0.8 || v.driver === 'player';
      if (!moving && Math.abs(q.u) > f.hu) continue;
      if (!moving) continue;
      return true;
    }
    return false;
  }

  step(dt, player) {
    const m = this.m;
    if (this.spot.street) {
      if (this._carComing()) {
        m.paused = true;
        this.clear = 0;
      } else if (m.paused) {
        this.clear += dt;
        if (this.clear > 2.5) m.paused = false;
      }
    }
    // El jugador también puede meterle el pie al balón.
    if (!player.inVehicle && !player.dead) {
      const q = this.toField(player.x, player.z);
      if (Math.abs(q.u) < this.f.hu + 2 && Math.abs(q.v) < this.f.hv + 2) {
        const sp = player.speed ?? 0;
        const vx = forwardX(player.yaw) * sp;
        const vz = forwardZ(player.yaw) * sp;
        nudgeBall(m.ball, q.u, q.v, vx * this.f.ux + vz * this.f.uz, vx * this.f.nx + vz * this.f.nz);
      }
    }
    const ev = stepMatch(m, dt, this.rng.next);
    for (const e of ev) {
      if (e.type === 'goal') {
        for (const pl of m.players) {
          const ped = this.pedOf[pl.i];
          if (!ped) continue;
          if (pl.team === e.team) ped.rig.play(pl.i === e.i || this.rng.chance(0.5) ? 'cheer' : 'clap', { mask: 'upper', fadeIn: 0.2 });
          else if (this.rng.chance(0.5)) ped.rig.play('shrug', { mask: 'upper', fadeIn: 0.3 });
        }
      }
    }
    // Pasar la simulación a los personajes.
    for (const pl of m.players) {
      const ped = this.pedOf[pl.i];
      if (!ped || ped.act !== this) continue;
      const w = this.toWorld(pl.u, pl.v);
      const s = ped.sim;
      s.x = w.x;
      s.z = w.z;
      s.yaw = this.worldYaw(pl.yaw);
      s.speed = pl.state === 'kick' ? 0 : pl.speed;
    }
    // Balón.
    const b = m.ball;
    const holder = b.holder >= 0 ? this.pedOf[b.holder] : null;
    if (holder?.rig.bones && holder.act === this) {
      chestPoint(holder.rig, this.ball.position);
    } else {
      const w = this.toWorld(b.u, b.v);
      this.ball.position.set(w.x, groundHeight(w.x, w.z) + b.y, w.z);
    }
    // Rueda: gira sobre el eje perpendicular al movimiento.
    const vx = this.f.ux * b.vu + this.f.nx * b.vv;
    const vz = this.f.uz * b.vu + this.f.nz * b.vv;
    const sp = Math.hypot(vx, vz);
    if (sp > 0.05 && b.holder < 0) {
      _v.set(vz / sp, 0, -vx / sp);
      this.ball.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(_v, (sp * dt) / BALL.r));
    }
  }

  /** Sin jugadores (huyeron) el balón sigue rodando hasta pararse. */
  stepEnded(dt) {
    const b = this.m.ball;
    b.holder = -1;
    stepMatch({ ...this.m, players: [], paused: false, state: 'over' }, dt);
    const w = this.toWorld(b.u, b.v);
    this.ball.position.set(w.x, groundHeight(w.x, w.z) + b.y, w.z);
  }

  dress(p, st) {
    const pl = p.player;
    if (!pl) return;
    st.fidget = false;
    st.speed = pl.state === 'kick' ? 0 : pl.speed;
    if (!st.lookAt) st.lookAt = this.ball.position;
  }

  pose(p, rig) {
    const pl = p.player;
    if (!pl) return;
    if (pl.state === 'kick' && pl.kick) poseKick(rig, pl.t / MATCH.kickTime, clamp(pl.kick.power / 14, 0.2, 1));
    else if (pl.state === 'hold') poseHoldBall(rig, chestPoint(rig, _w), 1, BALL.r);
    else if (pl.keeper && pl.speed < 1.5 && this.m.state === 'play' && !this.m.paused) {
      const d = Math.hypot(this.m.ball.u - pl.u, this.m.ball.v - pl.v);
      poseKeeper(rig, clamp(1.3 - d / 20, 0.25, 1));
    }
  }
}

const KINDS = { ropa: Ropa, fumar: Pared, celular: Pared, barrer: Barrer, domino: Domino, lavar: Lavar, futbol: Futbol };
