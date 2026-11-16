// Los que van adentro de los carros (el conductor del tráfico, el taxista,
// los dos agentes de la patrulla, la dama de compañía de copiloto) se pueden
// herir: Combat._scene les pone la cabina y sus cajas a cada carro
// (sim/carOccupants.js: la bala que entra por los vidrios le puede dar al de
// adentro; la que pega en la lata le pega al carro). Si el conductor muere o
// queda grave se desploma sobre el timón (render/slumpPose.js) y el carro
// pierde el control: sigue rodando, se desvía y frena solo o choca, a veces
// con la bocina pegada. Después se puede sacar el cuerpo y robar el carro
// como siempre. En la patrulla: si cae el conductor, el compañero se baja
// cuando el carro para; si caen los dos, la unidad queda eliminada (la regla
// de la 3.6: no se repone).

import { cabinaDe, occupantHitbox, patrolOutcome, startLoose } from '../sim/carOccupants.js';
import { exitPoint } from '../sim/vehiclePhysics.js';
import { dist2D, rightX, rightZ } from '../sim/math.js';
import { PED } from '../sim/pedAI.js';
import { slump, unslump } from '../render/slumpPose.js';

// ------------------------------------------------ ajustables
export const OCUPANTES = {
  health: { civil: 100, police: 120 }, // vida del que va adentro (la misma que a pie)
  graveFrac: 0.4, // con la vida en esta fracción o menos queda grave: se desploma (vivo)
  wakeTime: 6, // s con el carro quieto hasta que el herido grave se baja (el civil huye, el policía pelea)
  downTime: 4, // s en el piso del herido que sacan del carro, antes de pararse
  blastShield: 0.6, // fracción del daño de una explosión que les llega adentro (la lata los cubre un poco)
  glassDamage: 0.35, // fracción del daño de la bala que recibe el carro cuando rompe un vidrio sin pegarle a nadie
  hornDist: 70, // m: más lejos no se oye la bocina pegada
  bodyOffset: 0.7, // m al lado de la puerta donde queda el cuerpo que sacan
};

/** Entrada reciclada de la caja de un ocupante (sim/carOccupants.js occupantHitbox). */
const newBox = () => ({ ref: null, x: 0, y: 0, z: 0, y0: 0, y1: 0, r: 0, hx: 0, hy: 0, hz: 0, hr: 0 });

export class Occupants {
  constructor(world) {
    this.world = world;
    this.game = world.game;
    // Carros con alguien caído adentro (sin control, bocina pegada o un herido que se va a bajar).
    this.loose = [];
  }

  // ------------------------------------------------ quién va adentro
  /** Rig del puesto k (0 conductor, 1 copiloto) del carro v, o null. */
  _rigOf(v, k) {
    if (k === 0) return v.driver === 'player' ? null : v.driverRig;
    if (v.passengerRig) return v.passengerRig;
    const d = this.game.companions?.date;
    return d && d.vehicle === v && d.seated && !d.out && !d.blink ? d.ped.rig : null;
  }

  /** Registro del puesto k (uno por puesto y vehículo; se repone con cada ocupante nuevo), o null si va vacío. */
  seat(v, k) {
    const rig = this._rigOf(v, k);
    if (!rig) return null;
    const occ = (v.occ ??= [null, null]);
    const h = (occ[k] ??= { occupant: true, seat: k, vehicle: v, rig: null, look: null, health: 0, max: 0, dead: false, grave: false, police: false, dama: false, faction: 'civil', downT: 0, x: 0, z: 0, alive: true });
    if (h.rig !== rig) {
      h.rig = rig;
      h.dama = k === 1 && !v.passengerRig;
      h.police = !h.dama && (!!v.policeUnit || v.kind === 'police');
      h.faction = h.police ? 'police' : 'civil';
      h.max = h.health = h.police ? OCUPANTES.health.police : OCUPANTES.health.civil;
      h.look = k === 0 ? v.driverLook : v.passengerLook;
      h.dead = h.grave = false;
      h.alive = true;
      h.downT = 0;
    }
    return h;
  }

  /** ¿El puesto k lleva un cuerpo (muerto o herido grave) que hay que conservar? */
  holds(v, k) {
    const h = v.occ?.[k];
    return !!h && (h.dead || h.grave) && h.rig === (k === 0 ? v.driverRig : v.passengerRig) && !!h.rig;
  }

  // ------------------------------------------------ blancos
  /**
   * Prepara la entrada `e` de la escena del tiro (Combat._scene) del carro v:
   * su cabina y las cajas de los que van adentro y siguen vivos.
   */
  fill(v, e) {
    e.cab = v._cab ??= cabinaDe(v.state.variant, v.state.spec);
    const occ = (e.occ ??= []);
    let n = 0;
    if (!v.state.destroyed && !v.exploded) {
      for (let k = 0; k < 2; k++) {
        const h = this.seat(v, k);
        if (!h || h.dead) continue;
        const c = (occ[n] ??= newBox());
        occupantHitbox(v.state, v.view.seat, k === 0 ? 1 : -1, h.grave ? 1 : 0, c);
        c.ref = h;
        n++;
      }
    }
    e.nOcc = n;
  }

  /**
   * Los del carro del jugador para los tiros de los NPC (Combat.npcAttack
   * saca ese carro de la escena y le dispara directo al jugador): la dama de
   * copiloto entra como blanco suelto (cabeza y torso, como un montado).
   */
  pushSeated(v, list) {
    const h = this.seat(v, 1);
    if (!h || h.dead) return;
    const c = (this._seated ??= { ...newBox(), rider: true, dead: false });
    occupantHitbox(v.state, v.view.seat, -1, h.grave ? 1 : 0, c);
    c.ref = h;
    list.push(c);
  }

  /**
   * Explosión: los de adentro de los carros cerca reciben parte del golpe
   * (Combat.explode). Los del carro que explota (`source`, ya destroyed) no
   * se salvan: si no, el herido grave quedaba vivo para siempre en la lata.
   */
  blast(pos, R, dmg, attacker, source = null) {
    const hits = (this._blastList ??= []);
    hits.length = 0;
    for (const v of this.world.vehicles) {
      if (v.type === 'moto' || (v.state.destroyed && v !== source)) continue;
      if (Math.abs(v.state.x - pos.x) > R || Math.abs(v.state.z - pos.z) > R) continue;
      const d = v === source ? -1 : Math.hypot(v.state.x - pos.x, v.state.z - pos.z);
      if (d >= R) continue;
      for (let k = 0; k < 2; k++) {
        const h = this.seat(v, k);
        if (h && !h.dead) hits.push(h, d);
      }
    }
    for (let i = 0; i < hits.length; i += 2) {
      const h = hits[i];
      const d = hits[i + 1];
      this.hit(h, d < 0 ? 1e4 : dmg * OCUPANTES.blastShield * (1 - d / R), attacker, pos, false, 'blast');
    }
  }

  // ------------------------------------------------ daño
  /** Dónde va (para los avisos y el diálogo: h.x, h.z). */
  _place(h) {
    const s = h.vehicle.state;
    h.x = s.x;
    h.z = s.z;
  }

  /**
   * Tiro (o explosión) al que va adentro: daño y delitos como a un peatón
   * (Combat.damagePed). Herido leve: el civil que maneja acelera asustado;
   * grave o muerto: se desploma (y si maneja, el carro queda sin control).
   */
  hit(h, dmg, attacker, from, headshot = false, how = 'gun') {
    const g = this.game;
    const v = h.vehicle;
    if (h.dead || this._rigOf(v, h.seat) !== h.rig) return;
    if (h.dama) {
      g.companions?.hitInCar?.(dmg, attacker, from, headshot, how);
      return;
    }
    h.health -= dmg;
    v.lastHitBy = attacker;
    this._place(h);
    if (h.health <= 0) {
      h.health = 0;
      h.alive = false;
      if (attacker === 'player') {
        if (h.police) g.wanted.report('copKill', g.player);
        else g.wanted.report(g.wanted.level >= 2 ? 'murderRepeat' : 'murder', g.player);
        g.stats.kills++;
        if (headshot) g.hud.toast('¡Tiro a la cabeza!', 1.2);
      }
      if (from) this.world.addThreat(h.x, h.z, 30);
      g.events?.emit('pedKilled', { ped: h, attacker, how });
      this._down(h, true);
      return;
    }
    if (attacker === 'player') {
      if (h.police) g.wanted.report('copAssault', g.player);
      else if (how !== 'impact') g.wanted.report('assault', g.player);
    }
    if (h.health <= h.max * OCUPANTES.graveFrac) {
      if (!h.grave) this._down(h, false);
    } else if (!h.police && h.seat === 0 && v.driver === 'npc') v.panic = 15;
  }

  /** Se desploma en el puesto: muerto o grave. Si es el conductor, el carro queda sin control. */
  _down(h, dead) {
    const w = this.world;
    const v = h.vehicle;
    h.dead = dead;
    h.grave = !dead;
    h.downT = 0;
    slump(h.rig, h.seat === 0 ? 1 : -1);
    if (h.seat === 0 && v.driver === 'npc') {
      const s = v.state;
      v.loose = startLoose(w.rng.next, s.steer ?? 0);
      v.hornT = v.loose.horn;
      v.driver = null;
      v.agent = null;
      v.nav = null;
      v.chasing = false;
      v.panic = 0;
      if (v.kind === 'traffic') v.kind = 'parked';
    }
    if (!this.loose.includes(v)) this.loose.push(v);
    // Patrulla: el caído sale de la tripulación (no se baja ni vuelve a montarse).
    const u = v.policeUnit;
    if (u && h.police && w.policeUnits.includes(u)) {
      const i = u.crew?.indexOf(h.look) ?? -1;
      if (i >= 0) u.crew.splice(i, 1);
      const out = patrolOutcome([this.holds(v, 0) || !v.driverRig, this.holds(v, 1) || !v.passengerRig]);
      if (out === 'eliminada') {
        w._eliminate(u);
        v.siren = false;
      }
    }
  }

  /**
   * La patrulla con el conductor caído (World.updatePolice, en persecución):
   * rueda sin control; cuando para, se baja el que queda. true si la manejó.
   * Si la unidad ya se iba (sin estrellas), el que queda no sale a pelear:
   * se baja, vuelve a la patrulla y se la lleva (World._recall).
   */
  policeStep(u) {
    const v = u.vehicle;
    if (!v.loose || u.state !== 'pursuit') return false;
    v.chasing = false;
    v.nav = null;
    if (v.loose.stopped) {
      const w = this.world;
      if (!u.crew?.length) w._eliminate(u);
      else if (u.leaving || !(this.game.wanted?.level > 0)) {
        w._deploy(u, 'search');
        w._recall(u);
      } else w._deploy(u, 'contact');
    }
    return true;
  }

  // ------------------------------------------------ sacar a los de adentro
  /**
   * Saca a los que quedaron caídos en el carro (antes de robarlo, o cuando
   * la patrulla vuelve a rodar): los muertos quedan en el piso al lado de su
   * puerta; el herido grave, tirado un rato y después se para. `all`: también
   * el copiloto vivo de la patrulla (el jugador se roba el carro con él adentro).
   */
  evacuate(v, all = false) {
    for (let k = 0; k < 2; k++) {
      const down = this.holds(v, k);
      if (!down && !(all && k === 1 && v.passengerRig)) continue;
      const h = this.seat(v, k);
      if (!h) continue;
      this._spill(v, h, down ? (h.dead ? 'dead' : 'down') : 'attack');
    }
    v.loose = null;
    v.hornT = 0;
  }

  /** El ocupante h sale del carro por su puerta como peatón ('dead', 'down', 'flee' o 'attack'). */
  _spill(v, h, how) {
    const w = this.world;
    const s = v.state;
    const off = s.spec.width / 2 + OCUPANTES.bodyOffset;
    const side = h.seat === 0 ? 1 : -1; // el conductor por la izquierda
    const r = w.city.collision.resolveCircle(s.x - rightX(s.heading) * off * side, s.z - rightZ(s.heading) * off * side, PED.radius);
    const look = h.look ?? undefined;
    unslump(h.rig);
    v.view.doorPulse?.(side > 0 ? -1 : 1); // (la puerta de ese lado abre y cierra)
    if (h.seat === 0) {
      v.clearDriverRig();
      if (v.driver === 'npc') v.driver = null;
    } else v.clearPassengerRig();
    h.rig = null;
    const opts = h.police
      ? { outfit: 'police', faction: 'police', weapon: 'pistol', health: Math.max(1, h.health), look, sim: { hostile: true } }
      : { outfit: 'civil', health: Math.max(1, h.health), look };
    const p = w.spawnPedAt(r.x, r.z, opts);
    if (how === 'dead') {
      p.health = 0;
      p.sim.health = 0;
      p.sim.mode = 'dead';
      p.sim.speed = 0;
      // Botín como a cualquier muerto (al sacarlo).
      if (v.lastHitBy === 'player' && h.faction) this.game.pickups?.drop(p.x, p.z, h.faction);
    } else if (how === 'down') {
      p.downT = OCUPANTES.downTime;
      w.riders.falling.push({ p, vx: 0, vz: 0, vy: 0, y: p.y, air: false }); // (riders.update cuenta el tiempo en el piso)
      p.sim.mode = h.police ? 'attack' : 'flee';
      p.sim.fleeFrom = { x: s.x, z: s.z };
      p.sim.timer = 12;
    } else if (how === 'flee') {
      p.sim.mode = 'flee';
      p.sim.fleeFrom = { x: s.x, z: s.z };
      p.sim.timer = 12;
    } else p.sim.mode = 'attack';
    p.sim.yaw = s.heading + (side * Math.PI) / 2;
    return p;
  }

  // ------------------------------------------------ cada cuadro
  /** Bocina pegada, y el herido grave que se baja cuando el carro paró. */
  update(dt) {
    const w = this.world;
    const g = this.game;
    const list = this.loose;
    const cam = g.camera?.position;
    let horn = null;
    let hornD = OCUPANTES.hornDist;
    for (let i = list.length - 1; i >= 0; i--) {
      const v = list[i];
      if (!w.vehicles.includes(v) || v.driver === 'player' || v.exploded) {
        v.loose = null;
        v.hornT = 0;
        list.splice(i, 1);
        continue;
      }
      if (v.hornT > 0) {
        v.hornT -= dt;
        const d = cam ? dist2D(v.state.x, v.state.z, cam.x, cam.z) : 0;
        if (d < hornD) {
          hornD = d;
          horn = v;
        }
      }
      let pending = false;
      const stopped = !v.loose || v.loose.stopped;
      for (let k = 0; k < 2; k++) {
        if (!this.holds(v, k)) continue;
        const h = v.occ[k];
        if (!h.grave) continue;
        pending = true;
        if (!stopped) continue;
        h.downT += dt;
        if (h.downT > OCUPANTES.wakeTime) this._spill(v, h, h.police ? 'attack' : 'flee');
      }
      if (stopped && !(v.hornT > 0) && !pending) list.splice(i, 1);
    }
    g.audio?.bocinaPegada?.(horn ? horn.state : null);
  }

  clear() {
    this.loose.length = 0;
    this.game.audio?.bocinaPegada?.(null);
  }
}
