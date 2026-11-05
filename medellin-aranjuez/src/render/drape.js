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

/**
 * Recuerda el último valor de `fn(x, z)`: las paredes y bordes piden la misma
 * altura varias veces seguidas en el mismo punto (arriba y abajo, fin de un
 * tramo y comienzo del siguiente). Da exactamente lo mismo que llamar `fn`.
 */
export function lastValue(fn) {
  let lx = NaN;
  let lz = NaN;
  let ly = 0;
  return (x, z) => {
    if (x !== lx || z !== lz) {
      ly = fn(x, z);
      lx = x;
      lz = z;
    }
    return ly;
  };
}

// Clave numérica del vértice redondeado a cm (la misma que "x,z" en texto, sin
// armar cadenas): |z| < 20 km cabe en los 22 bits bajos.
const KEY_Z = 4194304;
const vertKey = (rx, rz) => (rz > -2097152 && rz < 2097152 ? rx * KEY_Z + rz : `${rx},${rz}`);

/** Normal del terreno por diferencias finitas. */
function normalAt(hf, x, z) {
  const e = 0.6;
  const dx = hf(x + e, z) - hf(x - e, z);
  const dz = hf(x, z + e) - hf(x, z - e);
  const l = Math.hypot(dx, 2 * e, dz);
  return [-dx / l, (2 * e) / l, -dz / l];
}

/**
 * Error de la cuerda P-Q contra `h`: cuánto se aparta la recta entre los
 * extremos de la altura real en el punto medio y en los cuartos. Las cuentas
 * son simétricas (P-Q da lo mismo que Q-P), así los dos triángulos que
 * comparten un lado deciden igual y la malla no queda con grietas.
 */
function chordError(h, px, pz, hp, qx, qz, hq) {
  const em = Math.abs(h((px + qx) / 2, (pz + qz) / 2) - (hp + hq) / 2);
  const e1 = Math.abs(h((3 * px + qx) / 4, (3 * pz + qz) / 4) - (3 * hp + hq) / 4);
  const e3 = Math.abs(h((px + 3 * qx) / 4, (pz + 3 * qz) / 4) - (hp + 3 * hq) / 4);
  return Math.max(em, e1, e3);
}

/**
 * Triángulos 2D ([[x,z],[x,z],[x,z]]) colgados del terreno, subdivididos
 * hasta que ningún lado supere `step` metros.
 *
 * Con `tol` (m) la subdivisión es adaptativa: un lado de más de `step` m solo
 * se parte si supera `maxStep` o si la recta entre sus extremos se aparta del
 * terreno más de `tol` (es decir, donde la pendiente cambia: una ladera pareja
 * se representa exacta con triángulos grandes). La decisión depende solo del
 * lado, así que vecinos con el mismo lado lo parten igual (sin huecos).
 */
export function drapeTris(g, tris, hf, { step = 4, uv = (x, z) => [x / 4, -z / 4], color, tol = 0, maxStep = Infinity } = {}) {
  if (tol > 0) return drapeTrisAdaptive(g, tris, hf, step, uv, color, tol, maxStep);
  const cache = new Map();
  const vert = (x, z) => {
    const k = vertKey(Math.round(x * 100), Math.round(z * 100));
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

/** drapeTris con subdivisión adaptativa (ver arriba). */
function drapeTrisAdaptive(g, tris, hf, step, uv, color, tol, maxStep) {
  const cache = new Map(); // clave -> índice del vértice
  const hc = new Map(); // clave -> altura (para medir las cuerdas)
  const height = (P) => {
    const k = vertKey(Math.round(P[0] * 100), Math.round(P[1] * 100));
    let y = hc.get(k);
    if (y === undefined) hc.set(k, (y = hf(P[0], P[1])));
    return y;
  };
  const vert = (x, z) => {
    const k = vertKey(Math.round(x * 100), Math.round(z * 100));
    let i = cache.get(k);
    if (i === undefined) {
      const n = normalAt(hf, x, z);
      const [u, v] = uv(x, z);
      i = g.vertex(x, hc.get(k) ?? hf(x, z), z, n[0], n[1], n[2], u, v, color);
      cache.set(k, i);
    }
    return i;
  };
  // ¿Hay que partir el lado P-Q de largo L? La respuesta se guarda por el punto
  // medio del lado (cada lado se pregunta de nuevo en cada nivel de la bisección).
  const dec = new Map();
  const needs = (P, Q, L) => {
    if (L <= step) return false;
    if (L > maxStep) return true;
    const k = vertKey(Math.round(((P[0] + Q[0]) / 2) * 100), Math.round(((P[1] + Q[1]) / 2) * 100));
    let d = dec.get(k);
    if (d === undefined) dec.set(k, (d = chordError(hf, P[0], P[1], height(P), Q[0], Q[1], height(Q)) > tol));
    return d;
  };
  const out = [];
  const split = (A, B, C, depth) => {
    const ab = Math.hypot(B[0] - A[0], B[1] - A[1]);
    const bc = Math.hypot(C[0] - B[0], C[1] - B[1]);
    const ca = Math.hypot(A[0] - C[0], A[1] - C[1]);
    // Se parte el más largo de los lados que lo necesitan.
    const sab = needs(A, B, ab) ? ab : -1;
    const sbc = needs(B, C, bc) ? bc : -1;
    const sca = needs(C, A, ca) ? ca : -1;
    const L = Math.max(sab, sbc, sca);
    if (L < 0 || depth > 14) {
      out.push(A, B, C);
      return;
    }
    if (L === sab) {
      const M = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2];
      split(A, M, C, depth + 1);
      split(M, B, C, depth + 1);
    } else if (L === sbc) {
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
    const cross = (B[0] - A[0]) * (C[1] - A[1]) - (B[1] - A[1]) * (C[0] - A[0]);
    if (Math.abs(cross) < 1e-6) continue;
    if (cross < 0) split(A, B, C, 0);
    else split(A, C, B, 0);
  }
  for (let i = 0; i < out.length; i += 3) g.idx.push(vert(out[i][0], out[i][1]), vert(out[i + 1][0], out[i + 1][1]), vert(out[i + 2][0], out[i + 2][1]));
}

/** Douglas-Peucker sobre un anillo cerrado (quita vértices casi colineales). */
export function simplifyRing(pts, tol) {
  if (!tol || pts.length < 8) return pts;
  const keep = new Uint8Array(pts.length);
  const dp = (i0, i1) => {
    const [ax, az] = pts[i0];
    const [bx, bz] = pts[i1];
    const dx = bx - ax;
    const dz = bz - az;
    const l = Math.hypot(dx, dz) || 1e-9;
    let best = -1;
    let bd = tol;
    for (let i = i0 + 1; i < i1; i++) {
      const d = Math.abs((pts[i][0] - ax) * dz - (pts[i][1] - az) * dx) / l;
      if (d > bd) {
        bd = d;
        best = i;
      }
    }
    if (best >= 0) {
      keep[best] = 1;
      dp(i0, best);
      dp(best, i1);
    }
  };
  const mid = Math.floor(pts.length / 2);
  keep[0] = keep[mid] = keep[pts.length - 1] = 1;
  dp(0, mid);
  dp(mid, pts.length - 1);
  const out = pts.filter((_, i) => keep[i]);
  return out.length >= 3 ? out : pts;
}

/** Triangula un polígono (con huecos opcionales) y lo cuelga del terreno. */
export function drapePolygon(g, poly, hf, opts = {}, holes = []) {
  if (!poly || poly.length < 3) return;
  if (opts.simplify) {
    poly = simplifyRing(poly, opts.simplify);
    holes = holes.map((h) => (h ? simplifyRing(h, opts.simplify) : h));
  }
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
export function polyWall(g, poly, outwardSign, yFn0, yFn1, { step = 3, uvScale = 1, color, tol = 0, maxStep = Infinity } = {}) {
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
    // Con `tol`: tramos adaptativos (largos donde el borde de arriba es casi recto).
    const ts = tol > 0 ? wallBreaks(ax, az, tx, tz, l, yFn1, step, tol, maxStep) : null;
    const k = ts ? ts.length - 1 : Math.max(1, Math.ceil(l / step));
    // El fin de cada tramo es el comienzo del siguiente (mismas cuentas): sus alturas se reusan.
    let a0 = yFn0(ax, az);
    let a1 = yFn1(ax, az);
    for (let j = 0; j < k; j++) {
      const t0 = ts ? ts[j] : (l * j) / k;
      const t1 = ts ? ts[j + 1] : (l * (j + 1)) / k;
      const x0 = ax + tx * t0;
      const z0 = az + tz * t0;
      const x1 = ax + tx * t1;
      const z1 = az + tz * t1;
      const u0 = (acc + t0) / uvScale;
      const u1 = (acc + t1) / uvScale;
      const b0 = yFn0(x1, z1);
      const b1 = yFn1(x1, z1);
      orientedQuad(
        g,
        [
          [x0, a0, z0],
          [x1, b0, z1],
          [x1, b1, z1],
          [x0, a1, z0],
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
      a0 = b0;
      a1 = b1;
    }
    acc += l;
  }
}

/** Cortes (distancias desde el comienzo) de un borde de largo l: bisección donde la cuerda de `yFn` se aparta más de `tol`. */
function wallBreaks(ax, az, tx, tz, l, yFn, step, tol, maxStep) {
  const ts = [0];
  const rec = (t0, h0, t1, h1, depth) => {
    const len = t1 - t0;
    if (len > step && depth < 14) {
      const x0 = ax + tx * t0;
      const z0 = az + tz * t0;
      const x1 = ax + tx * t1;
      const z1 = az + tz * t1;
      if (len > maxStep || chordError(yFn, x0, z0, h0, x1, z1, h1) > tol) {
        const tm = (t0 + t1) / 2;
        const hm = yFn(ax + tx * tm, az + tz * tm);
        rec(t0, h0, tm, hm, depth + 1);
        rec(tm, hm, t1, h1, depth + 1);
        return;
      }
    }
    ts.push(t1);
  };
  rec(0, yFn(ax, az), l, yFn(ax + tx * l, az + tz * l), 0);
  return ts;
}
