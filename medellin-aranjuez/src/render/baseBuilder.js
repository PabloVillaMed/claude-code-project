// Bases de las edificaciones en la loma: lo que queda a la vista entre el
// terreno y el primer piso (sim/buildingBases.js pone el piso al nivel del
// andén de las entradas). Antes era la misma textura de la fachada corrida
// hacia abajo (salían puertas y ventanas de otro edificio como base); ahora
// cada cara lleva su propio remate al suelo, como en Medellín:
//  - zócalo bajo (hasta ZOCALO.BAND_MAX): franja pintada más oscura, enchape
//    de piedra laja o ladrillo; en el frente de las casas con zócalo de gres
//    o granito sigue el mismo enchape hasta el andén;
//  - base alta: muro de contención de concreto con remate, humedad que sube
//    del suelo, manchas bajo los tubos de drenaje y los tubos (PVC).
// UV en metros del mundo (la textura no se estira) y todo fusionado en las
// zonas de facadeBuilder.js (sin mallas nuevas por casa ni luces).
//
// También el hueco bajo el cuarto de cada local (roomCuts): el patio no se
// dibuja ahí y el terreno se baja, así el piso del local queda al nivel del
// andén aunque la loma suba detrás (como la excavación de verdad).

import { terrainHeight } from '../sim/terrain.js';
import { ZOCALO_COLORS, faceFrame, facadeLayout } from '../sim/facades.js';
import { BASES, accessRoomRect, shopRoomRect, walkLevel } from '../sim/buildingBases.js';
import { PLANES } from '../sim/interiors.js';

// ------------------------------------------------------------ ajustes
export const ZOCALO = {
  /** Hasta esta altura a la vista (m) la base es zócalo; más alta, muro de contención de concreto. */
  BAND_MAX: 1.2,
  /** Separación máxima (m) entre columnas de la base a lo largo de cada cara (siguen el terreno). */
  SAMPLE: 2.0,
  /** El pie de la base baja este tanto (m) bajo el terreno (no queda rendija). */
  SINK: 0.3,
  /** Caras cuyo terreno no llega a menos de esto (m) del piso no llevan base (negativo: toda cara que el terreno casi toca la lleva, bajo tierra, y tapa las rendijas del patio). */
  MIN_SHOW: -0.25,
  /** Reparto de los zócalos bajos (casas sin enchape en la fachada): franja pintada, piedra laja, ladrillo. */
  KINDS: [
    ['pintado', 0.45],
    ['piedra', 0.3],
    ['ladrillo', 0.25],
  ],
  /** Colores de la franja pintada (oscuros, como los zócalos de las casas del barrio). */
  PAINT: [
    [0.3, 0.3, 0.31],
    [0.42, 0.17, 0.13],
    [0.16, 0.27, 0.2],
    [0.2, 0.25, 0.4],
    [0.36, 0.3, 0.24],
  ],
  /** Muro de contención: un tubo de drenaje cada tanto (m)... */
  PIPE_EVERY: 2.8,
  /** ...donde el muro tenga al menos esta altura a la vista (m)... */
  PIPE_MIN: 0.95,
  /** ...a esta altura (m) sobre el terreno. */
  PIPE_UP: 0.38,
  /** Cuánto sale el tubo del muro (m) y su lado (m). */
  PIPE_OUT: 0.11,
  PIPE_SIZE: 0.09,
  /** Remate de concreto en lo alto del muro: alto y vuelo (m). */
  CAP_H: 0.12,
  CAP_OUT: 0.05,
  /** Color del concreto arriba, de la humedad abajo y de la mancha bajo los tubos. */
  CONCRETE_TOP: [0.9, 0.89, 0.86],
  CONCRETE_WET: [0.52, 0.55, 0.47],
  STREAK: [0.42, 0.42, 0.38],
};

const PVC = [0.86, 0.86, 0.83];
const HOLE = [0.06, 0.06, 0.06];
const UP = [0, 1, 0];

/** Número pseudoaleatorio estable por edificio (no gasta generadores). */
function hash01(i, salt) {
  let h = Math.imul(i + 1, 0x9e3779b1) ^ Math.imul(salt + 7, 0x85ebca6b);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  return (h >>> 0) / 4294967296;
}

/** Zócalo bajo del edificio: tipo, material y color (estable por índice). */
function bandOf(b, L, idx) {
  let r = hash01(idx, 1);
  let kind = 'pintado';
  for (const [k, w] of ZOCALO.KINDS) {
    if (r < w) {
      kind = k;
      break;
    }
    r -= w;
  }
  const tone = 0.9 + 0.12 * hash01(idx, 2);
  if (kind === 'piedra') return { key: 'piedra', color: [tone, tone, tone * 0.97] };
  if (kind === 'ladrillo') return { key: `brick${Math.floor(hash01(idx, 3) * 3)}`, color: [tone, tone * 0.97, tone * 0.94] };
  // Franja pintada: el color de la casa bien oscurecido o uno de la paleta.
  const c = hash01(idx, 4) < 0.4 && b.color ? b.color.map((v) => v * 0.45) : ZOCALO.PAINT[Math.floor(hash01(idx, 5) * ZOCALO.PAINT.length)];
  return { key: L?.wall === 'brick' ? 'paintedBrick' : 'plaster0', color: c };
}

/** El mismo enchape del zócalo de la fachada modelada (gres, granito o franja pintada). */
function facadeBand(L) {
  const z = L?.zocalo;
  if (!z) return null;
  if (z.kind === 'gres') return { key: 'gres', color: [1, 1, 1] };
  if (z.kind === 'granito') return { key: 'granito', color: [1, 1, 1] };
  return { key: L.wall === 'brick' ? 'paintedBrick' : 'plaster0', color: ZOCALO_COLORS[z.color] };
}

/**
 * Agrega la base visible del edificio `b` (índice `idx`, distribución `L` o
 * null). `G(key)` da el GeoBuilder de la zona para ese material.
 */
export function addBuildingBase(G, b, L, idx) {
  const gy = b.groundY;
  const band = bandOf(b, L, idx);
  const front = facadeBand(L);
  const sides = ['S', 'N', 'W', 'E'];
  for (let s = 0; s < 4; s++) {
    const side = sides[s];
    const f = faceFrame(b, side);
    const n = Math.max(1, Math.ceil(f.len / ZOCALO.SAMPLE));
    // Terreno al pie de la cara (andén, patio o calzada).
    const us = [];
    const gs = [];
    let eMax = -Infinity;
    for (let k = 0; k <= n; k++) {
      const u = (f.len * k) / n;
      const y = walkLevel(f.x0 + f.rx * u + f.nx * 0.12, f.z0 + f.rz * u + f.nz * 0.12);
      us.push(u);
      gs.push(y);
      eMax = Math.max(eMax, gy - y);
    }
    if (eMax < ZOCALO.MIN_SHOW) continue;
    const uOff = hash01(idx, 10 + s) * 7;
    // Las casas del fondo de la manzana (no dan a la calle) no llevan tubos: no se ven.
    if (eMax > ZOCALO.BAND_MAX) retainingWall(G, f, gy, us, gs, uOff, !b.interior);
    else {
      const bd = side === (b.front ?? 'S') && front ? front : band;
      plainBand(G(bd.key), f, gy, us, gs, uOff, bd.color);
    }
  }
}

/** Zócalo bajo: una franja de columnas que bajan hasta el terreno. */
function plainBand(g, f, gy, us, gs, uOff, color) {
  const N = [f.nx, 0, f.nz];
  // El pie un poco más oscuro (salpicadura del agua lluvia).
  const foot = [color[0] * 0.8, color[1] * 0.8, color[2] * 0.78];
  let prev = -1;
  for (let k = 0; k < us.length; k++) {
    const u = us[k];
    const x = f.x0 + f.rx * u;
    const z = f.z0 + f.rz * u;
    const y0 = Math.min(gy, gs[k] - ZOCALO.SINK);
    const i0 = g.vertex(x, gy, z, N[0], 0, N[2], uOff + u, 0, color);
    g.vertex(x, y0, z, N[0], 0, N[2], uOff + u, gy - y0, foot);
    if (prev >= 0) g.idx.push(prev, prev + 1, i0 + 1, prev, i0 + 1, i0);
    prev = i0;
  }
}

/**
 * Muro de contención: concreto con remate arriba, humedad que sube del
 * suelo y tubos de drenaje con su mancha escurrida debajo.
 */
function retainingWall(G, f, gy, us, gs, uOff, withPipes = true) {
  const Z = ZOCALO;
  const g = G('muro');
  const N = [f.nx, 0, f.nz];
  const ground = (u) => {
    // Interpolación del terreno medido (las columnas ya lo siguen).
    const k = Math.min(us.length - 2, Math.max(0, Math.floor((u / f.len) * (us.length - 1))));
    const t = (u - us[k]) / (us[k + 1] - us[k] || 1);
    return gs[k] + (gs[k + 1] - gs[k]) * Math.max(0, Math.min(1, t));
  };
  // Tubos: cada PIPE_EVERY donde el muro es alto.
  const pipes = [];
  const np = withPipes ? Math.floor(f.len / Z.PIPE_EVERY) : 0;
  for (let k = 0; k < np; k++) {
    const u = (f.len * (k + 0.5)) / np;
    const y = ground(u) + Z.PIPE_UP;
    if (gy - ground(u) >= Z.PIPE_MIN && y + Z.PIPE_SIZE < gy - Z.CAP_H - 0.05) pipes.push({ u, y });
  }
  // Columnas: las del terreno más tres por tubo (la mancha escurre por la del medio).
  const cols = us.map((u) => ({ u, streak: false }));
  for (const p of pipes) for (const [du, st] of [[-0.1, false], [0, true], [0.1, false]]) cols.push({ u: p.u + du, streak: st, pipe: p });
  cols.sort((a, c) => a.u - c.u);
  let prev = -1;
  for (const c of cols) {
    const u = c.u;
    const x = f.x0 + f.rx * u;
    const z = f.z0 + f.rz * u;
    const yg = ground(u);
    const y0 = Math.min(gy, yg - Z.SINK);
    // Fila del medio a la altura de los tubos (o de la humedad).
    const ym = Math.max(y0, Math.min(gy - 0.05, yg + Z.PIPE_UP));
    const top = Z.CONCRETE_TOP;
    const mid = c.streak ? Z.STREAK : lerp3(top, Z.CONCRETE_WET, 0.35);
    const bot = c.streak ? Z.STREAK : Z.CONCRETE_WET;
    const i0 = g.vertex(x, gy, z, N[0], 0, N[2], uOff + u, 0, top);
    g.vertex(x, ym, z, N[0], 0, N[2], uOff + u, gy - ym, mid);
    g.vertex(x, y0, z, N[0], 0, N[2], uOff + u, gy - y0, bot);
    if (prev >= 0) g.idx.push(prev, prev + 1, i0 + 1, prev, i0 + 1, i0, prev + 1, prev + 2, i0 + 2, prev + 1, i0 + 2, i0 + 1);
    prev = i0;
  }
  // Remate: una viga delgada que sobresale un poco del muro.
  const cap = G('trim');
  const P = (u, y, off) => [f.x0 + f.rx * u + f.nx * off, y, f.z0 + f.rz * u + f.nz * off];
  const yb = gy - Z.CAP_H;
  const o = Z.CAP_OUT;
  const capC = [0.8, 0.79, 0.76];
  cap.quad(P(0, yb, o), P(f.len, yb, o), P(f.len, gy, o), P(0, gy, o), N, [[uOff, 0], [uOff + f.len, 0], [uOff + f.len, Z.CAP_H], [uOff, Z.CAP_H]], capC);
  cap.quad(P(0, yb, 0), P(f.len, yb, 0), P(f.len, yb, o), P(0, yb, o), [0, -1, 0], [[0, 0], [f.len, 0], [f.len, o], [0, o]], capC);
  // Tubos de drenaje: cajita de PVC con la boca oscura (detalle de cerca;
  // sin la cara de abajo: el tubo queda bajo los ojos de quien lo mira).
  const d = G('detail');
  const h = Z.PIPE_SIZE / 2;
  const R = [f.rx, 0, f.rz];
  const Lx = [-f.rx, 0, -f.rz];
  for (const p of pipes) {
    const a = p.u - h;
    const b2 = p.u + h;
    const y0 = p.y - h;
    const y1 = p.y + h;
    const out = Z.PIPE_OUT;
    const uv = [[0, 0], [1, 0], [1, 1], [0, 1]];
    d.quad(P(a, y1, out), P(b2, y1, out), P(b2, y1, 0), P(a, y1, 0), UP, uv, PVC);
    d.quad(P(b2, y0, 0), P(b2, y1, 0), P(b2, y1, out), P(b2, y0, out), R, uv, PVC);
    d.quad(P(a, y0, out), P(a, y1, out), P(a, y1, 0), P(a, y0, 0), Lx, uv, PVC);
    d.quad(P(a, y0, out), P(b2, y0, out), P(b2, y1, out), P(a, y1, out), N, uv, HOLE);
  }
}

function lerp3(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/**
 * Huecos bajo los cuartos de los locales (sim: b.cutRoom = índice del lote).
 * holes: clave `${manzana}:${lote}` → lista de rectángulos que no se dibujan
 * del patio; clamp(x, z, h): altura del terreno con la excavación (la
 * rejilla del terreno es de `step` m: se bajan los vértices cercanos).
 */
export function roomCuts(city, step = 4) {
  const holes = new Map();
  const rooms = [];
  const CELL = 8;
  const grid = new Map();
  const key = (i, j) => i * 65536 + j;
  const reach = step + 0.2;
  for (let i = 0; i < city.buildings.length; i++) {
    const b = city.buildings[i];
    if (b.cutRoom === undefined) continue;
    const L = facadeLayout(b, i);
    if (!L?.shop) continue;
    const f = faceFrame(b, b.front ?? 'S');
    // Local al que se entra (sim/interiors.js): toda la huella, hasta el piso del salón (o del sótano).
    const acc = !!L.shop.access;
    const rect = acc ? accessRoomRect(b, f) : shopRoomRect(f, L.shop, L.shop.depth);
    const k = `${b.block}:${b.cutRoom}`;
    if (!holes.has(k)) holes.set(k, []);
    holes.get(k).push(rect);
    // Para bajar el terreno: el rectángulo en coordenadas de la fachada, agrandado.
    const drop = acc ? (PLANES[b.local.id]?.sotano ?? 0) : 0;
    const room = acc ? { f, u0: -reach, u1: f.len + reach, d0: -reach, d1: 2 * b.frame.hv + reach, y: b.groundY - drop - 0.3 } : { f, u0: L.shop.u0 - reach, u1: L.shop.u1 + reach, d0: -reach, d1: L.shop.depth + reach, y: b.groundY - 0.3 };
    rooms.push(room);
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const [u, d] of [[room.u0, room.d0], [room.u1, room.d0], [room.u1, room.d1], [room.u0, room.d1]]) {
      const x = f.x0 + f.rx * u - f.nx * d;
      const z = f.z0 + f.rz * u - f.nz * d;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minZ = Math.min(minZ, z);
      maxZ = Math.max(maxZ, z);
    }
    for (let ci = Math.floor(minX / CELL); ci <= Math.floor(maxX / CELL); ci++)
      for (let cj = Math.floor(minZ / CELL); cj <= Math.floor(maxZ / CELL); cj++) {
        const kk = key(ci, cj);
        if (!grid.has(kk)) grid.set(kk, []);
        grid.get(kk).push(room);
      }
  }
  return {
    holes,
    count: rooms.length,
    /** Altura del terreno en (x, z) con los cuartos excavados. */
    clamp(x, z, h = terrainHeight(x, z)) {
      const list = grid.get(key(Math.floor(x / CELL), Math.floor(z / CELL)));
      if (!list) return h;
      for (const r of list) {
        const dx = x - r.f.x0;
        const dz = z - r.f.z0;
        const u = dx * r.f.rx + dz * r.f.rz;
        const d = -(dx * r.f.nx + dz * r.f.nz);
        if (u >= r.u0 && u <= r.u1 && d >= r.d0 && d <= r.d1 && h > r.y) h = r.y;
      }
      return h;
    },
  };
}

export { BASES };
