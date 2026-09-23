// Colisiones puras: cajas estáticas (edificios, muros) en una rejilla espacial,
// círculos (personajes), cajas orientadas (vehículos) y rayos (balas, cámara).

export class CollisionWorld {
  constructor(cellSize = 24) {
    this.cellSize = cellSize;
    this.cells = new Map();
    this.boxes = [];
  }

  _key(ix, iz) {
    return ix * 73856093 + iz * 19349663;
  }

  /** box: {minX,maxX,minZ,maxZ,minY,maxY,kind?} */
  add(box) {
    if (box.minY === undefined) box.minY = -1000;
    if (box.maxY === undefined) box.maxY = 1000;
    box.id = this.boxes.length;
    this.boxes.push(box);
    const cs = this.cellSize;
    for (let ix = Math.floor(box.minX / cs); ix <= Math.floor(box.maxX / cs); ix++) {
      for (let iz = Math.floor(box.minZ / cs); iz <= Math.floor(box.maxZ / cs); iz++) {
        const k = this._key(ix, iz);
        let cell = this.cells.get(k);
        if (!cell) this.cells.set(k, (cell = []));
        cell.push(box);
      }
    }
    return box;
  }

  /** Cajas cuyo rectángulo XZ toca el rectángulo dado. */
  query(minX, minZ, maxX, maxZ, out = []) {
    out.length = 0;
    const cs = this.cellSize;
    const seen = new Set();
    for (let ix = Math.floor(minX / cs); ix <= Math.floor(maxX / cs); ix++) {
      for (let iz = Math.floor(minZ / cs); iz <= Math.floor(maxZ / cs); iz++) {
        const cell = this.cells.get(this._key(ix, iz));
        if (!cell) continue;
        for (const b of cell) {
          if (seen.has(b.id)) continue;
          seen.add(b.id);
          if (b.maxX >= minX && b.minX <= maxX && b.maxZ >= minZ && b.minZ <= maxZ) out.push(b);
        }
      }
    }
    return out;
  }

  /** ¿Un punto (a una altura y) está dentro de algún volumen? */
  pointBlocked(x, z, y = null) {
    for (const b of this.query(x, z, x, z)) {
      if (x > b.minX && x < b.maxX && z > b.minZ && z < b.maxZ) {
        if (y === null || (y >= b.minY && y <= b.maxY)) return true;
      }
    }
    return false;
  }

  /**
   * Empuja un círculo fuera de las cajas. `feetY`/`headY` permiten saltar sobre
   * obstáculos bajos. Devuelve {x, z, hit, nx, nz}.
   */
  resolveCircle(x, z, r, feetY = null, headY = null) {
    let hit = false;
    let nxAcc = 0;
    let nzAcc = 0;
    const tmp = [];
    for (let iter = 0; iter < 4; iter++) {
      let moved = false;
      for (const b of this.query(x - r, z - r, x + r, z + r, tmp)) {
        if (feetY !== null && (feetY >= b.maxY - 0.01 || headY <= b.minY)) continue;
        const res = circleVsAABB(x, z, r, b);
        if (res) {
          x += res.nx * res.depth;
          z += res.nz * res.depth;
          nxAcc += res.nx;
          nzAcc += res.nz;
          hit = moved = true;
        }
      }
      if (!moved) break;
    }
    const nl = Math.hypot(nxAcc, nzAcc) || 1;
    return { x, z, hit, nx: nxAcc / nl, nz: nzAcc / nl };
  }

  /**
   * Rayo 3D contra las cajas. Devuelve {t, box, nx, ny, nz} del impacto más
   * cercano o null. `dir` debe estar normalizado.
   */
  raycast(ox, oy, oz, dx, dy, dz, maxDist) {
    // Recorremos celdas a lo largo del rayo (DDA simple por muestreo).
    const cs = this.cellSize;
    const steps = Math.ceil(maxDist / (cs * 0.5)) + 1;
    const checked = new Set();
    let best = null;
    for (let s = 0; s <= steps; s++) {
      const t = Math.min(maxDist, s * cs * 0.5);
      if (best && t - cs > best.t) break;
      const px = ox + dx * t;
      const pz = oz + dz * t;
      const ix0 = Math.floor(px / cs);
      const iz0 = Math.floor(pz / cs);
      for (let ix = ix0 - 1; ix <= ix0 + 1; ix++) {
        for (let iz = iz0 - 1; iz <= iz0 + 1; iz++) {
          const cell = this.cells.get(this._key(ix, iz));
          if (!cell) continue;
          for (const b of cell) {
            if (checked.has(b.id)) continue;
            checked.add(b.id);
            const hit = rayVsAABB(ox, oy, oz, dx, dy, dz, b, maxDist);
            if (hit && (!best || hit.t < best.t)) best = { ...hit, box: b };
          }
        }
      }
    }
    return best;
  }
}

/** Círculo contra caja alineada; devuelve {depth,nx,nz} o null. */
export function circleVsAABB(x, z, r, b) {
  const cx = Math.max(b.minX, Math.min(x, b.maxX));
  const cz = Math.max(b.minZ, Math.min(z, b.maxZ));
  let dx = x - cx;
  let dz = z - cz;
  const d2 = dx * dx + dz * dz;
  if (d2 > r * r) return null;
  if (d2 > 1e-10) {
    const d = Math.sqrt(d2);
    return { depth: r - d, nx: dx / d, nz: dz / d };
  }
  // Centro dentro de la caja: salimos por la cara más cercana.
  const left = x - b.minX;
  const right = b.maxX - x;
  const top = z - b.minZ;
  const bottom = b.maxZ - z;
  const m = Math.min(left, right, top, bottom);
  if (m === left) return { depth: left + r, nx: -1, nz: 0 };
  if (m === right) return { depth: right + r, nx: 1, nz: 0 };
  if (m === top) return { depth: top + r, nx: 0, nz: -1 };
  return { depth: bottom + r, nx: 0, nz: 1 };
}

/** Rayo contra AABB 3D (método de slabs). */
export function rayVsAABB(ox, oy, oz, dx, dy, dz, b, maxDist) {
  let tmin = 0;
  let tmax = maxDist;
  let nAxis = -1;
  let nSign = 0;
  const o = [ox, oy, oz];
  const d = [dx, dy, dz];
  const mn = [b.minX, b.minY, b.minZ];
  const mx = [b.maxX, b.maxY, b.maxZ];
  for (let a = 0; a < 3; a++) {
    if (Math.abs(d[a]) < 1e-9) {
      if (o[a] < mn[a] || o[a] > mx[a]) return null;
      continue;
    }
    const inv = 1 / d[a];
    let t1 = (mn[a] - o[a]) * inv;
    let t2 = (mx[a] - o[a]) * inv;
    let sign = -1;
    if (t1 > t2) {
      const tt = t1;
      t1 = t2;
      t2 = tt;
      sign = 1;
    }
    if (t1 > tmin) {
      tmin = t1;
      nAxis = a;
      nSign = sign;
    }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }
  if (nAxis === -1) return { t: 0, nx: 0, ny: 0, nz: 0, inside: true };
  const n = [0, 0, 0];
  n[nAxis] = nSign;
  return { t: tmin, nx: n[0], ny: n[1], nz: n[2] };
}

/** Rayo contra esfera. */
export function rayVsSphere(ox, oy, oz, dx, dy, dz, cx, cy, cz, r, maxDist) {
  const lx = ox - cx;
  const ly = oy - cy;
  const lz = oz - cz;
  const b = lx * dx + ly * dy + lz * dz;
  const c = lx * lx + ly * ly + lz * lz - r * r;
  const disc = b * b - c;
  if (disc < 0) return null;
  const s = Math.sqrt(disc);
  let t = -b - s;
  if (t < 0) t = -b + s;
  if (t < 0 || t > maxDist) return null;
  return t;
}

/**
 * Rayo contra cápsula vertical (cuerpo de un personaje) entre y0 y y1.
 * Devuelve t o null.
 */
export function rayVsVerticalCapsule(ox, oy, oz, dx, dy, dz, cx, cz, y0, y1, r, maxDist) {
  // Cilindro infinito en XZ.
  const px = ox - cx;
  const pz = oz - cz;
  const a = dx * dx + dz * dz;
  let best = null;
  if (a > 1e-10) {
    const b = px * dx + pz * dz;
    const c = px * px + pz * pz - r * r;
    const disc = b * b - a * c;
    if (disc >= 0) {
      const s = Math.sqrt(disc);
      for (const t of [(-b - s) / a, (-b + s) / a]) {
        if (t < 0 || t > maxDist) continue;
        const y = oy + dy * t;
        if (y >= y0 && y <= y1) {
          best = t;
          break;
        }
      }
    }
  }
  for (const ey of [y0, y1]) {
    const t = rayVsSphere(ox, oy, oz, dx, dy, dz, cx, ey, cz, r, maxDist);
    if (t !== null && (best === null || t < best)) best = t;
  }
  return best;
}

/** Caja orientada 2D: {x, z, hx, hz, angle} (angle = yaw, hz a lo largo). */
function obbAxes(o) {
  const c = Math.cos(o.angle);
  const s = Math.sin(o.angle);
  // eje "derecha" y eje "adelante" (convención yaw).
  return [
    [c, -s],
    [-s, -c],
  ];
}

function obbCorners(o) {
  const [r, f] = obbAxes(o);
  const pts = [];
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      pts.push([o.x + r[0] * o.hx * sx + f[0] * o.hz * sz, o.z + r[1] * o.hx * sx + f[1] * o.hz * sz]);
    }
  }
  return pts;
}

function project(pts, ax) {
  let mn = Infinity;
  let mx = -Infinity;
  for (const p of pts) {
    const d = p[0] * ax[0] + p[1] * ax[1];
    if (d < mn) mn = d;
    if (d > mx) mx = d;
  }
  return [mn, mx];
}

/**
 * SAT entre dos cajas orientadas. Devuelve {depth, nx, nz} para sacar A de B,
 * o null si no se tocan.
 */
export function obbVsObb(a, b) {
  const pa = obbCorners(a);
  const pb = obbCorners(b);
  let best = null;
  for (const ax of [...obbAxes(a), ...obbAxes(b)]) {
    const [amin, amax] = project(pa, ax);
    const [bmin, bmax] = project(pb, ax);
    const overlap = Math.min(amax, bmax) - Math.max(amin, bmin);
    if (overlap <= 0) return null;
    if (!best || overlap < best.depth) {
      const ca = (amin + amax) / 2;
      const cb = (bmin + bmax) / 2;
      const sgn = ca < cb ? -1 : 1;
      best = { depth: overlap, nx: ax[0] * sgn, nz: ax[1] * sgn };
    }
  }
  return best;
}

export const aabbToObb = (b) => ({
  x: (b.minX + b.maxX) / 2,
  z: (b.minZ + b.maxZ) / 2,
  hx: (b.maxX - b.minX) / 2,
  hz: (b.maxZ - b.minZ) / 2,
  angle: 0,
});

/** Círculo contra caja orientada. */
export function circleVsObb(x, z, r, o) {
  const [ra, fa] = obbAxes(o);
  const dx = x - o.x;
  const dz = z - o.z;
  const lx = dx * ra[0] + dz * ra[1];
  const lz = dx * fa[0] + dz * fa[1];
  const res = circleVsAABB(lx, lz, r, { minX: -o.hx, maxX: o.hx, minZ: -o.hz, maxZ: o.hz });
  if (!res) return null;
  return {
    depth: res.depth,
    nx: ra[0] * res.nx + fa[0] * res.nz,
    nz: ra[1] * res.nx + fa[1] * res.nz,
  };
}

/** Rayo 3D contra caja orientada con altura (vehículo). */
export function rayVsObb3D(ox, oy, oz, dx, dy, dz, o, y0, y1, maxDist) {
  const [ra, fa] = obbAxes(o);
  const px = ox - o.x;
  const pz = oz - o.z;
  const lox = px * ra[0] + pz * ra[1];
  const loz = px * fa[0] + pz * fa[1];
  const ldx = dx * ra[0] + dz * ra[1];
  const ldz = dx * fa[0] + dz * fa[1];
  const hit = rayVsAABB(lox, oy, loz, ldx, dy, ldz, { minX: -o.hx, maxX: o.hx, minY: y0, maxY: y1, minZ: -o.hz, maxZ: o.hz }, maxDist);
  return hit ? hit.t : null;
}
