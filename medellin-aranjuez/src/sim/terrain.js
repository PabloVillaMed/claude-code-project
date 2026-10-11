// Terreno y calzadas del mapa real (de Moravia a Aranjuez): la elevación sale
// del SRTM (rejilla de 10 m suavizada, ver scripts/mapa/construir.mjs) y las
// calzadas de las vías de OpenStreetMap con su ancho. Todo es analítico y
// determinista, así la física y el render coinciden exactamente.
// Coordenadas: 1 unidad = 1 m, x = oriente, z = sur; y = altura − GEO_REF.

import MAPA from '../data/mapa.json';
import { GEO_REF, valleyHeight } from './geography.js';

export { MAPA };

export const GRID = {
  curb: 0.15, // altura del sardinel/andén (m)
  sidewalk: MAPA.sidewalk, // del sardinel a la línea de paramento (m)
  ring: MAPA.ring, // centro del andén, por donde caminan los peatones (m)
  laneWidth: 3.1, // ancho de referencia de un carril
};

export const MAP_MIN_X = MAPA.bounds.minX;
export const MAP_MAX_X = MAPA.bounds.maxX;
export const MAP_MIN_Z = MAPA.bounds.minZ;
export const MAP_MAX_Z = MAPA.bounds.maxZ;

/** Límite jugable: la región descargada. */
export const PLAY_BOUNDS = { minX: MAP_MIN_X, maxX: MAP_MAX_X, minZ: MAP_MIN_Z, maxZ: MAP_MAX_Z };

export function insideMap(x, z, margin = 0) {
  return x >= MAP_MIN_X - margin && x <= MAP_MAX_X + margin && z >= MAP_MIN_Z - margin && z <= MAP_MAX_Z + margin;
}

// ------------------------------------------------------------------ terreno
const T = MAPA.terrain;
const HGT = Float32Array.from(T.dm, (v) => v / 10 - GEO_REF);
const EDGE_BLEND = 180; // m: en el borde de la rejilla se funde con el valle

function cell(i, j) {
  i = i < 0 ? 0 : i >= T.nx ? T.nx - 1 : i;
  j = j < 0 ? 0 : j >= T.nz ? T.nz - 1 : j;
  return HGT[j * T.nx + i];
}

// Catmull-Rom: continuo en pendiente (sin quiebres en los bordes de celda).
function cr(p0, p1, p2, p3, t) {
  return p1 + 0.5 * t * (p2 - p0 + t * (2 * p0 - 5 * p1 + 4 * p2 - p3 + t * (3 * (p1 - p2) + p3 - p0)));
}

function gridHeight(x, z) {
  const u = (x - T.x0) / T.step;
  const v = (z - T.z0) / T.step;
  const i = Math.floor(u);
  const j = Math.floor(v);
  const fu = u - i;
  const fv = v - j;
  const row = (jj) => cr(cell(i - 1, jj), cell(i, jj), cell(i + 1, jj), cell(i + 2, jj), fu);
  return cr(row(j - 1), row(j), row(j + 1), row(j + 2), fv);
}

const GX0 = T.x0;
const GZ0 = T.z0;
const GX1 = T.x0 + (T.nx - 1) * T.step;
const GZ1 = T.z0 + (T.nz - 1) * T.step;

// ------------------------------------------------------------------ río
// El río Medellín va canalizado: cauce de ~36 m con taludes de concreto.
export const RIVER = { half: 18, bank: 6, depth: 4.2, pts: MAPA.water.find((w) => /Medell/i.test(w.name))?.pts ?? [] };
const RIVER_SEGS = [];
for (let k = 1; k < RIVER.pts.length; k++) {
  const [ax, az] = RIVER.pts[k - 1];
  const [bx, bz] = RIVER.pts[k];
  RIVER_SEGS.push({ ax, az, dx: bx - ax, dz: bz - az, l2: (bx - ax) ** 2 + (bz - az) ** 2 || 1e-9, minX: Math.min(ax, bx), maxX: Math.max(ax, bx), minZ: Math.min(az, bz), maxZ: Math.max(az, bz) });
}
const RIVER_R = RIVER.half + RIVER.bank;

/** Distancia al eje del río (Infinity si está lejos). */
export function riverDistance(x, z) {
  let best = Infinity;
  for (const s of RIVER_SEGS) {
    if (x < s.minX - RIVER_R || x > s.maxX + RIVER_R || z < s.minZ - RIVER_R || z > s.maxZ + RIVER_R) continue;
    const t = Math.max(0, Math.min(1, ((x - s.ax) * s.dx + (z - s.az) * s.dz) / s.l2));
    const d = Math.hypot(x - s.ax - s.dx * t, z - s.az - s.dz * t);
    if (d < best) best = d;
  }
  return best;
}

function riverCarve(x, z) {
  const d = riverDistance(x, z);
  if (d >= RIVER_R) return 0;
  if (d <= RIVER.half) return RIVER.depth;
  const t = (RIVER_R - d) / RIVER.bank;
  return RIVER.depth * t;
}

function naturalHeight(x, z) {
  // Distancia al borde de la rejilla medida hacia adentro.
  const inside = Math.min(x - GX0, GX1 - x, z - GZ0, GZ1 - z);
  if (inside >= EDGE_BLEND) return gridHeight(x, z);
  if (inside <= 0) return valleyHeight(x, z);
  const t = inside / EDGE_BLEND;
  const w = t * t * (3 - 2 * t);
  return gridHeight(x, z) * w + valleyHeight(x, z) * (1 - w);
}

/** Altura del terreno en (x, z) (con el cauce del río; los puentes lo cruzan a nivel). */
export function terrainHeight(x, z) {
  const h = naturalHeight(x, z);
  const c = riverCarve(x, z);
  if (c <= 0 || roadAt(x, z, 1.5)) return h;
  return h - c;
}

/** Terreno de fondo (solo render): el mismo del mapa, que ya se funde con el valle. */
export function backdropHeight(x, z) {
  return naturalHeight(x, z);
}

// ------------------------------------------------------------------ calzadas
// Índice espacial de tramos de calzada (cápsulas con el medio ancho de la vía).
const CS = 24;
/** Radio del disco de asfalto de un cruce, relativo al medio ancho de la vía más ancha. */
export const NODE_DISC = 1.08;
const roadCells = new Map();
const ROAD_SEGS = [];
const key = (i, j) => i * 73856093 + j * 19349663;
for (const [ei, e] of MAPA.edges.entries()) {
  const hw = e.w / 2;
  for (let k = 1; k < e.pts.length; k++) {
    const [ax, az] = e.pts[k - 1];
    const [bx, bz] = e.pts[k];
    const seg = { ax, az, bx, bz, hw, edge: ei, dx: bx - ax, dz: bz - az };
    seg.l2 = seg.dx * seg.dx + seg.dz * seg.dz || 1e-9;
    ROAD_SEGS.push(seg);
    const i0 = Math.floor((Math.min(ax, bx) - hw) / CS);
    const i1 = Math.floor((Math.max(ax, bx) + hw) / CS);
    const j0 = Math.floor((Math.min(az, bz) - hw) / CS);
    const j1 = Math.floor((Math.max(az, bz) + hw) / CS);
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const k2 = key(i, j);
        let c = roadCells.get(k2);
        if (!c) roadCells.set(k2, (c = []));
        c.push(seg);
      }
    }
  }
}

// Intersecciones: disco de asfalto (el mismo que dibuja el render) con el
// medio ancho de la vía más ancha que llega, para que las esquinas sean calzada.
{
  const deg = new Map();
  for (const [ei, e] of MAPA.edges.entries()) {
    if (!e.car) continue;
    for (const n of [e.a, e.b]) {
      const d = deg.get(n) ?? { k: 0, hw: 0, edge: ei };
      d.k++;
      d.hw = Math.max(d.hw, e.w / 2);
      deg.set(n, d);
    }
  }
  for (const [n, d] of deg) {
    if (d.k < 2) continue;
    const { x, z } = MAPA.nodes[n];
    const hw = d.hw * NODE_DISC;
    const seg = { ax: x, az: z, bx: x, bz: z, hw, edge: d.edge, dx: 0, dz: 0, l2: 1e-9 };
    ROAD_SEGS.push(seg);
    for (let i = Math.floor((x - hw) / CS); i <= Math.floor((x + hw) / CS); i++) {
      for (let j = Math.floor((z - hw) / CS); j <= Math.floor((z + hw) / CS); j++) {
        const k2 = key(i, j);
        let c = roadCells.get(k2);
        if (!c) roadCells.set(k2, (c = []));
        c.push(seg);
      }
    }
  }
}

/**
 * Tramo de calzada bajo (x, z): {edge, t (0..1 del tramo), off (distancia al
 * eje), seg} o null. `margin` amplía el ancho (p. ej. para el sardinel).
 */
export function roadAt(x, z, margin = 0) {
  const c = roadCells.get(key(Math.floor(x / CS), Math.floor(z / CS)));
  if (!c) return null;
  let best = null;
  for (const s of c) {
    const t = Math.max(0, Math.min(1, ((x - s.ax) * s.dx + (z - s.az) * s.dz) / s.l2));
    const ex = x - s.ax - s.dx * t;
    const ez = z - s.az - s.dz * t;
    const d2 = ex * ex + ez * ez;
    const r = s.hw + margin;
    if (d2 <= r * r && (!best || d2 - s.hw * s.hw < best.m)) best = { edge: s.edge, seg: s, t, off: Math.sqrt(d2), m: d2 - s.hw * s.hw };
  }
  return best;
}

/** ¿El punto está sobre la calzada (asfalto) de alguna vía? */
export function onRoad(x, z) {
  return roadAt(x, z) !== null;
}

/** ¿El punto está sobre andén, lote o zona verde (todo lo que no es calzada) dentro del mapa? */
export function onBlock(x, z) {
  return insideMap(x, z) && !onRoad(x, z);
}

// ------------------------------------------------------------------ estructuras caminables
// Plataformas, escaleras, rampas y puentes peatonales (p. ej. la estación del
// metro). Cada una: {minX, maxX, minZ, maxZ, over, height(x, z) → y | null}.
// `over` = se puede pasar por debajo (puentes): solo cuenta si se viene de arriba.
const WALKABLES = [];

export function addWalkable(w) {
  WALKABLES.push(w);
  return w;
}

export function clearWalkables() {
  WALKABLES.length = 0;
}

/** Altura de la estructura caminable más alta bajo (x, z) alcanzable desde `y`. */
export function walkableHeight(x, z, y = null) {
  let best = null;
  for (const w of WALKABLES) {
    if (x < w.minX || x > w.maxX || z < w.minZ || z > w.maxZ) continue;
    if (w.over && y === null) continue;
    const h = w.height(x, z);
    if (h === null) continue;
    if (y !== null && h > y + 0.7) continue; // no se sube de un salto a un puente
    if (best === null || h > best) best = h;
  }
  return best;
}

/**
 * Altura del suelo caminable: terreno + andén si no es calzada, o la
 * estructura sobre la que se está parado (y = altura actual de los pies).
 */
export function groundHeight(x, z, y = null) {
  const g = terrainHeight(x, z) + (onRoad(x, z) ? 0 : GRID.curb);
  if (!WALKABLES.length) return g;
  const w = walkableHeight(x, z, y);
  return w !== null && w > g ? w : g;
}
