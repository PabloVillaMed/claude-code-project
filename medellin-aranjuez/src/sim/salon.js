// Sonidos sintetizados del salón de las discotecas (puro: devuelve muestras,
// sin WebAudio): la respuesta al impulso del recinto según su tamaño (la
// reverberación de la música y las voces adentro), los gritos de la gente
// ("¡eeeh!", "¡uepa!") y los aplausos del corro. game/salonSound.js los arma
// una sola vez en buffers y los reparte con tope de voces.
//
// Deterministas por semilla (mismo local, mismo eco).

import { makeRng } from './rng.js';

// ------------------------------------------------------------------ configurables
/** Reverberación del recinto (s): RT60 = BASE + POR_M3 × volumen, entre MIN y MAX; los sótanos suenan un poco más vivos. */
export const RECINTO = { BASE: 0.3, POR_M3: 0.00055, MIN: 0.38, MAX: 1.15, SOTANO: 0.12, ALTO: 4.2 };

const resonador = (sr, f, bw) => {
  const r = Math.exp((-Math.PI * bw) / sr);
  return { a1: -2 * r * Math.cos((2 * Math.PI * f) / sr), a2: r * r, g: 1 - r, y1: 0, y2: 0 };
};
const pasar = (R, x) => {
  const y = R.g * x - R.a1 * R.y1 - R.a2 * R.y2;
  R.y2 = R.y1;
  R.y1 = y;
  return y;
};
const sst = (a, b, x) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * Medidas acústicas del interior `r` (sim/interiors.js): {rt60 (s), pre
 * (s de la primera reflexión), ancho, fondo, alto (m)}.
 */
export function medidaSalon(r) {
  const ancho = Math.max(3, (r?.X1 ?? 4) - (r?.X0 ?? -4));
  const fondo = Math.max(3, (r?.Z1 ?? 0) - (r?.Z0 ?? -8));
  const alto = r?.H ?? RECINTO.ALTO;
  const V = ancho * fondo * alto;
  let rt60 = RECINTO.BASE + RECINTO.POR_M3 * V + (r?.landing ? RECINTO.SOTANO : 0);
  rt60 = Math.max(RECINTO.MIN, Math.min(RECINTO.MAX, rt60));
  const pre = Math.min(ancho, fondo, alto * 2) / 2 / 343;
  return { rt60, pre, ancho, fondo, alto };
}

/**
 * Respuesta al impulso estéreo [L, R] de un salón cerrado con `rt60` s de
 * reverberación: reflexiones tempranas de muros, piso y techo (distintas en
 * cada oído) y una cola difusa donde los agudos se apagan antes que los
 * graves (la gente y los muebles absorben). Energía total ≈ g².
 */
export function respuestaSalon(sr, { rt60 = 0.7, pre = 0.008, ancho = 10, fondo = 14, alto = 4, g = 0.5, semilla = 7 } = {}) {
  const dur = Math.min(2.5, rt60 * 1.25 + 0.05);
  const n = Math.max(16, Math.floor(sr * dur));
  const rng = makeRng(semilla >>> 0 || 1);
  const out = [new Float32Array(n), new Float32Array(n)];
  const aLp = 1 - Math.exp((-2 * Math.PI * 1800) / sr);
  // Decaimiento por muestra (se multiplica en vez de un Math.exp por muestra): graves exp(-6,91 t / rt60); agudos, el cuadrado.
  const dG = Math.exp(-6.91 / (sr * rt60));
  const dA = dG * dG;
  const t1 = pre + 0.03;
  for (let c = 0; c < 2; c++) {
    const ch = out[c];
    let lp = 0;
    let e = 0;
    let eG = 1;
    let eA = 1;
    // Cola: graves con todo el RT60, agudos con la mitad.
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      const w = rng.next() * 2 - 1;
      lp += aLp * (w - lp);
      const v = (t < t1 ? sst(pre, t1, t) : 1) * (lp * 1.8 * eG + (w - lp) * 0.5 * eA);
      eG *= dG;
      eA *= dA;
      ch[i] = v;
      e += v * v;
    }
    const k = (g * 0.85) / Math.sqrt(e || 1);
    for (let i = 0; i < n; i++) ch[i] *= k;
    // Reflexiones tempranas: muros a los lados, fondo, piso y techo.
    const dists = [ancho * 0.5, ancho * 0.5, fondo * 0.6, alto * 0.9, alto * 1.6, ancho * 1.1, fondo * 1.2];
    for (let j = 0; j < dists.length; j++) {
      const d = dists[j] * (0.85 + rng.next() * 0.3) + (c ? 0.4 : 0) * (j % 2 ? 1 : -1);
      const i0 = Math.floor((pre + Math.max(0.001, d / 343)) * sr);
      if (i0 >= n) continue;
      const amp = (g * 0.35) / (1 + j * 0.45) * (j % 2 === c ? 1 : 0.7);
      // Ráfaga cortita (no un clic): la reflexión de una superficie rugosa.
      for (let q = 0; q < 24 && i0 + q < n; q++) ch[i0 + q] += amp * (rng.next() * 2 - 1) * Math.exp(-q / 6);
    }
  }
  return out;
}

/**
 * Un grito de rumba ("¡eeeh!", "¡uepa!", "¡wepa!"): voz de pecho que sube y
 * baja con formantes de vocal abierta. `mujer` sube el tono. Muestras mono,
 * pico ~0.9.
 */
export function grito(sr, { semilla = 1, mujer = false, largo = 0 } = {}) {
  const rng = makeRng(semilla >>> 0 || 1);
  const dur = largo || rng.range(0.38, 0.72);
  const n = Math.floor(sr * dur);
  const out = new Float32Array(n);
  const f0 = (mujer ? rng.range(300, 380) : rng.range(170, 230)) * 1.0;
  const sube = rng.range(1.25, 1.6);
  const tipo = rng.int(0, 2); // 0 "eeeh", 1 "uepa", 2 "wooo"
  const F1 = resonador(sr, tipo === 2 ? 480 : 620, 110);
  const F2 = resonador(sr, tipo === 2 ? 900 : 1750, 160);
  const F3 = resonador(sr, 2600, 260);
  let ph = 0;
  let pico = 1e-6;
  for (let i = 0; i < n; i++) {
    const t = i / n;
    // Tono: sube rápido y cae al final (el "¡eeee-eh!").
    const f = f0 * (1 + (sube - 1) * sst(0, 0.25, t) - (sube - 1) * 0.6 * sst(0.6, 1, t));
    ph += f / sr;
    if (ph >= 1) ph -= 1;
    const vib = 1 + 0.03 * Math.sin(2 * Math.PI * 5.5 * (i / sr));
    const src = (ph * 2 - 1) * vib + (rng.next() - 0.5) * 0.25;
    // "uepa": la u al principio (F2 bajo) y el golpe de la p antes del final.
    if (tipo === 1) {
      F2.a1 = -2 * Math.exp((-Math.PI * 160) / sr) * Math.cos((2 * Math.PI * (900 + 900 * sst(0, 0.2, t))) / sr);
    }
    let env = sst(0, 0.06, t) * (1 - sst(0.75, 1, t));
    if (tipo === 1 && t > 0.62 && t < 0.7) env *= 0.15;
    const y = (pasar(F1, src) + pasar(F2, src) * 0.7 + pasar(F3, src) * 0.25) * env;
    out[i] = y;
    if (Math.abs(y) > pico) pico = Math.abs(y);
  }
  const k = 0.9 / pico;
  for (let i = 0; i < n; i++) out[i] *= k;
  return out;
}

/**
 * Aplausos de `personas` durante `seg` s que se pueden repetir en bucle sin
 * costura (las palmadas que pasan del final caen al principio). Cada quien
 * aplaude a su ritmo (3-5 por s) con su timbre. Muestras mono, pico ~0.9.
 */
export function aplausos(sr, seg = 2.4, personas = 10, semilla = 3) {
  const rng = makeRng(semilla >>> 0 || 1);
  const n = Math.floor(sr * seg);
  const out = new Float32Array(n);
  for (let p = 0; p < personas; p++) {
    const ritmo = rng.range(3, 5);
    const fc = rng.range(900, 2600);
    const largo = Math.floor(sr * rng.range(0.008, 0.016));
    const amp = rng.range(0.5, 1);
    let t = rng.range(0, 1 / ritmo);
    while (t < seg) {
      const i0 = Math.floor(t * sr);
      const R = resonador(sr, fc * rng.range(0.9, 1.1), fc * 0.9);
      for (let q = 0; q < largo * 3; q++) {
        const x = (rng.next() * 2 - 1) * Math.exp(-q / largo);
        out[(i0 + q) % n] += pasar(R, x) * amp * 4;
      }
      t += (1 / ritmo) * rng.range(0.85, 1.15);
    }
  }
  let pico = 1e-6;
  for (let i = 0; i < n; i++) pico = Math.max(pico, Math.abs(out[i]));
  const k = 0.9 / pico;
  for (let i = 0; i < n; i++) out[i] *= k;
  return out;
}
