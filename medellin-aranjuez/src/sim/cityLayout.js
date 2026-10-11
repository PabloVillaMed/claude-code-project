// Generador determinista del mapa real entre Moravia y Aranjuez (Medellín).
// Las vías, manzanas, zonas verdes, canchas, iglesias, colegios, quebradas,
// el río y el metro vienen de OpenStreetMap (src/data/mapa.json, ver
// scripts/mapa/construir.mjs). Aquí se "construye" encima: casas lote a lote
// siguiendo el paramento de cada manzana (calles curvas y diagonales
// incluidas), lugares especiales, andenes con su utilería y la vida de barrio.

import { makeRng } from './rng.js';
import { MAPA, GRID, MAP_MAX_X, MAP_MAX_Z, MAP_MIN_X, MAP_MIN_Z, clearWalkables, insideMap, onRoad as onRoadCheck, roadAt, terrainHeight } from './terrain.js';
import { CollisionWorld, obbBounds, obbFromAxis } from './collision.js';
import { buildMetroStation } from './metroStation.js';
import {
  closestOnSeg,
  cumLengths,
  distToPolyEdge,
  frameBounds,
  frameCorners,
  frameHitsSegment,
  framesOverlap,
  makeFrame,
  pointAlong,
  pointInPoly,
  polyArea,
  polyBounds,
  polyCentroid,
  polyPerimeter,
} from './geom2d.js';
import { LOCALES } from './facades.js';

const FLOOR_H = 3;
export const PED_RADIUS = 0.35;

const PAINT_COLORS = [
  [0.93, 0.91, 0.86], // blanco hueso
  [0.96, 0.83, 0.45], // amarillo
  [0.55, 0.75, 0.86], // azul cielo
  [0.62, 0.82, 0.6], // verde menta
  [0.95, 0.65, 0.6], // salmón
  [0.97, 0.62, 0.3], // naranja
  [0.83, 0.55, 0.78], // lila
  [0.35, 0.62, 0.72], // azul petróleo
  [0.9, 0.36, 0.33], // rojo
];

/**
 * Nombre de la vía para el HUD: el de OpenStreetMap y, si lo tiene, su nombre
 * tradicional ("Carrera 52 · Carabobo"). Las placas de las esquinas llevan
 * solo la nomenclatura (`edge.plate`).
 */
export function roadName(edge) {
  if (!edge.name) return edge.cls === 'service' ? 'Callejón' : 'Vía del barrio';
  return edge.alt && edge.alt !== edge.name ? `${edge.name} · ${edge.alt}` : edge.name;
}

// Moravia: al occidente de Carabobo, entre la Calle 77 y la 90, hasta el río.
const MORAVIA_ZONE = { minX: -760, maxX: -430, minZ: -250, maxZ: 560 };
export function isMoraviaPoint(x, z) {
  return x > MORAVIA_ZONE.minX && x < MORAVIA_ZONE.maxX && z > MORAVIA_ZONE.minZ && z < MORAVIA_ZONE.maxZ;
}

// Zonas donde no se construyen casas comunes (se generan aparte).
const RESERVED_KINDS = new Set(['parque', 'cancha', 'iglesia', 'colegio', 'salud', 'museo', 'verde', 'cementerio']);

export function generateCity(seed = 4) {
  const rng = makeRng(seed);
  const city = {
    seed,
    bounds: { minX: MAP_MIN_X, maxX: MAP_MAX_X, minZ: MAP_MIN_Z, maxZ: MAP_MAX_Z },
    nodes: [],
    edges: [],
    paths: [],
    blocks: [],
    areas: [],
    water: [],
    buildings: [],
    props: [],
    pois: [],
    parkedVehicles: [],
    metro: null,
    collision: new CollisionWorld(24),
  };

  clearWalkables();
  buildGraph(city);
  buildBlocks(city);
  city.water = MAPA.water.filter((w) => !w.tunnel);
  // Senderos reales: peatonales, escalas, caminos y ciclorrutas de OpenStreetMap.
  city.foot = (MAPA.foot ?? []).map((f) => ({ kind: f.k, width: f.w, name: f.n ?? '', pts: f.pts }));
  const ctx = { city, rng };
  const excl = exclusions(city);
  ctx.excl = excl;

  // El metro primero (su estación reserva espacio), luego los lugares
  // especiales y por último las casas.
  addMetro(ctx);
  ctx.station = city.metro.geo?.footprints ?? [];
  city.inStation = (x, z) => ctx.station.some((f) => Math.abs((x - f.x) * f.ux + (z - f.z) * f.uz) < f.hu && Math.abs((x - f.x) * f.nx + (z - f.z) * f.nz) < f.hv);
  // Primero los edificios reales (huellas de OpenStreetMap), luego los
  // lugares especiales y por último las casas procedurales donde no hay huellas.
  placeRealBuildings(ctx);
  buildSpecialAreas(ctx);
  for (const block of city.blocks) {
    if (block.type !== 'residencial') continue;
    fillBlock(ctx, block);
  }
  for (const block of city.blocks) addSidewalkProps(ctx, block);
  addGreenery(ctx);
  addPowerLines(ctx);
  placeServices(ctx);
  placeLocales(ctx);

  // Colisiones de edificios y estructuras sólidas.
  for (const b of city.buildings) {
    if (b.collide === false) continue;
    const f = b.frame;
    city.collision.add({ obb: obbFromAxis(f.x, f.z, f.ux, f.uz, f.hu, f.hv), minY: b.baseY, maxY: b.topY + (b.tower ? 6 : 0), kind: 'building' });
  }
  for (const p of city.props) addPropCollider(city, p);

  const parque = city.pois.find((p) => p.id === 'parque');
  city.spawn = { ...sidewalkNear(city, parque.x, parque.z + 18), yaw: 0 };
  city.hospital = city.pois.find((p) => p.id === 'hospital');
  addStreetLife(city, makeRng(seed + 777));
  // Nada de motos parqueadas sobre la estación del metro ni metidas en un edificio.
  city.parkedVehicles = city.parkedVehicles.filter((v) => !city.inStation(v.x, v.z) && !city.collision.pointBlocked(v.x, v.z));
  return city;
}

function addPropCollider(city, p) {
  if (!p.collider) return;
  const c = p.collider;
  city.collision.add({ minX: p.x - c.hx, maxX: p.x + c.hx, minZ: p.z - c.hz, maxZ: p.z + c.hz, minY: c.minY ?? -1000, maxY: c.maxY ?? 1000, kind: p.type });
}

// ------------------------------------------------------------------ grafo vial
function buildGraph(city) {
  city.nodes = MAPA.nodes.map((n, id) => ({ id, x: n.x, z: n.z, links: [], active: false }));
  for (const e of MAPA.edges) {
    const pts = e.pts;
    const cum = cumLengths(pts);
    const edge = {
      id: e.car ? city.edges.length : -1,
      a: e.a,
      b: e.b,
      pts,
      cum,
      length: cum[cum.length - 1],
      name: e.name,
      alt: e.alt ?? '',
      cls: e.cls,
      width: e.w,
      lanes: e.lanes,
      oneway: e.oneway,
      bridge: !!e.bridge,
    };
    edge.plate = roadName({ name: e.name, cls: e.cls });
    edge.name = roadName(edge);
    if (!e.car) {
      city.paths.push(edge);
      continue;
    }
    if (edge.length < 0.5) continue;
    edge.id = city.edges.length;
    city.edges.push(edge);
    city.nodes[e.a].links.push({ node: e.b, edge: edge.id, dir: 1 });
    city.nodes[e.b].links.push({ node: e.a, edge: edge.id, dir: -1 });
  }
  // Solo la red conectada más grande (sin tramos sueltos del borde).
  const seen = new Int32Array(city.nodes.length).fill(-1);
  let bestComp = -1;
  let bestSize = 0;
  let comp = 0;
  for (const n of city.nodes) {
    if (seen[n.id] >= 0 || !n.links.length) continue;
    const stack = [n.id];
    seen[n.id] = comp;
    let size = 0;
    while (stack.length) {
      const id = stack.pop();
      size++;
      for (const l of city.nodes[id].links) {
        if (seen[l.node] < 0) {
          seen[l.node] = comp;
          stack.push(l.node);
        }
      }
    }
    if (size > bestSize) {
      bestSize = size;
      bestComp = comp;
    }
    comp++;
  }
  for (const n of city.nodes) n.active = seen[n.id] === bestComp;
  for (const e of city.edges) e.active = city.nodes[e.a].active;
}

// ------------------------------------------------------------------ manzanas
function buildBlocks(city) {
  for (const b of MAPA.blocks) {
    const bounds = polyBounds(b.curb);
    const [cx, cz] = b.c;
    if (!insideMap(cx, cz, 50)) continue;
    const block = {
      id: city.blocks.length,
      src: b.id,
      cx,
      cz,
      area: b.area,
      curb: b.curb,
      rings: b.ring.filter((r) => Math.abs(polyArea(r)) > 12),
      lots: b.lot.filter((l) => Math.abs(polyArea(l)) > 20),
      ...bounds,
      type: 'residencial',
      name: '',
    };
    block.ring = block.rings[0] ?? null;
    block.informal = isMoraviaPoint(cx, cz);
    block.osm = b.osm ?? 0; // fracción del lote cubierta por huellas reales de OpenStreetMap
    city.blocks.push(block);
  }
  const bySrc = new Map(city.blocks.map((b) => [b.src, b]));
  for (const a of MAPA.areas) {
    const block = bySrc.get(a.block) ?? null;
    city.areas.push({ ...a, block });
  }
  // Río y separadores: manzanas sin andén útil o atravesadas por el río.
  const river = MAPA.water.find((w) => /Medell/i.test(w.name));
  for (const b of city.blocks) {
    if (!b.ring || !b.lots.length) b.type = 'separador';
    // Manzana cuyo andén cae sobre vías que no la delimitan (bordes del mapa): no es manzana útil.
    else if (b.ring.filter(([x, z]) => onRoadCheck(x, z)).length > b.ring.length * 0.25) b.type = 'separador';
    if (river && river.pts.some(([x, z]) => pointInPoly(x, z, b.curb))) b.type = 'rio';
  }
  // Cruces peatonales: vértices de andenes de manzanas vecinas junto a cada
  // intersección, unidos si la línea entre ellos cruza calzada.
  crossings(city);
}

function crossings(city) {
  const verts = [];
  for (const b of city.blocks) {
    if (!b.ring) continue;
    b.ring.forEach(([x, z], i) => verts.push({ b, i, x, z }));
  }
  const cell = 16;
  const grid = new Map();
  const k = (x, z) => `${Math.floor(x / cell)},${Math.floor(z / cell)}`;
  for (const v of verts) {
    const key = k(v.x, v.z);
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key).push(v);
  }
  for (const b of city.blocks) b.cross = new Map();
  for (const n of city.nodes) {
    if (!n.active || n.links.length < 2) continue;
    const near = [];
    for (let di = -1; di <= 1; di++) {
      for (let dj = -1; dj <= 1; dj++) {
        for (const v of grid.get(`${Math.floor(n.x / cell) + di},${Math.floor(n.z / cell) + dj}`) ?? []) {
          if (Math.hypot(v.x - n.x, v.z - n.z) < 15) near.push(v);
        }
      }
    }
    // Por manzana, el vértice más cercano al nodo (la esquina).
    const corner = new Map();
    for (const v of near) {
      const d = Math.hypot(v.x - n.x, v.z - n.z);
      const c = corner.get(v.b);
      if (!c || d < c.d) corner.set(v.b, { ...v, d });
    }
    const cs = [...corner.values()];
    for (let i = 0; i < cs.length; i++) {
      for (let j = i + 1; j < cs.length; j++) {
        const a = cs[i];
        const c = cs[j];
        const len = Math.hypot(a.x - c.x, a.z - c.z);
        if (len > 18 || len < 3) continue;
        if (!onRoadCheck((a.x + c.x) / 2, (a.z + c.z) / 2)) continue;
        a.b.cross.set(a.i, [...(a.b.cross.get(a.i) ?? []), { block: c.b.id, i: c.i }]);
        c.b.cross.set(c.i, [...(c.b.cross.get(c.i) ?? []), { block: a.b.id, i: a.i }]);
      }
    }
  }
}

// Obstáculos donde no se construye: quebradas a cielo abierto, corredor del
// metro y senderos peatonales reales (pasajes y escalas entre las casas).
// `rReal`: holgura para los edificios reales de OpenStreetMap, que ya están
// donde están (solo se evita que tapen el cauce, los muros o la vía férrea).
function exclusions(city) {
  const segs = [];
  for (const w of city.water) {
    for (let i = 1; i < w.pts.length; i++) segs.push({ a: w.pts[i - 1], b: w.pts[i], r: w.kind === 'canal' ? 16 : 4, rReal: /Medell/i.test(w.name) ? 25 : w.kind === 'canal' ? 3.3 : 2.1 });
  }
  for (const r of MAPA.rail) {
    for (let i = 1; i < r.pts.length; i++) segs.push({ a: r.pts[i - 1], b: r.pts[i], r: r.bridge ? 4 : 9, rReal: r.bridge ? 3.5 : 6 });
  }
  for (const f of city.foot) {
    for (let i = 1; i < f.pts.length; i++) segs.push({ a: f.pts[i - 1], b: f.pts[i], r: f.w / 2 + 0.4, rReal: 0 });
  }
  const cell = 32;
  const grid = new Map();
  for (const s of segs) {
    const minX = Math.min(s.a[0], s.b[0]) - s.r;
    const maxX = Math.max(s.a[0], s.b[0]) + s.r;
    const minZ = Math.min(s.a[1], s.b[1]) - s.r;
    const maxZ = Math.max(s.a[1], s.b[1]) + s.r;
    for (let i = Math.floor(minX / cell); i <= Math.floor(maxX / cell); i++) {
      for (let j = Math.floor(minZ / cell); j <= Math.floor(maxZ / cell); j++) {
        const key = `${i},${j}`;
        if (!grid.has(key)) grid.set(key, []);
        grid.get(key).push(s);
      }
    }
  }
  return {
    hits(frame, extra = 0, real = false) {
      const bb = frameBounds(frame);
      const seen = new Set();
      for (let i = Math.floor(bb.minX / cell); i <= Math.floor(bb.maxX / cell); i++) {
        for (let j = Math.floor(bb.minZ / cell); j <= Math.floor(bb.maxZ / cell); j++) {
          for (const s of grid.get(`${i},${j}`) ?? []) {
            if (seen.has(s)) continue;
            seen.add(s);
            const r = real ? s.rReal : s.r;
            if (r <= 0) continue;
            const cx = frame.x;
            const cz = frame.z;
            const c = closestOnSeg(cx, cz, s.a[0], s.a[1], s.b[0], s.b[1]);
            if (Math.sqrt(c.d2) < r + Math.hypot(frame.hu, frame.hv) + extra) {
              // Prueba fina: esquinas y centro contra el segmento engrosado.
              for (const [x, z] of [...frameCorners(frame), [cx, cz]]) {
                const q = closestOnSeg(x, z, s.a[0], s.a[1], s.b[0], s.b[1]);
                if (Math.sqrt(q.d2) < r + extra) return true;
              }
              const mid = closestOnSeg(cx, cz, s.a[0], s.a[1], s.b[0], s.b[1]);
              const lx = mid.x - cx;
              const lz = mid.z - cz;
              if (Math.abs(lx * frame.ux + lz * frame.uz) < frame.hu && Math.abs(lx * frame.nx + lz * frame.nz) < frame.hv) return true;
            }
          }
        }
      }
      return false;
    },
  };
}

// ------------------------------------------------------------------ casas
function footprintHeights(frame) {
  const pts = [...frameCorners(frame), [frame.x, frame.z]];
  const hs = pts.map(([x, z]) => terrainHeight(x, z));
  return { min: Math.min(...hs), max: Math.max(...hs) };
}

/**
 * Agrega un edificio sobre un rectángulo orientado `frame` (ver geom2d.makeFrame).
 * Su fachada principal ("S") da a la calle (normal del marco).
 */
function addBuilding(ctx, frame, b) {
  const fh = footprintHeights(frame);
  const floors = b.floors ?? 2;
  const baseY = fh.min - 0.6;
  const groundY = fh.max + GRID.curb;
  const topY = b.topY ?? groundY + (b.height ?? floors * FLOOR_H);
  const bb = frameBounds(frame);
  const building = {
    style: 'ladrillo',
    color: [1, 1, 1],
    roof: 'terraza',
    uvOffset: ctx.rng.next(),
    front: 'S',
    ...b,
    frame,
    ...bb,
    floors,
    baseY,
    groundY,
    topY,
  };
  ctx.city.buildings.push(building);
  return building;
}

function pickHouseStyle(rng) {
  const r = rng.next();
  if (r < 0.48) return 'ladrillo';
  if (r < 0.83) return 'pintada';
  return 'tienda';
}

function pickInformalStyle(rng) {
  const r = rng.next();
  if (r < 0.78) return 'ladrillo';
  if (r < 0.9) return 'pintada';
  return 'tienda';
}

function houseColor(rng, style) {
  if (style === 'ladrillo') {
    const v = rng.range(0.85, 1.05);
    return [v, v * rng.range(0.92, 1), v * rng.range(0.88, 1)];
  }
  return rng.pick(PAINT_COLORS);
}

/** Tipo de techo: terrazas y planchas en lo nuevo, teja de barro en lo viejo, zinc en Moravia. */
function pickRoof(rng, floors, informal) {
  const r = rng.next();
  if (informal) return r < 0.45 ? 'zinc' : r < 0.78 ? 'plancha' : r < 0.95 ? 'terraza' : 'dosAguas';
  if (floors <= 2) return r < 0.34 ? 'dosAguas' : r < 0.5 ? 'cuatroAguas' : r < 0.62 ? 'zinc' : r < 0.82 ? 'terraza' : 'plancha';
  return r < 0.55 ? 'terraza' : r < 0.78 ? 'plancha' : r < 0.9 ? 'dosAguas' : 'cuatroAguas';
}

/** ¿El rectángulo cabe en el lote, lejos de las zonas reservadas y obstáculos? */
function frameFits(ctx, block, lot, frame, placed, reserved) {
  // Esquinas ligeramente hacia adentro (el frente queda sobre el paramento).
  const corners = frameCorners(frame).map(([x, z]) => [x + (frame.x - x) * 0.04, z + (frame.z - z) * 0.04]);
  for (const [x, z] of corners) if (!pointInPoly(x, z, lot)) return false;
  // Nunca sobre la calzada (las manzanas del borde del mapa pueden venir mal cerradas).
  if (onRoadCheck(frame.x, frame.z)) return false;
  for (const [x, z] of corners) if (onRoadCheck(x, z)) return false;
  // Ni encima del camino de los peatones (en empalmes agudos el anillo se acerca al lote).
  if (ringBlocked(block, frame, PED_RADIUS + 0.1)) return false;
  // Ni pegada a un edificio real (ahí la cuadra ya está mapeada).
  if (nearReal(ctx, frame, 'front')) return false;
  for (const o of placed) if (framesOverlap(frame, o, 0.02)) return false;
  for (const r of reserved) {
    if (pointInPoly(frame.x, frame.z, r)) return false;
    for (const [x, z] of corners) if (pointInPoly(x, z, r)) return false;
  }
  if (ctx.excl.hits(frame)) return false;
  for (const f of ctx.station ?? []) if (framesOverlap(frame, f, 0)) return false;
  return true;
}

/** ¿Algún tramo del anillo peatonal de la manzana pasa a menos de `r` del rectángulo? */
function ringBlocked(block, frame, r) {
  const ring = block.ring;
  if (!ring) return false;
  const bb = frameBounds(frame);
  for (let i = 0, n = ring.length; i < n; i++) {
    const [ax, az] = ring[i];
    const [bx, bz] = ring[(i + 1) % n];
    if (Math.max(ax, bx) < bb.minX - r || Math.min(ax, bx) > bb.maxX + r || Math.max(az, bz) < bb.minZ - r || Math.min(az, bz) > bb.maxZ + r) continue;
    if (frameHitsSegment(frame, ax, az, bx, bz, r)) return true;
  }
  return false;
}

/** Recorridos del paramento: tramos casi rectos entre esquinas (cambios de rumbo > 28°). */
function lotRuns(lot) {
  const n = lot.length;
  const dir = (i) => {
    const [ax, az] = lot[i];
    const [bx, bz] = lot[(i + 1) % n];
    const l = Math.hypot(bx - ax, bz - az) || 1e-9;
    return [(bx - ax) / l, (bz - az) / l, l];
  };
  const corner = new Array(n).fill(false);
  for (let i = 0; i < n; i++) {
    const [px, pz] = dir((i - 1 + n) % n);
    const [qx, qz] = dir(i);
    const dot = px * qx + pz * qz;
    corner[i] = dot < Math.cos((28 * Math.PI) / 180);
  }
  let start = corner.findIndex((c) => c);
  if (start < 0) start = 0;
  const runs = [];
  let cur = [lot[start]];
  for (let k = 1; k <= n; k++) {
    const i = (start + k) % n;
    cur.push(lot[i]);
    if (corner[i] || k === n) {
      if (cur.length >= 2) runs.push(cur);
      cur = [lot[i]];
    }
  }
  return runs;
}

// ------------------------------------------------------------------ edificios reales
// Zonas con edificio propio (iglesias, museo) o sin edificios (parques,
// canchas, parqueaderos…): ahí no van huellas sueltas. Colegios y salud sí
// usan sus bloques reales en vez del bloque genérico.
const REAL_SKIP_KINDS = new Set(['parque', 'cancha', 'iglesia', 'museo', 'verde', 'cementerio', 'parqueadero']);
/** Margen alrededor de cada edificio real donde no se agregan casas procedurales (frente / fondos). */
const REAL_NEAR_FRONT = 2.5;
const REAL_NEAR_BACK = 6;

/** Estilo, pisos y techo de un edificio real según su tipo en OpenStreetMap y el barrio. */
function realAttrs(rng, rec, informal, area) {
  const lv = rec.lv ?? 0;
  const inst = (style, floors, color) => ({ style, floors: lv || floors, color, roof: 'terraza', tank: false, balcony: false });
  switch (rec.k) {
    case 'colegio':
      return inst('institucional', rng.int(2, 3), [0.93, 0.9, 0.82]);
    case 'salud':
      return inst('hospital', 3, [0.94, 0.95, 0.96]);
    case 'civico':
      return inst('institucional', rng.int(2, 3), [0.9, 0.88, 0.84]);
    case 'terminal':
      return inst('institucional', 2, [0.82, 0.82, 0.8]);
    case 'iglesia':
      return { style: 'iglesia', floors: 2, height: area > 500 ? 13 : 8, color: [0.95, 0.92, 0.84], roof: 'dosAguas' };
    case 'bodega':
      return { style: 'taller', floors: 1, height: rng.range(5, 7), color: [0.55, 0.6, 0.65], roof: 'zinc' };
    case 'comercio':
      if (area > 400) return inst('institucional', lv || 2, [0.95, 0.94, 0.9]);
      break;
    case 'apto':
    case 'obra':
      if (!informal) {
        const floors = lv || rng.int(6, 12);
        return { style: floors >= 5 ? 'torre' : 'pintada', floors, color: houseColor(rng, 'pintada'), roof: 'terraza', tank: false, balcony: floors < 5 };
      }
      break;
    default:
      break;
  }
  // Casas: las mismas proporciones que las procedurales del barrio.
  let floors = lv || rng.int(informal ? 1 : 2, 4);
  if (!lv && !informal && area > 120 && rng.chance(0.07)) floors = rng.int(5, 9);
  if (!lv && area > 350) floors = Math.max(floors, rng.int(2, 4));
  if (informal) floors = Math.min(floors, 5); // en Moravia no hay torres
  let style = floors >= 6 ? 'torre' : informal ? pickInformalStyle(rng) : pickHouseStyle(rng);
  if (rec.k === 'comercio') style = 'tienda';
  return {
    floors,
    style,
    color: houseColor(rng, style),
    tank: floors < 6 && rng.chance(0.55),
    roof: floors >= 6 ? 'terraza' : pickRoof(rng, floors, informal),
    balcony: floors >= 3 && rng.chance(informal ? 0.2 : 0.5),
  };
}

/**
 * Edificios reales: cada huella de OpenStreetMap (ya ajustada a rectángulos
 * en scripts/mapa/construir.mjs) se pone donde está, con su frente hacia la
 * calle. Deja en ctx.realGrid los marcos inflados que frenan el relleno
 * procedural en lo ya mapeado (de esta manzana o de la vecina).
 */
function placeRealBuildings(ctx) {
  const { city, rng } = ctx;
  ctx.realGrid = new Map();
  const bySrc = new Map(city.blocks.map((b) => [b.src, b]));
  const areasByBlock = new Map();
  for (const a of city.areas) {
    if (!a.block) continue;
    if (!areasByBlock.has(a.block)) areasByBlock.set(a.block, []);
    areasByBlock.get(a.block).push(a);
  }
  for (const rec of MAPA.buildings ?? []) {
    const block = bySrc.get(rec.b);
    if (!block || block.type !== 'residencial') continue;
    const informal = block.informal;
    const areas = areasByBlock.get(block) ?? [];
    let attrs = null;
    let attrsInst = null;
    for (const r of rec.r) {
      const [x, z, nx, nz, hu, hv, inner] = r;
      const frame = makeFrame(x, z, nx, nz, hu, hv);
      const pts = [...frameCorners(frame).map(([px, pz]) => [px + (x - px) * 0.04, pz + (z - pz) * 0.04]), [x, z]];
      // Zona especial: colegios y salud usan sus bloques reales; lo demás se respeta.
      const zone = areas.find((a) => pointInPoly(x, z, a.poly));
      if (zone && REAL_SKIP_KINDS.has(zone.kind)) continue;
      if (areas.some((a) => REAL_SKIP_KINDS.has(a.kind) && pts.some(([px, pz]) => pointInPoly(px, pz, a.poly)))) continue;
      if (pts.some(([px, pz]) => onRoadCheck(px, pz))) continue;
      if (ctx.excl.hits(frame, 0, true)) continue;
      if ((ctx.station ?? []).some((f) => framesOverlap(frame, f, 0))) continue;
      const inst = zone && (zone.kind === 'colegio' || zone.kind === 'salud');
      const a = inst ? (attrsInst ??= realAttrs(rng, { ...rec, k: zone.kind }, informal, rec.a ?? 0)) : (attrs ??= realAttrs(rng, rec, informal, rec.a ?? 4 * hu * hv));
      const interiorHouse = inner && ['ladrillo', 'pintada', 'tienda'].includes(a.style);
      // Un local no cabe en un frente de menos de 3.4 m.
      const narrowShop = a.style === 'tienda' && hu < 1.7;
      const b = addBuilding(ctx, frame, {
        ...a,
        ...(narrowShop ? { style: 'pintada' } : {}),
        ...(interiorHouse ? { style: 'ladrillo', interior: true, balcony: false } : {}),
        informal,
        block: block.id,
        osm: true,
      });
      if (inner) b.interior = true;
      if (inst) zone.real = (zone.real ?? []).concat(b);
      const near = { front: makeFrame(x, z, nx, nz, hu + REAL_NEAR_FRONT, hv + REAL_NEAR_FRONT), back: makeFrame(x, z, nx, nz, hu + REAL_NEAR_BACK, hv + REAL_NEAR_BACK) };
      const bb = frameBounds(near.back);
      for (let i = Math.floor(bb.minX / REAL_CELL); i <= Math.floor(bb.maxX / REAL_CELL); i++) {
        for (let j = Math.floor(bb.minZ / REAL_CELL); j <= Math.floor(bb.maxZ / REAL_CELL); j++) {
          const k = `${i},${j}`;
          if (!ctx.realGrid.has(k)) ctx.realGrid.set(k, []);
          ctx.realGrid.get(k).push(near);
        }
      }
    }
  }
}

const REAL_CELL = 24;
/** ¿El rectángulo cae en el margen de algún edificio real ('front' angosto, 'back' amplio)? */
function nearReal(ctx, f, which) {
  if (!ctx.realGrid?.size) return false;
  const bb = frameBounds(f);
  for (let i = Math.floor(bb.minX / REAL_CELL); i <= Math.floor(bb.maxX / REAL_CELL); i++) {
    for (let j = Math.floor(bb.minZ / REAL_CELL); j <= Math.floor(bb.maxZ / REAL_CELL); j++) {
      for (const n of ctx.realGrid.get(`${i},${j}`) ?? []) if (framesOverlap(f, n[which], 0)) return true;
    }
  }
  return false;
}

function fillBlock(ctx, block, opts = {}) {
  const { rng } = ctx;
  const informal = block.informal;
  const reserved = ctx.city.areas.filter((a) => a.block === block && RESERVED_KINDS.has(a.kind)).map((a) => a.poly);
  // Donde hay edificios reales cerca no se inventan casas (solo se completa
  // lo que no está mapeado): ver nearReal en frameFits.
  const placed = [];
  for (const lot of block.lots) {
    const A = polyArea(lot);
    if (Math.abs(A) < 40) continue;
    const runs = lotRuns(lot);
    // Normal hacia adentro: a la izquierda o derecha según la orientación del polígono.
    const inwardSign = A > 0 ? 1 : -1;
    for (const run of runs) {
      const cum = cumLengths(run);
      const L = cum[cum.length - 1];
      if (L < 3.5) continue;
      let s = 0;
      while (s < L - 3) {
        let w = informal ? rng.range(4.2, 7.5) : rng.range(5.5, 10.5);
        if (L - (s + w) < 3.5) w = L - s;
        if (w < 3.2) break;
        if (!opts.noGaps && rng.chance(informal ? 0.01 : 0.04)) {
          s += Math.min(w, 4);
          continue;
        }
        const p0 = pointAlong(run, cum, s);
        const p1 = pointAlong(run, cum, s + w);
        const fx = p1.x - p0.x;
        const fz = p1.z - p0.z;
        const fl = Math.hypot(fx, fz);
        if (fl < 3) {
          s += w;
          continue;
        }
        const tx = fx / fl;
        const tz = fz / fl;
        // Normal hacia la calle (afuera del lote).
        const inx = -tz * inwardSign;
        const inz = tx * inwardSign;
        let depth = informal ? rng.range(8, 13) : rng.range(10, 16);
        let floors = rng.int(opts.minFloors ?? (informal ? 1 : 2), opts.maxFloors ?? (informal ? 4 : 4));
        if (!informal && rng.chance(0.07)) floors = rng.int(5, 9);
        let frame = null;
        for (let tries = 0; tries < 3 && !frame; tries++) {
          const mx = (p0.x + p1.x) / 2 + inx * (depth / 2);
          const mz = (p0.z + p1.z) / 2 + inz * (depth / 2);
          const f = makeFrame(mx, mz, -inx, -inz, fl / 2 - 0.02, depth / 2);
          if (frameFits(ctx, block, lot, f, placed, reserved)) frame = f;
          else depth *= 0.72;
          if (depth < 5.5) break;
        }
        if (frame) {
          placed.push(frame);
          const style = floors >= 6 ? 'torre' : informal ? pickInformalStyle(rng) : pickHouseStyle(rng);
          addBuilding(ctx, frame, {
            floors,
            style,
            color: houseColor(rng, style),
            tank: floors < 6 && rng.chance(0.55),
            roof: floors >= 6 ? 'terraza' : pickRoof(rng, floors, informal),
            balcony: floors >= 3 && rng.chance(informal ? 0.2 : 0.5),
            informal,
            block: block.id,
          });
        }
        s += w;
      }
    }
    // Fondos de manzana: casas interiores (se ven desde arriba y desde las lomas).
    // Si la manzana ya está casi toda mapeada, sus patios son reales: no se rellenan.
    if (block.osm >= 0.5) continue;
    const bb = polyBounds(lot);
    // Moravia es un tejido apretado de casas pegadas; Aranjuez deja patios.
    const step = informal ? 7.2 : 9;
    for (let x = bb.minX + step / 2; x < bb.maxX; x += step) {
      for (let z = bb.minZ + step / 2; z < bb.maxZ; z += step) {
        if (!pointInPoly(x, z, lot) || distToPolyEdge(x, z, lot) < (informal ? 5 : 6)) continue;
        if (rng.chance(informal ? 0.05 : 0.15)) continue; // patio
        const size = informal ? rng.range(3.1, 3.6) : rng.range(3.2, 4.4);
        // Alineada con el paramento más cercano.
        let best = null;
        for (let i = 0; i < lot.length; i++) {
          const [ax, az] = lot[i];
          const [bx2, bz2] = lot[(i + 1) % lot.length];
          const c = closestOnSeg(x, z, ax, az, bx2, bz2);
          if (!best || c.d2 < best.d2) best = { d2: c.d2, dx: bx2 - ax, dz: bz2 - az };
        }
        const l = Math.hypot(best.dx, best.dz) || 1;
        const jitter = informal ? 0.3 : 1;
        const f = makeFrame(x + rng.range(-jitter, jitter), z + rng.range(-jitter, jitter), -best.dz / l, best.dx / l, size, size * rng.range(0.9, 1.1));
        // Con pocas huellas mapeadas (Moravia) el fondo sigue siendo denso: solo se respeta el margen corto.
        if (nearReal(ctx, f, block.osm >= 0.3 ? 'back' : 'front')) continue;
        if (!frameFits(ctx, block, lot, f, placed, reserved)) continue;
        placed.push(f);
        const floors = rng.int(1, informal ? 4 : 3);
        addBuilding(ctx, f, { floors, style: 'ladrillo', color: houseColor(rng, 'ladrillo'), roof: pickRoof(rng, floors, informal), interior: true, tank: rng.chance(0.4), informal, block: block.id });
      }
    }
  }
}

// ------------------------------------------------------------------ lugares especiales
function areaFrame(poly, inset = 0) {
  // Rectángulo orientado que mejor cubre el polígono (por su arista más larga).
  let best = null;
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const [ax, az] = poly[i];
    const [bx, bz] = poly[(i + 1) % n];
    const l = Math.hypot(bx - ax, bz - az);
    if (l < 1) continue;
    const ux = (bx - ax) / l;
    const uz = (bz - az) / l;
    let u0 = Infinity;
    let u1 = -Infinity;
    let v0 = Infinity;
    let v1 = -Infinity;
    for (const [x, z] of poly) {
      const u = x * ux + z * uz;
      const v = -x * uz + z * ux;
      u0 = Math.min(u0, u);
      u1 = Math.max(u1, u);
      v0 = Math.min(v0, v);
      v1 = Math.max(v1, v);
    }
    const area = (u1 - u0) * (v1 - v0);
    if (!best || area < best.area) best = { area, ux, uz, u0, u1, v0, v1 };
  }
  const { ux, uz, u0, u1, v0, v1 } = best;
  const cu = (u0 + u1) / 2;
  const cv = (v0 + v1) / 2;
  const x = cu * ux - cv * uz;
  const z = cu * uz + cv * ux;
  // Normal = perpendicular a u (el lado que mire a la calle se decide después).
  return makeFrame(x, z, -uz, ux, Math.max(1, (u1 - u0) / 2 - inset), Math.max(1, (v1 - v0) / 2 - inset));
}

/** Encoge un marco hasta que ninguna esquina ni el centro quede en la calzada (null si no cabe). */
function shrinkOffRoad(f) {
  for (let k = 0; k < 8; k++) {
    const pts = [...frameCorners(f), [f.x, f.z]];
    if (!pts.some(([x, z]) => onRoadCheck(x, z))) return f;
    f = makeFrame(f.x, f.z, f.nx, f.nz, f.hu * 0.86, f.hv * 0.86);
    if (f.hu < 2.5 || f.hv < 2.5) return null;
  }
  return null;
}

/** Gira el marco para que su frente mire a la vía más cercana. */
function faceStreet(city, f) {
  const opts = [
    [f.nx, f.nz, f.hu, f.hv],
    [-f.nx, -f.nz, f.hu, f.hv],
    [f.ux, f.uz, f.hv, f.hu],
    [-f.ux, -f.uz, f.hv, f.hu],
  ];
  let best = opts[0];
  let bd = Infinity;
  for (const o of opts) {
    const [nx, nz, , hv] = o;
    let d = Infinity;
    for (let s = 1; s < 30; s += 1.5) {
      if (onRoadCheck(f.x + nx * (hv + s), f.z + nz * (hv + s))) {
        d = s;
        break;
      }
    }
    if (d < bd) {
      bd = d;
      best = o;
    }
  }
  return makeFrame(f.x, f.z, best[0], best[1], best[2], best[3]);
}

function addPoi(ctx, poi) {
  ctx.city.pois.push({ radius: 3.5, ...poi });
}

/** Punto sobre el andén más cercano a (x, z). */
export function sidewalkNear(city, x, z) {
  let best = null;
  for (const b of city.blocks) {
    if (!b.ring || x < b.minX - 40 || x > b.maxX + 40 || z < b.minZ - 40 || z > b.maxZ + 40) continue;
    const r = b.ring;
    for (let i = 0; i < r.length; i++) {
      const [ax, az] = r[i];
      const [bx, bz] = r[(i + 1) % r.length];
      const c = closestOnSeg(x, z, ax, az, bx, bz);
      if (!best || c.d2 < best.d2) best = { x: c.x, z: c.z, d2: c.d2, block: b };
    }
  }
  return best ? { x: best.x, z: best.z } : { x, z };
}

function buildSpecialAreas(ctx) {
  const { city, rng } = ctx;
  const byName = (re) => city.areas.find((a) => re.test(a.name));
  for (const a of city.areas) {
    if (!a.block || !insideMap(a.c[0], a.c[1], 40)) continue;
    const block = a.block;
    switch (a.kind) {
      case 'parque': {
        if (a.area < 250) {
          // Parquecito: árboles y bancas.
          addProp(ctx, { type: 'garden', poly: a.poly, x: a.c[0], z: a.c[1] });
          plantTrees(ctx, a.poly, Math.max(1, Math.round(a.area / 60)), ['mango', 'ficus', 'carbonero', 'almendro', 'guayacan']);
          break;
        }
        const plaza = /Aranjuez/.test(a.name);
        addProp(ctx, { type: plaza ? 'plazaPoly' : 'garden', poly: a.poly, x: a.c[0], z: a.c[1], flowers: /Morro/.test(a.name) });
        if (plaza) {
          addProp(ctx, { type: 'fountain', x: a.c[0], z: a.c[1], collider: { hx: 3.2, hz: 3.2, maxY: 1000 } });
          for (let k = 0; k < 10; k++) {
            const ang = (k / 10) * Math.PI * 2 + 0.3;
            const bx = a.c[0] + Math.cos(ang) * 8;
            const bz = a.c[1] + Math.sin(ang) * 8;
            if (!pointInPoly(bx, bz, a.poly)) continue;
            addProp(ctx, { type: 'bench', x: bx, z: bz, rot: -ang + Math.PI / 2, collider: { hx: 0.75, hz: 0.75, maxY: terrainHeight(bx, bz) + GRID.curb + 0.9 } });
          }
          plantTrees(ctx, a.poly, Math.round(a.area / 180), ['ceiba', 'saman', 'mango', 'guayacan', 'guayacanRosado', 'palma', 'carbonero'], 11);
          for (let k = 0; k < 8; k++) {
            const ang = (k / 8) * Math.PI * 2 + Math.PI / 8;
            addProp(ctx, { type: 'parkLamp', x: a.c[0] + Math.cos(ang) * 11.5, z: a.c[1] + Math.sin(ang) * 11.5, rot: ang, collider: { hx: 0.15, hz: 0.15 } });
          }
        } else if (/Morro/.test(a.name)) {
          plantTrees(ctx, a.poly, Math.round(a.area / 90), ['platano', 'guadua', 'mango', 'palma', 'aguacate', 'guayabo', 'guayacanRosado', 'saman']);
        } else {
          plantTrees(ctx, a.poly, Math.max(2, Math.round(a.area / 150)), ['mango', 'saman', 'carbonero', 'almendro', 'palma', 'guayacan']);
          const bx = a.c[0];
          const bz = a.c[1];
          addProp(ctx, { type: 'bench', x: bx, z: bz, rot: rng.range(0, 6.28), collider: { hx: 0.75, hz: 0.75, maxY: terrainHeight(bx, bz) + GRID.curb + 0.9 } });
        }
        break;
      }
      case 'cancha': {
        const f = areaFrame(a.poly, 0.5);
        const basket = /balonc|placa|coliseo/i.test(a.name) || a.sport === 'basketball' || a.area < 900;
        addProp(ctx, { type: 'fieldPoly', poly: a.poly, x: f.x, z: f.z, placa: basket, frame: f });
        if (!basket) {
          const along = f.hu > f.hv;
          const hl = (along ? f.hu : f.hv) - 1.5;
          const ax = along ? f.ux : f.nx;
          const az = along ? f.uz : f.nz;
          addProp(ctx, { type: 'goal', x: f.x + ax * hl, z: f.z + az * hl, rot: Math.atan2(ax, az) + Math.PI });
          addProp(ctx, { type: 'goal', x: f.x - ax * hl, z: f.z - az * hl, rot: Math.atan2(ax, az) });
        }
        break;
      }
      case 'iglesia': {
        if (a.area < 60) break;
        let f = shrinkOffRoad(faceStreet(city, areaFrame(a.poly, 0.4)));
        if (!f) break;
        const big = a.area > 500;
        const b = addBuilding(ctx, f, { style: 'iglesia', color: [0.95, 0.92, 0.84], roof: 'dosAguas', height: big ? 13 : 8, floors: 2, block: block.id });
        if (big) {
          // Campanario al frente, a un lado.
          const tw = 3;
          const tf = makeFrame(f.x + f.nx * (f.hv - tw) + f.ux * (f.hu - tw), f.z + f.nz * (f.hv - tw) + f.uz * (f.hu - tw), f.nx, f.nz, tw, tw);
          addBuilding(ctx, tf, { style: 'iglesia', color: [0.95, 0.92, 0.84], height: 25, tower: true, roof: 'torre', block: block.id });
          f = b.frame;
        }
        addProp(ctx, { type: 'sign', x: f.x + f.nx * (f.hv + 1.2), z: f.z + f.nz * (f.hv + 1.2), rot: Math.atan2(f.nx, f.nz), text: a.name });
        break;
      }
      case 'museo': {
        if (a.area < 150) break;
        const f = shrinkOffRoad(faceStreet(city, areaFrame(a.poly, 0.3)));
        if (!f) break;
        addBuilding(ctx, f, { style: 'museo', color: [0.97, 0.94, 0.86], roof: 'dosAguas', floors: 2, block: block.id });
        break;
      }
      case 'colegio':
      case 'salud': {
        if (a.real?.length) {
          // Sus bloques reales ya están puestos: el aviso frente al más grande que da a la calle.
          const fr = a.real.filter((b) => !b.interior).sort((p, q) => q.frame.hu * q.frame.hv - p.frame.hu * p.frame.hv)[0]?.frame;
          if (fr && a.name) addProp(ctx, { type: 'sign', x: fr.x + fr.nx * (fr.hv + 1.2), z: fr.z + fr.nz * (fr.hv + 1.2), rot: Math.atan2(fr.nx, fr.nz), text: a.name });
          break;
        }
        if (a.area < 400) break;
        // Bloques institucionales de 2-3 pisos alrededor de un patio.
        const f0 = areaFrame(a.poly, 2);
        const w = Math.min(f0.hu, 30);
        const d = Math.min(f0.hv, 7);
        const fr = shrinkOffRoad(faceStreet(city, makeFrame(f0.x + f0.nx * (f0.hv - d), f0.z + f0.nz * (f0.hv - d), f0.nx, f0.nz, w, d)));
        if (!fr) break;
        const corners = frameCorners(fr);
        if (corners.every(([x, z]) => pointInPoly(x, z, a.poly) || pointInPoly(x, z, block.lots[0] ?? block.curb))) {
          addBuilding(ctx, fr, { style: a.kind === 'salud' ? 'hospital' : 'institucional', color: a.kind === 'salud' ? [0.94, 0.95, 0.96] : [0.93, 0.9, 0.82], floors: a.kind === 'salud' ? 3 : rng.int(2, 3), roof: 'terraza', block: block.id });
        }
        if (a.area > 2500) addProp(ctx, { type: 'fieldPoly', poly: null, frame: makeFrame(f0.x - f0.nx * 6, f0.z - f0.nz * 6, f0.nx, f0.nz, Math.min(f0.hu - 3, 14), Math.min(f0.hv - 9, 8)), placa: true, x: f0.x, z: f0.z });
        addProp(ctx, { type: 'sign', x: fr.x + fr.nx * (fr.hv + 1.2), z: fr.z + fr.nz * (fr.hv + 1.2), rot: Math.atan2(fr.nx, fr.nz), text: a.name });
        break;
      }
      case 'verde':
        plantTrees(ctx, a.poly, Math.max(1, Math.round(a.area / 70)), ['mango', 'platano', 'platano', 'aguacate', 'guayabo', 'guadua', 'palma']);
        break;
      default:
        break;
    }
  }
  // Río Medellín canalizado y separadores con árboles.
  for (const b of city.blocks) {
    if (b.type === 'separador' && b.area > 120) plantTrees(ctx, b.curb, Math.max(1, Math.round(b.area / 250)), ['palmaReal', 'palmaReal', 'ficus', 'carbonero', 'guayacan']);
    if (b.type === 'rio') plantTrees(ctx, b.curb, Math.round(b.area / 900), ['guadua', 'ficus', 'saman', 'mango', 'palma', 'carbonero'], 0, true);
  }

  // Puntos de interés (lugares reales del mapa).
  const at = (a, fallback) => (a ? sidewalkNear(city, a.c[0], a.c[1]) : fallback);
  const parque = byName(/^Parque Aranjuez/);
  addPoi(ctx, { id: 'parque', name: 'Parque de Aranjuez', desc: 'El corazón del barrio sobre la Calle 92: tinto, dominó y la iglesia San Nicolás al lado.', type: 'landmark', x: parque.c[0], z: parque.c[1] + 4, mission: 'domicilio' });
  const nicolas = byName(/San Nicol/);
  addPoi(ctx, { id: 'iglesia', name: 'Iglesia San Nicolás', desc: 'La parroquia frente al Parque de Aranjuez.', type: 'landmark', ...at(nicolas) });
  const museo = city.areas.filter((a) => a.kind === 'museo').sort((p, q) => q.area - p.area)[0];
  addPoi(ctx, { id: 'museo', name: 'Casa Museo Pedro Nel Gómez', desc: 'La casa-taller del gran muralista antioqueño, entre la quebrada y la Carrera 51B.', type: 'landmark', ...at(museo) });
  const morro = byName(/Morro de Moravia/);
  addPoi(ctx, { id: 'moravia', name: 'Morro de Moravia', desc: 'De basurero a jardín comunitario: el barrio que se reinventó.', type: 'landmark', x: morro.c[0], z: morro.c[1] });
  const canchaM = byName(/Cancha de Fútbol Moravia/);
  addPoi(ctx, { id: 'cancha', name: 'Cancha de Moravia', desc: 'Aquí se arma el picadito… y los problemas con el parche.', type: 'mission', x: canchaM.c[0], z: canchaM.c[1], mission: 'parche' });
  const consuelo = byName(/Consuelo/);
  addPoi(ctx, { id: 'consuelo', name: 'Nuestra Señora del Consuelo', desc: 'La parroquia de Moravia, junto a la cancha.', type: 'landmark', ...at(consuelo) });
  const cayetano = byName(/San Cayetano/);
  addPoi(ctx, { id: 'cayetano', name: 'Parroquia San Cayetano', desc: 'Iglesia de ladrillo en el centro de Aranjuez.', type: 'landmark', ...at(cayetano) });
  const comfama = byName(/Coliseo Comfama/);
  addPoi(ctx, { id: 'comfama', name: 'Comfama Aranjuez', desc: 'Coliseo, piscina y canchas: el parche de los domingos.', type: 'landmark', ...at(comfama) });
  const salud = byName(/Centro de Salud de Aranjuez/);
  addPoi(ctx, { id: 'hospital', name: 'Centro de Salud de Aranjuez', desc: 'Aquí despiertas si te va mal en la calle.', type: 'service', ...at(salud) });
  // Más lugares de OpenStreetMap. El Centro de Desarrollo Cultural de Moravia
  // (Cl. 82A #52-25) es el edificio de OSM junto a Carabobo, no el nodo
  // suelto de biblioteca que quedaba 230 m al oriente.
  addPoi(ctx, { id: 'cultural', name: 'Centro Cultural de Moravia', desc: 'Obra de Rogelio Salmona: ladrillo, patios y música para los pelados del barrio.', type: 'landmark', ...sidewalkNear(city, ...placeAt('w252559808', [-245.8, 534.7])) });
  addPoi(ctx, { id: 'encicla', name: 'Estación EnCicla Moravia', desc: 'Bicicletas públicas junto al puente de Moravia.', type: 'landmark', ...sidewalkNear(city, ...placeAt('n7253815368', [-271, 509])) });
  for (const L of OSM_POIS) {
    const [x, z] = placeAt(L.osm, L.at);
    // La Terminal del Norte no tiene andén cerca: se llega por el puente de la estación Caribe.
    const sw = L.id === 'terminal' && city.metro.geo?.westLanding ? { ...city.metro.geo.westLanding } : sidewalkNear(city, x, z);
    if ((L.id !== 'terminal' && Math.hypot(sw.x - x, sw.z - z) > 45) || !insideMap(sw.x, sw.z, -3)) continue;
    addPoi(ctx, { id: L.id, name: L.name, desc: L.desc, type: L.type ?? 'landmark', ...sw });
    // Aviso con el nombre entre el andén y el lugar, mirando a la calle.
    const d = Math.hypot(x - sw.x, z - sw.z);
    if (L.sign && d > 2) {
      const nx = (sw.x - x) / d;
      const nz = (sw.z - z) / d;
      addProp(ctx, { type: 'sign', x: sw.x - nx * 0.8, z: sw.z - nz * 0.8, rot: Math.atan2(nx, nz), text: L.sign === true ? L.name : L.sign });
    }
  }
}

/** Punto más cercano sobre el eje de una vía de carros (a menos de maxD): {x, z, dx, dz, hw}. */
function nearestCarSeg(x, z, maxD) {
  let best = null;
  for (const e of MAPA.edges) {
    if (!e.car) continue;
    for (let i = 1; i < e.pts.length; i++) {
      const [ax, az] = e.pts[i - 1];
      const [bx, bz] = e.pts[i];
      if (Math.min(ax, bx) > x + maxD || Math.max(ax, bx) < x - maxD || Math.min(az, bz) > z + maxD || Math.max(az, bz) < z - maxD) continue;
      const c = closestOnSeg(x, z, ax, az, bx, bz);
      const l = Math.hypot(bx - ax, bz - az);
      if (l > 0.1 && c.d2 < maxD * maxD && (!best || c.d2 < best.d2)) best = { d2: c.d2, x: c.x, z: c.z, dx: (bx - ax) / l, dz: (bz - az) / l, hw: e.w / 2 };
    }
  }
  return best;
}

/** Posición de un lugar de OpenStreetMap por su id (mapa.json → places), o la de respaldo. */
function placeAt(osm, fallback) {
  const p = (MAPA.places ?? []).find((q) => q.osm === osm);
  return p ? [p.x, p.z] : fallback;
}

/**
 * Lugares reales de OpenStreetMap que se vuelven puntos de interés (con su
 * id de OSM y la posición de respaldo). Los nombres se verificaron contra
 * las etiquetas de OSM; las descripciones son del juego.
 */
const OSM_POIS = [
  { id: 'terminal', osm: 'w143598966', at: [-955.9, 264.4], name: 'Terminal del Norte', desc: 'Buses para todo Antioquia y la Costa, pegada a la estación Caribe.', sign: 'Terminal de Transporte Norte' },
  { id: 'metroplus', osm: 'w935436260', at: [635.2, -442.9], name: 'Estación Metroplús Parque de Aranjuez', desc: 'La estación del Metroplús junto al parque: bus articulado hacia el centro.' },
  { id: 'metroplusCaribe', osm: 'n8751394007', at: [-876.3, 357.4], name: 'Paradero Metroplús Caribe', desc: 'El Metroplús junto a la estación Caribe y la Terminal del Norte.' },
  { id: 'claret', osm: 'w115813024', at: [418, 683], name: 'Parroquia San Antonio María Claret', desc: 'La iglesia de Campo Valdés.' },
  { id: 'sanesteban', osm: 'w1494287177', at: [-194.1, -261.2], name: 'Parroquia San Esteban Protomártir', desc: 'Parroquia de Palermo, cerca de la Calle 92.' },
  { id: 'ninodios', osm: '', at: [-185, 106], name: 'Parroquia El Niño Dios', desc: 'La iglesia del barrio Los Álamos.', sign: 'Parroquia El Niño Dios' },
  { id: 'mercado', osm: 'w46136548', at: [380, 764.7], name: 'Plaza de Mercado de Campo Valdés', desc: 'Frutas, verduras, carnicerías y tinto en la plaza del barrio.', sign: 'Plaza de Mercado Campo Valdés' },
  { id: 'biblioteca', osm: 'w533036883', at: [-48.1, -107.8], name: 'Biblioteca Pública Comfama', desc: 'La biblioteca de la sede de Comfama en Aranjuez.', sign: 'Biblioteca Pública' },
  { id: 'saludMoravia', osm: 'n7855091960', at: [-427.3, 713.8], name: 'Centro de Salud de Moravia', desc: 'El puesto de salud del barrio.', type: 'service', sign: 'Centro de Salud Moravia' },
  { id: 'policia', osm: 'w784675128', at: [427.6, -225.9], name: 'Inspección de Policía de Aranjuez', desc: 'Aquí se ponen las denuncias… y aquí te traen si te portas mal.', type: 'service', sign: 'Inspección de Policía' },
  { id: 'agustiniano', osm: 'w1420452700', at: [729.7, -399.9], name: 'Colegio Agustiniano de San Nicolás', desc: 'El colegio de los agustinos, junto al Parque de Aranjuez.', sign: 'Colegio Agustiniano San Nicolás' },
  { id: 'lorenza', osm: 'w382817658', at: [174.6, 106], name: 'I.E. Lorenza Villegas de Santos', desc: 'Colegio público entre San Cayetano y la quebrada.' },
  { id: 'campoValdes', osm: 'w45514170', at: [726.7, 654.3], name: 'I.E. Campo Valdés', desc: 'Colegio público del barrio Campo Valdés.' },
  { id: 'gilberto', osm: 'w522488449', at: [-26.4, -321.3], name: 'I.E. Gilberto Alzate Avendaño', desc: 'Colegio junto a la Transversal 92A.' },
  { id: 'elBosque', osm: 'w702146578', at: [-529.8, 146.8], name: 'I.E. El Bosque', desc: 'El colegio de Moravia, al lado de la parroquia del Consuelo.' },
  { id: 'madreLaura', osm: 'w1493725084', at: [-98.9, -550], name: 'Parque de la Madre Laura', desc: 'Skate park, gimnasio al aire libre y la estatua de la santa Laura Montoya.', sign: 'Parque Madre Laura' },
  { id: 'bermejala', osm: 'w1340584352', at: [-418.7, 378.9], name: 'Parque Lineal La Bermejala', desc: 'Parque a la orilla de la quebrada La Bermejala, en Moravia.' },
  { id: 'huertos', osm: 'w917431554', at: [-491, 22], name: 'Huertos Comunitarios de Moravia', desc: 'Las huertas que siembran los vecinos del barrio.' },
  { id: 'puenteMadreLaura', osm: 'w1278291473', at: [-556.1, -658], name: 'Puente de la Madre Laura', desc: 'El puente sobre el río Medellín que une Aranjuez con Castilla.' },
];

function addProp(ctx, p) {
  // Nada de utilería sólida sobre la estación del metro.
  if (p.collider && ctx.city.inStation?.(p.x, p.z)) return null;
  ctx.city.props.push(p);
  return p;
}

/** Árboles repartidos dentro de un polígono (sin tapar vías ni casas). */
function plantTrees(ctx, poly, n, kinds, minDist = 0, loose = false) {
  const { rng } = ctx;
  const bb = polyBounds(poly);
  let placed = 0;
  for (let tries = 0; tries < n * 8 && placed < n; tries++) {
    const x = rng.range(bb.minX, bb.maxX);
    const z = rng.range(bb.minZ, bb.maxZ);
    if (!pointInPoly(x, z, poly) || onRoadCheck(x, z)) continue;
    if (minDist && Math.hypot(x - (bb.minX + bb.maxX) / 2, z - (bb.minZ + bb.maxZ) / 2) < minDist) continue;
    if (!loose && distToPolyEdge(x, z, poly) < 1.5) continue;
    addProp(ctx, { type: 'tree', kind: rng.pick(kinds), x, z, scale: rng.range(0.9, 1.5), collider: { hx: 0.35, hz: 0.35 } });
    placed++;
  }
}

// ------------------------------------------------------------------ verde
/**
 * Lo verde de Medellín fuera de parques: guaduales y helechos en las orillas
 * de las quebradas, solares con plátano, guayabo y maleza, setos y pasto en
 * los separadores.
 */
function addGreenery(ctx) {
  const { city, rng } = ctx;
  const free = (x, z) => insideMap(x, z) && !onRoadCheck(x, z) && !city.inStation?.(x, z);
  // Orillas de las quebradas.
  for (const w of city.water) {
    if (/Medell/i.test(w.name)) continue;
    const cum = cumLengths(w.pts);
    const L = cum[cum.length - 1];
    for (let s0 = 2; s0 < L; s0 += 5) {
      const p = pointAlong(w.pts, cum, s0);
      for (const side of [1, -1]) {
        const off = (w.kind === 'canal' ? 3.6 : 2.4) + rng.range(0, 1.5);
        const x = p.x - p.dz * off * side;
        const z = p.z + p.dx * off * side;
        if (!free(x, z)) continue;
        const r = rng.next();
        if (r < 0.14) addProp(ctx, { type: 'tree', kind: 'guadua', x, z, scale: rng.range(0.8, 1.2), collider: { hx: 0.3, hz: 0.3 } });
        else if (r < 0.6) addProp(ctx, { type: 'shrub', kind: rng.pick(['helecho', 'heliconia', 'helecho', 'monstera']), x, z, rot: rng.range(0, 6.28), scale: rng.range(0.8, 1.3) });
        else if (r < 0.75) addProp(ctx, { type: 'grass', kind: 'maleza', x, z, r: rng.range(1.5, 3) });
      }
    }
  }
  // Solares: lotes casi sin construir.
  const built = new Map();
  for (const h of city.buildings) built.set(h.block, (built.get(h.block) ?? 0) + 4 * h.frame.hu * h.frame.hv);
  for (const b of city.blocks) {
    if (b.type !== 'residencial') continue;
    const lotArea = b.lots.reduce((acc, l) => acc + Math.abs(polyArea(l)), 0);
    if ((built.get(b.id) ?? 0) / Math.max(1, lotArea) >= 0.35) continue;
    for (const l of b.lots) {
      const A = Math.abs(polyArea(l));
      const bb = polyBounds(l);
      const n = Math.min(40, Math.round(A / 120));
      for (let k = 0; k < n; k++) {
        const x = rng.range(bb.minX, bb.maxX);
        const z = rng.range(bb.minZ, bb.maxZ);
        if (!pointInPoly(x, z, l) || !free(x, z) || city.collision.pointBlocked(x, z)) continue;
        const r = rng.next();
        if (r < 0.3) {
          // Mata de plátano: 2 a 5 matas juntas.
          const m = rng.int(2, 5);
          for (let j = 0; j < m; j++) addProp(ctx, { type: 'tree', kind: 'platano', x: x + rng.range(-1.5, 1.5), z: z + rng.range(-1.5, 1.5), scale: rng.range(0.8, 1.1) });
        } else if (r < 0.45) addProp(ctx, { type: 'tree', kind: rng.pick(['guayabo', 'aguacate', 'mango']), x, z, scale: rng.range(0.8, 1.2), collider: { hx: 0.3, hz: 0.3 } });
        else addProp(ctx, { type: 'grass', kind: rng.chance(0.6) ? 'maleza' : 'pasto', x, z, r: rng.range(2, 4.5) });
      }
    }
  }
  // Separadores: seto y pasto a lo largo.
  for (const b of city.blocks) {
    if (b.type !== 'separador' || b.area < 60) continue;
    const r = b.curb;
    for (let i = 0; i < r.length; i++) {
      const [ax, az] = r[i];
      const [bx, bz] = r[(i + 1) % r.length];
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 8 || !rng.chance(0.5)) continue;
      const cx = (ax + bx) / 2;
      const cz = (az + bz) / 2;
      const [mx, mz] = [cx + (b.cx - cx) * 0.25, cz + (b.cz - cz) * 0.25];
      if (!pointInPoly(mx, mz, b.curb) || !free(mx, mz)) continue;
      addProp(ctx, { type: 'shrub', kind: 'seto', x: mx, z: mz, rot: Math.atan2(-(bz - az), bx - ax), len: Math.min(len * 0.7, 20) });
    }
  }
}

// ------------------------------------------------------------------ andenes
/** Tramos del borde del andén (a `off` m del sardinel hacia adentro) de una manzana. */
function curbSides(block, off) {
  // El anillo peatonal está a GRID.ring del sardinel: desplazarlo hacia el sardinel.
  const r = block.ring;
  if (!r) return [];
  const A = polyArea(r);
  const inwardSign = A > 0 ? 1 : -1;
  const shift = GRID.ring - off;
  const sides = [];
  for (let i = 0; i < r.length; i++) {
    const [ax, az] = r[i];
    const [bx, bz] = r[(i + 1) % r.length];
    const l = Math.hypot(bx - ax, bz - az);
    if (l < 0.5) continue;
    const tx = (bx - ax) / l;
    const tz = (bz - az) / l;
    // Afuera (hacia la calle) = -adentro.
    const ox = tz * inwardSign;
    const oz = -tx * inwardSign;
    sides.push({ x0: ax + ox * shift, z0: az + oz * shift, tx, tz, len: l, ox, oz, rot: Math.atan2(ox, oz) });
  }
  return sides;
}

/** ¿Hay un cruce (nodo con 3 o más vías) a menos de r m? */
function nearJunction(city, x, z, r) {
  if (!city.junctionGrid) {
    city.junctionGrid = new Map();
    for (const n of city.nodes) {
      if (!n.active || n.links.length < 3) continue;
      const k = `${Math.floor(n.x / 16)},${Math.floor(n.z / 16)}`;
      if (!city.junctionGrid.has(k)) city.junctionGrid.set(k, []);
      city.junctionGrid.get(k).push(n);
    }
  }
  const i0 = Math.floor(x / 16);
  const j0 = Math.floor(z / 16);
  for (let i = i0 - 1; i <= i0 + 1; i++) for (let j = j0 - 1; j <= j0 + 1; j++) for (const n of city.junctionGrid.get(`${i},${j}`) ?? []) if (Math.hypot(n.x - x, n.z - z) < r) return true;
  return false;
}

/** Recorre el borde del andén de una manzana cada `step` m llamando a fn(x, z, side). */
function walkCurb(block, off, step, start, fn) {
  let acc = start;
  for (const s of curbSides(block, off)) {
    let t = acc;
    while (t < s.len) {
      fn(s.x0 + s.tx * t, s.z0 + s.tz * t, s);
      t += step;
    }
    acc = t - s.len;
  }
}

function addSidewalkProps(ctx, block) {
  const { rng, city } = ctx;
  if (!block.ring || block.type === 'rio' || block.type === 'separador') return;
  // Faroles cada ~27 m junto al sardinel (sin tapar esquinas: ahí los
  // carros que doblan cerrado se subirían al andén contra el poste).
  walkCurb(block, 0.45, 27, rng.range(4, 14), (x, z, s) => {
    if (onRoadCheck(x, z) || nearJunction(city, x, z, 9)) return;
    addProp(ctx, { type: 'lamp', x, z, rot: s.rot + Math.PI, collider: { hx: 0.15, hz: 0.15 } });
  });
  // Árboles de andén (más verde que antes: mango, ficus, guayacán…).
  walkCurb(block, 0.55, rng.range(12, 20), rng.range(6, 12), (x, z) => {
    if (!rng.chance(0.5) || onRoadCheck(x, z)) return;
    if (city.props.some((p) => p.type === 'lamp' && Math.abs(p.x - x) < 3 && Math.abs(p.z - z) < 3)) return;
    addProp(ctx, { type: 'tree', kind: rng.pick(['mango', 'mango', 'ficus', 'carbonero', 'almendro', 'guayacan', 'guayacanRosado', 'palma', 'aguacate']), x, z, scale: rng.range(0.75, 1.15), collider: { hx: 0.25, hz: 0.25 } });
  });
  // Motos parqueadas en el andén (muy de Medellín).
  const nMotos = block.type === 'residencial' ? (rng.chance(0.55) ? rng.int(1, 2) : 0) : 0;
  const sides = curbSides(block, 0.8).filter((s) => s.len > 6);
  for (let mk = 0; mk < nMotos && sides.length; mk++) {
    const s = rng.pick(sides);
    for (let tries = 0; tries < 8; tries++) {
      const t = rng.range(1.5, s.len - 1.5);
      const x = s.x0 + s.tx * t;
      const z = s.z0 + s.tz * t;
      const clash = city.props.some((p) => p.collider && Math.abs(p.x - x) < 1.8 && Math.abs(p.z - z) < 1.8) || city.parkedVehicles.some((v) => Math.hypot(v.x - x, v.z - z) < 2.2) || onRoadCheck(x, z);
      if (clash) continue;
      city.parkedVehicles.push({ type: 'moto', x, z, heading: Math.atan2(-s.tx, -s.tz) });
      break;
    }
  }
}

// ------------------------------------------------------------------ servicios y comercios
function placeServices(ctx) {
  const { city, rng } = ctx;
  // Armería y taller: casas de verdad en vías principales, cerca del centro y de Carabobo.
  const onMain = (b) => {
    const f = b.frame;
    const r = roadAt(f.x + f.nx * (f.hv + GRID.sidewalk + 1.5), f.z + f.nz * (f.hv + GRID.sidewalk + 1.5), 1);
    return r && ['secondary', 'tertiary', 'primary'].includes(city.edges.find((e) => e.pts === MAPA.edges[r.edge].pts)?.cls ?? MAPA.edges[r.edge].cls);
  };
  const cands = city.buildings.filter((b) => !b.interior && ['tienda', 'pintada', 'ladrillo'].includes(b.style) && b.frame.hu > 3 && onMain(b));
  const pick = (tx, tz) => cands.reduce((best, b) => (!best || Math.hypot(b.frame.x - tx, b.frame.z - tz) < Math.hypot(best.frame.x - tx, best.frame.z - tz) ? b : best), null);
  const arm = pick(120, 60);
  if (arm) {
    Object.assign(arm, { style: 'tienda', shop: 'armeria', color: [0.25, 0.27, 0.3], floors: 2 });
    const f = arm.frame;
    addProp(ctx, { type: 'sign', x: f.x + f.nx * (f.hv + 0.3), z: f.z + f.nz * (f.hv + 0.3), rot: Math.atan2(f.nx, f.nz), text: 'Armería El Parcero' });
    city.pois.push({ radius: 3.5, id: 'armeria', name: 'Armería El Parcero', desc: 'Armas y munición. Presiona E para comprar.', type: 'shop', ...sidewalkNear(city, f.x + f.nx * (f.hv + 1), f.z + f.nz * (f.hv + 1)) });
  }
  const tall = pick(-430, -120);
  if (tall) {
    Object.assign(tall, { style: 'taller', floors: 2, height: 7, roof: 'zinc', color: [0.55, 0.6, 0.65] });
    const f = tall.frame;
    addProp(ctx, { type: 'sign', x: f.x + f.nx * (f.hv + 0.3), z: f.z + f.nz * (f.hv + 0.3), rot: Math.atan2(f.nx, f.nz), text: 'Taller Los Motos' });
    city.pois.push({ radius: 3.5, id: 'taller', name: 'Taller Los Motos', desc: 'Reparan tu carro y organizan piques. E: reparar / carrera.', type: 'service', mission: 'carrera', ...sidewalkNear(city, f.x + f.nx * (f.hv + 1), f.z + f.nz * (f.hv + 1)) });
  }
  // Mirador: el punto de andén más alto del oriente, mirando al valle.
  let top = null;
  for (const b of city.blocks) {
    if (!b.ring || b.cx < 500 || !insideMap(b.cx, b.cz, -20)) continue;
    for (const [x, z] of b.ring) {
      const h = terrainHeight(x, z);
      if (!top || h > top.h) top = { x, z, h };
    }
  }
  if (top) city.pois.push({ radius: 3.5, id: 'mirador', name: 'Mirador de Aranjuez', desc: 'Desde lo alto del barrio se ve el valle entero. De noche parece un pesebre.', type: 'landmark', x: top.x, z: top.z });
  void rng;
}

// ------------------------------------------------------------------ locales típicos
/**
 * Negocios con nombre propio. Los reales salen de OpenStreetMap o de su
 * dirección (Mandingas: Cl. 92 #50B-71 y Cra. 51 #93-114; Granizados:
 * Cra. 50C #92-84); los típicos del barrio van junto a un lugar conocido.
 * `menu`: lo que se puede comprar (cura `heal` de salud).
 */
export const LOCAL_SPOTS = [
  {
    id: 'mandingas92',
    name: 'Mandingas La 92',
    at: [300, -250],
    desc: 'Las papas mandingas de toda la vida, en la 92 con la 50B. Se hace fila hasta de noche.',
    menu: [
      { id: 'mandingas', name: 'Papas mandingas', desc: 'Papita criolla con salsa de la casa', price: 45, heal: 35 },
      { id: 'salchipapa', name: 'Salchipapa', desc: 'Con queso rallado y salsas', price: 60, heal: 50 },
      { id: 'gaseosa', name: 'Gaseosa helada', desc: 'Pa bajar las papas', price: 15, heal: 10 },
    ],
  },
  {
    id: 'mandingas94',
    name: 'Mandingas La 94',
    at: [158, -505],
    desc: 'La otra sede, sobre la 51 subiendo hacia la 94.',
    menu: [
      { id: 'mandingas', name: 'Papas mandingas', desc: 'Papita criolla con salsa de la casa', price: 45, heal: 35 },
      { id: 'gaseosa', name: 'Gaseosa helada', desc: 'Pa bajar las papas', price: 15, heal: 10 },
    ],
  },
  {
    id: 'granizados92',
    name: 'Granizados La 92',
    at: [272, -332],
    desc: 'Granizados y capuchinos en la 50C, a una cuadra de la 92.',
    menu: [
      { id: 'granizado', name: 'Granizado de mora', desc: 'Con leche condensada y galleta', price: 35, heal: 20 },
      { id: 'capuchino', name: 'Capuchino helado', desc: 'Café, hielo raspado y crema', price: 40, heal: 25 },
    ],
  },
  {
    id: 'laspatatas',
    name: 'Las Patatas',
    at: [154, -261],
    desc: 'Salchipapas en la esquina de la 92 con la 51.',
    menu: [
      { id: 'salchipapa', name: 'Salchipapa mediana', desc: 'Papa, salchicha, queso y salsas', price: 55, heal: 45 },
      { id: 'perro', name: 'Perro caliente', desc: 'Con papitas trituradas por encima', price: 45, heal: 35 },
    ],
  },
  {
    id: 'marinillos',
    name: 'Panadería Los Marinillos',
    at: [405, -235],
    desc: 'Pandebonos y buñuelos recién salidos del horno.',
    menu: [
      { id: 'pandebono', name: 'Pandebono', desc: 'Calientico, con tinto', price: 20, heal: 15 },
      { id: 'bunuelo', name: 'Buñuelo', desc: 'Redondito y dorado', price: 20, heal: 15 },
      { id: 'tinto', name: 'Tinto', desc: 'El café de la esquina', price: 10, heal: 5 },
    ],
  },
  {
    id: 'varaka',
    name: 'La Varaka',
    at: [614, -386],
    desc: 'Almuerzo corrientazo y bandeja paisa cerca del parque de Aranjuez.',
    menu: [
      { id: 'bandeja', name: 'Bandeja paisa', desc: 'Frijoles, arroz, chicharrón, huevo, arepa y tajada', price: 120, heal: 100 },
      { id: 'corrientazo', name: 'Almuerzo del día', desc: 'Sopa, seco y jugo', price: 70, heal: 60 },
    ],
  },
  {
    id: 'migao',
    name: 'El Migao',
    at: [-289, -146],
    desc: 'Café de barrio con parva y chocolate.',
    menu: [
      { id: 'migao', name: 'Migao', desc: 'Chocolate con queso y pan desmigado', price: 35, heal: 25 },
      { id: 'tinto', name: 'Tinto', desc: 'El café de la esquina', price: 10, heal: 5 },
    ],
  },
  {
    id: 'maspan',
    name: 'maspan',
    at: [121, -73],
    desc: 'Panadería de la Cl. 90 cerca de San Cayetano.',
    menu: [
      { id: 'pandequeso', name: 'Pan de queso', desc: 'Recién horneado', price: 20, heal: 15 },
      { id: 'tinto', name: 'Tinto', desc: 'El café de la esquina', price: 10, heal: 5 },
    ],
  },
  {
    id: 'empanadas',
    name: 'Empanadas Diana',
    at: [-323, 709],
    desc: 'Empanadas y pollo asado en Moravia.',
    menu: [
      { id: 'empanada', name: 'Empanadas con ají', desc: 'Tres empanaditas de papa y carne', price: 30, heal: 25 },
      { id: 'pollo', name: 'Cuarto de pollo', desc: 'Asado, con arepa y papa', price: 80, heal: 70 },
    ],
  },
  {
    id: 'arepas',
    name: 'Arepas de Chócolo Doña Marleny',
    near: ['parque', -22, 24],
    desc: 'Arepa de chócolo con quesito, junto al parque.',
    menu: [{ id: 'chocolo', name: 'Arepa de chócolo', desc: 'Con mantequilla y quesito', price: 40, heal: 30 }],
  },
  {
    id: 'cholados',
    name: 'Cholados y Salpicón La Cancha',
    near: ['cancha', 18, 20],
    desc: 'Cholados, salpicón y obleas para después del partido.',
    menu: [
      { id: 'cholado', name: 'Cholado', desc: 'Hielo, fruta picada, lechera y coco', price: 40, heal: 25 },
      { id: 'oblea', name: 'Oblea', desc: 'Con arequipe y queso', price: 20, heal: 10 },
    ],
  },
  {
    id: 'fritanga',
    name: 'Fritanga El Paisa',
    near: ['consuelo', 25, 25],
    desc: 'Chicharrón, morcilla, chorizo y arepa de la parrilla.',
    menu: [
      { id: 'chicharron', name: 'Chicharrón con arepa', desc: 'Carnudo y crocante', price: 60, heal: 50 },
      { id: 'chorizo', name: 'Chorizo con arepa', desc: 'Con limón', price: 35, heal: 30 },
    ],
  },
  {
    id: 'billares92',
    name: 'Billares La 92',
    at: [470, -250],
    desc: 'Billar, parqués y música de cantina.',
    menu: [
      { id: 'gaseosa', name: 'Gaseosa', desc: 'Bien fría', price: 15, heal: 10 },
      { id: 'tinto', name: 'Tinto', desc: 'Pa aguantar la partida', price: 10, heal: 5 },
    ],
  },
  { id: 'carniceria90', name: 'Carnicería La 90', at: [-140, -90] },
  // La tienda de la abuela del protagonista (historia, capítulo 1).
  {
    id: 'abuela',
    name: 'Tienda Doña Rosa',
    kind: 'tienda',
    near: ['parque', 34, 30],
    chair: true,
    desc: 'La tienda de tu abuela, a una cuadra del parque: tinto, pan y la cuenta fiada del barrio.',
    menu: [
      { id: 'tinto', name: 'Tinto de la abuela', desc: 'Con panela, como siempre', price: 5, heal: 10 },
      { id: 'pandequeso', name: 'Pan de queso', desc: 'Del que trae el panadero en la mañana', price: 15, heal: 15 },
      { id: 'gaseosa', name: 'Gaseosa', desc: 'Bien fría', price: 15, heal: 10 },
    ],
  },
  // Más negocios de barrio con su posición en OpenStreetMap (solo el aviso).
  { id: 'farmacia90', name: 'Farmacia La 90', at: [-183, -107] },
  { id: 'juanxxiii', name: 'Droguería Juan XXIII', at: [142, -100] },
  { id: 'granerolapalma', name: 'Granero La Palma', at: [275, -212] },
  { id: 'tortas', name: 'Tortas y Tortas', at: [150, -67] },
  { id: 'coctelazo', name: 'El Coctelazo', at: [88, -272] },
  { id: 'super80', name: 'Supermercado La 80', at: [-132, 128] },
  { id: 'mercadosvelez', name: 'Mercados Vélez', at: [125, -534] },
  { id: 'tiendacarabobo', name: 'Tienda Casera Carabobo', at: [-315, 114] },
  { id: 'veterinaria92', name: 'Veterinaria La 92', at: [303, -237] },
  { id: 'eficarnes', name: 'Efi Carnes', at: [760, -518] },
  { id: 'spaunas', name: 'Spa de Uñas', at: [-174, -98] },
  // Almacenes de ropa (inventados) en la 92 y en Carabobo (Cra. 52): `store`
  // es el surtido de sim/ropa.js; `street`, la calle a la que tiene que dar.
  { id: 'modapaisa', name: 'Almacén Moda Paisa', at: [365, -245], street: 'Calle 92', store: 'modapaisa', desc: 'Camisetas, busos con capota y jeans de fábrica paisa.' },
  { id: 'boutique92', name: 'Boutique Estilo La 92', at: [520, -252], street: 'Calle 92', store: 'boutique92', desc: 'Pa salir el viernes: camisetas, jeans entubados, gafas, cadenas y canguros.' },
  { id: 'remates', name: 'Remates Carabobo', at: [-126, 150], street: 'Carrera 52', store: 'remates', desc: 'Todo en promoción: lo básico a precio de fábrica.' },
  { id: 'deportes', name: 'Deportes La Cancha', at: [-138, -30], street: 'Carrera 52', store: 'deportes', desc: 'Camisetas de fútbol sin escudo, sudaderas y tenis.' },
  { id: 'gorras52', name: 'Gorras y Tenis La 52', at: [-100, -200], street: 'Carrera 52', store: 'gorras52', desc: 'Gorras planas y curvas de todos los colores, y tenis.' },
];

/** Corredores comerciales reales: en ellos casi toda casa tiene negocio abajo. */
const COMMERCIAL_STREETS = new Set(['Calle 92', 'Carrera 51', 'Carrera 52']);

function placeLocales(ctx) {
  const { city } = ctx;
  // La 92, la 51 y la 52: más tiendas (con su propio generador para no
  // cambiar el resto del barrio).
  const crng = makeRng(city.seed + 92);
  for (const b of city.buildings) {
    if (b.interior || b.shop || !['ladrillo', 'pintada'].includes(b.style) || b.floors > 5 || b.frame.hu < 2.2) continue;
    const f = b.frame;
    const r = roadAt(f.x + f.nx * (f.hv + GRID.sidewalk + 1.5), f.z + f.nz * (f.hv + GRID.sidewalk + 1.5), 1);
    if (r && COMMERCIAL_STREETS.has(MAPA.edges[r.edge].name) && crng.chance(0.55)) b.style = 'tienda';
  }
  const kinds = new Map(LOCALES.map(([n, k]) => [n, k]));
  const fronts = (b, street = null) => {
    const f = b.frame;
    const r = roadAt(f.x + f.nx * (f.hv + GRID.sidewalk + 1.5), f.z + f.nz * (f.hv + GRID.sidewalk + 1.5), 1);
    return !!r && (!street || MAPA.edges[r.edge].name === street);
  };
  for (const L of LOCAL_SPOTS) {
    let tx;
    let tz;
    if (L.near) {
      const p = city.pois.find((q) => q.id === L.near[0]);
      if (!p) continue;
      tx = p.x + L.near[1];
      tz = p.z + L.near[2];
    } else [tx, tz] = L.at;
    let best = null;
    let bd = 60;
    for (const b of city.buildings) {
      if (b.interior || b.shop || b.local || !['ladrillo', 'pintada', 'tienda'].includes(b.style) || b.floors > 5 || b.frame.hu < 2.4) continue;
      const f = b.frame;
      const d = Math.hypot(f.x + f.nx * f.hv - tx, f.z + f.nz * f.hv - tz);
      if (d < bd && fronts(b, L.street)) {
        bd = d;
        best = b;
      }
    }
    if (!best) continue;
    best.style = 'tienda';
    best.local = { name: L.name, kind: kinds.get(L.name) ?? L.kind ?? 'cafeteria' };
    const f = best.frame;
    if (L.store) {
      city.pois.push({ radius: 3.5, id: L.id, name: L.name, desc: L.desc, type: 'ropa', store: L.store, ...sidewalkNear(city, f.x + f.nx * (f.hv + 1), f.z + f.nz * (f.hv + 1)) });
      continue;
    }
    if (!L.menu) continue;
    city.pois.push({ radius: 3.5, id: L.id, name: L.name, desc: L.desc, type: 'food', menu: L.menu, ...sidewalkNear(city, f.x + f.nx * (f.hv + 1), f.z + f.nz * (f.hv + 1)) });
    if (L.chair) {
      // Silla plástica propia junto a la puerta (la de la abuela: la historia la sienta ahí).
      const a = Math.min(1.9, f.hu - 0.6);
      const x = f.x + f.nx * (f.hv + 0.45) + f.ux * a;
      const z = f.z + f.nz * (f.hv + 0.45) + f.uz * a;
      addProp(ctx, { type: 'chair', x, z, rot: Math.atan2(f.nx, f.nz), color: '#f4f4f0', collider: { hx: 0.24, hz: 0.24, maxY: terrainHeight(x, z) + GRID.curb + 0.9 }, owner: L.id });
    }
  }
}

// ------------------------------------------------------------------ metro
function addMetro(ctx) {
  const { city } = ctx;
  const lines = MAPA.rail.filter((r) => r.kind === 'subway');
  // Estación Caribe (línea A): paraderos de OpenStreetMap en (-780, 317), entre
  // las dos vías principales (una por sentido).
  const target = { x: -780.5, z: 317.5 };
  const hits = [];
  for (const l of lines) {
    if (l.bridge) continue;
    let best = null;
    for (let i = 1; i < l.pts.length; i++) {
      const c = closestOnSeg(target.x, target.z, l.pts[i - 1][0], l.pts[i - 1][1], l.pts[i][0], l.pts[i][1]);
      if (!best || c.d2 < best.d2) best = { d2: c.d2, x: c.x, z: c.z, line: l, i };
    }
    if (best && best.d2 < 30 * 30) hits.push(best);
  }
  hits.sort((p, q) => p.d2 - q.d2);
  const h0 = hits[0];
  const station = h0
    ? (() => {
        const [ax, az] = h0.line.pts[h0.i - 1];
        const [bx, bz] = h0.line.pts[h0.i];
        const l = Math.hypot(bx - ax, bz - az) || 1;
        const h1 = hits[1];
        const x = h1 ? (h0.x + h1.x) / 2 : h0.x;
        const z = h1 ? (h0.z + h1.z) / 2 : h0.z;
        return { name: 'Caribe', x, z, dx: (bx - ax) / l, dz: (bz - az) / l, length: 120, y: terrainHeight(x, z), track: h1 ? Math.hypot(h1.x - h0.x, h1.z - h0.z) / 2 : 2 };
      })()
    : null;
  // La Caribe tiene plataforma central: en OpenStreetMap las dos vías van a
  // ~5 m, así que se abren con suavidad alrededor de la estación para que
  // quepa el andén de 8 m entre ellas.
  const TRACK_HALF = 5.6;
  if (station && hits.length >= 2) {
    const extra = TRACK_HALF - station.track;
    const cxs = -station.dz;
    const czs = station.dx;
    const reach = station.length / 2 + 15;
    const taper = 70;
    const spread = (l) => {
      const pts = [];
      for (const [x, z] of densifyPts(l.pts, 6)) {
        const a = (x - station.x) * station.dx + (z - station.z) * station.dz;
        const c = (x - station.x) * cxs + (z - station.z) * czs;
        if (Math.abs(c) > 15) {
          pts.push([x, z]);
          continue;
        }
        const u = Math.max(0, Math.min(1, (reach + taper - Math.abs(a)) / taper));
        const k = u * u * (3 - 2 * u) * extra * Math.sign(c || 1);
        pts.push([x + cxs * k, z + czs * k]);
      }
      return { ...l, pts };
    };
    const moved = new Set(hits.map((h) => h.line));
    const spreadOf = new Map();
    // Cualquier tramo de vía cerca de la estación se abre (incluidos los vecinos encadenados).
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (l.bridge) continue;
      const nearSt = l.pts.some(([x, z]) => Math.hypot(x - station.x, z - station.z) < station.length / 2 + taper + 30);
      if (moved.has(l) || nearSt) {
        lines[i] = spread(l);
        spreadOf.set(l, lines[i]);
      }
    }
    for (const h of hits) h.line = spreadOf.get(h.line) ?? h.line;
    station.track = TRACK_HALF;
  }
  city.metro = { lines: lines.map((l) => ({ pts: l.pts, cum: cumLengths(l.pts), bridge: !!l.bridge })), station, geo: null, trainPath: null };
  if (!station) return;
  city.metro.geo = buildMetroStation(city, station);
  // Recorrido del tren: la vía oriental encadenada por sus extremos.
  const east = hits.find((h) => (h.x - station.x) * -station.dz + (h.z - station.z) * station.dx > 0) ?? h0;
  const chain = chainRail(lines, east.line);
  const clipped = chain.filter(([x, z]) => insideMap(x, z, 250));
  if (clipped.length > 1) city.metro.trainPath = { pts: clipped, cum: cumLengths(clipped) };
  const geo = city.metro.geo;
  city.pois.push({ radius: 5, id: 'metro', name: 'Estación Caribe (Metro)', desc: 'Línea A del Metro. Se sube por la escalera o el ascensor del puente que cruza el río desde Moravia.', type: 'landmark', ...geo.landing });
  // Muro de cierre del corredor del metro (no se cruza a pie la vía salvo en la estación).
  for (const l of lines) {
    if (l.bridge) continue;
    for (let i = 1; i < l.pts.length; i++) {
      const [ax, az] = l.pts[i - 1];
      const [bx, bz] = l.pts[i];
      const len = Math.hypot(bx - ax, bz - az);
      const n = Math.max(1, Math.ceil(len / 10));
      for (let k = 0; k < n; k++) {
        const x = ax + ((bx - ax) * (k + 0.5)) / n;
        const z = az + ((bz - az) * (k + 0.5)) / n;
        if (!insideMap(x, z, 20)) continue;
        const la = (x - station.x) * station.dx + (z - station.z) * station.dz;
        const lc = (x - station.x) * -station.dz + (z - station.z) * station.dx;
        if (Math.abs(la) < station.length / 2 + 4 && Math.abs(lc) < 20) continue;
        const ux = (bx - ax) / len;
        const uz = (bz - az) / len;
        for (const sgn of [1, -1]) {
          const cx = x - uz * 4.2 * sgn;
          const cz = z + ux * 4.2 * sgn;
          if (onRoadCheck(cx, cz)) continue;
          city.metroFence ??= [];
          city.metroFence.push({ x: cx, z: cz, ux, uz, h: len / n / 2 });
          const o = obbFromAxis(cx, cz, ux, uz, len / n / 2 + 0.05, 0.1);
          city.collision.add({ ...obbBounds(o), obb: o, minY: -1000, maxY: 1000, kind: 'metro' });
        }
      }
    }
  }
}

function densifyPts(pts, step) {
  const out = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const [ax, az] = pts[i - 1];
    const [bx, bz] = pts[i];
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / step));
    for (let k = 1; k <= n; k++) out.push([ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n]);
  }
  return out;
}

/** Encadena tramos de vía férrea que se tocan por los extremos, a partir de `start`. */
function chainRail(lines, start) {
  const used = new Set([start]);
  let pts = [...start.pts];
  const close = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]) < 3;
  for (let grow = true; grow; ) {
    grow = false;
    for (const l of lines) {
      if (used.has(l) || l.bridge) continue;
      const a = l.pts[0];
      const b = l.pts[l.pts.length - 1];
      const head = pts[0];
      const tail = pts[pts.length - 1];
      if (close(tail, a)) pts = [...pts, ...l.pts.slice(1)];
      else if (close(tail, b)) pts = [...pts, ...[...l.pts].reverse().slice(1)];
      else if (close(head, b)) pts = [...l.pts.slice(0, -1), ...pts];
      else if (close(head, a)) pts = [...[...l.pts].reverse().slice(0, -1), ...pts];
      else continue;
      used.add(l);
      grow = true;
    }
  }
  return pts;
}

// ------------------------------------------------------------------ postes
function addPowerLines(ctx) {
  const { city } = ctx;
  // Postes de energía a lo largo de las vías, con el cableado aéreo típico.
  for (const e of city.edges) {
    if (!e.active || e.length < 30 || e.cls.startsWith('trunk')) continue;
    const off = e.width / 2 + 0.35;
    let prev = null;
    for (let s = 12; s < e.length - 12; s += 34) {
      const p = pointAlong(e.pts, e.cum, s);
      const x = p.x - p.dz * off;
      const z = p.z + p.dx * off;
      // Ni en la calzada ni en la esquina de un cruce (ahí los carros que doblan lo tumbarían).
      if (!insideMap(x, z) || onRoadCheck(x, z) || nearJunction(city, x, z, 9)) {
        prev = null;
        continue;
      }
      const pole = addProp(ctx, { type: 'pole', x, z, h: 9, collider: { hx: 0.15, hz: 0.15 } });
      if (prev && pole) city.props.push({ type: 'cable', a: prev, b: pole });
      prev = pole;
    }
  }
}

// ------------------------------------------------------------------ vida de barrio
/**
 * Utilería que da vida a las cuadras: sillas plásticas y canastas de cerveza
 * frente a las tiendas, materas, canecas y bolsas de basura, hidrantes,
 * alcantarillas, placas de nomenclatura, paraderos y venteros. Nada sólido
 * queda sobre el centro del andén (por donde caminan los peatones).
 */
function addStreetLife(city, rng) {
  const solids = city.props.filter((p) => p.collider);
  const added = [];
  const blocked = (x, z, r) => {
    for (const p of solids) if (Math.abs(p.x - x) < r + (p.collider.hx ?? 0.3) && Math.abs(p.z - z) < r + (p.collider.hz ?? 0.3)) return true;
    for (const v of city.parkedVehicles) if (Math.hypot(v.x - x, v.z - z) < r + 2.6) return true;
    for (const poi of city.pois) if (Math.hypot(poi.x - x, poi.z - z) < r + 3) return true;
    if (Math.hypot(city.spawn.x - x, city.spawn.z - z) < r + 2) return true;
    if (city.collision.pointBlocked(x, z)) return true;
    return false;
  };
  const ringDist = (b, x, z) => (b?.ring ? distToPolyEdge(x, z, b.ring) : Infinity);
  const place = (p, block) => {
    const r = p.collider ? Math.max(p.collider.hx, p.collider.hz) : 0;
    if (p.collider && block && ringDist(block, p.x, p.z) < 0.08 + PED_RADIUS + Math.min(p.collider.hx, p.collider.hz)) return null;
    if (p.collider && blocked(p.x, p.z, r)) return null;
    if (onRoadCheck(p.x, p.z) && !p.onRoad) return null;
    if (city.inStation?.(p.x, p.z)) return null;
    city.props.push(p);
    added.push(p);
    if (p.collider) solids.push(p);
    return p;
  };
  const ground = (x, z) => terrainHeight(x, z) + GRID.curb;
  const blocksById = city.blocks;
  const facadeInfo = (b) => {
    const f = b.frame;
    return { nx: f.nx, nz: f.nz, rot: Math.atan2(f.nx, f.nz), fx: f.x + f.nx * f.hv, fz: f.z + f.nz * f.hv, len: f.hu * 2, tx: f.ux, tz: f.uz };
  };

  // 1) Tiendas de barrio: sillas plásticas y canastas de cerveza en el andén.
  const CHAIR_COLORS = ['#f4f4f0', '#f4f4f0', '#f4f4f0', '#d8312b', '#2f6fb3', '#3f8f4a'];
  for (const b of city.buildings) {
    if (b.style !== 'tienda' || b.interior || b.shop || b.floors >= 6 || (!b.local && !rng.chance(0.5))) continue;
    const block = blocksById[b.block];
    const f = facadeInfo(b);
    const n = rng.int(2, 4);
    const color = rng.pick(CHAIR_COLORS);
    const span = Math.min(f.len - 1.5, n * 0.75);
    if (span < 1.4) continue;
    const start = -span / 2;
    for (let k = 0; k < n; k++) {
      const a = start + (k + 0.5) * (span / n) + rng.range(-0.08, 0.08);
      const x = f.fx + f.tx * a + f.nx * 0.42;
      const z = f.fz + f.tz * a + f.nz * 0.42;
      place({ type: 'chair', x, z, rot: f.rot + rng.range(-0.35, 0.35), color, collider: { hx: 0.24, hz: 0.24, maxY: ground(x, z) + 0.9 } }, block);
    }
    const a = (span / 2 + 0.45) * (rng.chance(0.5) ? 1 : -1);
    const x = f.fx + f.tx * a + f.nx * 0.3;
    const z = f.fz + f.tz * a + f.nz * 0.3;
    const stack = rng.int(1, 4);
    place({ type: 'crate', x, z, rot: f.rot + (rng.chance(0.5) ? Math.PI / 2 : 0) + rng.range(-0.1, 0.1), stack, collider: { hx: 0.25, hz: 0.25, maxY: ground(x, z) + 0.26 * stack } }, block);
  }

  // 2) Materas en el andén junto a la fachada y en los balcones.
  for (const b of city.buildings) {
    if (b.interior || b.style === 'torre' || b.style === 'tienda') continue;
    const f = facadeInfo(b);
    const block = blocksById[b.block];
    if (block && b.style === 'pintada' && rng.chance(0.18)) {
      const a = rng.range(-f.len / 2 + 0.8, f.len / 2 - 0.8);
      const x = f.fx + f.tx * a + f.nx * 0.36;
      const z = f.fz + f.tz * a + f.nz * 0.36;
      place({ type: 'planter', x, z, rot: rng.range(0, Math.PI * 2), s: rng.range(0.85, 1.1), collider: { hx: 0.3, hz: 0.3, maxY: ground(x, z) + 0.8 } }, block);
    }
    if (b.balcony && rng.chance(0.45)) {
      const bw = Math.min(4.2, f.len * 0.6);
      for (let fl = 1; fl < b.floors; fl++) {
        if (!rng.chance(0.6)) continue;
        const y = b.groundY + fl * 3;
        for (let k = 0; k < rng.int(1, 2); k++) {
          const a = (k === 0 ? -1 : 1) * (bw / 2 - 0.4);
          place({ type: 'planter', x: f.fx + f.tx * a + f.nx * 0.45, z: f.fz + f.tz * a + f.nz * 0.45, y, rot: rng.range(0, Math.PI * 2), s: rng.range(0.6, 0.8) }, null);
        }
      }
    }
  }

  // 3) Canecas, bolsas de basura e hidrantes en el borde del andén.
  for (const block of city.blocks) {
    if (block.type !== 'residencial' || !block.ring) continue;
    walkCurb(block, 0.5, rng.range(35, 60), rng.range(5, 20), (x, z, s) => {
      if (rng.chance(0.55)) {
        const c = place({ type: 'trashcan', x, z, rot: rng.range(0, Math.PI * 2), collider: { hx: 0.3, hz: 0.3, maxY: ground(x, z) + 0.95 } }, block);
        if (!c) return;
        const nb = rng.chance(0.6) ? rng.int(1, 3) : 0;
        for (let k = 0; k < nb; k++) {
          const d = (0.55 + k * 0.45) * (rng.chance(0.5) ? 1 : -1);
          place({ type: 'trashbag', x: x + s.tx * d, z: z + s.tz * d, rot: rng.range(0, Math.PI * 2), s: rng.range(0.8, 1.15) }, block);
        }
      } else if (rng.chance(0.3)) {
        place({ type: 'hydrant', x, z, rot: s.rot, collider: { hx: 0.16, hz: 0.16, maxY: ground(x, z) + 0.8 } }, block);
      } else {
        for (let k = 0; k < rng.int(1, 3); k++) place({ type: 'trashbag', x: x + s.tx * k * 0.45, z: z + s.tz * k * 0.45, rot: rng.range(0, Math.PI * 2), s: rng.range(0.8, 1.15) }, block);
      }
    });
  }

  // 4) Alcantarillas en la calzada.
  for (const e of city.edges) {
    if (!e.active || e.length < 12 || !insideMap(e.pts[0][0], e.pts[0][1])) continue;
    const t = rng.range(0.25, 0.75) * e.length;
    const p = pointAlong(e.pts, e.cum, t);
    const lane = (rng.chance(0.5) ? 1 : -1) * e.width * 0.2;
    place({ type: 'manhole', x: p.x - p.dz * lane, z: p.z + p.dx * lane, rot: rng.range(0, Math.PI * 2), onRoad: true }, null);
  }

  // 5) Placas de nomenclatura en una esquina de cada cruce.
  for (const n of city.nodes) {
    if (!n.active || n.links.length < 3 || !insideMap(n.x, n.z)) continue;
    // Nombre de cada vía del cruce y su rumbo (la placa va paralela a la vía).
    const byName = new Map();
    for (const l of n.links) {
      const e = city.edges[l.edge];
      if (!e.plate || byName.has(e.plate)) continue;
      const q = e.pts[l.dir === 1 ? 1 : e.pts.length - 2];
      byName.set(e.plate, Math.atan2(-(q[1] - n.z), q[0] - n.x));
    }
    const names = [...byName.keys()];
    if (names.length < 2) continue;
    const rots = names.slice(0, 2).map((nm) => byName.get(nm));
    for (let tries = 0; tries < 10; tries++) {
      const ang = rng.range(0, Math.PI * 2);
      const r = rng.range(5, 9);
      const x = n.x + Math.cos(ang) * r;
      const z = n.z + Math.sin(ang) * r;
      if (onRoadCheck(x, z)) continue;
      const block = city.blocks.find((b) => b.ring && x > b.minX && x < b.maxX && z > b.minZ && z < b.maxZ && pointInPoly(x, z, b.curb));
      if (!block || distToPolyEdge(x, z, block.curb) > 0.9) continue;
      if (place({ type: 'streetSign', x, z, names: names.slice(0, 2), rots, collider: { hx: 0.07, hz: 0.07 } }, block)) break;
    }
  }

  // 6) Paraderos de bus: los reales de OpenStreetMap y, en las vías
  // principales sin uno real cerca, uno de cada tres tramos largos.
  const realStops = [];
  for (const st of MAPA.stops ?? []) {
    const c = nearestCarSeg(st.x, st.z, 16);
    if (!c) continue;
    const side = Math.sign((st.x - c.x) * -c.dz + (st.z - c.z) * c.dx) || 1;
    const off = c.hw + 0.6;
    const x = c.x - c.dz * off * side;
    const z = c.z + c.dx * off * side;
    const block = city.blocks.find((b) => b.ring && x > b.minX && x < b.maxX && z > b.minZ && z < b.maxZ && pointInPoly(x, z, b.curb));
    if (!block) continue;
    const rot = Math.atan2(c.dz * side, -c.dx * side);
    if (place({ type: 'busStop', x, z, rot, name: st.n ?? '', collider: { hx: 0.8, hz: 0.8, maxY: ground(x, z) + 0.9 } }, block)) realStops.push({ x, z });
  }
  let stopK = 0;
  for (const e of city.edges) {
    if (!e.active || !['secondary', 'tertiary'].includes(e.cls) || e.length < 50 || stopK++ % 3) continue;
    const mid = pointAlong(e.pts, e.cum, e.length / 2);
    if (realStops.some((q) => Math.hypot(q.x - mid.x, q.z - mid.z) < 150)) continue;
    const p = pointAlong(e.pts, e.cum, e.length / 2);
    for (const side of rng.chance(0.5) ? [1, -1] : [-1, 1]) {
      const off = e.width / 2 + 0.6;
      const x = p.x - p.dz * off * side;
      const z = p.z + p.dx * off * side;
      if (!insideMap(x, z)) continue;
      const block = city.blocks.find((b) => b.ring && x > b.minX && x < b.maxX && z > b.minZ && z < b.maxZ && pointInPoly(x, z, b.curb));
      if (!block) continue;
      const rot = Math.atan2(p.dz * side, -p.dx * side);
      if (place({ type: 'busStop', x, z, rot, collider: { hx: 0.8, hz: 0.8, maxY: ground(x, z) + 0.9 } }, block)) break;
    }
  }

  // 6b) Semáforos reales de OpenStreetMap: el poste en la esquina del andén
  // más cercana y el brazo sobre la calzada.
  for (const [sx, sz] of MAPA.signals ?? []) {
    let done = false;
    for (let r = 4.5; r <= 13 && !done; r += 1.5) {
      for (let k = 0; k < 20 && !done; k++) {
        const a = (k / 20) * Math.PI * 2 + 0.13;
        const x = sx + Math.cos(a) * r;
        const z = sz + Math.sin(a) * r;
        if (onRoadCheck(x, z) || !insideMap(x, z)) continue;
        const block = city.blocks.find((b) => b.ring && x > b.minX && x < b.maxX && z > b.minZ && z < b.maxZ && pointInPoly(x, z, b.curb));
        if (!block || distToPolyEdge(x, z, block.curb) > 0.7) continue;
        const arm = Math.min(4.2, Math.max(2, r * 0.55));
        if (place({ type: 'trafficLight', x, z, rot: Math.atan2(sx - x, sz - z), arm, collider: { hx: 0.12, hz: 0.12 } }, block)) done = true;
      }
    }
  }

  // 7) Venteros ambulantes cerca de los lugares concurridos.
  const VENDORS = ['minutos', 'frutas', 'mangos', 'arepas', 'helados', 'dulces'];
  const spots = [];
  for (const poi of city.pois) spots.push(poi, poi);
  // Y en los parques (plaza de Aranjuez, Morro de Moravia).
  for (const a of city.areas) if (a.kind === 'parque' && a.area > 800 && insideMap(a.c[0], a.c[1])) spots.push({ x: a.c[0], z: a.c[1] });
  let vk = rng.int(0, VENDORS.length - 1);
  for (const sp of spots) {
    for (let tries = 0; tries < 80; tries++) {
      const ang = rng.range(0, Math.PI * 2);
      const rr = rng.range(4, 30);
      const x = sp.x + Math.cos(ang) * rr;
      const z = sp.z + Math.sin(ang) * rr;
      if (onRoadCheck(x, z)) continue;
      const block = city.blocks.find((b) => b.ring && x > b.minX && x < b.maxX && z > b.minZ && z < b.maxZ && pointInPoly(x, z, b.curb));
      if (!block) continue;
      // Solo sobre el andén (entre sardinel y paramento).
      if (block.lots.some((l) => pointInPoly(x, z, l))) continue;
      // Mirando hacia la calle más cercana.
      let bestR = null;
      for (let a = 0; a < 8; a++) {
        const ca = Math.cos((a / 8) * Math.PI * 2);
        const sa = Math.sin((a / 8) * Math.PI * 2);
        if (onRoadCheck(x + ca * 3, z + sa * 3)) {
          bestR = Math.atan2(ca, sa);
          break;
        }
      }
      const p = place({ type: 'vendor', kind: VENDORS[vk % VENDORS.length], x, z, rot: bestR ?? 0, collider: { hx: 0.55, hz: 0.55, maxY: ground(x, z) + 1.2 } }, block);
      if (p) {
        vk++;
        break;
      }
    }
  }

  for (const p of added) addPropCollider(city, p);
  return added;
}

export { polyCentroid, polyPerimeter };
