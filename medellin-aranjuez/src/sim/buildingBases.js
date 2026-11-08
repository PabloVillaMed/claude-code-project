// Asiento de las edificaciones en las lomas. Cada casa, local y edificio
// queda con su entrada (puertas, vitrinas y cortinas de los locales) a la
// altura del andén que tiene al frente: la parte de atrás se mete en la
// ladera y el lado de abajo muestra un zócalo o un muro de contención
// (render/baseBuilder.js). Si la calle baja mucho a lo largo del frente, la
// fachada escalona en tramos (casas pegadas a distinto nivel, como en
// Aranjuez); si una entrada queda más alta que el andén (la otra puerta de la
// casa o el piso de un local sobre la loma), se le ponen escalas de concreto
// (utilería 'steps', que también se pueden subir: ver stepsWalkable).
//
// Puro y determinista: no gasta el generador aleatorio de la ciudad (las
// manzanas, los carros parqueados y el metro no cambian).

import { GRID, addWalkable, onRoad, terrainHeight } from './terrain.js';
import { facadeLayout, faceFrame } from './facades.js';
import { distToPolyEdge, frameBounds, makeFrame, pointInPoly } from './geom2d.js';
import { PLANES } from './interiors.js';

// ------------------------------------------------------------ ajustes
export const BASES = {
  /** El piso queda este tanto (m) sobre el andén frente a la entrada: umbral de la puerta (el andén no la tapa). */
  FLOOR_LIFT: 0.06,
  /** A qué distancia (m) de la fachada se mide la altura del andén frente a cada entrada. */
  ENTRY_PROBE: 0.6,
  /** Desnivel máximo (m) entre el andén y el piso sin poner escalas (un escalón alto). */
  STEP_MAX: 0.27,
  /** Contrahuella buscada de las escalas (m). */
  STEP_RISE: 0.18,
  /** Huella de cada escalón (m); se acorta si las escalas saldrían más de STEPS_MAX_OUT. */
  STEP_TREAD: 0.3,
  /** Lo más que salen las escalas sobre el andén (m; el andén mide 2,2 m). */
  STEPS_MAX_OUT: 0.95,
  /** Fondo (m) del cuarto de un local que se ve por la vitrina (render/facadeBuilder.js). */
  SHOP_ROOM_DEPTH: 3.2,
  /** Holgura (m) del hueco que se abre en el patio y el terreno bajo el cuarto del local (más grande que el cuarto). */
  ROOM_CUT_PAD: 0.06,
  /** Si el cuarto no cabe dentro del lote (no se puede abrir el hueco): fondos que se prueban, del más hondo al más corto; el cuarto se acorta antes que subir el piso. */
  SHOP_DEPTHS: [3.2, 2.6, 2.1, 1.7, 1.3],
  /** El piso del local queda este tanto (m) sobre el patio que tiene debajo (el terreno no se asoma adentro). */
  SHOP_MARGIN: 0.1,
  /** Lo mínimo (m) que la casa sobresale del terreno en su parte de atrás; si no, gana pisos. */
  ROOF_CLEAR: 1.4,
  /** Pisos que se le pueden agregar a una casa muy enterrada atrás. */
  MAX_EXTRA_FLOORS: 2,
  /** Si el andén baja más que esto (m) de un extremo al otro del frente, la fachada escalona en tramos. */
  SPLIT_DROP: 1.0,
  /** Desnivel buscado (m) por tramo de fachada escalonada. */
  SPLIT_PIECE_DROP: 0.7,
  /** Ancho mínimo (m) de cada tramo. */
  SPLIT_MIN_W: 3.4,
  /** Máximo de tramos por edificio. */
  SPLIT_MAX: 4,
  /** La base baja este tanto (m) bajo el punto más bajo del terreno de la huella. */
  BASE_SINK: 0.6,
};

/** Vanos del primer piso que son entradas (los que deben quedar al nivel del andén). */
const ENTRY_KINDS = new Set(['door', 'garage', 'shop']);
/** Estilos que pueden escalonar su fachada (casas, locales y edificios de apartamentos). */
const SPLIT_STYLES = new Set(['ladrillo', 'pintada', 'tienda', 'torre']);
const FLOOR_H = 3;

const curb = GRID.curb;
/** Altura de lo que se pisa en (x, z): andén o patio (terreno + sardinel), o la calzada. */
export function walkLevel(x, z) {
  return terrainHeight(x, z) + (onRoad(x, z) ? 0 : curb);
}

function at(f, u, off) {
  return [f.x0 + f.rx * u + f.nx * off, f.z0 + f.rz * u + f.nz * off];
}

/** Entradas del primer piso de la fachada principal ({kind, u0, u1} en metros a lo largo del frente). */
export function buildingEntries(b, L, f = faceFrame(b, b.front ?? 'S')) {
  if (L) return L.openings.filter((o) => o.floor === 0 && ENTRY_KINDS.has(o.kind)).map((o) => ({ kind: o.kind, u0: o.u0, u1: o.u1 }));
  // Cajas texturizadas (iglesias, colegios, casas del fondo): la puerta va en la mitad.
  const c = f.len / 2;
  return [{ kind: 'door', u0: c - 0.6, u1: c + 0.6 }];
}

/**
 * Andén frente al vano, de borde a borde (cada metro): `hi` el más alto (el
 * piso no queda por debajo: nada de entradas enterradas) y `lo` el más bajo
 * (de ahí arrancan las escalas: en un local ancho sobre la loma, el extremo
 * de abajo es el que queda alto).
 */
export function entryLevel(f, e) {
  const pad = Math.min(0.15, (e.u1 - e.u0) / 4);
  const n = Math.max(2, Math.ceil((e.u1 - e.u0 - 2 * pad) / 1));
  let hi = -Infinity;
  let lo = Infinity;
  for (let k = 0; k <= n; k++) {
    const [x, z] = at(f, e.u0 + pad + ((e.u1 - e.u0 - 2 * pad) * k) / n, BASES.ENTRY_PROBE);
    const y = walkLevel(x, z);
    hi = Math.max(hi, y);
    lo = Math.min(lo, y);
  }
  return { hi, lo };
}

/** Terreno más alto (con el sardinel) bajo la huella: 3 x 3 puntos. */
function footprintMax(fr) {
  let mx = -Infinity;
  for (const a of [-1, 0, 1]) for (const c of [-1, 0, 1]) mx = Math.max(mx, terrainHeight(fr.x + fr.ux * fr.hu * a * 0.98 + fr.nx * fr.hv * c * 0.98, fr.z + fr.uz * fr.hu * a * 0.98 + fr.nz * fr.hv * c * 0.98) + curb);
  return mx;
}

function footprintMin(fr) {
  let mn = Infinity;
  for (const a of [-1, 0, 1]) for (const c of [-1, 0, 1]) mn = Math.min(mn, terrainHeight(fr.x + fr.ux * fr.hu * a + fr.nx * fr.hv * c, fr.z + fr.uz * fr.hu * a + fr.nz * fr.hv * c));
  return mn;
}

/**
 * Planta del hueco bajo el cuarto de un local (vano `s` de la fachada `f`):
 * cuatro esquinas, del borde de la vitrina hasta el fondo del cuarto, un
 * poco más grande que el cuarto (sus paredes tapan el borde del hueco).
 */
export function shopRoomRect(f, s, depth = BASES.SHOP_ROOM_DEPTH) {
  const p = BASES.ROOM_CUT_PAD;
  const u0 = s.u0 - p;
  const u1 = s.u1 + p;
  const d0 = 0.12;
  const d1 = depth + p;
  return [at(f, u0, -d0), at(f, u1, -d0), at(f, u1, -d1), at(f, u0, -d1)];
}

/** Hueco bajo un local al que se entra (sim/interiors.js): toda la huella, menos el grueso de los muros. */
export function accessRoomRect(b, f = faceFrame(b, b.front ?? 'S')) {
  const p = BASES.ROOM_CUT_PAD;
  const len = f.len;
  const deep = 2 * b.frame.hv;
  return [at(f, 0.12 - p, -0.12), at(f, len - 0.12 + p, -0.12), at(f, len - 0.12 + p, -deep + 0.12 - p), at(f, 0.12 - p, -deep + 0.12 - p)];
}

/** Índice del lote de la manzana que contiene entero el hueco `rect` (-1 si ninguno). */
function roomLot(lots, rect) {
  if (!lots) return -1;
  const pts = [...rect];
  for (let k = 0; k < 4; k++) {
    const [ax, az] = rect[k];
    const [bx, bz] = rect[(k + 1) % 4];
    pts.push([(ax + bx) / 2, (az + bz) / 2]);
  }
  for (let li = 0; li < lots.length; li++) {
    const l = lots[li];
    if (pts.every(([x, z]) => pointInPoly(x, z, l) && distToPolyEdge(x, z, l) > 0.04)) return li;
  }
  return -1;
}

/**
 * Fachada escalonada: si el andén baja mucho a lo largo del frente, el
 * edificio se parte en tramos (cada uno con su piso). Devuelve los tramos
 * nuevos (el primero sigue siendo `b`, con su índice).
 */
function splitPieces(b) {
  if (b.interior || b.local || !SPLIT_STYLES.has(b.style) || b.collide === false) return [];
  const fr = b.frame;
  const len = 2 * fr.hu;
  if (len < 2 * BASES.SPLIT_MIN_W) return [];
  const f = faceFrame(b, b.front ?? 'S');
  let lo = Infinity;
  let hi = -Infinity;
  for (let k = 0; k <= 8; k++) {
    const [x, z] = at(f, 0.4 + ((len - 0.8) * k) / 8, BASES.ENTRY_PROBE);
    const y = walkLevel(x, z);
    lo = Math.min(lo, y);
    hi = Math.max(hi, y);
  }
  const drop = hi - lo;
  if (drop <= BASES.SPLIT_DROP) return [];
  const n = Math.min(BASES.SPLIT_MAX, Math.floor(len / BASES.SPLIT_MIN_W), Math.max(2, Math.ceil(drop / BASES.SPLIT_PIECE_DROP)));
  if (n < 2) return [];
  const hu = fr.hu / n;
  const out = [];
  for (let j = 0; j < n; j++) {
    const c = -fr.hu + (2 * j + 1) * hu;
    const pf = makeFrame(fr.x + fr.ux * c, fr.z + fr.uz * c, fr.nx, fr.nz, hu, fr.hv);
    if (j === 0) {
      Object.assign(b, { frame: pf, ...frameBounds(pf), split: n });
      continue;
    }
    // Tramo vecino: la misma casa (estilo, color, pisos), con su propia fachada.
    out.push({ ...b, frame: pf, ...frameBounds(pf), uvOffset: (b.uvOffset + 0.618 * j) % 1, tank: false, split: n });
  }
  return out;
}

/**
 * Pone el piso de `b` (índice `i`) al nivel de sus entradas. Devuelve las
 * escalas que necesitan las entradas que quedan más altas que su andén.
 */
function seat(b, i, lotsOf) {
  const fr = b.frame;
  const side = b.front ?? 'S';
  const f = faceFrame(b, side);
  let H = b.topY - b.groundY;
  const explicitH = b.height !== undefined;
  const back = footprintMax(fr);
  let floor = 0;
  let ents = [];
  let levels = [];
  let shopDepth;
  let extra = 0;
  for (let pass = 0; pass < 4; pass++) {
    const L = facadeLayout(b, i);
    ents = buildingEntries(b, L, f);
    levels = ents.map((e) => entryLevel(f, e));
    floor = Math.max(...levels.map((l) => l.hi)) + BASES.FLOOR_LIFT;
    shopDepth = undefined;
    delete b.cutRoom;
    // Local: el cuarto que se ve por la vitrina no puede tener el terreno
    // adentro. Lo normal: se abre un hueco en el patio y se baja el terreno
    // bajo el cuarto (como la excavación de verdad; render/baseBuilder.js) y
    // el piso queda al nivel del andén. Si el cuarto no cabe en el lote, se
    // acorta el fondo y, si ni así, el piso sube (escalas).
    // (Al que se entra, el hueco es toda la huella y el piso no sube: la puerta queda al nivel del andén.)
    const rect = L?.shop?.access ? accessRoomRect(b, f) : L?.shop ? shopRoomRect(f, L.shop) : null;
    const lot = rect ? roomLot(lotsOf(b.block), rect) : -1;
    if (lot >= 0) b.cutRoom = lot;
    else if (L?.shop && !L.shop.access) {
      const s = L.shop;
      const ok = Math.max(floor, entryLevel(f, s).lo + BASES.STEP_MAX);
      let need = -Infinity;
      for (const D of BASES.SHOP_DEPTHS) {
        need = -Infinity;
        for (const d of [0.3, D * 0.5, D])
          for (const t of [0.08, 0.5, 0.92]) {
            const [x, z] = at(f, s.u0 + (s.u1 - s.u0) * t, -d);
            need = Math.max(need, terrainHeight(x, z) + curb + BASES.SHOP_MARGIN);
          }
        shopDepth = D;
        if (need <= ok) break;
      }
      floor = Math.max(floor, need);
    }
    // Muy enterrada atrás: la casa gana pisos (la loma tapa los de atrás).
    if (!explicitH && back > floor + H - BASES.ROOF_CLEAR && extra < BASES.MAX_EXTRA_FLOORS) {
      const add = Math.min(BASES.MAX_EXTRA_FLOORS - extra, Math.ceil((back - floor - H + BASES.ROOF_CLEAR) / FLOOR_H));
      b.floors += add;
      extra += add;
      H += add * FLOOR_H;
      continue; // otra distribución de la fachada: se vuelve a medir
    }
    // Un garaje no lleva escalas: si quedaría alto sobre su andén, la casa no tiene garaje.
    if (!b.noGarage && ents.some((e, k) => e.kind === 'garage' && floor - levels[k].lo > BASES.STEP_MAX)) {
      b.noGarage = true;
      continue;
    }
    break;
  }
  if (shopDepth !== undefined && shopDepth < BASES.SHOP_DEPTHS[0]) b.shopDepth = shopDepth;
  b.groundY = floor;
  b.topY = floor + H;
  // (Un local con sótano baja su base hasta debajo del salón.)
  const drop = b.local?.access ? (PLANES[b.local.id]?.sotano ?? 0) : 0;
  b.baseY = Math.min(footprintMin(fr), floor - drop) - BASES.BASE_SINK;
  // Escalas para las entradas que quedan altas.
  const steps = [];
  if (b.interior) return steps;
  for (let k = 0; k < ents.length; k++) {
    const e = ents[k];
    const R = floor - levels[k].lo;
    const n = Math.round(R / BASES.STEP_RISE) - 1;
    if (n < 1) continue;
    const uc = (e.u0 + e.u1) / 2;
    const [x, z] = at(f, uc, 0);
    const [px, pz] = at(f, uc, BASES.ENTRY_PROBE);
    if (onRoad(px, pz)) continue; // sin andén: no se ponen escalas en la calzada
    const tread = Math.min(BASES.STEP_TREAD, BASES.STEPS_MAX_OUT / n);
    const w = Math.min(5, e.u1 - e.u0 + (e.kind === 'door' ? 0.3 : 0.1));
    // Lo más bajo del andén bajo las escalas (el pie de cada bloque se entierra ahí).
    let low = Infinity;
    for (const t of [-0.5, 0, 0.5]) for (const d of [0.05, n * tread]) {
      const [qx, qz] = at(f, uc + t * w, d);
      low = Math.min(low, walkLevel(qx, qz));
    }
    steps.push({ type: 'steps', x, z, rot: Math.atan2(f.nx, f.nz), w, n, rise: R / (n + 1), tread, y0: levels[k].lo, low: low - 0.08, building: i });
  }
  return steps;
}

/**
 * Suelo caminable de todas las escalas (una sola entrada en la lista de
 * terrain.js, con rejilla propia: groundHeight no recorre miles).
 */
export function stepsWalkable(steps) {
  const CELL = 8;
  const grid = new Map();
  // Clave numérica (groundHeight corre por peatón y por cuadro: nada de armar cadenas).
  const cell = (i, j) => (i + 32768) * 65536 + (j + 32768);
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const s of steps) {
    const nx = Math.sin(s.rot);
    const nz = Math.cos(s.rot);
    const out = s.n * s.tread;
    const r = Math.hypot(s.w / 2, out) + 0.1;
    const cx = s.x + nx * out * 0.5;
    const cz = s.z + nz * out * 0.5;
    minX = Math.min(minX, cx - r);
    maxX = Math.max(maxX, cx + r);
    minZ = Math.min(minZ, cz - r);
    maxZ = Math.max(maxZ, cz + r);
    for (let i = Math.floor((cx - r) / CELL); i <= Math.floor((cx + r) / CELL); i++)
      for (let j = Math.floor((cz - r) / CELL); j <= Math.floor((cz + r) / CELL); j++) {
        const k = cell(i, j);
        if (!grid.has(k)) grid.set(k, []);
        grid.get(k).push(s);
      }
  }
  return {
    minX,
    maxX,
    minZ,
    maxZ,
    over: false,
    height(x, z) {
      const list = grid.get(cell(Math.floor(x / CELL), Math.floor(z / CELL)));
      if (!list) return null;
      let best = null;
      for (const s of list) {
        const nx = Math.sin(s.rot);
        const nz = Math.cos(s.rot);
        const dx = x - s.x;
        const dz = z - s.z;
        const d = dx * nx + dz * nz; // hacia la calle
        const a = dx * nz - dz * nx; // a lo largo de la fachada
        if (d < 0 || d >= s.n * s.tread || Math.abs(a) > s.w / 2) continue;
        const h = s.y0 + (s.n - Math.floor(d / s.tread)) * s.rise;
        if (best === null || h > best) best = h;
      }
      return best;
    },
  };
}

/**
 * Asienta todas las edificaciones de la ciudad (después de escoger los
 * locales y antes de las colisiones). Agrega a city.props las escalas.
 */
export function seatBuildings(city) {
  const list = city.buildings;
  const n0 = list.length;
  for (let i = 0; i < n0; i++) for (const p of splitPieces(list[i])) list.push(p);
  const steps = [];
  const blocks = new Map(city.blocks.map((bl) => [bl.id, bl]));
  const lotsOf = (id) => blocks.get(id)?.lots;
  // Los tumbados por un local que creció (`gone`) se asientan igual (sus
  // pisos gastan el azar de la utilería como antes) pero no llevan escalas:
  // cityLayout.js los quita al final.
  for (let i = 0; i < list.length; i++) for (const s of seat(list[i], i, lotsOf)) if (!list[i].gone) steps.push(s);
  for (const s of steps) city.props.push(s);
  if (steps.length) addWalkable(stepsWalkable(steps));
  return steps;
}
