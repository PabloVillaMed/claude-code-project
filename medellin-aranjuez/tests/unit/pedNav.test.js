import { describe, expect, it } from 'vitest';
import {
  DEST_KINDS,
  DEST_LINK,
  EDGE,
  FLEE_MIN_GAIN,
  NAV_OK,
  NAV_WAIT,
  NODE_FOOT,
  NODE_PARK,
  PedNav,
  buildPedGraph,
  createRoute,
  routeLength,
  segmentClear,
} from '../../src/sim/pedNav.js';
import { sidewalkPoints } from '../../src/sim/animals.js';
import { GOTO_MAX_ROUTE, PED, createPed, stepPed } from '../../src/sim/pedAI.js';
import { pointInObb } from '../../src/sim/collision.js';
import { distToPolyEdge, pointInPoly } from '../../src/sim/geom2d.js';
import { GRID, onRoad } from '../../src/sim/terrain.js';
import { makeRng } from '../../src/sim/rng.js';
import { city } from './helpers.js';

// Todo sobre la ciudad real: el grafo sale de sus manzanas, senderos y parques.
const C = city();
const t0 = performance.now();
const G = buildPedGraph(C);
const buildMs = performance.now() - t0;
const navOf = (budget = 1e9, graph = G) => new PedNav(graph, { collision: C.collision, budget });
const R = G.ringCount;

// Rango de nodos del anillo de cada manzana.
const ranges = new Map();
for (let i = 0; i < R; i++) {
  const r = ranges.get(G.block[i]);
  if (r) r[1] = i + 1;
  else ranges.set(G.block[i], [i, i + 1]);
}
const parks = C.areas.filter((a) => (a.kind === 'parque' || a.kind === 'verde') && a.poly);
const residential = C.blocks.filter((b) => b.type === 'residencial' && b.curb);

/** ¿(x, z) cae dentro de una casa (caja de colisión de un edificio)? */
function inBuilding(x, z) {
  for (const b of C.collision.query(x, z, x, z)) {
    if (b.kind !== 'building' || !(x > b.minX && x < b.maxX && z > b.minZ && z < b.maxZ)) continue;
    if (!b.obb || pointInObb(x, z, b.obb)) return true;
  }
  return false;
}

/** ¿(x, z) está metido en una manzana, más allá del andén (en los lotes), fuera de parques? */
function deepInBlock(x, z) {
  for (const b of residential) {
    if (x < b.minX || x > b.maxX || z < b.minZ || z > b.maxZ || !pointInPoly(x, z, b.curb)) continue;
    if (distToPolyEdge(x, z, b.curb) < GRID.sidewalk + 1) return false;
    return !parks.some((a) => pointInPoly(x, z, a.poly));
  }
  return false;
}

/** Puntos cada `step` m del segmento a→b. */
function samples(ax, az, bx, bz, step, fn) {
  const L = Math.hypot(bx - ax, bz - az);
  const n = Math.max(1, Math.ceil(L / step));
  for (let k = 0; k <= n; k++) fn(ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n);
}

/** ¿u y v son vecinos en el grafo (anillo o arista extra)? */
function adjacent(u, v) {
  if (u < R && (G.next[u] === v || G.prev[u] === v)) return true;
  for (let e = G.eStart[u]; e < G.eStart[u + 1]; e++) if (G.eTo[e] === v) return true;
  return false;
}

// Manzanas que se pueden atravesar (un sendero o un parque adentro): ahí no se prueba "dar la vuelta".
const open = new Set();
for (let i = R; i < G.n; i++) {
  const b = residential.find((q) => G.x[i] > q.minX && G.x[i] < q.maxX && G.z[i] > q.minZ && G.z[i] < q.maxZ && pointInPoly(G.x[i], G.z[i], q.curb));
  if (b) open.add(b.id);
}

/** Pares de nodos del andén de una misma manzana, de lado a lado (las casas en medio). */
function acrossBlocks(count) {
  const out = [];
  for (const [bid, [a, b]] of ranges) {
    if (b - a < 40 || open.has(bid)) continue;
    for (let i = a; i < b && out.length < count; i += 7) {
      let pick = -1;
      for (let j = a; j < b; j++) {
        const d = Math.hypot(G.x[j] - G.x[i], G.z[j] - G.z[i]);
        if (d < 20 || d > 40) continue;
        // Lejos siguiendo el anillo (al otro lado) y con casas en medio.
        const along = Math.min(Math.abs(j - i), b - a - Math.abs(j - i)) * 3;
        if (along < d * 2.2 || segmentClear(C.collision, G.x[i], G.z[i], G.x[j], G.z[j])) continue;
        pick = j;
        break;
      }
      if (pick >= 0) {
        out.push({ bid, a: i, b: pick });
        break;
      }
    }
    if (out.length >= count) break;
  }
  return out;
}

describe('grafo peatonal (sim/pedNav.js)', () => {
  it('el anillo es el mismo de los animales, con cruces, senderos y parques, y se arma rápido', () => {
    const sw = sidewalkPoints(C);
    expect(R).toBe(sw.length);
    for (let i = 0; i < R; i += 97) {
      expect(G.x[i]).toBeCloseTo(sw[i].x, 3);
      expect(G.z[i]).toBeCloseTo(sw[i].z, 3);
      expect(G.next[i]).toBe(sw[i].next);
      expect(G.corner[i]).toBe(sw[i].corner);
    }
    let cross = 0;
    for (let e = 0; e < G.eTo.length; e++) if (G.eFlag[e] & EDGE.cross) cross++;
    expect(cross).toBeGreaterThan(2000);
    expect(G.stats.foot).toBeGreaterThan(300); // senderos y escalas de OpenStreetMap
    expect(G.stats.park).toBeGreaterThan(1000); // parques y plazas
    expect(G.n).toBe(R + G.stats.foot + G.stats.park);
    // Casi todo el barrio queda conectado (los pedazos sueltos son islas al otro lado del río o de la quebrada).
    expect(G.stats.mainComponent).toBeGreaterThan(0.85);
    // Pequeño: en la carga, unas décimas de segundo (holgado por si la máquina de pruebas es lenta).
    console.log(`grafo peatonal: ${G.n} nodos (${R} andén, ${G.stats.foot} senderos, ${G.stats.park} parques), ${G.eTo.length} aristas, ${(G.stats.bytes / 1048576).toFixed(1)} MB, ${buildMs.toFixed(0)} ms`);
    expect(buildMs).toBeLessThan(2500);
  });

  it('los cruces van a otra manzana por calzada o separador; senderos y parques no atraviesan nada', () => {
    let checked = 0;
    for (let u = 0; u < G.n; u++) {
      for (let e = G.eStart[u]; e < G.eStart[u + 1]; e++) {
        const v = G.eTo[e];
        const f = G.eFlag[e];
        if (f & EDGE.cross) {
          expect(G.block[v]).not.toBe(G.block[u]);
          const mx = (G.x[u] + G.x[v]) / 2;
          const mz = (G.z[u] + G.z[v]) / 2;
          expect(onRoad(mx, mz) || !deepInBlock(mx, mz)).toBe(true);
          checked++;
        } else if ((f & (EDGE.foot | EDGE.park)) && (u * 31 + e) % 7 === 0) {
          expect(segmentClear(C.collision, G.x[u], G.z[u], G.x[v], G.z[v])).toBe(true);
          expect(G.kind[u] === NODE_FOOT || G.kind[u] === NODE_PARK).toBe(true);
        }
      }
    }
    expect(checked).toBeGreaterThan(2000);
  });

  it('determinista: dos construcciones dan los mismos arreglos y las mismas rutas', () => {
    const G2 = buildPedGraph(C);
    for (const k of ['x', 'z', 'next', 'eStart', 'eTo', 'eFlag', 'eCost', 'comp']) expect(Buffer.compare(Buffer.from(G2[k].buffer), Buffer.from(G[k].buffer))).toBe(0);
    expect(Array.from(G2.dest.x)).toEqual(Array.from(G.dest.x));
    const a = navOf(1e9, G);
    const b = navOf(1e9, G2);
    const ra = createRoute();
    const rb = createRoute();
    const rng = makeRng(31);
    for (let k = 0; k < 30; k++) {
      const i = Math.floor(rng.next() * R);
      const j = Math.floor(rng.next() * R);
      expect(a.findPath(G.x[i], G.z[i], G.x[j] + 0.5, G.z[j], ra, k % 2 === 0)).toBe(b.findPath(G.x[i], G.z[i], G.x[j] + 0.5, G.z[j], rb, k % 2 === 0));
      expect(Array.from(ra.xs.subarray(0, ra.n))).toEqual(Array.from(rb.xs.subarray(0, rb.n)));
      expect(Array.from(ra.zs.subarray(0, ra.n))).toEqual(Array.from(rb.zs.subarray(0, rb.n)));
    }
  });
});

describe('rutas (A*, suavizado, caché, presupuesto)', () => {
  it('rutas válidas: siguen el grafo, no atraviesan manzanas ni casas y llegan', () => {
    const nav = navOf();
    const r = createRoute();
    const rng = makeRng(5);
    let ok = 0;
    let n = 0;
    let rawPts = 0;
    let pts = 0;
    while (n < 120) {
      const i = Math.floor(rng.next() * R);
      const j = Math.floor(rng.next() * R);
      if (G.comp[i] !== G.comp[j] || Math.hypot(G.x[i] - G.x[j], G.z[i] - G.z[j]) > 260) continue;
      n++;
      const cut = n % 2 === 0;
      const ax = G.x[i];
      const az = G.z[i];
      const bx = G.x[j];
      const bz = G.z[j];
      expect(nav.findPath(ax, az, bx, bz, r, cut)).toBe(NAV_OK);
      ok++;
      // El camino de nodos: vecinos de verdad, y ningún tramo del andén se mete en los lotes de una manzana.
      for (let k = 1; k < nav.pathLen; k++) {
        const u = nav.path[k - 1];
        const v = nav.path[k];
        expect(adjacent(u, v)).toBe(true);
        // Los del andén y los cruces van por el andén o la calle; los senderos (pasajes y escalas entre
        // las casas) y los parques sí entran a la manzana, pero sin tocar nada.
        if (u < R && v < R) samples(G.x[u], G.z[u], G.x[v], G.z[v], 1, (x, z) => expect(deepInBlock(x, z)).toBe(false));
        else expect(segmentClear(C.collision, G.x[u], G.z[u], G.x[v], G.z[v])).toBe(true);
      }
      // La ruta suavizada: ningún tramo pasa por una casa.
      let px = ax;
      let pz = az;
      for (let k = 0; k < r.n; k++) {
        samples(px, pz, r.xs[k], r.zs[k], 0.5, (x, z) => expect(inBuilding(x, z)).toBe(false));
        px = r.xs[k];
        pz = r.zs[k];
      }
      if (!r.partial) {
        expect(r.xs[r.n - 1]).toBeCloseTo(bx, 3);
        expect(r.zs[r.n - 1]).toBeCloseTo(bz, 3);
      }
      rawPts += nav.pathLen;
      pts += r.n;
    }
    expect(ok).toBe(120);
    // Suavizado: muchos menos puntos que nodos (los del anillo cada 3 m en línea recta se van).
    expect(pts / rawPts).toBeLessThan(0.3);
  });

  it('de un lado al otro de la cuadra, la ruta le da la vuelta (no la atraviesa)', () => {
    const nav = navOf();
    const r = createRoute();
    const pairs = acrossBlocks(12);
    expect(pairs.length).toBeGreaterThanOrEqual(8);
    for (const { a, b } of pairs) {
      const d = Math.hypot(G.x[a] - G.x[b], G.z[a] - G.z[b]);
      expect(nav.findPath(G.x[a], G.z[a], G.x[b], G.z[b], r, true)).toBe(NAV_OK);
      expect(routeLength(r, G.x[a], G.z[a])).toBeGreaterThan(d * 1.25);
      let px = G.x[a];
      let pz = G.z[a];
      for (let k = 0; k < r.n; k++) {
        samples(px, pz, r.xs[k], r.zs[k], 0.5, (x, z) => {
          expect(inBuilding(x, z)).toBe(false);
          expect(deepInBlock(x, z)).toBe(false);
        });
        px = r.xs[k];
        pz = r.zs[k];
      }
    }
  });

  it('suavizado: por un andén derecho es un solo tramo; doblando la esquina, pocos puntos', () => {
    const nav = navOf();
    const r = createRoute();
    let straight = 0;
    for (let i = 0; i < R && straight < 15; i += 211) {
      // Ocho nodos seguidos casi en línea recta (24 m de andén) y con línea libre.
      let j = i;
      let line = true;
      for (let k = 0; k < 8; k++) j = G.next[j];
      const ex = G.x[j] - G.x[i];
      const ez = G.z[j] - G.z[i];
      const L = Math.hypot(ex, ez);
      for (let k = G.next[i]; k !== j && line; k = G.next[k]) if (Math.abs((G.x[k] - G.x[i]) * ez - (G.z[k] - G.z[i]) * ex) / L > 0.2) line = false;
      if (!line || L < 20 || !segmentClear(C.collision, G.x[i], G.z[i], G.x[j], G.z[j])) continue;
      expect(nav.findPath(G.x[i], G.z[i], G.x[j], G.z[j], r, false)).toBe(NAV_OK);
      expect(r.n).toBe(1);
      straight++;
    }
    expect(straight).toBeGreaterThan(5);
    // Alrededor de la manzana: de la esquina al otro lado, una ruta de pocos puntos.
    for (const { a, b } of acrossBlocks(6)) {
      nav.findPath(G.x[a], G.z[a], G.x[b], G.z[b], r, true);
      expect(r.n).toBeLessThanOrEqual(nav.pathLen / 3);
    }
  });

  it('caché: la misma ruta (o desde un nodo de ella) no se vuelve a buscar', () => {
    const nav = navOf();
    const r1 = createRoute();
    const r2 = createRoute();
    const i = 1234;
    let j = i;
    for (let k = 0; k < 40; k++) j = G.next[j];
    nav.findPath(G.x[i], G.z[i], G.x[j], G.z[j], r1);
    const searches = nav.stats.searches;
    nav.findPath(G.x[i], G.z[i], G.x[j], G.z[j], r2);
    expect(nav.stats.searches).toBe(searches);
    expect(nav.stats.hits).toBe(1);
    expect(Array.from(r2.xs.subarray(0, r2.n))).toEqual(Array.from(r1.xs.subarray(0, r1.n)));
    // Desde un nodo más adelante en la misma ruta: el resto de la guardada.
    const mid = nav.path[Math.floor(nav.pathLen / 2)];
    nav.findPath(G.x[mid], G.z[mid], G.x[j], G.z[j], r2);
    expect(nav.stats.searches).toBe(searches);
    expect(nav.stats.hits).toBe(2);
  });

  it('presupuesto: más búsquedas de las que caben en un cuadro esperan al siguiente', () => {
    const nav = navOf(2);
    const r = createRoute();
    const go = (k) => nav.findPath(G.x[k], G.z[k], G.x[k + 300], G.z[k + 300], r);
    nav.beginFrame(1 / 60);
    expect(go(100)).toBe(NAV_OK);
    expect(nav.flee(G.x[200], G.z[200], G.x[200] + 3, G.z[200], r)).toBe(NAV_OK);
    expect(go(400)).toBe(NAV_WAIT);
    expect(r.status).toBe(NAV_WAIT);
    expect(nav.stats.waits).toBe(1);
    nav.beginFrame(1 / 60);
    expect(go(400)).toBe(NAV_OK);
  });

  it('huida: la ruta termina lejos de la amenaza y no pasa por las casas', () => {
    const nav = navOf();
    const r = createRoute();
    const rng = makeRng(12);
    let n = 0;
    while (n < 40) {
      const i = Math.floor(rng.next() * R);
      if (G.compSize[G.comp[i]] < 1000) continue;
      n++;
      const tx = G.x[i] + 4;
      const tz = G.z[i] - 2;
      const d0 = Math.hypot(G.x[i] - tx, G.z[i] - tz);
      expect(nav.flee(G.x[i], G.z[i], tx, tz, r)).toBe(NAV_OK);
      expect(Math.hypot(r.xs[r.n - 1] - tx, r.zs[r.n - 1] - tz)).toBeGreaterThan(d0 + FLEE_MIN_GAIN);
      let px = G.x[i];
      let pz = G.z[i];
      for (let k = 0; k < r.n; k++) {
        samples(px, pz, r.xs[k], r.zs[k], 0.5, (x, z) => expect(inBuilding(x, z)).toBe(false));
        px = r.xs[k];
        pz = r.zs[k];
      }
    }
  });

  it('destinos: tiendas, casas y paraderos con un nodo cerca; se escoge uno a la distancia pedida', () => {
    const D = G.dest;
    const kinds = [0, 0, 0];
    for (let k = 0; k < D.n; k++) {
      kinds[D.kind[k]]++;
      expect(Math.hypot(G.x[D.node[k]] - D.x[k], G.z[D.node[k]] - D.z[k])).toBeLessThan(DEST_LINK);
    }
    expect(kinds[DEST_KINDS.indexOf('tienda')]).toBeGreaterThan(200);
    expect(kinds[DEST_KINDS.indexOf('casa')]).toBeGreaterThan(500);
    expect(kinds[DEST_KINDS.indexOf('paradero')]).toBeGreaterThan(0);
    const nav = navOf();
    const rng = makeRng(3);
    for (let t = 0; t < 30; t++) {
      const k = nav.pickDestination(C.spawn.x, C.spawn.z, rng.next, 25, 140, { tienda: 1, paradero: 1, casa: 1 });
      expect(k).toBeGreaterThanOrEqual(0);
      const d = Math.hypot(D.x[k] - C.spawn.x, D.z[k] - C.spawn.z);
      expect(d).toBeGreaterThanOrEqual(25);
      expect(d).toBeLessThanOrEqual(140);
    }
  });
});

// ------------------------------------------------------------------ en la IA de peatones
function pedWorld(nav, extra = {}) {
  return {
    blocks: C.blocks,
    blockAt: (x, z) => C.blocks.find((b) => b.ring && x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ && pointInPoly(x, z, b.curb)) ?? null,
    collision: C.collision,
    rand: makeRng(4).next,
    threats: [],
    player: { x: 0, z: 0 },
    nav,
    ...extra,
  };
}

describe('peatones con rutas (sim/pedAI.js + world.nav)', () => {
  it('un policía a pie rodea la manzana para llegar al jugador en vez de quedarse contra la pared', () => {
    const dt = 1 / 20;
    let withNav = 0;
    let stuckWithout = 0;
    const pairs = acrossBlocks(6);
    for (const { bid, a, b } of pairs) {
      const block = C.blocks[bid];
      const run = (nav) => {
        const rng = makeRng(8);
        const p = createPed(block, rng, { hostile: true, faction: 'police', attackRange: 12 });
        p.x = G.x[a];
        p.z = G.z[a];
        p.mode = 'attack';
        const world = pedWorld(nav, { player: { x: G.x[b], z: G.z[b] } });
        for (let t = 0; t < 40; t += dt) {
          nav?.beginFrame(dt);
          stepPed(p, dt, world);
        }
        const d = Math.hypot(p.x - G.x[b], p.z - G.z[b]);
        return { d, sees: segmentClear(C.collision, p.x, p.z, G.x[b], G.z[b], 0.2) };
      };
      const on = run(navOf(4));
      const off = run(null);
      // Con rutas: termina viéndolo y a tiro. Sin rutas: contra la pared, sin verlo.
      if (on.sees && on.d < 12.5) withNav++;
      if (!off.sees) stuckWithout++;
    }
    expect(withNav).toBe(pairs.length);
    expect(stuckWithout).toBeGreaterThanOrEqual(pairs.length / 2);
  });

  it('peatones huyendo de un tiro: se alejan por el grafo, sin quedarse trabados', () => {
    const dt = 1 / 20;
    const nav = navOf(4);
    const i0 = G.dest.node[0];
    const sx = G.x[i0];
    const sz = G.z[i0];
    const near = [];
    G.grid.collect(sx, sz, 14, near, R);
    const peds = near
      .filter((k) => Math.hypot(G.x[k] - sx, G.z[k] - sz) < 14)
      .filter((_, k) => k % 3 === 0)
      .slice(0, 16)
      .map((k) => {
        const p = createPed(C.blocks[G.block[k]], makeRng(k), {});
        p.x = G.x[k];
        p.z = G.z[k];
        return { p, x0: p.x, z0: p.z };
      });
    expect(peds.length).toBeGreaterThan(5);
    const world = pedWorld(nav, { threats: [{ x: sx, z: sz, radius: 30 }] });
    let maxUsed = 0;
    for (let t = 0; t < 7; t += dt) {
      nav.beginFrame(dt);
      if (t > 0.6) world.threats = [];
      for (const { p } of peds) stepPed(p, dt, world);
      maxUsed = Math.max(maxUsed, nav.used);
    }
    expect(maxUsed).toBeLessThanOrEqual(4);
    expect(nav.stats.flees).toBeGreaterThanOrEqual(peds.length);
    for (const { p, x0, z0 } of peds) {
      expect(Math.hypot(p.x - sx, p.z - sz)).toBeGreaterThan(Math.hypot(x0 - sx, z0 - sz) + 12);
      expect(Math.hypot(p.x - x0, p.z - z0)).toBeGreaterThan(10);
      expect(inBuilding(p.x, p.z)).toBe(false);
    }
  });

  it('van a un destino (tienda, paradero, casa) por la ruta y se quedan un rato en la puerta', { timeout: 120000 }, () => {
    const dt = 1 / 20;
    const nav = navOf(4);
    const rng = makeRng(21);
    let arrived = 0;
    let tooFar = 0;
    for (let t = 0; t < 8; t++) {
      const k = nav.pickDestination(C.spawn.x, C.spawn.z, rng.next, 40, 120, { tienda: 1, paradero: 1, casa: 1 });
      const from = Math.floor(rng.next() * 50);
      const near = [];
      G.grid.collect(C.spawn.x, C.spawn.z, 40, near, R);
      const s = near[from % near.length];
      const p = createPed(C.blocks[G.block[s]], makeRng(t), {});
      p.x = G.x[s];
      p.z = G.z[s];
      p.mode = 'goto';
      p.destIdx = k;
      p.timer = 300;
      const world = pedWorld(nav);
      for (let q = 0; q < 250 && p.mode === 'goto'; q += dt) {
        nav.beginFrame(dt);
        stepPed(p, dt, world);
      }
      if (p.mode === 'idle' && p.afterDest && Math.hypot(p.x - G.dest.x[k], p.z - G.dest.z[k]) < 1.5) arrived++;
      else if (p.mode === 'walk' && p.route.len > GOTO_MAX_ROUTE) tooFar++;
    }
    // Los que no llegan es porque la ruta daba demasiada vuelta (GOTO_MAX_ROUTE): siguen deambulando.
    expect(arrived + tooFar).toBe(8);
    expect(arrived).toBeGreaterThanOrEqual(5);
  });

  it('mucha gente: el costo por cuadro queda acotado por el presupuesto de búsquedas', () => {
    const dt = 1 / 30;
    const nav = navOf(4);
    const rng = makeRng(77);
    const near = [];
    G.grid.collect(C.spawn.x, C.spawn.z, 90, near, R);
    const peds = [];
    for (let k = 0; k < 150; k++) {
      const s = near[Math.floor(rng.next() * near.length)];
      const p = createPed(C.blocks[G.block[s]], rng, {});
      p.x = G.x[s];
      p.z = G.z[s];
      p.mode = k % 3 === 0 ? 'idle' : 'walk';
      p.timer = rng.next() * 3;
      peds.push(p);
    }
    const world = pedWorld(nav, { rand: rng.next });
    let worst = 0;
    let total = 0;
    let frames = 0;
    for (let t = 0; t < 12; t += dt) {
      nav.beginFrame(dt);
      world.threats = t > 4 && t < 4.6 ? [{ x: C.spawn.x, z: C.spawn.z, radius: 35 }] : [];
      const a = performance.now();
      for (const p of peds) stepPed(p, dt, world);
      const ms = performance.now() - a;
      total += ms;
      frames++;
      if (t > 1) worst = Math.max(worst, ms);
      expect(nav.used).toBeLessThanOrEqual(4);
    }
    const s = nav.stats;
    console.log(`150 peatones, 12 s: ${(total / frames).toFixed(3)} ms/cuadro (peor ${worst.toFixed(2)} ms); rutas ${s.searches} + huidas ${s.flees}, esperas ${s.waits}, caché ${s.hits}; búsquedas ${(s.ms / Math.max(1, s.searches + s.flees)).toFixed(3)} ms c/u, peor cuadro de búsquedas ${s.maxFrameMs.toFixed(2)} ms`);
    expect(s.searches + s.flees).toBeGreaterThan(20);
    expect(total / frames).toBeLessThan(6);
    expect(PED.run).toBeGreaterThan(PED.walk);
  });
});
