// Acumulador de geometría para fusionar miles de caras en pocas llamadas de dibujo.
//
// Guarda los vértices en arreglos tipados por bloques (no en arreglos de JS
// con push y propagación de argumentos): el primer bloque crece al doble hasta
// BLOCK vértices (casi todas las mallas chicas caben ahí) y de ahí en adelante
// se agregan bloques fijos, sin recopiar lo ya escrito. Son las mismas cuentas
// en el mismo orden, así la malla sale idéntica bit a bit a la de antes.

import * as THREE from 'three';

const WHITE = [1, 1, 1];
const B_SHIFT = 14;
const BLOCK = 1 << B_SHIFT; // vértices por bloque
const B_MASK = BLOCK - 1;
const I_SHIFT = 16;
const I_BLOCK = 1 << I_SHIFT; // índices por bloque
const I_MASK = I_BLOCK - 1;

/** Copia de `a` (o vacío) en un arreglo nuevo del tipo `T` con `len` elementos. */
function resized(T, a, len) {
  const b = new T(len);
  if (a) b.set(a);
  return b;
}

/** Une los bloques en un solo arreglo de `len` elementos. */
function concat(T, blocks, len) {
  const out = new T(len);
  let off = 0;
  for (const b of blocks) {
    const m = Math.min(b.length, len - off);
    if (m <= 0) break;
    out.set(m === b.length ? b : b.subarray(0, m), off);
    off += m;
  }
  return out;
}

/** Lista de índices por bloques de Uint32, con `push` y `length` como un Array. */
class IndexList {
  constructor() {
    this.b = [];
    this.cap = 0;
    this.length = 0;
  }

  _grow() {
    if (this.cap < I_BLOCK) {
      this.cap = Math.min(I_BLOCK, Math.max(96, this.cap * 2));
      this.b[0] = resized(Uint32Array, this.b[0], this.cap);
    } else {
      this.b.push(new Uint32Array(I_BLOCK));
      this.cap += I_BLOCK;
    }
  }

  push() {
    const n = arguments.length;
    let k = this.length;
    for (let i = 0; i < n; i++, k++) {
      if (k >= this.cap) this._grow();
      this.b[k >>> I_SHIFT][k & I_MASK] = arguments[i];
    }
    this.length = k;
    return k;
  }

  /** Índices en el formato que daría THREE.BufferGeometry.setIndex(array): Uint16 si caben, si no Uint32. */
  toTyped() {
    const all = concat(Uint32Array, this.b, this.length);
    // 65535 queda reservado (reinicio de primitiva), como en three.
    for (let i = all.length - 1; i >= 0; i--) if (all[i] >= 65535) return all;
    return new Uint16Array(all);
  }
}

export class GeoBuilder {
  constructor() {
    this.n = 0;
    this.cap = 0; // vértices que caben sin crecer
    this._P = []; // bloques de posición, normal, uv y color
    this._N = [];
    this._U = [];
    this._C = [];
    this.idx = new IndexList();
  }

  get vertexCount() {
    return this.n;
  }

  _grow() {
    if (this.cap < BLOCK) {
      const c = (this.cap = Math.min(BLOCK, Math.max(64, this.cap * 2)));
      this._P[0] = resized(Float32Array, this._P[0], c * 3);
      this._N[0] = resized(Float32Array, this._N[0], c * 3);
      this._U[0] = resized(Float32Array, this._U[0], c * 2);
      this._C[0] = resized(Float32Array, this._C[0], c * 3);
    } else {
      this._P.push(new Float32Array(BLOCK * 3));
      this._N.push(new Float32Array(BLOCK * 3));
      this._U.push(new Float32Array(BLOCK * 2));
      this._C.push(new Float32Array(BLOCK * 3));
      this.cap += BLOCK;
    }
  }

  /** Reserva `k` vértices más y devuelve el índice del primero. */
  _reserve(k) {
    const i = this.n;
    const need = i + k;
    while (need > this.cap) this._grow();
    this.n = need;
    return i;
  }

  /** Escribe el vértice i (ya reservado). */
  _set(i, x, y, z, nx, ny, nz, u, v, c) {
    const b = i >>> B_SHIFT;
    const j = i & B_MASK;
    const o = j * 3;
    const P = this._P[b];
    const N = this._N[b];
    const C = this._C[b];
    const U = this._U[b];
    P[o] = x;
    P[o + 1] = y;
    P[o + 2] = z;
    N[o] = nx;
    N[o + 1] = ny;
    N[o + 2] = nz;
    U[j * 2] = u;
    U[j * 2 + 1] = v;
    C[o] = c[0];
    C[o + 1] = c[1];
    C[o + 2] = c[2];
  }

  vertex(x, y, z, nx, ny, nz, u, v, c = WHITE) {
    const i = this._reserve(1);
    this._set(i, x, y, z, nx, ny, nz, u, v, c);
    return i;
  }

  /** Cuadrilátero a,b,c,d (antihorario visto desde fuera). */
  quad(a, b, c, d, n, uvs, color = WHITE) {
    const i0 = this._reserve(4);
    const nx = n[0];
    const ny = n[1];
    const nz = n[2];
    this._set(i0, a[0], a[1], a[2], nx, ny, nz, uvs[0][0], uvs[0][1], color);
    this._set(i0 + 1, b[0], b[1], b[2], nx, ny, nz, uvs[1][0], uvs[1][1], color);
    this._set(i0 + 2, c[0], c[1], c[2], nx, ny, nz, uvs[2][0], uvs[2][1], color);
    this._set(i0 + 3, d[0], d[1], d[2], nx, ny, nz, uvs[3][0], uvs[3][1], color);
    this.idx.push(i0, i0 + 1, i0 + 2, i0, i0 + 2, i0 + 3);
  }

  tri(a, b, c, n, uvs, color = WHITE) {
    const i0 = this._reserve(3);
    const nx = n[0];
    const ny = n[1];
    const nz = n[2];
    this._set(i0, a[0], a[1], a[2], nx, ny, nz, uvs[0][0], uvs[0][1], color);
    this._set(i0 + 1, b[0], b[1], b[2], nx, ny, nz, uvs[1][0], uvs[1][1], color);
    this._set(i0 + 2, c[0], c[1], c[2], nx, ny, nz, uvs[2][0], uvs[2][1], color);
    this.idx.push(i0, i0 + 1, i0 + 2);
  }

  /**
   * Pared vertical con normal horizontal (nx,nz), desde el punto inferior
   * izquierdo (visto desde fuera) con ancho w y alturas y0..y1.
   * UV en metros divididos por `uvScale`.
   */
  wall(x0, z0, nx, nz, w, y0, y1, uvScale, color, uOffset = 0, vBase = y0) {
    const rx = nz;
    const rz = -nx;
    const x1 = x0 + rx * w;
    const z1 = z0 + rz * w;
    const u0 = uOffset;
    const u1 = uOffset + w / uvScale;
    const v0 = (y0 - vBase) / uvScale;
    const v1 = (y1 - vBase) / uvScale;
    this.quad(
      [x0, y0, z0],
      [x1, y0, z1],
      [x1, y1, z1],
      [x0, y1, z0],
      [nx, 0, nz],
      [
        [u0, v0],
        [u1, v0],
        [u1, v1],
        [u0, v1],
      ],
      color,
    );
  }

  /** Caja alineada con los ejes (6 caras) con UV en metros / uvScale. */
  box(minX, minY, minZ, maxX, maxY, maxZ, uvScale = 1, color, skipBottom = true) {
    const w = maxX - minX;
    const d = maxZ - minZ;
    this.wall(maxX, minZ, 0, -1, w, minY, maxY, uvScale, color); // norte (-Z)
    this.wall(minX, maxZ, 0, 1, w, minY, maxY, uvScale, color); // sur (+Z)
    this.wall(minX, minZ, -1, 0, d, minY, maxY, uvScale, color); // oeste
    this.wall(maxX, maxZ, 1, 0, d, minY, maxY, uvScale, color); // este
    this.quad(
      [minX, maxY, maxZ],
      [maxX, maxY, maxZ],
      [maxX, maxY, minZ],
      [minX, maxY, minZ],
      [0, 1, 0],
      [
        [minX / uvScale, maxZ / uvScale],
        [maxX / uvScale, maxZ / uvScale],
        [maxX / uvScale, minZ / uvScale],
        [minX / uvScale, minZ / uvScale],
      ],
      color,
    );
    if (!skipBottom) {
      this.quad(
        [minX, minY, minZ],
        [maxX, minY, minZ],
        [maxX, minY, maxZ],
        [minX, minY, maxZ],
        [0, -1, 0],
        [
          [0, 0],
          [1, 0],
          [1, 1],
          [0, 1],
        ],
        color,
      );
    }
  }

  /**
   * Rejilla que sigue una función de altura: rectángulo [x0,x1]x[z0,z1]
   * con celdas de ~`step` metros y UV en metros / uvScale. `colorFn(x, z)`
   * (opcional) da el color de cada vértice, en el orden de la rejilla.
   */
  heightGrid(x0, z0, x1, z1, step, heightFn, uvScale, color, uvFn = null, colorFn = null) {
    const nx = Math.max(1, Math.ceil((x1 - x0) / step));
    const nz = Math.max(1, Math.ceil((z1 - z0) / step));
    const base = this.vertexCount;
    for (let j = 0; j <= nz; j++) {
      for (let i = 0; i <= nx; i++) {
        const x = x0 + ((x1 - x0) * i) / nx;
        const z = z0 + ((z1 - z0) * j) / nz;
        const y = heightFn(x, z);
        // Normal por diferencias finitas.
        const e = 0.5;
        const dx = heightFn(x + e, z) - heightFn(x - e, z);
        const dz = heightFn(x, z + e) - heightFn(x, z - e);
        const l = Math.hypot(dx, 2 * e, dz);
        const uv = uvFn ? uvFn(x, z) : [x / uvScale, -z / uvScale];
        this.vertex(x, y, z, -dx / l, (2 * e) / l, -dz / l, uv[0], uv[1], colorFn ? colorFn(x, z) : color);
      }
    }
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        const a = base + j * (nx + 1) + i;
        const b = a + 1;
        const c = a + (nx + 1);
        const d = c + 1;
        this.idx.push(a, c, b, b, c, d);
      }
    }
  }

  build() {
    const g = new THREE.BufferGeometry();
    const n = this.n;
    g.setAttribute('position', new THREE.BufferAttribute(concat(Float32Array, this._P, n * 3), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(concat(Float32Array, this._N, n * 3), 3));
    g.setAttribute('uv', new THREE.BufferAttribute(concat(Float32Array, this._U, n * 2), 2));
    g.setAttribute('color', new THREE.BufferAttribute(concat(Float32Array, this._C, n * 3), 3));
    g.setIndex(new THREE.BufferAttribute(this.idx.toTyped(), 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }

  /** Suelta los bloques de trabajo (después de build, si el acumulador ya no se usa). */
  release() {
    this.n = this.cap = 0;
    this._P = [];
    this._N = [];
    this._U = [];
    this._C = [];
    this.idx = new IndexList();
  }
}
