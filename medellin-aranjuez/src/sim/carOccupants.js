// Los que van adentro de un carro (conductor y copiloto) como blancos de un
// tiro: la bala que entra por los vidrios (ventanas, parabrisas, vidrio de
// atrás) le puede dar al de adentro; la que pega en la lata (puertas, capó,
// baúl, techo) le pega al carro, como siempre. Y el carro que se queda con el
// conductor muerto o grave: pierde el control, sigue rodando, se desvía y
// frena solo (o choca). Puro y testeable: game/occupants.js lo usa para
// armar la escena del tiro (Combat._scene) y para manejar el carro sin control.
//
// Marco local del vehículo (el de vehicleMesh): x a la derecha, y arriba
// desde el piso, z hacia atrás (adelante es -Z).

import { rayVsSphere, rayVsVerticalCapsule } from './collision.js';

/** m de holgura del descarte barato de rayVsCar sobre el círculo que encierra la planta del carro (por si la cabina medida sobresale un poco). */
export const DESCARTE_MARGEN = 0.6;

// ------------------------------------------------ cuerpo sentado (ajustables)
// Medidas del cuerpo sentado en el carro, desde la pelvis, en m. Sacadas del
// esqueleto del conductor en los doce modelos (sonda): la pelvis queda
// siempre 0,22 m sobre el puesto (vehicleMesh seat.y), el hueso de la cabeza
// 0,53 m más arriba y un poco más atrás (van recostados en la silla).
export const OCUPANTE_HIT = {
  pelvis: 0.22, // m de la pelvis sobre el puesto (vehicleMesh seat.y)
  headUp: 0.62, // m del centro de la cabeza sobre la pelvis
  headBack: 0.04, // m de la cabeza detrás de la pelvis (recostado)
  headR: 0.14, // radio de la cabeza
  torsoBottom: 0.08, // m sobre la pelvis: centro de la esfera de abajo del torso
  torsoTop: 0.3, // m sobre la pelvis: centro de la esfera de arriba (hombros a ~0,47)
  torsoR: 0.2, // radio del torso
  torsoBack: 0.04, // m del eje del torso detrás de la pelvis
  // Desplomado sobre el timón (muerto o grave): la cabeza y los hombros se van
  // adelante y abajo, hacia el timón.
  slumpFwd: 0.3, // m que se corre la cabeza hacia adelante
  slumpDown: 0.2, // m que baja la cabeza
};

// ------------------------------------------------ cabina por modelo (medidas)
// Zona de vidrios de cada modelo (variante de sim/vehicleVariants.js), medida
// con rayos contra los triángulos del modelo ya escalado (sonda cabina2):
// belt = altura de la base de las ventanas al lado del puesto (cintura), roof
// = techo (lata) sobre el puesto, gx = x del vidrio lateral (los de cabina
// angosta, como el clásico, tienen el vidrio más adentro que la puerta),
// ws = parabrisas [y abajo, z abajo, y arriba, z arriba] y rw = vidrio de
// atrás igual. La cabina es el sólido entre los dos costados (±gx), la
// cintura, el techo y los planos del parabrisas y del vidrio de atrás; lo que
// queda debajo de la cintura (largo y ancho completos) es la lata.
export const CABINAS = {
  taxi: { belt: 1.03, roof: 1.46, gx: 0.68, ws: [1.03, -0.98, 1.38, -0.26], rw: [1.08, 1.8, 1.32, 1.65] },
  hatch_pequeno: { belt: 0.89, roof: 1.33, gx: 0.67, ws: [0.94, -0.76, 1.3, -0.2], rw: [0.91, 1.57, 1.26, 1.22] },
  sedan_compacto: { belt: 0.95, roof: 1.43, gx: 0.73, ws: [0.97, -1.03, 1.32, -0.43], rw: [1.06, 1.64, 1.36, 1.12] },
  sedan: { belt: 1.05, roof: 1.46, gx: 0.68, ws: [1.05, -1.14, 1.32, -0.52], rw: [1.19, 1.59, 1.42, 0.91] },
  hatch_compacto: { belt: 0.86, roof: 1.34, gx: 0.62, ws: [0.94, -0.85, 1.25, -0.25], rw: [0.92, 1.7, 1.2, 1.47] },
  clasico: { belt: 0.99, roof: 1.42, gx: 0.48, ws: [1.09, -0.58, 1.36, -0.38], rw: [1.04, 1.66, 1.3, 1.65] },
  camioneta: { belt: 1.09, roof: 1.55, gx: 0.77, ws: [1.16, -1.05, 1.44, -0.44], rw: [1.21, 1.98, 1.48, 1.76] },
  suv_compacta: { belt: 1.08, roof: 1.57, gx: 0.75, ws: [1.12, -0.96, 1.48, -0.32], rw: [1.19, 2.0, 1.51, 1.73] },
  suv_mediana: { belt: 1.16, roof: 1.58, gx: 0.8, ws: [1.13, -1.06, 1.53, -0.27], rw: [1.2, 2.11, 1.46, 1.71] },
  buseta: { belt: 1.4, roof: 2.49, gx: 1.13, ws: [1.34, -3.72, 2.44, -3.08], rw: [1.74, 3.87, 2.53, 3.73] },
};
// Variantes con el mismo modelo y las mismas medidas.
CABINAS.taxi_pequeno = CABINAS.hatch_pequeno;
CABINAS.taxi_sedan = CABINAS.sedan_compacto;
CABINAS.policia = CABINAS.camioneta;

const _fallback = new Map();

/**
 * Cabina de una variante (CABINAS) o, para un modelo sin medir (o el carro
 * procedural de respaldo), una estimada con las medidas del tipo. Además de
 * las medidas trae los planos ya armados (una sola vez por variante).
 */
export function cabinaDe(variant, spec) {
  const base = CABINAS[variant];
  if (base) return base.planes ? base : armarCabina(base);
  const key = `${spec.length}|${spec.width}|${spec.height}`;
  let c = _fallback.get(key);
  if (!c) {
    const L = spec.length;
    const H = spec.height;
    const belt = H * 0.66;
    const roof = H - 0.02;
    c = armarCabina({ belt, roof, gx: spec.width / 2 - 0.14, ws: [belt + 0.02, -L * 0.24, roof - 0.08, -L * 0.08], rw: [belt + 0.08, L * 0.38, roof - 0.1, L * 0.28] });
    _fallback.set(key, c);
  }
  return c;
}

/**
 * Planos de la cabina [nx, ny, nz, d] (adentro: n·p <= d), en este orden:
 * costado derecho, izquierdo, cintura, techo, parabrisas, vidrio de atrás.
 */
function armarCabina(c) {
  const [ya, za, yb, zb] = c.ws;
  const [yc, zc, yd, zd] = c.rw;
  const plane = (nx, ny, nz, px, py, pz) => {
    const l = Math.hypot(nx, ny, nz) || 1;
    return [nx / l, ny / l, nz / l, (nx * px + ny * py + nz * pz) / l];
  };
  // Parabrisas: de la base (adelante) al tope; la normal mira hacia adelante y arriba.
  // Vidrio de atrás: de la base (atrás) al tope; la normal mira hacia atrás y arriba.
  c.planes = [plane(1, 0, 0, c.gx, 0, 0), plane(-1, 0, 0, -c.gx, 0, 0), plane(0, -1, 0, 0, c.belt, 0), plane(0, 1, 0, 0, c.roof, 0), plane(0, zb - za, -(yb - ya), 0, ya, za), plane(0, zc - zd, yd - yc, 0, yc, zc)];
  return c;
}

/** Caras de la cabina (índice de armarCabina): por el techo entra a la lata. */
export const CARA = { derecha: 0, izquierda: 1, cintura: 2, techo: 3, parabrisas: 4, atras: 5 };

// ------------------------------------------------ cajas de los ocupantes
/**
 * Caja de impacto de alguien sentado en el carro: `out` recibe en
 * coordenadas del mundo el eje del torso (x, z, y0, y1, r) y la cabeza (hx,
 * hy, hz, hr); y = piso. `s` es el estado del vehículo (x, y, z, heading);
 * `seat` el puesto (vehicleMesh seat: x, y, z, en el marco local); `side`
 * +1 el del conductor tal cual, -1 el copiloto (x reflejada). `slump` (0..1):
 * desplomado sobre el timón.
 */
export function occupantHitbox(s, seat, side = 1, slump = 0, out = {}) {
  const H = OCUPANTE_HIT;
  const c = Math.cos(s.heading);
  const sn = Math.sin(s.heading);
  const px = seat.x * side;
  const py = seat.y + H.pelvis;
  // Torso: eje vertical a media altura del tronco (desplomado, un poco adelante).
  let zl = seat.z + H.torsoBack - H.slumpFwd * 0.5 * slump;
  out.x = s.x + px * c + zl * sn;
  out.z = s.z - px * sn + zl * c;
  out.y = s.y;
  out.y0 = s.y + py + H.torsoBottom;
  out.y1 = s.y + py + H.torsoTop - H.slumpDown * 0.5 * slump;
  out.r = H.torsoR;
  // Cabeza.
  zl = seat.z + H.headBack - H.slumpFwd * slump;
  out.hx = s.x + px * c + zl * sn;
  out.hz = s.z - px * sn + zl * c;
  out.hy = s.y + py + H.headUp - H.slumpDown * slump;
  out.hr = H.headR;
  return out;
}

// ------------------------------------------------ el tiro contra el carro
const EPS = 1e-6;

/** Un eje del rayo contra la caja (slab): recorta [_s0, _s1] (de módulo: sin cierres por tiro). */
let _s0 = 0;
let _s1 = 0;
function slabAxis(o, d, lo, hi) {
  if (Math.abs(d) < EPS) return o >= lo && o <= hi;
  let a = (lo - o) / d;
  let b = (hi - o) / d;
  if (a > b) {
    const k = a;
    a = b;
    b = k;
  }
  if (a > _s0) _s0 = a;
  if (b < _s1) _s1 = b;
  return _s0 <= _s1;
}

/** Rayo (local) contra la caja de la lata: x ±hx, y de y0 a y1, z ±hz. t de entrada o null. */
function slab(ox, oy, oz, dx, dy, dz, hx, y0, y1, hz, maxT) {
  _s0 = 0;
  _s1 = maxT;
  if (!slabAxis(ox, dx, -hx, hx) || !slabAxis(oy, dy, y0, y1) || !slabAxis(oz, dz, -hz, hz)) return null;
  return _s0;
}

/** Rayo (local) contra la cabina (Cyrus-Beck con sus seis planos). Deja la cara de entrada en `_cara`. */
let _cara = -1;
function cabinT(planes, ox, oy, oz, dx, dy, dz, maxT) {
  let t0 = 0;
  let t1 = maxT;
  _cara = -1;
  for (let i = 0; i < 6; i++) {
    const p = planes[i];
    const num = p[3] - (p[0] * ox + p[1] * oy + p[2] * oz);
    const den = p[0] * dx + p[1] * dy + p[2] * dz;
    if (Math.abs(den) < EPS) {
      if (num < 0) return null;
      continue;
    }
    const t = num / den;
    if (den < 0) {
      if (t > t0) {
        t0 = t;
        _cara = i;
      }
    } else if (t < t1) t1 = t;
    if (t0 > t1) return null;
  }
  return t0;
}

/**
 * Tiro contra un carro con cabina (game/occupants.js arma la entrada):
 * `car` = {ref, obb: {x, z, hx, hz, angle}, y, height, cab (cabinaDe),
 * occ: [{ref, x, z, y0, y1, r, hx, hy, hz, hr}] (los de adentro, con
 * occupantHitbox), nOcc}. o, d en el mundo (d normalizada). Devuelve en
 * `out` (o null si no le pega antes de maxT): t, kind ('vehicle' o
 * 'character'), ref (el carro o el ocupante), headshot, glass (si entró por
 * un vidrio) y gt (t del vidrio, para el vidrio roto).
 */
export function rayVsCar(o, d, car, maxT, out) {
  const ob = car.obb;
  const px = o.x - ob.x;
  const pz = o.z - ob.z;
  // Descarte barato (los carros lejos del tiro o más allá de maxT): el punto
  // del rayo (en planta, entre 0 y maxT) más cercano al centro, contra el
  // círculo que encierra la planta del carro.
  const dd = d.x * d.x + d.z * d.z;
  let tq = dd > EPS ? -(px * d.x + pz * d.z) / dd : 0;
  if (tq < 0) tq = 0;
  else if (tq > maxT) tq = maxT;
  const qx = px + d.x * tq;
  const qz = pz + d.z * tq;
  const rq = Math.sqrt(ob.hx * ob.hx + ob.hz * ob.hz) + DESCARTE_MARGEN;
  if (qx * qx + qz * qz > rq * rq) return null;
  const c = Math.cos(ob.angle);
  const s = Math.sin(ob.angle);
  // Al marco local (x derecha, z atrás).
  const lox = px * c - pz * s;
  const loz = px * s + pz * c;
  const ldx = d.x * c - d.z * s;
  const ldz = d.x * s + d.z * c;
  const loy = o.y - car.y;
  const cab = car.cab;
  // Lata: el carro de largo y ancho completos hasta la cintura.
  const tl = slab(lox, loy, loz, ldx, d.y, ldz, ob.hx, 0.25, Math.min(cab.belt, car.height), ob.hz, maxT);
  // Cabina: entre los vidrios y el techo.
  const tc = cabinT(cab.planes, lox, loy, loz, ldx, d.y, ldz, tl ?? maxT);
  const cara = _cara;
  if (tc === null) {
    if (tl === null) return null;
    return carHit(out, tl, 'vehicle', car.ref, false, false, tl);
  }
  // Por el techo: lata. (Desde adentro de la cabina, cara -1, tampoco hay vidrio.)
  if (cara === CARA.techo || cara === CARA.cintura || cara < 0) return carHit(out, tc, 'vehicle', car.ref, false, false, tc);
  // Entró por un vidrio: le puede pegar a alguien de adentro.
  let best = maxT;
  let ref = null;
  let head = false;
  const occ = car.occ;
  for (let i = 0; i < car.nOcc; i++) {
    const q = occ[i];
    const th = rayVsSphere(o.x, o.y, o.z, d.x, d.y, d.z, q.hx, q.hy, q.hz, q.hr, best);
    if (th !== null && th >= tc - 0.05 && th < best) {
      best = th;
      ref = q.ref;
      head = true;
    }
    const tb = rayVsVerticalCapsule(o.x, o.y, o.z, d.x, d.y, d.z, q.x, q.z, q.y0, q.y1, q.r, best);
    if (tb !== null && tb >= tc - 0.05 && tb < best) {
      best = tb;
      ref = q.ref;
      head = false;
    }
  }
  if (ref) return carHit(out, best, 'character', ref, head, true, tc);
  return carHit(out, tc, 'vehicle', car.ref, false, true, tc);
}

function carHit(out, t, kind, ref, headshot, glass, gt) {
  out.t = t;
  out.kind = kind;
  out.ref = ref;
  out.headshot = headshot;
  out.glass = glass;
  out.gt = gt;
  return out;
}

// ------------------------------------------------ carro sin control
// El conductor quedó muerto o grave, desplomado sobre el timón: el carro
// sigue rodando con el timón torcido hacia un lado (el peso del cuerpo), a
// veces con el pie todavía en el acelerador un momento; después se va
// frenando solo (el motor, el roce) hasta quedar quieto, o choca.
export const SIN_CONTROL = {
  steerMin: 0.12, // fracción del timón (mínimo) hacia donde se tuerce
  steerMax: 0.42, // fracción del timón (máximo)
  steerRamp: 0.9, // s en que el timón llega a lo torcido
  gasChance: 0.35, // probabilidad de que el pie quede en el acelerador
  gas: 0.22, // acelerador que queda pisado
  gasTime: 1.4, // s máximos con el pie en el acelerador
  brakeFrom: 1.6, // s desde que se desploma hasta que empieza a frenar solo
  brakeMax: 0.16, // freno al que llega (el pie que cae en el freno, el motor)
  brakeRamp: 2.5, // s en que llega a brakeMax
  handbrakeBelow: 1.2, // m/s: por debajo de esto queda quieto (freno de mano)
  stopSpeed: 0.25, // m/s: por debajo, el carro ya paró
  hornChance: 0.45, // probabilidad de que la bocina se quede pegada
  hornMin: 2, // s mínimos de bocina pegada
  hornMax: 5, // s máximos
};

/** Arranca el carro sin control (rand: 0..1). steerNow: timón que llevaba. */
export function startLoose(rand, steerNow = 0) {
  const C = SIN_CONTROL;
  const side = rand() < 0.5 ? -1 : 1;
  const mag = C.steerMin + (C.steerMax - C.steerMin) * rand();
  const gas = rand() < C.gasChance ? C.gasTime * (0.4 + 0.6 * rand()) : 0;
  const horn = rand() < C.hornChance ? C.hornMin + (C.hornMax - C.hornMin) * rand() : 0;
  return { t: 0, steer0: steerNow, steer: side * mag, gas, horn, stopped: false };
}

/** Entrada de manejo de un carro sin control en `out` ({throttle, brake, steer, handbrake}). */
export function looseInput(lc, s, dt, out) {
  const C = SIN_CONTROL;
  lc.t += dt;
  const k = Math.min(1, lc.t / C.steerRamp);
  out.steer = lc.steer0 + (lc.steer - lc.steer0) * k;
  out.throttle = lc.t < lc.gas ? C.gas : 0;
  out.brake = lc.t > C.brakeFrom ? C.brakeMax * Math.min(1, (lc.t - C.brakeFrom) / C.brakeRamp) : 0;
  const v = Math.abs(s.forwardSpeed);
  out.handbrake = lc.t > C.brakeFrom && v < C.handbrakeBelow;
  // (Quieto, el freno no lo echa en reversa: stepVehicle frena y luego retrocede.)
  if (v < C.handbrakeBelow && lc.t > C.brakeFrom) out.brake = 0;
  if (lc.t > lc.gas && v < C.stopSpeed) lc.stopped = true;
  return out;
}

// ------------------------------------------------ la patrulla
/**
 * Qué pasa con una patrulla según cómo quedaron los de adentro (`down[i]`:
 * el i-ésimo de la tripulación, el 0 maneja, está muerto o grave):
 * 'sigue' (el conductor está bien), 'aPie' (cayó el conductor: cuando el
 * carro pare, se baja el que queda) o 'eliminada' (cayeron todos: la unidad
 * sale del caso y no se repone, como en la 3.6).
 */
export function patrolOutcome(down) {
  let alive = 0;
  for (const x of down) if (!x) alive++;
  if (alive === 0) return 'eliminada';
  return down[0] ? 'aPie' : 'sigue';
}
