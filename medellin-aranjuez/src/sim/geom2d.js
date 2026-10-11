// Geometría 2D (plano XZ) para el mapa real: polígonos (manzanas, zonas),
// polilíneas (vías, andenes, quebradas) y rectángulos orientados (casas).

/** Área con signo (con z hacia el sur, positiva = horario visto desde arriba). */
export function polyArea(poly) {
  let s = 0;
  for (let i = 0, n = poly.length; i < n; i++) {
    const [x1, z1] = poly[i];
    const [x2, z2] = poly[(i + 1) % n];
    s += x1 * z2 - x2 * z1;
  }
  return s / 2;
}

export function pointInPoly(x, z, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i];
    const [xj, zj] = poly[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/** Punto más cercano sobre el segmento ab: {x, z, t, d2}. */
export function closestOnSeg(x, z, ax, az, bx, bz) {
  const dx = bx - ax;
  const dz = bz - az;
  const l2 = dx * dx + dz * dz || 1e-12;
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2));
  const px = ax + dx * t;
  const pz = az + dz * t;
  return { x: px, z: pz, t, d2: (x - px) ** 2 + (z - pz) ** 2 };
}

/** Distancia de un punto al borde de un polígono cerrado. */
export function distToPolyEdge(x, z, poly) {
  let best = Infinity;
  for (let i = 0, n = poly.length; i < n; i++) {
    const [ax, az] = poly[i];
    const [bx, bz] = poly[(i + 1) % n];
    const c = closestOnSeg(x, z, ax, az, bx, bz);
    if (c.d2 < best) best = c.d2;
  }
  return Math.sqrt(best);
}

export function polyBounds(poly) {
  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;
  for (const [x, z] of poly) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  return { minX, minZ, maxX, maxZ };
}

export function polyCentroid(poly) {
  let cx = 0;
  let cz = 0;
  let a = 0;
  for (let i = 0, n = poly.length; i < n; i++) {
    const [x1, z1] = poly[i];
    const [x2, z2] = poly[(i + 1) % n];
    const f = x1 * z2 - x2 * z1;
    cx += (x1 + x2) * f;
    cz += (z1 + z2) * f;
    a += f;
  }
  if (Math.abs(a) < 1e-9) return [poly[0][0], poly[0][1]];
  return [cx / (3 * a), cz / (3 * a)];
}

export function polyPerimeter(poly) {
  let s = 0;
  for (let i = 0, n = poly.length; i < n; i++) {
    const [x1, z1] = poly[i];
    const [x2, z2] = poly[(i + 1) % n];
    s += Math.hypot(x2 - x1, z2 - z1);
  }
  return s;
}

// ------------------------------------------------------------------ polilíneas
/** Longitudes acumuladas de una polilínea. */
export function cumLengths(pts) {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  return cum;
}

/** Punto y dirección a la distancia s (m) a lo largo de la polilínea. */
export function pointAlong(pts, cum, s) {
  const L = cum[cum.length - 1];
  s = Math.max(0, Math.min(L, s));
  let i = 1;
  // Búsqueda binaria del tramo.
  let lo = 1;
  let hi = cum.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] < s) lo = mid + 1;
    else hi = mid;
  }
  i = lo;
  const seg = cum[i] - cum[i - 1] || 1e-9;
  const t = (s - cum[i - 1]) / seg;
  const [ax, az] = pts[i - 1];
  const [bx, bz] = pts[i];
  const dx = (bx - ax) / seg;
  const dz = (bz - az) / seg;
  return { x: ax + (bx - ax) * t, z: az + (bz - az) * t, dx, dz, i };
}

/** Proyección de un punto sobre la polilínea: {s, x, z, d, dx, dz}. */
export function projectOnPolyline(pts, cum, x, z) {
  let best = null;
  for (let i = 1; i < pts.length; i++) {
    const c = closestOnSeg(x, z, pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]);
    if (!best || c.d2 < best.d2) {
      const seg = cum[i] - cum[i - 1] || 1e-9;
      best = { d2: c.d2, s: cum[i - 1] + c.t * seg, x: c.x, z: c.z, dx: (pts[i][0] - pts[i - 1][0]) / seg, dz: (pts[i][1] - pts[i - 1][1]) / seg };
    }
  }
  best.d = Math.sqrt(best.d2);
  return best;
}

// ------------------------------------------------------------------ casas
/**
 * Rectángulo orientado de una casa: centro (x, z), normal hacia la calle
 * (nx, nz), medio frente `hu` (a lo largo de la calle) y medio fondo `hv`.
 * El eje "a lo largo" es u = (nz, -nx): mirando la fachada, u va de izquierda
 * a derecha (misma convención que las fachadas alineadas de antes).
 */
export function makeFrame(x, z, nx, nz, hu, hv) {
  const l = Math.hypot(nx, nz) || 1;
  nx /= l;
  nz /= l;
  return { x, z, nx, nz, ux: nz, uz: -nx, hu, hv };
}

/** Esquinas en orden: frente-izq, frente-der, fondo-der, fondo-izq (vistas desde la calle). */
export function frameCorners(f) {
  const { x, z, nx, nz, ux, uz, hu, hv } = f;
  return [
    [x - ux * hu + nx * hv, z - uz * hu + nz * hv],
    [x + ux * hu + nx * hv, z + uz * hu + nz * hv],
    [x + ux * hu - nx * hv, z + uz * hu - nz * hv],
    [x - ux * hu - nx * hv, z - uz * hu - nz * hv],
  ];
}

export function frameBounds(f) {
  return polyBounds(frameCorners(f));
}

/** ¿Se solapan dos rectángulos orientados (con holgura `gap`)? SAT 2D. */
export function framesOverlap(a, b, gap = 0) {
  const axes = [
    [a.ux, a.uz],
    [a.nx, a.nz],
    [b.ux, b.uz],
    [b.nx, b.nz],
  ];
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  for (const [px, pz] of axes) {
    const ra = Math.abs(a.ux * px + a.uz * pz) * a.hu + Math.abs(a.nx * px + a.nz * pz) * a.hv;
    const rb = Math.abs(b.ux * px + b.uz * pz) * b.hu + Math.abs(b.nx * px + b.nz * pz) * b.hv;
    if (Math.abs(dx * px + dz * pz) >= ra + rb + gap) return false;
  }
  return true;
}

/** Rectángulo orientado contra un segmento (engrosado `r`): ¿se tocan? */
export function frameHitsSegment(f, ax, az, bx, bz, r = 0) {
  // Muestreo sencillo del segmento (los segmentos del mapa son cortos).
  const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 1.5));
  for (let k = 0; k <= n; k++) {
    const x = ax + ((bx - ax) * k) / n - f.x;
    const z = az + ((bz - az) * k) / n - f.z;
    if (Math.abs(x * f.ux + z * f.uz) < f.hu + r && Math.abs(x * f.nx + z * f.nz) < f.hv + r) return true;
  }
  return false;
}
