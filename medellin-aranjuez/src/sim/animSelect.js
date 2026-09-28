// Elección de animaciones de los personajes (lógica pura, sin three.js):
// gestos de relleno, lo que hace con las manos un peatón quieto o caminando,
// estilos de caminar, el gesto que acompaña cada tipo de línea de diálogo, los
// gestos al comprar y los emotes del jugador. Los nombres son los clips de
// render/characterRig.js (scripts/assets/rocketbox.mjs, CLIPS).

/** Mezcla dos enteros en 32 bits (misma entrada, misma salida). */
export function mix32(a, b = 0) {
  let h = (a | 0) ^ Math.imul(b | 0, 0x9e3779b1) ^ 0x85ebca6b;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  return (h ^ (h >>> 16)) >>> 0;
}

/** Número estable en [0, 1) a partir de dos enteros. */
export function unit(a, b = 0) {
  return mix32(a, b) / 4294967296;
}

/** Gestos de relleno cuando el personaje lleva un rato quieto. */
export const FIDGETS = {
  stand: ['idle_look', 'idle_scratch', 'idle_yawn', 'idle_stretch', 'idle_cough'],
  sit: ['sit_look', 'sit_scratch', 'sit_yawn', 'sit_shrug', 'sit_think'],
  // Sentado a la mesa (dominó): los brazos se quedan sobre la mesa.
  table: ['sit_table_look', 'sit_table_think', 'sit_table_shrug'],
};

/** Reposo de un peatón (no todos respiran igual): 'idle', 'idle_b' o 'idle_wait', estable por id. */
export function idleVariant(id) {
  const r = unit(id, 41);
  return r < 0.45 ? 'idle' : r < 0.75 ? 'idle_b' : 'idle_wait';
}

/**
 * Próximo gesto de relleno: uno de la lista que exista (`has`), distinto del
 * anterior. `r` en [0, 1).
 */
export function pickFidget(list, last, r, has = () => true) {
  const pool = list.filter((n) => n !== last && has(n));
  if (!pool.length) return list.find((n) => has(n)) ?? null;
  return pool[Math.floor(r * pool.length) % pool.length];
}

/** Segundos quieto antes del próximo gesto de relleno (el primero tarda un poco más). */
export function fidgetDelay(first, r) {
  return first ? 6 + r * 5 : 8 + r * 12;
}

/**
 * Qué hace con las manos un peatón quieto en su parada número `stop`: null
 * (nada), 'phone' (llamada) o 'text' (escribe en el celular). Estable por
 * peatón y parada, para que no cambie cada cuadro.
 */
export function standingActivity(id, stop) {
  const r = unit(id, stop * 7 + 1);
  return r < 0.2 ? 'phone' : r < 0.36 ? 'text' : null;
}

/** ¿Va hablando por celular en este tramo de caminata? (uno de cada ~12). */
export function walkingActivity(id, leg) {
  return unit(id, leg * 13 + 5) < 0.08 ? 'phone' : null;
}

/** ¿Es de noche para la rumba? (21:00 a 04:00). */
export function partyHours(hour) {
  return hour != null && (hour >= 21 || hour < 4);
}

/**
 * Estilo de caminar de un peatón: los pandilleros caminan "sobrados", de
 * noche a algunos hombres se les nota la rumba, otros van despacio (paseo) y
 * el resto normal. `hour` es la hora del juego (0..24).
 */
export function walkStyle({ id, faction, female = false, hour = null }) {
  if (faction === 'gang') return 'cool';
  if (faction !== 'civil') return null;
  const r = unit(id, 99);
  if (!female && partyHours(hour) && r < 0.12) return 'drunk';
  return r > 0.62 ? 'stroll' : null;
}

/**
 * Cuánto más despacio camina un peatón con ese estilo: los clips de paseo y
 * de borracho avanzan mucho menos por paso que el caminar normal y, a la
 * misma velocidad, los pies patinaban (el ciclo no se puede acelerar más de
 * ~1.6 veces sin que se vea a cámara rápida).
 */
export function walkSpeedScale(style) {
  return style === 'stroll' ? 0.74 : style === 'drunk' ? 0.7 : style === 'cool' ? 0.92 : 1;
}

/** El jugador con poca salud camina cojeando. */
export function playerStyle(health) {
  return health > 0 && health < 30 ? 'injured' : null;
}

/**
 * Lo que hacen los brazos mientras alguien dice una línea, por categoría
 * (game/dialogue.js; 'charla_3' cuenta como 'charla'): {gesture} = gesto de
 * una vez al empezar; {upper} = brazos mientras habla. Los sustos (disparos,
 * muertos, empujones...) no llevan gesto: el cuerpo ya está huyendo.
 */
export function speechGesture(cat) {
  switch (String(cat).split('_')[0]) {
    case 'saludo':
      return { gesture: 'wave' };
    case 'pregon':
    case 'policia':
    case 'carro':
    case 'golpe':
      return { upper: 'talk_excited' };
    case 'comentario':
    case 'charla':
      return { upper: 'talk' };
    default:
      return { upper: null };
  }
}

/** Gestos del jugador al comprar: comida → recibir y comer/beber; lo demás → recibir. */
export function purchaseGestures(kind) {
  if (kind === 'food') return ['take', 'drink'];
  if (kind === 'weapon' || kind === 'ammo' || kind === 'armor' || kind === 'health') return ['take'];
  return [];
}

/** Emotes del jugador (tecla G), en orden. */
export const EMOTES = ['wave', 'cheer', 'clap', 'dance', 'shrug'];

/** Índice del próximo emote. */
export function nextEmote(i) {
  return (i + 1) % EMOTES.length;
}
