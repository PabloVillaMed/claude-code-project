// La estampida de las discotecas (puro, sin three.js): cuando hay tiros
// adentro o el jugador apunta a la gente, todos corren a la salida en orden.
// Aquí va lo que lo vuelve una cola y no un montón: quién va primero (el que
// le falta menos camino), cuánto frena el que tiene a alguien adelante en la
// misma dirección (así nadie se atraviesa ni se queda trabado en la puerta) y
// la bajada del mezanine por su escalera hasta el piso del salón, donde sigue
// por el campo de la salida (sim/clubLife.js salidaDe y pasoSalida).
//
// game/clubLife.js llena los arreglos de posiciones y prioridades una vez por
// cuadro (sin crear objetos) y le pregunta a frenoCola por cada corredor.

import { campoHacia } from './clubLife.js';

// ------------------------------------------------------------------ configurables
/** Las reglas de la estampida. */
export const ESTAMPIDA = {
  /** m: a esta distancia (o menos) del de adelante se para; a SEP_FRENO empieza a frenar. */
  SEP_MIN: 0.5,
  SEP_FRENO: 1.05,
  /** Coseno mínimo para contar a alguien como "adelante" (0.35 ≈ un cono de 140°). */
  CONO: 0.35,
  /** m de diferencia de altura para ignorarse (uno en el mezanine y otro abajo). */
  OTRO_PISO: 1.2,
  /** Atasco: s sin moverse ATASCO_MUEVE m (y frenado a menos de ATASCO_FRENO) antes de colarse sin frenar ATASCO_PASA s (nadie se queda trabado para siempre). */
  ATASCO: 3.5,
  ATASCO_FRENO: 0.15,
  ATASCO_MUEVE: 0.25,
  ATASCO_PASA: 1.2,
  /** Al colarse va a esta fracción de su velocidad (1 = pasa rápido: se nota menos que meterse despacio entre la gente). */
  PASA_VEL: 1,
  /** Los sentados (mesas, sofás) también corren, con esta demora extra (s) para pararse; false = se cubren donde están. */
  SENTADOS_CORREN: true,
  LEVANTARSE: 0.55,
  /** Los del mezanine bajan por la escalera (false = se agachan arriba). */
  MEZZ_BAJA: true,
  /** La música del local: fracción con la estampida en curso y mientras el local sigue casi vacío. */
  MUSICA_PANICO: 0.2,
  MUSICA_VACIO: 0.55,
  /** Celda (m) de la rejilla del mezanine y radio de una persona (m). */
  CELDA: 0.35,
  RADIO: 0.3,
};

const dentro = (it, x, z, R) => x > it.x0 - R && x < it.x1 + R && z > it.z0 - R && z < it.z1 + R;

/** La escalera que llega al mezanine de `r` (o null). */
export function escaleraMezz(r) {
  const m = r?.mezz;
  if (!m) return null;
  return r.stairs.find((s) => Math.abs(s.yHigh - m.y) < 0.01) ?? null;
}

/** ¿Unos pies a la altura `y` están en el mezanine de `r`? */
export function enMezz(r, lx, lz, y) {
  const m = r?.mezz;
  return !!m && Math.abs(y - m.y) < 0.8 && lx >= m.x0 && lx <= m.x1 && lz >= m.z0 - 0.05 && lz <= m.z1;
}

/**
 * Rejilla del piso del mezanine (la misma forma que sim/clubLife.js
 * rejilla): libre lo que no tocan sofás, mesitas ni la baranda del borde
 * (salvo el hueco de la escalera).
 */
export function rejillaMezz(r) {
  const m = r.mezz;
  const st = escaleraMezz(r);
  const c = ESTAMPIDA.CELDA;
  const R = ESTAMPIDA.RADIO;
  const x0 = m.x0;
  const z0 = m.z0;
  const nx = Math.max(1, Math.ceil((m.x1 - m.x0) / c));
  const nz = Math.max(1, Math.ceil((m.z1 - m.z0) / c));
  const libre = new Uint8Array(nx * nz);
  const bloques = r.items.filter((it) => it.solid && it.y >= m.y - 0.35 && it.y < m.y + 1.2);
  for (let j = 0; j < nz; j++)
    for (let i = 0; i < nx; i++) {
      const x = x0 + (i + 0.5) * c;
      const z = z0 + (j + 0.5) * c;
      let ok = x > m.x0 + R * 0.6 && x < m.x1 - R * 0.6 && z < m.z1 - R * 0.6;
      // La baranda del borde: solo se pasa por el hueco de la escalera.
      if (ok && z < m.z0 + R + 0.1) ok = !!st && x > st.x0 + R * 0.8 && x < st.x1 - R * 0.8;
      for (let k = 0; ok && k < bloques.length; k++) if (dentro(bloques[k], x, z, R)) ok = false;
      libre[j * nx + i] = ok ? 1 : 0;
    }
  return { x0, z0, nx, nz, celda: c, libre };
}

/**
 * Cómo se baja del mezanine de `r`: {g, campo (hacia la llegada de la
 * escalera), tramo (de la llegada al pie de la escalera, ya en el piso del
 * salón), ancho (m a cada lado del centro de la escalera)} o null si no hay.
 */
export function bajadaMezz(r) {
  const st = escaleraMezz(r);
  if (!st || !r.mezz) return null;
  const g = rejillaMezz(r);
  const cx = (st.x0 + st.x1) / 2;
  const arriba = r.mezz.z0 + 0.45;
  return { g, campo: campoHacia(g, cx, arriba), tramo: [{ x: cx, z: arriba - 0.2 }, { x: cx, z: st.z0 - 0.5 }], ancho: Math.max(0, Math.min(0.3, (st.x1 - st.x0) / 2 - 0.4)) };
}

const celda = (g, lx, lz) => {
  const i = Math.min(g.nx - 1, Math.max(0, Math.floor((lx - g.x0) / g.celda)));
  const j = Math.min(g.nz - 1, Math.max(0, Math.floor((lz - g.z0) / g.celda)));
  return j * g.nx + i;
};

/** Largo (m) del tramo de `S` desde el punto k (cacheado en S.largos). */
function largoTramo(S, k) {
  if (!S.largos) {
    const n = S.tramo.length;
    S.largos = new Float32Array(n + 1);
    for (let q = n - 2; q >= 0; q--) S.largos[q] = S.largos[q + 1] + Math.hypot(S.tramo[q + 1].x - S.tramo[q].x, S.tramo[q + 1].z - S.tramo[q].z);
  }
  return S.largos[Math.min(k, S.tramo.length)];
}

/**
 * Metros que le faltan al que va por `e` ({lx, lz, k}) para salir por `S`
 * (salidaDe o bajadaMezz); `extra`: lo que falta después (desde el pie de la
 * escalera del mezanine hasta la calle). Sirve para ordenar la cola.
 */
export function restante(S, e, extra = 0) {
  if (e.k >= S.tramo.length) return extra;
  if (e.k >= 0) {
    const p = S.tramo[e.k];
    return Math.hypot(p.x - e.lx, p.z - e.lz) + largoTramo(S, e.k) + extra;
  }
  const g = S.campo.g;
  const v = S.campo.dist[celda(g, e.lx, e.lz)];
  const t = S.tramo[0];
  return (v >= 0 ? (v / 10) * g.celda : Math.hypot(t.x - e.lx, t.z - e.lz) + 8) + largoTramo(S, 0) + extra;
}

/**
 * Freno del corredor `i` (0 = quieto .. 1 = a toda): frena si tiene a alguien
 * adelante (en el cono de la dirección en que va, dxs/dzs) a menos de
 * SEP_FRENO m; a SEP_MIN m se para. Si los dos se tienen adelante (de
 * frente, o cruzándose), pasa primero el que tiene menos camino (`prio` =
 * metros que le faltan; empate: el de menor índice). Así el de adelante
 * nunca frena por el de atrás y la cola siempre avanza. Posiciones del mundo
 * en xs/ys/zs.
 */
export function frenoCola(xs, ys, zs, dxs, dzs, prio, n, i) {
  const E = ESTAMPIDA;
  const l = Math.hypot(dxs[i], dzs[i]);
  if (l < 1e-6) return 1;
  const ux = dxs[i] / l;
  const uz = dzs[i] / l;
  let f = 1;
  const xi = xs[i];
  const zi = zs[i];
  for (let j = 0; j < n; j++) {
    if (j === i) continue;
    const vx = xs[j] - xi;
    const vz = zs[j] - zi;
    if (vx > E.SEP_FRENO || vx < -E.SEP_FRENO || vz > E.SEP_FRENO || vz < -E.SEP_FRENO) continue;
    if (Math.abs(ys[j] - ys[i]) > E.OTRO_PISO) continue;
    const d = Math.hypot(vx, vz);
    if (d >= E.SEP_FRENO) continue;
    if (d > 1e-6 && (vx * ux + vz * uz) / d < E.CONO) continue;
    // ¿El otro también me tiene adelante? Entonces pasa el que tiene menos camino.
    const lj = Math.hypot(dxs[j], dzs[j]);
    if (lj > 1e-6 && d > 1e-6 && -(vx * dxs[j] + vz * dzs[j]) / (d * lj) >= E.CONO && (prio[j] > prio[i] || (prio[j] === prio[i] && j > i))) continue;
    const k = (d - E.SEP_MIN) / (E.SEP_FRENO - E.SEP_MIN);
    if (k < f) f = k < 0 ? 0 : k;
    if (f === 0) break;
  }
  return f;
}
