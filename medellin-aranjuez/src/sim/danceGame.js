// El minijuego de baile en la pista de las discotecas (puro y determinista,
// sin three.js ni DOM): el jugador toca cuatro carriles (izquierda, abajo,
// arriba, derecha) al compás de la canción que suena. Aquí van los patrones
// de cada estilo (reguetón, salsa, música popular, electrónica), la tanda
// (una canción del minijuego: unos compases con cuenta de entrada), el juicio
// de cada toque (perfecto, bien, justo o fallo, con ventanas generosas en
// segundos), los puntos, el combo y su multiplicador, los pasos vistosos que
// se ganan con combo alto y la propina, con tope por tanda y por noche.
//
// El tiempo es el de la música (b: tiempos transcurridos, game/danceGame.js
// lo saca del reloj de la pista con sim/pulsos.js); las ventanas se miden en
// segundos con el tempo de la tanda, así un tempo rápido no las achica.
// La interfaz (ui/danceHud.js) dibuja las notas de S.notas; el juego reparte
// los toques (teclado, mando, pantalla) con tocarTanda.

import { makeRng } from './rng.js';

// ------------------------------------------------------------------ configurables
/** Las reglas del minijuego. */
export const RITMO = {
  /** Ventanas de acierto (s a cada lado del golpe): perfecto, bien y justo; más lejos el toque no le pega a esa nota. */
  VENTANA: { perfecto: 0.075, bien: 0.14, justo: 0.22 },
  /** Puntos por acierto, antes del multiplicador. */
  PUNTOS: { perfecto: 100, bien: 60, justo: 25 },
  /** El multiplicador sube 1 cada COMBO_PASO aciertos seguidos, hasta MULT_MAX. */
  COMBO_PASO: 8,
  MULT_MAX: 4,
  /** Fallos seguidos (notas que pasan o toques sin nota) que bajan el combo, y la fracción que queda (sin castigo en plata). */
  FALLOS_BAJAN: 2,
  COMBO_TRAS_FALLOS: 0.5,
  /** Combo para el paso doble (baila al doble), para la vuelta (cada compás de 4) y para llenar del todo la emoción (luces, gritos). */
  COMBO_DOBLE: 8,
  COMBO_VUELTA: 16,
  COMBO_EMOCION: 24,
  /** Compases de 4 tiempos que dura una tanda (si la canción no se acaba antes) y tiempos de cuenta antes de la primera nota. */
  TANDA_COMPASES: 24,
  ENTRADA: 4,
  /** La dificultad sube un nivel cada NIVEL_COMPASES compases de la tanda (0..2), y baja uno con el combo en cero tras fallar. */
  NIVEL_COMPASES: 6,
  /** Notas por segundo como máximo: a tempos rápidos se quitan primero las de contratiempo. */
  NOTAS_SEG_MAX: 3.4,
  /** Compases que se generan por adelantado (la pista los muestra antes de que lleguen). */
  ADELANTO: 3,
};

/** La plata del minijuego: pequeña y con tope, para que no sea una mina. */
export const PROPINA = {
  /** $ por cada tantos puntos de la tanda. */
  PUNTOS_POR_PESO: 45,
  /** Fracción mínima de notas acertadas para que alguien le dé propina. */
  MIN_ACIERTO: 0.45,
  /** Notas juzgadas mínimas (salir de una no da plata). */
  MIN_NOTAS: 12,
  /** Tope por tanda y por noche de juego (todas las discotecas juntas), y redondeo ($). */
  MAX_TANDA: 60,
  TOPE_NOCHE: 180,
  REDONDEO: 5,
};

/** Los carriles, en el orden de la pista: teclas A/←, S/↓, W/↑, D/→; en el mando X, A, Y, B. */
export const CARRILES = ['izquierda', 'abajo', 'arriba', 'derecha'];

/**
 * Patrones de un compás (4 tiempos) por estilo y nivel (0 fácil .. 2):
 * [tiempo dentro del compás, carril]. Carriles: 0 izquierda, 1 abajo,
 * 2 arriba, 3 derecha. Reguetón: el dembow (golpes en 1 y 3, y el
 * contratiempo de 0.75 y 1.5). Salsa: cada tiempo son dos cuentas (1-2-3,
 * 5-6-7: adelante arriba, atrás abajo). Popular: el vaivén de lado a lado y
 * el brindis. Electrónica: cuatro en el piso y el contratiempo.
 */
export const PATRONES = {
  regueton: [
    [
      [[0, 0], [2, 3]],
      [[0, 3], [2, 0]],
      [[0, 0], [1, 1], [2, 3]],
    ],
    [
      [[0, 0], [1, 1], [2, 3], [3, 2]],
      [[0, 0], [1.5, 0], [2, 3], [3.5, 3]],
      [[0, 3], [1, 2], [2, 0], [3, 1]],
    ],
    [
      [[0, 0], [0.75, 1], [1.5, 0], [2, 3], [2.75, 2], [3.5, 3]],
      [[0, 0], [1, 3], [1.5, 0], [2, 1], [3, 2], [3.5, 1]],
      [[0, 3], [0.75, 2], [1.5, 3], [2, 0], [3, 0], [3.5, 1]],
    ],
  ],
  salsa: [
    [
      [[0, 2], [2, 1]],
      [[0, 2], [1, 2], [2, 1]],
    ],
    [
      [[0, 2], [1, 2], [2, 1], [3, 1]],
      [[0, 0], [1, 2], [2, 3], [3, 1]],
    ],
    [
      [[0, 2], [0.5, 0], [1, 2], [2, 1], [2.5, 3], [3, 1]],
      [[0, 2], [0.5, 3], [1, 2], [2, 1], [2.5, 0], [3, 1]],
      [[0, 0], [0.5, 2], [1, 3], [2, 3], [2.5, 1], [3, 0]],
    ],
  ],
  popular: [
    [
      [[0, 0], [2, 3]],
      [[0, 3], [2, 0]],
    ],
    [
      [[0, 0], [1, 3], [2, 0], [3, 3]],
      [[0, 0], [1, 0], [2, 3], [3, 3]],
      [[0, 2], [1, 2], [2, 1], [3, 1]],
    ],
    [
      [[0, 0], [1, 3], [2, 0], [2.5, 2], [3, 3]],
      [[0, 3], [0.5, 2], [1, 0], [2, 3], [2.5, 1], [3, 0]],
      [[0, 2], [1, 2], [2, 1], [3, 1], [3.5, 2]],
    ],
  ],
  electronica: [
    [
      [[0, 1], [2, 1]],
      [[0, 1], [2, 2]],
    ],
    [
      [[0, 1], [1, 2], [2, 1], [3, 2]],
      [[0, 0], [1, 1], [2, 3], [3, 2]],
    ],
    [
      [[0, 1], [0.5, 0], [1, 2], [2, 1], [2.5, 3], [3, 2]],
      [[0, 1], [1, 2], [1.5, 2], [2, 1], [3, 0], [3.5, 3]],
      [[0, 0], [0.5, 1], [1, 2], [1.5, 3], [2, 1], [3, 2]],
    ],
  ],
};

// ------------------------------------------------------------------ patrones
const hash = (a, b) => {
  let h = Math.imul((a | 0) ^ 0x9e3779b1, 0x85ebca6b) ^ Math.imul((b | 0) + 0x632be5ab, 0xc2b2ae35);
  h ^= h >>> 13;
  h = Math.imul(h, 0x27d4eb2f);
  return (h ^ (h >>> 15)) >>> 0 || 1;
};

/** Patrones del estilo (los de reguetón si no hay del estilo). */
export const patronesDe = (estilo) => PATRONES[estilo] ?? PATRONES.regueton;

/**
 * Notas del compás número `compas` (0 = el que arranca en el tiempo 0) para
 * el estilo, nivel (0..2) y semilla: [{b, carril}] con b en tiempos de la
 * música, ordenadas. Mismo estilo, compás, nivel y semilla, mismas notas.
 * Con `bpm`, a tempo rápido se ralea (quita primero los contratiempos) para
 * no pasar de NOTAS_SEG_MAX. A veces sale espejado (izquierda por derecha).
 */
export function notasCompas(estilo, compas, nivel, semilla = 1, bpm = 0, out = []) {
  const niveles = patronesDe(estilo);
  const lista = niveles[Math.max(0, Math.min(niveles.length - 1, nivel | 0))];
  const rng = makeRng(hash(semilla, compas));
  const m = lista[Math.floor(rng.next() * lista.length) % lista.length];
  const espejo = rng.next() < 0.35;
  const base = compas * 4;
  const tope = bpm > 0 ? Math.floor((RITMO.NOTAS_SEG_MAX * 4 * 60) / bpm) : Infinity;
  let quitar = Math.max(0, m.length - tope);
  for (let i = 0; i < m.length; i++) {
    const [t, c] = m[i];
    if (quitar > 0 && t % 1 !== 0) {
      quitar--;
      continue;
    }
    out.push({ b: base + t, carril: espejo ? (c === 0 ? 3 : c === 3 ? 0 : c) : c });
  }
  // (Si aún sobran, los de los tiempos pares se quedan.)
  while (out.length && quitar-- > 0) {
    const k = out.findIndex((n) => (n.b - base) % 2 !== 0);
    if (k < 0) break;
    out.splice(k, 1);
  }
  return out;
}

// ------------------------------------------------------------------ la tanda
/**
 * Tanda nueva del estilo a partir del tiempo `b` de la música, al tempo
 * `bpm`: la primera nota cae en el primer compás que empiece después de
 * ENTRADA tiempos de cuenta. `nivel`: con cuál arranca (el que traía).
 */
export function nuevaTanda(estilo, semilla, b, bpm, { nivel = 0, compases = RITMO.TANDA_COMPASES } = {}) {
  const c0 = Math.ceil((b + RITMO.ENTRADA) / 4 - 1e-9);
  return {
    estilo,
    semilla: semilla >>> 0 || 1,
    bpm,
    inicio: b,
    c0, // primer compás con notas
    c1: c0 + compases, // compás donde termina
    nivel0: Math.max(0, Math.min(2, nivel | 0)),
    nivelBaja: 0,
    hasta: c0, // compases ya generados: [c0, hasta)
    notas: [], // {b, carril, estado: 0 pendiente / 1 acertada / 2 fallada, juicio, dt}
    puntos: 0,
    combo: 0,
    comboMax: 0,
    fallosSeguidos: 0,
    juicios: { perfecto: 0, bien: 0, justo: 0, fallo: 0 },
    acertadas: 0,
    juzgadas: 0,
    fueraDeNota: 0,
    terminada: false,
    pagada: false,
  };
}

/** Nivel de dificultad del compás `c` de la tanda. */
export function nivelCompas(S, c) {
  const sube = Math.floor((c - S.c0) / RITMO.NIVEL_COMPASES);
  return Math.max(0, Math.min(2, S.nivel0 + sube - S.nivelBaja));
}

/** Multiplicador de puntos con `combo` aciertos seguidos. */
export function multiplicador(combo) {
  return Math.min(RITMO.MULT_MAX, 1 + Math.floor(combo / RITMO.COMBO_PASO));
}

/** Puntos de un acierto `juicio` con el combo que traía (antes de sumarlo). */
export function puntosDe(juicio, combo) {
  return (RITMO.PUNTOS[juicio] ?? 0) * multiplicador(combo);
}

/** Juicio de un toque a `dt` segundos del golpe (o null si no le pega). */
export function juicioDe(dt) {
  const a = Math.abs(dt);
  const V = RITMO.VENTANA;
  return a <= V.perfecto ? 'perfecto' : a <= V.bien ? 'bien' : a <= V.justo ? 'justo' : null;
}

/** Qué tan vistoso baila con ese combo: 'normal', 'doble' (al doble) o 'vuelta' (doble y una vuelta por compás). */
export function pasoVistoso(combo) {
  return combo >= RITMO.COMBO_VUELTA ? 'vuelta' : combo >= RITMO.COMBO_DOBLE ? 'doble' : 'normal';
}

/** Emoción del local con ese combo (0..1): luces, gritos y aplausos. */
export function emocionDe(combo) {
  return Math.max(0, Math.min(1, combo / RITMO.COMBO_EMOCION));
}

function fallar(S, ev, nota = null) {
  S.juicios.fallo++;
  S.fallosSeguidos++;
  if (S.fallosSeguidos >= RITMO.FALLOS_BAJAN) {
    S.combo = Math.floor(S.combo * RITMO.COMBO_TRAS_FALLOS);
    S.fallosSeguidos = 0;
    if (S.combo === 0) S.nivelBaja = Math.min(2, S.nivelBaja + 1);
  }
  ev?.push({ tipo: 'fallo', nota, combo: S.combo });
}

function acertar(S, n, dt, ev) {
  const j = juicioDe(dt) ?? 'justo';
  n.estado = 1;
  n.juicio = j;
  n.dt = dt;
  S.puntos += puntosDe(j, S.combo);
  S.combo++;
  if (S.combo > S.comboMax) S.comboMax = S.combo;
  S.fallosSeguidos = 0;
  if (S.nivelBaja && S.combo >= RITMO.COMBO_PASO) S.nivelBaja--;
  S.juicios[j]++;
  S.acertadas++;
  S.juzgadas++;
  ev?.push({ tipo: j, nota: n, combo: S.combo });
}

/**
 * Avanza la tanda hasta el tiempo `b` de la música: genera las notas que se
 * acercan, da por falladas las que ya pasaron su ventana y la termina al
 * pasar el último compás. Deja en `ev` lo que pasó ({tipo: 'fallo', ...} y
 * {tipo: 'fin'}). Devuelve `ev`.
 */
export function avanzarTanda(S, b, ev = []) {
  if (S.terminada) return ev;
  // Notas por adelantado (sin pasar del final de la tanda).
  const quiero = Math.min(S.c1, Math.floor(b / 4) + RITMO.ADELANTO + 1);
  while (S.hasta < quiero) {
    const k = S.notas.length;
    notasCompas(S.estilo, S.hasta, nivelCompas(S, S.hasta), S.semilla, S.bpm, S.notas);
    for (let i = k; i < S.notas.length; i++) {
      const n = S.notas[i];
      n.estado = 0;
      n.juicio = null;
      n.dt = 0;
      n.compas = S.hasta;
    }
    S.hasta++;
  }
  // Las que pasaron sin tocarse.
  const tarde = (RITMO.VENTANA.justo * S.bpm) / 60;
  for (const n of S.notas) {
    if (n.estado !== 0 || b - n.b <= tarde) continue;
    n.estado = 2;
    S.juzgadas++;
    fallar(S, ev, n);
  }
  // Se sueltan las ya juzgadas que quedaron atrás (la pista solo muestra las cercanas).
  let k = 0;
  while (k < S.notas.length && S.notas[k].estado !== 0 && b - S.notas[k].b > 2) k++;
  if (k) S.notas.splice(0, k);
  if (b >= S.c1 * 4 + tarde && S.hasta >= S.c1 && !S.notas.some((n) => n.estado === 0)) {
    S.terminada = true;
    ev.push({ tipo: 'fin' });
  }
  return ev;
}

/**
 * El jugador toca el carril `carril` en el tiempo `b` de la música. Le pega
 * a la nota pendiente de ese carril más cercana dentro de la ventana; si no
 * hay, es un fallo (así tocar a lo loco no sirve). Devuelve el evento
 * ({tipo: 'perfecto' | 'bien' | 'justo' | 'fallo', nota, combo}) y lo deja
 * también en `ev`.
 */
export function tocarTanda(S, carril, b, ev = null) {
  if (S.terminada) return null;
  const spb = 60 / S.bpm;
  let best = null;
  let bd = Infinity;
  for (const n of S.notas) {
    if (n.estado !== 0 || n.carril !== carril) continue;
    const dt = (b - n.b) * spb;
    if (Math.abs(dt) <= RITMO.VENTANA.justo && Math.abs(dt) < Math.abs(bd)) {
      best = n;
      bd = dt;
    }
  }
  const out = ev ?? [];
  const k = out.length;
  if (best) acertar(S, best, bd, out);
  else {
    S.fueraDeNota++;
    fallar(S, out, null);
  }
  return out[k];
}

/** Pruebas: le pega perfecto a la siguiente nota pendiente (sin importar el tiempo). */
export function acertarSiguiente(S, ev = null) {
  if (S.terminada) return null;
  let n = null;
  for (const q of S.notas) if (q.estado === 0 && (!n || q.b < n.b)) n = q;
  if (!n) return null;
  const out = ev ?? [];
  acertar(S, n, 0, out);
  return out[out.length - 1];
}

/** Fracción de notas acertadas de las juzgadas (0..1). */
export function precision(S) {
  return S.juzgadas ? S.acertadas / S.juzgadas : 0;
}

/**
 * Propina de la tanda ($): por puntos, redondeada, solo si acertó lo
 * suficiente, con tope por tanda y con lo que le queda de la noche
 * (`ganadoNoche`: lo que ya se ganó bailando esta noche).
 */
export function propinaTanda(S, ganadoNoche = 0) {
  const P = PROPINA;
  if (S.juzgadas < P.MIN_NOTAS || precision(S) < P.MIN_ACIERTO) return 0;
  const base = Math.round(S.puntos / P.PUNTOS_POR_PESO / P.REDONDEO) * P.REDONDEO;
  const queda = Math.max(0, P.TOPE_NOCHE - ganadoNoche);
  return Math.max(0, Math.min(base, P.MAX_TANDA, queda));
}

/** Resumen para la interfaz y las pruebas. */
export function resumenTanda(S) {
  return {
    estilo: S.estilo,
    bpm: +S.bpm.toFixed(2),
    puntos: S.puntos,
    combo: S.combo,
    comboMax: S.comboMax,
    multiplicador: multiplicador(S.combo),
    juicios: { ...S.juicios },
    acertadas: S.acertadas,
    juzgadas: S.juzgadas,
    precision: +precision(S).toFixed(3),
    pendientes: S.notas.filter((n) => n.estado === 0).length,
    compas0: S.c0,
    compasFin: S.c1,
    terminada: S.terminada,
  };
}
