// El terreno se aceleró (índice espacial del río, rejilla sin recortes):
// aquí va la versión de antes, copiada tal cual, y se compara bit a bit
// (Object.is: distingue −0 y NaN) con la nueva en toda la rejilla, al azar,
// pegado al río y justo en los bordes de las cajas de sus tramos.
import { describe, expect, it } from 'vitest';
import { GEO_REF, valleyHeight } from '../../src/sim/geography.js';
import { GRID, MAPA, RIVER, backdropHeight, groundHeight, riverDistance, roadAt, terrainHeight } from '../../src/sim/terrain.js';

// ------------------------------------------------------------------ versión vieja
const T = MAPA.terrain;
const HGT = Float32Array.from(T.dm, (v) => v / 10 - GEO_REF);
const EDGE_BLEND = 180;
function cell(i, j) {
  i = i < 0 ? 0 : i >= T.nx ? T.nx - 1 : i;
  j = j < 0 ? 0 : j >= T.nz ? T.nz - 1 : j;
  return HGT[j * T.nx + i];
}
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
const RIVER_SEGS = [];
for (let k = 1; k < RIVER.pts.length; k++) {
  const [ax, az] = RIVER.pts[k - 1];
  const [bx, bz] = RIVER.pts[k];
  RIVER_SEGS.push({ ax, az, dx: bx - ax, dz: bz - az, l2: (bx - ax) ** 2 + (bz - az) ** 2 || 1e-9, minX: Math.min(ax, bx), maxX: Math.max(ax, bx), minZ: Math.min(az, bz), maxZ: Math.max(az, bz) });
}
const RIVER_R = RIVER.half + RIVER.bank;
function oldRiverDistance(x, z) {
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
  const d = oldRiverDistance(x, z);
  if (d >= RIVER_R) return 0;
  if (d <= RIVER.half) return RIVER.depth;
  const t = (RIVER_R - d) / RIVER.bank;
  return RIVER.depth * t;
}
function naturalHeight(x, z) {
  const inside = Math.min(x - GX0, GX1 - x, z - GZ0, GZ1 - z);
  if (inside >= EDGE_BLEND) return gridHeight(x, z);
  if (inside <= 0) return valleyHeight(x, z);
  const t = inside / EDGE_BLEND;
  const w = t * t * (3 - 2 * t);
  return gridHeight(x, z) * w + valleyHeight(x, z) * (1 - w);
}
function oldTerrainHeight(x, z) {
  const h = naturalHeight(x, z);
  const c = riverCarve(x, z);
  if (c <= 0 || roadAt(x, z, 1.5)) return h;
  return h - c;
}

// ------------------------------------------------------------------ puntos
function lcg(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Compara la versión vieja y la nueva en una lista de puntos; devuelve los que difieren. */
function mismatches(pts) {
  const bad = [];
  for (const [x, z] of pts) {
    const a = [oldTerrainHeight(x, z), naturalHeight(x, z), oldRiverDistance(x, z)];
    const b = [terrainHeight(x, z), backdropHeight(x, z), riverDistance(x, z)];
    for (let k = 0; k < 3; k++) if (!Object.is(a[k], b[k])) bad.push({ x, z, k, old: a[k], now: b[k] });
    if (bad.length > 20) break;
  }
  return bad;
}

describe('carga: el terreno acelerado da exactamente lo mismo', () => {
  it('en cada nodo de la rejilla, en sus centros y fracciones, y por fuera del borde', () => {
    const pts = [];
    for (let j = -4; j <= T.nz + 3; j++) {
      for (let i = -4; i <= T.nx + 3; i++) {
        const x = T.x0 + i * T.step;
        const z = T.z0 + j * T.step;
        pts.push([x, z], [x + T.step / 2, z + T.step / 2], [x + T.step * 0.137, z + T.step * 0.871]);
      }
    }
    expect(pts.length).toBeGreaterThan(190000);
    expect(mismatches(pts)).toEqual([]);
  });

  it('en miles de puntos al azar (mapa, borde de la rejilla y valle)', () => {
    const r = lcg(12345);
    const pts = [];
    for (let k = 0; k < 40000; k++) pts.push([GX0 - 600 + r() * (GX1 - GX0 + 1200), GZ0 - 600 + r() * (GZ1 - GZ0 + 1200)]);
    // Coordenadas "redondas" como las que usan las mallas (pasos de 0.5 m, ±0.6 de las normales).
    for (let k = 0; k < 20000; k++) {
      const x = Math.round((-1000 + r() * 2000) * 2) / 2;
      const z = Math.round((-800 + r() * 1600) * 2) / 2;
      pts.push([x, z], [x + 0.6, z], [x - 0.6, z], [x, z + 0.6], [x, z - 0.6]);
    }
    expect(mismatches(pts)).toEqual([]);
  });

  it('pegado al río y en los bordes exactos de las cajas de sus tramos', () => {
    const r = lcg(777);
    const pts = [];
    for (const s of RIVER_SEGS) {
      // Bordes exactos de la prueba de caja (y un poquito a cada lado).
      const xs = [s.minX - RIVER_R, s.maxX + RIVER_R, s.ax, s.ax + s.dx];
      const zs = [s.minZ - RIVER_R, s.maxZ + RIVER_R, s.az, s.az + s.dz];
      for (const x of xs) for (const z of zs) for (const e of [0, 1e-9, -1e-9, 0.5, -0.5]) pts.push([x + e, z], [x, z + e], [x + e, z - e]);
      // Al azar a lo largo del tramo, a menos de 40 m del eje.
      for (let k = 0; k < 400; k++) {
        const t = r();
        const off = (r() - 0.5) * 80;
        const l = Math.sqrt(s.l2);
        pts.push([s.ax + s.dx * t - (s.dz / l) * off, s.az + s.dz * t + (s.dx / l) * off]);
      }
    }
    expect(pts.length).toBeGreaterThan(25000);
    expect(mismatches(pts)).toEqual([]);
  });

  it('con entradas raras (NaN, infinitos, −0) y el suelo caminable', () => {
    const odd = [
      [NaN, 0],
      [0, NaN],
      [Infinity, 0],
      [-Infinity, 5],
      [0, -Infinity],
      [-0, -0],
      [-0, 12.5],
      [1e9, -1e9],
    ];
    expect(mismatches(odd)).toEqual([]);
    const r = lcg(99);
    for (let k = 0; k < 5000; k++) {
      const x = -980 + r() * 1960;
      const z = -770 + r() * 1540;
      const old = oldTerrainHeight(x, z) + (roadAt(x, z) !== null ? 0 : GRID.curb);
      expect(Object.is(groundHeight(x, z), old)).toBe(true);
    }
  });
});
