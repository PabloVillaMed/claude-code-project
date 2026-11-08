// Interiores accesibles de los locales (puro, sin three.js). Sistema genérico
// para que el jugador entre a un local: la huella del edificio se agranda
// (ocupa lotes vecinos de la misma manzana), el cascarón queda hueco con su
// propia colisión (muros, puerta con hueco, techo, mezanine con escalera,
// barra, tarima, mesas grandes...), el piso es una superficie caminable al
// nivel de la puerta (o un sótano con escalera, como una salsoteca vieja) y
// cada local tiene su distribución según el tema. Hoy lo usan las ocho
// discotecas, bares y la fonda de la Calle 92 (cityLayout.js LOCAL_SPOTS).
//
// Coordenadas locales de un interior: origen en el centro del frente de la
// fachada, al nivel de la puerta; x a lo largo de la fachada (el eje u del
// marco del edificio), z hacia la calle (adentro es z < 0), y absoluta.
// Mundo: x = ox + ux·lx + nx·lz, z = oz + uz·lx + nz·lz.
//
// render/interiorBuilder.js dibuja cada interior con lo que sale de aquí
// (estructura e `items`) y game/interiors.js lo arma cerca del jugador, cobra
// el cover y abre o cierra la puerta. `spots` deja listos los puntos para la
// gente de adentro (pista, barra, mesas, cabina, tarima).

import { framesOverlap, frameBounds, makeFrame, pointInPoly } from './geom2d.js';
import { obbFromAxis } from './collision.js';
import { NIVEL_ABIERTO, nivelRumba } from './nightlife.js';
import { makeRng } from './rng.js';

// ------------------------------------------------------------------ configurables
/**
 * Interiores accesibles (v3.6, a medias): la lógica de la ciudad está (huella
 * ampliada, cascarón, piso caminable, colisiones, puntos de la gente) pero
 * todavía falta dibujar el interior (render/interiorBuilder.js) y la vida de
 * adentro. Mientras sea false, las discotecas quedan como en la 3.5 (no se
 * entra y no se amplían). Al terminar ese trabajo, ponerlo en true y
 * actualizar las sumas de tests/unit/carga-ciudad.test.js.
 */
export const INTERIORES_ACTIVOS = false;

export const INTERIOR = {
  /** Grosor (m) de los muros del cascarón (fachada, costados y fondo). */
  MURO: 0.25,
  /** Puerta doble de la entrada: ancho y alto (m). */
  PUERTA_ANCHO: 2.2,
  PUERTA_ALTO: 2.55,
  /** Mezanine de los locales grandes: altura del piso sobre la pista (m) y fondo desde la fachada (m). */
  MEZZ_ALTO: 3.4,
  MEZZ_FONDO: 5.2,
  /** Escaleras: contrahuella buscada, huella (m) y ancho de la del mezanine. */
  ESCALON_ALTO: 0.18,
  ESCALON_HUELLA: 0.28,
  ESCALERA_ANCHO: 1.3,
  /** Alto (m) de las barandas (mezanine y escaleras). */
  BARANDA: 1.05,
  /** Una superficie más alta que esto sobre los pies no se sube sin saltar (igual que terrain.walkableHeight). */
  ALCANCE: 0.7,
  /** Fondo máximo del salón (× el fondo del tamaño): en un edificio más hondo, lo de atrás queda macizo. */
  FONDO_MAX: 1.15,
  /** Tramos de la caja que tapa el hueco bajo cada escalera (para no meterse debajo). */
  BAJO_ESCALERA: 6,
  /** Nivel de rumba (sim/nightlife.js nivelRumba) desde el que el local está abierto; de día, cortina abajo. */
  ABRE_NIVEL: NIVEL_ABIERTO,
};

/**
 * Tamaños de local: huella buscada (m, frente × fondo), alto libre del salón
 * (m), pisos mínimos del edificio, mezanine y cover ($ de la plata del juego,
 * se cobra al cruzar la puerta de noche; 0 = entrada libre).
 */
export const TAMANOS = {
  grande: { ancho: 14, fondo: 22, alto: 6.6, pisos: 3, mezz: true, cover: 50 },
  mediano: { ancho: 10, fondo: 16, alto: 4.4, pisos: 2, mezz: false, cover: 30 },
  bar: { ancho: 8, fondo: 12, alto: 3.4, pisos: 2, mezz: false, cover: 0 },
};

/** Ampliación de la huella: lo menos que se acepta de cada medida (fracción de la buscada), corrimiento del centro a lo largo del frente y castigos al escoger. */
export const AMPLIAR = {
  MIN_FRAC: 0.8,
  PASO_CORRIDA: 0.5,
  MAX_CORRIDA: 7,
  /** m² que "cuesta" cada vecino que se tumba para hacer el local. */
  PENA_VECINO: 10,
  /** m² que cuesta cada metro que el local se corre de donde estaba. */
  PENA_CORRIDA: 2,
};

/**
 * Qué es cada local de la 92 (ids de LOCAL_SPOTS): tema (render/interiorBuilder.js
 * TEMAS) y tamaño. `sotano`: el salón queda este tanto (m) bajo la puerta,
 * con escalera de bajada y techo bajo (`techo`, m).
 */
export const PLANES = {
  flow92: { tema: 'reguetón', tam: 'grande' },
  compadres: { tema: 'cantina', tam: 'bar' },
  laclave: { tema: 'salsoteca', tam: 'mediano', sotano: 2.0, techo: 3.1 },
  neon92: { tema: 'electrónica', tam: 'grande' },
  laruana: { tema: 'fonda', tam: 'mediano' },
  elguaro: { tema: 'esquina', tam: 'bar' },
  saborson: { tema: 'son', tam: 'mediano' },
  bajocero: { tema: 'hielo', tam: 'grande' },
};

/** ¿El local está abierto a la hora `h`? (de noche, con la rumba). */
export function localAbierto(h) {
  return nivelRumba(h) > INTERIOR.ABRE_NIVEL;
}

const hash = (s) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
};

// ------------------------------------------------------------------ huella
/**
 * Agranda la huella del local `b` (un edificio de city.buildings) según su
 * plan: mismo frente sobre la calle, más ancho y más fondo dentro de los
 * lotes de su manzana, corriéndose a lo largo del frente si hace falta. Los
 * vecinos que quedan debajo se tumban (no los locales con nombre, las torres
 * ni lo especial). No gasta el generador aleatorio de la ciudad. Devuelve
 * {removed: [edificios a quitar], props: [utilería a quitar], frame}.
 */
export function ampliarLocal(city, b, plan) {
  const T = TAMANOS[plan.tam];
  const f = b.frame;
  const fx = f.x + f.nx * f.hv;
  const fz = f.z + f.nz * f.hv;
  const lots = city.blocks[b.block]?.lots ?? [];
  const inLots = (x, z) => {
    for (const l of lots) if (pointInPoly(x, z, l)) return true;
    return false;
  };
  // Vecinos que pueden quedar debajo (los de cerca, una sola vez).
  const R = Math.hypot(T.ancho / 2 + AMPLIAR.MAX_CORRIDA, T.fondo) + 25;
  const near = city.buildings.filter((o) => o !== b && !o.gone && Math.abs(o.frame.x - fx) < R && Math.abs(o.frame.z - fz) < R);
  const W0 = 2 * f.hu;
  const D0 = 2 * f.hv;
  const sizes = (want, now) => {
    const out = [];
    const lo = Math.max(now, want * AMPLIAR.MIN_FRAC);
    for (let v = want; v >= lo - 1e-6; v -= 1) out.push(v);
    if (!out.length) out.push(now);
    return out;
  };
  let best = null;
  for (const W of sizes(T.ancho, W0))
    for (const D of sizes(T.fondo, D0))
      for (let k = 0; k <= (2 * AMPLIAR.MAX_CORRIDA) / AMPLIAR.PASO_CORRIDA; k++) {
        // 0, +0.5, -0.5, +1, -1, ...
        const sh = (k % 2 ? 1 : -1) * Math.ceil(k / 2) * AMPLIAR.PASO_CORRIDA;
        const score0 = W * D - Math.abs(sh) * AMPLIAR.PENA_CORRIDA;
        if (best && score0 <= best.score) continue;
        const frame = makeFrame(fx + f.ux * sh - f.nx * (D / 2), fz + f.uz * sh - f.nz * (D / 2), f.nx, f.nz, W / 2, D / 2);
        // Toda la huella dentro de los lotes (sin meterse en el andén ni en la calle de atrás).
        let fits = true;
        for (let i = 0; i <= 6 && fits; i++)
          for (let j = 0; j <= 6 && fits; j++) {
            const a = -W / 2 + 0.15 + ((W - 0.3) * i) / 6;
            const d = 0.15 + ((D - 0.3) * j) / 6;
            if (!inLots(fx + f.ux * (sh + a) - f.nx * d, fz + f.uz * (sh + a) - f.nz * d)) fits = false;
          }
        if (!fits) continue;
        const removed = [];
        let blocked = false;
        for (const o of near) {
          if (!framesOverlap(frame, o.frame, -0.15)) continue;
          if (o.local || o.shop || o.style === 'torre' || o.floors > 5 || o.collide === false || o.block !== b.block) {
            blocked = true;
            break;
          }
          removed.push(o);
        }
        if (blocked) continue;
        const score = score0 - removed.length * AMPLIAR.PENA_VECINO;
        if (!best || score > best.score) best = { score, frame, removed, W, D, sh };
      }
  if (!best) return { removed: [], props: [], frame: f };
  const fr = best.frame;
  const props = city.props.filter((p) => {
    const dx = p.x - fr.x;
    const dz = p.z - fr.z;
    return Math.abs(dx * fr.ux + dz * fr.uz) < fr.hu + 0.2 && Math.abs(dx * fr.nx + dz * fr.nz) < fr.hv + 0.2;
  });
  return { removed: best.removed, props, frame: fr };
}

/** Aplica a `b` la huella nueva y los pisos mínimos del plan (antes del asiento en la loma). */
export function aplicarHuella(b, frame, plan) {
  const T = TAMANOS[plan.tam];
  b.frame = frame;
  Object.assign(b, frameBounds(frame));
  b.floors = Math.max(b.floors, T.pisos);
  b.topY = b.groundY + b.floors * 3;
  b.balcony = false;
  b.local.access = plan.tam;
}

// ------------------------------------------------------------------ distribución
/** Del sistema local del interior `r` al mundo: {x, z}. */
export function aMundo(r, lx, lz, out = {}) {
  out.x = r.ox + r.ux * lx + r.nx * lz;
  out.z = r.oz + r.uz * lx + r.nz * lz;
  return out;
}

/** Del mundo al sistema local del interior `r`: {x, z}. */
export function aLocal(r, x, z, out = {}) {
  const dx = x - r.ox;
  const dz = z - r.oz;
  out.x = dx * r.ux + dz * r.uz;
  out.z = dx * r.nx + dz * r.nz;
  return out;
}

/** Yaw del mundo (mirando hacia (sin, cos)) de una dirección local (lx, lz). */
export function yawMundo(r, lx, lz) {
  return Math.atan2(r.ux * lx + r.nx * lz, r.uz * lx + r.nz * lz);
}

const inRect = (o, x, z) => x >= o.x0 && x <= o.x1 && z >= o.z0 && z <= o.z1;

/**
 * Arma el interior del local `b` (ya asentado: groundY, topY y baseY
 * definitivos). Devuelve el objeto del interior (ver arriba) con su
 * estructura, `items` (barra, tarima, mesas...) y `spots`.
 */
export function armarInterior(b, L, plan) {
  const f = b.frame;
  const T = INTERIOR.MURO;
  const tam = TAMANOS[plan.tam];
  const W = 2 * f.hu;
  const D = Math.min(2 * f.hv, tam.fondo * INTERIOR.FONDO_MAX);
  const floorY = b.groundY;
  const y0 = floorY - (plan.sotano ?? 0);
  const H = plan.techo ?? Math.min(tam.alto, b.topY - floorY - 0.5);
  const dw = Math.min(INTERIOR.PUERTA_ANCHO, W - 2 * T - 1);
  const r = {
    id: L.id,
    name: L.name,
    tema: plan.tema,
    tam: plan.tam,
    cover: tam.cover,
    ox: f.x + f.nx * f.hv,
    oz: f.z + f.nz * f.hv,
    ux: f.ux,
    uz: f.uz,
    nx: f.nx,
    nz: f.nz,
    rot: Math.atan2(f.nx, f.nz),
    W,
    D,
    deep: 2 * f.hv,
    hu: f.hu,
    X0: -f.hu + T,
    X1: f.hu - T,
    Z0: -D + T,
    Z1: -T,
    floorY,
    y0,
    H,
    baseY: b.baseY,
    topY: b.topY,
    door: { x0: -dw / 2, x1: dw / 2, h: INTERIOR.PUERTA_ALTO },
    mezz: null,
    stairs: [],
    landing: null,
    shaft: null,
    items: [],
    spots: { baile: [], barra: [], bartender: [], mesas: [], vip: [], cabina: [], tarima: [], animador: [], meseros: [] },
    pista: null,
    cabina: null,
    minX: Math.min(b.minX, b.maxX),
    maxX: b.maxX,
    minZ: b.minZ,
    maxZ: b.maxZ,
  };
  const rng = makeRng(hash(L.id) || 1);
  if (plan.sotano) sotano(r, plan.sotano);
  if (tam.mezz) mezanine(r);
  (TEMAS[plan.tema] ?? TEMAS.esquina)(r, rng);
  return r;
}

// Ayudas de los temas: rectángulos en coordenadas locales.
function caja(r, t, x0, x1, z0, z1, y, h, extra = {}) {
  const o = { t, x0: Math.min(x0, x1), x1: Math.max(x0, x1), z0: Math.min(z0, z1), z1: Math.max(z0, z1), y, h, solid: true, ...extra };
  r.items.push(o);
  return o;
}
function deco(r, t, extra) {
  const o = { t, solid: false, ...extra };
  r.items.push(o);
  return o;
}
/** Punto para la gente (mundo): x, z, y, yaw a partir de una dirección local. */
function spot(r, lx, lz, y, dx, dz, extra = {}) {
  const p = aMundo(r, lx, lz);
  return { x: p.x, z: p.z, y, yaw: yawMundo(r, dx, dz), lx, lz, ...extra };
}

/** Sótano: descanso a la altura de la puerta y escalera que baja hacia el fondo, encerrada en un foso de techo alto. */
function sotano(r, drop) {
  const n = Math.max(2, Math.round(drop / INTERIOR.ESCALON_ALTO));
  const tread = INTERIOR.ESCALON_HUELLA;
  const run = n * tread;
  const half = 1.45;
  const zl = r.Z1 - 1.5; // fondo del descanso
  r.landing = { x0: -half, x1: half, z0: zl, z1: r.Z1 + INTERIOR.MURO, y: r.floorY };
  r.stairs.push({ x0: -half + 0.08, x1: half - 0.08, z0: zl - run, z1: zl, yLow: r.y0, yHigh: r.floorY, n, tread, highAt: 'z1' });
  r.shaft = { x0: -half, x1: half, z0: zl - run, z1: r.Z1, top: r.floorY + 2.9, wall: 0.15 };
}

/** Mezanine de los grandes: sobre la entrada, a lo ancho; escalera pegada al muro izquierdo que sube hacia la fachada. */
function mezanine(r) {
  const mz = r.y0 + INTERIOR.MEZZ_ALTO;
  const zm = r.Z1 - INTERIOR.MEZZ_FONDO;
  r.mezz = { x0: r.X0, x1: r.X1, z0: zm, z1: r.Z1, y: mz, slab: 0.3 };
  const n = Math.round(INTERIOR.MEZZ_ALTO / INTERIOR.ESCALON_ALTO);
  const tread = INTERIOR.ESCALON_HUELLA;
  const run = n * tread;
  r.stairs.push({ x0: r.X0, x1: r.X0 + INTERIOR.ESCALERA_ANCHO, z0: zm - run, z1: zm, yLow: r.y0, yHigh: mz, n, tread, highAt: 'z1', baranda: 'x1' });
  // Columnas que cargan el borde del mezanine (lejos del paso de la puerta).
  for (const x of [r.X0 + INTERIOR.ESCALERA_ANCHO + 1.6, r.X1 - 2.9]) caja(r, 'columna', x - 0.2, x + 0.2, zm + 0.05, zm + 0.45, r.y0, mz - 0.3 - r.y0);
}

/** Altura de la escalera `s` en (lx, lz) (sin mirar si está dentro). */
function stairHeight(s, lz) {
  const rise = (s.yHigh - s.yLow) / s.n;
  const d = s.highAt === 'z1' ? lz - s.z0 : s.z1 - lz;
  const k = Math.max(0, Math.min(s.n - 1, Math.floor(d / s.tread)));
  return s.yLow + (k + 1) * rise;
}

/**
 * Altura caminable del interior en el punto local (lx, lz) para unos pies a
 * la altura `y` (null = sin saber: lo de abajo del mezanine). null si el
 * punto no es del interior (fuera del salón y del vano de la puerta).
 */
export function alturaInterior(r, lx, lz, y = null) {
  const T = INTERIOR.MURO;
  const inDoor = lx >= r.door.x0 && lx <= r.door.x1 && lz >= -T - 0.01 && lz <= 0.02;
  if (!inDoor && !(lx >= r.X0 && lx <= r.X1 && lz >= r.Z0 && lz <= r.Z1)) return null;
  // Piso base: el salón (o el descanso de la puerta, en el sótano).
  let base = r.y0;
  if (inDoor || (r.landing && inRect(r.landing, lx, lz))) base = r.floorY;
  let best = base;
  const reach = y === null ? Infinity : y + INTERIOR.ALCANCE;
  for (const s of r.stairs) {
    if (lx < s.x0 || lx > s.x1 || lz < s.z0 || lz > s.z1) continue;
    const h = stairHeight(s, lz);
    // La escalera es maciza por debajo: cuenta aunque no se alcance (sin y) o si se alcanza.
    if (y === null || h <= reach) best = Math.max(best, h);
  }
  if (y !== null) {
    const m = r.mezz;
    if (m && inRect(m, lx, lz) && m.y <= reach) best = Math.max(best, m.y);
    for (const it of r.items) {
      if (!it.walk || lx < it.x0 || lx > it.x1 || lz < it.z0 || lz > it.z1) continue;
      const top = it.y + it.h;
      if (top <= reach) best = Math.max(best, top);
    }
  }
  return best;
}

/** Techo (y) sobre el punto local para algo a la altura `y` (la cámara): bajo el mezanine, su losa. */
export function techoInterior(r, lx, lz, y) {
  const m = r.mezz;
  if (m && inRect(m, lx, lz) && y < m.y - m.slab * 0.5) return m.y - m.slab;
  if (r.shaft && inRect(r.shaft, lx, lz)) return r.shaft.top;
  return r.y0 + r.H;
}

/** ¿El punto del mundo está adentro del local (pasando la fachada)? */
export function dentroInterior(r, x, z, y = null) {
  if (x < r.minX - 0.5 || x > r.maxX + 0.5 || z < r.minZ - 0.5 || z > r.maxZ + 0.5) return false;
  const p = aLocal(r, x, z, _p);
  if (p.x < r.X0 || p.x > r.X1 || p.z < r.Z0 || p.z > r.Z1 - 0.05) return false;
  if (y === null) return true;
  return y > r.y0 - 1 && y < Math.max(r.y0 + r.H, r.shaft?.top ?? 0) + 0.5;
}
const _p = { x: 0, z: 0 };

/**
 * Una sola estructura caminable (terrain.js addWalkable) para todos los
 * interiores: `room` = adentro manda sobre el terreno (el sótano queda bajo
 * la loma y el patio no se asoma por el piso).
 */
export function caminableInteriores(rooms) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const r of rooms) {
    minX = Math.min(minX, r.minX);
    maxX = Math.max(maxX, r.maxX);
    minZ = Math.min(minZ, r.minZ);
    maxZ = Math.max(maxZ, r.maxZ);
  }
  const p = { x: 0, z: 0 };
  return {
    minX,
    maxX,
    minZ,
    maxZ,
    over: false,
    room: true,
    interiors: rooms,
    height(x, z, y = null) {
      for (const r of rooms) {
        if (x < r.minX || x > r.maxX || z < r.minZ || z > r.maxZ) continue;
        aLocal(r, x, z, p);
        const h = alturaInterior(r, p.x, p.z, y);
        if (h !== null) return h;
      }
      return null;
    },
  };
}

// ------------------------------------------------------------------ colisión
/**
 * Cajas de colisión del interior `r` (en el mundo, como las de
 * CollisionWorld.add): cascarón con el hueco de la puerta, techo, piso,
 * mezanine, escaleras y lo macizo de adentro. La hoja de la puerta (cerrada)
 * va aparte, con kind 'puerta' (game/interiors.js la quita y la pone).
 */
export function colisionesInterior(r) {
  const out = [];
  const T = INTERIOR.MURO;
  const box = (x0, x1, z0, z1, minY, maxY, kind = 'interior') => {
    if (x1 - x0 < 1e-3 || z1 - z0 < 1e-3 || maxY - minY < 1e-3) return null;
    const c = aMundo(r, (x0 + x1) / 2, (z0 + z1) / 2);
    const o = { obb: obbFromAxis(c.x, c.z, r.ux, r.uz, (x1 - x0) / 2, (z1 - z0) / 2), minY, maxY, kind, interior: r.id };
    out.push(o);
    return o;
  };
  const hu = r.hu;
  const D = r.D;
  const top = r.topY;
  const bot = r.baseY;
  // Cascarón: fondo, costados y fachada con el vano de la puerta.
  box(-hu, hu, -D, -D + T, bot, top, 'building');
  box(-hu, hu, -r.deep, -D, bot, top, 'building'); // lo de atrás del salón (edificio más hondo)
  box(-hu, -hu + T, -D + T, 0, bot, top, 'building');
  box(hu - T, hu, -D + T, 0, bot, top, 'building');
  box(-hu + T, r.door.x0, -T, 0, bot, top, 'building');
  box(r.door.x1, hu - T, -T, 0, bot, top, 'building');
  box(r.door.x0, r.door.x1, -T, 0, r.floorY + r.door.h, top, 'building');
  box(r.door.x0, r.door.x1, -T, 0, bot, r.floorY - 0.02, 'building');
  // Techo del salón (y del foso del sótano, más alto) hasta arriba del edificio.
  const inner = { x0: r.X0, x1: r.X1, z0: r.Z0, z1: r.Z1 };
  const ceil = r.y0 + r.H;
  if (r.shaft) {
    const s = r.shaft;
    const sx0 = s.x0 - s.wall;
    const sx1 = s.x1 + s.wall;
    const sz0 = s.z0 - s.wall;
    for (const q of rectMinus(inner, { x0: sx0, x1: sx1, z0: sz0, z1: r.Z1 })) box(q.x0, q.x1, q.z0, q.z1, ceil, top);
    box(sx0, sx1, sz0, r.Z1, s.top, top);
    // Muros del foso (de arriba a abajo) y el dintel sobre la boca de la escalera.
    box(sx0, s.x0, s.z0, r.Z1, r.y0, s.top);
    box(s.x1, sx1, s.z0, r.Z1, r.y0, s.top);
    box(s.x0, s.x1, sz0, s.z0, ceil, s.top);
    // Macizo bajo el descanso.
    const l = r.landing;
    box(l.x0, l.x1, l.z0, r.Z1, r.y0 - 0.2, l.y - 0.02);
  } else box(inner.x0, inner.x1, inner.z0, inner.z1, ceil, top);
  // Piso: macizo de la base del edificio hasta el piso del salón.
  box(inner.x0, inner.x1, inner.z0, inner.z1, bot, r.y0 - 0.02);
  // Mezanine: losa y baranda del borde (con el hueco de la llegada de la escalera).
  const m = r.mezz;
  if (m) {
    box(m.x0, m.x1, m.z0, m.z1, m.y - m.slab, m.y);
    const st = r.stairs.find((s) => Math.abs(s.yHigh - m.y) < 0.01);
    const gx = st ? st.x1 : m.x0;
    box(gx, m.x1, m.z0, m.z0 + 0.07, m.y, m.y + INTERIOR.BARANDA);
  }
  // Escaleras: baranda del lado abierto y macizo por debajo (por tramos).
  for (const s of r.stairs) {
    if (s.baranda === 'x1') box(s.x1, s.x1 + 0.06, s.z0, s.z1, s.yLow, s.yHigh + INTERIOR.BARANDA);
    const N = INTERIOR.BAJO_ESCALERA;
    const rise = (s.yHigh - s.yLow) / s.n;
    for (let j = 1; j < N; j++) {
      const za = s.z0 + ((s.z1 - s.z0) * j) / N;
      const zb = s.z0 + ((s.z1 - s.z0) * (j + 1)) / N;
      // Distancia desde el pie de la escalera hasta el comienzo del tramo.
      const d = s.highAt === 'z1' ? za - s.z0 : s.z1 - zb;
      const k = Math.floor(d / s.tread + 1e-6);
      const maxY = s.yLow + k * rise;
      if (maxY - s.yLow < 0.3) continue;
      box(s.x0, s.x1, s.highAt === 'z1' ? za : s.z0 + (s.z1 - zb), s.highAt === 'z1' ? zb : s.z0 + (s.z1 - za), s.yLow - 0.1, maxY);
    }
  }
  // Lo macizo de adentro (barra, tarima, mesas, baños...).
  for (const it of r.items) if (it.solid) box(it.x0, it.x1, it.z0, it.z1, it.y, it.y + it.h, it.walk ? 'tarima' : 'mueble');
  // La hoja de la puerta (cerrada): aparte, la abre game/interiors.js.
  const door = box(r.door.x0, r.door.x1, -T, 0, r.floorY - 0.02, r.floorY + r.door.h, 'puerta');
  out.pop();
  return { boxes: out, door };
}

/** Rectángulo menos un hueco (alineados): hasta cuatro rectángulos. */
export function rectMinus(a, h) {
  const out = [];
  const x0 = Math.max(a.x0, h.x0);
  const x1 = Math.min(a.x1, h.x1);
  const z0 = Math.max(a.z0, h.z0);
  const z1 = Math.min(a.z1, h.z1);
  if (x0 >= x1 || z0 >= z1) return [a];
  if (a.x0 < x0) out.push({ x0: a.x0, x1: x0, z0: a.z0, z1: a.z1 });
  if (x1 < a.x1) out.push({ x0: x1, x1: a.x1, z0: a.z0, z1: a.z1 });
  if (a.z0 < z0) out.push({ x0, x1, z0: a.z0, z1: z0 });
  if (z1 < a.z1) out.push({ x0, x1, z0: z1, z1: a.z1 });
  return out;
}

// ------------------------------------------------------------------ temas
// Cada tema pone su barra, tarima, pista, mesas y decoración y llena los
// puntos de la gente. Las medidas salen del salón (sirven para otro tamaño).

/** Barra pegada a un muro lateral: frente iluminado, estantería de botellas detrás. side: +1 = muro derecho. */
function barra(r, side, z0, z1, extra = {}) {
  const wall = side > 0 ? r.X1 : r.X0;
  const back = 0.45; // estantería
  const gap = 1.15; // pasillo de los que atienden
  const cw = 0.62; // mostrador
  const xa = wall - side * (back + gap);
  const xb = xa - side * cw;
  const counter = caja(r, 'barra', xa, xb, z0, z1, r.y0, 1.1, { face: -side, ...extra });
  caja(r, 'estante', wall, wall - side * back, z0, z1, r.y0, 2.5, { face: -side });
  // Clientes del lado de la pista, mirando la barra; los que atienden, adentro.
  const n = Math.max(2, Math.floor((z1 - z0) / 0.8));
  for (let k = 0; k < n; k++) {
    const z = z0 + ((k + 0.5) * (z1 - z0)) / n;
    r.spots.barra.push(spot(r, xb - side * 0.45, z, r.y0, side, 0));
    if (k % 2 === 0) r.spots.bartender.push(spot(r, xa + side * 0.55, z, r.y0, -side, 0));
  }
  return counter;
}

/** Tarima al fondo (encima se camina) con su cabina de DJ; devuelve la tarima. */
function tarimaFondo(r, cx, w, depth, h, cabina = true) {
  const t = caja(r, 'tarima', cx - w / 2, cx + w / 2, r.Z0, r.Z0 + depth, r.y0, h, { walk: true });
  if (cabina) {
    const cz = r.Z0 + depth * 0.55;
    caja(r, 'cabina', cx - 1.5, cx + 1.5, cz - 0.4, cz + 0.4, r.y0 + h, 1.12, { face: 1 });
    const dj = spot(r, cx, cz - 0.85, r.y0 + h, 0, 1);
    r.spots.cabina.push(dj);
    r.cabina = { ...dj };
  }
  return t;
}

/** Pista (piso de baile) con sus puntos de baile en cuadrícula. */
function pista(r, kind, x0, x1, z0, z1, rng) {
  r.pista = { kind, x0, x1, z0, z1, y: r.y0 };
  deco(r, 'pista', { kind, x0, x1, z0, z1, y: r.y0 });
  const nx = Math.max(2, Math.floor((x1 - x0) / 0.9));
  const nz = Math.max(2, Math.floor((z1 - z0) / 0.9));
  for (let i = 0; i < nx; i++)
    for (let j = 0; j < nz; j++) {
      const x = x0 + ((i + 0.5) * (x1 - x0)) / nx + rng.range(-0.15, 0.15);
      const z = z0 + ((j + 0.5) * (z1 - z0)) / nz + rng.range(-0.15, 0.15);
      const a = rng.range(0, Math.PI * 2);
      r.spots.baile.push(spot(r, x, z, r.y0, Math.sin(a), Math.cos(a)));
    }
}

/** Mesa VIP: sofá curvo (abierto hacia `dir`, en radianes locales) y mesita con botella. */
function vip(r, x, z, dir, y, rad = 1.1) {
  const sx = Math.sin(dir);
  const sz = Math.cos(dir);
  // El sofá ocupa media corona detrás del centro: su caja, detrás de la mesita.
  const back = (rad + 0.35 + 0.42) / 2;
  const half = (rad + 0.35 - 0.42) / 2;
  const bx = x - sx * back;
  const bz = z - sz * back;
  const ex = Math.abs(sz) * (rad + 0.3) + Math.abs(sx) * half;
  const ez = Math.abs(sx) * (rad + 0.3) + Math.abs(sz) * half;
  caja(r, 'sofa', bx - ex, bx + ex, bz - ez, bz + ez, y, 0.85, { cx: x, cz: z, dir, rad });
  caja(r, 'mesita', x - 0.35, x + 0.35, z - 0.35, z + 0.35, y, 0.48, { cx: x, cz: z, botella: true });
  for (let k = -2; k <= 2; k++) {
    const a = dir + Math.PI + (k * Math.PI) / 5.5;
    r.spots.vip.push(spot(r, x + Math.sin(a) * (rad - 0.25), z + Math.cos(a) * (rad - 0.25), y, -Math.sin(a), -Math.cos(a), { sit: true }));
  }
}

/** Mesa con sillas (madera o plástico); `n` sillas alrededor. */
function mesa(r, x, z, kind, n = 4, w = 0.8) {
  caja(r, 'mesa', x - w / 2, x + w / 2, z - w / 2, z + w / 2, r.y0, 0.76, { kind, cx: x, cz: z, sillas: n, w });
  for (let k = 0; k < n; k++) {
    const a = (k * Math.PI * 2) / n + Math.PI / 4;
    r.spots.mesas.push(spot(r, x + Math.sin(a) * (w / 2 + 0.38), z + Math.cos(a) * (w / 2 + 0.38), r.y0, -Math.sin(a), -Math.cos(a), { sit: true, kind }));
  }
}

/** Mesa alta (de pie) con dos bancos. */
function mesaAlta(r, x, z) {
  caja(r, 'mesaAlta', x - 0.32, x + 0.32, z - 0.32, z + 0.32, r.y0, 1.08, { cx: x, cz: z });
  r.spots.mesas.push(spot(r, x + 0.55, z, r.y0, -1, 0), spot(r, x - 0.55, z, r.y0, 1, 0));
}

/** Bloque de baños con dos puertas (Damas / Caballeros) mirando hacia `face` (+1/-1 en x o z: eje). */
function banos(r, x0, x1, z0, z1, axis, face) {
  caja(r, 'banos', x0, x1, z0, z1, r.y0, 2.7, { axis, face });
}

/** VIP del mezanine: sofás contra la fachada mirando a la baranda, y mesas altas en el borde. */
function vipMezanine(r) {
  const m = r.mezz;
  const x0 = m.x0 + INTERIOR.ESCALERA_ANCHO + 1.6;
  const x1 = m.x1 - 1.4;
  const n = Math.max(1, Math.floor((x1 - x0) / 3.2) + 1);
  for (let k = 0; k < n; k++) vip(r, n === 1 ? (x0 + x1) / 2 : x0 + ((x1 - x0) * k) / (n - 1), m.z1 - 1.5, Math.PI, m.y, 1.05);
  for (let k = 0; k < n; k++) {
    const x = n === 1 ? (x0 + x1) / 2 : x0 + ((x1 - x0) * k) / (n - 1);
    r.spots.vip.push(spot(r, x, m.z0 + 0.5, m.y, 0, -1, { baranda: true }));
  }
}

/** Distribución de los grandes (mezanine al frente, pista en el centro, tarima con DJ al fondo, barra a la derecha). */
function grande(r, rng, o = {}) {
  const m = r.mezz;
  const st = r.stairs[0];
  // Barra larga en el muro derecho, en el salón de doble altura.
  const zb1 = m.z0 - 1.0;
  const zb0 = Math.max(r.Z0 + 4.4, zb1 - 9);
  barra(r, 1, zb0, zb1, { luz: o.barraLuz });
  // Tarima y cabina al fondo, centradas en lo que deja libre la barra.
  const fx0 = r.X0;
  const fx1 = r.X1 - 2.6;
  const cx = (fx0 + fx1) / 2;
  const tw = Math.min(10, fx1 - fx0 - 1.2);
  tarimaFondo(r, cx, tw, 3.2, 0.9);
  deco(r, 'pantalla', { x0: cx - Math.min(5.6, (fx1 - fx0) / 2 - 0.3), x1: cx + Math.min(5.6, (fx1 - fx0) / 2 - 0.3), y0: r.y0 + 1.5, y1: r.y0 + r.H - 0.45, z: r.Z0 + 0.03 });
  // Torres de parlantes en las esquinas de la tarima.
  for (const s of [-1, 1]) {
    const x = cx + s * (tw / 2 - 0.55);
    caja(r, 'parlante', x - 0.45, x + 0.45, r.Z0 + 0.15, r.Z0 + 1.0, r.y0 + 0.9, o.parlanteAlto ?? 2.3, { face: 1 });
  }
  // Pista en el centro (entre la tarima y el mezanine, sin pegarse a la barra ni a los VIP).
  const px0 = Math.max(r.X0 + 3.0, cx - 4.6);
  const px1 = Math.min(r.X1 - 3.3, cx + 4.6);
  const pz0 = r.Z0 + 3.7;
  const pz1 = Math.min(pz0 + 7.6, m.z0 - 1.2);
  pista(r, o.pista ?? 'led', px0, px1, pz0, pz1, rng);
  // VIP abajo, contra el muro izquierdo entre la tarima y el pie de la escalera.
  // (El sofá ocupa ±1,4 m: el pie de la escalera queda libre.)
  const vz0 = r.Z0 + 4.6;
  const vz1 = st.z0 - 2.5;
  const nv = Math.max(1, Math.floor((vz1 - vz0) / 2.9) + 1);
  for (let k = 0; k < nv; k++) vip(r, r.X0 + 1.25, nv === 1 ? (vz0 + vz1) / 2 : vz0 + ((vz1 - vz0) * k) / (nv - 1), Math.PI / 2, r.y0);
  // Mesas altas entre la pista y el mezanine.
  for (const x of [px0 + 1.0, px1 - 1.0]) mesaAlta(r, x, m.z0 - 0.9 > pz1 + 0.6 ? (pz1 + m.z0) / 2 : m.z0 - 0.7);
  // Bajo el mezanine: baños a la derecha y guardarropa a la izquierda de la entrada.
  banos(r, r.X1 - 3.0, r.X1, r.Z1 - 3.3, r.Z1, 'x', -1);
  caja(r, 'taquilla', r.X0 + 0.25, r.X0 + 2.6, r.Z1 - 1.75, r.Z1 - 1.2, r.y0, 1.08, { face: 1 });
  vipMezanine(r);
  // Estructura de luces (truss) sobre la pista.
  deco(r, 'truss', { x0: px0 - 0.3, x1: px1 + 0.3, z0: pz0 - 0.3, z1: pz1 + 0.3, y: r.y0 + r.H - 0.55 });
  // Meseros: recorrido entre la barra, los VIP y el mezanine.
  r.spots.meseros.push(spot(r, r.X1 - 3.0, (zb0 + zb1) / 2, r.y0, -1, 0), spot(r, r.X0 + 2.6, (vz0 + vz1) / 2, r.y0, -1, 0), spot(r, st.x0 + 0.65, st.z0 - 0.8, r.y0, 0, 1), spot(r, 0, m.z1 - 2.6, m.y, 0, -1));
}

export const TEMAS = {
  /** Discoteca de reguetón grande: pista LED, pantalla, VIP con botella y bengala, barra dorada, haces de luz. */
  reguetón(r, rng) {
    grande(r, rng, { pista: 'led', barraLuz: 'dorada' });
  },
  /** Club de electrónica industrial: concreto, neón en líneas, láseres, torres de parlantes, mezanine de reja. */
  electrónica(r, rng) {
    grande(r, rng, { pista: 'concreto', barraLuz: 'cian', parlanteAlto: 3.4 });
    // Torres de parlantes extra a los lados de la pista.
    const p = r.pista;
    for (const x of [p.x0 - 0.9, p.x1 + 0.9]) caja(r, 'parlante', x - 0.45, x + 0.45, p.z0 + 0.2, p.z0 + 1.0, r.y0, 2.4, { face: 1 });
  },
  /** Club grande de ambiente frío (azul y blanco): plataformas de bailarines, cañones de humo. */
  hielo(r, rng) {
    grande(r, rng, { pista: 'hielo', barraLuz: 'azul' });
    const p = r.pista;
    for (const x of [p.x0 + 0.95, p.x1 - 0.95]) {
      const z = p.z0 + (p.z1 - p.z0) * 0.62;
      caja(r, 'plataforma', x - 0.7, x + 0.7, z - 0.7, z + 0.7, r.y0, 0.75, { walk: true, cx: x, cz: z });
      r.spots.tarima.push(spot(r, x, z, r.y0 + 0.75, 0, -1, { bailarina: true }));
    }
    const t = r.items.find((i) => i.t === 'tarima');
    for (const x of [t.x0 + 0.35, t.x1 - 0.35]) deco(r, 'humo', { x, z: t.z1 - 0.3, y: t.y + t.h });
  },
  /** Salsoteca de sótano: techo bajo, piso de madera, tarima con congas, timbales y piano, bola de espejos, afiches y acetatos. */
  salsoteca(r, rng) {
    const sh = r.shaft;
    // Barra en el muro derecho, desde el fondo hasta la boca de la escalera.
    barra(r, 1, r.Z0 + 3.4, sh.z0 - 0.5, { luz: 'cálida' });
    const tw = Math.min(6.4, r.X1 - r.X0 - 3.6);
    const cx = (r.X0 + r.X1 - 2.2) / 2;
    tarimaFondo(r, cx, tw, 2.6, 0.42, false);
    const ty = r.y0 + 0.42;
    deco(r, 'instrumentos', { set: 'salsa', x0: cx - tw / 2, x1: cx + tw / 2, z0: r.Z0, z1: r.Z0 + 2.6, y: ty });
    for (const [k, inst] of ['congas', 'timbales', 'piano', 'bajo', 'trompeta'].entries()) r.spots.tarima.push(spot(r, cx - tw / 2 + 0.7 + (k * (tw - 1.4)) / 4, r.Z0 + 1.2 + (k % 2) * 0.5, ty, 0, 1, { instrumento: inst }));
    r.cabina = { ...r.spots.tarima[0] };
    const pz0 = r.Z0 + 3.0;
    const pz1 = sh.z0 - 1.0;
    const px0 = r.X0 + 1.7;
    const px1 = Math.min(cx + 2.9, r.X1 - 2.95);
    pista(r, 'madera', px0, px1, pz0, pz1, rng);
    deco(r, 'bola', { x: (px0 + px1) / 2, z: (pz0 + pz1) / 2, y: r.y0 + r.H - 0.45 });
    // Mesitas contra el muro izquierdo y a los lados de la escalera.
    for (let z = r.Z0 + 3.4; z < sh.z0 - 0.6; z += 2.1) mesa(r, r.X0 + 0.75, z, 'madera', 2, 0.66);
    mesa(r, (r.X0 + sh.x0 - sh.wall) / 2, r.Z1 - 2.6, 'madera', 3, 0.66);
    banos(r, sh.x1 + sh.wall + 0.3, r.X1, r.Z1 - 2.5, r.Z1, 'z', -1);
    deco(r, 'afiches', {});
    r.spots.meseros.push(spot(r, cx, sh.z0 - 0.4, r.y0, 0, -1), spot(r, r.X0 + 1.8, r.Z0 + 4.4, r.y0, 0, 1));
  },
  /** Fonda paisa: fachadas de pueblito por dentro, mostrador, mesas de madera, frente de chiva con el animador, guirnaldas. */
  fonda(r, rng) {
    // Frente de chiva al fondo (maciza) y tarimita del animador delante.
    caja(r, 'chiva', -2.3, 2.3, r.Z0, r.Z0 + 1.25, r.y0, 2.9, { face: 1 });
    caja(r, 'tarima', -2.6, 2.6, r.Z0 + 1.25, r.Z0 + 2.6, r.y0, 0.35, { walk: true });
    const an = spot(r, 0.6, r.Z0 + 1.9, r.y0 + 0.35, 0, 1);
    r.spots.animador.push(an);
    r.spots.cabina.push(spot(r, -1.2, r.Z0 + 1.75, r.y0 + 0.35, 0, 1));
    r.cabina = { ...r.spots.cabina[0] };
    caja(r, 'cabina', -1.9, -0.5, r.Z0 + 2.05, r.Z0 + 2.5, r.y0 + 0.35, 1.0, { face: 1, kind: 'consola' });
    deco(r, 'casitas', {});
    // Mostrador de tienda de pueblo a la derecha.
    barra(r, 1, r.Z1 - 7.2, r.Z1 - 2.2, { luz: 'cálida', kind: 'mostrador' });
    pista(r, 'baldosa', -2.4, 2.4, r.Z0 + 3.0, r.Z0 + 7.6, rng);
    // Mesas de madera con aguardiente a los lados y adelante.
    for (const z of [r.Z0 + 3.6, r.Z0 + 6.0, r.Z0 + 8.4]) mesa(r, r.X0 + 1.15, z, 'madera', 4, 0.85);
    for (const z of [r.Z0 + 3.6, r.Z0 + 6.0]) mesa(r, r.X1 - 1.15, z, 'madera', 4, 0.85);
    mesa(r, -2.3, r.Z0 + 10.6, 'madera', 4, 0.85);
    banos(r, r.X0, r.X0 + 2.4, r.Z1 - 2.4, r.Z1, 'x', 1);
    deco(r, 'guirnaldas', { y: r.y0 + r.H - 0.35 });
    r.spots.meseros.push(spot(r, 0, r.Z0 + 9.0, r.y0, 0, -1), spot(r, r.X1 - 2.6, r.Z1 - 4.6, r.y0, -1, 0));
  },
  /** Bar de son cubano: palmas y plantas, ventiladores de techo, fotos enmarcadas, maracas y tres colgados, pista de madera. */
  son(r, rng) {
    barra(r, -1, r.Z0 + 3.4, r.Z1 - 3.4, { luz: 'cálida' });
    const cx = (r.X0 + 2.2 + r.X1) / 2;
    tarimaFondo(r, cx, Math.min(5.4, r.X1 - r.X0 - 3), 2.4, 0.45, false);
    const ty = r.y0 + 0.45;
    deco(r, 'instrumentos', { set: 'son', x0: cx - 2.5, x1: cx + 2.5, z0: r.Z0, z1: r.Z0 + 2.4, y: ty });
    for (const [k, inst] of ['tres', 'bongó', 'maracas', 'voz'].entries()) r.spots.tarima.push(spot(r, cx - 1.8 + k * 1.2, r.Z0 + 1.3, ty, 0, 1, { instrumento: inst }));
    r.cabina = { ...r.spots.tarima[3] };
    pista(r, 'madera', cx - 2.2, cx + 2.0, r.Z0 + 2.9, r.Z0 + 7.6, rng);
    for (const z of [r.Z0 + 3.4, r.Z0 + 5.6, r.Z0 + 7.8]) mesa(r, r.X1 - 0.95, z, 'redonda', 3, 0.7);
    mesa(r, 2.5, r.Z0 + 9.9, 'redonda', 3, 0.7);
    for (const [x, z] of [[r.X0 + 0.5, r.Z0 + 0.5], [r.X1 - 0.5, r.Z0 + 0.5], [r.X1 - 0.5, r.Z1 - 3.4], [r.X0 + 0.5, r.Z1 - 2.8], [r.X1 - 0.55, r.Z0 + 9.0]]) caja(r, 'planta', x - 0.32, x + 0.32, z - 0.32, z + 0.32, r.y0, 0.6, { cx: x, cz: z });
    for (const z of [r.Z0 + 4.2, r.Z0 + 8.6, r.Z1 - 3.5]) deco(r, 'ventilador', { x: (r.X0 + r.X1) / 2, z, y: r.y0 + r.H - 0.05 });
    banos(r, r.X1 - 2.4, r.X1, r.Z1 - 2.3, r.Z1, 'x', -1);
    deco(r, 'fotos', {});
    r.spots.meseros.push(spot(r, cx, r.Z0 + 8.6, r.y0, 0, -1), spot(r, r.X0 + 2.8, r.Z1 - 4, r.y0, 1, 0));
  },
  /** Bar de música popular / despecho tipo cantina: barra al fondo, rockola, billar, mesas de madera, TV con fútbol. */
  cantina(r, rng) {
    caja(r, 'barra', r.X0 + 1.3, r.X1, r.Z0 + 1.55, r.Z0 + 2.15, r.y0, 1.1, { face: 1, luz: 'cálida', kind: 'madera' });
    caja(r, 'estante', r.X0 + 1.3, r.X1, r.Z0, r.Z0 + 0.45, r.y0, 2.4, { face: 1 });
    for (let x = r.X0 + 1.8; x < r.X1 - 0.3; x += 0.8) {
      r.spots.barra.push(spot(r, x, r.Z0 + 2.6, r.y0, 0, -1));
      r.spots.bartender.push(spot(r, x, r.Z0 + 1.0, r.y0, 0, 1));
    }
    caja(r, 'rockola', r.X0, r.X0 + 0.62, r.Z0 + 3.4, r.Z0 + 4.3, r.y0, 1.55, { face: 1, eje: 'x' });
    caja(r, 'billar', 0.4 - 0.72, 0.4 + 0.72, r.Z0 + 4.6, r.Z0 + 7.1, r.y0, 0.84, { cx: 0.4, cz: r.Z0 + 5.85 });
    r.spots.mesas.push(spot(r, 1.5, r.Z0 + 5.0, r.y0, -1, 0, { billar: true }), spot(r, -0.9, r.Z0 + 6.8, r.y0, 1, 0, { billar: true }));
    for (const z of [r.Z1 - 3.3, r.Z1 - 5.4]) mesa(r, r.X1 - 1.0, z, 'madera', 4, 0.78);
    mesa(r, r.X0 + 1.0, r.Z1 - 5.4, 'madera', 4, 0.78);
    deco(r, 'tv', { x: r.X1 - 0.06, z: r.Z0 + 4.4, y: r.y0 + 2.3, eje: 'x', face: -1 });
    deco(r, 'canastas', { x: r.X1 - 0.5, z: r.Z0 + 3.0 });
    banos(r, r.X0, r.X0 + 1.9, r.Z1 - 2.3, r.Z1, 'x', 1);
    deco(r, 'afichesBar', {});
    r.cabina = spot(r, r.X0 + 0.9, r.Z0 + 3.85, r.y0, -1, 0, { rockola: true });
    r.spots.cabina.push(r.cabina);
    r.spots.meseros.push(spot(r, 0, r.Z1 - 4.2, r.y0, 0, -1));
  },
  /** Bar de esquina pequeño: mesas plásticas, rockola, avisos de neón de cerveza sin marca, TV, nevera. */
  esquina(r, rng) {
    caja(r, 'barra', r.X1 - 3.4, r.X1, r.Z0 + 1.5, r.Z0 + 2.1, r.y0, 1.08, { face: 1, luz: 'fría', kind: 'mostrador' });
    caja(r, 'nevera', r.X1 - 1.6, r.X1 - 0.2, r.Z0, r.Z0 + 0.7, r.y0, 1.95, { face: 1 });
    caja(r, 'estante', r.X1 - 3.4, r.X1 - 1.7, r.Z0, r.Z0 + 0.4, r.y0, 2.2, { face: 1 });
    for (let x = r.X1 - 3.0; x < r.X1 - 0.2; x += 0.8) {
      r.spots.barra.push(spot(r, x, r.Z0 + 2.55, r.y0, 0, -1));
      r.spots.bartender.push(spot(r, x, r.Z0 + 1.0, r.y0, 0, 1));
    }
    caja(r, 'rockola', r.X0 + 0.3, r.X0 + 1.2, r.Z0, r.Z0 + 0.62, r.y0, 1.55, { face: 1, eje: 'z' });
    r.cabina = spot(r, r.X0 + 0.75, r.Z0 + 1.1, r.y0, 0, -1, { rockola: true });
    r.spots.cabina.push(r.cabina);
    const cols = [r.X0 + 1.2, (r.X0 + r.X1) / 2, r.X1 - 1.2];
    // (Adelante quedan libres el paso de la puerta y los baños.)
    for (const [k, z] of [r.Z0 + 4.6, r.Z0 + 6.9, r.Z1 - 2.4].entries())
      for (const [j, x] of cols.entries()) if (!(k === 2 && j < 2)) mesa(r, x, z, 'plastico', 4, 0.72);
    pista(r, 'baldosa', r.X0 + 0.8, r.X1 - 0.8, r.Z0 + 2.6, r.Z0 + 3.9, rng);
    deco(r, 'tv', { x: r.X0 + 0.06, z: r.Z0 + 4.8, y: r.y0 + 2.25, eje: 'x', face: 1 });
    deco(r, 'neones', {});
    banos(r, r.X0, r.X0 + 1.9, r.Z1 - 2.1, r.Z1, 'x', 1);
    r.spots.meseros.push(spot(r, 0, r.Z0 + 5.2, r.y0, 0, -1));
  },
};
