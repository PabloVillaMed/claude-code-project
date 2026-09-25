// Estación Caribe de la línea A del Metro de Medellín: dos vías a nivel con
// andenes laterales, un vestíbulo elevado sobre las vías con torniquetes, y
// el puente peatonal que cruza el río hacia Moravia. Accesible: escaleras y
// ascensores en cada andén, en el acceso occidental (Carrera 63) y en la
// llegada del puente al lado de Moravia.
// Aquí solo se describe la geometría (marco local a = a lo largo de la vía,
// c = hacia el oriente) y se registran los pisos caminables y las colisiones;
// render/metro.js la dibuja.

import { addWalkable, insideMap, onRoad, riverDistance, RIVER, terrainHeight, GRID, MAPA } from './terrain.js';
import { obbFromAxis } from './collision.js';
import { makeFrame } from './geom2d.js';

const STAIR_SLOPE = 0.58; // ~30°
const CLEAR = 7.2; // del riel al piso del vestíbulo

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
  const tr = st.track ?? 2.5;
  const yR = st.y;
  const yP = yR + 1.1;
  const yC = yR + CLEAR;
  const half = st.length / 2;
  const S = { frame: L, station: st, yR, yP, yC, platforms: [], stairs: [], elevators: [], fences: [], roofs: [], walls: [], turnstiles: [] };

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

  // ---- andenes laterales
  const pw = 4;
  for (const sgn of [1, -1]) {
    const c0 = sgn > 0 ? tr + 1.55 : -tr - 1.55 - pw;
    const r = { a0: -half, a1: half, c0, c1: c0 + pw, side: sgn };
    S.platforms.push(r);
    walk(r, () => yP);
    collide(r, yR - 2, yP);
    // Reja del borde exterior del andén.
    const cf = sgn > 0 ? r.c1 : r.c0;
    const fence = { a0: -half, a1: half, c0: cf - 0.06, c1: cf + 0.06 };
    S.fences.push({ ...fence, y0: yP, y1: yP + 2.2 });
    collide(fence, yR - 2, yP + 2.2);
    // Cubierta del andén.
    S.roofs.push({ a0: -half + 12, a1: half - 12, c0: r.c0 - 0.4, c1: r.c1 + 0.6, y: yP + 3.9, side: sgn });
  }

  // ---- vestíbulo sobre las vías
  const conc = { a0: -6, a1: 6, c0: -14, c1: 12 };
  S.concourse = conc;
  walk(conc, () => yC, true);
  collide(conc, yC - 0.7, yC);
  // Muros del vestíbulo (con vidrio arriba) salvo por donde entran puentes y escaleras.
  S.walls.push({ a0: -6, a1: -5.8, c0: -14, c1: 12, y0: yC, y1: yC + 3.2 });
  S.walls.push({ a0: 5.8, a1: 6, c0: -14, c1: 12, y0: yC, y1: yC + 3.2 });
  S.roofs.push({ a0: -7, a1: 7, c0: -15, c1: 13, y: yC + 3.4, flat: true });
  S.turnstiles = [-9.2, 9.2].map((c) => ({ c, a0: -5.2, a1: 5.2, y: yC }));

  // ---- escaleras y ascensores de cada andén al vestíbulo
  const run = (yC - yP) / STAIR_SLOPE;
  for (const p of S.platforms) {
    const c0 = p.side > 0 ? p.c0 + 0.9 : p.c1 - 3.1;
    const r = { a0: 6, a1: 6 + run, c0, c1: c0 + 2.2, y0: yC, y1: yP, dir: 1 };
    S.stairs.push(r);
    walk(r, (a) => yC - (a - r.a0) * STAIR_SLOPE);
    // Barandas laterales (no se entra de lado).
    for (const cc of [r.c0 - 0.1, r.c1 + 0.1]) collide({ a0: r.a0, a1: r.a1, c0: cc - 0.05, c1: cc + 0.05 }, yP - 0.5, yC + 1.1);
    // Bajo la escalera: cerrado.
    collide({ a0: r.a0 + 2, a1: r.a1, c0: r.c0, c1: r.c1 }, yP - 0.5, yP + 0.01);
    S.elevators.push(elevator(S, walk, collide, { a0: -7.9, a1: -6.1, c0: c0 + 0.2, c1: c0 + 2.0 }, yP, yC, [1, 0], [1, 0]));
  }

  // ---- acceso occidental (Carrera 63): escalera y ascensor al andén de la calle
  const yW = terrainHeight(...W(-10, -12.8)) + GRID.curb;
  const runW = (yC - yW) / STAIR_SLOPE;
  const west = { a0: -6 - runW, a1: -6, c0: -14, c1: -11.6, y0: yW, y1: yC, dir: -1 };
  S.stairs.push(west);
  walk(west, (a) => yC - (west.a1 - a) * STAIR_SLOPE);
  for (const cc of [west.c0 - 0.1, west.c1 + 0.1]) collide({ a0: west.a0, a1: west.a1, c0: cc - 0.05, c1: cc + 0.05 }, yW - 0.5, yC + 1.1);
  S.elevators.push(elevator(S, walk, collide, { a0: 6.1, a1: 7.9, c0: -13.8, c1: -12 }, yW, yC, [-1, 0], [1, 0]));

  // ---- puente peatonal sobre el río hacia Moravia
  let cE = 60;
  for (let c = 24; c < 140; c += 2) {
    const [x, z] = W(0, c);
    if (!insideMap(x, z)) break;
    if (riverDistance(x, z) > RIVER.half + RIVER.bank + 3 && !onRoad(x, z)) {
      cE = c;
      break;
    }
  }
  const bridge = { a0: -1.9, a1: 1.9, c0: 12, c1: cE };
  S.bridge = bridge;
  walk(bridge, () => yC, true);
  collide(bridge, yC - 0.9, yC);
  // Llegada del lado de Moravia: escalera hacia +a y ascensor al final.
  const yE = terrainHeight(...W(0, cE + 3)) + GRID.curb;
  const runE = Math.max(1, (yC - yE) / STAIR_SLOPE);
  const east = { a0: 1.9, a1: 1.9 + runE, c0: cE - 2.4, c1: cE, y0: yC, y1: yE, dir: 1 };
  S.stairs.push(east);
  walk(east, (a) => yC - (a - east.a0) * STAIR_SLOPE);
  for (const cc of [east.c0 - 0.1, east.c1 + 0.1]) collide({ a0: east.a0, a1: east.a1, c0: cc - 0.05, c1: cc + 0.05 }, yE - 0.5, yC + 1.1);
  S.elevators.push(elevator(S, walk, collide, { a0: -0.9, a1: 0.9, c0: cE, c1: cE + 1.8 }, yE, yC, [0, 1], [0, -1]));
  S.landing = { x: W(1.9 + runE + 2, cE - 1.2)[0], z: W(1.9 + runE + 2, cE - 1.2)[1] };
  S.westLanding = { x: W(west.a0 - 2, -12.8)[0], z: W(west.a0 - 2, -12.8)[1] };

  // Barandas del vestíbulo con vanos donde llegan escaleras, ascensores y el puente.
  S.rails = [];
  const railLine = (fixed, value, from, to, gaps) => {
    const gs = gaps.map(([g0, g1]) => [g0 - 0.1, g1 + 0.1]).sort((p, q) => p[0] - q[0]);
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
  const gapsAt = (edgeA) => [
    ...S.stairs.filter((r) => near(r.a0, edgeA) || near(r.a1, edgeA)).map((r) => [r.c0, r.c1]),
    ...S.elevators.filter((e) => near(e.a0, edgeA + 0.1) || near(e.a1, edgeA - 0.1)).map((e) => [e.c0, e.c1]),
  ];
  railLine('a', conc.a1, conc.c0, conc.c1, gapsAt(conc.a1));
  railLine('a', conc.a0, conc.c0, conc.c1, gapsAt(conc.a0));
  railLine('c', conc.c1, conc.a0, conc.a1, [[bridge.a0, bridge.a1]]);
  railLine('c', conc.c0, conc.a0, conc.a1, []);
  railLine('a', bridge.a0, bridge.c0, bridge.c1, []);
  railLine('a', bridge.a1, bridge.c0, bridge.c1, [[east.c0, east.c1]]);
  railLine('c', bridge.c1, bridge.a0, bridge.a1, [[-0.9, 0.9]]);

  // Pilas del puente cada ~12 m.
  S.piers = [];
  for (let c = 16; c < cE - 2; c += 12) S.piers.push({ a: 0, c });

  // Huella de la estación (para no construir casas ni poner utilería encima).
  const fp = (r, m = 1) => {
    const [x, z] = W((r.a0 + r.a1) / 2, (r.c0 + r.c1) / 2);
    return makeFrame(x, z, L.cx, L.cz, (r.a1 - r.a0) / 2 + m, (r.c1 - r.c0) / 2 + m);
  };
  S.footprints = [fp({ a0: -half, a1: half, c0: -9, c1: 9 }), fp(conc), fp(bridge), ...S.stairs.map((r) => fp(r)), ...S.elevators.map((e) => fp(e, 1.5))];

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
