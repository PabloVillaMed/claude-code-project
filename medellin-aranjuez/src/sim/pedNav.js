// Rutas para peatones (puro, sin three.js): un grafo peatonal de toda la
// ciudad y búsquedas sobre él, para que la gente a pie no se meta contra las
// paredes: la policía que se baja de la patrulla a buscarte, los que huyen de
// un tiro y los que van a alguna parte (la tienda, el paradero, la casa).
//
// El grafo (buildPedGraph):
//  - el andén de cada manzana residencial como un anillo: el centro del andén
//    (b.ring, a GRID.ring del sardinel) muestreado cada RING_STEP m; cada nodo
//    con anterior y siguiente, la normal hacia las casas, hasta dónde sigue
//    siendo andén hacia la calle y si es esquina. Los animales
//    (sim/animals.js) andan sobre este mismo anillo: es un solo grafo;
//  - cruces de calle en las esquinas: hacia la manzana de enfrente siguiendo
//    la línea del andén (los de los perros son los cortos) y los de
//    cityLayout (block.cross), si lo del medio es calzada o separador;
//  - senderos, peatonales y escalas de OpenStreetMap (city.foot), por tramos
//    que no atraviesan nada, unidos al andén más cercano;
//  - parques y plazas (city.areas de PARK_KINDS): una grilla de nodos dentro
//    del polígono, unida al andén de alrededor.
// Los nodos van en arreglos tipados: primero los del anillo (0..ringCount-1,
// con prev/next implícitos), después los de senderos y parques; las demás
// aristas (cruces, senderos, parques, uniones) en formato CSR (eStart, eTo,
// eCost, eFlag). Una grilla de nodos (NodeGrid, también CSR) responde "los
// de cerca" sin recorrer los miles, y una lista de destinos (puertas de
// tiendas y casas, paraderos) con su nodo.
//
// PedNav busca sobre el grafo: A* con un montículo binario y arreglos
// reutilizados (marcas por búsqueda en vez de limpiar: nada grande se crea al
// buscar), el nodo más cercano por la grilla (con línea libre hasta él),
// suavizado de la ruta (saltarse nodos cuando la línea entre dos puntos no
// toca paredes ni obstáculos), caché de rutas recientes y un presupuesto de
// búsquedas por cuadro: las que no caben devuelven NAV_WAIT y se piden otra
// vez en el siguiente. flee() busca la ruta que más aleja de una amenaza sin
// pasarle por al lado. Las rutas se escriben en objetos de createRoute() (uno
// por peatón, reutilizado); sim/pedAI.js las sigue.

import { pointInPoly, polyArea } from './geom2d.js';
import { yawFromDir } from './math.js';
import { GRID, onRoad } from './terrain.js';

// ------------------------------------------------------------------ constantes configurables
// Grafo
export const RING_STEP = 3; // separación de los nodos del andén (m); los animales andan sobre estos mismos nodos
export const CORNER_TURN = 0.6; // lo que gira el andén (rad, en ±3,5 m) para contar como esquina
export const RING_STREET_EDGE = GRID.ring - 0.2; // del centro del andén hacia la calle, lo más que sigue siendo andén (m)
export const CROSS_MAX = 22; // cruce de calle más largo para un peatón (m; las avenidas con separador miden ~20)
export const CROSS_MIN = 4; // ni más corto que esto (m: serían dos nodos de la misma esquina)
export const CROSS_ALIGN = 0.9; // coseno mínimo entre el cruce y la línea del andén que se prolonga
export const CROSS_SNAP = 2; // un cruce de cityLayout (vértice del anillo) se pega al nodo a menos de esto (m)
export const FOOT_STEP = 5; // separación de los nodos de senderos y escalas (m)
export const FOOT_LINK = 6; // un nodo de sendero se une al andén más cercano a menos de esto (m)
export const FOOT_JOIN = 1.5; // dos senderos se unen donde sus nodos quedan a menos de esto (m)
export const PARK_KINDS = ['parque', 'verde']; // zonas de city.areas que se atraviesan a pie
export const PARK_STEP = 6; // grilla de nodos dentro de parques y plazas (m)
export const PARK_LINK = 8; // el borde del parque se une al andén a menos de esto (m)
export const CROSS_COST = 1.3; // cruzar la calle "cuesta" más que seguir por el andén (factor del largo)
export const STEPS_COST = 1.5; // subir o bajar escalas también (factor del largo)
export const RING_WALL_COST = 25; // un tramo del andén que una casa real se come (pocos) cuesta esto por metro
export const NAV_CELL = 30; // celda de la grilla de nodos (m; la comparten los animales)
export const NAV_MIN_COMPONENT = 25; // pedazos sueltos del grafo con menos nodos que esto no sirven de inicio ni de llegada
// Destinos
export const DEST_DOOR = 0.7; // la puerta: a esto de la fachada, hacia la calle (m)
export const DEST_LINK = 10; // un destino necesita un nodo del grafo a menos de esto (m), con línea libre
export const DEST_HOUSE_EVERY = 3; // de las casas, una de cada tantas sirve de destino (memoria y carga)
export const DEST_CELL = 50; // celda de la grilla de destinos (m)
// Búsquedas
export const NAV_SEARCHES_PER_FRAME = 4; // búsquedas (A* o huida) por cuadro; las demás esperan al siguiente (NAV_WAIT)
export const NAV_FRAME_MS = 1.5; // en el juego, si las de este cuadro ya tardaron esto (ms), las demás también esperan (las pruebas no lo usan: depende de la máquina)
export const NAV_MAX_EXPAND = 6000; // nodos que abre una búsqueda como mucho; si no llega, ruta parcial hacia lo más cercano
export const NAV_CLEAR_RADIUS = 0.3; // radio con que se prueba la línea libre (m; el peatón mide 0,35)
export const NAV_CLEAR_CHUNK = 6; // la línea libre se consulta a la rejilla de colisiones por tramos de esto (m)
export const NEAREST_MAX = 30; // radio de búsqueda del nodo más cercano (m)
export const NEAREST_FAR = 90; // si no hay ninguno, se busca hasta esto (m)
export const NEAREST_TRIES = 4; // de los más cercanos, cuántos se prueban con línea libre
export const SMOOTH_MAX_SKIP = 45; // el suavizado no une dos puntos más lejanos que esto (m)
export const SMOOTH_TOL = 0.25; // nodos casi en línea recta (a menos de esto de la recta, m) se quitan antes de suavizar
export const ROUTE_MAX_PTS = 48; // puntos de una ruta (si salen más queda parcial y se pide el resto al llegar)
export const NAV_CACHE_SIZE = 32; // rutas recientes guardadas (inicio, llegada → nodos)
export const NAV_CACHE_NODES = 768; // nodos por ruta guardada como mucho (las más largas no se guardan)
export const NAV_CACHE_TTL = 20; // s que vale una ruta guardada
// Huida
export const FLEE_SEARCH = 85; // m de camino que explora una huida
export const FLEE_MAX_EXPAND = 2500; // nodos que abre como mucho
export const FLEE_NEAR_RADIUS = 25; // pasar a menos de esto de la amenaza (m) sale caro...
export const FLEE_NEAR_PENALTY = 4; // ...hasta este factor extra del costo, pegado a la amenaza
export const FLEE_PATH_WEIGHT = 0.3; // puntaje de un nodo = distancia a la amenaza − esto × camino hasta él
export const FLEE_MIN_GAIN = 8; // si ningún nodo queda al menos esto más lejos de la amenaza (m), no hay huida por el grafo

/** Banderas de las aristas extra (eFlag). */
export const EDGE = { cross: 1, line: 2, road: 4, foot: 8, steps: 16, park: 32, link: 64 };
/** Tipos de nodo (kind). */
export const NODE_RING = 0;
export const NODE_FOOT = 1;
export const NODE_PARK = 2;
/** Estado de una ruta / resultado de una búsqueda. */
export const NAV_NONE = 0;
export const NAV_OK = 1;
export const NAV_WAIT = 2;
export const NAV_FAIL = 3;
export const DEST_KINDS = ['tienda', 'paradero', 'casa'];

const now = () => globalThis.performance?.now?.() ?? Date.now();
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

// ------------------------------------------------------------------ línea libre
/**
 * ¿El tramo t0..t1 del segmento (a + d·t) toca la caja (inflada en r)? Caja de
 * CollisionWorld: alineada (minX..maxZ) o girada (obb, ejes de obbAxes).
 */
function segHitsBox(b, ax, az, dx, dz, t0, t1, r) {
  let ox;
  let oz;
  let ux;
  let uz;
  let hx;
  let hz;
  if (b.obb) {
    const o = b.obb;
    const c = Math.cos(o.angle);
    const s = Math.sin(o.angle);
    const px = ax - o.x;
    const pz = az - o.z;
    // Ejes de collision.js: derecha (c, −s), adelante (−s, −c).
    ox = px * c - pz * s;
    oz = -px * s - pz * c;
    ux = dx * c - dz * s;
    uz = -dx * s - dz * c;
    hx = o.hx + r;
    hz = o.hz + r;
  } else {
    ox = ax - (b.minX + b.maxX) * 0.5;
    oz = az - (b.minZ + b.maxZ) * 0.5;
    ux = dx;
    uz = dz;
    hx = (b.maxX - b.minX) * 0.5 + r;
    hz = (b.maxZ - b.minZ) * 0.5 + r;
  }
  let lo = t0;
  let hi = t1;
  if (Math.abs(ux) < 1e-9) {
    if (ox <= -hx || ox >= hx) return false;
  } else {
    let ta = (-hx - ox) / ux;
    let tb = (hx - ox) / ux;
    if (ta > tb) [ta, tb] = [tb, ta];
    if (ta > lo) lo = ta;
    if (tb < hi) hi = tb;
    if (lo >= hi) return false;
  }
  if (Math.abs(uz) < 1e-9) {
    if (oz <= -hz || oz >= hz) return false;
  } else {
    let ta = (-hz - oz) / uz;
    let tb = (hz - oz) / uz;
    if (ta > tb) [ta, tb] = [tb, ta];
    if (ta > lo) lo = ta;
    if (tb < hi) hi = tb;
    if (lo >= hi) return false;
  }
  return true;
}

/**
 * ¿Un peatón de radio r pasa en línea recta de a a b sin tocar ninguna caja
 * de la rejilla de colisiones? Consulta la rejilla por tramos cortos (una
 * caja de consulta enorme traería cientos de casas). `boxes`: arreglo de
 * trabajo reutilizado.
 */
export function segmentClear(col, ax, az, bx, bz, r = NAV_CLEAR_RADIUS, boxes = []) {
  if (!col) return true;
  const dx = bx - ax;
  const dz = bz - az;
  const L = Math.hypot(dx, dz);
  const chunks = Math.max(1, Math.ceil(L / NAV_CLEAR_CHUNK));
  for (let c = 0; c < chunks; c++) {
    const t0 = c / chunks;
    const t1 = (c + 1) / chunks;
    const x0 = ax + dx * t0;
    const z0 = az + dz * t0;
    const x1 = ax + dx * t1;
    const z1 = az + dz * t1;
    col.query(Math.min(x0, x1) - r, Math.min(z0, z1) - r, Math.max(x0, x1) + r, Math.max(z0, z1) + r, boxes);
    for (let i = 0; i < boxes.length; i++) if (segHitsBox(boxes[i], ax, az, dx, dz, t0, t1, r)) return false;
  }
  return true;
}

// ------------------------------------------------------------------ anillo del andén
/** Remuestrea un anillo cerrado: conserva los vértices donde gira de verdad y parte los tramos rectos cada `step`. */
function resampleRing(ring, step) {
  const pts = [];
  for (const [x, z] of ring) {
    const l = pts[pts.length - 1];
    if (!l || Math.hypot(x - l[0], z - l[1]) > 0.05) pts.push([x, z]);
  }
  if (pts.length > 2 && Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]) < 0.05) pts.pop();
  const n = pts.length;
  if (n < 3) return [];
  const out = [];
  let since = step; // así el primer vértice siempre queda
  for (let i = 0; i < n; i++) {
    const [ax, az] = pts[i];
    const [bx, bz] = pts[(i + 1) % n];
    const [px, pz] = pts[(i - 1 + n) % n];
    const turn = Math.abs(wrap(Math.atan2(bx - ax, bz - az) - Math.atan2(ax - px, az - pz)));
    if (since >= step || (turn > 0.3 && since > 0.7)) {
      out.push([ax, az]);
      since = 0;
    } else if (turn > 0.3 && out.length) {
      out[out.length - 1] = [ax, az]; // un vértice que gira manda sobre un punto de relleno muy cercano
      since = 0;
    }
    const L = Math.hypot(bx - ax, bz - az);
    let pos = 0;
    while (since + (L - pos) >= step) {
      const np = pos + step - since;
      if (L - np < 0.7) break; // muy cerca del próximo vértice: que quede el vértice
      pos = np;
      out.push([ax + ((bx - ax) * pos) / L, az + ((bz - az) * pos) / L]);
      since = 0;
    }
    since += L - pos;
  }
  if (out.length > 3 && Math.hypot(out[0][0] - out[out.length - 1][0], out[0][1] - out[out.length - 1][1]) < step * 0.35) out.pop();
  return out;
}

/** El nodo a ~`dist` m de `i` siguiendo el anillo en el sentido `dir`. */
function ringWalk(nodes, i, dir, dist) {
  let k = i;
  let acc = 0;
  for (let guard = 0; guard < 12 && acc < dist; guard++) {
    const j = dir > 0 ? nodes[k].next : nodes[k].prev;
    acc += Math.hypot(nodes[j].x - nodes[k].x, nodes[j].z - nodes[k].z);
    k = j;
  }
  return k;
}

/**
 * Grilla de manzanas (cajas) para saber rápido si un punto cae dentro de
 * alguna: devuelve 2 si cae en una manzana "sólida" (con casas), 1 si solo
 * en un separador (se puede pisar al cruzar) y 0 si en ninguna (calzada).
 */
export function blockTester(city) {
  const C = 50;
  const cells = new Map();
  const items = city.blocks
    .filter((b) => b.curb)
    .map((b) => {
      let minX = Infinity;
      let maxX = -Infinity;
      let minZ = Infinity;
      let maxZ = -Infinity;
      for (const [x, z] of b.curb) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (z < minZ) minZ = z;
        if (z > maxZ) maxZ = z;
      }
      return { poly: b.curb, solid: b.type !== 'separador', minX, maxX, minZ, maxZ };
    });
  for (const it of items) {
    for (let i = Math.floor(it.minX / C); i <= Math.floor(it.maxX / C); i++) {
      for (let j = Math.floor(it.minZ / C); j <= Math.floor(it.maxZ / C); j++) {
        const k = i * 100003 + j;
        let c = cells.get(k);
        if (!c) cells.set(k, (c = []));
        c.push(it);
      }
    }
  }
  return (x, z) => {
    let r = 0;
    for (const it of cells.get(Math.floor(x / C) * 100003 + Math.floor(z / C)) ?? []) {
      if (!(x > it.minX && x < it.maxX && z > it.minZ && z < it.maxZ && pointInPoly(x, z, it.poly))) continue;
      if (it.solid) return 2;
      r = 1;
    }
    return r;
  };
}

const CROSS_SAMPLES = [0.25, 0.4, 0.5, 0.6, 0.75];
// Los pasos de 0,1 m del sardinel hacia afuera (sumados igual que siempre: 0.30000000000000004…).
const OUT_STEPS = [];
for (let d = 0.1; d <= RING_STREET_EDGE + 1e-6; d += 0.1) OUT_STEPS.push(d);

/** Como crossingKind, pero lo que pisa calzada ya cuenta como calzada (solo se prueban polígonos fuera de ella). */
function crossingKindFast(inBlock, ax, az, bx, bz) {
  let k = 0;
  for (const t of CROSS_SAMPLES) {
    const x = ax + (bx - ax) * t;
    const z = az + (bz - az) * t;
    if (!onRoad(x, z)) k = Math.max(k, inBlock(x, z));
  }
  return k;
}

/** Lo que hay entre dos puntos de un cruce: 0 calzada, 1 pisa un separador, 2 atraviesa una manzana. */
function crossingKind(inBlock, ax, az, bx, bz) {
  let k = 0;
  for (const t of CROSS_SAMPLES) k = Math.max(k, inBlock(ax + (bx - ax) * t, az + (bz - az) * t));
  return k;
}

/**
 * El anillo del andén: nodos cada ~`step` m del anillo peatonal (b.ring) de
 * cada manzana residencial. Cada nodo: {x, z, prev, next (índices), nx, nz
 * (normal hacia las casas), out (hasta dónde hacia la calle sigue siendo
 * andén), block, corner (1 si es esquina), links (null o cruces [{j, d,
 * road}] hacia nodos de otra manzana: road = todo calzada, sin separador)}.
 */
export function sidewalkRing(city, step = RING_STEP, inBlock = blockTester(city)) {
  const nodes = [];
  for (const b of city.blocks) {
    if (b.type !== 'residencial' || !b.ring) continue;
    const pts = resampleRing(b.ring, step);
    const n = pts.length;
    if (n < 4) continue;
    const s = polyArea(b.ring) > 0 ? 1 : -1;
    const n0 = nodes.length;
    for (let i = 0; i < n; i++) nodes.push({ x: pts[i][0], z: pts[i][1], prev: n0 + ((i - 1 + n) % n), next: n0 + ((i + 1) % n), nx: 0, nz: 0, out: RING_STREET_EDGE, block: b.id, corner: 0, links: null });
    for (let i = n0; i < n0 + n; i++) {
      const a = nodes[i];
      const p = nodes[a.prev];
      const q = nodes[a.next];
      // Normal hacia adentro (casas): la de los dos tramos que llegan al nodo, promediada.
      let ix = 0;
      let iz = 0;
      for (const [u, v] of [[p, a], [a, q]]) {
        const l = Math.hypot(v.x - u.x, v.z - u.z) || 1;
        ix += (-(v.z - u.z) / l) * s;
        iz += ((v.x - u.x) / l) * s;
      }
      const l = Math.hypot(ix, iz) || 1;
      a.nx = ix / l;
      a.nz = iz / l;
      // Hasta dónde hacia la calle sigue siendo andén (donde la vía es más ancha,
      // la calzada se come el borde): el primer paso de 0,1 m que pisa calzada.
      // Se prueba de a cinco pasos y se afina en el tramo donde aparece (la
      // calzada no tiene islas de menos de medio metro): ~5 consultas en vez de 20.
      for (let c = 4; c < OUT_STEPS.length + 4; c += 5) {
        const k = Math.min(c, OUT_STEPS.length - 1);
        if (!onRoad(a.x - a.nx * OUT_STEPS[k], a.z - a.nz * OUT_STEPS[k])) continue;
        let first = k;
        for (let f = c - 4; f < k; f++) {
          if (!onRoad(a.x - a.nx * OUT_STEPS[f], a.z - a.nz * OUT_STEPS[f])) continue;
          first = f;
          break;
        }
        a.out = Math.max(0, OUT_STEPS[first] - 0.15);
        break;
      }
    }
    // (El giro de cada nodo va aparte: borrar una propiedad deja los objetos lentos.)
    const turn = new Float64Array(n);
    // Esquinas: donde el andén gira más de CORNER_TURN en ±3,5 m (y es el máximo de su vecindad).
    for (let i = n0; i < n0 + n; i++) {
      const a = nodes[i];
      const p = nodes[ringWalk(nodes, i, -1, 3.5)];
      const q = nodes[ringWalk(nodes, i, 1, 3.5)];
      turn[i - n0] = Math.abs(wrap(Math.atan2(q.x - a.x, q.z - a.z) - Math.atan2(a.x - p.x, a.z - p.z)));
    }
    for (let i = n0; i < n0 + n; i++) {
      const a = nodes[i];
      if (turn[i - n0] < CORNER_TURN) continue;
      let best = true;
      for (const dir of [-1, 1]) {
        let k = i;
        for (let j = 0; j < 3 && best; j++) {
          k = dir > 0 ? nodes[k].next : nodes[k].prev;
          if (Math.hypot(nodes[k].x - a.x, nodes[k].z - a.z) > 4) break;
          if (turn[k - n0] > turn[i - n0] || (turn[k - n0] === turn[i - n0] && k < i)) best = false;
        }
      }
      if (best) a.corner = 1;
    }
  }
  linkCrossings(nodes, inBlock);
  return nodes;
}

/**
 * Cruces: desde cada esquina, siguiendo la línea de cada uno de los dos
 * andenes que llegan a ella, el nodo de otra manzana más cercano a menos de
 * CROSS_MAX m, si lo del medio no atraviesa ninguna manzana (puede pisar un
 * separador: entonces road = false).
 */
function linkCrossings(nodes, inBlock) {
  const C = 20;
  const grid = new Map();
  nodes.forEach((a, i) => {
    const k = Math.floor(a.x / C) * 100003 + Math.floor(a.z / C);
    let c = grid.get(k);
    if (!c) grid.set(k, (c = []));
    c.push(i);
  });
  for (let i = 0; i < nodes.length; i++) {
    const a = nodes[i];
    if (!a.corner) continue;
    const p = nodes[ringWalk(nodes, i, -1, 3)];
    const q = nodes[ringWalk(nodes, i, 1, 3)];
    const links = [];
    // Las dos líneas del andén que se prolongan más allá de la esquina.
    for (const [ux, uz] of [[a.x - p.x, a.z - p.z], [a.x - q.x, a.z - q.z]]) {
      const l = Math.hypot(ux, uz) || 1;
      const dx = ux / l;
      const dz = uz / l;
      let best = -1;
      let bestD = CROSS_MAX;
      for (let ci = Math.floor((a.x - CROSS_MAX) / C); ci <= Math.floor((a.x + CROSS_MAX) / C); ci++) {
        for (let cj = Math.floor((a.z - CROSS_MAX) / C); cj <= Math.floor((a.z + CROSS_MAX) / C); cj++) {
          for (const j of grid.get(ci * 100003 + cj) ?? []) {
            const b = nodes[j];
            if (b.block === a.block) continue;
            const ex = b.x - a.x;
            const ez = b.z - a.z;
            const d = Math.hypot(ex, ez);
            if (d < CROSS_MIN || d >= bestD || (ex * dx + ez * dz) / d < CROSS_ALIGN) continue;
            best = j;
            bestD = d;
          }
        }
      }
      if (best < 0) continue;
      const b = nodes[best];
      const kind = crossingKind(inBlock, a.x, a.z, b.x, b.z);
      if (kind < 2 && !links.some((o) => o.j === best)) links.push({ j: best, d: bestD, road: kind === 0 });
    }
    if (links.length) a.links = links;
  }
}

// ------------------------------------------------------------------ grillas
/** Índice en grilla (CSR) de nodos por número: "los de cerca" sin recorrer los miles. */
export class NodeGrid {
  constructor(xs, zs, n, cell = NAV_CELL) {
    this.cell = cell;
    this.n = n;
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (let i = 0; i < n; i++) {
      if (xs[i] < minX) minX = xs[i];
      if (xs[i] > maxX) maxX = xs[i];
      if (zs[i] < minZ) minZ = zs[i];
      if (zs[i] > maxZ) maxZ = zs[i];
    }
    if (!n) minX = maxX = minZ = maxZ = 0;
    this.i0 = Math.floor(minX / cell);
    this.j0 = Math.floor(minZ / cell);
    this.W = Math.floor(maxX / cell) - this.i0 + 1;
    this.H = Math.floor(maxZ / cell) - this.j0 + 1;
    const start = new Int32Array(this.W * this.H + 1);
    const cellOf = new Int32Array(n);
    for (let i = 0; i < n; i++) {
      const k = (Math.floor(xs[i] / cell) - this.i0) * this.H + (Math.floor(zs[i] / cell) - this.j0);
      cellOf[i] = k;
      start[k + 1]++;
    }
    for (let k = 0; k < this.W * this.H; k++) start[k + 1] += start[k];
    const fill = start.slice(0, this.W * this.H);
    const ids = new Int32Array(n);
    for (let i = 0; i < n; i++) ids[fill[cellOf[i]]++] = i; // en orden creciente dentro de cada celda
    this.start = start;
    this.ids = ids;
  }

  /** Rango de celdas que tocan el cuadrado de lado 2r alrededor de (x, z): [i0, i1, j0, j1] en `out4`. */
  _range(x, z, r, out4) {
    const c = this.cell;
    out4[0] = Math.max(0, Math.floor((x - r) / c) - this.i0);
    out4[1] = Math.min(this.W - 1, Math.floor((x + r) / c) - this.i0);
    out4[2] = Math.max(0, Math.floor((z - r) / c) - this.j0);
    out4[3] = Math.min(this.H - 1, Math.floor((z + r) / c) - this.j0);
    return out4;
  }

  /** Agrega a `out` los nodos (de número < limit) de las celdas que tocan el cuadrado de lado 2r alrededor de (x, z). */
  collect(x, z, r, out, limit = this.n) {
    const g = this._range(x, z, r, (this._r4 ??= new Int32Array(4)));
    for (let i = g[0]; i <= g[1]; i++) {
      for (let j = g[2]; j <= g[3]; j++) {
        const k = i * this.H + j;
        for (let q = this.start[k]; q < this.start[k + 1]; q++) if (this.ids[q] < limit) out.push(this.ids[q]);
      }
    }
    return out;
  }
}

/** Grilla temporal (solo al construir) de puntos por número. */
function tempGrid(cell) {
  const cells = new Map();
  return {
    add(i, x, z) {
      const k = Math.floor(x / cell) * 100003 + Math.floor(z / cell);
      let c = cells.get(k);
      if (!c) cells.set(k, (c = []));
      c.push(i);
    },
    near(x, z, r, fn) {
      for (let i = Math.floor((x - r) / cell); i <= Math.floor((x + r) / cell); i++) {
        for (let j = Math.floor((z - r) / cell); j <= Math.floor((z + r) / cell); j++) for (const k of cells.get(i * 100003 + j) ?? []) fn(k);
      }
    },
  };
}

// ------------------------------------------------------------------ grafo
const PARK_NEIGHBORS = [
  [1, 0],
  [0, 1],
  [1, 1],
  [1, -1],
];

/** ¿Un peatón (círculo de radio r) cabe parado en (x, z)? */
function spotFree(col, x, z, r, boxes) {
  return segmentClear(col, x, z, x, z, r, boxes);
}

/**
 * Construye el grafo peatonal de la ciudad (ver arriba). `opts.collision`
 * (por defecto city.collision) decide qué tramos de sendero y de parque están
 * libres. Devuelve un objeto de arreglos tipados; `stats` dice cuánto tardó y
 * cuántos nodos y aristas salieron.
 */
export function buildPedGraph(city, opts = {}) {
  const t0 = now();
  const col = opts.collision ?? city.collision ?? null;
  const boxes = [];
  const inBlock = blockTester(city);
  const ring = sidewalkRing(city, RING_STEP, inBlock);
  const tRing = now();
  const R = ring.length;

  // Nodos extra (senderos y parques) y aristas, en listas temporales.
  const exX = [];
  const exZ = [];
  const exKind = [];
  const exBlock = [];
  const posX = (i) => (i < R ? ring[i].x : exX[i - R]);
  const posZ = (i) => (i < R ? ring[i].z : exZ[i - R]);
  const addNode = (x, z, kind, block) => {
    exX.push(x);
    exZ.push(z);
    exKind.push(kind);
    exBlock.push(block);
    return R + exX.length - 1;
  };
  const edgeAt = new Map();
  const eA = [];
  const eB = [];
  const eF = [];
  const addDir = (a, b, f) => {
    const k = a * 1048576 + b;
    const i = edgeAt.get(k);
    if (i !== undefined) eF[i] |= f;
    else {
      edgeAt.set(k, eA.length);
      eA.push(a);
      eB.push(b);
      eF.push(f);
    }
  };
  const add = (a, b, f) => {
    addDir(a, b, f);
    addDir(b, a, f);
  };

  // Cruces del anillo: primero los de cada esquina en su orden (los perros
  // eligen entre ellos), después la vuelta de cada uno.
  const linked = [];
  for (let i = 0; i < R; i++) if (ring[i].links) linked.push(i);
  for (const i of linked) for (const l of ring[i].links) addDir(i, l.j, EDGE.cross | EDGE.line | (l.road ? EDGE.road : 0));
  for (const i of linked) for (const l of ring[i].links) addDir(l.j, i, EDGE.cross | (l.road ? EDGE.road : 0));

  // Cruces de cityLayout (block.cross: vértice del anillo → vértice de la vecina), pegados al nodo más cercano.
  const range = new Map();
  for (let i = 0; i < R; i++) {
    const r = range.get(ring[i].block);
    if (r) r[1] = i + 1;
    else range.set(ring[i].block, [i, i + 1]);
  }
  const snap = (bid, vi) => {
    const r = range.get(bid);
    const v = city.blocks[bid]?.ring?.[vi];
    if (!r || !v) return -1;
    let best = -1;
    let bd = CROSS_SNAP;
    for (let i = r[0]; i < r[1]; i++) {
      const d = Math.hypot(ring[i].x - v[0], ring[i].z - v[1]);
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    return best;
  };
  let cityCross = 0;
  for (const b of city.blocks) {
    if (!b.cross || !range.has(b.id)) continue;
    for (const [vi, list] of b.cross) {
      const a = snap(b.id, vi);
      if (a < 0) continue;
      for (const o of list) {
        const c = snap(o.block, o.i);
        if (c < 0 || c === a || edgeAt.has(a * 1048576 + c)) continue;
        const kind = crossingKindFast(inBlock, ring[a].x, ring[a].z, ring[c].x, ring[c].z);
        if (kind === 2) continue;
        cityCross++;
        add(a, c, EDGE.cross | (kind === 0 ? EDGE.road : 0));
      }
    }
  }

  const tCross = now();
  // Grilla temporal del anillo para unir senderos y parques al andén.
  const ringGrid = tempGrid(10);
  for (let i = 0; i < R; i++) ringGrid.add(i, ring[i].x, ring[i].z);
  // Al nodo del andén más cercano con línea libre (se prueban de cerca a lejos, hasta 4).
  const cand = [];
  const linkToRing = (id, maxD) => {
    const x = posX(id);
    const z = posZ(id);
    cand.length = 0;
    ringGrid.near(x, z, maxD, (k) => {
      const d = Math.hypot(ring[k].x - x, ring[k].z - z);
      if (d < maxD) cand.push(d, k);
    });
    let best = -1;
    for (let tries = 0; tries < 4 && best < 0; tries++) {
      let m = -1;
      for (let q = 0; q < cand.length; q += 2) if (cand[q] >= 0 && (m < 0 || cand[q] < cand[m])) m = q;
      if (m < 0) break;
      const k = cand[m + 1];
      cand[m] = -1;
      if (segmentClear(col, x, z, ring[k].x, ring[k].z, NAV_CLEAR_RADIUS, boxes)) best = k;
    }
    if (best >= 0) add(id, best, EDGE.link);
    return best;
  };

  const tFoot0 = now();
  // Senderos, peatonales y escalas de OpenStreetMap.
  const footGrid = tempGrid(5);
  const footLine = [];
  let footNodes = 0;
  (city.foot ?? []).forEach((f, li) => {
    const steps = f.kind === 'steps';
    let prev = -1;
    for (let k = 0; k + 1 < f.pts.length; k++) {
      const [ax, az] = f.pts[k];
      const [bx, bz] = f.pts[k + 1];
      const L = Math.hypot(bx - ax, bz - az);
      const m = Math.max(1, Math.ceil(L / FOOT_STEP));
      for (let s = k === 0 ? 0 : 1; s <= m; s++) {
        const x = ax + ((bx - ax) * s) / m;
        const z = az + ((bz - az) * s) / m;
        if (!spotFree(col, x, z, NAV_CLEAR_RADIUS, boxes)) {
          prev = -1; // el sendero pasa por debajo de una casa: ahí se corta
          continue;
        }
        const id = addNode(x, z, NODE_FOOT, -1);
        footLine.push(li);
        footNodes++;
        if (prev >= 0 && segmentClear(col, posX(prev), posZ(prev), x, z, NAV_CLEAR_RADIUS, boxes)) add(prev, id, EDGE.foot | (steps ? EDGE.steps : 0));
        footGrid.add(id, x, z);
        prev = id;
      }
    }
  });
  for (let id = R; id < R + footNodes; id++) {
    linkToRing(id, FOOT_LINK);
    // Donde dos senderos se tocan (el mismo punto en OpenStreetMap), se unen.
    footGrid.near(posX(id), posZ(id), FOOT_JOIN, (k) => {
      if (k > id && footLine[k - R] !== footLine[id - R] && Math.hypot(posX(k) - posX(id), posZ(k) - posZ(id)) < FOOT_JOIN) add(id, k, EDGE.foot);
    });
  }

  const tPark0 = now();
  // Parques y plazas: grilla de nodos dentro del polígono, unida al andén.
  let parkNodes = 0;
  for (const a of city.areas ?? []) {
    if (!PARK_KINDS.includes(a.kind) || !a.poly || a.poly.length < 3) continue;
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const [x, z] of a.poly) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }
    const cells = new Map();
    const made = [];
    for (let ix = Math.ceil(minX / PARK_STEP); ix * PARK_STEP <= maxX; ix++) {
      for (let iz = Math.ceil(minZ / PARK_STEP); iz * PARK_STEP <= maxZ; iz++) {
        const x = ix * PARK_STEP;
        const z = iz * PARK_STEP;
        if (!pointInPoly(x, z, a.poly) || onRoad(x, z) || !spotFree(col, x, z, NAV_CLEAR_RADIUS, boxes)) continue;
        const id = addNode(x, z, NODE_PARK, a.block?.id ?? -1);
        cells.set(ix * 100003 + iz, id);
        made.push(ix, iz, id);
        parkNodes++;
      }
    }
    for (let q = 0; q < made.length; q += 3) {
      const ix = made[q];
      const iz = made[q + 1];
      const id = made[q + 2];
      for (const [di, dj] of PARK_NEIGHBORS) {
        const j = cells.get((ix + di) * 100003 + iz + dj);
        if (j !== undefined && segmentClear(col, posX(id), posZ(id), posX(j), posZ(j), NAV_CLEAR_RADIUS, boxes)) add(id, j, EDGE.park);
      }
      // Solo el borde (al que le falta algún vecino de la grilla) se une al andén.
      let inner = true;
      for (let di = -1; di <= 1 && inner; di++) for (let dj = -1; dj <= 1 && inner; dj++) if (!cells.has((ix + di) * 100003 + iz + dj)) inner = false;
      if (!inner) linkToRing(id, PARK_LINK);
    }
  }

  const tArr0 = now();
  // Arreglos tipados.
  const n = R + exX.length;
  const x = new Float32Array(n);
  const z = new Float32Array(n);
  const kind = new Uint8Array(n);
  const block = new Int32Array(n);
  const next = new Int32Array(R);
  const prev = new Int32Array(R);
  const ringCost = new Float32Array(R);
  const nx = new Float32Array(R);
  const nz = new Float32Array(R);
  const out = new Float32Array(R);
  const corner = new Uint8Array(R);
  for (let i = 0; i < R; i++) {
    const a = ring[i];
    x[i] = a.x;
    z[i] = a.z;
    block[i] = a.block;
    next[i] = a.next;
    prev[i] = a.prev;
    nx[i] = a.nx;
    nz[i] = a.nz;
    out[i] = a.out;
    corner[i] = a.corner;
  }
  for (let i = R; i < n; i++) {
    x[i] = exX[i - R];
    z[i] = exZ[i - R];
    kind[i] = exKind[i - R];
    block[i] = exBlock[i - R];
  }
  // Costo de cada tramo del andén: su largo, o mucho más si una casa real se lo
  // come (unos pocos lugares del mapa): así la ruta lo evita si hay por dónde.
  let ringWalls = 0;
  const wall = new Uint8Array(R);
  for (const b of col?.boxes ?? []) {
    if (b.kind !== 'building') continue;
    const cx = (b.minX + b.maxX) / 2;
    const cz = (b.minZ + b.maxZ) / 2;
    ringGrid.near(cx, cz, Math.hypot(b.maxX - b.minX, b.maxZ - b.minZ) / 2 + RING_STEP + 1, (k) => {
      const j = next[k];
      if (!wall[k] && segHitsBox(b, x[k], z[k], x[j] - x[k], z[j] - z[k], 0, 1, 0.1)) {
        wall[k] = 1;
        ringWalls++;
      }
    });
  }
  for (let i = 0; i < R; i++) ringCost[i] = Math.hypot(x[next[i]] - x[i], z[next[i]] - z[i]) * (wall[i] ? RING_WALL_COST : 1);
  // Aristas extra en CSR (por nodo de salida, en el orden en que se agregaron).
  const M = eA.length;
  const eStart = new Int32Array(n + 1);
  for (let e = 0; e < M; e++) eStart[eA[e] + 1]++;
  for (let i = 0; i < n; i++) eStart[i + 1] += eStart[i];
  const fill = eStart.slice(0, n);
  const eTo = new Int32Array(M);
  const eFlag = new Uint8Array(M);
  const eCost = new Float32Array(M);
  for (let e = 0; e < M; e++) {
    const q = fill[eA[e]]++;
    const a = eA[e];
    const b = eB[e];
    const f = eF[e];
    eTo[q] = b;
    eFlag[q] = f;
    eCost[q] = Math.hypot(x[b] - x[a], z[b] - z[a]) * (f & EDGE.cross ? CROSS_COST : 1) * (f & EDGE.steps ? STEPS_COST : 1);
  }
  // Pedazos conectados (para no buscar en vano entre dos que no se tocan).
  const comp = new Int32Array(n).fill(-1);
  const queue = new Int32Array(n);
  const sizes = [];
  for (let s = 0; s < n; s++) {
    if (comp[s] >= 0) continue;
    const c = sizes.length;
    let head = 0;
    let tail = 0;
    queue[tail++] = s;
    comp[s] = c;
    while (head < tail) {
      const u = queue[head++];
      if (u < R) {
        if (comp[next[u]] < 0) {
          comp[next[u]] = c;
          queue[tail++] = next[u];
        }
        if (comp[prev[u]] < 0) {
          comp[prev[u]] = c;
          queue[tail++] = prev[u];
        }
      }
      for (let e = eStart[u]; e < eStart[u + 1]; e++) {
        if (comp[eTo[e]] < 0) {
          comp[eTo[e]] = c;
          queue[tail++] = eTo[e];
        }
      }
    }
    sizes.push(tail);
  }
  const compSize = Int32Array.from(sizes);
  const graph = { n, ringCount: R, x, z, kind, block, next, prev, ringCost, nx, nz, out, corner, eStart, eTo, eFlag, eCost, comp, compSize };
  graph.grid = new NodeGrid(x, z, n, NAV_CELL);
  const tEdges = now();
  graph.dest = buildDestinations(city, graph, col, boxes);
  let main = 0;
  for (const s of sizes) if (s > main) main = s;
  graph.stats = {
    ms: now() - t0,
    ringMs: tRing - t0,
    crossMs: tCross - tRing,
    footMs: tPark0 - tFoot0,
    parkMs: tArr0 - tPark0,
    arraysMs: tEdges - tArr0,
    destMs: now() - tEdges,
    nodes: n,
    ring: R,
    foot: footNodes,
    park: parkNodes,
    edges: M,
    cityCross,
    ringWalls,
    components: sizes.length,
    mainComponent: main / Math.max(1, n),
    dest: graph.dest.n,
    bytes: [x, z, kind, block, next, prev, ringCost, nx, nz, out, corner, eStart, eTo, eFlag, eCost, comp, graph.grid.start, graph.grid.ids].reduce((s, a) => s + a.byteLength, 0),
  };
  return graph;
}

// ------------------------------------------------------------------ nodo más cercano
const _bi = new Int32Array(8);
const _bd = new Float32Array(8);

/**
 * El nodo del grafo más cercano a (x, z) a menos de maxD con línea libre
 * hasta él (de los NEAREST_TRIES más cercanos); si ninguno tiene línea libre,
 * el más cercano a secas (o -1 si `strict`). `comp` ≥ 0: solo de ese pedazo.
 */
export function nearestNode(graph, x, z, maxD, col, comp = -1, strict = false, boxes = [], tries = NEAREST_TRIES) {
  const grid = graph.grid;
  const g = grid._range(x, z, maxD, (grid._r4b ??= new Int32Array(4)));
  const K = Math.min(tries, _bi.length);
  let cnt = 0;
  for (let i = g[0]; i <= g[1]; i++) {
    for (let j = g[2]; j <= g[3]; j++) {
      const k = i * grid.H + j;
      for (let q = grid.start[k]; q < grid.start[k + 1]; q++) {
        const id = grid.ids[q];
        const c = graph.comp[id];
        if (comp >= 0 ? c !== comp : graph.compSize[c] < NAV_MIN_COMPONENT) continue;
        const d = Math.hypot(graph.x[id] - x, graph.z[id] - z);
        if (d >= maxD || (cnt === K && d >= _bd[K - 1])) continue;
        let p = cnt < K ? cnt++ : K - 1;
        while (p > 0 && _bd[p - 1] > d) {
          _bd[p] = _bd[p - 1];
          _bi[p] = _bi[p - 1];
          p--;
        }
        _bd[p] = d;
        _bi[p] = id;
      }
    }
  }
  for (let t = 0; t < cnt; t++) if (segmentClear(col, x, z, graph.x[_bi[t]], graph.z[_bi[t]], NAV_CLEAR_RADIUS * 0.66, boxes)) return _bi[t];
  return cnt && !strict ? _bi[0] : -1;
}

// ------------------------------------------------------------------ destinos
/**
 * Destinos a pie: la puerta de las tiendas y de una de cada DEST_HOUSE_EVERY
 * casas (frente del marco del edificio, hacia la calle) y los paraderos de
 * bus (en el andén de al lado). Cada uno con su nodo, la dirección hacia
 * donde se mira al llegar (la puerta o la calle) y una grilla por tipo.
 */
function buildDestinations(city, graph, col, boxes) {
  const xs = [];
  const zs = [];
  const yaws = [];
  const kinds = [];
  const nodes = [];
  const push = (x, z, yaw, k, strict = true) => {
    const node = nearestNode(graph, x, z, DEST_LINK, col, -1, strict, boxes);
    if (node < 0) return;
    xs.push(x);
    zs.push(z);
    yaws.push(yaw);
    kinds.push(k);
    nodes.push(node);
  };
  let house = 0;
  for (const b of city.buildings ?? []) {
    const f = b.frame;
    if (!f || b.collide === false) continue;
    const shop = b.style === 'tienda' || !!b.shop || !!b.local;
    const home = !shop && (b.style === 'ladrillo' || b.style === 'pintada');
    if (!shop && !(home && house++ % DEST_HOUSE_EVERY === 0)) continue;
    const x = f.x + f.nx * (f.hv + DEST_DOOR);
    const z = f.z + f.nz * (f.hv + DEST_DOOR);
    if (onRoad(x, z) || !spotFree(col, x, z, NAV_CLEAR_RADIUS, boxes)) continue;
    push(x, z, yawFromDir(-f.nx, -f.nz), shop ? 0 : 2);
  }
  for (const p of city.props ?? []) {
    if (p.type !== 'busStop') continue;
    const node = nearestNode(graph, p.x, p.z, 6, col, -1, false, boxes);
    if (node < 0 || node >= graph.ringCount) continue;
    // Se espera parado en el andén junto al paradero, mirando la calle.
    push(graph.x[node], graph.z[node], yawFromDir(-graph.nx[node], -graph.nz[node]), 1, false);
  }
  const n = xs.length;
  const dest = { n, x: Float32Array.from(xs), z: Float32Array.from(zs), yaw: Float32Array.from(yaws), kind: Uint8Array.from(kinds), node: Int32Array.from(nodes), grids: [] };
  for (let k = 0; k < DEST_KINDS.length; k++) {
    const ids = [];
    for (let i = 0; i < n; i++) if (kinds[i] === k) ids.push(i);
    const gx = Float32Array.from(ids, (i) => xs[i]);
    const gz = Float32Array.from(ids, (i) => zs[i]);
    const grid = new NodeGrid(gx, gz, ids.length, DEST_CELL);
    grid.map = Int32Array.from(ids); // índice en la grilla → índice del destino
    dest.grids.push(grid);
  }
  return dest;
}

// ------------------------------------------------------------------ rutas
/** Una ruta reutilizable (una por peatón): puntos xs/zs, el que sigue (i), el destino (gx, gz), su largo (len) y su estado. */
export function createRoute(max = ROUTE_MAX_PTS) {
  return { xs: new Float32Array(max), zs: new Float32Array(max), n: 0, i: 0, gx: 0, gz: 0, status: NAV_NONE, partial: false, t: 0, stuck: 0, lastD: Infinity, skips: 0, len: 0 };
}

/** Montículo binario de mínimos (clave, nodo) sobre arreglos fijos; los repetidos se descartan al sacarlos. */
class MinHeap {
  constructor(cap) {
    this.k = new Float32Array(cap);
    this.v = new Int32Array(cap);
    this.size = 0;
    this.cap = cap;
  }

  push(key, val) {
    if (this.size >= this.cap) return false;
    const k = this.k;
    const v = this.v;
    let i = this.size++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= key) break;
      k[i] = k[p];
      v[i] = v[p];
      i = p;
    }
    k[i] = key;
    v[i] = val;
    return true;
  }

  pop() {
    const k = this.k;
    const v = this.v;
    const top = v[0];
    const n = --this.size;
    if (n > 0) {
      const key = k[n];
      const val = v[n];
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && k[c + 1] < k[c]) c++;
        if (k[c] >= key) break;
        k[i] = k[c];
        v[i] = v[c];
        i = c;
      }
      k[i] = key;
      v[i] = val;
    }
    return top;
  }
}

/**
 * Buscador de rutas sobre un grafo de buildPedGraph. `collision`: la rejilla
 * de colisiones (línea libre y suavizado); `budget`: búsquedas por cuadro;
 * `frameMs`: tope de tiempo de búsquedas por cuadro (el juego pasa
 * NAV_FRAME_MS; sin él todo es determinista). Llamar beginFrame(dt) una vez por
 * cuadro: renueva el presupuesto de búsquedas.
 */
export class PedNav {
  constructor(graph, { collision = null, budget = NAV_SEARCHES_PER_FRAME, frameMs = Infinity } = {}) {
    this.graph = graph;
    this.col = collision;
    this.budget = budget;
    this.frameMs = frameMs;
    const n = graph.n;
    this.g = new Float32Array(n);
    this.parent = new Int32Array(n);
    this.seen = new Uint32Array(n);
    this.closed = new Uint32Array(n);
    this.stamp = 0;
    this.heap = new MinHeap(NAV_MAX_EXPAND * 8);
    this.path = new Int32Array(NAV_MAX_EXPAND + 2);
    this.pathLen = 0;
    this.partial = false;
    // Puntos de trabajo de una ruta (inicio + nodos + llegada) y los que quedan tras quitar los casi rectos.
    this.qx = new Float32Array(NAV_MAX_EXPAND + 4);
    this.qz = new Float32Array(NAV_MAX_EXPAND + 4);
    this.qRoad = new Uint8Array(NAV_MAX_EXPAND + 4); // 1 si el tramo que llega a ese punto cruza la calle
    this.keep = new Int32Array(NAV_MAX_EXPAND + 4);
    // Caché de rutas recientes.
    this.cS = new Int32Array(NAV_CACHE_SIZE).fill(-1);
    this.cT = new Int32Array(NAV_CACHE_SIZE).fill(-1);
    this.cLen = new Int32Array(NAV_CACHE_SIZE);
    this.cTime = new Float64Array(NAV_CACHE_SIZE);
    this.cNodes = new Int32Array(NAV_CACHE_SIZE * NAV_CACHE_NODES);
    this.cNext = 0;
    this.used = 0;
    this.time = 0;
    this.boxes = [];
    this.stats = { searches: 0, flees: 0, hits: 0, waits: 0, fails: 0, partial: 0, expanded: 0, ms: 0, frames: 0, maxFrameMs: 0, frameMs: 0 };
  }

  /** Nuevo cuadro: vuelve a haber presupuesto de búsquedas. */
  beginFrame(dt = 0) {
    this.time += dt;
    this.used = 0;
    const s = this.stats;
    if (s.frameMs > s.maxFrameMs) s.maxFrameMs = s.frameMs;
    s.frameMs = 0;
    s.frames++;
  }

  /** ¿Hay línea libre (sin paredes ni obstáculos) de a a b para un peatón? */
  clear(ax, az, bx, bz, r = NAV_CLEAR_RADIUS) {
    return segmentClear(this.col, ax, az, bx, bz, r, this.boxes);
  }

  /** El nodo más cercano a (x, z) con línea libre (o el más cercano a secas); -1 si no hay a menos de NEAREST_FAR. */
  nearest(x, z, comp = -1) {
    let k = nearestNode(this.graph, x, z, NEAREST_MAX, this.col, comp, false, this.boxes);
    if (k < 0) k = nearestNode(this.graph, x, z, NEAREST_FAR, this.col, comp, false, this.boxes, 1);
    return k;
  }

  _spend() {
    if (this.used >= this.budget || this.stats.frameMs > this.frameMs) {
      this.stats.waits++;
      return false;
    }
    this.used++;
    return true;
  }

  _done(t0) {
    const dt = now() - t0;
    this.stats.ms += dt;
    this.stats.frameMs += dt;
  }

  /**
   * Ruta a pie de (ax, az) a (bx, bz), escrita en `route` (createRoute).
   * `cut`: puede atravesar la calle donde quiera (policía, alguien con afán);
   * si no, cruza solo por los cruces del grafo. Devuelve NAV_OK, NAV_WAIT (no
   * hubo presupuesto en este cuadro: pedirla otra vez) o NAV_FAIL.
   */
  findPath(ax, az, bx, bz, route, cut = true) {
    route.gx = bx;
    route.gz = bz;
    route.n = 0;
    route.i = 0;
    route.partial = false;
    route.stuck = 0;
    route.lastD = Infinity;
    route.skips = 0;
    if (!this._spend()) return (route.status = NAV_WAIT);
    const t0 = now();
    const G = this.graph;
    const s = this.nearest(ax, az);
    const t = s >= 0 ? this.nearest(bx, bz, G.comp[s]) : -1;
    if (s < 0 || t < 0) {
      this.stats.fails++;
      this._done(t0);
      return (route.status = NAV_FAIL);
    }
    // Si la llegada queda lejos de todo nodo de este pedazo, se llega hasta donde se pueda.
    const reach = Math.hypot(G.x[t] - bx, G.z[t] - bz) < NEAREST_MAX;
    if (!this._fromCache(s, t)) {
      this.stats.searches++;
      if (!this._astar(s, t)) {
        this.stats.fails++;
        this._done(t0);
        return (route.status = NAV_FAIL);
      }
      if (!this.partial) this._store(s, t);
      else this.stats.partial++;
    }
    this._emit(route, ax, az, reach && !this.partial, bx, bz, cut);
    if (!reach || this.partial) route.partial = true;
    this._done(t0);
    return (route.status = NAV_OK);
  }

  /**
   * Huida: la ruta desde (ax, az) que más aleja de la amenaza (tx, tz) sin
   * pasarle cerca, explorando hasta FLEE_SEARCH m de camino. Escribe en
   * `route` y devuelve NAV_OK, NAV_WAIT o NAV_FAIL (no hay hacia dónde: que
   * corra derecho).
   */
  flee(ax, az, tx, tz, route) {
    route.n = 0;
    route.i = 0;
    route.partial = false;
    route.stuck = 0;
    route.lastD = Infinity;
    route.skips = 0;
    if (!this._spend()) return (route.status = NAV_WAIT);
    const t0 = now();
    this.stats.flees++;
    const G = this.graph;
    const s = this.nearest(ax, az);
    if (s < 0) {
      this.stats.fails++;
      this._done(t0);
      return (route.status = NAV_FAIL);
    }
    const st = this._nextStamp();
    const { g, parent, seen, closed, heap } = this;
    const X = G.x;
    const Z = G.z;
    const R = G.ringCount;
    g[s] = 0;
    seen[s] = st;
    parent[s] = -1;
    heap.size = 0;
    heap.push(0, s);
    const d0 = Math.max(Math.hypot(ax - tx, az - tz), Math.hypot(X[s] - tx, Z[s] - tz));
    let best = -1;
    let bestScore = -Infinity;
    let expanded = 0;
    while (heap.size) {
      const u = heap.pop();
      if (closed[u] === st) continue;
      closed[u] = st;
      const du = Math.hypot(X[u] - tx, Z[u] - tz);
      const score = du - FLEE_PATH_WEIGHT * g[u];
      if (du > d0 + FLEE_MIN_GAIN && score > bestScore) {
        bestScore = score;
        best = u;
      }
      if (++expanded > FLEE_MAX_EXPAND) break;
      if (g[u] > FLEE_SEARCH) continue;
      for (let e = -2; e < G.eStart[u + 1] - G.eStart[u]; e++) {
        let v;
        let c;
        if (e === -2) {
          if (u >= R) continue;
          v = G.next[u];
          c = G.ringCost[u];
        } else if (e === -1) {
          if (u >= R) continue;
          v = G.prev[u];
          c = G.ringCost[v];
        } else {
          const q = G.eStart[u] + e;
          v = G.eTo[q];
          c = G.eCost[q];
        }
        if (closed[v] === st) continue;
        const dv = Math.hypot(X[v] - tx, Z[v] - tz);
        const ng = g[u] + c * (1 + FLEE_NEAR_PENALTY * Math.max(0, 1 - dv / FLEE_NEAR_RADIUS));
        if (seen[v] !== st || ng < g[v]) {
          seen[v] = st;
          g[v] = ng;
          parent[v] = u;
          heap.push(ng, v);
        }
      }
    }
    this.stats.expanded += expanded;
    if (best < 0) {
      this.stats.fails++;
      this._done(t0);
      return (route.status = NAV_FAIL);
    }
    this._trace(best);
    route.gx = X[best];
    route.gz = Z[best];
    this._emit(route, ax, az, false, 0, 0, true);
    this._done(t0);
    return (route.status = NAV_OK);
  }

  _nextStamp() {
    this.stamp = (this.stamp + 1) >>> 0;
    if (this.stamp === 0) {
      this.seen.fill(0);
      this.closed.fill(0);
      this.stamp = 1;
    }
    return this.stamp;
  }

  /** A* de s a t. Deja el camino en this.path (parcial hacia lo más cercano a t si se acaba la búsqueda). */
  _astar(s, t) {
    const G = this.graph;
    const st = this._nextStamp();
    const { g, parent, seen, closed, heap } = this;
    const X = G.x;
    const Z = G.z;
    const R = G.ringCount;
    const tx = X[t];
    const tz = Z[t];
    g[s] = 0;
    seen[s] = st;
    parent[s] = -1;
    heap.size = 0;
    heap.push(Math.hypot(X[s] - tx, Z[s] - tz), s);
    let best = s;
    let bestH = Infinity;
    let expanded = 0;
    let found = false;
    while (heap.size) {
      const u = heap.pop();
      if (closed[u] === st) continue;
      closed[u] = st;
      if (u === t) {
        found = true;
        break;
      }
      const hu = Math.hypot(X[u] - tx, Z[u] - tz);
      if (hu < bestH) {
        bestH = hu;
        best = u;
      }
      if (++expanded > NAV_MAX_EXPAND) break;
      const gu = g[u];
      for (let e = -2; e < G.eStart[u + 1] - G.eStart[u]; e++) {
        let v;
        let c;
        if (e === -2) {
          if (u >= R) continue;
          v = G.next[u];
          c = G.ringCost[u];
        } else if (e === -1) {
          if (u >= R) continue;
          v = G.prev[u];
          c = G.ringCost[v];
        } else {
          const q = G.eStart[u] + e;
          v = G.eTo[q];
          c = G.eCost[q];
        }
        if (closed[v] === st) continue;
        const ng = gu + c;
        if (seen[v] !== st || ng < g[v]) {
          seen[v] = st;
          g[v] = ng;
          parent[v] = u;
          heap.push(ng + Math.hypot(X[v] - tx, Z[v] - tz), v);
        }
      }
    }
    this.stats.expanded += expanded;
    this.partial = !found;
    if (!found && best === s) return false;
    this._trace(found ? t : best);
    return true;
  }

  /** Camino de padres hasta `end`, al derecho, en this.path. */
  _trace(end) {
    let len = 0;
    for (let k = end; k >= 0 && len < this.path.length; k = this.parent[k]) this.path[len++] = k;
    this.path.subarray(0, len).reverse();
    this.pathLen = len;
  }

  _fromCache(s, t) {
    const L = NAV_CACHE_NODES;
    for (let c = 0; c < NAV_CACHE_SIZE; c++) {
      if (this.cT[c] !== t || this.time - this.cTime[c] > NAV_CACHE_TTL) continue;
      const base = c * L;
      const len = this.cLen[c];
      // Sirve si arranca en s o si s queda en el camino guardado (se usa el resto).
      let from = -1;
      for (let k = 0; k < len; k++) {
        if (this.cNodes[base + k] === s) {
          from = k;
          break;
        }
      }
      if (from < 0) continue;
      this.pathLen = len - from;
      for (let k = from; k < len; k++) this.path[k - from] = this.cNodes[base + k];
      this.partial = false;
      this.stats.hits++;
      return true;
    }
    return false;
  }

  _store(s, t) {
    if (this.pathLen > NAV_CACHE_NODES) return;
    const c = this.cNext;
    this.cNext = (c + 1) % NAV_CACHE_SIZE;
    this.cS[c] = s;
    this.cT[c] = t;
    this.cLen[c] = this.pathLen;
    this.cTime[c] = this.time;
    this.cNodes.set(this.path.subarray(0, this.pathLen), c * NAV_CACHE_NODES);
  }

  /** ¿La arista u→v (extra) es un cruce de calle? */
  _isCross(u, v) {
    const G = this.graph;
    for (let e = G.eStart[u]; e < G.eStart[u + 1]; e++) if (G.eTo[e] === v) return (G.eFlag[e] & EDGE.cross) !== 0;
    return false;
  }

  /**
   * Del camino de nodos (this.path) a los puntos de la ruta: el inicio real,
   * los nodos, y la llegada real si `withGoal`; quita los casi rectos y
   * suaviza (de cada punto, salta al más lejano con línea libre). Sin `cut`
   * no se salta por encima de un cruce de calle.
   */
  _emit(route, ax, az, withGoal, bx, bz, cut) {
    const G = this.graph;
    const { qx, qz, qRoad, keep, path } = this;
    let m = 0;
    qx[m] = ax;
    qz[m] = az;
    qRoad[m++] = 0;
    for (let k = 0; k < this.pathLen; k++) {
      const v = path[k];
      qx[m] = G.x[v];
      qz[m] = G.z[v];
      qRoad[m++] = k > 0 && this._isCross(path[k - 1], v) ? 1 : 0;
    }
    if (withGoal) {
      qx[m] = bx;
      qz[m] = bz;
      qRoad[m++] = 0;
    }
    // Quitar los puntos casi en línea recta (los nodos del anillo cada 3 m en un tramo derecho).
    let kn = 0;
    keep[kn++] = 0;
    let a = 0;
    for (let i = 1; i < m; i++) {
      let drop = i < m - 1 && qRoad[i] === qRoad[i + 1] && i - a < 60;
      if (drop) {
        const ex = qx[i + 1] - qx[a];
        const ez = qz[i + 1] - qz[a];
        const L = Math.hypot(ex, ez) || 1e-6;
        for (let k = a + 1; k <= i && drop; k++) if (Math.abs((qx[k] - qx[a]) * ez - (qz[k] - qz[a]) * ex) / L > SMOOTH_TOL) drop = false;
      }
      if (!drop) {
        keep[kn++] = i;
        a = i;
      }
    }
    // Suavizar: de cada punto, al más lejano que se vea (sin pasar de SMOOTH_MAX_SKIP).
    let n = 0;
    let p = 0;
    const max = route.xs.length;
    while (p < kn - 1) {
      let j = p + 1;
      while (j + 1 < kn) {
        const A = keep[p];
        const B = keep[j + 1];
        if (Math.hypot(qx[B] - qx[A], qz[B] - qz[A]) > SMOOTH_MAX_SKIP) break;
        if (!cut) {
          let road = false;
          for (let k = A + 1; k <= B && !road; k++) road = qRoad[k] === 1;
          if (road) break;
        }
        if (!this.clear(qx[A], qz[A], qx[B], qz[B])) break;
        j++;
      }
      if (n >= max) {
        route.partial = true;
        break;
      }
      route.xs[n] = qx[keep[j]];
      route.zs[n] = qz[keep[j]];
      n++;
      p = j;
    }
    route.n = n;
    // Largo de la ruta desde el inicio (para descartar destinos con mucha vuelta).
    let len = 0;
    for (let k = 0, px = ax, pz = az; k < n; k++) {
      len += Math.hypot(route.xs[k] - px, route.zs[k] - pz);
      px = route.xs[k];
      pz = route.zs[k];
    }
    route.len = len;
    route.i = 0;
    route.t = 0;
  }

  /**
   * Un destino al azar (índice en graph.dest) a entre minD y maxD de (x, z):
   * primero el tipo según `weights` ({tienda, paradero, casa}), después uno
   * de ese tipo. -1 si no hay.
   */
  pickDestination(x, z, rand, minD, maxD, weights) {
    const D = this.graph.dest;
    let total = 0;
    for (const k of DEST_KINDS) total += weights?.[k] ?? 1;
    let r = rand() * total;
    let kind = 0;
    for (; kind < DEST_KINDS.length - 1; kind++) {
      r -= weights?.[DEST_KINDS[kind]] ?? 1;
      if (r < 0) break;
    }
    for (let tries = 0; tries < DEST_KINDS.length; tries++) {
      const grid = D.grids[(kind + tries) % DEST_KINDS.length];
      const pick = this._pickIn(grid, x, z, rand, minD, maxD);
      if (pick >= 0) return pick;
    }
    return -1;
  }

  _pickIn(grid, x, z, rand, minD, maxD) {
    if (!grid.n) return -1;
    const D = this.graph.dest;
    const g = grid._range(x, z, maxD, (grid._r4 ??= new Int32Array(4)));
    let count = 0;
    for (let pass = 0; pass < 2; pass++) {
      let target = pass ? Math.floor(rand() * count) : -1;
      if (pass && !count) return -1;
      for (let i = g[0]; i <= g[1]; i++) {
        for (let j = g[2]; j <= g[3]; j++) {
          const k = i * grid.H + j;
          for (let q = grid.start[k]; q < grid.start[k + 1]; q++) {
            const id = grid.map[grid.ids[q]];
            const d = Math.hypot(D.x[id] - x, D.z[id] - z);
            if (d < minD || d > maxD) continue;
            if (!pass) count++;
            else if (target-- === 0) return id;
          }
        }
      }
    }
    return -1;
  }
}

/** Largo de una ruta desde (x, z) por sus puntos (para pruebas y la sonda). */
export function routeLength(route, x, z) {
  let L = 0;
  let px = x;
  let pz = z;
  for (let i = route.i; i < route.n; i++) {
    L += Math.hypot(route.xs[i] - px, route.zs[i] - pz);
    px = route.xs[i];
    pz = route.zs[i];
  }
  return L;
}

