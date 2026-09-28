// Modelo del cielo sin Three.js (se puede probar): posición del sol y de la
// luna según la hora, dispersión atmosférica analítica (Preetham, la misma
// fórmula del sombreador que hornea el cielo en render/sky.js), nubosidad del
// día en Medellín y el ruido repetible con el que se dibujan las nubes.

import { clamp, smoothstep } from './math.js';
import { mulberry32 } from './rng.js';

/** Parámetros de la atmósfera del valle (aire con algo de bruma). */
export const ATMOSPHERE = { turbidity: 3.5, rayleigh: 1.9, mieCoefficient: 0.004, mieDirectionalG: 0.78 };

const norm = (x, y, z) => {
  const l = Math.hypot(x, y, z) || 1;
  return { x: x / l, y: y / l, z: z / l };
};

/**
 * Dirección hacia el sol (unitaria). Medellín está cerca del ecuador: el sol
 * sale ~6:00 y se pone ~18:00. Oriente = +X en el mapa (la montaña); un poco
 * inclinado hacia el sur (+Z).
 */
export function sunDirection(hour) {
  const a = ((hour - 6) / 12) * Math.PI;
  return norm(Math.cos(a), Math.sin(a), 0.3);
}

/**
 * Dirección hacia la luna: luna llena, opuesta al sol (sale por la montaña al
 * anochecer y a medianoche está casi en el cenit), con otra inclinación.
 */
export function moonDirection(hour) {
  const a = ((hour - 6) / 12) * Math.PI;
  return norm(-Math.cos(a), -Math.sin(a), -0.18);
}

// ---------------------------------------------------------------- Preetham
// Constantes del modelo (las mismas de three/examples Sky.js).
const TOTAL_RAYLEIGH = [5.804542996261093e-6, 1.3562911419845635e-5, 3.0265902468824876e-5];
const MIE_CONST = [1.8399918514433978e14, 2.7798023919660528e14, 4.0790479543861094e14];
const CUTOFF = 1.6110731556870734;
const STEEPNESS = 1.5;
const EE = 1000;
const RAYLEIGH_ZENITH = 8.4e3;
const MIE_ZENITH = 1.25e3;

/** Tinte del resplandor del sol en la hora dorada (también en render/sky.js). */
export const GOLD = [1.0, 0.78, 0.5];

/** Coeficientes que solo dependen del sol (se calculan una vez por horneado). */
export function skyCoefficients(sunDir, atm = ATMOSPHERE) {
  // Crepúsculo: con el sol recién puesto el modelo deja el cielo negro de
  // golpe; se mantiene la luz del sol "en el horizonte" y se apaga del todo
  // cuando baja ~11° (fin del crepúsculo náutico, ~40 min después).
  const zc = clamp(Math.max(sunDir.y, -0.01), -1, 1);
  const dusk = sunDir.y < -0.01 ? smoothstep(-0.19, -0.01, sunDir.y) : 1;
  const sunE = EE * Math.max(0, 1 - Math.exp(-(CUTOFF - Math.acos(zc)) / STEEPNESS)) * dusk;
  // En Sky.js sunPosition es unitario: "sunfade" queda ~1 (rayleigh sin cambio).
  const sunfade = 1 - clamp(1 - Math.exp(sunDir.y / 450000), 0, 1);
  const rc = atm.rayleigh - (1 - sunfade);
  const betaR = TOTAL_RAYLEIGH.map((v) => v * rc);
  const c = 0.2 * atm.turbidity * 10e-18;
  const betaM = MIE_CONST.map((v) => 0.434 * c * v * atm.mieCoefficient);
  return { sunE, betaR, betaM, mieG: atm.mieDirectionalG };
}

/** Longitud óptica relativa (masa de aire) para un coseno cenital. */
function airMass(y) {
  const za = Math.acos(Math.max(0, y));
  return 1 / (Math.cos(za) + 0.15 * Math.pow(93.885 - (za * 180) / Math.PI, -1.253));
}

/** Transmitancia (extinción) del aire en la dirección `dir`: [r, g, b] entre 0 y 1. */
export function transmittance(dir, co) {
  const m = airMass(dir.y);
  return [0, 1, 2].map((i) => Math.exp(-(co.betaR[i] * RAYLEIGH_ZENITH * m + co.betaM[i] * MIE_ZENITH * m)));
}

/**
 * Radiancia del cielo (sin el disco solar) en la dirección `dir`, en las
 * mismas unidades que Sky.js (antes de la exposición): [r, g, b].
 */
export function skyRadiance(dir, sunDir, co) {
  const fex = transmittance(dir, co);
  const cosT = dir.x * sunDir.x + dir.y * sunDir.y + dir.z * sunDir.z;
  const rPhase = (3 / (16 * Math.PI)) * (1 + Math.pow(cosT * 0.5 + 0.5, 2));
  const g = co.mieG;
  const mPhase = (1 / (4 * Math.PI)) * ((1 - g * g) / Math.pow(1 - 2 * g * cosT + g * g, 1.5));
  const k = clamp(Math.pow(1 - sunDir.y, 5), 0, 1);
  const bias = [0, 0.0003, 0.00075];
  // Hora dorada: el resplandor alrededor del sol bajo se entibia (el modelo lo deja casi blanco).
  const warm = (1 - smoothstep(0.03, 0.3, sunDir.y)) * Math.pow(Math.max(cosT, 0), 6);
  const tint = GOLD;
  const out = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    const ratio = (co.betaR[i] * rPhase + co.betaM[i] * mPhase) / (co.betaR[i] + co.betaM[i]);
    let lin = Math.pow(co.sunE * ratio * (1 - fex[i]), 1.5);
    lin *= 1 + (Math.pow(co.sunE * ratio * fex[i], 0.5) - 1) * k;
    out[i] = ((lin + 0.1 * fex[i]) * 0.04 + bias[i]) * (1 + (tint[i] - 1) * warm);
  }
  return out;
}

const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

/**
 * Exposición propia del cielo: el modelo de Preetham va de ~0,1 al amanecer
 * a ~5 al mediodía, y con la exposición del juego el mediodía quedaba blanco
 * y lavado. Se limita el brillo del cenit (el mediodía queda azul profundo);
 * al amanecer y al atardecer no se toca (factor 1).
 */
export function skyExposure(sunDir, co, target = 0.5) {
  const z = Math.max(lum(skyRadiance({ x: 0, y: 1, z: 0 }, sunDir, co)), 1e-6);
  // En la hora azul (sol cerca y por debajo del horizonte) se aclara un poco.
  const boost = 1 + 1.6 * (1 - smoothstep(-0.02, 0.12, sunDir.y));
  return Math.min(target / z, boost);
}

/** Color de la luz del sol que llega a las nubes (ya con la exposición del cielo). */
export function sunlightColor(sunDir, co) {
  const fex = transmittance(sunDir, co);
  // Por debajo del horizonte las nubes altas aún reciben un poco de luz rojiza.
  const e = co.sunE * 0.22 * 0.04;
  return fex.map((f) => f * e);
}

// ---------------------------------------------------------------- nubes
/**
 * Nubosidad (0 despejado … 1 cubierto) según la hora: en Medellín las
 * mañanas suelen ser despejadas; los cúmulos crecen sobre las montañas al
 * mediodía y la tarde es la más nublada (aguaceros de las 3–4 p. m.); en la
 * noche el cielo se va abriendo. `day` cambia un poco el día (0…1).
 */
export function cloudCover(hour, day = 0.5) {
  const h = ((hour % 24) + 24) % 24;
  const build = smoothstep(9, 15, h) * (1 - smoothstep(17, 22.5, h));
  const base = 0.24 + 0.34 * build; // 0.24 temprano y de noche, ~0.58 a media tarde
  return clamp(base + (day - 0.5) * 0.16, 0.05, 0.85);
}

/**
 * Ruido fractal repetible (se puede embaldosar sin costuras) para las nubes:
 * RGBA de `size`×`size`; R: forma de los cúmulos (escala grande), G: detalle
 * y cirros, B: otro detalle desfasado (bordes deshilachados), A: 255.
 */
export function tileableCloudNoise(size = 128, seed = 7) {
  const rnd = mulberry32(seed);
  const lattice = (n) => {
    const a = new Float32Array(n * n);
    for (let i = 0; i < a.length; i++) a[i] = rnd();
    return a;
  };
  // Ruido de valor periódico: la retícula de `n` celdas se repite en el borde.
  const octave = (n, lat, x, y) => {
    const fx = (x / size) * n;
    const fy = (y / size) * n;
    const ix = Math.floor(fx);
    const iy = Math.floor(fy);
    const tx = fx - ix;
    const ty = fy - iy;
    const sx = tx * tx * (3 - 2 * tx);
    const sy = ty * ty * (3 - 2 * ty);
    const at = (i, j) => lat[((j % n) + n) % n * n + (((i % n) + n) % n)];
    const a = at(ix, iy) + (at(ix + 1, iy) - at(ix, iy)) * sx;
    const b = at(ix, iy + 1) + (at(ix + 1, iy + 1) - at(ix, iy + 1)) * sx;
    return a + (b - a) * sy;
  };
  const fbm = (base, octaves) => {
    const lats = [];
    for (let o = 0; o < octaves; o++) lats.push(lattice(base << o));
    return (x, y) => {
      let v = 0;
      let amp = 0.5;
      let tot = 0;
      for (let o = 0; o < octaves; o++) {
        v += octave(base << o, lats[o], x, y) * amp;
        tot += amp;
        amp *= 0.5;
      }
      return v / tot;
    };
  };
  const big = fbm(4, 5);
  const small = fbm(8, 4);
  const wisp = fbm(8, 4);
  const out = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      // Contraste: el fbm se amontona cerca de 0.5, se estira a 0..1.
      const s = (v) => Math.round(clamp((v - 0.5) * 1.9 + 0.5, 0, 1) * 255);
      out[i] = s(big(x, y));
      out[i + 1] = s(small(x, y));
      out[i + 2] = s(wisp(x, y));
      out[i + 3] = 255;
    }
  }
  return out;
}

/** ¿Hay que volver a hornear el cielo? Solo si el sol se movió más de `deg` grados. */
export function sunMoved(prev, next, deg = 0.35) {
  if (!prev) return true;
  const d = clamp(prev.x * next.x + prev.y * next.y + prev.z * next.z, -1, 1);
  return Math.acos(d) > (deg * Math.PI) / 180;
}
