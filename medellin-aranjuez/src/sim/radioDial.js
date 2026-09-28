// Lógica pura de la radio (sin DOM ni WebAudio, para probarla): el dial de
// emisoras, la programación "en vivo" de cada emisora, el ducking bajo las
// voces y la mezcla de los parlantes de las tiendas y billares.

import { makeRng } from './rng.js';

/** Índice del dial cuando la radio está apagada. */
export const APAGADA = -1;

/**
 * Siguiente posición del dial (paso +1 / -1). El dial recorre las emisoras
 * y, entre la última y la primera, "Radio apagada", como en los carros de GTA.
 */
export function mover(actual, n, paso) {
  if (n <= 0) return APAGADA;
  const k = n + 1; // emisoras + apagada
  const pos = (((actual + 1 + paso) % k) + k) % k;
  return pos - 1;
}

/** Mezcla determinista de las pistas de una emisora (Fisher-Yates con semilla). */
export function ordenPistas(ids, semilla = 1) {
  const rng = makeRng(semilla);
  const out = [...ids];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Semilla estable a partir de un texto (el id de la emisora). */
export function semillaDe(texto) {
  let h = 2166136261;
  for (let i = 0; i < texto.length; i++) h = Math.imul(h ^ texto.charCodeAt(i), 16777619);
  return h >>> 0;
}

/**
 * Qué suena en una emisora "en vivo" a los `t` segundos de su programación:
 * las pistas se repiten en orden (con `pausa` segundos entre una y otra).
 * Devuelve {i, offset}: índice en `duraciones` y segundos dentro de la pista.
 * Así, al volver a una emisora, no arranca desde el principio sino donde iría.
 */
export function enVivo(duraciones, t, pausa = 0) {
  const total = duraciones.reduce((s, d) => s + d + pausa, 0);
  if (!(total > 0)) return { i: 0, offset: 0 };
  let r = ((t % total) + total) % total;
  for (let i = 0; i < duraciones.length; i++) {
    const d = duraciones[i] + pausa;
    if (r < d) return { i, offset: Math.min(r, duraciones[i]) };
    r -= d;
  }
  return { i: 0, offset: 0 };
}

/** Ganancia objetivo de la música según lo que se está hablando. */
export function objetivoDuck({ voz = false, cinematica = false } = {}) {
  if (cinematica) return 0.2;
  if (voz) return 0.35;
  return 1;
}

/**
 * Un paso del ducking: baja rápido (ataque) y sube despacio (suelta), con
 * respuesta exponencial independiente de los fps.
 */
export function pasoDuck(actual, objetivo, dt, ataque = 0.12, suelta = 0.9) {
  const tau = objetivo < actual ? ataque : suelta;
  return objetivo + (actual - objetivo) * Math.exp(-dt / tau);
}

/** Radio (m) hasta el que se oye un parlante de tienda o billar. */
export const RADIO_PARLANTE = 26;
/** Cuántos parlantes pueden sonar a la vez (los más cercanos). */
export const MAX_PARLANTES = 2;

/** Ganancia de un parlante a `d` metros: suave, y cero en el borde del radio. */
export function gananciaParlante(d, radio = RADIO_PARLANTE, ref = 4) {
  if (!(d < radio)) return 0;
  const cerca = Math.min(1, ref / Math.max(ref, d));
  const borde = 1 - (d / radio) ** 2;
  return cerca * borde;
}

/** Los parlantes más cercanos a (x, z) que alcanzan a oírse, del más cercano al más lejano. */
export function parlantesCercanos(parlantes, x, z, max = MAX_PARLANTES, radio = RADIO_PARLANTE) {
  return parlantes
    .map((p) => ({ p, d: Math.hypot(p.x - x, p.z - z) }))
    .filter((o) => o.d < radio)
    .sort((a, b) => a.d - b.d)
    .slice(0, max);
}
