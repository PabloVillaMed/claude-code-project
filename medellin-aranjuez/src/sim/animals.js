// Animales de la calle (puro, sin three.js): perros criollos que pasean, se
// sientan o se echan en el andén y le ladran al que pasa; gatos quietos junto
// a las paredes que salen corriendo si uno se arrima; y, de noche, ratas
// entre las bolsas de basura. Solo existen cerca del jugador, con un cupo por
// calidad: unas pocas decenas en total. render/animals.js los dibuja en tres
// mallas instanciadas (una por especie) y anima patas y cola en el sombreador.

import { makeRng } from './rng.js';

export const ANIMAL_KINDS = ['perro', 'gato', 'rata'];

/** Cuántos de cada uno alrededor del jugador, según la calidad (peds como medida). */
export function animalBudget(peds = 30) {
  if (peds >= 50) return { perro: 9, gato: 6, rata: 10 };
  if (peds >= 40) return { perro: 7, gato: 5, rata: 8 };
  if (peds >= 30) return { perro: 5, gato: 4, rata: 6 };
  return { perro: 3, gato: 2, rata: 4 };
}

/** Las ratas salen de noche (y un poco al anochecer y antes de amanecer). */
export function ratHours(hour) {
  return hour >= 19 || hour < 5.5;
}

/** Por especie: velocidades (m/s), distancia a la que huyen del jugador a pie y cuánto descansan. */
export const SPECIES = {
  perro: { walk: 1.1, flee: 4.8, shy: 1.6, rest: [0.45, 0.25], restTime: [6, 30], gait: 5.5 },
  gato: { walk: 0.65, flee: 4.4, shy: 3.4, rest: [0.75, 0], restTime: [10, 35], gait: 6.5 },
  rata: { walk: 2.1, flee: 3.8, shy: 6, rest: [0, 0], restTime: [0.6, 2.5], gait: 14 },
};
const SPAWN_MIN = 22;
const SPAWN_MAX = 75;
const DESPAWN = 100;
const CELL = 40;

/** Puntos del andén (cada ~10 m del anillo de cada manzana): por donde caminan perros y gatos. */
export function sidewalkPoints(city, step = 10) {
  const out = [];
  for (const b of city.blocks) {
    if (b.type !== 'residencial' || !b.ring) continue;
    const r = b.ring;
    for (let i = 0; i < r.length; i++) {
      const [ax, az] = r[i];
      const [bx, bz] = r[(i + 1) % r.length];
      const n = Math.max(1, Math.floor(Math.hypot(bx - ax, bz - az) / step));
      for (let k = 0; k < n; k++) out.push({ x: ax + ((bx - ax) * k) / n, z: az + ((bz - az) * k) / n });
    }
  }
  return out;
}

/** Índice en grilla para pedir puntos cerca de un lugar sin recorrer los miles. */
class PointGrid {
  constructor(points) {
    this.cells = new Map();
    for (const p of points) {
      const k = this.key(Math.floor(p.x / CELL), Math.floor(p.z / CELL));
      let c = this.cells.get(k);
      if (!c) this.cells.set(k, (c = []));
      c.push(p);
    }
  }

  key(i, j) {
    return i * 100003 + j;
  }

  near(x, z, r) {
    const out = [];
    const i0 = Math.floor((x - r) / CELL);
    const i1 = Math.floor((x + r) / CELL);
    const j0 = Math.floor((z - r) / CELL);
    const j1 = Math.floor((z + r) / CELL);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) for (const p of this.cells.get(this.key(i, j)) ?? []) if (Math.abs(p.x - x) <= r && Math.abs(p.z - z) <= r) out.push(p);
    return out;
  }
}

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

/**
 * Simulación de los animales. `sidewalk` y `trash`: puntos {x, z} donde
 * aparecen (andén para perros y gatos; bolsas de basura para las ratas).
 * update(dt, {focus, player, hour, vehicles, budget}); `list` son los
 * animales vivos y `events` lo que suena en el cuadro ({kind: 'ladrido' |
 * 'maullido' | 'chillido', x, z}).
 */
export class AnimalSim {
  constructor({ sidewalk = [], trash = [], groundHeight = () => 0, blocked = () => false, seed = 77 } = {}) {
    this.rng = makeRng(seed);
    this.walkGrid = new PointGrid(sidewalk);
    this.trashGrid = new PointGrid(trash);
    this.groundHeight = groundHeight;
    this.blocked = blocked;
    this.list = [];
    this.events = [];
    this.threats = [];
    this.spawnT = 0;
    this.nextId = 1;
  }

  /** Un tiro o una explosión: todos los de cerca salen corriendo. */
  alarm(x, z, radius = 35) {
    this.threats.push({ x, z, radius, t: 0.5 });
  }

  update(dt, ctx) {
    const { focus, player = null, hour = 12, vehicles = [], budget = animalBudget() } = ctx;
    this.events.length = 0;
    for (let i = this.threats.length - 1; i >= 0; i--) if ((this.threats[i].t -= dt) <= 0) this.threats.splice(i, 1);
    this.spawnT -= dt;
    if (this.spawnT <= 0) {
      this.spawnT = 0.5;
      this._population(focus, hour, budget);
    }
    for (const a of this.list) this._step(a, dt, player, vehicles, hour);
  }

  _population(focus, hour, budget) {
    const night = ratHours(hour);
    // Lejos (o ratas de día, si ya no se ven): se van.
    this.list = this.list.filter((a) => {
      const d = Math.hypot(a.x - focus.x, a.z - focus.z);
      return d < DESPAWN && !(a.kind === 'rata' && !night && d > 25);
    });
    for (const kind of ANIMAL_KINDS) {
      const want = kind === 'rata' && !night ? 0 : budget[kind] ?? 0;
      let have = 0;
      for (const a of this.list) if (a.kind === kind) have++;
      if (have < want) this._spawn(kind, focus);
    }
  }

  _spawn(kind, focus) {
    const grid = kind === 'rata' ? this.trashGrid : this.walkGrid;
    const cands = grid.near(focus.x, focus.z, SPAWN_MAX).filter((p) => {
      const d = Math.hypot(p.x - focus.x, p.z - focus.z);
      return d > SPAWN_MIN && d < SPAWN_MAX;
    });
    if (!cands.length) return null;
    const r = this.rng;
    const p = cands[Math.floor(r.next() * cands.length) % cands.length];
    const x = p.x + (kind === 'rata' ? r.range(-1, 1) : 0);
    const z = p.z + (kind === 'rata' ? r.range(-1, 1) : 0);
    if (this.blocked(x, z)) return null;
    const sp = SPECIES[kind];
    const a = {
      id: this.nextId++,
      kind,
      x,
      z,
      y: this.groundHeight(x, z),
      yaw: r.next() * Math.PI * 2,
      speed: 0,
      mode: 'rest',
      timer: r.range(1, 6),
      pose: 0, // 0 de pie, 1 sentado, 2 echado (lo que se ve; se acerca a `rest` de a poco)
      rest: 0,
      phase: r.next() * 6.283,
      target: null,
      scale: kind === 'perro' ? r.range(0.85, 1.15) : kind === 'gato' ? r.range(0.9, 1.05) : r.range(0.85, 1.1),
      color: Math.floor(r.next() * 8),
      callT: r.range(2, 8),
    };
    // Perros y gatos arrancan echados o sentados a veces.
    const k = r.next();
    if (k < sp.rest[0]) a.rest = 1;
    else if (k < sp.rest[0] + sp.rest[1]) a.rest = 2;
    a.pose = a.rest;
    this.list.push(a);
    return a;
  }

  _step(a, dt, player, vehicles, hour) {
    const sp = SPECIES[a.kind];
    const r = this.rng;
    // ¿Algo lo asusta? Un tiro cerca, un carro rápido o el jugador encima.
    let scare = null;
    for (const t of this.threats) if (Math.hypot(t.x - a.x, t.z - a.z) < t.radius) scare = t;
    for (const v of vehicles) if (v.speed > 3 && Math.abs(v.x - a.x) < 5 && Math.abs(v.z - a.z) < 5 && Math.hypot(v.x - a.x, v.z - a.z) < 4.5) scare = v;
    const pd = player && !player.dead ? Math.hypot(player.x - a.x, player.z - a.z) : Infinity;
    if (!scare && player && !player.inVehicle && pd < sp.shy * (player.speed > 3.5 ? 1.6 : 1)) scare = player;
    if (scare && a.mode !== 'flee') {
      a.mode = 'flee';
      a.timer = r.range(2.5, 4.5);
      a.rest = 0;
      a.yaw = Math.atan2(a.x - scare.x, a.z - scare.z) + r.range(-0.5, 0.5);
      if (a.kind === 'rata') this.events.push({ kind: 'chillido', x: a.x, z: a.z });
      else if (a.kind === 'gato' && r.chance(0.3)) this.events.push({ kind: 'maullido', x: a.x, z: a.z });
    }
    a.timer -= dt;
    if (a.mode === 'flee') {
      a.speed = sp.flee;
      if (a.timer <= 0) a.mode = 'rest';
    } else if (a.mode === 'rest') {
      a.speed = 0;
      if (a.timer <= 0) {
        a.mode = 'walk';
        a.rest = 0;
        a.timer = a.kind === 'rata' ? r.range(0.8, 2) : r.range(4, 12);
        a.target = this._target(a);
      }
    } else {
      a.speed = sp.walk;
      if (a.timer <= 0 || !a.target || Math.hypot(a.target.x - a.x, a.target.z - a.z) < 0.8) {
        a.mode = 'rest';
        a.timer = r.range(sp.restTime[0], sp.restTime[1]);
        const k = r.next();
        a.rest = k < sp.rest[0] ? 1 : k < sp.rest[0] + sp.rest[1] ? 2 : 0;
      } else {
        const want = Math.atan2(a.target.x - a.x, a.target.z - a.z);
        a.yaw += wrap(want - a.yaw) * Math.min(1, dt * 3);
      }
    }
    // Caminar sin meterse en las paredes (si choca, da la vuelta).
    if (a.speed > 0) {
      const nx = a.x + Math.sin(a.yaw) * a.speed * dt;
      const nz = a.z + Math.cos(a.yaw) * a.speed * dt;
      if (this.blocked(nx, nz)) {
        a.yaw += Math.PI * r.range(0.6, 1.4);
        a.target = null;
      } else {
        a.x = nx;
        a.z = nz;
        a.y = this.groundHeight(nx, nz);
      }
      a.phase = (a.phase + dt * sp.gait * Math.max(0.6, a.speed / sp.walk) ** 0.6) % 6.2832;
    }
    // La postura cambia de a poco (sentarse, echarse, pararse).
    const goal = a.speed > 0 ? 0 : a.rest;
    a.pose += Math.sign(goal - a.pose) * Math.min(Math.abs(goal - a.pose), dt * 2.2);
    // Ladridos al que pasa cerca (y alguno de noche) y algún maullido.
    a.callT -= dt;
    if (a.callT <= 0) {
      a.callT = r.range(5, 14);
      if (a.kind === 'perro' && (pd < 12 || (ratHours(hour) && r.chance(0.25))) && r.chance(0.5)) this.events.push({ kind: 'ladrido', x: a.x, z: a.z });
      else if (a.kind === 'gato' && pd < 7 && r.chance(0.3)) this.events.push({ kind: 'maullido', x: a.x, z: a.z });
    }
  }

  /** A dónde camina: otro punto del andén (o otra bolsa de basura) a 8-30 m. */
  _target(a) {
    const grid = a.kind === 'rata' ? this.trashGrid : this.walkGrid;
    const lim = a.kind === 'rata' ? 10 : 30;
    const c = grid.near(a.x, a.z, lim).filter((p) => Math.hypot(p.x - a.x, p.z - a.z) > (a.kind === 'rata' ? 2 : 8));
    if (!c.length) return null;
    return c[Math.floor(this.rng.next() * c.length) % c.length];
  }

  /** Cuántos hay de cada uno. */
  counts() {
    const out = { perro: 0, gato: 0, rata: 0 };
    for (const a of this.list) out[a.kind]++;
    return out;
  }
}
