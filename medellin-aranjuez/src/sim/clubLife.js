// La vida adentro de las discotecas de la 92 (pura, sin three.js): cuánta
// gente hay en un local según la hora y la calidad, qué hace cada quien según
// el tipo de local (bailar en pareja o en ronda, estar en la barra, sentarse
// en una mesa o en el VIP, atender, tocar en la tarima, animar) y dónde se
// para, el tempo de la música de cada local y por dónde sale la gente si hay
// un susto. game/clubLife.js pone la gente en escena (solo en el local donde
// está el jugador) y sim/baile.js + render/dancePoses.js la hacen bailar.
//
// Todo sale del interior ya armado (sim/interiors.js: pista, barra, mesas,
// sofás, tarima) y de semillas propias por local: misma ciudad, misma gente.
// Coordenadas locales del interior (x a lo largo de la fachada, z hacia la
// calle: adentro es z < 0); cada persona trae también su punto en el mundo.

import { makeRng } from './rng.js';
import { NIVEL_ABIERTO, pintaRumba } from './nightlife.js';
import { INTERIOR, aMundo, alturaInterior } from './interiors.js';
import { BAILE } from './baile.js';
import { CHAIR } from './seatFit.js';

// ------------------------------------------------------------------ configurables
/**
 * Gente adentro de un local con la rumba a tope (medianoche), según el cupo
 * de peatones del preset de calidad ([peds >=, {por tamaño del local}]):
 * Ultra, Alta, Media y Baja. Con menos rumba (más temprano o ya tarde) hay
 * menos, en proporción (sim/nightlife.js nivelRumba).
 */
export const CLUB_CUPO = [
  [56, { grande: 56, mediano: 38, bar: 22 }],
  [44, { grande: 44, mediano: 30, bar: 17 }],
  [34, { grande: 30, mediano: 21, bar: 12 }],
  [0, { grande: 16, mediano: 11, bar: 7 }],
];
/** Lo menos que hay en un local abierto (el que atiende y unos pocos clientes). */
export const CLUB_MINIMO = 4;

/**
 * Tempo de cada estilo: tiempos por minuto de la música y cuentas de baile por
 * tiempo (la salsa se cuenta en 8 al doble: 1-2-3, 5-6-7).
 */
export const TEMPOS = {
  regueton: { bpm: 95, cuentas: 1 },
  salsa: { bpm: 95, cuentas: 2 },
  popular: { bpm: 120, cuentas: 1 },
  electronica: { bpm: 126, cuentas: 1 },
};

/**
 * Ambiente de cada tema de interior (sim/interiors.js PLANES): estilo de
 * baile de la pista, quién trabaja (dj, banda, animador, meseros, bailarines
 * de plataforma) y cómo se reparte la clientela (fracciones: vip, mesas y
 * barra; el resto baila) y los que bailan (parejas, abrazos de lado, rondas;
 * el resto, solos). `miraDj`: los que bailan solos miran a la cabina.
 */
export const AMBIENTES = {
  reguetón: { estilo: 'regueton', dj: true, meseros: 2, vip: 0.25, mesas: 0.08, barra: 0.16, parejas: 0.3, rondas: 0.5 },
  electrónica: { estilo: 'electronica', dj: true, meseros: 2, vip: 0.22, mesas: 0.08, barra: 0.16, parejas: 0.1, rondas: 0.3, miraDj: true },
  hielo: { estilo: 'regueton', dj: true, meseros: 2, bailarines: true, vip: 0.25, mesas: 0.08, barra: 0.16, parejas: 0.3, rondas: 0.5 },
  salsoteca: { estilo: 'salsa', banda: ['voz', 'congas', 'timbales', 'piano', 'maracas'], meseros: 1, vip: 0, mesas: 0.2, barra: 0.18, parejas: 1, rondas: 0, solo: 'popular' },
  son: { estilo: 'salsa', banda: ['voz', 'bongó', 'maracas'], meseros: 1, vip: 0, mesas: 0.24, barra: 0.2, parejas: 1, rondas: 0, solo: 'popular' },
  fonda: { estilo: 'popular', dj: true, animador: true, meseros: 1, vip: 0, mesas: 0.42, barra: 0.12, parejas: 0, abrazos: 0.4, rondas: 0.4 },
  cantina: { estilo: 'popular', rockola: true, billar: true, meseros: 1, vip: 0, mesas: 0.36, barra: 0.24, parejas: 0, abrazos: 0.6, rondas: 0 },
  esquina: { estilo: 'popular', rockola: true, meseros: 1, vip: 0, mesas: 0.5, barra: 0.22, parejas: 0, abrazos: 0.5, rondas: 0.4 },
};

/** Medidas de la gente (m). */
export const GENTE = {
  /** Proporción de mujeres entre los que no van en pareja. */
  MUJERES: 0.5,
  /** Radio que ocupa una persona al acomodar la pista y separación entre vecinos de una ronda. */
  RADIO: 0.36,
  RONDA_SEP: 0.64,
  /** Pareja de reguetón (uno frente al otro, sin tomarse de las manos): distancia entre los dos. */
  PAREJA_DIST: 0.62,
  /** La pista se deja usar este tanto por fuera de su borde. */
  BORDE_PISTA: 0.25,
  /** Pasillo que siempre queda libre frente a la puerta: medio ancho y fondo. */
  PUERTA_ANCHO: 1.25,
  PUERTA_FONDO: 2.8,
  /** Libre al pie y en la boca de las escaleras. */
  ESCALERA_LIBRE: 1.1,
  /** Bancos de la barra (los mismos números de render/interiorBuilder.js): primer banco, paso, distancia al frente y alto del asiento. */
  BANCO_INICIO: 0.4,
  BANCO_PASO: 0.75,
  BANCO_DIST: 0.55,
  BANCO_ALTO: 0.78,
  /** El que está de pie en la barra: distancia al frente del mostrador. */
  BARRA_DIST: 0.44,
  /** Silla de mesa: distancia del centro de la mesa al de la silla (medio ancho + esto) y alto del asiento. */
  SILLA_DIST: 0.32,
  SILLA_ALTO: 0.47,
  /** Alto del asiento de los sofás VIP. */
  SOFA_ALTO: 0.44,
  /** Las paradas de los meseros quedan al menos a esta distancia (m) de la gente quieta. */
  PARADA_LIBRE: 0.8,
};

/**
 * Pinta de los que trabajan (prendas de sim/ropa.js): bartender, mesero, DJ,
 * orquesta de la salsoteca (todos de rojo), trío de son (de blanco y
 * sombrero), animador de la fonda (de arriero) y el que pone la música en la
 * fonda. La clientela va con pinta de rumba (sim/nightlife.js pintaRumba).
 */
export const PINTAS = {
  bartender: { torso: 'camisa-fiesta-negra', piernas: 'jean-negro', pies: 'tenis-negros' },
  mesero: { torso: 'camisa-fiesta-blanca', piernas: 'jean-negro', pies: 'tenis-negros' },
  dj: { torso: 'camiseta-negra', piernas: 'jean-negro', pies: 'tenis-blancos', cabeza: 'gorra-plana-negra', cuello: 'cadena-plateada' },
  orquesta: { torso: 'camisa-fiesta-roja', piernas: 'jean-negro', pies: 'tenis-negros' },
  trio: { torso: 'camisa-blanca-larga', piernas: 'pantalon-dril', pies: 'tenis-blancos', cabeza: 'sombrero-aguadeno-fino' },
  animador: { torso: 'camisa-cuadros', piernas: 'jean-azul', pies: 'tenis-negros', cabeza: 'sombrero-aguadeno', hombro: 'poncho-rayas', cintura: 'carriel' },
  djFonda: { torso: 'camisa-cuadros', piernas: 'jean-azul', pies: 'tenis-negros' },
};
/** Donde suena música popular: fracción de los hombres que va de sombrero (y, de esos, la mitad con poncho). */
export const PINTA_PAISA = 0.22;

/**
 * Rutas dentro del local: lado de la celda de la rejilla (m), radio de una
 * persona al esquivar muebles y campos de distancia guardados por rejilla
 * (rutaEntre: los destinos de los meseros son siempre las mismas paradas).
 */
export const RUTAS = { CELDA: 0.35, RADIO: 0.3, CAMPOS_GUARDADOS: 12 };

// ------------------------------------------------------------------ cupo y tempo
const porTabla = (tabla, peds) => (tabla.find(([min]) => peds >= min) ?? tabla[tabla.length - 1])[1];

/** Gente adentro de un local de tamaño `tam` para un preset con `peds` peatones, a nivel de rumba `nivel` (0..1). */
export function cupoClub(tam, peds, nivel) {
  if (!(nivel > NIVEL_ABIERTO)) return 0;
  const tope = porTabla(CLUB_CUPO, peds)[tam] ?? porTabla(CLUB_CUPO, peds).bar;
  return Math.max(Math.min(CLUB_MINIMO, tope), Math.round(tope * Math.min(1, nivel)));
}

/** Ambiente del interior `r` (por su tema). */
export function ambienteDe(r) {
  return AMBIENTES[r?.tema] ?? AMBIENTES.esquina;
}

/** Tempo de la pista de un interior: {estilo, bpm, cuentas}. */
export function tempoDe(r) {
  const estilo = ambienteDe(r).estilo;
  return { estilo, ...TEMPOS[estilo] };
}

/** Tiempos de la música transcurridos a los `t` segundos (con `bpm`). */
export function tiempos(t, bpm) {
  return (t * bpm) / 60;
}

const _compas = { tiempo: 0, cuenta: 0, compas: 0, golpe: 0 };
/**
 * Dónde va el compás a los `t` segundos: {tiempo: tiempos transcurridos,
 * cuenta: 0..8 (la cuenta de baile), compas: número de compás de 8, golpe:
 * 1 justo en el tiempo y 0 entre tiempos}.
 */
export function compas(t, tempo, out = _compas) {
  const b = tiempos(t, tempo.bpm);
  const c = b * (tempo.cuentas ?? 1);
  out.tiempo = b;
  out.cuenta = ((c % 8) + 8) % 8;
  out.compas = Math.floor(c / 8);
  out.golpe = 0.5 + 0.5 * Math.cos(2 * Math.PI * b);
  return out;
}

// ------------------------------------------------------------------ reparto
const hash = (s) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
};

/** Mesas con sillas, mesas altas, sofás, barras y billar del interior (de sus `items`). */
function muebles(r) {
  const de = (t) => r.items.filter((it) => it.t === t);
  return { mesas: de('mesa'), altas: de('mesaAlta'), sofas: de('sofa'), barras: de('barra'), billar: de('billar')[0] ?? null, plataformas: de('plataforma'), instrumentos: r.items.find((it) => it.t === 'instrumentos') ?? null };
}

/**
 * Cuántos de cada oficio para `n` personas en el interior `r`: {bartender,
 * dj, musicos, animador, meseros, bailarines, billar, rockola, vip, mesas,
 * barra, baile}. Primero los que trabajan; la clientela se reparte según el
 * ambiente y lo que cabe en cada parte; lo que sobra baila.
 */
export function repartoClub(r, n) {
  const A = ambienteDe(r);
  const M = muebles(r);
  let left = Math.max(0, Math.floor(n));
  const take = (k) => {
    const q = Math.max(0, Math.min(Math.floor(k), left));
    left -= q;
    return q;
  };
  const out = {};
  out.bartender = take(Math.min(r.spots.bartender.length, n >= 26 ? 2 : 1));
  out.dj = take(A.dj && r.spots.cabina.length ? 1 : 0);
  out.musicos = take(A.banda && M.instrumentos ? Math.min(A.banda.length, Math.max(2, Math.round(n * 0.17))) : 0);
  out.animador = take(A.animador && r.spots.animador.length ? 1 : 0);
  out.meseros = take(n >= 9 && r.spots.meseros.length ? Math.min(A.meseros ?? 1, n >= 28 ? 2 : 1) : 0);
  out.bailarines = take(A.bailarines && n >= 20 ? M.plataformas.length : 0);
  const g = left;
  out.billar = take(A.billar && M.billar && g >= 6 ? 2 : 0);
  out.rockola = take(A.rockola && r.spots.cabina.length && g >= 5 ? 1 : 0);
  out.vip = take(Math.min(M.sofas.length * 4 + r.spots.vip.filter((s) => s.baranda).length, Math.round(g * A.vip)));
  out.mesas = take(Math.min(M.mesas.reduce((s, m) => s + Math.max(1, m.sillas - 1), 0) + M.altas.length * 3, Math.round(g * A.mesas)));
  out.barra = take(Math.min(M.barras.reduce((s, b) => s + puestosBarra(b).length, 0), Math.round(g * A.barra)));
  out.baile = left;
  return out;
}

/**
 * Puestos de los clientes de una barra (locales): de pie entre banco y banco
 * y sentados en algunos bancos, del centro hacia las puntas. Cada uno {lx,
 * lz, dx, dz (hacia dónde mira), banco: true si va sentado}.
 */
export function puestosBarra(it) {
  const alongX = it.x1 - it.x0 > it.z1 - it.z0;
  const a0 = alongX ? it.x0 : it.z0;
  const a1 = alongX ? it.x1 : it.z1;
  const face = it.face;
  const front = alongX ? (face > 0 ? it.z1 : it.z0) : face > 0 ? it.x1 : it.x0;
  const bancos = [];
  for (let a = a0 + GENTE.BANCO_INICIO; a < a1 - 0.2; a += GENTE.BANCO_PASO) bancos.push(a);
  const out = [];
  const at = (a, d, banco) => (alongX ? { lx: a, lz: front + face * d, dx: 0, dz: -face, banco } : { lx: front + face * d, lz: a, dx: -face, dz: 0, banco });
  // De pie en los huecos entre bancos; sentado, uno de cada tres bancos.
  for (let k = 0; k + 1 < bancos.length; k++) out.push(at((bancos[k] + bancos[k + 1]) / 2, GENTE.BARRA_DIST, false));
  for (let k = 1; k < bancos.length; k += 3) out.push(at(bancos[k], GENTE.BANCO_DIST, true));
  const mid = (a0 + a1) / 2;
  const along = (p) => (alongX ? p.lx : p.lz);
  // (Quien se sienta en un banco le quita medio hueco a cada vecino de pie: no van los dos.)
  const libres = out.filter((p) => p.banco || !out.some((q) => q.banco && Math.abs(along(q) - along(p)) < GENTE.BANCO_PASO * 0.6));
  return libres.sort((p, q) => Math.abs(along(p) - mid) - Math.abs(along(q) - mid));
}

/** Sillas de una mesa (locales), mirando a la mesa: {lx, lz, dx, dz}. */
export function sillasMesa(it) {
  const out = [];
  const n = it.sillas ?? 4;
  for (let k = 0; k < n; k++) {
    const a = (k * Math.PI * 2) / n + Math.PI / 4;
    const d = it.w / 2 + GENTE.SILLA_DIST;
    out.push({ lx: it.cx + Math.sin(a) * d, lz: it.cz + Math.cos(a) * d, dx: -Math.sin(a), dz: -Math.cos(a) });
  }
  return out;
}

/** Puestos de pie alrededor de una mesa alta (entre los dos bancos), mirando a la mesa. */
export function puestosMesaAlta(it) {
  const out = [];
  for (const [sx, sz] of [[0.3, 0.6], [-0.3, -0.6], [-0.3, 0.6], [0.3, -0.6]]) {
    const l = Math.hypot(sx, sz);
    out.push({ lx: it.cx + sx, lz: it.cz + sz, dx: -sx / l, dz: -sz / l });
  }
  return out;
}

/** Asientos de un sofá VIP (locales), mirando a la mesita, del centro hacia las puntas: {lx, lz, dx, dz}. */
export function asientosSofa(it) {
  const out = [];
  for (const k of [0, -1, 1, -2, 2]) {
    const a = it.dir + Math.PI + (k * Math.PI) / 5.5;
    out.push({ lx: it.cx + Math.sin(a) * (it.rad - 0.25), lz: it.cz + Math.cos(a) * (it.rad - 0.25), dx: -Math.sin(a), dz: -Math.cos(a) });
  }
  return out;
}

/**
 * Puestos de los músicos junto a sus instrumentos (los mismos números de
 * render/interiorBuilder.js _instruments): {inst, lx, lz, dx, dz, tamborY,
 * tamborZ} por instrumento; `it` es el item 'instrumentos'.
 */
export function puestosMusicos(it) {
  const cx = (it.x0 + it.x1) / 2;
  const zc = (it.z0 + it.z1) / 2;
  const w = it.x1 - it.x0;
  if (it.set === 'salsa') {
    return {
      congas: { lx: it.x0 + 0.96, lz: zc - 0.58, dx: 0, dz: 1, tamborY: 0.82, tamborZ: 0.52 },
      timbales: { lx: cx - 0.3, lz: zc - 0.56, dx: 0, dz: 1, tamborY: 1.02, tamborZ: 0.5 },
      piano: { lx: it.x1 - 1.0, lz: it.z0 + 1.42, dx: 0, dz: -1, tamborY: 0.79, tamborZ: 0.5 },
      voz: { lx: it.x0 + 1.0 + (w - 2) / 2.5, lz: it.z1 - 1.0, dx: 0, dz: 1 },
      maracas: { lx: it.x0 + 1.0 + (2 * (w - 2)) / 2.5 - 0.15, lz: it.z1 - 1.05, dx: 0, dz: 1 },
    };
  }
  return {
    bongó: { lx: cx - 0.79, lz: zc - 0.52, dx: 0, dz: 1, tamborY: 0.77, tamborZ: 0.5 },
    maracas: { lx: cx + 0.2, lz: zc - 0.35, dx: 0, dz: 1 },
    voz: { lx: cx + 1.2, lz: zc + 0.08, dx: 0, dz: 1 },
  };
}

// ------------------------------------------------------------------ dónde se puede estar
const dentro = (o, x, z, m = 0) => x >= o.x0 - m && x <= o.x1 + m && z >= o.z0 - m && z <= o.z1 + m;

/** Rectángulos que nadie debe tapar: el pasillo de la puerta, las escaleras con su pie y su boca, y el foso del sótano. */
export function zonasLibres(r) {
  const out = [{ x0: -GENTE.PUERTA_ANCHO, x1: GENTE.PUERTA_ANCHO, z0: r.Z1 - GENTE.PUERTA_FONDO, z1: r.Z1 + 1 }];
  const e = GENTE.ESCALERA_LIBRE;
  for (const s of r.stairs) out.push({ x0: s.x0 - 0.2, x1: s.x1 + 0.3, z0: s.z0 - e, z1: s.z1 + e });
  if (r.shaft) out.push({ x0: r.shaft.x0 - 0.3, x1: r.shaft.x1 + 0.3, z0: r.shaft.z0 - e, z1: r.Z1 });
  return out;
}

/** Margen extra (m) alrededor de un mueble para quien baila cerca (sillas, clientes de la barra, el taco del billar). */
const MARGEN = { mesa: 0.75, barra: 1.0, billar: 0.7, sofa: 0.3, mesaAlta: 0.75, mesita: 0.3 };

/** ¿Un círculo de radio `rad` en (lx, lz) al nivel del piso del salón toca un mueble (con su margen para sillas y clientes, salvo conMargen = false), una zona libre o se sale del salón? */
export function ocupado(r, lx, lz, rad, zonas = zonasLibres(r), conMargen = true) {
  if (lx < r.X0 + rad || lx > r.X1 - rad || lz < r.Z0 + rad || lz > r.Z1 - rad) return true;
  for (const z of zonas) if (dentro(z, lx, lz, rad)) return true;
  for (const it of r.items) {
    if (!it.solid || it.y > r.y0 + 1 || it.y + it.h < r.y0 + 0.1) continue;
    if (dentro(it, lx, lz, rad + (conMargen ? (MARGEN[it.t] ?? 0.1) : 0))) return true;
  }
  return false;
}

// ------------------------------------------------------------------ la pista
/**
 * Arma los grupos que bailan: reparte `n` personas en parejas, abrazos de
 * lado, rondas (de 3 a 5) y solos según el ambiente y les busca sitio en la
 * pista (o, si el local no tiene pista, en el piso libre) sin encimarse ni
 * tapar la puerta o la escalera. Devuelve [{tipo, cx, cz, a, rad, n}].
 */
export function unidadesBaile(r, n, rng) {
  const A = ambienteDe(r);
  const tipos = [];
  let left = n;
  const nPar = Math.floor((n * (A.parejas ?? 0)) / 2 + 1e-6);
  for (let k = 0; k < nPar && left >= 2; k++, left -= 2) tipos.push({ tipo: 'pareja', n: 2 });
  // (Donde se canta abrazado, al menos una pareja de amigos si hay dos que bailen.)
  const nAbr = A.abrazos ? Math.max(1, Math.round((n * A.abrazos) / 2)) : 0;
  for (let k = 0; k < nAbr && left >= 2; k++, left -= 2) tipos.push({ tipo: 'abrazo', n: 2 });
  let enRonda = Math.min(left, Math.round(n * (A.rondas ?? 0)));
  while (enRonda >= 3) {
    const k = enRonda === 6 ? 3 : enRonda <= 5 ? enRonda : rng.int(3, 5);
    tipos.push({ tipo: 'ronda', n: k });
    enRonda -= k;
    left -= k;
  }
  for (; left > 0; left--) tipos.push({ tipo: 'solo', n: 1 });
  const salsa = A.estilo === 'salsa';
  for (const u of tipos) {
    const R = GENTE.RADIO;
    if (u.tipo === 'pareja') {
      u.dist = salsa ? BAILE.SALSA_DIST : GENTE.PAREJA_DIST;
      u.rad = u.dist / 2 + R + (salsa ? 0.06 : 0);
    } else if (u.tipo === 'abrazo') {
      u.dist = BAILE.ABRAZO_DIST;
      u.rad = u.dist / 2 + R;
    } else if (u.tipo === 'ronda') {
      u.rr = Math.max(0.48, GENTE.RONDA_SEP / (2 * Math.sin(Math.PI / u.n)));
      u.rad = u.rr + R;
    } else u.rad = R + 0.06;
  }
  // Los más grandes primero; cada uno donde quepa (si no cabe, se aprieta un poco).
  tipos.sort((a, b) => b.rad - a.rad);
  const p = r.pista;
  const m = GENTE.BORDE_PISTA;
  const area = p ? { x0: p.x0 - m, x1: p.x1 + m, z0: p.z0 - m, z1: p.z1 + m } : { x0: r.X0 + 0.4, x1: r.X1 - 0.4, z0: r.Z0 + 0.4, z1: r.Z1 - 0.4 };
  const zonas = zonasLibres(r);
  const puestos = [];
  for (const u of tipos) {
    let ok = false;
    for (const aprieta of [1, 0.9, 0.8, 0.72]) {
      const rad = u.rad * aprieta;
      for (let k = 0; k < 90 && !ok; k++) {
        const x = rng.range(area.x0 + Math.min(rad, (area.x1 - area.x0) / 2), area.x1 - Math.min(rad, (area.x1 - area.x0) / 2));
        const z = rng.range(area.z0 + Math.min(rad, (area.z1 - area.z0) / 2), area.z1 - Math.min(rad, (area.z1 - area.z0) / 2));
        if (ocupado(r, x, z, Math.min(rad, u.rad - 0.08), zonas)) continue;
        if (puestos.some((q) => Math.hypot(q.cx - x, q.cz - z) < (q.rad + u.rad) * aprieta)) continue;
        u.cx = x;
        u.cz = z;
        ok = true;
      }
      if (ok) break;
    }
    if (!ok) continue;
    u.a = rng.range(0, Math.PI * 2);
    puestos.push(u);
  }
  return puestos;
}

// ------------------------------------------------------------------ la gente
/**
 * La gente de adentro del interior `r` para un cupo de `n` personas:
 * {personas, unidades, reparto}. Cada persona: {i, rol, lx, lz, y, dx, dz
 * (hacia dónde mira, local), x, z (mundo), fx, fz (hacia dónde mira, mundo),
 * female, sentado, banco, estilo (de baile o null), gesto, unidad, pareja,
 * lider, espejo, energia, retraso (en tiempos), prop, panico ('correr',
 * 'agacharse' o 'cubrirse') y datos del oficio}. Determinista: mismo local,
 * mismo cupo y misma semilla dan la misma gente.
 */
export function armarGente(r, n, semilla = 1) {
  const rng = makeRng((hash(r.id) ^ Math.imul(semilla | 0, 0x9e3779b1)) >>> 0 || 1);
  const A = ambienteDe(r);
  const M = muebles(r);
  const rep = repartoClub(r, n);
  const personas = [];
  const unidades = [];
  const mujer = () => rng.chance(GENTE.MUJERES);
  const add = (rol, p, extra = {}) => {
    const w = aMundo(r, p.lx, p.lz);
    const q = {
      i: personas.length,
      rol,
      lx: p.lx,
      lz: p.lz,
      y: p.y ?? r.y0,
      dx: p.dx,
      dz: p.dz,
      x: w.x,
      z: w.z,
      fx: r.ux * p.dx + r.nx * p.dz,
      fz: r.uz * p.dx + r.nz * p.dz,
      female: false,
      sentado: false,
      banco: false,
      estilo: null,
      gesto: null,
      unidad: -1,
      pareja: -1,
      lider: false,
      espejo: rng.chance(0.5) ? 1 : -1,
      energia: rng.range(0.8, 1.15),
      retraso: rng.range(-0.04, 0.04),
      prop: null,
      panico: 'correr',
      ...extra,
    };
    personas.push(q);
    return q;
  };
  const local = (s) => ({ lx: s.lx, lz: s.lz, y: s.y, dx: 0, dz: 0 });
  const mirando = (s, dx, dz) => ({ ...local(s), dx, dz });

  // --- Los que trabajan.
  // Bartenders: repartidos a lo largo de la barra.
  const bs = r.spots.bartender;
  for (let k = 0; k < rep.bartender; k++) {
    const s = bs[Math.min(bs.length - 1, Math.floor(((k + 0.5) * bs.length) / rep.bartender))];
    const bar = M.barras[0];
    // Mira hacia los clientes (al otro lado del mostrador).
    const alongX = bar ? bar.x1 - bar.x0 > bar.z1 - bar.z0 : false;
    const d = bar ? (alongX ? { dx: 0, dz: bar.face } : { dx: bar.face, dz: 0 }) : { dx: 0, dz: 1 };
    // Distancia al borde de atrás del mostrador (para apoyar las manos).
    const back = bar ? (alongX ? (bar.face > 0 ? bar.z0 : bar.z1) : bar.face > 0 ? bar.x0 : bar.x1) : 0;
    const dist = bar ? Math.abs((alongX ? s.lz : s.lx) - back) : 0.55;
    add('bartender', mirando(s, d.dx, d.dz), { female: mujer(), gesto: 'bartender', panico: 'agacharse', barraY: bar ? bar.h : 1.1, barraZ: dist + 0.16 });
  }
  if (rep.dj) {
    const s = r.spots.cabina[0];
    const cab = r.items.find((it) => it.t === 'cabina');
    add('dj', mirando(s, 0, 1), { female: rng.chance(0.25), gesto: 'dj', panico: 'agacharse', consolaY: cab ? cab.y + cab.h - s.y : 1.12, consolaZ: cab ? Math.max(0.42, cab.z0 - s.lz + 0.16) : 0.55 });
  }
  if (rep.musicos) {
    const P = puestosMusicos(M.instrumentos);
    for (const inst of A.banda.slice(0, rep.musicos)) {
      const p = P[inst];
      if (!p) continue;
      add('musico', { ...p, y: M.instrumentos.y }, { female: inst === 'voz' ? rng.chance(0.35) : inst === 'maracas' ? rng.chance(0.6) : false, gesto: inst, inst, panico: 'agacharse', prop: inst === 'voz' ? 'micro' : inst === 'maracas' ? 'maracas' : null, tamborY: p.tamborY, tamborZ: p.tamborZ });
    }
  }
  if (rep.animador) add('animador', mirando(r.spots.animador[0], 0, 1), { gesto: 'animador', inst: 'animador', prop: 'micro', panico: 'agacharse' });
  // Meseros: van y vienen por el piso del salón entre sus puntos (sim/interiors.js).
  // (Las paradas no quedan al pie de la escalera ni en el pasillo de la puerta; si queda una sola, la otra es frente a la barra.)
  const zl = zonasLibres(r);
  const pm = r.spots.meseros.filter((s) => Math.abs(s.y - r.y0) < 0.05 && !zl.some((z) => dentro(z, s.lx, s.lz, 0.2)));
  if (pm.length < 2 && M.barras[0]) {
    const b = M.barras[0];
    const alongX = b.x1 - b.x0 > b.z1 - b.z0;
    const d = (b.face > 0 ? 1 : -1) * 1.35;
    const q = alongX ? { lx: (b.x0 + b.x1) / 2, lz: (b.face > 0 ? b.z1 : b.z0) + d } : { lx: (b.face > 0 ? b.x1 : b.x0) + d, lz: (b.z0 + b.z1) / 2 };
    if (!ocupado(r, q.lx, q.lz, RUTAS.RADIO, zl, false)) pm.push(q);
  }
  for (let k = 0; k < rep.meseros && pm.length >= 1; k++) {
    const s = pm[k % pm.length];
    // (La bengala en la bandeja es del servicio de botella de las discotecas con VIP; en los bares y la fonda, bandeja sola.)
    add('mesero', mirando(s, 0, 1), { female: mujer(), gesto: 'mesero', prop: A.vip > 0 ? 'bandeja' : 'bandeja-sola', paradas: pm.map((q) => ({ lx: q.lx, lz: q.lz })), parada: k % pm.length });
  }
  // Bailarines de las plataformas.
  for (let k = 0; k < rep.bailarines; k++) {
    const it = M.plataformas[k];
    add('bailarin', { lx: it.cx, lz: it.cz, y: it.y + it.h, dx: 0, dz: 1 }, { female: k % 2 === 0, estilo: A.estilo, energia: 1.2, panico: 'agacharse' });
  }

  // --- La clientela.
  if (rep.billar) {
    const sp = r.spots.mesas.filter((s) => s.billar);
    const bill = M.billar;
    sp.slice(0, rep.billar).forEach((s, k) => {
      const dx = Math.sign(bill.cx - s.lx) || 1;
      add('billar', mirando(s, dx, 0), { gesto: 'billar', tira: k === 0, prop: 'taco', mesaY: bill.h, female: false });
    });
  }
  if (rep.rockola) {
    const s = r.spots.cabina[0];
    const rk = r.items.find((it) => it.t === 'rockola');
    const dx = rk ? (rk.x0 + rk.x1) / 2 - s.lx : 0;
    const dz = rk ? (rk.z0 + rk.z1) / 2 - s.lz : -1;
    const l = Math.hypot(dx, dz) || 1;
    add('rockola', mirando(s, dx / l, dz / l), { female: mujer(), gesto: 'rockola' });
  }
  // VIP: los sofás se llenan de a 3 o 4 (los de abajo primero) y, si sobra gente, los de la baranda del mezanine.
  let vip = rep.vip;
  const sofas = [...M.sofas].sort((a, b) => a.y - b.y);
  for (let s = 0; s < sofas.length && vip > 0; s++) {
    const it = sofas[s];
    const cuantos = Math.min(vip, sofas.length - s > 1 && vip <= 4 ? vip : rng.int(3, 4));
    const u = unidades.push({ tipo: 'vip', n: cuantos, cx: it.cx, cz: it.cz }) - 1;
    asientosSofa(it).slice(0, cuantos).forEach((p) => add('vip', { ...p, y: it.y + GENTE.SOFA_ALTO - CHAIR.seat }, { female: mujer(), sentado: true, unidad: u, panico: 'cubrirse', prop: 'vaso' }));
    vip -= cuantos;
  }
  for (const s of r.spots.vip.filter((q) => q.baranda)) {
    if (vip <= 0) break;
    add('vip', mirando(s, 0, -1), { female: mujer(), estilo: 'meneo', prop: 'vaso', panico: 'agacharse' });
    vip--;
  }
  rep.baile += vip;
  // Mesas: de a 2 o 3 por mesa (nunca uno solo si se puede); luego las mesas altas (de pie).
  let mesas = rep.mesas;
  const orden = M.mesas.map((it) => ({ it, k: rng.next() })).sort((a, b) => a.k - b.k).map((o) => o.it);
  const porMesa = orden.length ? Math.max(2, Math.min(3, Math.ceil(mesas / orden.length))) : 0;
  for (const it of orden) {
    if (mesas <= 0) break;
    const sillas = sillasMesa(it);
    const cuantos = Math.min(mesas, mesas - porMesa === 1 ? porMesa + 1 : porMesa, sillas.length);
    const u = unidades.push({ tipo: 'mesa', n: cuantos, cx: it.cx, cz: it.cz }) - 1;
    const k0 = rng.int(0, sillas.length - 1);
    // De a dos en una mesa de cuatro: frente a frente (en sillas vecinas quedaban cabeza con cabeza al echarse sobre la mesa).
    const paso = cuantos === 2 && sillas.length === 4 ? 2 : 1;
    for (let k = 0; k < cuantos; k++) add('mesa', { ...sillas[(k0 + k * paso) % sillas.length], y: it.y + GENTE.SILLA_ALTO - CHAIR.seat }, { female: mujer(), sentado: true, unidad: u, panico: 'cubrirse', prop: 'vaso', lento: A.estilo === 'popular' });
    mesas -= cuantos;
  }
  for (const it of M.altas) {
    if (mesas <= 0) break;
    const cuantos = Math.min(mesas, 3);
    const u = unidades.push({ tipo: 'mesaAlta', n: cuantos, cx: it.cx, cz: it.cz }) - 1;
    puestosMesaAlta(it).slice(0, cuantos).forEach((p) => add('mesa', { ...p, y: it.y }, { female: mujer(), estilo: 'meneo', unidad: u, prop: 'vaso' }));
    mesas -= cuantos;
  }
  rep.baile += mesas;
  // Barra: de pie entre los bancos o sentados en un banco.
  let barra = rep.barra;
  for (const it of M.barras) {
    for (const p of puestosBarra(it)) {
      if (barra <= 0) break;
      add('barra', { ...p, y: it.y + (p.banco ? GENTE.BANCO_ALTO - CHAIR.seat : 0) }, { female: mujer(), sentado: p.banco, banco: p.banco, estilo: p.banco ? null : 'meneo', prop: 'vaso', panico: p.banco ? 'cubrirse' : 'correr' });
      barra--;
    }
  }
  rep.baile += barra;
  // La pista.
  const cab = r.cabina ?? r.spots.cabina[0] ?? null;
  for (const u of unidadesBaile(r, rep.baile, rng)) {
    const ui = unidades.push(u) - 1;
    const sa = Math.sin(u.a);
    const ca = Math.cos(u.a);
    if (u.tipo === 'pareja') {
      const d = u.dist / 2;
      const salsa = A.estilo === 'salsa';
      // Él de espaldas a (sa, ca), ella enfrente; los dos se miran.
      const el = add('baile', { lx: u.cx - sa * d, lz: u.cz - ca * d, dx: sa, dz: ca }, { female: false, estilo: A.estilo, unidad: ui, lider: true, espejo: 1 });
      const ella = add('baile', { lx: u.cx + sa * d, lz: u.cz + ca * d, dx: -sa, dz: -ca }, { female: true, estilo: A.estilo, unidad: ui, lider: false, espejo: salsa ? 1 : -1, energia: el.energia, retraso: el.retraso });
      el.pareja = ella.i;
      ella.pareja = el.i;
    } else if (u.tipo === 'abrazo') {
      const d = u.dist / 2;
      // Los dos miran hacia (sa, ca); el que lleva queda a la izquierda del otro.
      const mixto = rng.chance(0.5);
      const a = add('baile', { lx: u.cx + ca * d, lz: u.cz - sa * d, dx: sa, dz: ca }, { female: false, estilo: 'abrazo', unidad: ui, lider: true });
      const b = add('baile', { lx: u.cx - ca * d, lz: u.cz + sa * d, dx: sa, dz: ca }, { female: mixto, estilo: 'abrazo', unidad: ui, lider: false, energia: a.energia, retraso: a.retraso, prop: 'vaso' });
      a.pareja = b.i;
      b.pareja = a.i;
    } else if (u.tipo === 'ronda') {
      const f0 = rng.chance(0.5);
      for (let k = 0; k < u.n; k++) {
        const a = u.a + (k * Math.PI * 2) / u.n;
        add('baile', { lx: u.cx + Math.sin(a) * u.rr, lz: u.cz + Math.cos(a) * u.rr, dx: -Math.sin(a), dz: -Math.cos(a) }, { female: (k % 2 === 0) === f0, estilo: A.estilo, unidad: ui, espejo: k % 2 ? 1 : -1, prop: A.estilo === 'popular' ? 'vaso' : null });
      }
    } else {
      // Solo: mirando a la cabina (electrónica) o a cualquier lado.
      let dx = sa;
      let dz = ca;
      if (A.miraDj && cab) {
        const l = Math.hypot(cab.lx - u.cx, cab.lz - u.cz) || 1;
        dx = (cab.lx - u.cx) / l;
        dz = (cab.lz - u.cz) / l;
      }
      add('baile', { lx: u.cx, lz: u.cz, dx, dz }, { female: mujer(), estilo: A.solo ?? A.estilo, unidad: ui, prop: (A.solo ?? A.estilo) === 'popular' ? 'vaso' : null });
    }
  }
  // Las paradas de los meseros no quedan encima de nadie (se corren un poco, si hay para dónde).
  const zonas = zonasLibres(r);
  for (const m of personas) {
    if (m.rol !== 'mesero') continue;
    for (const s of m.paradas) {
      for (let k = 0; k < 3; k++) {
        const q = personas.find((p) => p.rol !== 'mesero' && Math.abs(p.y - r.y0) < 0.6 && Math.hypot(p.lx - s.lx, p.lz - s.lz) < GENTE.PARADA_LIBRE);
        if (!q) break;
        const d = Math.hypot(s.lx - q.lx, s.lz - q.lz) || 1;
        const nx = q.lx + ((s.lx - q.lx) / d) * (GENTE.PARADA_LIBRE + 0.02);
        const nz = q.lz + ((s.lz - q.lz) / d) * (GENTE.PARADA_LIBRE + 0.02);
        if (ocupado(r, nx, nz, RUTAS.RADIO, zonas, false)) break;
        s.lx = nx;
        s.lz = nz;
      }
    }
    const s = m.paradas[m.parada];
    const w = aMundo(r, s.lx, s.lz);
    Object.assign(m, { lx: s.lx, lz: s.lz, x: w.x, z: w.z });
  }
  return { personas, unidades, reparto: rep };
}

/** Pinta (prendas por ranura de sim/ropa.js) de la persona `q` del interior `r`: uniforme si trabaja, de rumba si no. */
export function pintaClub(r, q, rng) {
  const popular = ambienteDe(r).estilo === 'popular';
  if (q.rol === 'bartender') return PINTAS.bartender;
  if (q.rol === 'mesero') return PINTAS.mesero;
  if (q.rol === 'dj') return popular ? PINTAS.djFonda : PINTAS.dj;
  if (q.rol === 'musico') return r.tema === 'son' ? PINTAS.trio : PINTAS.orquesta;
  if (q.rol === 'animador') return PINTAS.animador;
  const o = pintaRumba(rng, !!q.female);
  if (popular && !q.female && rng.chance(PINTA_PAISA)) {
    o.cabeza = 'sombrero-aguadeno';
    if (rng.chance(0.5)) o.hombro = 'poncho-blanco';
  }
  return o;
}

// ------------------------------------------------------------------ rutas (meseros y salida)
/**
 * Rejilla del piso del salón de `r`: {x0, z0, nx, nz, celda, libre
 * (Uint8Array)}. Una celda está libre si una persona parada en su centro no
 * toca muros, muebles, tarimas ni escaleras.
 */
export function rejilla(r) {
  const c = RUTAS.CELDA;
  const nx = Math.max(1, Math.ceil((r.X1 - r.X0) / c));
  const nz = Math.max(1, Math.ceil((r.Z1 - r.Z0) / c));
  const libre = new Uint8Array(nx * nz);
  const R = RUTAS.RADIO;
  const bloques = [];
  for (const it of r.items) if (it.solid && it.y <= r.y0 + 1 && it.y + it.h >= r.y0 + 0.1) bloques.push(it);
  for (const s of r.stairs) bloques.push({ x0: s.x0, x1: s.x1 + 0.1, z0: s.z0, z1: s.z1 });
  if (r.shaft) bloques.push({ x0: r.shaft.x0 - r.shaft.wall, x1: r.shaft.x1 + r.shaft.wall, z0: r.shaft.z0, z1: r.Z1 });
  for (let j = 0; j < nz; j++)
    for (let i = 0; i < nx; i++) {
      const x = r.X0 + (i + 0.5) * c;
      const z = r.Z0 + (j + 0.5) * c;
      let ok = x > r.X0 + R * 0.6 && x < r.X1 - R * 0.6 && z > r.Z0 + R * 0.6 && z < r.Z1 - R * 0.3;
      for (let k = 0; ok && k < bloques.length; k++) if (dentro(bloques[k], x, z, R)) ok = false;
      libre[j * nx + i] = ok ? 1 : 0;
    }
  return { x0: r.X0, z0: r.Z0, nx, nz, celda: c, libre };
}

const celdaDe = (g, lx, lz) => {
  const i = Math.min(g.nx - 1, Math.max(0, Math.floor((lx - g.x0) / g.celda)));
  const j = Math.min(g.nz - 1, Math.max(0, Math.floor((lz - g.z0) / g.celda)));
  return j * g.nx + i;
};

/** Celda libre más cercana a (lx, lz) (o -1); con `dist`, solo las que llegan al destino de ese campo. */
function celdaLibre(g, lx, lz, dist = null) {
  const c0 = celdaDe(g, lx, lz);
  if (g.libre[c0] && (!dist || dist[c0] >= 0)) return c0;
  const i0 = c0 % g.nx;
  const j0 = Math.floor(c0 / g.nx);
  let best = -1;
  let bd = Infinity;
  for (let rad = 1; rad <= 8 && best < 0; rad++)
    for (let j = Math.max(0, j0 - rad); j <= Math.min(g.nz - 1, j0 + rad); j++)
      for (let i = Math.max(0, i0 - rad); i <= Math.min(g.nx - 1, i0 + rad); i++) {
        if (!g.libre[j * g.nx + i] || (dist && dist[j * g.nx + i] < 0)) continue;
        const d = Math.hypot(g.x0 + (i + 0.5) * g.celda - lx, g.z0 + (j + 0.5) * g.celda - lz);
        if (d < bd) {
          bd = d;
          best = j * g.nx + i;
        }
      }
  return best;
}

const VEC = [[1, 0, 10], [-1, 0, 10], [0, 1, 10], [0, -1, 10], [1, 1, 14], [1, -1, 14], [-1, 1, 14], [-1, -1, 14]];

/**
 * Campo de distancias de la rejilla `g` hacia el punto local (tx, tz): cada
 * celda libre sabe cuánto le falta (en décimas de celda; -1 = no llega). No
 * corta esquinas: en diagonal solo pasa si los dos lados están libres.
 */
export function campoHacia(g, tx, tz) {
  const dist = new Int32Array(g.nx * g.nz).fill(-1);
  const t = celdaLibre(g, tx, tz);
  const campo = { g, dist, tx, tz };
  if (t < 0) return campo;
  // Dijkstra con cubetas chicas: los costos son 10 y 14.
  let frente = [t];
  dist[t] = 0;
  while (frente.length) {
    const sig = [];
    frente.sort((a, b) => dist[a] - dist[b]);
    for (const c of frente) {
      const i = c % g.nx;
      const j = (c - i) / g.nx;
      for (const [di, dj, w] of VEC) {
        const a = i + di;
        const b = j + dj;
        if (a < 0 || b < 0 || a >= g.nx || b >= g.nz) continue;
        const q = b * g.nx + a;
        if (!g.libre[q]) continue;
        if (di && dj && (!g.libre[j * g.nx + a] || !g.libre[b * g.nx + i])) continue;
        const nd = dist[c] + w;
        if (dist[q] < 0 || nd < dist[q]) {
          dist[q] = nd;
          sig.push(q);
        }
      }
    }
    frente = sig;
  }
  return campo;
}

/**
 * Siguiente punto (local) para ir de (lx, lz) hacia el destino del campo:
 * el centro de la celda vecina que más acerca. Devuelve false si ya llegó (o
 * no hay cómo llegar) y deja en `out` {x, z}.
 */
export function pasoCampo(campo, lx, lz, out) {
  const g = campo.g;
  const c = celdaDe(g, lx, lz);
  if (!g.libre[c] || campo.dist[c] < 0) {
    // Parado donde no se camina (pegado a un mueble): primero al centro de la celda libre más cercana.
    const q = celdaLibre(g, lx, lz, campo.dist);
    if (q < 0) {
      out.x = campo.tx;
      out.z = campo.tz;
      return false;
    }
    out.x = g.x0 + ((q % g.nx) + 0.5) * g.celda;
    out.z = g.z0 + (Math.floor(q / g.nx) + 0.5) * g.celda;
    return true;
  }
  const i = c % g.nx;
  const j = (c - i) / g.nx;
  let best = c;
  for (const [di, dj] of VEC) {
    const a = i + di;
    const b = j + dj;
    if (a < 0 || b < 0 || a >= g.nx || b >= g.nz) continue;
    const q = b * g.nx + a;
    if (campo.dist[q] < 0 || campo.dist[q] >= campo.dist[best]) continue;
    if (di && dj && (!g.libre[j * g.nx + a] || !g.libre[b * g.nx + i])) continue;
    best = q;
  }
  if (best === c) {
    // Ya en la celda del destino.
    out.x = campo.tx;
    out.z = campo.tz;
    return false;
  }
  out.x = g.x0 + ((best % g.nx) + 0.5) * g.celda;
  out.z = g.z0 + (Math.floor(best / g.nx) + 0.5) * g.celda;
  return true;
}

/**
 * Por dónde se sale del local `r`: {campo: hacia el pie de la salida (la
 * puerta, o la escalera en un sótano), tramo: puntos locales [{x, z}] que
 * siguen derecho desde ahí hasta el andén}.
 */
export function salidaDe(r, g = rejilla(r)) {
  const T = INTERIOR.MURO;
  if (r.landing && r.stairs.length) {
    const s = r.stairs[0];
    const cx = (s.x0 + s.x1) / 2;
    return { g, campo: campoHacia(g, cx, s.z0 - 0.45), tramo: [{ x: cx, z: s.z0 - 0.3 }, { x: cx, z: s.z1 + 0.25 }, { x: 0, z: r.Z1 - 0.2 }, { x: 0, z: 1.0 }, { x: 0, z: 2.8 }], ancho: Math.min(0.75, (s.x1 - s.x0) / 2 - 0.45) };
  }
  return { g, campo: campoHacia(g, 0, r.Z1 - 0.55), tramo: [{ x: 0, z: r.Z1 - 0.45 }, { x: 0, z: T + 0.9 }, { x: 0, z: 2.8 }], ancho: Math.min(0.75, (r.door.x1 - r.door.x0) / 2 - 0.35) };
}

/**
 * Un paso de alguien que corre hacia la salida. `e` = {lx, lz, y, k (tramo
 * por el que va; -1 = todavía por el salón), carril (-1..1: por qué lado de
 * la puerta sale)}; avanza `d` metros y devuelve true al llegar al andén.
 */
export function pasoSalida(r, S, e, d) {
  const o = _ps;
  for (let guard = 0; guard < 48 && d > 1e-4; guard++) {
    // Por el salón: de celda en celda; al llegar al pie de la salida, por el tramo.
    if (e.k < 0 && !pasoCampo(S.campo, e.lx, e.lz, o)) e.k = 0;
    if (e.k >= S.tramo.length) break;
    if (e.k >= 0) {
      const p = S.tramo[e.k];
      o.x = p.x + e.carril * S.ancho;
      o.z = p.z;
    }
    const dx = o.x - e.lx;
    const dz = o.z - e.lz;
    const l = Math.hypot(dx, dz);
    if (l < 0.03) {
      if (e.k >= 0) e.k++;
      else {
        e.lx = o.x;
        e.lz = o.z;
        if (l < 1e-6) break;
      }
      continue;
    }
    const s = Math.min(d, l);
    e.lx += (dx / l) * s;
    e.lz += (dz / l) * s;
    e.dx = dx / l;
    e.dz = dz / l;
    d -= s;
  }
  const h = alturaInterior(r, e.lx, e.lz, e.y);
  if (h !== null) e.y = h;
  return e.k >= S.tramo.length;
}
const _ps = { x: 0, z: 0 };

/**
 * Ruta por el piso del salón entre dos puntos locales (para los meseros):
 * lista de puntos [{x, z}] de celda en celda, o null si no hay paso.
 */
export function rutaEntre(g, ax, az, bx, bz) {
  // El campo hacia cada destino se guarda en la rejilla (hasta RUTAS.CAMPOS_GUARDADOS; no cambia mientras el piso no cambie).
  const campos = (g.campos ??= new Map());
  const clave = `${bx},${bz}`;
  let campo = campos.get(clave);
  if (!campo) {
    if (campos.size >= RUTAS.CAMPOS_GUARDADOS) campos.delete(campos.keys().next().value);
    campos.set(clave, (campo = campoHacia(g, bx, bz)));
  }
  const out = [];
  const p = { x: ax, z: az };
  const o = { x: 0, z: 0 };
  for (let k = 0; k < g.nx * g.nz; k++) {
    const sigue = pasoCampo(campo, p.x, p.z, o);
    p.x = o.x;
    p.z = o.z;
    out.push({ x: o.x, z: o.z });
    if (!sigue) return out;
  }
  return null;
}

// ------------------------------------------------------------------ que no estorben
/**
 * Separación suave: cuánto se corre (m, en `out` {x, z}) alguien que está a
 * (dx, dz) del jugador para dejarlo pasar: nada más lejos que `radio`, y a lo
 * sumo `tope`.
 */
export function apartarse(dx, dz, radio, tope, out) {
  const d = Math.hypot(dx, dz);
  if (!(d < radio)) {
    out.x = 0;
    out.z = 0;
    return out;
  }
  const k = Math.min(tope, radio - d);
  const l = d > 1e-3 ? d : 1;
  out.x = d > 1e-3 ? (dx / l) * k : k;
  out.z = d > 1e-3 ? (dz / l) * k : 0;
  return out;
}
