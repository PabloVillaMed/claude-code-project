// Bailes y gestos por código de la gente de las discotecas (puro, sin
// three.js): para un instante del compás devuelve la pose como números
// (cadera, pecho, cabeza, pies y manos) y render/dancePoses.js la pone sobre
// el esqueleto, encima de la pose base del personaje. Todo sale del tiempo
// del compás (b, en tiempos de la música del local), así la gente baila a
// tempo y en fase aunque cada quien se anime a otra frecuencia (ANIM_LOD).
//
// Marco del personaje: x a su izquierda, y arriba, z adelante (metros, origen
// en el piso entre los pies). Giros: Rx > 0 se inclina hacia adelante, Ry > 0
// gira a su izquierda, Rz > 0 se ladea a su izquierda.
//
// Quién baila qué y dónde: sim/clubLife.js.

import { unit } from './animSelect.js';

// ------------------------------------------------------------------ configurables
/** Medidas de los bailes (m y rad). */
export const BAILE = {
  /** Salsa: largo del paso básico, distancia entre los dos y altura (m) a la que se toman de las manos. */
  SALSA_PASO: 0.2,
  SALSA_DIST: 0.78,
  SALSA_MANOS: 1.1,
  /** Salsa: una vuelta de ella cada tantos compases de 8 (en promedio). */
  SALSA_VUELTA_CADA: 3,
  /** Reguetón: cuánto baja la cadera en el rebote (m) y cuánto se va a cada lado. */
  REGUETON_REBOTE: 0.045,
  REGUETON_LADO: 0.045,
  /** Electrónica: alto del saltico (m) y tiempos que dura la subida de manos en la caída del bajo (de cada 64). */
  ELECTRO_SALTO: 0.06,
  ELECTRO_CAIDA: 16,
  /** Popular: vaivén a cada lado (m) y cada cuántos tiempos hay brindis (dura 4). */
  POPULAR_LADO: 0.05,
  POPULAR_BRINDIS_CADA: 32,
  /** Abrazo de lado: separación entre los dos (m). */
  ABRAZO_DIST: 0.46,
  /** DJ: cada cuántos tiempos hay cambio (brazo arriba durante 4). */
  DJ_CAMBIO_CADA: 32,
};

const TAU = Math.PI * 2;
const PI = Math.PI;
const sst = (x) => {
  const t = x < 0 ? 0 : x > 1 ? 1 : x;
  return t * t * (3 - 2 * t);
};
const mix = (a, b, t) => a + (b - a) * t;
const mod = (a, n) => ((a % n) + n) % n;

/** Campos de una pose (todos números: se recicla un solo objeto por llamada). */
const CAMPOS = ['hx', 'hy', 'hz', 'cRx', 'cRy', 'cRz', 'tRx', 'tRy', 'tRz', 'kRx', 'kRy', 'kRz', 'piX', 'piY', 'piZ', 'piT', 'pdX', 'pdY', 'pdZ', 'pdT', 'biW', 'biX', 'biY', 'biZ', 'biA', 'bdW', 'bdX', 'bdY', 'bdZ', 'bdA', 'yaw', 'piernas'];

/**
 * Pose en blanco. hx/hy/hz: corrimiento de la cadera; cR*: giro de las
 * caderas; tR*: del pecho; kR*: de la cabeza; pi* / pd*: corrimiento del pie
 * izquierdo / derecho y talón levantado (T, rad); bi* / bd*: mano izquierda /
 * derecha (W = peso 0..1; X, Y, Z = dónde; A = 0: medido desde su hombro,
 * 1: en el marco del personaje desde el piso); yaw: giro de todo el cuerpo
 * (la vuelta); piernas: 1 = se acomodan las piernas (de pie), 0 = no (sentado).
 */
export function nuevaPose() {
  const o = {};
  for (const k of CAMPOS) o[k] = 0;
  o.piernas = 1;
  return o;
}

export function limpiarPose(o) {
  for (let i = 0; i < CAMPOS.length; i++) o[CAMPOS[i]] = 0;
  o.piernas = 1;
  return o;
}

/** La misma pose vista en un espejo (izquierda por derecha). */
export function espejarPose(o) {
  o.hx = -o.hx;
  o.cRy = -o.cRy;
  o.cRz = -o.cRz;
  o.tRy = -o.tRy;
  o.tRz = -o.tRz;
  o.kRy = -o.kRy;
  o.kRz = -o.kRz;
  let t;
  t = o.piX; o.piX = -o.pdX; o.pdX = -t;
  t = o.piY; o.piY = o.pdY; o.pdY = t;
  t = o.piZ; o.piZ = o.pdZ; o.pdZ = t;
  t = o.piT; o.piT = o.pdT; o.pdT = t;
  t = o.biW; o.biW = o.bdW; o.bdW = t;
  t = o.biX; o.biX = -o.bdX; o.bdX = -t;
  t = o.biY; o.biY = o.bdY; o.bdY = t;
  t = o.biZ; o.biZ = o.bdZ; o.bdZ = t;
  t = o.biA; o.biA = o.bdA; o.bdA = t;
  o.yaw = -o.yaw;
  return o;
}

// Manos: m = [peso, x, y, z] ×2 (izquierda, derecha), desde el hombro.
const _m0 = new Float64Array(8);
const _m1 = new Float64Array(8);
function mano(m, lado, w, x, y, z) {
  const i = lado * 4;
  m[i] = w;
  m[i + 1] = x;
  m[i + 2] = y;
  m[i + 3] = z;
}
function ponerManos(o, m0, m1, u) {
  o.biW = mix(m0[0], m1[0], u);
  o.biX = mix(m0[1], m1[1], u);
  o.biY = mix(m0[2], m1[2], u);
  o.biZ = mix(m0[3], m1[3], u);
  o.bdW = mix(m0[4], m1[4], u);
  o.bdX = mix(m0[5], m1[5], u);
  o.bdY = mix(m0[6], m1[6], u);
  o.bdZ = mix(m0[7], m1[7], u);
  o.biA = 0;
  o.bdA = 0;
}

// ------------------------------------------------------------------ reguetón
/** Qué hacen los brazos en la frase k (8 tiempos): 0 al frente, 1 una arriba, 2 las dos arriba, 3 sueltos. */
export function brazosRegueton(id, k) {
  const r = unit(id, k * 7 + 3);
  return r < 0.42 ? 0 : r < 0.62 ? 1 : r < 0.74 ? 2 : 3;
}

function manosRegueton(m, modo, b, e) {
  const c1 = Math.cos(TAU * b);
  const s2 = Math.sin(PI * b);
  // Al frente: antebrazos doblados, puños que suben y bajan alternados con el bajo.
  mano(m, 0, 0.85, 0.1, -0.24 + 0.05 * c1 * e, 0.27);
  mano(m, 1, 0.85, -0.1, -0.24 - 0.05 * c1 * e, 0.27);
  if (modo === 1) mano(m, 0, 1, 0.16 + 0.07 * s2, 0.4 + 0.05 * c1, 0.12);
  else if (modo === 2) {
    mano(m, 0, 1, 0.2 + 0.06 * s2, 0.4 + 0.05 * c1, 0.1);
    mano(m, 1, 1, -0.2 + 0.06 * s2, 0.4 + 0.05 * c1, 0.1);
  } else if (modo === 3) {
    mano(m, 0, 0.35, 0.14, -0.4, 0.16 + 0.05 * s2);
    mano(m, 1, 0.35, -0.14, -0.4, 0.16 - 0.05 * s2);
  }
}

/** Reguetón: rebote de rodillas con el bajo, cadera de lado a lado, hombros al contrario y brazos por frases. */
export function poseRegueton(o, b, P) {
  const e = P.energia ?? 1;
  const c1 = Math.cos(TAU * b); // 1 en cada tiempo
  const c2 = Math.cos(PI * b); // +1 / -1: de qué lado está el peso
  const s2 = Math.sin(PI * b);
  o.hy = -(0.03 + BAILE.REGUETON_REBOTE * (0.5 + 0.5 * c1)) * e;
  o.hx = BAILE.REGUETON_LADO * e * c2;
  o.hz = -0.025 * e;
  o.cRz = -0.1 * e * c2;
  o.cRy = 0.07 * e * s2;
  o.cRx = 0.06;
  o.tRx = 0.1 + 0.035 * c1 * e;
  o.tRz = 0.035 * e * c2;
  o.tRy = -0.1 * e * s2;
  o.kRx = 0.05 * c1;
  o.kRz = 0.03 * c2;
  o.piX = 0.07;
  o.pdX = -0.07;
  // El talón del pie sin peso se levanta.
  o.piT = 0.32 * e * Math.max(0, -c2);
  o.pdT = 0.32 * e * Math.max(0, c2);
  const k = Math.floor(b / 8);
  const u = sst(b - k * 8 - 7);
  manosRegueton(_m0, brazosRegueton(P.id, k), b, e);
  manosRegueton(_m1, brazosRegueton(P.id, k + 1), b, e);
  ponerManos(o, _m0, _m1, u);
  return o;
}

// ------------------------------------------------------------------ electrónica
/** Caída del bajo (0..1): de cada 64 tiempos, los primeros ELECTRO_CAIDA todo el mundo sube las manos. */
export function caidaElectronica(b) {
  const t = mod(b, 64);
  return sst(t / 1.5) * (1 - sst((t - BAILE.ELECTRO_CAIDA) / 2));
}

function manosElectro(m, modo, b, e) {
  const c1 = Math.cos(TAU * b);
  // Brazos doblados a los lados, marcando.
  mano(m, 0, 0.6, 0.12, -0.3 + 0.04 * c1, 0.22);
  mano(m, 1, 0.6, -0.12, -0.3 + 0.04 * c1, 0.22);
  // Puño arriba (sube en cada tiempo).
  if (modo === 0 || modo === 2) mano(m, 1, 1, -0.13, 0.36 + 0.13 * c1 * e, 0.16);
  if (modo === 1 || modo === 2) mano(m, 0, 1, 0.13, 0.36 + 0.13 * c1 * e, 0.16);
}

const modoElectro = (id, q) => {
  const r = unit(id, q * 5 + 1);
  return r < 0.5 ? 0 : r < 0.8 ? 1 : 3;
};

/** Electrónica: saltico con el bombo, cabeza marcando y puño arriba (las dos manos en la caída). */
export function poseElectronica(o, b, P) {
  const e = P.energia ?? 1;
  const c1 = Math.cos(TAU * b);
  const f = b - Math.floor(b);
  const caida = caidaElectronica(b);
  const salto = Math.sin(PI * f) * BAILE.ELECTRO_SALTO * e * (1 + 0.5 * caida);
  o.hy = -0.035 + salto;
  // Los pies despegan apenas en lo más alto del salto.
  const aire = Math.max(0, salto - 0.035) * 0.9;
  o.piY = aire;
  o.pdY = aire;
  o.piT = o.pdT = Math.min(0.45, salto * 6);
  o.piX = 0.05;
  o.pdX = -0.05;
  o.hz = -0.015;
  o.tRx = 0.08 + 0.06 * c1 * e;
  o.kRx = 0.1 * c1 * e;
  o.tRy = 0.05 * Math.sin(PI * b) * e;
  const k = Math.floor(b / 16);
  const u = sst(b - k * 16 - 15);
  manosElectro(_m0, modoElectro(P.id, k), b, e);
  manosElectro(_m1, modoElectro(P.id, k + 1), b, e);
  ponerManos(o, _m0, _m1, u);
  if (caida > 0.01) {
    manosElectro(_m0, 2, b, e);
    o.biW = mix(o.biW, 1, caida);
    o.biX = mix(o.biX, _m0[1] + 0.06, caida);
    o.biY = mix(o.biY, _m0[2] + 0.05, caida);
    o.biZ = mix(o.biZ, _m0[3], caida);
    o.bdW = mix(o.bdW, 1, caida);
    o.bdX = mix(o.bdX, _m0[5] - 0.06, caida);
    o.bdY = mix(o.bdY, _m0[6] + 0.05, caida);
    o.bdZ = mix(o.bdZ, _m0[7], caida);
  }
  return o;
}

// ------------------------------------------------------------------ salsa
const _paso = { pi: 0, pd: 0, li: 0, ld: 0, z: 0, peso: 0 };
const PASO_T = 0.62; // fracción de la cuenta que dura mover el pie
const SALSA_Z = [0, 0.55, 0.12, 0, 0, -0.55, -0.12, 0, 0];
const SALSA_PESO = [-1, 1, -1, 1, 1, -1, 1, -1, -1];

/**
 * Paso básico de salsa del que lleva, en la cuenta c (0..8): en 1 el pie
 * izquierdo adelante, 2 el peso vuelve al derecho, 3 el izquierdo regresa, 4
 * pausa; en 5 el derecho atrás, 6 el peso al izquierdo, 7 regresa, 8 pausa.
 * La pareja hace lo mismo corrido 4 cuentas (en 1 el derecho atrás).
 * Devuelve {pi, pd: corrimiento adelante (+) de cada pie; li, ld: cuánto se
 * levanta; z: cuerpo adelante/atrás; peso: -1 en el pie derecho .. +1 en el
 * izquierdo}, con el largo del paso en 1.
 */
export function pasoSalsa(c, o = _paso) {
  c = mod(c, 8);
  const n = Math.floor(c);
  const f = c - n;
  const u = sst(f / PASO_T);
  const arco = f < PASO_T ? Math.sin((PI * f) / PASO_T) : 0;
  o.pi = n === 0 ? u : n === 1 ? 1 : n === 2 ? 1 - u : 0;
  o.li = n === 0 || n === 2 ? arco : 0;
  o.pd = n === 4 ? -u : n === 5 ? -1 : n === 6 ? -(1 - u) : 0;
  o.ld = n === 4 || n === 6 ? arco : 0;
  // Cuerpo y peso: los valores al final de cada cuenta.
  o.z = mix(SALSA_Z[n], SALSA_Z[n + 1], u);
  o.peso = mix(SALSA_PESO[n], SALSA_PESO[n + 1], sst(f / 0.8));
  return o;
}

/** ¿En el compás de 8 número k la pareja `unidad` hace la vuelta? */
export function hayVuelta(unidad, k) {
  return unit(unidad * 31 + 7, k) < 1 / BAILE.SALSA_VUELTA_CADA;
}

/** Cuánto ha girado ella (rad, hacia su derecha) en la cuenta cc de un compás con vuelta: de 0 a una vuelta entera entre las cuentas 5 y 7. */
export function giroVuelta(cc) {
  return -TAU * sst((cc - 4.2) / 2.8);
}

/**
 * Salsa en pareja. P: {lider, unidad, dist, alto, altoPareja, energia,
 * cuentas (por tiempo)}. Los dos se toman de las manos al frente (la
 * izquierda de él con la derecha de ella y al revés) y de vez en cuando ella
 * da la vuelta por debajo del brazo de él.
 */
export function poseSalsa(o, b, P) {
  const e = P.energia ?? 1;
  const n = P.cuentas ?? 2;
  const cc = mod(b * n, 8); // cuenta de la pareja (la del que lleva)
  const k = Math.floor((b * n) / 8);
  const vuelta = hayVuelta(P.unidad ?? 0, k);
  const lider = !!P.lider;
  const arriba = vuelta ? sst((cc - 3.4) / 0.8) * (1 - sst((cc - 7) / 0.8)) : 0;
  const s = pasoSalsa(lider ? cc : cc + 4);
  const L = BAILE.SALSA_PASO * e * (!lider && arriba > 0 ? 1 - 0.65 * arriba : 1);
  o.piZ = s.pi * L;
  o.pdZ = s.pd * L;
  o.piY = s.li * 0.035;
  o.pdY = s.ld * 0.035;
  o.piT = s.li * 0.25;
  o.pdT = s.ld * 0.25;
  o.hz = s.z * L;
  o.hx = 0.03 * s.peso * e;
  o.hy = -0.03 - 0.012 * Math.abs(s.z);
  o.cRz = -0.1 * s.peso * e;
  o.cRy = 0.07 * s.peso * e;
  o.tRz = 0.03 * s.peso;
  o.tRy = -0.06 * s.peso * e;
  o.tRx = 0.03;
  // Manos: en el marco de cada uno el punto de encuentro queda a media
  // distancia, corrido con el cuerpo (los dos se mueven a la par).
  const D = P.dist ?? BAILE.SALSA_DIST;
  const d = D / 2 + o.hz;
  const ronda = (PI * cc) / 2;
  const lado = lider ? 1 : -1; // la mano A (izquierda de él, derecha de ella) queda a la izquierda de él
  const by = BAILE.SALSA_MANOS - 0.04 + 0.05 * Math.sin(ronda + 2.6);
  let x = lado * (0.25 + 0.03 * Math.sin(ronda));
  let y = BAILE.SALSA_MANOS + 0.05 * Math.sin(ronda + 1);
  let z = d;
  if (arriba > 0) {
    // Él la lleva por encima de la cabeza de ella; ella sube la mano sobre la suya.
    x = mix(x, lider ? 0.05 : -0.03, arriba);
    y = mix(y, lider ? (P.altoPareja ?? 1.64) + 0.2 : (P.alto ?? 1.64) + 0.16, arriba);
    z = mix(z, lider ? D - 0.1 + o.hz : 0.07, arriba);
  }
  if (P.solo) {
    // Sin pareja (el jugador solo en la pista): brazos doblados que acompañan el paso.
    o.biW = 0.85; o.biA = 0; o.biX = 0.1; o.biY = -0.25 + 0.05 * s.peso * e; o.biZ = 0.24 + 0.06 * s.z;
    o.bdW = 0.85; o.bdA = 0; o.bdX = -0.1; o.bdY = -0.25 - 0.05 * s.peso * e; o.bdZ = 0.24 - 0.06 * s.z;
  } else if (lider) {
    o.biW = 1; o.biX = x; o.biY = y; o.biZ = z; o.biA = 1;
    o.bdW = 0.95 * (1 - arriba); o.bdX = -0.25; o.bdY = by; o.bdZ = d; o.bdA = 1;
  } else {
    o.bdW = 1; o.bdX = x; o.bdY = y; o.bdZ = z; o.bdA = 1;
    o.biW = 0.95 * (1 - arriba); o.biX = 0.25; o.biY = by; o.biZ = d; o.biA = 1;
    if (vuelta) o.yaw = giroVuelta(cc);
  }
  return o;
}

// ------------------------------------------------------------------ música popular
/** Brindis (0..1) en el tiempo b para el grupo `unidad`: de vez en cuando todos alzan el vaso 4 tiempos. */
export function brindis(b, unidad = 0) {
  const n = BAILE.POPULAR_BRINDIS_CADA;
  const t = mod(b + unit(unidad, 17) * n, n);
  return sst(t / 1.2) * (1 - sst((t - 4) / 1.2));
}

/** Música popular de pie: vaivén lento de lado a lado con el vaso en la mano, y brindis con el vaso arriba. */
export function posePopular(o, b, P) {
  const e = P.energia ?? 1;
  const c = Math.cos((PI * b) / 2); // un vaivén cada 4 tiempos
  const s = Math.sin((PI * b) / 2);
  o.hx = BAILE.POPULAR_LADO * e * c;
  o.hy = -0.02 - 0.012 * Math.abs(s);
  o.cRz = -0.06 * e * c;
  o.tRz = 0.05 * e * c;
  o.tRy = 0.05 * s;
  o.kRz = 0.05 * c;
  o.kRx = -0.03;
  o.piT = 0.22 * Math.max(0, -c) * e;
  o.pdT = 0.22 * Math.max(0, c) * e;
  const br = brindis(b, P.unidad ?? P.id);
  // El vaso en la derecha, a la altura del pecho; en el brindis, arriba.
  o.bdW = 0.9;
  o.bdX = mix(-0.08, -0.16, br);
  o.bdY = mix(-0.22 + 0.02 * s, 0.38 + 0.03 * Math.sin(TAU * b), br);
  o.bdZ = mix(0.26, 0.3, br);
  // La otra mano marca el compás (o al aire, cantando).
  const canta = unit(P.id, Math.floor(b / 16) + 5) < 0.4 ? 1 : 0;
  o.biW = 0.55 + 0.4 * canta;
  o.biX = 0.16 + 0.1 * canta;
  o.biY = mix(-0.34, 0.08 + 0.06 * c, canta);
  o.biZ = 0.2 + 0.08 * canta;
  return o;
}

/**
 * Abrazo de lado cantando (dos amigos): el de la izquierda (P.lider) le pasa
 * el brazo derecho por los hombros al otro, que lo abraza por la espalda; se
 * mecen a la par y el de la derecha alza el vaso.
 */
export function poseAbrazo(o, b, P) {
  const e = P.energia ?? 1;
  const c = Math.cos((PI * b) / 2);
  const s = Math.sin((PI * b) / 2);
  const D = P.dist ?? BAILE.ABRAZO_DIST;
  o.hx = 0.055 * e * c;
  o.hy = -0.02;
  o.cRz = -0.04 * c;
  o.tRz = 0.07 * e * c;
  o.kRz = 0.06 * c;
  o.kRx = -0.08 + 0.04 * Math.sin(PI * b);
  o.piT = 0.2 * Math.max(0, -c);
  o.pdT = 0.2 * Math.max(0, c);
  const br = brindis(b, P.unidad ?? 0);
  if (P.lider) {
    // Brazo derecho sobre los hombros del amigo (que está a su derecha).
    o.bdW = 1; o.bdA = 1; o.bdX = -(D + 0.13); o.bdY = (P.hombroPareja ?? 1.4) + 0.04; o.bdZ = -0.05;
    // La izquierda al aire, cantando.
    o.biW = 0.9; o.biX = 0.24 + 0.05 * s; o.biY = mix(0.02 + 0.08 * Math.sin(PI * b), 0.36, br); o.biZ = 0.24;
  } else {
    // Brazo izquierdo por la espalda del amigo; el vaso en la derecha.
    o.biW = 1; o.biA = 1; o.biX = D + 0.06; o.biY = (P.hombroPareja ?? 1.4) - 0.3; o.biZ = -0.14;
    o.bdW = 0.9; o.bdX = -0.1; o.bdY = mix(-0.2, 0.38, br); o.bdZ = 0.27;
  }
  return o;
}

/** De pie sin bailar (en la barra, en una mesa alta, en la baranda): se mece apenas con la música. */
export function poseMeneo(o, b, P) {
  const e = (P.energia ?? 1) * 0.6;
  const c = Math.cos(PI * b * (P.lento ? 0.5 : 1));
  const c1 = Math.cos(TAU * b);
  o.hx = 0.025 * e * c;
  o.hy = -0.012 - 0.012 * e * (0.5 + 0.5 * c1);
  o.cRz = -0.04 * e * c;
  o.tRz = 0.02 * e * c;
  o.kRx = 0.035 * c1 * e;
  return o;
}

/** Sentado: el torso se mece, marca con la cabeza y en el brindis alza el vaso (P.brindis = false: sin vaso). */
export function poseSentado(o, b, P) {
  const e = P.energia ?? 1;
  const c = Math.cos((PI * b) / (P.lento ? 2 : 1));
  o.piernas = 0;
  o.tRz = 0.035 * e * c;
  o.kRx = 0.03 * Math.cos(TAU * b) * e;
  o.kRz = 0.03 * c;
  const br = P.brindis === false ? 0 : brindis(b, P.unidad ?? P.id);
  if (br > 0.01) {
    o.bdW = br;
    o.bdX = -0.12;
    o.bdY = 0.3 + 0.02 * Math.sin(TAU * b);
    o.bdZ = 0.34;
    o.tRx = -0.05 * br;
  }
  return o;
}

/** Sentado y asustado: doblado hacia adelante, cubriéndose la cabeza con los brazos. w 0..1. */
export function poseCubrirse(o, w, t = 0) {
  o.piernas = 0;
  o.tRx = 0.85 * w;
  o.kRx = 0.25 * w;
  o.tRz = 0.02 * Math.sin(t * 9) * w;
  o.biW = w; o.biX = 0.07; o.biY = 0.2; o.biZ = 0.2;
  o.bdW = w; o.bdX = -0.07; o.bdY = 0.2; o.bdZ = 0.2;
  return o;
}

// ------------------------------------------------------------------ los que trabajan
/** ¿Hay cambio de canción (0..1)? Cada DJ_CAMBIO_CADA tiempos, 4 tiempos con el brazo arriba. */
export function cambioDJ(b) {
  const t = mod(b, BAILE.DJ_CAMBIO_CADA);
  return sst(t / 0.8) * (1 - sst((t - 4) / 1));
}

/**
 * DJ: marca el tiempo con el cuerpo, una mano en los audífonos y la otra en
 * la consola (P.consolaY: alto de la consola sobre sus pies, P.consolaZ: qué
 * tan adelante); en los cambios levanta el brazo.
 */
export function poseDJ(o, b, P) {
  const c1 = Math.cos(TAU * b);
  const c2 = Math.cos(PI * b);
  const cy = (P.consolaY ?? 1.12) + 0.05;
  const cz = P.consolaZ ?? 0.55;
  const alto = P.alto ?? 1.74;
  o.hy = -0.02 - 0.03 * (0.5 + 0.5 * c1);
  o.hx = 0.02 * c2;
  o.tRx = 0.12 + 0.04 * c1;
  o.kRx = 0.07 * c1;
  o.cRz = -0.04 * c2;
  const cambio = cambioDJ(b);
  // Frases de 16 tiempos: con una mano en el audífono, o las dos en la consola.
  const k = Math.floor(b / 16);
  const u = sst(b - k * 16 - 15);
  const f0 = unit(P.id, k) < 0.6 ? 1 : 0;
  const f1 = unit(P.id, k + 1) < 0.6 ? 1 : 0;
  const aud = mix(f0, f1, u) * (1 - cambio);
  // Izquierda: al audífono (junto a la oreja) o a la consola.
  o.biW = 1;
  o.biA = 1;
  o.biX = mix(0.24 + 0.03 * Math.sin(b * 1.3), 0.1, aud);
  o.biY = mix(cy, alto - 0.13, aud);
  o.biZ = mix(cz - 0.08, 0.05, aud);
  o.kRz = 0.12 * aud;
  // Derecha: en la consola (rasca el disco, mueve perillas) o arriba en el cambio.
  o.bdW = 1;
  o.bdA = 1;
  o.bdX = mix(-0.22 + 0.05 * Math.sin(TAU * b * 0.5), -0.2, cambio);
  o.bdY = mix(cy + 0.015 * Math.abs(Math.sin(TAU * b)), alto + 0.22 + 0.1 * c1, cambio);
  o.bdZ = mix(cz + 0.04 * Math.sin(TAU * b * 0.5 + 1), 0.2, cambio);
  return o;
}

/** Qué hace el bartender en el momento t (s): 'servir', 'limpiar' o 'atender' (ciclos de 8 s, distintos para cada uno). */
export function oficioBartender(id, t) {
  const r = unit(id, Math.floor(t / 8) + 11);
  return r < 0.4 ? 'servir' : r < 0.75 ? 'limpiar' : 'atender';
}

/** Bartender: sirve (botella inclinada sobre el vaso) o limpia la barra en círculos. P.barraY / P.barraZ: alto y distancia de la barra. */
export function poseBartender(o, t, P) {
  const oficio = oficioBartender(P.id, t);
  const f = (t % 8) / 8;
  const w = sst(f / 0.12) * (1 - sst((f - 0.88) / 0.12));
  const y = (P.barraY ?? 1.1) + 0.04;
  const z = P.barraZ ?? 0.62;
  o.piernas = 0;
  if (oficio === 'servir') {
    o.tRx = 0.14 * w;
    o.kRx = 0.2 * w;
    // La izquierda sostiene el vaso sobre la barra; la derecha sirve.
    o.biW = w; o.biA = 1; o.biX = 0.1; o.biY = y + 0.03; o.biZ = z;
    o.bdW = w; o.bdA = 1; o.bdX = -0.06; o.bdY = y + 0.22 + 0.03 * Math.sin(t * 2.2); o.bdZ = z - 0.04;
  } else if (oficio === 'limpiar') {
    o.tRx = 0.2 * w;
    o.kRx = 0.15 * w;
    o.tRy = 0.08 * Math.sin(t * 2.6) * w;
    o.bdW = w; o.bdA = 1; o.bdX = -0.12 + 0.2 * Math.cos(t * 2.6); o.bdY = y; o.bdZ = z + 0.07 * Math.sin(t * 2.6);
    o.biW = 0.8 * w; o.biA = 1; o.biX = 0.3; o.biY = y; o.biZ = z - 0.12;
  }
  return o;
}

/** Golpe de tambor (0..1, arriba = 1) para la mano k (0/1) a `golpes` por tiempo. */
const golpe = (b, golpes, k) => Math.max(0, Math.sin(PI * (b * golpes + k)));

/**
 * Músicos de la tarima y animador. inst: 'congas', 'timbales', 'bongó',
 * 'piano', 'voz', 'maracas' o 'animador'. P: {tamborY: alto del parche o del
 * teclado sobre sus pies, tamborZ: qué tan adelante, alto}.
 */
export function poseMusico(o, inst, b, P) {
  const c1 = Math.cos(TAU * b);
  const c2 = Math.cos(PI * b);
  const y = P.tamborY ?? 0.85;
  const z = P.tamborZ ?? 0.4;
  o.hy = -0.015 - 0.02 * (0.5 + 0.5 * c1);
  o.kRx = 0.05 * c1;
  if (inst === 'congas' || inst === 'bongó' || inst === 'timbales') {
    const ancho = inst === 'timbales' ? 0.2 : inst === 'bongó' ? 0.11 : 0.17;
    const alto = inst === 'timbales' ? 0.16 : 0.11;
    o.tRx = 0.16;
    o.hx = 0.015 * c2;
    o.tRy = 0.05 * c2;
    o.biW = 1; o.biA = 1; o.biX = ancho; o.biY = y + 0.03 + alto * golpe(b, 2, 0); o.biZ = z;
    o.bdW = 1; o.bdA = 1; o.bdX = -ancho; o.bdY = y + 0.03 + alto * golpe(b, 2, 1); o.bdZ = z + (inst === 'timbales' ? 0.05 : 0);
  } else if (inst === 'piano') {
    o.tRx = 0.14 + 0.03 * c1;
    o.kRx = 0.12;
    const m = 0.07 * Math.sin(PI * b * 0.5);
    o.biW = 1; o.biA = 1; o.biX = 0.24 + m; o.biY = y + 0.03 + 0.03 * golpe(b, 2, 0); o.biZ = z;
    o.bdW = 1; o.bdA = 1; o.bdX = -0.22 + m; o.bdY = y + 0.03 + 0.03 * golpe(b, 2, 1); o.bdZ = z;
  } else if (inst === 'maracas') {
    // Pasito de lado a lado del coro, maracas a la altura del pecho.
    o.hx = 0.04 * c2;
    o.cRz = -0.06 * c2;
    o.piT = 0.25 * Math.max(0, -c2);
    o.pdT = 0.25 * Math.max(0, c2);
    o.biW = 1; o.biX = 0.13; o.biY = -0.2 + 0.07 * golpe(b, 2, 0); o.biZ = 0.3;
    o.bdW = 1; o.bdX = -0.13; o.bdY = -0.2 + 0.07 * golpe(b, 2, 1); o.bdZ = 0.3;
  } else {
    // Cantante / animador: micrófono en la derecha junto a la boca; la izquierda le habla al público.
    const anim = inst === 'animador';
    const k = Math.floor(b / 8);
    const u = sst(b - k * 8 - 7);
    const p = anim ? 0.45 : 0.25;
    const arriba = mix(unit(P.id, k * 3 + 2) < p ? 1 : 0, unit(P.id, k * 3 + 5) < p ? 1 : 0, u);
    o.hx = 0.04 * c2;
    o.cRz = -0.06 * c2;
    o.tRy = (anim ? 0.22 : 0.1) * Math.sin((PI * b) / 4);
    o.kRx = -0.04;
    o.piT = 0.22 * Math.max(0, -c2);
    o.pdT = 0.22 * Math.max(0, c2);
    o.bdW = 1; o.bdA = 1; o.bdX = -0.07; o.bdY = (P.alto ?? 1.7) - 0.2; o.bdZ = 0.17;
    o.biW = 0.95; o.biX = mix(0.26, 0.2, arriba) + 0.05 * Math.sin(PI * b); o.biY = mix(-0.2 + 0.05 * c1, 0.38 + 0.06 * c1, arriba); o.biZ = mix(0.28, 0.16, arriba);
  }
  return o;
}

/** Mesero que camina con la bandeja en alto (mano izquierda a la altura del hombro). */
export function poseMesero(o, t) {
  o.piernas = 0;
  o.biW = 1;
  o.biX = 0.2;
  o.biY = 0.06 + 0.008 * Math.sin(t * 5);
  o.biZ = 0.24;
  return o;
}

/** Billar: el que tira (doblado sobre la mesa, la derecha atrás con el taco y la izquierda de puente) y el que espera. P: {tira, mesaY}. */
export function poseBillar(o, t, P) {
  if (P.tira) {
    const g = (t % 5) / 5;
    const atras = g < 0.8 ? 0.06 * Math.sin(g * 14) : -0.16 * sst((g - 0.8) / 0.06) * (1 - sst((g - 0.9) / 0.1));
    const y = P.mesaY ?? 0.86;
    o.hz = -0.16;
    o.hy = -0.1;
    o.cRx = 0.25;
    o.tRx = 0.95;
    o.kRx = -0.5;
    o.piZ = 0.16;
    o.pdZ = -0.22;
    o.biW = 1; o.biA = 1; o.biX = 0.1; o.biY = y + 0.04; o.biZ = 0.62;
    o.bdW = 1; o.bdA = 1; o.bdX = -0.22; o.bdY = y + 0.12; o.bdZ = 0.02 + atras;
  } else {
    o.piernas = 0;
    o.bdW = 0.9; o.bdX = -0.12; o.bdY = -0.24; o.bdZ = 0.22;
  }
  return o;
}

/** Frente a la rockola: escoge la canción (la derecha en los botones). */
export function poseRockola(o, t, P) {
  const w = 0.5 + 0.5 * Math.sin(t * 0.7 + (P.id % 7));
  o.piernas = 0;
  o.tRx = 0.12 * w;
  o.kRx = 0.18 * w;
  o.bdW = sst(w * 1.4); o.bdA = 1; o.bdX = -0.1 + 0.05 * Math.sin(t * 1.9); o.bdY = 1.12 + 0.04 * Math.sin(t * 2.7); o.bdZ = 0.42;
  return o;
}

/**
 * Palmas al compás (el corro alrededor del que baila): las manos se juntan
 * al frente en cada tiempo y el cuerpo rebota apenas. P.energia.
 */
export function poseAplauso(o, b, P) {
  const e = P.energia ?? 1;
  const c1 = Math.cos(TAU * b);
  const c2 = Math.cos(PI * b);
  const abre = 0.11 * (0.5 - 0.5 * c1); // 0 justo en el tiempo (palmada)
  o.hy = -0.015 - 0.02 * (0.5 + 0.5 * c1) * e;
  o.hx = 0.02 * c2 * e;
  o.cRz = -0.04 * c2 * e;
  o.tRx = 0.05;
  o.kRx = 0.04 * c1;
  o.piT = 0.18 * Math.max(0, -c2) * e;
  o.pdT = 0.18 * Math.max(0, c2) * e;
  // Desde cada hombro hacia el centro del pecho.
  o.biW = 1; o.biX = -0.15 + abre; o.biY = -0.2; o.biZ = 0.3;
  o.bdW = 1; o.bdX = 0.15 - abre; o.bdY = -0.2; o.bdZ = 0.3;
  return o;
}

/** Estilos de baile de la pista. */
export const ESTILOS = ['regueton', 'salsa', 'popular', 'electronica'];

/**
 * Pose de baile del estilo `estilo` en el tiempo b (ya con el desfase de la
 * persona). P.espejo < 0: bailado al revés (izquierda por derecha); la salsa
 * en pareja y el abrazo no se espejan (los lados los define la pareja).
 */
export function poseBaile(o, estilo, b, P) {
  limpiarPose(o);
  if (estilo === 'salsa') return poseSalsa(o, b, P);
  if (estilo === 'abrazo') return poseAbrazo(o, b, P);
  if (estilo === 'aplauso') return poseAplauso(o, b, P);
  if (estilo === 'regueton') poseRegueton(o, b, P);
  else if (estilo === 'electronica') poseElectronica(o, b, P);
  else if (estilo === 'popular') posePopular(o, b, P);
  else poseMeneo(o, b, P);
  if ((P.espejo ?? 1) < 0) espejarPose(o);
  return o;
}
