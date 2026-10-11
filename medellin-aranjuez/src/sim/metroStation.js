// Estación Caribe de la línea A del Metro de Medellín, como la real: a nivel,
// dos vías con plataforma central, vestíbulo elevado sobre las vías con
// torniquetes, y dos puentes peatonales cubiertos: al occidente hacia la
// Terminal del Norte y al oriente, sobre el río, hacia Moravia. Accesible:
// escaleras (una eléctrica) y ascensor desde el andén, y escalera más
// ascensor en la llegada de cada puente.
// Aquí solo se describe la geometría (marco local a = a lo largo de la vía,
// c = hacia el oriente) y se registran los pisos caminables y las colisiones;
// render/metro.js la dibuja.

import { addWalkable, insideMap, onRoad, riverDistance, RIVER, terrainHeight, GRID, MAPA } from './terrain.js';
import { obbFromAxis } from './collision.js';
import { makeFrame } from './geom2d.js';

const STAIR_SLOPE = 0.58; // ~30°
const CLEAR = 7.4; // del riel al piso del vestíbulo

/** Rectángulo local [a0,a1]×[c0,c1] → caja orientada del mundo. */
function makeLocal(st) {
  const ax = st.dx;
  const az = st.dz;
  const cx = -st.dz;
  const cz = st.dx;
  const W = (a, c) => [st.x + ax * a + cx * c, st.z + az * a + cz * c];
  const toLocal = (x, z) => {
    const dx = x - st.x;
    const dz = z - st.z;
    return [dx * ax + dz * az, dx * cx + dz * cz];
  };
  const rectBounds = (r) => {
    const pts = [W(r.a0, r.c0), W(r.a1, r.c0), W(r.a1, r.c1), W(r.a0, r.c1)];
    const xs = pts.map((p) => p[0]);
    const zs = pts.map((p) => p[1]);
    return { minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs) };
  };
  const obb = (r) => {
    const [x, z] = W((r.a0 + r.a1) / 2, (r.c0 + r.c1) / 2);
    return obbFromAxis(x, z, ax, az, (r.a1 - r.a0) / 2, (r.c1 - r.c0) / 2);
  };
  return { W, toLocal, rectBounds, obb, ax, az, cx, cz };
}

/**
 * Describe la estación y registra lo caminable. Devuelve
 * {frame, yR, yP, yC, platforms, concourse, bridge, stairs, elevators, fences, roofs, turnstiles, landing, update(dt)}.
 */
export function buildMetroStation(city, st) {
  const L = makeLocal(st);
  const { W, toLocal, rectBounds } = L;
  const tr = st.track ?? 5.6; // medio entre ejes de vía
  const yR = st.y;
  const yP = yR + 1.1;
  const yC = yR + CLEAR;
  const half = st.length / 2;
  const S = { frame: L, station: st, yR, yP, yC, platforms: [], stairs: [], elevators: [], fences: [], roofs: [], walls: [], turnstiles: [], bridges: [], piers: [], rails: [] };

  const collide = (r, minY, maxY, kind = 'metro') => {
    const b = rectBounds(r);
    city.collision.add({ ...b, obb: L.obb(r), minY, maxY, kind });
  };
  const walk = (r, height, over = false) => {
    const b = rectBounds(r);
    addWalkable({
      ...b,
      over,
      height(x, z) {
        const [a, c] = toLocal(x, z);
        if (a < r.a0 || a > r.a1 || c < r.c0 || c > r.c1) return null;
        return height(a, c);
      },
    });
  };
  const stairRails = (r, yLow, yHigh) => {
    for (const cc of [r.c0 - 0.1, r.c1 + 0.1]) collide({ a0: r.a0, a1: r.a1, c0: cc - 0.05, c1: cc + 0.05 }, yLow - 0.5, yHigh + 1.1);
  };

  // ---- andén central (plataforma central entre las dos vías, como la Caribe real)
  const pc = tr - 1.6;
  const plat = { a0: -half, a1: half, c0: -pc, c1: pc, side: 0 };
  S.platforms.push(plat);
  walk(plat, () => yP);
  collide(plat, yR - 2, yP);
  S.roofs.push({ a0: -half + 10, a1: half - 10, c0: -pc - 0.6, c1: pc + 0.6, y: yP + 3.9, side: 0 });
  // Rejas del corredor a lado y lado de las vías (no se entra a pie a la vía).
  for (const sgn of [1, -1]) {
    const cf = sgn * (tr + 2.6);
    const fence = { a0: -half - 10, a1: half + 10, c0: cf - 0.06, c1: cf + 0.06 };
    S.fences.push({ ...fence, y0: terrainHeight(...W(0, cf)), y1: terrainHeight(...W(0, cf)) + 2.2 });
    collide(fence, yR - 3, yR + 4);
  }

  // ---- vestíbulo sobre las vías, con torniquetes a cada lado
  const conc = { a0: -6, a1: 6, c0: -12, c1: 12 };
  S.concourse = conc;
  walk(conc, () => yC, true);
  collide(conc, yC - 0.7, yC);
  S.roofs.push({ a0: -7, a1: 7, c0: -13, c1: 13, y: yC + 3.4, flat: true });
  S.turnstiles = [-8.5, 8.5].map((c) => ({ c, a0: -5.2, a1: 5.2, y: yC }));

  // ---- del andén al vestíbulo: dos tramos de escalera (uno de ellos eléctrica) y ascensor
  const run = (yC - yP) / STAIR_SLOPE;
  for (const [c0, kind] of [
    [0.35, 'escalera'],
    [-2.55, 'electrica'],
  ]) {
    const r = { a0: 6, a1: 6 + run, c0, c1: c0 + 2.2, y0: yC, y1: yP, dir: 1, kind };
    S.stairs.push(r);
    walk(r, (a) => yC - (a - r.a0) * STAIR_SLOPE);
    stairRails(r, yP, yC);
    collide({ a0: r.a0 + 2, a1: r.a1, c0: r.c0, c1: r.c1 }, yP - 0.5, yP + 0.01);
  }
  S.elevators.push(elevator(S, walk, collide, { a0: -7.9, a1: -6.1, c0: -0.9, c1: 0.9 }, yP, yC, [1, 0], [1, 0]));

  // ---- puentes peatonales cubiertos: al occidente (Terminal del Norte) y al oriente (Moravia, sobre el río)
  const landing = (sgn) => {
    let cEnd = sgn * 60;
    for (let c = 24; c < 150; c += 2) {
      const [x, z] = W(0, sgn * c);
      if (!insideMap(x, z)) break;
      void x;
      void z;
      // Tierra firme de al menos 10 m seguidos (no el separador de una avenida).
      const clear = (cc) => riverDistance(...W(0, cc)) > RIVER.half + RIVER.bank + 3 && !onRoad(...W(0, cc)) && !onRoad(...W(3, cc)) && !onRoad(...W(-3, cc));
      if ([0, 3, 6, 9].every((k) => clear(sgn * (c + k)))) {
        cEnd = sgn * c;
        break;
      }
    }
    return cEnd;
  };
  for (const [sgn, name] of [
    [1, 'Moravia'],
    [-1, 'Terminal del Norte'],
  ]) {
    const cE = landing(sgn);
    const c0 = sgn > 0 ? conc.c1 : cE;
    const c1 = sgn > 0 ? cE : conc.c0;
    const bridge = { a0: -1.9, a1: 1.9, c0, c1, name, sgn };
    S.bridges.push(bridge);
    walk(bridge, () => yC, true);
    collide(bridge, yC - 0.9, yC);
    // Llegada: escalera hacia +a (bajando) y ascensor en la punta.
    const [lx, lz] = W(4, cE - sgn * 1.2);
    const yE = terrainHeight(lx, lz) + GRID.curb;
    const runE = Math.max(1, (yC - yE) / STAIR_SLOPE);
    const sc0 = sgn > 0 ? cE - 2.4 : cE;
    const stair = { a0: 1.9, a1: 1.9 + runE, c0: sc0, c1: sc0 + 2.4, y0: yC, y1: yE, dir: 1, kind: 'escalera' };
    S.stairs.push(stair);
    walk(stair, (a) => yC - (a - stair.a0) * STAIR_SLOPE);
    stairRails(stair, yE, yC);
    const ec = sgn > 0 ? { c0: cE, c1: cE + 1.8 } : { c0: cE - 1.8, c1: cE };
    S.elevators.push(elevator(S, walk, collide, { a0: -0.9, a1: 0.9, ...ec }, yE, yC, [0, sgn], [0, -sgn]));
    bridge.stair = stair;
    const endPt = W(1.9 + runE + 2, sc0 + 1.2);
    bridge.landing = { x: endPt[0], z: endPt[1] };
    for (let c = Math.min(c0, c1) + 6; c < Math.max(c0, c1) - 2; c += 12) S.piers.push({ a: 0, c });
  }
  const east = S.bridges[0];
  const west = S.bridges[1];
  S.bridge = east;
  S.landing = east.landing;
  S.westLanding = west.landing;

  // Barandas del vestíbulo y de los puentes, con vanos donde llegan escaleras, ascensores y puentes.
  const railLine = (fixed, value, from, to, gaps) => {
    const gs = gaps.map(([g0, g1]) => [Math.min(g0, g1) - 0.1, Math.max(g0, g1) + 0.1]).sort((p, q) => p[0] - q[0]);
    let cur = from;
    for (const [g0, g1] of [...gs, [to, to]]) {
      if (g0 > cur + 0.2) {
        const r = fixed === 'a' ? { a0: value - 0.06, a1: value + 0.06, c0: cur, c1: Math.min(g0, to) } : { a0: cur, a1: Math.min(g0, to), c0: value - 0.06, c1: value + 0.06 };
        S.rails.push({ ...r, y: yC });
        collide(r, yC - 0.2, yC + 1.1);
      }
      cur = Math.max(cur, g1);
    }
  };
  const near = (x, y) => Math.abs(x - y) < 0.3;
  const gapsAt = (edgeA, cMin, cMax) => [
    ...S.stairs.filter((r) => (near(r.a0, edgeA) || near(r.a1, edgeA)) && r.c1 > cMin && r.c0 < cMax).map((r) => [r.c0, r.c1]),
    ...S.elevators.filter((e) => (near(e.a0, edgeA + 0.1) || near(e.a1, edgeA - 0.1)) && e.c1 > cMin && e.c0 < cMax).map((e) => [e.c0, e.c1]),
  ];
  railLine('a', conc.a1, conc.c0, conc.c1, gapsAt(conc.a1, conc.c0, conc.c1));
  railLine('a', conc.a0, conc.c0, conc.c1, gapsAt(conc.a0, conc.c0, conc.c1));
  railLine('c', conc.c1, conc.a0, conc.a1, [[east.a0, east.a1]]);
  railLine('c', conc.c0, conc.a0, conc.a1, [[west.a0, west.a1]]);
  for (const br of S.bridges) {
    const lo = Math.min(br.c0, br.c1);
    const hi = Math.max(br.c0, br.c1);
    railLine('a', br.a0, lo, hi, []);
    railLine('a', br.a1, lo, hi, [[br.stair.c0, br.stair.c1]]);
    const endC = br.sgn > 0 ? br.c1 : br.c0;
    railLine('c', endC, br.a0, br.a1, [[-0.9, 0.9]]);
  }

  // Huella de la estación (para no construir casas ni poner utilería encima).
  const fp = (r, m = 1) => {
    const [x, z] = W((r.a0 + r.a1) / 2, (r.c0 + r.c1) / 2);
    return makeFrame(x, z, L.cx, L.cz, (r.a1 - r.a0) / 2 + m, (r.c1 - r.c0) / 2 + m);
  };
  S.footprints = [fp({ a0: -half - 10, a1: half + 10, c0: -tr - 3, c1: tr + 3 }), fp(conc), ...S.bridges.map((r) => fp(r)), ...S.stairs.map((r) => fp(r)), ...S.elevators.map((e) => fp(e, 1.5))];

  S.update = (dt) => {
    for (const e of S.elevators) stepElevator(e, dt);
  };
  void MAPA;
  return S;
}

/**
 * Ascensor: cabina que sube y baja sola (espera abierta abajo y arriba).
 * `bottomDoor` / `topDoor` = lado abierto en (a, c) local, p. ej. [1, 0] = hacia +a.
 */
function elevator(S, walk, collide, r, y0, y1, bottomDoor, topDoor) {
  const e = { ...r, y0, y1, y: y0, v: 0, state: 'wait', timer: 4, target: y1, bottomDoor, topDoor, speed: 1.3 };
  walk(r, () => e.y + 0.02);
  // Cubo: muros en los lados sin puerta; en los lados con puerta, solo donde no hay vano.
  const sides = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];
  for (const [sa, sc] of sides) {
    const wall = sa
      ? { a0: sa > 0 ? r.a1 : r.a0 - 0.1, a1: sa > 0 ? r.a1 + 0.1 : r.a0, c0: r.c0, c1: r.c1 }
      : { a0: r.a0, a1: r.a1, c0: sc > 0 ? r.c1 : r.c0 - 0.1, c1: sc > 0 ? r.c1 + 0.1 : r.c0 };
    const isB = bottomDoor[0] === sa && bottomDoor[1] === sc;
    const isT = topDoor[0] === sa && topDoor[1] === sc;
    if (!isB && !isT) collide(wall, y0 - 0.5, y1 + 3);
    else if (isB && !isT) collide(wall, y0 + 2.3, y1 + 3);
    else if (isT && !isB) collide(wall, y0 - 0.5, y1 - 0.05);
    else collide(wall, y0 + 2.3, y1 - 0.05);
  }
  return e;
}

function stepElevator(e, dt) {
  if (e.state === 'wait') {
    e.timer -= dt;
    if (e.timer <= 0) e.state = 'move';
    return;
  }
  const dir = Math.sign(e.target - e.y);
  e.y += dir * e.speed * dt;
  if ((dir > 0 && e.y >= e.target) || (dir < 0 && e.y <= e.target)) {
    e.y = e.target;
    e.state = 'wait';
    e.timer = 6;
    e.target = e.target === e.y1 ? e.y0 : e.y1;
  }
}
