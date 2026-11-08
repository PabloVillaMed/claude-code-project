// Animales de la calle (puro, sin three.js): perros criollos que pasean por el
// andén, se paran en las esquinas, olfatean el piso, se sientan o se echan y de
// vez en cuando cruzan la calle por la esquina; gatos que caminan despacio
// pegados a las casas y salen disparados si uno se arrima; y, de noche, ratas
// que corren a saltos cortos junto a la pared, cerca de las bolsas de basura.
// Son pocos (un cupo por calidad, ANIMAL_BUDGETS, con tope ANIMAL_MAX) y solo
// existen cerca del jugador: aparecen lejos o a su espalda, separados entre
// sí, y se van cuando quedan lejos.
//
// Andan sobre el grafo del andén (el anillo del grafo peatonal de sim/pedNav.js,
// el mismo que usan los peatones: un solo grafo en memoria): el anillo peatonal de cada
// manzana residencial (b.ring, el centro del andén, a GRID.ring del sardinel)
// muestreado cada ~3 m, cada nodo con anterior, siguiente, la normal hacia las
// casas y si es esquina; desde algunas esquinas sale un cruce a la manzana de
// enfrente. Un perro solo deja el andén para cruzar así; los demás nunca. Se
// mueven como un vehículo pequeño: velocidad con aceleración y frenado
// limitados, giros con velocidad angular limitada (arcos, no giros en seco), y
// la fase del paso avanza con lo que de verdad se movieron (los pies no
// patinan). render/animals.js los dibuja (tres mallas instanciadas) con lo que
// deja cada animal: fase, amplitud y andar (paso, trote, carrera), cabeza
// (giro y cabeceo), postura (de pie, sentado, echado), agazapado y meneo.
//
// Se les puede pegar (v3.5): cada especie tiene su caja de impacto
// (ANIMAL_HITBOX, que usa sim/ballistics.js traceShot vía rayVsAnimal) y su
// salud. Un tiro, un golpe, un atropello (un vehículo rápido que les pasa
// por encima) o una explosión los hiere: chillan, huyen y cojean un rato; sin
// salud mueren: quedan echados de lado (`dead` sube de 0 a 1 y el sombreador
// los voltea), los de cerca salen corriendo y el cuerpo se va cuando lleva un
// rato sin verse. El muerto sigue contando para el cupo hasta que se va.

import { CORNER_TURN as RING_CORNER_TURN, EDGE, RING_STEP, RING_STREET_EDGE, sidewalkRing } from './pedNav.js';
import { makeRng } from './rng.js';
import { GRID } from './terrain.js';

export const ANIMAL_KINDS = ['perro', 'gato', 'rata'];

// ------------------------------------------------------------------ ajustes
/** Tope absoluto de animales a la vez (total y por especie), sea cual sea la calidad. */
export const ANIMAL_MAX = { total: 10, perro: 4, gato: 2, rata: 5 };
/**
 * Cupo por calidad: el primero cuyo `peds` (el de QUALITY_PRESETS: Baja 24,
 * Media 34, Alta 44, Ultra 56) no pase del del preset. Las ratas solo cuentan
 * de noche; `total` limita la suma.
 */
export const ANIMAL_BUDGETS = [
  { peds: 50, perro: 4, gato: 2, rata: 5, total: 10 }, // Ultra
  { peds: 40, perro: 3, gato: 2, rata: 4, total: 8 }, // Alta
  { peds: 30, perro: 3, gato: 1, rata: 3, total: 6 }, // Media
  { peds: 0, perro: 2, gato: 1, rata: 2, total: 4 }, // Baja
];
export const SPAWN_MIN_DIST = 28; // nunca aparecen más cerca del jugador que esto (m)
export const SPAWN_MAX_DIST = 70; // ni más lejos que esto (m)
export const SPAWN_VIEW_DIST = 58; // delante de la cámara solo aparecen más lejos que esto (m)
export const VIEW_COS = 0.45; // coseno del medio ángulo que cuenta como "a la vista" (~63°)
export const DESPAWN_DIST = 95; // más lejos que esto del jugador, desaparecen (m)
export const MIN_SEPARATION = 12; // distancia mínima a otro animal al aparecer (m)
export const POPULATION_EVERY = 0.5; // cada cuánto se revisa quién aparece o se va (s)
export const NODE_STEP = RING_STEP; // separación de los nodos del andén (m; se ajusta en sim/pedNav.js RING_STEP: el grafo es compartido)
export const CORNER_TURN = RING_CORNER_TURN; // lo que gira el andén para contar como esquina (sim/pedNav.js CORNER_TURN)
export const CROSS_MAX = 14; // un perro solo cruza a la manzana de enfrente si queda a menos de esto (m)
export const CROSS_CHANCE = 0.3; // probabilidad de cruzar al pararse en una esquina que tiene cruce
export const CROSS_CAR_CLEAR = 20; // y solo si no hay ningún carro a menos de esto del cruce (m)
export const CROSS_COOLDOWN = 40; // tiempo mínimo entre dos cruces del mismo perro (s)
export const TURN_BACK_AT_CORNER = 0.25; // probabilidad de dar media vuelta en una esquina
export const STREET_EDGE = RING_STREET_EDGE; // lo más que se acercan al sardinel (m desde el centro del andén; sim/pedNav.js RING_STREET_EDGE)
export const WALL_EDGE = GRID.sidewalk - GRID.ring - 0.12; // lo más que se acercan a las casas (m)
export const RAT_HOME = 10; // las ratas no se alejan más que esto de su bolsa de basura (m)
export const HEAD_YAW_MAX = 1.25; // lo más que giran la cabeza a cada lado (rad)

// ------------------------------------------------------------------ golpes, heridas y muerte
/**
 * Caja de impacto de cada especie (m, para escala 1; se multiplica por la del
 * animal): un elipsoide para el tronco y las patas, del piso al lomo (`h`
 * alto, `r` medio ancho, `l` medio largo, centrado en el animal), y una
 * esfera para la cabeza (`head`: alto del centro, cuánto adelante y radio).
 * Un tiro en la cabeza cuenta como tiro a la cabeza (más daño).
 */
export const ANIMAL_HITBOX = {
  perro: { h: 0.6, r: 0.16, l: 0.4, head: [0.64, 0.36, 0.11] },
  gato: { h: 0.32, r: 0.085, l: 0.22, head: [0.35, 0.2, 0.065] },
  rata: { h: 0.1, r: 0.045, l: 0.1, head: [0.09, 0.11, 0.035] },
};
/** Salud de cada especie (la pistola quita 30 por tiro, el puño 18, el machete 55). */
export const ANIMAL_HEALTH = { perro: 50, gato: 22, rata: 6 };
export const DEATH_BLEND = 0.35; // lo que tarda en quedar echado de lado al morir (s)
export const CORPSE_MIN_TIME = 25; // el cuerpo se queda al menos esto (s)...
export const CORPSE_UNSEEN_TIME = 5; // ...y se va cuando lleva esto sin verse (s seguidos)
export const CORPSE_SEEN_DIST = 60; // más lejos que esto de la cámara cuenta como "no se ve" (m)
export const DEATH_ALARM_RADIUS = 16; // los demás animales a menos de esto salen corriendo al morir uno (m)
export const LIMP_TIME = 14; // herido y vivo: cojea este rato (s)
export const LIMP_SPEED = 0.55; // cojeando va a esta fracción de su velocidad
export const RUNOVER_MIN_SPEED = 2.5; // un vehículo más rápido que esto (m/s) atropella
export const RUNOVER_DAMAGE = 8; // daño del atropello por cada m/s del vehículo

/** Cuántos de cada uno alrededor del jugador, según la calidad (peds como medida). */
export function animalBudget(peds = 30) {
  const b = ANIMAL_BUDGETS.find((q) => peds >= q.peds) ?? ANIMAL_BUDGETS[ANIMAL_BUDGETS.length - 1];
  const out = { total: Math.min(b.total, ANIMAL_MAX.total) };
  for (const k of ANIMAL_KINDS) out[k] = Math.min(b[k], ANIMAL_MAX[k]);
  return out;
}

/** Las ratas salen de noche (y un poco al anochecer y antes de amanecer). */
export function ratHours(hour) {
  return hour >= 19 || hour < 5.5;
}

/** Lo que deja rayVsAnimal además de la distancia (se reutiliza: no asigna memoria). */
export const ANIMAL_RAY = { head: false };

/**
 * Rayo (origen o, dirección d normalizada) contra la caja de impacto de un
 * animal vivo (ANIMAL_HITBOX: elipsoide del tronco y esfera de la cabeza,
 * girados con su yaw y por su escala). Devuelve la distancia o null; en
 * ANIMAL_RAY.head, si le dio en la cabeza.
 */
export function rayVsAnimal(ox, oy, oz, dx, dy, dz, a, maxDist) {
  const hb = ANIMAL_HITBOX[a.kind];
  if (!hb) return null;
  const s = a.scale ?? 1;
  const sy = Math.sin(a.yaw);
  const cy = Math.cos(a.yaw);
  let best = null;
  // Cabeza: esfera adelante y arriba del tronco.
  const hx = a.x + sy * hb.head[1] * s - ox;
  const hyy = a.y + hb.head[0] * s - oy;
  const hz = a.z + cy * hb.head[1] * s - oz;
  const hr = hb.head[2] * s;
  const hb2 = hx * dx + hyy * dy + hz * dz;
  const hdisc = hb2 * hb2 - (hx * hx + hyy * hyy + hz * hz - hr * hr);
  if (hdisc >= 0) {
    const q = Math.sqrt(hdisc);
    const t = hb2 - q >= 0 ? hb2 - q : hb2 + q;
    if (t >= 0 && t <= maxDist) best = t;
  }
  // Tronco: en coordenadas del animal (x a la derecha, z adelante) y escalado a la esfera unitaria.
  const rx = 1 / (hb.r * s);
  const ry = 2 / (hb.h * s);
  const rz = 1 / (hb.l * s);
  const px = ox - a.x;
  const py = (oy - a.y - (hb.h * s) / 2) * ry;
  const pz = oz - a.z;
  const lpx = (px * cy - pz * sy) * rx;
  const lpz = (px * sy + pz * cy) * rz;
  const ldx = (dx * cy - dz * sy) * rx;
  const ldy = dy * ry;
  const ldz = (dx * sy + dz * cy) * rz;
  const A = ldx * ldx + ldy * ldy + ldz * ldz;
  const B = lpx * ldx + py * ldy + lpz * ldz;
  const C = lpx * lpx + py * py + lpz * lpz - 1;
  const disc = B * B - A * C;
  let head = best !== null;
  if (disc >= 0 && A > 0) {
    const q = Math.sqrt(disc);
    let t = (-B - q) / A;
    if (t < 0) t = C < 0 ? 0 : -1; // desde adentro: pega de una
    if (t >= 0 && t <= maxDist && (best === null || t < best)) {
      best = t;
      head = false;
    }
  }
  ANIMAL_RAY.head = head;
  return best;
}

/**
 * Por especie. Velocidades en m/s (walk: rango al paso, trot: al trote, run: a
 * la carrera), aceleración, arranque asustado (bolt) y frenado (m/s²), velocidad angular máxima quieto y
 * corriendo (rad/s) y su aceleración, zancada al paso y a la carrera (m),
 * velocidades a las que pasa al trote y a la carrera (gaitAt), franja del andén
 * por donde anda (lane: m desde el centro, + hacia las casas), distancia a la
 * que se aparta del jugador a pie (shy) y a la que lo mira (look), cada cuánto
 * se para caminando (stopEvery, s), probabilidad de sentarse / echarse al
 * descansar (rest) y cuánto (restTime), cuánto dura la huida (flee) y la
 * cabeza abajo al olfatear (sniff, rad). `leg` es el alto de la cadera de
 * render/animals.js (para que la amplitud del paso case con la zancada).
 */
export const SPECIES = {
  perro: {
    leg: 0.44, walk: [0.75, 1.35], trot: [1.9, 2.5], run: 5.0, accel: 2.2, bolt: 6, brake: 3.5, turn: [2.2, 4.5], turnAcc: 9, stride: [0.6, 1.6], gaitAt: [1.6, 3.4], ampMax: 0.8,
    lane: [-0.45, 0.5], shy: 1.8, look: 12, stopEvery: [6, 16], rest: [0.45, 0.3], restTime: [6, 25], flee: [2.5, 4.5], sniff: 0.8, carFear: 5,
  },
  gato: {
    leg: 0.23, walk: [0.35, 0.6], trot: [1.2, 1.6], run: 4.6, accel: 2.4, bolt: 9, brake: 4.5, turn: [2.5, 5.5], turnAcc: 12, stride: [0.32, 1.0], gaitAt: [0.9, 2.4], ampMax: 0.85,
    lane: [0.72, 0.9], shy: 3.4, look: 8, stopEvery: [5, 12], rest: [0.65, 0.25], restTime: [10, 35], flee: [1.6, 3], sniff: 0.5, carFear: 7,
  },
  rata: {
    leg: 0.045, walk: [1.3, 2.1], trot: [1.3, 2.1], run: 3.6, accel: 9, bolt: 12, brake: 12, turn: [5, 8], turnAcc: 30, stride: [0.18, 0.3], gaitAt: [0.25, 0.6], ampMax: 0.9,
    lane: [0.8, 0.95], shy: 6, look: 5, stopEvery: [0.3, 1.1], rest: [0, 0], restTime: [0.4, 1.6], flee: [1.2, 2.2], sniff: -0.35, carFear: 6,
  },
};
const ADVANCE = 1.2; // a esta distancia del nodo ya apunta al siguiente (m)
// Lo que suena al herirse o morir (game/audio.js animal()): gemido del perro, quejido del gato, chillido de la rata.
const PAIN = { perro: 'gemido', gato: 'quejido', rata: 'chillido' };
const CELL = 30;
const TAU = Math.PI * 2;

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smooth = (a, b, v) => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

// ------------------------------------------------------------------ grafo del andén
/**
 * Grafo del andén: el anillo de sim/pedNav.js (sidewalkRing: nodos cada
 * ~NODE_STEP m del anillo peatonal de cada manzana residencial), con los
 * cruces que sirven a un perro: los que siguen la línea del andén, todo
 * calzada (sin separador) y de menos de CROSS_MAX m. Cada nodo: {x, z, prev,
 * next (índices), nx, nz (normal hacia las casas), out (hasta dónde hacia la
 * calle sigue siendo andén), block, corner (1 si es esquina), cross (null o
 * índices de nodos de la manzana de enfrente a los que un perro puede
 * cruzar)}. En el juego no se arma este arreglo: AnimalSim lee el grafo
 * peatonal compartido (buildPedGraph) directamente.
 */
export function sidewalkPoints(city, step = NODE_STEP) {
  const nodes = sidewalkRing(city, step);
  for (const a of nodes) {
    const c = a.links?.filter((l) => l.road && l.d < CROSS_MAX).map((l) => l.j);
    a.cross = c?.length ? c : null;
    a.links = undefined;
  }
  return nodes;
}

/** Índice en grilla de nodos (por número) para pedir los de cerca sin recorrer los miles. */
class NodeGrid {
  constructor(xs, zs, ids) {
    this.cells = new Map();
    for (const i of ids) {
      const k = this.key(Math.floor(xs[i] / CELL), Math.floor(zs[i] / CELL));
      let c = this.cells.get(k);
      if (!c) this.cells.set(k, (c = []));
      c.push(i);
    }
  }

  key(i, j) {
    return i * 100003 + j;
  }

  /** Agrega a `out` los nodos de las celdas que tocan el cuadrado de lado 2r alrededor de (x, z). */
  collect(x, z, r, out) {
    const i0 = Math.floor((x - r) / CELL);
    const i1 = Math.floor((x + r) / CELL);
    const j0 = Math.floor((z - r) / CELL);
    const j1 = Math.floor((z + r) / CELL);
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const c = this.cells.get(this.key(i, j));
        if (c) for (let k = 0; k < c.length; k++) out.push(c[k]);
      }
    }
    return out;
  }
}

/**
 * Simulación de los animales. `graph`: el grafo peatonal de sim/pedNav.js
 * (buildPedGraph, compartido con los peatones; en el juego) o `sidewalk`: el
 * arreglo de sidewalkPoints(city) (pruebas); los dos dan el mismo anillo.
 * `trash`: bolsas de basura {x, z} (las ratas viven junto a ellas).
 * update(dt, {focus, player, hour, vehicles, budget, camera | view}); `list`
 * son los animales vivos y `events` lo que suena en el cuadro ({kind:
 * 'ladrido' | 'maullido' | 'chillido', x, z}). `camera` (un Object3D: se leen
 * position y matrixWorld) o `view` ({x, z, fx, fz}) dicen hacia dónde se mira,
 * para no hacer aparecer animales a la vista; sin eso se usa hacia dónde va el
 * jugador.
 */
export class AnimalSim {
  constructor({ sidewalk = [], graph = null, trash = [], groundHeight = () => 0, blocked = () => false, seed = 77 } = {}) {
    this.rng = makeRng(seed);
    if (graph) {
      // El grafo peatonal compartido (sim/pedNav.js buildPedGraph): se leen
      // sus arreglos tal cual (los nodos del anillo son los primeros) y su
      // grilla; solo se arman aquí los cruces que sirven a un perro.
      const n = graph.ringCount;
      this.px = graph.x;
      this.pz = graph.z;
      this.inx = graph.nx;
      this.inz = graph.nz;
      this.out = graph.out;
      this.next = graph.next;
      this.prev = graph.prev;
      this.corner = graph.corner;
      this.cross = new Array(n).fill(null);
      const need = EDGE.cross | EDGE.line | EDGE.road;
      for (let i = 0; i < n; i++) {
        if (!graph.corner[i]) continue;
        let links = null;
        for (let e = graph.eStart[i]; e < graph.eStart[i + 1]; e++) {
          const j = graph.eTo[e];
          if ((graph.eFlag[e] & need) !== need || j >= n || Math.hypot(graph.x[j] - graph.x[i], graph.z[j] - graph.z[i]) >= CROSS_MAX) continue;
          (links ??= []).push(j);
        }
        this.cross[i] = links;
      }
      const grid = graph.grid;
      this.grid = { collect: (x, z, r, out) => grid.collect(x, z, r, out, n) };
    } else {
      const n = sidewalk.length;
      this.px = new Float64Array(n);
      this.pz = new Float64Array(n);
      this.inx = new Float32Array(n);
      this.inz = new Float32Array(n);
      this.out = new Float32Array(n);
      this.next = new Int32Array(n);
      this.prev = new Int32Array(n);
      this.corner = new Uint8Array(n);
      this.cross = new Array(n).fill(null);
      for (let i = 0; i < n; i++) {
        const p = sidewalk[i];
        this.px[i] = p.x;
        this.pz[i] = p.z;
        this.inx[i] = p.nx ?? 0;
        this.inz[i] = p.nz ?? 0;
        this.out[i] = p.out ?? STREET_EDGE;
        this.next[i] = p.next ?? i;
        this.prev[i] = p.prev ?? i;
        this.corner[i] = p.corner ? 1 : 0;
        this.cross[i] = p.cross?.length ? p.cross : null;
      }
      const all = Array.from({ length: n }, (_, i) => i);
      this.grid = new NodeGrid(this.px, this.pz, all);
    }
    // Ratas: el nodo del andén más cercano a cada bolsa de basura (a menos de 4 m).
    const ratNodes = [];
    const tmp = [];
    for (const t of trash) {
      tmp.length = 0;
      this.grid.collect(t.x, t.z, 4, tmp);
      let best = -1;
      let bd = 4;
      for (const i of tmp) {
        const d = Math.hypot(this.px[i] - t.x, this.pz[i] - t.z);
        if (d < bd) {
          bd = d;
          best = i;
        }
      }
      if (best >= 0 && !ratNodes.includes(best)) ratNodes.push(best);
    }
    this.ratGrid = new NodeGrid(this.px, this.pz, ratNodes);
    this.groundHeight = groundHeight;
    this.blocked = blocked;
    this.list = [];
    this.events = [];
    this._pending = []; // sonidos de golpes que llegan fuera de update (salen en el siguiente)
    this._inUpdate = false;
    this._melee = { a: null, d: 0 };
    this.threats = [];
    this.vehicles = [];
    this.spawnT = 0;
    this.nextId = 1;
    this._cand = [];
    this._view = { x: 0, z: 0, fx: 0, fz: 0, ok: false };
    this._last = null; // dónde estaba el jugador (para saber hacia dónde va)
  }

  /** Un tiro o una explosión: los de cerca salen corriendo; los de más lejos miran hacia allá. */
  alarm(x, z, radius = 35) {
    this.threats.push({ x, z, radius, t: 0.5 });
  }

  update(dt, ctx) {
    const { focus, player = null, hour = 12, vehicles = [], budget = animalBudget() } = ctx;
    this.events.length = 0;
    for (let i = 0; i < this._pending.length; i++) this.events.push(this._pending[i]);
    this._pending.length = 0;
    this.vehicles = vehicles;
    for (let i = this.threats.length - 1; i >= 0; i--) if ((this.threats[i].t -= dt) <= 0) this.threats.splice(i, 1);
    this._updateView(ctx, focus);
    this.spawnT -= dt;
    if (this.spawnT <= 0) {
      this.spawnT = POPULATION_EVERY;
      this._population(focus, hour, budget);
    }
    this._inUpdate = true;
    if (dt > 0) for (let i = 0; i < this.list.length; i++) this._step(this.list[i], dt, player, hour);
    this._inUpdate = false;
  }

  /** Hacia dónde mira la cámara (o, sin cámara, hacia dónde va el jugador). */
  _updateView(ctx, focus) {
    const v = this._view;
    if (ctx.view) {
      v.x = ctx.view.x;
      v.z = ctx.view.z;
      v.fx = ctx.view.fx;
      v.fz = ctx.view.fz;
    } else if (ctx.camera?.matrixWorld) {
      const e = ctx.camera.matrixWorld.elements;
      v.x = ctx.camera.position.x;
      v.z = ctx.camera.position.z;
      v.fx = -e[8];
      v.fz = -e[10];
    } else {
      if (!this._last) this._last = { x: focus.x, z: focus.z };
      const dx = focus.x - this._last.x;
      const dz = focus.z - this._last.z;
      const d = Math.hypot(dx, dz);
      v.x = focus.x;
      v.z = focus.z;
      if (d > 0.5 && d < 30) {
        v.fx = dx / d;
        v.fz = dz / d;
      }
      if (d > 0.5) {
        this._last.x = focus.x;
        this._last.z = focus.z;
      }
    }
    const l = Math.hypot(v.fx, v.fz);
    v.ok = l > 1e-3;
    if (v.ok) {
      v.fx /= l;
      v.fz /= l;
    }
  }

  /** ¿Se ve (x, z) desde la cámara? (dentro del cono de visión, a cualquier distancia). */
  inView(x, z) {
    const v = this._view;
    if (!v.ok) return false;
    const dx = x - v.x;
    const dz = z - v.z;
    const d = Math.hypot(dx, dz);
    return d < 1 || (dx * v.fx + dz * v.fz) / d > VIEW_COS;
  }

  _population(focus, hour, budget) {
    const night = ratHours(hour);
    const list = this.list;
    // Lejos (o ratas de día, apenas ya no se vean): se van. Los cuerpos, cuando ya llevan rato sin verse.
    let w = 0;
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      const d = Math.hypot(a.x - focus.x, a.z - focus.z);
      if (d > DESPAWN_DIST || (a.kind === 'rata' && !night && (d > 25 || !this.inView(a.x, a.z)))) continue;
      if (a.mode === 'dead' && a.corpseT >= CORPSE_MIN_TIME && a.unseenT >= CORPSE_UNSEEN_TIME) continue;
      list[w++] = a;
    }
    list.length = w;
    const total = Math.min(budget.total ?? ANIMAL_MAX.total, ANIMAL_MAX.total);
    let have = 0;
    for (const kind of ANIMAL_KINDS) {
      const want = this._want(kind, night, budget);
      let n = 0;
      for (const a of list) if (a.kind === kind) n++;
      // Si bajó el cupo (otra calidad), se va el más lejano que no se vea.
      if (n > want) this._dropOne(kind, focus);
      have += Math.min(n, want);
    }
    if (have >= total) return;
    // Uno por revisión, rotando la especie que empieza: así no aparecen de a montones.
    const start = Math.floor(this.rng.next() * ANIMAL_KINDS.length);
    for (let s = 0; s < ANIMAL_KINDS.length; s++) {
      const kind = ANIMAL_KINDS[(start + s) % ANIMAL_KINDS.length];
      let n = 0;
      for (const a of list) if (a.kind === kind) n++;
      if (n < this._want(kind, night, budget) && this._spawn(kind, focus)) return;
    }
  }

  _want(kind, night, budget) {
    return kind === 'rata' && !night ? 0 : Math.min(budget[kind] ?? 0, ANIMAL_MAX[kind]);
  }

  _dropOne(kind, focus) {
    let worst = -1;
    let wd = -1;
    for (let i = 0; i < this.list.length; i++) {
      const a = this.list[i];
      if (a.kind !== kind || this.inView(a.x, a.z)) continue;
      const d = Math.hypot(a.x - focus.x, a.z - focus.z);
      if (d > wd) {
        wd = d;
        worst = i;
      }
    }
    if (worst >= 0) this.list.splice(worst, 1);
  }

  /** ¿Hay otro animal a menos de `r` m de (x, z)? */
  _crowded(x, z, r) {
    for (const a of this.list) if (Math.abs(a.x - x) < r && Math.abs(a.z - z) < r && Math.hypot(a.x - x, a.z - z) < r) return true;
    return false;
  }

  _spawn(kind, focus) {
    const r = this.rng;
    const cand = this._cand;
    cand.length = 0;
    (kind === 'rata' ? this.ratGrid : this.grid).collect(focus.x, focus.z, SPAWN_MAX_DIST, cand);
    const v = this._view;
    for (let t = 0; t < 16 && cand.length; t++) {
      const k = cand[Math.floor(r.next() * cand.length) % cand.length];
      const x0 = this.px[k];
      const z0 = this.pz[k];
      const d = Math.hypot(x0 - focus.x, z0 - focus.z);
      if (d < SPAWN_MIN_DIST || d > SPAWN_MAX_DIST) continue;
      if (this.inView(x0, z0) && Math.hypot(x0 - v.x, z0 - v.z) < SPAWN_VIEW_DIST) continue;
      if (this._crowded(x0, z0, MIN_SEPARATION)) continue;
      const a = this._make(kind, k);
      if (a) return a;
    }
    return null;
  }

  /** Pone un animal en el nodo `k` del andén (null si ahí no cabe). */
  _make(kind, k, opts = {}) {
    const r = this.rng;
    const sp = SPECIES[kind];
    const lat = Math.max(-this.out[k], opts.lat ?? r.range(sp.lane[0], sp.lane[1]));
    const x = this.px[k] + this.inx[k] * lat;
    const z = this.pz[k] + this.inz[k] * lat;
    if (this.blocked(x, z)) return null;
    const dir = opts.dir ?? (r.chance(0.5) ? 1 : -1);
    const j = dir > 0 ? this.next[k] : this.prev[k];
    const a = {
      id: this.nextId++,
      kind,
      x,
      z,
      y: this.groundHeight(x, z),
      yaw: Math.atan2(this.px[j] - this.px[k], this.pz[j] - this.pz[k]),
      speed: 0, // la que lleva (m/s): cambia con aceleración limitada
      vel: 0, // la que de verdad se movió en el cuadro (para el paso)
      w: 0, // velocidad angular (rad/s)
      vWant: 0,
      pace: r.range(sp.walk[0], sp.walk[1]),
      mode: 'rest', // walk, stop, rest, flee, cross
      act: '', // en 'stop' o 'walk': sniff (olfatea), look (mira), corner (esquina), pause (rata)
      timer: r.range(1, 6),
      eventT: r.range(sp.stopEvery[0], sp.stopEvery[1]),
      pose: 0, // 0 de pie, 1 sentado, 2 echado (lo que se ve; se acerca a `rest` de a poco)
      rest: 0,
      phase: r.next() * TAU,
      amp: 0,
      gait: 0, // 0 al paso, 1 al trote, 2 a la carrera
      headYaw: 0,
      headPitch: 0, // + es la nariz hacia abajo
      lookYaw: 0,
      lookT: 0,
      crouch: 0,
      wag: 0.15,
      node: j,
      dir,
      lat,
      latWant: lat,
      detourT: 0,
      stuck: 0,
      cornerCool: 2,
      crossCool: r.range(5, CROSS_COOLDOWN),
      crossTo: -1,
      crossT: 0,
      onRoad: false,
      home: k,
      fleeTotal: 1,
      intense: false,
      threatX: 0,
      threatZ: 0,
      threatT: 0, // cuánto más mira hacia el último susto o ruido
      hurry: false,
      scale: kind === 'perro' ? r.range(0.85, 1.15) : kind === 'gato' ? r.range(0.9, 1.05) : r.range(0.85, 1.1),
      color: Math.floor(r.next() * 997),
      callT: r.range(2, 8),
      health: ANIMAL_HEALTH[kind],
      limpT: 0, // herido: cuánto más cojea (s)
      runCool: 0, // recién atropellado: no lo vuelve a contar la misma pasada (s)
      side: 1, // muerto: de qué lado quedó (+1 sobre su derecha, -1 sobre su izquierda)
      dead: 0, // 0 vivo, 1 echado de lado (lo que se ve; sube en DEATH_BLEND al morir)
      corpseT: 0, // muerto: cuánto lleva así (s)
      unseenT: 0, // muerto: cuánto lleva sin verse (s seguidos)
    };
    // Unos arrancan echados o sentados; otros, caminando.
    const q = r.next();
    if (kind === 'rata' || q < 0.35) {
      a.mode = 'walk';
      a.eventT = kind === 'rata' ? r.range(0.3, 1.0) : a.eventT;
    } else if (q < 0.35 + 0.65 * sp.rest[0]) a.rest = 1;
    else if (q < 0.35 + 0.65 * (sp.rest[0] + sp.rest[1])) a.rest = 2;
    if (a.mode === 'rest') a.timer = r.range(sp.restTime[0], sp.restTime[1]) * 0.5;
    a.pose = a.rest;
    this.list.push(a);
    return a;
  }

  /** Para pruebas y la sonda: pone un animal en el andén más cercano a (x, z) (a menos de 12 m). */
  spawnAt(kind, x, z, opts = {}) {
    const c = this._cand;
    c.length = 0;
    this.grid.collect(x, z, 12, c);
    let best = -1;
    let bd = 12;
    for (const i of c) {
      const d = Math.hypot(this.px[i] - x, this.pz[i] - z);
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    if (best < 0) return null;
    const a = this._make(kind, best, opts);
    if (a && opts.mode) {
      a.mode = opts.mode;
      a.timer = opts.timer ?? 30;
      a.rest = opts.rest ?? 0;
      a.pose = a.rest;
    }
    if (a && opts.color !== undefined) a.color = opts.color;
    return a;
  }

  // ---------------------------------------------------------------- un animal en un cuadro
  _step(a, dt, player, hour) {
    if (a.mode === 'dead') {
      this._corpse(a, dt);
      return;
    }
    // Atropellado: un vehículo rápido con el animal debajo de su huella (una vez por pasada).
    a.runCool -= dt;
    for (let i = 0; i < this.vehicles.length && a.runCool <= 0; i++) {
      const v = this.vehicles[i];
      if (v.speed > RUNOVER_MIN_SPEED && v.hx !== undefined && Math.abs(v.x - a.x) < 6 && Math.abs(v.z - a.z) < 6 && this._under(a, v)) {
        a.runCool = 1.2;
        this.damage(a, v.speed * RUNOVER_DAMAGE, v.x, v.z, 'impact', !!v.player);
        if (a.mode === 'dead') return;
      }
    }
    const sp = SPECIES[a.kind];
    const r = this.rng;
    a.cornerCool -= dt;
    a.crossCool -= dt;
    a.threatT -= dt;
    a.detourT -= dt;
    // ¿Algo lo asusta? Un tiro cerca, un carro rápido encima o el jugador arrimándose.
    let scare = 0; // 0 nada, 1 apartarse, 2 huir
    let sx = 0;
    let sz = 0;
    for (const t of this.threats) {
      const d = Math.hypot(t.x - a.x, t.z - a.z);
      if (d < t.radius) {
        scare = 2;
        sx = t.x;
        sz = t.z;
      } else if (d < t.radius * 2.5 && a.threatT <= 0) this._noise(a, t.x, t.z, 2.5);
    }
    for (const v of this.vehicles) {
      if (Math.abs(v.x - a.x) > 12 || Math.abs(v.z - a.z) > 12) continue;
      const d = Math.hypot(v.x - a.x, v.z - a.z);
      if (v.speed > 3 && d < sp.carFear) {
        const s = a.kind === 'perro' && d > 3 && v.speed < 9 ? 1 : 2;
        if (s >= scare) {
          scare = s;
          sx = v.x;
          sz = v.z;
        }
      } else if (v.speed > 2 && d < 10 && a.threatT <= 0) this._noise(a, v.x, v.z, 1.2);
    }
    const alive = player && !player.dead;
    const pd = alive ? Math.hypot(player.x - a.x, player.z - a.z) : Infinity;
    if (!scare && alive && !player.inVehicle && pd < sp.shy * (player.speed > 3.5 ? 1.8 : 1)) {
      scare = a.kind === 'perro' && player.speed <= 3.5 ? 1 : 2;
      sx = player.x;
      sz = player.z;
    }
    if (scare) {
      if (a.mode === 'cross') a.hurry = true;
      else this._flee(a, sx, sz, scare === 2);
    }

    // Qué quiere hacer (velocidad deseada, franja del andén, postura).
    a.timer -= dt;
    const m = a.mode;
    if (m === 'walk') {
      a.eventT -= dt;
      a.vWant = a.act === 'sniff' ? Math.min(a.pace, 0.45) : a.pace;
      if (a.act === 'sniff' && a.timer <= 0) a.act = '';
      if (a.eventT <= 0) this._idle(a);
    } else if (m === 'stop') {
      a.vWant = 0;
      if (a.timer <= 0) this._resume(a);
    } else if (m === 'rest') {
      a.vWant = 0;
      if (a.timer <= 0) {
        a.rest = 0;
        this._walk(a);
      }
    } else if (m === 'flee') {
      // Arranca a toda y va bajando el ritmo (carrera, trote, paso) antes de parar.
      const k = smooth(0, 0.6, a.timer / a.fleeTotal);
      a.vWant = a.intense ? sp.walk[1] + (sp.run - sp.walk[1]) * k : sp.walk[1] + (sp.trot[1] - sp.walk[1]) * k;
      if (a.timer <= 0) {
        a.mode = 'stop';
        a.act = 'look';
        a.timer = r.range(1.5, 3.5);
        a.threatT = a.timer;
      }
    } else if (m === 'cross') {
      a.vWant = a.hurry ? sp.run * 0.8 : sp.trot[0];
      a.crossT += dt;
    }
    // Herido: cojea (más despacio) un rato.
    if (a.limpT > 0) {
      a.limpT -= dt;
      a.vWant *= LIMP_SPEED;
    }
    // Con cupo para pararse: sentado o echado no camina (primero se levanta).
    const poseGoal = a.mode === 'rest' ? a.rest : 0;
    a.pose += Math.sign(poseGoal - a.pose) * Math.min(Math.abs(poseGoal - a.pose), dt * (a.mode === 'flee' ? 5 : 1.6));
    if (a.pose > (a.mode === 'flee' ? 0.5 : 0.12)) a.vWant = 0;

    this._steer(a, dt);
    const moved = this._move(a, dt);
    this._animate(a, dt, moved, player, pd);

    // Ladridos al que pasa cerca (y alguno de noche) y algún maullido.
    a.callT -= dt;
    if (a.callT <= 0) {
      a.callT = r.range(5, 14);
      if (a.kind === 'perro' && (pd < 12 || (ratHours(hour) && r.chance(0.25))) && r.chance(0.5)) this._emit('ladrido', a.x, a.z);
      else if (a.kind === 'gato' && pd < 7 && r.chance(0.3)) this._emit('maullido', a.x, a.z);
    }
  }

  /** Un sonido para game/audio.js animal(): dentro de update sale en este cuadro; desde afuera (un tiro), en el siguiente. */
  _emit(kind, x, z, extra = false) {
    (this._inUpdate ? this.events : this._pending).push({ kind, x, z, fuerte: extra });
  }

  // ---------------------------------------------------------------- golpes, heridas y muerte
  /**
   * Le hace daño a un animal (tiro, golpe, atropello o explosión) desde
   * (sx, sz): si se queda sin salud, muere; si no, chilla, sale corriendo
   * para el otro lado y cojea un rato. Devuelve 'dead', 'hurt' o null (ya
   * estaba muerto o no hubo daño).
   */
  damage(a, dmg, sx, sz, how = 'gun', byPlayer = false) {
    if (!a || a.mode === 'dead' || !(dmg > 0)) return null;
    a.health -= dmg;
    a.lastHit = how;
    a.byPlayer = byPlayer;
    if (how === 'impact') this._emit('atropello', a.x, a.z); // el golpe (render y sonido los pone el juego)
    if (a.health <= 0) {
      this._kill(a, sx, sz);
      return 'dead';
    }
    this._emit(PAIN[a.kind], a.x, a.z);
    a.limpT = LIMP_TIME;
    a.rest = 0;
    if (a.mode === 'cross') a.hurry = true;
    else {
      if (a.mode === 'flee') a.mode = 'stop'; // vuelve a escoger para dónde huir
      this._flee(a, sx, sz, true, true);
    }
    return 'hurt';
  }

  _kill(a, sx, sz) {
    a.health = 0;
    a.mode = 'dead';
    a.act = '';
    a.limpT = 0;
    a.speed = a.vWant = a.vel = a.w = 0;
    a.hurry = false;
    a.corpseT = 0;
    a.unseenT = 0;
    // Cae para el lado contrario de donde vino el golpe (las patas quedan hacia allá).
    const side = (a.x - sx) * Math.cos(a.yaw) - (a.z - sz) * Math.sin(a.yaw);
    a.side = side > 0.02 ? 1 : side < -0.02 ? -1 : this.rng.chance(0.5) ? 1 : -1;
    this._emit(PAIN[a.kind], a.x, a.z, true);
    // Los demás de cerca salen corriendo.
    this.threats.push({ x: a.x, z: a.z, radius: DEATH_ALARM_RADIUS, t: 0.5 });
  }

  /** Un cuerpo: se echa de lado (en DEATH_BLEND), se queda quieto y cuenta cuánto lleva sin verse. */
  _corpse(a, dt) {
    a.dead = Math.min(1, a.dead + dt / DEATH_BLEND);
    a.corpseT += dt;
    const v = this._view;
    const seen = this.inView(a.x, a.z) && Math.hypot(a.x - v.x, a.z - v.z) < CORPSE_SEEN_DIST;
    a.unseenT = seen ? 0 : a.unseenT + dt;
    const k = Math.min(1, dt * 8);
    a.amp -= a.amp * k;
    a.headYaw -= a.headYaw * k;
    a.headPitch -= a.headPitch * k;
    a.crouch -= a.crouch * k;
    a.gait -= a.gait * k;
    a.wag = 0;
    const gy = this.groundHeight(a.x, a.z);
    a.y += (gy - a.y) * Math.min(1, dt * 14);
  }

  /** ¿Está (x, z) del animal debajo de la huella del vehículo v ({x, z, hx, hz, angle})? */
  _under(a, v) {
    const r = ANIMAL_HITBOX[a.kind].r * a.scale;
    const dx = a.x - v.x;
    const dz = a.z - v.z;
    const c = Math.cos(v.angle);
    const s = Math.sin(v.angle);
    return Math.abs(dx * c - dz * s) < v.hx + r && Math.abs(dx * s + dz * c) < v.hz + r;
  }

  /** Explosión en (x, z): daño a los de menos de `radius` m, menos entre más lejos. */
  blast(x, z, radius, dmg, byPlayer = false) {
    for (let i = 0; i < this.list.length; i++) {
      const a = this.list[i];
      const d = Math.hypot(a.x - x, a.z - z);
      if (d < radius) this.damage(a, dmg * (1 - d / radius), x, z, 'blast', byPlayer);
    }
  }

  /**
   * El animal vivo más cercano al que le llega un golpe desde (x, z) mirando
   * hacia (fx, fz): a menos de `range` m (más su medio largo) y adelante
   * (coseno > minCos). Devuelve {a, d} reutilizado o null.
   */
  meleeTarget(x, z, fx, fz, range, minCos = 0.4) {
    let best = null;
    let bd = Infinity;
    for (let i = 0; i < this.list.length; i++) {
      const a = this.list[i];
      if (a.mode === 'dead') continue;
      const dx = a.x - x;
      const dz = a.z - z;
      const d = Math.hypot(dx, dz);
      const reach = range + ANIMAL_HITBOX[a.kind].l * a.scale;
      if (d < reach && d < bd && (dx * fx + dz * fz) / (d || 1) > minCos) {
        bd = d;
        best = a;
      }
    }
    if (!best) return null;
    this._melee.a = best;
    this._melee.d = bd;
    return this._melee;
  }

  /** Algo suena o pasa cerca: lo mira un rato. */
  _noise(a, x, z, t) {
    a.threatX = x;
    a.threatZ = z;
    a.threatT = t;
  }

  /** Sale corriendo por el andén, hacia el lado contrario del susto (o se aparta, si no es para tanto). */
  _flee(a, sx, sz, intense, quiet = false) {
    const r = this.rng;
    const sp = SPECIES[a.kind];
    this._noise(a, sx, sz, 3);
    if (a.mode === 'flee' && (a.intense || !intense)) {
      a.timer = Math.max(a.timer, a.fleeTotal * 0.6);
      return;
    }
    if (a.mode !== 'flee' && !quiet) {
      if (a.kind === 'rata') this._emit('chillido', a.x, a.z);
      else if (a.kind === 'gato' && r.chance(0.3)) this._emit('maullido', a.x, a.z);
    }
    a.mode = 'flee';
    a.act = '';
    a.intense = intense;
    a.rest = 0;
    a.fleeTotal = a.timer = r.range(sp.flee[0], sp.flee[1]) * (intense ? 1 : 0.7);
    // Por el andén, para el lado que más lo aleja.
    const ahead = this._walkFrom(a.node, a.dir, 9);
    const back = this._walkFrom(a.node, -a.dir, 9);
    const da = Math.hypot(this.px[ahead] - sx, this.pz[ahead] - sz);
    const db = Math.hypot(this.px[back] - sx, this.pz[back] - sz);
    if (db > da + 0.5) this._turnAround(a);
    // Pegado a la pared (gatos y ratas siempre; un perro, si el susto viene de la calle).
    const k = a.node;
    const side = (sx - this.px[k]) * this.inx[k] + (sz - this.pz[k]) * this.inz[k];
    a.latWant = a.kind === 'perro' ? (side < 0 ? 0.55 : -0.4) : sp.lane[1];
  }

  /** El nodo a `n` pasos de `k` por el anillo. */
  _walkFrom(k, dir, n) {
    for (let i = 0; i < n; i++) k = dir > 0 ? this.next[k] : this.prev[k];
    return k;
  }

  _turnAround(a) {
    a.dir = -a.dir;
    a.node = a.dir > 0 ? this.next[a.node] : this.prev[a.node];
    // (El nodo nuevo queda detrás: el animal gira en arco hasta encararlo.)
    a.cornerCool = Math.max(a.cornerCool, 3);
  }

  /** Vuelve a caminar, con un ritmo nuevo. */
  _walk(a) {
    const r = this.rng;
    const sp = SPECIES[a.kind];
    a.mode = 'walk';
    a.act = '';
    a.pace = a.kind === 'perro' && r.chance(0.18) ? r.range(sp.trot[0], sp.trot[1]) : r.range(sp.walk[0], sp.walk[1]);
    a.eventT = r.range(sp.stopEvery[0], sp.stopEvery[1]);
    if (a.kind !== 'perro' || r.chance(0.3)) a.latWant = r.range(sp.lane[0], sp.lane[1]);
    // Las ratas no se alejan de su basura.
    if (a.kind === 'rata' && Math.hypot(a.x - this.px[a.home], a.z - this.pz[a.home]) > RAT_HOME) {
      const ahead = this._walkFrom(a.node, a.dir, 2);
      if (Math.hypot(this.px[ahead] - this.px[a.home], this.pz[ahead] - this.pz[a.home]) > Math.hypot(a.x - this.px[a.home], a.z - this.pz[a.home])) this._turnAround(a);
    }
  }

  /** Caminando, de vez en cuando: se para a olfatear o a mirar, se echa, da media vuelta o cambia el ritmo. */
  _idle(a) {
    const r = this.rng;
    const sp = SPECIES[a.kind];
    if (a.kind === 'rata') {
      // Corre a saltos cortos y para (a olfatear con la nariz arriba).
      a.mode = 'stop';
      a.act = 'pause';
      a.timer = r.range(sp.restTime[0], sp.restTime[1]);
      if (r.chance(0.2)) this._turnAround(a);
      return;
    }
    const q = r.next();
    if (a.kind === 'perro' && q < 0.3) {
      a.act = 'sniff';
      if (r.chance(0.5)) {
        a.timer = r.range(2, 4); // olfatea caminando despacio
        a.eventT = a.timer + r.range(sp.stopEvery[0], sp.stopEvery[1]) * 0.5;
      } else {
        a.mode = 'stop';
        a.timer = r.range(2, 5);
      }
    } else if (q < (a.kind === 'perro' ? 0.55 : 0.3)) {
      a.mode = 'stop';
      a.act = 'look';
      a.timer = r.range(1.5, 4);
    } else if (q < (a.kind === 'perro' ? 0.8 : 0.75)) {
      a.mode = 'rest';
      const k = r.next() * (sp.rest[0] + sp.rest[1]);
      a.rest = k < sp.rest[0] ? 1 : 2;
      a.timer = r.range(sp.restTime[0], sp.restTime[1]);
    } else if (q < 0.9) {
      this._turnAround(a);
      a.eventT = r.range(sp.stopEvery[0], sp.stopEvery[1]);
    } else this._walk(a);
  }

  /** Termina una parada: en la esquina decide si cruza, se devuelve o sigue. */
  _resume(a) {
    const r = this.rng;
    if (a.act === 'corner') {
      const links = this.cross[a.node];
      if (a.kind === 'perro' && links && a.crossCool <= 0 && r.chance(CROSS_CHANCE)) {
        const to = links[Math.floor(r.next() * links.length) % links.length];
        if (this._clear(a.node, to)) {
          a.mode = 'cross';
          a.act = '';
          a.crossTo = to;
          a.crossT = 0;
          a.hurry = false;
          a.onRoad = true;
          return;
        }
      }
      if (r.chance(a.kind === 'gato' ? 0.4 : TURN_BACK_AT_CORNER)) this._turnAround(a);
    } else if (a.act === 'look' && a.kind === 'gato' && r.chance(0.5)) {
      // El gato, después del susto o de mirar, se sienta otro rato.
      a.mode = 'rest';
      a.rest = 1;
      a.timer = r.range(6, 18);
      return;
    } else if (r.chance(0.15)) this._turnAround(a);
    this._walk(a);
  }

  /** ¿Se puede cruzar de `k` a `to`? Ningún carro cerca del trayecto (ni uno rápido que venga). */
  _clear(k, to) {
    const ax = this.px[k];
    const az = this.pz[k];
    const bx = this.px[to];
    const bz = this.pz[to];
    const ex = bx - ax;
    const ez = bz - az;
    const l2 = ex * ex + ez * ez || 1;
    for (const v of this.vehicles) {
      const t = clamp(((v.x - ax) * ex + (v.z - az) * ez) / l2, 0, 1);
      const d = Math.hypot(v.x - (ax + ex * t), v.z - (az + ez * t));
      if (d < CROSS_CAR_CLEAR + Math.max(0, v.speed) * 1.5) return false;
    }
    return true;
  }

  /** Llegó a un nodo nuevo del andén: en las esquinas se para (a veces). */
  _arrive(a) {
    const k = a.node;
    if (a.kind === 'rata') {
      // Las ratas no doblan la esquina ni se alejan de su basura: se devuelven.
      if (this.corner[k] || Math.hypot(this.px[k] - this.px[a.home], this.pz[k] - this.pz[a.home]) > RAT_HOME) this._turnAround(a);
      return;
    }
    if (this.corner[k] && a.cornerCool <= 0 && a.mode === 'walk') {
      a.mode = 'stop';
      a.act = 'corner';
      a.timer = this.rng.range(1, 3);
      a.cornerCool = 10;
    }
  }

  /** Hacia dónde ir: el próximo punto del andén (o el otro lado del cruce); velocidad y giro limitados. */
  _steer(a, dt) {
    const sp = SPECIES[a.kind];
    let tx;
    let tz;
    if (a.mode === 'cross') {
      tx = this.px[a.crossTo];
      tz = this.pz[a.crossTo];
      if (Math.hypot(tx - a.x, tz - a.z) < 0.9) this._endCross(a);
    } else {
      if (a.detourT <= 0 && a.mode !== 'flee' && Math.abs(a.latWant) > 5) a.latWant = SPECIES[a.kind].lane[1];
      a.lat += clamp(a.latWant - a.lat, -0.6 * dt, 0.6 * dt);
      const moving = a.mode === 'walk' || a.mode === 'flee';
      for (let guard = 0; guard < 3; guard++) {
        const k = a.node;
        const lk = Math.max(a.lat, -this.out[k]); // sin pisar la calzada donde el andén es angosto
        tx = this.px[k] + this.inx[k] * lk;
        tz = this.pz[k] + this.inz[k] * lk;
        if (!moving) break;
        const kp = a.dir > 0 ? this.prev[k] : this.next[k];
        const along = (tx - a.x) * (this.px[k] - this.px[kp]) + (tz - a.z) * (this.pz[k] - this.pz[kp]);
        if ((tx - a.x) ** 2 + (tz - a.z) ** 2 > ADVANCE * ADVANCE && along > 0) break;
        a.node = a.dir > 0 ? this.next[k] : this.prev[k];
        this._arrive(a);
        if (a.mode !== 'walk' && a.mode !== 'flee') break;
      }
    }
    // Rumbo: gira hacia el punto con velocidad angular limitada (y suave).
    let err = 0;
    if (a.vWant > 0) {
      const dx = tx - a.x;
      const dz = tz - a.z;
      if (dx * dx + dz * dz > 0.0025) err = wrap(Math.atan2(dx, dz) - a.yaw);
    }
    const wMax = sp.turn[0] + (sp.turn[1] - sp.turn[0]) * Math.min(1, a.speed / sp.run);
    const wWant = clamp(err * 3, -wMax, wMax);
    a.w += clamp(wWant - a.w, -sp.turnAcc * dt, sp.turnAcc * dt);
    a.yaw = wrap(a.yaw + a.w * dt);
    // Velocidad: más despacio mientras no esté encarado (así gira en arco y no derrapa).
    const f = clamp(0.5 + 0.5 * Math.cos(err), 0.06, 1) ** 1.5;
    const want = a.vWant * f;
    const acc = a.mode === 'flee' && a.intense ? sp.bolt : sp.accel; // asustado arranca más fuerte (pero no de una)
    a.speed += clamp(want - a.speed, -sp.brake * dt, acc * dt);
    if (a.speed < 1e-4 && want <= 0) a.speed = 0;
  }

  _endCross(a) {
    const r = this.rng;
    const k = a.crossTo;
    a.node = k;
    // Sigue por el andén nuevo hacia donde ya iba encarado.
    const hx = Math.sin(a.yaw);
    const hz = Math.cos(a.yaw);
    const nx = this.px[this.next[k]] - this.px[k];
    const nz = this.pz[this.next[k]] - this.pz[k];
    a.dir = nx * hx + nz * hz >= 0 ? 1 : -1;
    a.node = a.dir > 0 ? this.next[k] : this.prev[k];
    a.lat = 0;
    a.latWant = r.range(SPECIES[a.kind].lane[0], SPECIES[a.kind].lane[1]);
    a.onRoad = false;
    a.hurry = false;
    a.crossTo = -1;
    a.crossCool = CROSS_COOLDOWN;
    a.cornerCool = 8;
    a.mode = 'walk';
    a.act = '';
    a.eventT = r.range(2, 6);
  }

  /** Avanza sin meterse en paredes ni cosas; nunca se sale del andén (salvo cruzando). Devuelve lo que se movió. */
  _move(a, dt) {
    const sp = SPECIES[a.kind];
    if (a.speed <= 0) return 0;
    const sx = Math.sin(a.yaw);
    const sz = Math.cos(a.yaw);
    // Algo adelante (una silla, un poste, un árbol): lo rodea por el otro lado del andén.
    if (a.mode !== 'cross' && a.detourT <= 0 && this.blocked(a.x + sx * 0.8 * a.scale, a.z + sz * 0.8 * a.scale)) {
      a.detourT = 2.5;
      a.latWant = a.lat > 0.15 ? -0.35 : sp.lane[1];
    }
    const step = a.speed * dt;
    const nx = a.x + sx * step;
    const nz = a.z + sz * step;
    if (this.blocked(nx, nz)) {
      // Se frena (sin parar en seco) y, si sigue trancado, da media vuelta.
      a.speed = Math.max(0, a.speed - sp.brake * dt);
      a.stuck += dt;
      if (a.stuck > 0.8 && a.mode !== 'cross') {
        a.stuck = 0;
        this._turnAround(a);
      }
      return 0;
    }
    a.stuck = 0;
    const ox = a.x;
    const oz = a.z;
    a.x = nx;
    a.z = nz;
    if (a.mode !== 'cross') this._keepOnSidewalk(a);
    const gy = this.groundHeight(a.x, a.z);
    a.y += (gy - a.y) * Math.min(1, dt * 14); // baja y sube el sardinel sin saltos
    return Math.hypot(a.x - ox, a.z - oz);
  }

  /**
   * Si se fue más allá del borde del andén (hacia la calle o las casas), vuelve
   * al borde: se mide la distancia de verdad al anillo (tramos de atrás y el de
   * adelante), así en las esquinas tampoco se sale.
   */
  _keepOnSidewalk(a) {
    const k = a.node;
    const kp = a.dir > 0 ? this.prev[k] : this.next[k];
    const kpp = a.dir > 0 ? this.prev[kp] : this.next[kp];
    const kn = a.dir > 0 ? this.next[k] : this.prev[k];
    let best = Infinity;
    let cx = 0;
    let cz = 0;
    let nx = 0;
    let nz = 0;
    let out = STREET_EDGE;
    for (let s = 0; s < 3; s++) {
      const i = s === 0 ? kp : s === 1 ? kpp : k;
      const j = s === 0 ? k : s === 1 ? kp : kn;
      const ex = this.px[j] - this.px[i];
      const ez = this.pz[j] - this.pz[i];
      const t = clamp(((a.x - this.px[i]) * ex + (a.z - this.pz[i]) * ez) / (ex * ex + ez * ez || 1), 0, 1);
      const qx = this.px[i] + ex * t;
      const qz = this.pz[i] + ez * t;
      const d = (a.x - qx) ** 2 + (a.z - qz) ** 2;
      if (d < best) {
        best = d;
        cx = qx;
        cz = qz;
        nx = this.inx[i] + (this.inx[j] - this.inx[i]) * t;
        nz = this.inz[i] + (this.inz[j] - this.inz[i]) * t;
        out = Math.min(this.out[i], this.out[j]);
      }
    }
    // De qué lado quedó (la normal sirve solo para eso) y, si pasó del borde, se acerca al anillo.
    const dx = a.x - cx;
    const dz = a.z - cz;
    const d = Math.sqrt(best);
    const lim = dx * nx + dz * nz >= 0 ? WALL_EDGE : out;
    if (d > lim) {
      a.x = cx + (dx * lim) / d;
      a.z = cz + (dz * lim) / d;
    }
  }

  /** Lo que se ve: fase y amplitud del paso según la velocidad real, andar, cabeza, agazapado y cola. */
  _animate(a, dt, moved, player, pd) {
    const sp = SPECIES[a.kind];
    const r = this.rng;
    const v = moved / dt;
    a.vel = v;
    const mid = (sp.walk[0] + sp.walk[1]) / 2;
    const stride = (sp.stride[0] + (sp.stride[1] - sp.stride[0]) * clamp((v - mid) / (sp.run - mid), 0, 1)) * a.scale;
    a.phase = (a.phase + (TAU * moved) / stride) % TAU;
    a.gait = smooth(sp.gaitAt[0] - 0.2, sp.gaitAt[0] + 0.2, v) + smooth(sp.gaitAt[1] - 0.4, sp.gaitAt[1] + 0.4, v);
    // Amplitud que casa con la zancada (el pie de apoyo no patina): 4·pata·sen(A) = zancada.
    const amp = Math.min(sp.ampMax, Math.asin(Math.min(0.98, stride / (4 * sp.leg * a.scale)))) * smooth(0, 0.3 * sp.walk[0], v);
    a.amp += (amp - a.amp) * Math.min(1, dt * 12);
    // Cabeza: al jugador si está cerca, a lo que sonó, al piso si olfatea, o mirando alrededor.
    let hy = 0;
    let hp = 0;
    const still = a.mode === 'stop' || a.mode === 'rest';
    if (player && !player.dead && pd < sp.look && a.mode !== 'flee') {
      hy = wrap(Math.atan2(player.x - a.x, player.z - a.z) - a.yaw);
      hp = -0.12;
    } else if (a.threatT > 0 && a.mode !== 'flee') {
      hy = wrap(Math.atan2(a.threatX - a.x, a.threatZ - a.z) - a.yaw);
      hp = -0.08;
    } else if (a.act === 'sniff') {
      hp = sp.sniff;
      hy = a.lookYaw * 0.3;
    } else if (a.act === 'pause') hp = sp.sniff;
    else if (still || a.act === 'corner') hy = a.lookYaw;
    else hy = a.lookYaw * 0.25;
    a.lookT -= dt;
    if (a.lookT <= 0) {
      a.lookT = r.range(0.8, 2.6);
      a.lookYaw = r.chance(0.35) ? 0 : r.range(-1.1, 1.1);
    }
    hy = clamp(hy, -HEAD_YAW_MAX, HEAD_YAW_MAX);
    a.headYaw += clamp(hy - a.headYaw, -3.5 * dt, 3.5 * dt);
    a.headPitch += clamp(hp - a.headPitch, -2.5 * dt, 2.5 * dt);
    // Agazapado: el gato pegado a la pared o huyendo; la rata siempre algo; el perro al olfatear.
    let c = 0;
    if (a.kind === 'gato') c = a.mode === 'flee' ? 0.32 : a.mode === 'walk' ? 0.12 : 0;
    else if (a.kind === 'rata') c = v > 0.3 ? 0.18 : 0.08;
    else if (a.act === 'sniff') c = 0.06;
    a.crouch += clamp(c - a.crouch, -dt, dt);
    // Cola: el perro la menea (más si el jugador está cerca y no lo asusta), quieta huyendo.
    let wag = 0.05;
    if (a.kind === 'perro') wag = a.mode === 'flee' ? 0 : pd < 6 ? 0.85 : v > 0.2 ? 0.4 : 0.15;
    else if (a.kind === 'rata') wag = 0.1;
    a.wag += clamp(wag - a.wag, -dt, dt);
  }

  /** Cuántos hay de cada uno. */
  counts() {
    const out = { perro: 0, gato: 0, rata: 0 };
    for (const a of this.list) out[a.kind]++;
    return out;
  }
}
