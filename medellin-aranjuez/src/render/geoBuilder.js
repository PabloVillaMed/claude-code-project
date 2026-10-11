// Acumulador de geometría para fusionar miles de caras en pocas llamadas de dibujo.

import * as THREE from 'three';

export class GeoBuilder {
  constructor() {
    this.pos = [];
    this.nrm = [];
    this.uv = [];
    this.col = [];
    this.idx = [];
  }

  get vertexCount() {
    return this.pos.length / 3;
  }

  vertex(x, y, z, nx, ny, nz, u, v, c = [1, 1, 1]) {
    this.pos.push(x, y, z);
    this.nrm.push(nx, ny, nz);
    this.uv.push(u, v);
    this.col.push(c[0], c[1], c[2]);
    return this.vertexCount - 1;
  }

  /** Cuadrilátero a,b,c,d (antihorario visto desde fuera). */
  quad(a, b, c, d, n, uvs, color) {
    const i0 = this.vertex(...a, ...n, ...uvs[0], color);
    const i1 = this.vertex(...b, ...n, ...uvs[1], color);
    const i2 = this.vertex(...c, ...n, ...uvs[2], color);
    const i3 = this.vertex(...d, ...n, ...uvs[3], color);
    this.idx.push(i0, i1, i2, i0, i2, i3);
  }

  tri(a, b, c, n, uvs, color) {
    const i0 = this.vertex(...a, ...n, ...uvs[0], color);
    const i1 = this.vertex(...b, ...n, ...uvs[1], color);
    const i2 = this.vertex(...c, ...n, ...uvs[2], color);
    this.idx.push(i0, i1, i2);
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
   * con celdas de ~`step` metros y UV en metros / uvScale.
   */
  heightGrid(x0, z0, x1, z1, step, heightFn, uvScale, color, uvFn = null) {
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
        this.vertex(x, y, z, -dx / l, (2 * e) / l, -dz / l, uv[0], uv[1], color);
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
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}
