// Geometría que se "cuelga" del terreno: polígonos (andenes, patios, zonas
// verdes) y cintas a lo largo de polilíneas (vías, quebradas, demarcación).
// Todo se subdivide para seguir las lomas sin quedar enterrado ni flotando.

import * as THREE from 'three';

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();

/** Cuadrilátero con la normal pedida (voltea el orden si hace falta). */
export function orientedQuad(g, pts, n, uvs, color) {
  _a.fromArray(pts[1]).sub(_b.fromArray(pts[0]));
  _c.fromArray(pts[2]).sub(_b);
  const cr = _a.cross(_c);
  if (cr.x * n[0] + cr.y * n[1] + cr.z * n[2] < 0) g.quad(pts[0], pts[3], pts[2], pts[1], n, [uvs[0], uvs[3], uvs[2], uvs[1]], color);
  else g.quad(pts[0], pts[1], pts[2], pts[3], n, uvs, color);
}

/** Triángulo con la normal pedida. */
export function orientedTri(g, pts, n, uvs, color) {
  _a.fromArray(pts[1]).sub(_b.fromArray(pts[0]));
  _c.fromArray(pts[2]).sub(_b);
  const cr = _a.cross(_c);
  if (cr.x * n[0] + cr.y * n[1] + cr.z * n[2] < 0) g.tri(pts[0], pts[2], pts[1], n, [uvs[0], uvs[2], uvs[1]], color);
  else g.tri(pts[0], pts[1], pts[2], n, uvs, color);
}

/** Normal del terreno por diferencias finitas. */
function normalAt(hf, x, z) {
  const e = 0.6;
  const dx = hf(x + e, z) - hf(x - e, z);
  const dz = hf(x, z + e) - hf(x, z - e);
  const l = Math.hypot(dx, 2 * e, dz);
  return [-dx / l, (2 * e) / l, -dz / l];
}

/**
 * Triángulos 2D ([[x,z],[x,z],[x,z]]) colgados del terreno, subdivididos
 * hasta que ningún lado supere `step` metros.
 */
export function drapeTris(g, tris, hf, { step = 4, uv = (x, z) => [x / 4, -z / 4], color } = {}) {
  const cache = new Map();
  const vert = (x, z) => {
    const k = `${Math.round(x * 100)},${Math.round(z * 100)}`;
    let i = cache.get(k);
    if (i === undefined) {
      const n = normalAt(hf, x, z);
      const [u, v] = uv(x, z);
      i = g.vertex(x, hf(x, z), z, n[0], n[1], n[2], u, v, color);
      cache.set(k, i);
    }
    return i;
  };
  // Bisección por el lado más largo hasta que ningún lado supere `step`:
  // los triángulos largos y angostos de los andenes se parten a lo largo, no
  // en una malla n² como antes.
  const out = [];
  const split = (A, B, C, depth) => {
    const ab = Math.hypot(B[0] - A[0], B[1] - A[1]);
    const bc = Math.hypot(C[0] - B[0], C[1] - B[1]);
    const ca = Math.hypot(A[0] - C[0], A[1] - C[1]);
    const L = Math.max(ab, bc, ca);
    if (L <= step || depth > 14) {
      out.push(A, B, C);
      return;
    }
    if (L === ab) {
      const M = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2];
      split(A, M, C, depth + 1);
      split(M, B, C, depth + 1);
    } else if (L === bc) {
      const M = [(B[0] + C[0]) / 2, (B[1] + C[1]) / 2];
      split(A, B, M, depth + 1);
      split(A, M, C, depth + 1);
    } else {
      const M = [(C[0] + A[0]) / 2, (C[1] + A[1]) / 2];
      split(A, B, M, depth + 1);
      split(M, B, C, depth + 1);
    }
  };
  for (const [A, B, C] of tris) {
    // Orientación: la cara debe mirar hacia arriba.
    const cross = (B[0] - A[0]) * (C[1] - A[1]) - (B[1] - A[1]) * (C[0] - A[0]);
    if (Math.abs(cross) < 1e-6) continue;
    if (cross < 0) split(A, B, C, 0);
    else split(A, C, B, 0);
  }
  for (let i = 0; i < out.length; i += 3) g.idx.push(vert(out[i][0], out[i][1]), vert(out[i + 1][0], out[i + 1][1]), vert(out[i + 2][0], out[i + 2][1]));
}

/** Triangula un polígono (con huecos opcionales) y lo cuelga del terreno. */
export function drapePolygon(g, poly, hf, opts = {}, holes = []) {
  if (!poly || poly.length < 3) return;
  const contour = poly.map(([x, z]) => new THREE.Vector2(x, z));
  const hs = holes.filter((h) => h && h.length >= 3).map((h) => h.map(([x, z]) => new THREE.Vector2(x, z)));
  let faces;
  try {
    faces = THREE.ShapeUtils.triangulateShape(contour, hs);
  } catch {
    return;
  }
  const all = [...poly, ...holes.filter((h) => h && h.length >= 3).flat()];
  drapeTris(
    g,
    faces.map(([a, b, c]) => [all[a], all[b], all[c]]),
    hf,
    opts,
  );
}

/** Densifica una polilínea para que ningún tramo supere `step` m. */
export function densify(pts, step) {
  const out = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const [ax, az] = pts[i - 1];
    const [bx, bz] = pts[i];
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / step));
    for (let k = 1; k <= n; k++) out.push([ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n]);
  }
  return out;
}

/** Tangente y normal (izquierda) en cada punto de una polilínea, con inglete. */
export function polylineFrames(pts) {
  const n = pts.length;
  const seg = [];
  for (let i = 1; i < n; i++) {
    const dx = pts[i][0] - pts[i - 1][0];
    const dz = pts[i][1] - pts[i - 1][1];
    const l = Math.hypot(dx, dz) || 1e-9;
    seg.push([dx / l, dz / l]);
  }
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = seg[Math.max(0, i - 1)];
    const b = seg[Math.min(seg.length - 1, i)];
    let tx = a[0] + b[0];
    let tz = a[1] + b[1];
    const l = Math.hypot(tx, tz) || 1;
    tx /= l;
    tz /= l;
    // Inglete: compensa el ancho en los quiebres (limitado).
    const cos = Math.max(0.5, tx * b[0] + tz * b[1]);
    out.push({ tx, tz, nx: -tz, nz: tx, miter: 1 / cos });
  }
  return out;
}

/**
 * Cinta a lo largo de una polilínea entre las distancias laterales off0..off1
 * (con signo, respecto a la normal izquierda), colgada del terreno.
 * `uv(s, off, x, z)` da la coordenada de textura.
 */
export function ribbon(g, pts, off0, off1, hf, { step = 3, across = 1, uv, color } = {}) {
  if (pts.length < 2) return;
  const P = densify(pts, step);
  const F = polylineFrames(P);
  const base = g.vertexCount;
  let s = 0;
  const cols = across + 1;
  for (let i = 0; i < P.length; i++) {
    if (i) s += Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]);
    const f = F[i];
    for (let k = 0; k <= across; k++) {
      const o = off0 + ((off1 - off0) * k) / across;
      const x = P[i][0] + f.nx * o * f.miter;
      const z = P[i][1] + f.nz * o * f.miter;
      const n = normalAt(hf, x, z);
      const [u, v] = uv ? uv(s, o, x, z) : [x / 4, -z / 4];
      g.vertex(x, hf(x, z), z, n[0], n[1], n[2], u, v, color);
    }
  }
  // Con la normal a la izquierda (x este, z sur) y off creciente, este orden mira hacia arriba.
  const up = off1 > off0;
  for (let i = 0; i < P.length - 1; i++) {
    for (let k = 0; k < across; k++) {
      const a = base + i * cols + k;
      const b = a + 1;
      const c = a + cols;
      const d = c + 1;
      if (up) g.idx.push(a, b, c, b, d, c);
      else g.idx.push(a, c, b, b, c, d);
    }
  }
}

/** Pared vertical a lo largo del borde de un polígono cerrado (sardinel, muro). */
export function polyWall(g, poly, outwardSign, yFn0, yFn1, { step = 3, uvScale = 1, color } = {}) {
  const n = poly.length;
  let acc = 0;
  for (let i = 0; i < n; i++) {
    const [ax, az] = poly[i];
    const [bx, bz] = poly[(i + 1) % n];
    const l = Math.hypot(bx - ax, bz - az);
    if (l < 1e-3) continue;
    const tx = (bx - ax) / l;
    const tz = (bz - az) / l;
    const N = [tz * outwardSign, 0, -tx * outwardSign];
    const k = Math.max(1, Math.ceil(l / step));
    for (let j = 0; j < k; j++) {
      const t0 = (l * j) / k;
      const t1 = (l * (j + 1)) / k;
      const x0 = ax + tx * t0;
      const z0 = az + tz * t0;
      const x1 = ax + tx * t1;
      const z1 = az + tz * t1;
      const u0 = (acc + t0) / uvScale;
      const u1 = (acc + t1) / uvScale;
      orientedQuad(
        g,
        [
          [x0, yFn0(x0, z0), z0],
          [x1, yFn0(x1, z1), z1],
          [x1, yFn1(x1, z1), z1],
          [x0, yFn1(x0, z0), z0],
        ],
        N,
        [
          [u0, 0],
          [u1, 0],
          [u1, 0.1],
          [u0, 0.1],
        ],
        color,
      );
    }
    acc += l;
  }
}
