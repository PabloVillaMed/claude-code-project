// Los que van en moto (el del tráfico, el domiciliario, el policía y su
// parrillero) se pueden herir: blancos para Combat._scene (cabeza y torso
// donde van sentados, sim/riders.js) y qué pasa cuando les pegan. Si mueren o
// quedan heridos de gravedad se caen de la moto: pasan a ser un peatón con su
// misma pinta (muerto, o herido en el piso hasta que se para) que sale con el
// impulso de la moto y se arrastra un poco; la moto sin piloto pierde el
// control, se ladea y cae (sim/vehiclePhysics.js MOTO_FALL). Si tumban al
// conductor de una moto de la Policía, el parrillero cae con ella, se para y
// sigue a pie; si tumban al parrillero, el conductor sigue.

import { riderHitbox } from '../sim/riders.js';
import { startMotoFall } from '../sim/vehiclePhysics.js';
import { groundHeight } from '../sim/terrain.js';
import { rightX, rightZ, yawFromDir } from '../sim/math.js';
import { PED } from '../sim/pedAI.js';

// ------------------------------------------------ ajustables
export const RIDER_FALL = {
  health: { civil: 100, police: 120 }, // vida del que va montado (la misma que a pie)
  graveFrac: 0.5, // con la vida en esta fracción o menos se cae de la moto (herido de gravedad)
  downTime: 4.5, // s en el piso antes de pararse, si quedó herido
  pillionDownTime: 1.3, // s que tarda en pararse el parrillero que cae porque tumbaron al conductor
  carry: 0.85, // fracción de la velocidad de la moto con la que sale el cuerpo
  sideSpeed: 1.4, // m/s hacia el lado (el contrario al que cae la moto: no quedan encaramados)
  hop: 0.8, // m/s hacia arriba al soltarse
  sideOffset: 0.45, // m al lado del asiento donde arranca la caída
  seatedPelvis: 0.81, // m de la pelvis sobre la raíz del esqueleto sentado (para arrancar donde iba)
  friction: 8.5, // m/s² con que se frena el cuerpo arrastrándose por el piso
  meleeReach: 0.5, // m de más (sobre el alcance del arma) para golpear al que va montado parado al lado
  meleeCone: 0.3, // coseno mínimo entre el frente del que pega y el blanco
};

const GRAVITY = 9.8;

/** Entrada reciclada de la escena del tiro (Combat._scene) con lo de un montado. */
export function newTarget() {
  return { ref: null, x: 0, y: 0, z: 0, dead: false, rider: false, y0: 0, y1: 0, r: 0, hx: 0, hy: 0, hz: 0, hr: 0 };
}

export class Riders {
  constructor(world) {
    this.world = world;
    this.game = world.game;
    // Cuerpos que caen o se arrastran, y heridos en el piso (pocos a la vez).
    this.falling = [];
    this._hb = newTarget();
  }

  // ------------------------------------------------ blancos
  /** El que maneja la moto `v` (un objeto por vehículo; la vida se repone con cada piloto nuevo). */
  _driverHit(v) {
    const h = (v.riderHit ??= { rider: 'driver', vehicle: v, unit: null, rig: null, health: 0, max: 0 });
    if (h.rig !== v.driverRig) {
      h.rig = v.driverRig;
      h.max = h.health = v.kind === 'police' ? RIDER_FALL.health.police : RIDER_FALL.health.civil;
    }
    return h;
  }

  _pillionHit(v, u) {
    const pl = u.pillion;
    return (pl.hit ??= { rider: 'pillion', vehicle: v, unit: u, rig: pl.rig, health: RIDER_FALL.health.police, max: RIDER_FALL.health.police });
  }

  /** ¿Sigue montado? (otro tiro del mismo cuadro ya lo pudo tumbar). */
  _mounted(h) {
    if (h.rider === 'driver') return h.vehicle.driver === 'npc' && h.rig === h.vehicle.driverRig && !!h.rig;
    return h.unit?.pillion?.hit === h;
  }

  /** Pelvis del puesto en el marco local de la moto: [y, z]. */
  _seat(v, h) {
    const ride = h.rider === 'pillion' ? h.unit.pillion?.group.userData.ride : v.view.group.userData.ride;
    const out = (this._seatOut ??= [0, 0]);
    out[0] = ride?.seatY ?? (v.view.seat?.y ?? 0.3) + 0.65;
    out[1] = ride?.seatZ ?? v.view.seat?.z ?? 0;
    return out;
  }

  /**
   * Agrega a `list` (los personajes de Combat._scene, con entradas recicladas
   * de `pool`) a los que van montados en la moto `v`.
   */
  targets(v, list, pool) {
    if (v.state.destroyed) return;
    if (v.driver === 'npc' && v.driverRig) this._push(v, this._driverHit(v), list, pool);
    const u = v.policeUnit;
    if (u?.pillion) this._push(v, this._pillionHit(v, u), list, pool);
  }

  _push(v, h, list, pool) {
    const c = (pool[list.length] ??= newTarget());
    const seat = this._seat(v, h);
    riderHitbox(v.state, seat[0], seat[1], c);
    c.ref = h;
    c.rider = true;
    c.dead = false;
    list.push(c);
  }

  /** El montado más cercano al frente de quien pega (puño o machete), si está a la mano. */
  meleeTarget(ax, az, fx, fz, range) {
    let best = null;
    let bd = range + RIDER_FALL.meleeReach;
    const hb = this._hb;
    const check = (v, h) => {
      const seat = this._seat(v, h);
      riderHitbox(v.state, seat[0], seat[1], hb);
      const dx = hb.x - ax;
      const dz = hb.z - az;
      const d = Math.hypot(dx, dz);
      if (d < bd && (dx * fx + dz * fz) / (d || 1) > RIDER_FALL.meleeCone) {
        bd = d;
        best = h;
      }
    };
    for (const v of this.world.vehicles) {
      if (v.type !== 'moto' || v.state.destroyed || Math.abs(v.state.x - ax) > 4 || Math.abs(v.state.z - az) > 4) continue;
      if (v.driver === 'npc' && v.driverRig) check(v, this._driverHit(v));
      if (v.policeUnit?.pillion) check(v, this._pillionHit(v, v.policeUnit));
    }
    return best ? { h: best, d: bd } : null;
  }

  /** Explosión: los que van en moto cerca reciben el golpe como a pie (Combat.explode). */
  blast(pos, R, dmg, attacker) {
    const hits = (this._blastList ??= []);
    hits.length = 0;
    for (const v of this.world.vehicles) {
      if (v.type !== 'moto' || v.state.destroyed) continue;
      const d = Math.hypot(v.state.x - pos.x, v.state.z - pos.z);
      if (d >= R) continue;
      if (v.driver === 'npc' && v.driverRig) hits.push(this._driverHit(v), d);
      if (v.policeUnit?.pillion) hits.push(this._pillionHit(v, v.policeUnit), d);
    }
    for (let i = 0; i < hits.length; i += 2) this.hit(hits[i], dmg * (1 - hits[i + 1] / R), attacker, pos);
  }

  // ------------------------------------------------ daño
  /**
   * Tiro (o golpe) al que va montado: daño y delitos como a un peatón
   * (Combat.damagePed). Herido leve sigue montado (el del tráfico acelera
   * asustado); muerto o grave, se cae de la moto.
   */
  hit(h, dmg, attacker, from, headshot = false, how = 'gun') {
    const g = this.game;
    if (!this._mounted(h)) return;
    const before = h.health;
    h.health -= dmg;
    const police = h.rider === 'pillion' || h.vehicle.kind === 'police';
    if (h.health > h.max * RIDER_FALL.graveFrac) {
      if (attacker === 'player') {
        if (police) g.wanted.report('copAssault', g.player);
        else {
          if (how !== 'impact') g.wanted.report('assault', g.player);
          h.vehicle.panic = 15;
        }
      }
      return;
    }
    const ped = this.knockOff(h, before);
    if (!ped) return;
    g.combat.damagePed(ped, dmg, attacker, from, headshot, how);
    if (ped.alive) ped.downT = Math.max(ped.downT ?? 0, RIDER_FALL.downTime);
  }

  /**
   * Se cae de la moto: devuelve el peatón (con `health` de vida, todavía sin
   * el daño del golpe: lo pone Combat.damagePed).
   */
  knockOff(h, health) {
    const w = this.world;
    const v = h.vehicle;
    const s = v.state;
    // La moto cae hacia donde va ladeada; el cuerpo, al otro lado.
    const motoSide = s.fallen || (s.lean < 0 ? -1 : 1);
    const bodySide = -motoSide;
    if (h.rider === 'pillion') {
      const u = h.unit;
      const pl = u.pillion;
      const [py, pz] = this._seat(v, h);
      w._clearPillion(u);
      const k = u.crew?.indexOf(pl.look) ?? -1;
      if (k >= 0) u.crew.splice(k, 1);
      return this._fall(v, pl.look, true, null, py, pz, bodySide, health);
    }
    const u = v.policeUnit && w.policeUnits.includes(v.policeUnit) ? v.policeUnit : null;
    const police = !!u || v.kind === 'police';
    const look = v.driverLook;
    const [py, pz] = this._seat(v, h);
    v.clearDriverRig();
    v.driver = null;
    v.agent = null;
    v.nav = null;
    v.chasing = false;
    v.kind = 'parked';
    startMotoFall(s, motoSide);
    const team = u && !u.leaving ? u : null;
    const ped = this._fall(v, look, police, team, py, pz, bodySide, health);
    if (u) {
      // Moto de la Policía: el parrillero cae con ella, se para y sigue a pie.
      const pl = u.pillion;
      u.crew = [];
      let mate = null;
      if (pl) {
        const [qy, qz] = this._seat(v, this._pillionHit(v, u));
        const hp = pl.hit?.health ?? RIDER_FALL.health.police;
        w._clearPillion(u);
        mate = this._fall(v, pl.look, true, team, qy, qz, bodySide, hp, 0.35);
        mate.downT = RIDER_FALL.pillionDownTime;
        mate.sim.mode = 'attack';
      }
      if (team) {
        // La unidad pasa a estar a pie (sim: 'deployed'): si mueren todos, cae
        // la unidad; si vuelve alguien a la moto, la levanta y sigue.
        u.officers = u.officers.filter((o) => w.peds.includes(o));
        u.officers.push(ped);
        if (mate) u.officers.push(mate);
        u.state = 'deployed';
        u.deployReason = 'contact';
        u.deployT = 0;
        u.pendingDeploy = null;
      } else w._eliminate(u); // (ya se iba: sale del caso)
    }
    return ped;
  }

  /**
   * Peatón que cae de la moto desde su puesto (pelvis local py, pz), hacia
   * `side` (+1 izquierda, -1 derecha), con el impulso de la moto. `back`:
   * m más atrás (el parrillero cae detrás del conductor).
   */
  _fall(v, look, police, unit, py, pz, side, health, back = 0) {
    const w = this.world;
    const s = v.state;
    const c = Math.cos(s.heading);
    const sn = Math.sin(s.heading);
    const lx = -rightX(s.heading) * side;
    const lz = -rightZ(s.heading) * side;
    const off = RIDER_FALL.sideOffset;
    const r = w.city.collision.resolveCircle(s.x + (pz + back) * sn + lx * off, s.z + (pz + back) * c + lz * off, PED.radius);
    const opts = police
      ? { outfit: 'police', faction: 'police', weapon: 'pistol', health, look, police: unit, sim: { hostile: true } }
      : { outfit: 'civil', health, look };
    const p = w.spawnPedAt(r.x, r.z, opts);
    // De espaldas hacia el lado de la caída (el muerto cae de espaldas: rig deadBlend).
    p.sim.yaw = yawFromDir(-lx, -lz);
    p.sim.speed = 0;
    // Arranca sentado, como iba en la moto, y de ahí se va al piso.
    const rig = p.rig;
    rig.seatKind = 'moto';
    rig.driveBlend = 1;
    if (rig.hasClip?.('sit') && rig.w) rig.w.sit = 1;
    const y = s.y + py - RIDER_FALL.seatedPelvis;
    p.sim.elev = y;
    p.y = y;
    rig.root.position.set(r.x, y, r.z);
    rig.root.rotation.set(0, p.sim.yaw, 0);
    const k = RIDER_FALL.carry;
    this.falling.push({ p, vx: s.vx * k + lx * RIDER_FALL.sideSpeed, vz: s.vz * k + lz * RIDER_FALL.sideSpeed, vy: RIDER_FALL.hop, y, air: true });
    return p;
  }

  // ------------------------------------------------ cada cuadro
  /** Caída y arrastre de los cuerpos; los heridos se paran al rato. */
  update(dt) {
    const w = this.world;
    const list = this.falling;
    for (let i = list.length - 1; i >= 0; i--) {
      const f = list[i];
      const p = f.p;
      const s = p.sim;
      if (!w.peds.includes(p)) {
        list.splice(i, 1);
        continue;
      }
      if (f.air) {
        f.vy -= GRAVITY * dt;
        f.y += f.vy * dt;
        const gy = groundHeight(s.x, s.z);
        if (f.y <= gy) {
          f.air = false;
          s.elev = undefined;
        } else s.elev = f.y;
      }
      const sp = Math.hypot(f.vx, f.vz);
      if (sp > 0.02) {
        if (!f.air) {
          const k = Math.max(0, sp - RIDER_FALL.friction * dt) / sp;
          f.vx *= k;
          f.vz *= k;
        }
        const r = w.city.collision.resolveCircle(s.x + f.vx * dt, s.z + f.vz * dt, PED.radius);
        if (r.hit) {
          // Contra una pared: se queda ahí.
          f.vx *= 0.3;
          f.vz *= 0.3;
        }
        s.x = r.x;
        s.z = r.z;
      }
      if (p.downT > 0) {
        p.downT -= dt;
        if (p.downT <= 0 || !p.alive) p.downT = 0;
      }
      if (!f.air && sp <= 0.02 && !(p.downT > 0)) list.splice(i, 1);
    }
  }

  clear() {
    this.falling.length = 0;
  }
}
