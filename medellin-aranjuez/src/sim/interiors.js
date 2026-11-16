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
export const INTERIORES_ACTIVOS = true;

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
  // Local del día a día (v3.8): la huella PROPIA del edificio (no tumba
  // vecinos), solo el primer piso; el fondo lo pone el tema (COMERCIO_TEMAS).
  local: { ancho: 0, fondo: 12, alto: 3.0, pisos: 1, mezz: false, cover: 0, propia: true },
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

// ------------------------------------------------------------------ comercios (configurables)
/**
 * Locales del día a día a los que se entra (v3.8): tiendas de barrio,
 * panaderías, droguerías, cacharrerías, papelerías, comidas y almacenes de
 * ropa. Usan la huella propia del edificio (TAMANOS.local) y abren de día.
 */
export const COMERCIO = {
  /** Locales genéricos (avisos de facades.js SHOPS) que se vuelven accesibles, por tema; la suma es el total. */
  CUPOS: { tienda: 6, panaderia: 3, drogueria: 2, cacharreria: 1, papeleria: 2 },
  /** Calles donde se escogen los genéricos (las comerciales de cityLayout.js). */
  CALLES: ['Calle 92', 'Carrera 51', 'Carrera 52'],
  /** Distancia mínima (m) entre dos locales accesibles (genéricos con cualquiera). */
  SEPARACION: 14,
  /** Medidas mínimas del edificio (m): frente y fondo. */
  ANCHO_MIN: 4.8,
  FONDO_MIN: 4.8,
  /** m que debe quedar entre la casa y el borde del mapa jugable (más allá el jugador no llega). */
  MARGEN_MAPA: 4,
  /** Desnivel máximo (m) del andén a lo largo del frente de un genérico (los de la loma muy parada se quedan con su vitrina). */
  DESNIVEL_MAX: 0.6,
  /** Alto libre (m) bajo el techo del local: lo menos entre esto y el primer piso menos MARGEN_TECHO. */
  ALTO: 3.0,
  MARGEN_TECHO: 0.2,
  /** Alto (m) del vano de la vitrina (facades.js FACADE.shopH): la puerta del local. */
  PUERTA_ALTO: 2.65,
  /** Locales con nombre que NO se abren (la historia los usa por fuera: la abuela se sienta en su silla). */
  EXCLUIDOS: ['abuela'],
  /** m: a esta distancia del punto del mostrador (o del espejo de los almacenes) se compra (o se prueba la ropa) con E. */
  RANGO_COMPRA: 1.35,
  RANGO_ESPEJO: 1.0,
};

/** Horario (horas del día, [abre, cierra)) por tema; de noche, cortina abajo. */
export const HORARIOS = {
  tienda: [6, 22],
  panaderia: [5, 20],
  almacen: [9, 20],
  comidas: [10, 24],
  drogueria: [7, 21],
  cacharreria: [8, 19],
  papeleria: [7, 19],
};

/** Fondo (m) que usa cada tema (lo de atrás de la casa queda macizo, como bodega). */
export const COMERCIO_TEMAS = {
  tienda: { fondo: 6.4 },
  panaderia: { fondo: 7.2 },
  comidas: { fondo: 8.2 },
  almacen: { fondo: 11 },
  drogueria: { fondo: 6.2 },
  cacharreria: { fondo: 8 },
  papeleria: { fondo: 6.2 },
};

/** Tema por tipo de aviso (segundo campo de facades.js SHOPS / LOCALES). */
export const TEMA_POR_TIPO = { tienda: 'tienda', panaderia: 'panaderia', drogueria: 'drogueria', ferreteria: 'cacharreria', papeleria: 'papeleria', cafeteria: 'comidas', heladeria: 'comidas', ropa: 'almacen' };

/** Locales con nombre de cityLayout.js LOCAL_SPOTS que se abren (id -> tema y variante). */
export const PLANES_LOCAL = {
  mandingas92: { tema: 'comidas', variante: 'papas' },
  granizados92: { tema: 'comidas', variante: 'granizados' },
  arriero: { tema: 'almacen', variante: 'paisa' },
  silletera: { tema: 'almacen', variante: 'paisa' },
  talabarteria: { tema: 'almacen', variante: 'cuero' },
  modapaisa: { tema: 'almacen', variante: 'moda' },
  boutique92: { tema: 'almacen', variante: 'moda' },
  remates: { tema: 'almacen', variante: 'moda' },
  deportes: { tema: 'almacen', variante: 'deportes' },
  gorras52: { tema: 'almacen', variante: 'deportes' },
};

/**
 * Lo que se vende en los genéricos (los de nombre usan el menú o el surtido
 * de su lugar). `cosa`: no es de comer (se paga y ya: game/Game.js buy).
 */
export const MENUS_COMERCIO = {
  tienda: [
    { id: 'gaseosa', name: 'Gaseosa fría', desc: 'De la nevera de vidrio', price: 15, heal: 10 },
    { id: 'panbocadillo', name: 'Pan con bocadillo', desc: 'El algo de la tarde', price: 12, heal: 10 },
    { id: 'papitas', name: 'Paquete de papitas', desc: 'De la tira de mecato', price: 10, heal: 6 },
    { id: 'cerveza', name: 'Cerveza fría', desc: 'Pa acompañar el dominó', price: 25, heal: 5 },
  ],
  panaderia: [
    { id: 'pandebono', name: 'Pandebono', desc: 'Calientico, recién salido', price: 20, heal: 15 },
    { id: 'bunuelo', name: 'Buñuelo', desc: 'Redondito y dorado', price: 20, heal: 15 },
    { id: 'pandequeso', name: 'Pan de queso', desc: 'Del horno de la mañana', price: 15, heal: 12 },
    { id: 'tinto', name: 'Tinto', desc: 'De la greca', price: 10, heal: 5 },
  ],
  comidas: [
    { id: 'empanada', name: 'Empanada con ají', desc: 'De papa y carne', price: 15, heal: 12 },
    { id: 'arepa', name: 'Arepa con quesito', desc: 'De la plancha', price: 25, heal: 20 },
    { id: 'jugo', name: 'Jugo en agua', desc: 'De mora o de lulo', price: 20, heal: 12 },
  ],
  drogueria: [
    { id: 'acetaminofen', name: 'Acetaminofén', desc: 'Pa el dolor de cabeza', price: 20, heal: 15 },
    { id: 'curitas', name: 'Curitas y yodo', desc: 'Pa los raspones de la calle', price: 25, heal: 20 },
    { id: 'suero', name: 'Suero oral', desc: 'Pa reponerse', price: 30, heal: 25 },
  ],
  cacharreria: [
    { id: 'linterna', name: 'Linterna de pilas', desc: 'Pa cuando se va la luz', price: 35, cosa: true },
    { id: 'balde', name: 'Balde plástico', desc: 'Del rojo, el que no se rompe', price: 20, cosa: true },
    { id: 'pito', name: 'Pito de árbitro', desc: 'Pa el picadito de la cancha', price: 8, cosa: true },
  ],
  papeleria: [
    { id: 'minutos', name: 'Minutos a celular', desc: 'A cualquier operador', price: 5, cosa: true },
    { id: 'fotocopias', name: 'Fotocopias', desc: 'Blanco y negro, a doble cara', price: 3, cosa: true },
    { id: 'cuaderno', name: 'Cuaderno cuadriculado', desc: 'De cien hojas', price: 25, cosa: true },
    { id: 'chicles', name: 'Chicles', desc: 'De a dos por cien', price: 5, heal: 2 },
  ],
};

/** Rótulo de la tienda en la ventana de compra (main.js), por tema. */
export const RUBROS = { tienda: 'Tienda de barrio', panaderia: 'Panadería', comidas: 'Comidas', almacen: 'Almacén de ropa', drogueria: 'Droguería', cacharreria: 'Cacharrería', papeleria: 'Papelería y minutos' };

/** ¿El interior `r` está abierto a la hora `h`? (los comercios por su horario; las discotecas de noche). */
export function abiertoA(r, h) {
  const hr = r?.horario;
  if (!hr) return localAbierto(h);
  const [a, b] = hr;
  const x = ((h % 24) + 24) % 24;
  return a <= b ? x >= a && x < b : x >= a || x < b;
}

/**
 * Qué atiende la tecla E en (x, z) adentro del comercio `r`: 'espejo' (frente
 * al espejo de un almacén, a probarse), 'mostrador' (a comprar) o null.
 */
export function puntoCompra(r, x, z) {
  const e = r?.spots?.espejo?.[0];
  if (e && r.store && Math.hypot(e.x - x, e.z - z) < COMERCIO.RANGO_ESPEJO) return 'espejo';
  const m = r?.spots?.mostrador?.[0];
  if (m && Math.hypot(m.x - x, m.z - z) < COMERCIO.RANGO_COMPRA) return 'mostrador';
  return null;
}

/** Plan de un comercio: tema, variante y tamaño 'local' (null si el tipo no tiene interior). */
export function planComercio(id, kind) {
  const p = PLANES_LOCAL[id];
  if (p) return { ...p, tam: 'local' };
  const tema = TEMA_POR_TIPO[kind];
  return tema ? { tema, variante: null, tam: 'local' } : null;
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
  if (plan.tam === 'local') return armarLocal(b, L, plan);
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
  // Muchos locales regados por el barrio (los comercios): rejilla de celdas
  // para no revisar todos en cada consulta de altura (las hace cada peatón).
  const cs = CELDA_CAMINABLE;
  const cells = rooms.length > 8 ? new Map() : null;
  if (cells)
    for (const r of rooms)
      for (let i = Math.floor(r.minX / cs); i <= Math.floor(r.maxX / cs); i++)
        for (let j = Math.floor(r.minZ / cs); j <= Math.floor(r.maxZ / cs); j++) {
          const k = i * 4096 + j;
          if (!cells.has(k)) cells.set(k, []);
          cells.get(k).push(r);
        }
  const NONE = [];
  return {
    minX,
    maxX,
    minZ,
    maxZ,
    over: false,
    room: true,
    interiors: rooms,
    height(x, z, y = null) {
      const list = cells ? (cells.get(Math.floor(x / cs) * 4096 + Math.floor(z / cs)) ?? NONE) : rooms;
      for (const r of list) {
        if (x < r.minX || x > r.maxX || z < r.minZ || z > r.maxZ) continue;
        aLocal(r, x, z, p);
        const h = alturaInterior(r, p.x, p.z, y);
        if (h !== null) return h;
      }
      return null;
    },
  };
}
/** Lado (m) de las celdas de la rejilla de caminableInteriores. */
const CELDA_CAMINABLE = 16;

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

// ------------------------------------------------------------------ comercios: distribución
// Los del día a día (TAMANOS.local): la huella propia del edificio, la puerta
// es el vano de la vitrina de la fachada (facades.js) y el tema reparte el
// mostrador, las estanterías y lo demás sin tapar el paso de la puerta al
// mostrador. `spots`: tendero (detrás del mostrador), mostrador (donde se
// compra con E), clientes (comprando, conversando, sentados o mirando ropa)
// y espejo (el de los almacenes: probarse la ropa).

/** Medidas comunes de los comercios (m). */
const CM = {
  /** Franja libre detrás de la fachada frente a la puerta. */
  ENTRADA: 1.0,
  /** Media anchura del camino de la puerta al mostrador. */
  CAMINO: 0.5,
  /** Fondo del mostrador y paso del tendero en un extremo. */
  MOSTRADOR: 0.62,
  PASO: 0.85,
  /** Fondo de las estanterías de pared. */
  ESTANTE: 0.42,
};

/**
 * Arma el interior de un comercio en la huella propia de `b` (ya asentado).
 * `L` = {id, name, kind, menu?, store?, poi?}; `plan` = {tema, variante,
 * puerta: {x0, x1}} (el vano de la vitrina en x local, ver cityLayout.js).
 */
export function armarLocal(b, L, plan) {
  const f = b.frame;
  const T = INTERIOR.MURO;
  const tema = COMERCIO_TEMAS[plan.tema] ?? COMERCIO_TEMAS.tienda;
  const W = 2 * f.hu;
  const D = Math.min(2 * f.hv, tema.fondo);
  const floorY = b.groundY;
  const H = Math.min(COMERCIO.ALTO, b.topY - floorY - COMERCIO.MARGEN_TECHO);
  const pu = plan.puerta ?? { x0: -1.1, x1: 1.1 };
  const r = {
    id: L.id,
    name: L.name,
    tema: plan.tema,
    variante: plan.variante ?? null,
    tam: 'local',
    kind: L.kind ?? null,
    cover: 0,
    horario: HORARIOS[plan.tema] ?? HORARIOS.tienda,
    cortina: plan.cortina ?? 4, // color de la cortina metálica (facades.js METAL_COLORS)
    menu: L.menu ?? null,
    store: L.store ?? null,
    poi: L.poi ?? null,
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
    y0: floorY,
    H,
    baseY: b.baseY,
    topY: b.topY,
    door: { x0: Math.max(-f.hu + T + 0.05, pu.x0), x1: Math.min(f.hu - T - 0.05, pu.x1), h: Math.min(COMERCIO.PUERTA_ALTO, H - 0.05) },
    mezz: null,
    stairs: [],
    landing: null,
    shaft: null,
    items: [],
    spots: { tendero: [], mostrador: [], clientes: [], espejo: [] },
    pista: null,
    cabina: null,
    minX: b.minX,
    maxX: b.maxX,
    minZ: b.minZ,
    maxZ: b.maxZ,
  };
  // Lo que no se puede tapar: la entrada y el camino al mostrador (se borra al final).
  r._libre = [{ x0: r.door.x0 - 0.25, x1: r.door.x1 + 0.25, z0: r.Z1 - CM.ENTRADA, z1: r.Z1 }];
  const rng = makeRng(hash(L.id) || 1);
  (TEMAS_LOCAL[plan.tema] ?? TEMAS_LOCAL.tienda)(r, rng);
  // Tubos fluorescentes del cielo raso: uno cada ~2,4 m de fondo.
  const n = Math.max(1, Math.round((r.Z1 - r.Z0) / 2.4));
  for (let k = 0; k < n; k++) deco(r, 'tubo', { x: 0, z: r.Z0 + ((k + 0.5) * (r.Z1 - r.Z0)) / n, y: r.y0 + r.H, largo: Math.min(1.2, r.X1 - r.X0 - 1) });
  delete r._libre;
  return r;
}

/** ¿El rectángulo (local) está libre de lo macizo y de lo reservado? */
function libre(r, x0, x1, z0, z1) {
  if (x0 < r.X0 - 1e-6 || x1 > r.X1 + 1e-6 || z0 < r.Z0 - 1e-6 || z1 > r.Z1 + 1e-6) return false;
  const hit = (o) => x0 < o.x1 - 0.02 && x1 > o.x0 + 0.02 && z0 < o.z1 - 0.02 && z1 > o.z0 + 0.02;
  for (const o of r._libre) if (hit(o)) return false;
  for (const it of r.items) if (it.solid && hit(it)) return false;
  return true;
}

/** Rectángulo de ancho `a` (x) contra el muro lateral `lado` (-1 = X0, +1 = X1), de z0 a z1. */
function contraMuro(r, lado, a, z0, z1) {
  return lado < 0 ? [r.X0, r.X0 + a, z0, z1] : [r.X1 - a, r.X1, z0, z1];
}

/** Pone el primer candidato libre ([x0, x1, z0, z1, extra]); devuelve el ítem o null. */
function poner(r, t, cands, y, h, extra = {}) {
  for (const c of cands) {
    if (!c || !libre(r, c[0], c[1], c[2], c[3])) continue;
    return caja(r, t, c[0], c[1], c[2], c[3], y, h, { ...extra, ...(c[4] ?? {}) });
  }
  return null;
}

/**
 * Mostrador de lado a lado (con el paso del tendero en el extremo lejos de la
 * puerta), estantería de fondo y de los costados detrás, y los puntos del
 * tendero y de la compra. o = {cliente: fondo del área de clientes, alto,
 * frente: casilla del frente (render), encima, fondo, costados, prod}.
 */
function mostradorAlFrente(r, o = {}) {
  const prof = r.Z1 - r.Z0;
  const cliente = Math.max(1.9, Math.min(o.cliente ?? 3.0, prof - CM.MOSTRADOR - 1.05 - CM.ESTANTE));
  const cz1 = r.Z1 - cliente;
  const cz0 = cz1 - CM.MOSTRADOR;
  const dc = (r.door.x0 + r.door.x1) / 2;
  const s = dc <= 0 ? 1 : -1;
  const mx0 = s > 0 ? r.X0 : r.X0 + CM.PASO;
  const mx1 = s > 0 ? r.X1 - CM.PASO : r.X1;
  caja(r, 'mostrador', mx0, mx1, cz0, cz1, r.y0, o.alto ?? 1.0, { dir: [0, 1], frente: o.frente ?? 'vitrina-dulces', encima: o.encima ?? null, kind: o.kind ?? 'madera' });
  // La tablilla del paso (se levanta para pasar): solo dibujo.
  deco(r, 'tablilla', { x0: s > 0 ? mx1 : r.X0, x1: s > 0 ? r.X1 : mx0, z0: cz0, z1: cz1, y: r.y0 + (o.alto ?? 1.0) });
  const zb = r.Z0 + CM.ESTANTE;
  if (o.fondo !== false) caja(r, 'estante', r.X0, r.X1, r.Z0, zb, r.y0, Math.min(2.35, r.H - 0.3), { dir: [0, 1], tex: o.fondo ?? ['gondola-viveres', 'gondola-mecato'], prod: o.prod ?? 'viveres' });
  // Costados detrás del mostrador (si queda fondo).
  if (o.costados !== false && cz0 - zb > 0.9)
    for (const lado of [-1, 1]) {
      const [x0, x1] = contraMuro(r, lado, 0.36, 0, 0);
      caja(r, 'estante', x0, x1, zb, cz0 - 0.08, r.y0, Math.min(2.2, r.H - 0.4), { dir: [-lado, 0], tex: o.costados ?? ['gondola-mecato'], prod: o.prod ?? 'viveres' });
    }
  const px = Math.max(mx0 + 0.55, Math.min(mx1 - 0.55, dc));
  r.spots.tendero.push(spot(r, px, cz0 - 0.5, r.y0, 0, 1));
  r.spots.mostrador.push(spot(r, px, cz1 + 0.5, r.y0, 0, -1));
  // El camino de la puerta al mostrador queda libre.
  r._libre.push({ x0: Math.min(px, dc) - CM.CAMINO, x1: Math.max(px, dc) + CM.CAMINO, z0: cz1, z1: r.Z1 });
  return { cz0, cz1, mx0, mx1, s, px, zb };
}

/** Clientes junto al mostrador: uno comprando (al lado del punto de compra) y una que conversa. */
function clientesMostrador(r, m) {
  const pts = [];
  for (const dx of [0.75, -0.75, 1.4, -1.4]) {
    const x = m.px + dx;
    if (x < m.mx0 + 0.3 || x > m.mx1 - 0.3) continue;
    pts.push(x);
  }
  if (pts[0] !== undefined) r.spots.clientes.push(spot(r, pts[0], m.cz1 + 0.42, r.y0, 0, -1, { rol: 'compra' }));
  if (pts[1] !== undefined) r.spots.clientes.push(spot(r, pts[1], m.cz1 + 0.62, r.y0, (m.px - pts[1]) * 0.6, -1, { rol: 'charla', female: true }));
}

/** Mesa plástica con dos sillas (y dominó encima si `domino`) contra un muro del área de clientes. */
function mesaClientes(r, m, rng, o = {}) {
  const zc0 = m.cz1 + 0.25;
  const zc1 = r.Z1 - 0.15;
  for (const lado of o.lados ?? [1, -1]) {
    for (let z = zc0; z + 1.8 <= zc1; z += 0.3) {
      const [x0, x1] = contraMuro(r, lado, 0.82, 0, 0);
      if (!libre(r, x0, x1, z, z + 1.8)) continue;
      const cx = (x0 + x1) / 2 + lado * 0.04;
      const cz = z + 0.9;
      caja(r, 'mesa', cx - 0.36, cx + 0.36, cz - 0.36, cz + 0.36, r.y0, 0.72, { kind: o.kind ?? 'plastico', domino: !!o.domino, cx, cz, color: rng.int(0, 2) });
      for (const sz of [-1, 1]) {
        caja(r, 'silla', cx - 0.22, cx + 0.22, cz + sz * 0.62 - 0.22, cz + sz * 0.62 + 0.22, r.y0, 0.46, { kind: o.kind ?? 'plastico', cx, cz: cz + sz * 0.62, dir: [0, -sz], color: rng.int(0, 2) });
        r.spots.clientes.push(spot(r, cx, cz + sz * 0.62, r.y0, 0, -sz, { rol: 'mesa', sit: true }));
      }
      return true;
    }
  }
  return false;
}

/**
 * Mesas plásticas en el medio del área de clientes (los locales anchos, como
 * Mandingas): de a una con dos sillas frente a frente, sin tapar la entrada ni
 * el camino al mostrador. Devuelve cuántas puso (hasta `max`).
 */
function mesasCentro(r, m, rng, max = 4, o = {}) {
  if (r.Z1 - m.cz1 < 2.7) return 0;
  const cz = Math.min(r.Z1 - 1.1, (m.cz1 + r.Z1) / 2 + 0.2);
  // (Delante del mostrador queda el sitio del que compra y de la que conversa.)
  r._libre.push({ x0: m.px - 1.7, x1: m.px + 1.7, z0: m.cz1, z1: m.cz1 + 0.95 });
  let n = 0;
  for (let cx = r.X0 + 1.3; cx <= r.X1 - 1.3 && n < max; cx += 0.25) {
    if (!libre(r, cx - 0.62, cx + 0.62, cz - 1.0, cz + 1.0)) continue;
    caja(r, 'mesa', cx - 0.36, cx + 0.36, cz - 0.36, cz + 0.36, r.y0, 0.72, { kind: o.kind ?? 'plastico', domino: false, cx, cz, color: rng.int(0, 2) });
    for (const sz of [-1, 1]) {
      caja(r, 'silla', cx - 0.22, cx + 0.22, cz + sz * 0.62 - 0.22, cz + sz * 0.62 + 0.22, r.y0, 0.46, { kind: o.kind ?? 'plastico', cx, cz: cz + sz * 0.62, dir: [0, -sz], color: rng.int(0, 2) });
      r.spots.clientes.push(spot(r, cx, cz + sz * 0.62, r.y0, 0, -sz, { rol: 'mesa', sit: true }));
    }
    n++;
    cx += 1.4;
  }
  return n;
}

/** Candidatos contra los dos muros del área de clientes (el más cercano al mostrador primero). */
function contraMuros(r, m, a, l, lados = [-m.s, m.s]) {
  const out = [];
  for (const lado of lados) for (let z = m.cz1 + 0.08; z + l <= r.Z1 - 0.1; z += 0.25) out.push([...contraMuro(r, lado, a, z, z + l), { lado, dir: [-lado, 0] }]);
  return out;
}

export const TEMAS_LOCAL = {
  /** Tienda de barrio: mostrador con vitrina de dulces y balanza, víveres hasta el techo, nevera de gaseosas, bultos, plátanos, canastas, dominó, altar y televisor. */
  tienda(r, rng) {
    const m = mostradorAlFrente(r, { cliente: 3.0, frente: 'vitrina-dulces', encima: ['balanza', 'frascos', 'registradora'] });
    poner(r, 'nevera', contraMuros(r, m, 0.72, 0.72), r.y0, 1.95);
    poner(r, 'canastas', contraMuros(r, m, 0.46, 0.36), r.y0, 1.2, { n: rng.int(3, 4) });
    poner(r, 'bultos', [[m.mx1 - 1.0, m.mx1 - 0.1, m.cz1 + 0.04, m.cz1 + 0.55], [m.mx0 + 0.1, m.mx0 + 1.0, m.cz1 + 0.04, m.cz1 + 0.55], ...contraMuros(r, m, 0.55, 0.9)], r.y0, 0.6);
    mesaClientes(r, m, rng, { domino: true });
    clientesMostrador(r, m);
    // Colgados: plátanos sobre el paso, tiras de mecato frente al mostrador; altar y televisor arriba.
    deco(r, 'platanos', { x: m.s > 0 ? m.mx1 + 0.35 : m.mx0 - 0.35, z: m.cz1 - 0.15, y: r.y0 + r.H });
    for (const dx of [-1.1, 0.9]) if (m.px + dx > m.mx0 + 0.3 && m.px + dx < m.mx1 - 0.3) deco(r, 'tiraMecato', { x: m.px + dx, z: m.cz0 + 0.1, y: r.y0 + r.H });
    deco(r, 'altar', { x: m.s > 0 ? r.X1 - 0.5 : r.X0 + 0.5, z: r.Z0 + CM.ESTANTE + 0.02, y: r.y0 + Math.min(2.45, r.H - 0.5) });
    deco(r, 'tv', { x: m.s > 0 ? r.X0 + 0.32 : r.X1 - 0.32, z: m.cz1 - 0.1, y: r.y0 + Math.min(2.15, r.H - 0.65), mira: [m.s * 0.7, 0.7] });
    deco(r, 'afiche', { tex: 'afiche', x: m.px, z: r.Z0 + 0.03, y: r.y0 + Math.min(2.45, r.H - 0.45), w: 0.9, h: 0.4, dir: [0, 1] });
    deco(r, 'zocalo', { tex: 'baldosaPared', h: 1.0 });
  },
  /** Panadería: vitrinas con pan y buñuelos, horno, latas de hornear, greca de tinto y mesitas. */
  panaderia(r, rng) {
    const m = mostradorAlFrente(r, { cliente: 3.1, alto: 1.15, frente: 'vitrina-pan', encima: ['greca', 'canastaPan'], fondo: false, costados: ['vitrina-pan'], prod: 'pan' });
    // Fondo: horno a un lado, carro de latas y estantería de pan.
    const hx = m.s > 0 ? r.X0 : r.X1 - 1.25;
    caja(r, 'horno', hx, hx + 1.25, r.Z0, r.Z0 + 0.85, r.y0, 1.7, { dir: [0, 1] });
    const bx = m.s > 0 ? r.X0 + 1.35 : r.X1 - 1.95;
    caja(r, 'bandejas', bx, bx + 0.6, r.Z0 + 0.05, r.Z0 + 0.5, r.y0, 1.75, { dir: [0, 1] });
    const ex0 = m.s > 0 ? r.X0 + 2.05 : r.X0;
    const ex1 = m.s > 0 ? r.X1 : r.X1 - 2.05;
    if (ex1 - ex0 > 0.8) caja(r, 'estante', ex0, ex1, r.Z0, r.Z0 + CM.ESTANTE, r.y0, Math.min(2.3, r.H - 0.3), { dir: [0, 1], tex: ['back:panaderia'], prod: 'pan' });
    for (let k = 0; k < 2; k++) if (!mesaClientes(r, m, rng, { kind: 'metal' })) break;
    clientesMostrador(r, m);
    deco(r, 'afiche', { tex: 'menuPanaderia', x: (ex0 + ex1) / 2, z: r.Z0 + CM.ESTANTE + 0.02, y: r.y0 + Math.min(2.55, r.H - 0.35), w: 1.5, h: 0.5, dir: [0, 1] });
    deco(r, 'zocalo', { tex: 'baldosaPared', h: 1.3 });
  },
  /** Comidas (Mandingas, granizados, cafeterías): barra con la cocina detrás (plancha, freidora y campana), menú pintado, barra de pared con butacas. */
  comidas(r, rng) {
    const gran = r.variante === 'granizados';
    const m = mostradorAlFrente(r, { cliente: 3.2, alto: 1.05, frente: gran ? 'vitrina-helado' : 'vitrina-comida', encima: gran ? ['licuadoras', 'vasos'] : ['salsas', 'vitrinaComida', 'servilletero'], fondo: false, costados: false, kind: 'acero' });
    // La cocina contra el fondo (o la máquina de granizados, el congelador y la licuadora).
    caja(r, 'cocina', r.X0, r.X1, r.Z0, r.Z0 + 0.72, r.y0, 0.92, { dir: [0, 1], kind: gran ? 'granizados' : 'frituras' });
    deco(r, 'campana', { x0: r.X0 + 0.3, x1: Math.min(r.X1 - 0.3, r.X0 + 2.6), z0: r.Z0, z1: r.Z0 + 0.8, y: r.y0 + 1.95 });
    deco(r, 'afiche', { tex: gran ? 'menuGranizados' : r.variante === 'papas' ? 'menuPapas' : 'menuComidas', x: (r.X0 + r.X1) / 2 + (r.X1 - r.X0) * 0.18, z: r.Z0 + 0.03, y: r.y0 + Math.min(2.6, r.H - 0.3), w: Math.min(2.2, (r.X1 - r.X0) * 0.55), h: 0.85, dir: [0, 1] });
    poner(r, 'nevera', contraMuros(r, m, 0.72, 0.72, [m.s, -m.s]), r.y0, 1.95);
    // Barra de pared con butacas altas.
    const barra = poner(r, 'barraPared', contraMuros(r, m, 0.38, Math.min(2.4, r.Z1 - m.cz1 - 1.4)), r.y0, 1.05);
    if (barra) {
      const lado = barra.lado;
      const n = Math.max(2, Math.floor((barra.z1 - barra.z0) / 0.62));
      for (let k = 0; k < n; k++) {
        const z = barra.z0 + ((k + 0.5) * (barra.z1 - barra.z0)) / n;
        const x = lado < 0 ? barra.x1 + 0.32 : barra.x0 - 0.32;
        deco(r, 'butaca', { x, z, y: r.y0 });
        // (De pie, recostado a la barra: la pose de sentado es la de una silla baja.)
        if (k === 0) r.spots.clientes.push(spot(r, x - lado * 0.12, z, r.y0, lado, 0, { rol: 'barra' }));
      }
    }
    // Mesas plásticas en lo que quede (las de los locales anchos, como Mandingas, se llenan de mesas).
    for (let k = 0; k < 3; k++) if (!mesaClientes(r, m, rng, {})) break;
    mesasCentro(r, m, rng, 4);
    clientesMostrador(r, m);
    // Televisor en la esquina del área de clientes y, en los anchos, otro tablero con los jugos.
    deco(r, 'tv', { x: m.s > 0 ? r.X0 + 0.32 : r.X1 - 0.32, z: m.cz1 + 0.4, y: r.y0 + Math.min(2.2, r.H - 0.6), mira: [m.s * 0.75, 0.66] });
    // (El mismo menú que se compra: Mandingas no vende empanadas.)
    if (r.X1 - r.X0 > 8.5) deco(r, 'afiche', { tex: gran ? 'menuGranizados' : r.variante === 'papas' ? 'menuPapas' : 'menuComidas', x: (r.X0 + r.X1) / 2 - (r.X1 - r.X0) * 0.25, z: r.Z0 + 0.03, y: r.y0 + Math.min(2.6, r.H - 0.3), w: 1.7, h: 0.85, dir: [0, 1] });
    deco(r, 'zocalo', { tex: 'baldosaPared', h: 1.4 });
  },
  /** Almacén de ropa: percheros con ponchos, ruanas y camisas, repisas (sombreros, carrieles, gorras, tenis), maniquíes, espejo, vestier y mostrador al fondo. */
  almacen(r, rng) {
    const v = r.variante ?? 'moda';
    // Mostrador al fondo (la vendedora detrás) y el vestier en la esquina.
    const dc = (r.door.x0 + r.door.x1) / 2;
    const s = dc <= 0 ? 1 : -1; // el vestier, del lado contrario a la puerta
    const vx0 = s > 0 ? r.X1 - 1.15 : r.X0;
    caja(r, 'vestier', vx0, vx0 + 1.15, r.Z0, r.Z0 + 1.15, r.y0, 2.25, { dir: [0, 1] });
    const mx0 = s > 0 ? r.X0 + 0.35 : r.X0 + 1.45;
    const mx1 = s > 0 ? r.X1 - 1.45 : r.X1 - 0.35;
    const cz0 = r.Z0 + 1.05;
    const cz1 = cz0 + 0.58;
    caja(r, 'mostrador', mx0, mx1, cz0, cz1, r.y0, 1.0, { dir: [0, 1], frente: v === 'deportes' ? 'gorras' : 'ropa-doblada', encima: ['registradora', 'bolsas'], kind: 'madera' });
    const tex = { paisa: 'sombreros', cuero: 'carrieles', deportes: 'gorras', moda: 'ropa' }[v];
    deco(r, 'repisa', { x0: s > 0 ? r.X0 : r.X0 + 1.2, x1: s > 0 ? r.X1 - 1.2 : r.X1, z: r.Z0, y: r.y0, h: Math.min(2.4, r.H - 0.3), que: tex, dir: [0, 1] });
    const px = Math.max(mx0 + 0.55, Math.min(mx1 - 0.55, dc));
    r.spots.tendero.push(spot(r, px, cz0 - 0.48, r.y0, 0, 1, { vendedora: true }));
    r.spots.mostrador.push(spot(r, px, cz1 + 0.5, r.y0, 0, -1));
    r._libre.push({ x0: Math.min(px, dc) - CM.CAMINO, x1: Math.max(px, dc) + CM.CAMINO, z0: cz1, z1: r.Z1 });
    // El espejo en el muro del lado del vestier, a media sala; el punto para probarse, delante.
    const zA = cz1 + 0.5;
    const zB = r.Z1 - CM.ENTRADA - 0.2;
    const zm = Math.max(zA + 0.6, Math.min(zB - 0.6, (zA + zB) / 2));
    const ex = s > 0 ? r.X1 : r.X0;
    deco(r, 'espejo', { x: ex - s * 0.02, z0: zm - 0.42, z1: zm + 0.42, y: r.y0 + 0.15, h: 1.85, dir: [-s, 0] });
    r.spots.espejo.push(spot(r, ex - s * 1.35, zm, r.y0, s, 0));
    r._libre.push({ x0: Math.min(ex, ex - s * 1.6), x1: Math.max(ex, ex - s * 1.6), z0: zm - 0.5, z1: zm + 0.5 });
    // Percheros contra el otro muro y repisa del lado del espejo (por tramos libres).
    const telas = { paisa: ['poncho', 'ruana', 'camisa'], cuero: ['camisa', 'poncho'], deportes: ['camiseta', 'sudadera'], moda: ['camiseta', 'camisa', 'buso'] }[v];
    for (let z = zA; z + 1.2 <= zB; z += 0.3) {
      const z1 = Math.min(zB, z + 3.2);
      const [x0, x1] = contraMuro(r, -s, 0.62, 0, 0);
      if (z1 - z < 1.2 || !libre(r, x0, x1, z, z1)) continue;
      caja(r, 'perchero', x0, x1, z, z1, r.y0, 1.75, { dir: [s, 0], telas, pared: true });
      r.spots.clientes.push(spot(r, -s * 0.2 + (s > 0 ? x1 + 0.55 : x0 - 0.55), (z + z1) / 2, r.y0, -s, 0, { rol: 'mira', female: true }));
      z = z1;
    }
    for (const [za, zb] of [[zA, zm - 0.55], [zm + 0.55, zB]]) {
      if (zb - za < 0.8) continue;
      const [x0, x1] = contraMuro(r, s, 0.4, 0, 0);
      if (libre(r, x0, x1, za, zb)) caja(r, 'estante', x0, x1, za, zb, r.y0, Math.min(2.1, r.H - 0.5), { dir: [-s, 0], tex: [v === 'deportes' ? 'gorras' : 'ropa-doblada'], prod: v === 'paisa' || v === 'cuero' ? 'sombreros' : v === 'deportes' ? 'tenis' : 'ropa' });
    }
    // Perchero del medio (si cabe sin tapar el camino) y maniquíes junto a la vitrina.
    const cw = r.X1 - r.X0;
    if (cw > 5.8) {
      for (const cx of [0, -0.6, 0.6, -1.1, 1.1]) {
        const z0 = zA + 0.3;
        const z1 = Math.min(zB - 0.2, z0 + 2.6);
        if (z1 - z0 > 1.4 && libre(r, cx - 0.32, cx + 0.32, z0, z1)) {
          caja(r, 'perchero', cx - 0.32, cx + 0.32, z0, z1, r.y0, 1.6, { dir: [1, 0], telas, doble: true });
          break;
        }
      }
    }
    let nm = 0;
    for (const x of [r.door.x0 - 0.55, r.door.x1 + 0.55, r.X0 + 0.5, r.X1 - 0.5]) {
      if (nm >= 2) break;
      const z = r.Z1 - 0.55;
      if (x - 0.3 < r.X0 || x + 0.3 > r.X1) continue;
      if (r.items.some((it) => it.t === 'maniqui' && Math.abs(it.cx - x) < 0.8)) continue;
      // (Los maniquíes van junto a la vitrina, fuera de la franja de la puerta.)
      if (x + 0.3 > r.door.x0 - 0.05 && x - 0.3 < r.door.x1 + 0.05) continue;
      if (!r.items.every((it) => !it.solid || x + 0.3 <= it.x0 || x - 0.3 >= it.x1 || z + 0.3 <= it.z0 || z - 0.3 >= it.z1)) continue;
      caja(r, 'maniqui', x - 0.28, x + 0.28, z - 0.28, z + 0.28, r.y0, 1.85, { cx: x, cz: z, dir: [0, 1], pinta: v, k: nm });
      nm++;
    }
    // Una clienta conversando con la vendedora en el mostrador.
    const cx2 = px + (px + 0.9 < mx1 - 0.2 ? 0.9 : -0.9);
    r.spots.clientes.push(spot(r, cx2, cz1 + 0.45, r.y0, (px - cx2) * 0.5, -1, { rol: 'charla', female: true }));
    deco(r, 'zocalo', { tex: 'madera', h: 0.12 });
  },
  /** Droguería: exhibidor de vidrio, estantería de remedios hasta el techo, cruz verde, báscula y silla de espera. */
  drogueria(r, rng) {
    const m = mostradorAlFrente(r, { cliente: 2.8, alto: 1.05, frente: 'gondola-drogas', encima: ['registradora', 'exhibidorChico'], fondo: ['gondola-drogas', 'back:drogueria'], costados: ['gondola-drogas'], prod: 'drogas', kind: 'blanco' });
    poner(r, 'bascula', contraMuros(r, m, 0.45, 0.4, [-m.s, m.s]), r.y0, 1.55);
    const silla = poner(r, 'silla', contraMuros(r, m, 0.48, 0.48, [m.s, -m.s]), r.y0, 0.46, { kind: 'plastico', color: 0 });
    clientesMostrador(r, m);
    // La que espera turno, sentada (va primero: es la que se pone si hay cupo para uno).
    if (silla) {
      silla.cx = (silla.x0 + silla.x1) / 2;
      silla.cz = (silla.z0 + silla.z1) / 2;
      r.spots.clientes.unshift(spot(r, silla.cx, silla.cz, r.y0, silla.dir[0], silla.dir[1], { rol: 'espera', sit: true, female: true }));
    }
    deco(r, 'cruz', { x: m.px, z: r.Z0 + CM.ESTANTE + 0.02, y: r.y0 + Math.min(2.55, r.H - 0.35) });
    deco(r, 'zocalo', { tex: 'baldosaPared', h: 0.12 });
  },
  /** Cacharrería: de todo colgado y apilado (baldes, escobas, ollas, juguetes), estanterías llenas y mostrador. */
  cacharreria(r, rng) {
    const m = mostradorAlFrente(r, { cliente: 3.4, frente: 'herramientas', encima: ['registradora'], fondo: ['back:ferreteria', 'herramientas'], costados: ['side:ferreteria'], prod: 'cacharro' });
    for (const lado of [-m.s, m.s]) poner(r, 'estante', contraMuros(r, m, 0.4, 1.4, [lado]), r.y0, Math.min(2.1, r.H - 0.5), { tex: ['side:ferreteria'], prod: 'cacharro' });
    poner(r, 'baldes', contraMuros(r, m, 0.5, 0.5), r.y0, 1.1, { n: rng.int(4, 6) });
    poner(r, 'escobas', contraMuros(r, m, 0.3, 0.7), r.y0, 1.5);
    for (const dx of [-1.2, 0, 1.2]) if (m.px + dx > m.mx0 + 0.2 && m.px + dx < m.mx1 - 0.2) deco(r, 'colgados', { x: m.px + dx, z: m.cz1 + 0.35, y: r.y0 + r.H, seed: rng.int(0, 999) });
    clientesMostrador(r, m);
    deco(r, 'zocalo', { tex: 'baldosaPared', h: 0.12 });
  },
  /** Papelería y minutos: mostrador con cuadernos, fotocopiadora, estanterías de papel y el celular de los minutos. */
  papeleria(r, rng) {
    const m = mostradorAlFrente(r, { cliente: 2.7, frente: 'cuadernos', encima: ['celulares', 'registradora'], fondo: ['back:papeleria', 'cuadernos'], costados: ['cuadernos'], prod: 'papel' });
    const fx = m.s > 0 ? m.mx1 - 1.0 : m.mx0 + 0.1;
    if (m.cz0 - m.zb > 1.0) caja(r, 'fotocopiadora', fx, fx + 0.9, m.zb + 0.05, m.zb + 0.7, r.y0, 1.0, { dir: [0, 1] });
    poner(r, 'estante', contraMuros(r, m, 0.4, 1.3), r.y0, 1.8, { tex: ['cuadernos'], prod: 'papel' });
    clientesMostrador(r, m);
    deco(r, 'afiche', { tex: 'aficheMinutos', x: m.px, z: r.Z0 + CM.ESTANTE + 0.02, y: r.y0 + Math.min(2.5, r.H - 0.4), w: 1.1, h: 0.45, dir: [0, 1] });
    deco(r, 'zocalo', { tex: 'baldosaPared', h: 0.12 });
  },
};

/** Puntos de un comercio para el que llega de afuera: frente a la puerta (en la calle), unos pasos adentro y el yaw del jugador mirando hacia adentro (sim/math.js yawFromDir). */
export function entradaLocal(r) {
  const dc = (r.door.x0 + r.door.x1) / 2;
  return { afuera: aMundo(r, dc, 1.4), adentro: aMundo(r, dc, r.Z1 - 1.3), yaw: Math.atan2(r.nx, r.nz) };
}
