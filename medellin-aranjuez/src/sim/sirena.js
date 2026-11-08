// Sirena de la policía: cuándo suena cada unidad, con qué patrón y cómo se
// oye. Las patrullas y motos de la Policía en Medellín usan sirenas
// electrónicas de estilo americano: 'wail' (sube y baja despacio) en vías
// abiertas, 'yelp' (el mismo barrido rápido) para abrirse paso en el tráfico
// y en los cruces, y ráfagas cortas 'chirp' (dos o tres "uiu") que usan mucho
// las motos para que les abran paso. Solo suena mientras la unidad viene en
// camino o te persigue; llegando, buscando sin verte o retirándose va en
// silencio (las luces siguen). Puro y determinista: lo prueba sirena.test.js;
// la síntesis está en game/sirenaVoz.js y la mezcla en game/audio.js.

import { clamp, smoothstep } from './math.js';

// --------------------------------------------------- constantes configurables
/** Cuándo suena y qué patrón usa cada unidad. */
export const SIRENA = {
  apagarTras: 2.5, // s seguidos sin motivo para sonar antes de apagarse (que no parpadee si te ven y te pierden)
  holdOff: 1.5, // s mínimos apagada antes de volver a prender
  llegadaDist: 16, // m: casi quieta a esta distancia de ti, ya llegó (se apaga)
  llegadaVel: 2.5, // m/s: por debajo de esto la unidad está quieta
  yelpDist: 75, // m: más cerca de esto pasan del wail al yelp (las motos, a yelp y chirps)
  yelpHist: 1.25, // histéresis: vuelven a 'lejos' pasada yelpDist por este factor
  traficoVel: 5, // m/s: más lenta que esto queriendo ir al doble = trancón (yelp o chirps)
  traficoTiempo: 1.5, // s seguidos lenta para darlo por trancón
  patronMin: 4, // s mínimos con un mismo patrón…
  patronVar: 5, // …más hasta estos s al azar (cada unidad cambia a su ritmo)
  cambioMin: 1.5, // s mínimos con un patrón antes de cambiarlo porque se acercó o se trancó
  // Probabilidad de cada patrón según la situación [wail, yelp, chirp]
  // (la alternancia natural: casi siempre el que toca, a veces el otro).
  carroLejos: [0.85, 0.15, 0],
  carroCerca: [0.2, 0.8, 0],
  carroTrancon: [0, 0.75, 0.25],
  motoLejos: [0.25, 0, 0.75],
  motoCerca: [0, 0.6, 0.4],
  motoTrancon: [0, 0.2, 0.8],
};

/** Tono de la sirena (síntesis en game/sirenaVoz.js). */
export const SIRENA_TONO = {
  fMin: 650, // Hz: lo más grave del barrido
  fMax: 1500, // Hz: lo más agudo del barrido
  wailPeriodo: 4.4, // s por ciclo del wail (subida y bajada)
  yelpHz: 3.6, // ciclos por segundo del yelp
  subida: 0.42, // fracción del ciclo que tarda en subir (baja más despacio, como el motor de la sirena)
  pulso: 0.32, // ciclo útil de la onda de pulso (timbre rico en armónicos, sin ser zumbido)
  armonicos: 20, // armónicos de la onda de pulso
  bocinaHz: 1350, // Hz: centro del pasabanda de la bocina del parlante
  bocinaQ: 0.8, // ancho de ese pasabanda (más bajo = más ancho)
  metalHz: 2650, // Hz: resonancia metálica de la bocina
  metalQ: 7, // agudeza de la resonancia
  metalDb: 5, // dB de la resonancia
  saturacion: 2.2, // empuje de la saturación suave (tanh): redondea el pulso como un parlante cargado
  chirpDur: 0.3, // s de cada "uiu" de una ráfaga
  chirpPausaUiu: 0.07, // s entre los "uiu" de una ráfaga
  chirpN: [2, 3], // "uiu" por ráfaga (mínimo, máximo)
  chirpPausa: [1.3, 3.2], // s de silencio entre ráfagas (mínimo, máximo)
  chirpFMin: 720, // Hz: arranque y final de cada "uiu"
  chirpFMax: 1550, // Hz: punta de cada "uiu"
  variacionTono: 0.04, // ±fracción de tono por unidad (que no suenen todas iguales)
  variacionRitmo: 0.08, // ±fracción del ritmo del barrido por unidad (que no vayan en fase)
};

/** Cómo se oye: volumen, distancia, Doppler, cabina, fundidos y tope de voces. */
export const SIRENA_MEZCLA = {
  volumen: 0.038, // ganancia a refDist (medido offline: ~12 dB RMS menos que la sirena anterior a 20 m y ~13 dB menos a 50-150 m)
  refDist: 12, // m: distancia de referencia (más cerca no sube)
  caida: 1, // exponente de la caída con la distancia (1 = -6 dB cada vez que se dobla)
  maxDist: 220, // m: más lejos no suena
  fadeLejos: 50, // m antes de maxDist en los que se desvanece del todo
  lpCerca: 9000, // Hz: pasabajos a refDist…
  lpLejos: 1400, // …y tendiendo a esto muy lejos (el aire y las casas se comen los agudos)
  doppler: 0.6, // fracción del Doppler físico (suave: que no desafine)
  dopplerMax: 0.06, // ±fracción de tono máxima por Doppler
  ecoCerca: 0.12, // envío al eco de la calle de cerca…
  ecoLejos: 0.45, // …y de lejos (de lejos se oye más rebote que sonido directo)
  cabinaGain: 0.35, // dentro de un carro cerrado (vidrios arriba)
  cabinaLp: 1500, // Hz: pasabajos de la cabina
  maxVoces: 2, // sirenas sonando a la vez (las más cercanas)
  margenCambio: 0.82, // una que ya suena sigue si la nueva no está más cerca que su distancia por esto
  fadeIn: 0.6, // s (constante de tiempo) al entrar
  fadeOut: 1.0, // s (constante de tiempo) al salir
};

export const VEL_SONIDO = 343; // m/s

// ------------------------------------------------------------ cuándo suena
/**
 * ¿Debe sonar ahora la sirena de esta unidad? (sin histéresis)
 * info: {wanted, leaving, state: 'pursuit'|'deployed'|'returning',
 *        destroyed, pendingDeploy, mode: modo de planPatrol ('pursue',
 *        'tail', 'respond', 'cut', 'search', 'patrol'), seen, dist (m al
 *        jugador), speed (m/s), cruise (m/s que quiere ir)}
 */
export function sirenaDeseada(info) {
  if (apagadoForzoso(info)) return false;
  switch (info.mode) {
    case 'pursue':
    case 'tail':
      // Te persigue; encima de ti y quieta ya llegó.
      return !(info.dist < SIRENA.llegadaDist && Math.abs(info.speed) < SIRENA.llegadaVel);
    case 'respond':
      return true; // viene en camino a la última posición conocida
    case 'cut':
      // Va a cortarte el paso sabiendo dónde estás; esperando en el punto o
      // apostada sin verte, en silencio.
      return !!info.seen && info.cruise > 0;
    case 'search':
      return !!info.seen; // barriendo sin verte: silencio, solo luces
    default:
      return false;
  }
}

/** Situaciones en que se apaga ya, sin esperar apagarTras. */
function apagadoForzoso(info) {
  return !info.wanted || !!info.leaving || info.state !== 'pursuit' || !!info.destroyed || !!info.pendingDeploy;
}

/** Variación propia de cada unidad (tono, ritmo del barrido, semilla). */
export function variacionUnidad(id) {
  const h1 = hash01(id * 2 + 1);
  const h2 = hash01(id * 2 + 2);
  return {
    tono: 1 + (h1 * 2 - 1) * SIRENA_TONO.variacionTono,
    ritmo: 1 + (h2 * 2 - 1) * SIRENA_TONO.variacionRitmo,
    semilla: (Math.imul(id + 1, 0x9e3779b1) >>> 0) || 1,
  };
}

function hash01(n) {
  let h = Math.imul(n ^ 0x5bd1e995, 0x27d4eb2d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

/** Azar propio de la sirena (no gasta el del mundo). */
function azar(st) {
  let a = (st.semilla = (st.semilla + 0x6d2b79f5) | 0);
  a = Math.imul(a ^ (a >>> 15), 1 | a);
  a = (a + Math.imul(a ^ (a >>> 7), 61 | a)) ^ a;
  return ((a ^ (a >>> 14)) >>> 0) / 4294967296;
}

/** Patrón según el tipo de unidad y la situación (r: azar 0..1). */
export function elegirPatron(moto, cerca, trancon, r) {
  const p = moto ? (trancon ? SIRENA.motoTrancon : cerca ? SIRENA.motoCerca : SIRENA.motoLejos) : trancon ? SIRENA.carroTrancon : cerca ? SIRENA.carroCerca : SIRENA.carroLejos;
  if (r < p[0]) return 'wail';
  if (r < p[0] + p[1]) return 'yelp';
  return p[2] > 0 ? 'chirp' : 'yelp';
}

/**
 * Avanza la sirena de una unidad. st: estado propio ({} al empezar; guarda
 * on, patron y los temporizadores). info: como en sirenaDeseada, más id y
 * moto. Devuelve st: st.on (suena) y st.patron ('wail'|'yelp'|'chirp').
 */
export function stepSirena(st, info, dt) {
  if (st.semilla == null) {
    st.semilla = variacionUnidad(info.id ?? 0).semilla;
    st.on = false;
    st.t = SIRENA.holdOff; // la primera vez puede prender de una
    st.patron = null;
    st.edad = 0;
    st.dur = 0;
    st.lentoT = 0;
    st.cerca = false;
    st.zona = -1;
    st.sinMotivo = 0;
  }
  st.t += dt;
  st.edad += dt;
  const quiere = sirenaDeseada(info);
  st.sinMotivo = quiere ? 0 : st.sinMotivo + dt;
  if (st.on && !quiere && (apagadoForzoso(info) || st.sinMotivo >= SIRENA.apagarTras)) {
    st.on = false;
    st.t = 0;
  } else if (!st.on && quiere && st.t >= SIRENA.holdOff) {
    st.on = true;
    st.t = 0;
    st.patron = null;
  }
  st.lentoT = Math.abs(info.speed) < SIRENA.traficoVel && info.cruise > SIRENA.traficoVel * 2 ? st.lentoT + dt : 0;
  const trancon = st.lentoT > SIRENA.traficoTiempo;
  st.cerca = st.cerca ? info.dist < SIRENA.yelpDist * SIRENA.yelpHist : info.dist < SIRENA.yelpDist;
  if (st.on) {
    const zona = (st.cerca ? 1 : 0) + (trancon ? 2 : 0);
    if (!st.patron || st.edad >= st.dur || (zona !== st.zona && st.edad >= SIRENA.cambioMin)) {
      st.patron = elegirPatron(!!info.moto, st.cerca, trancon, azar(st));
      st.dur = SIRENA.patronMin + azar(st) * SIRENA.patronVar;
      st.edad = 0;
      st.zona = zona;
    }
  }
  return st;
}

// ------------------------------------------------------------ cómo se oye
/**
 * Mezcla de una sirena a `d` m del oyente. vr: velocidad radial (m/s,
 * positiva si se acerca). cabina: el jugador va dentro de un carro cerrado.
 * Devuelve {gain, lp (Hz), pitch (factor Doppler), eco (envío)}.
 */
export function mezclaSirena(d, vr = 0, cabina = false, out = {}) {
  const M = SIRENA_MEZCLA;
  const dd = Math.max(M.refDist, d);
  const cerca = M.refDist / dd;
  let gain = M.volumen * Math.pow(cerca, M.caida);
  const w = clamp((M.maxDist - d) / M.fadeLejos, 0, 1);
  gain *= w * w * (3 - 2 * w);
  let lp = M.lpLejos + (M.lpCerca - M.lpLejos) * Math.pow(cerca, 0.7);
  let eco = M.ecoCerca + (M.ecoLejos - M.ecoCerca) * smoothstep(M.refDist, M.maxDist * 0.6, d);
  if (cabina) {
    gain *= M.cabinaGain;
    lp = Math.min(lp, M.cabinaLp);
    eco *= M.cabinaGain;
  }
  out.gain = gain;
  out.lp = lp;
  out.pitch = clamp(VEL_SONIDO / (VEL_SONIDO - clamp(vr * M.doppler, -150, 150)), 1 - M.dopplerMax, 1 + M.dopplerMax);
  out.eco = eco;
  return out;
}

/**
 * Las sirenas que suenan: las `max` más cercanas de `cands` ([{d}]), con
 * ventaja para las que ya sonaban (`actuales`, se compara con la distancia
 * por margen) para que no se cambien a cada rato. Escribe en `out`.
 */
export function elegirSirenas(cands, actuales, max = SIRENA_MEZCLA.maxVoces, margen = SIRENA_MEZCLA.margenCambio, out = []) {
  out.length = 0;
  for (const c of cands) {
    const dEff = actuales.includes(c) ? c.d * margen : c.d;
    if (dEff >= SIRENA_MEZCLA.maxDist) continue;
    // Inserción ordenada (son pocas).
    let i = out.length;
    out.push(c);
    c._dEff = dEff;
    while (i > 0 && out[i - 1]._dEff > dEff) {
      out[i] = out[i - 1];
      i--;
    }
    out[i] = c;
  }
  if (out.length > max) out.length = max;
  return out;
}

// ------------------------------------------------------------ forma del barrido
/** Altura del barrido (0 = fMin, 1 = fMax) en la fase p (0..1) del ciclo. */
export function formaBarrido(p, subida = SIRENA_TONO.subida) {
  p -= Math.floor(p);
  if (p < subida) return Math.sin((Math.PI / 2) * (p / subida)); // sube y se frena arriba
  const q = (p - subida) / (1 - subida);
  return Math.pow(1 - q, 1.8); // cae rápido y se asienta abajo (el motor perdiendo vueltas)
}

/**
 * Serie de Fourier del barrido para la onda del oscilador lento (LFO):
 * {real, imag} sin término de continua, y el rango [min, max] de la onda
 * reconstruida; con eso, frecuencia = base + onda * profundidad recorre
 * exactamente [fMin, fMax].
 */
export function seriesBarrido(n = 24, muestras = 512, subida = SIRENA_TONO.subida) {
  const real = new Float32Array(n + 1);
  const imag = new Float32Array(n + 1);
  for (let i = 0; i < muestras; i++) {
    const p = i / muestras;
    const y = formaBarrido(p, subida) * 2 - 1;
    for (let k = 1; k <= n; k++) {
      const a = 2 * Math.PI * k * p;
      real[k] += (2 / muestras) * y * Math.cos(a);
      imag[k] += (2 / muestras) * y * Math.sin(a);
    }
  }
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < muestras; i++) {
    const w = evalSerie(real, imag, i / muestras);
    if (w < min) min = w;
    if (w > max) max = w;
  }
  return { real, imag, min, max };
}

/** Valor de una serie {real, imag} (sin continua) en la fase p. */
export function evalSerie(real, imag, p) {
  let w = 0;
  for (let k = 1; k < real.length; k++) w += real[k] * Math.cos(2 * Math.PI * k * p) + imag[k] * Math.sin(2 * Math.PI * k * p);
  return w;
}

/** Base (Hz) y profundidad (Hz por unidad de onda) para que el LFO barra [fMin, fMax]. */
export function rangoBarrido(serie, fMin = SIRENA_TONO.fMin, fMax = SIRENA_TONO.fMax) {
  const prof = (fMax - fMin) / (serie.max - serie.min);
  return { base: fMin - serie.min * prof, prof };
}

/** Armónicos de la onda de pulso de la portadora (coseno). */
export function seriesPulso(n = SIRENA_TONO.armonicos, ciclo = SIRENA_TONO.pulso) {
  const real = new Float32Array(n + 1);
  const imag = new Float32Array(n + 1);
  for (let k = 1; k <= n; k++) real[k] = (2 / (k * Math.PI)) * Math.sin(k * Math.PI * ciclo);
  return { real, imag };
}

/** Curva de la saturación suave (tanh normalizada). */
export function curvaSaturacion(n = 1024, empuje = SIRENA_TONO.saturacion) {
  const c = new Float32Array(n);
  const k = Math.tanh(empuje);
  for (let i = 0; i < n; i++) c[i] = Math.tanh(empuje * ((i / (n - 1)) * 2 - 1)) / k;
  return c;
}
