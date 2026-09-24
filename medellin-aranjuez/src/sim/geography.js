// Geografía del Valle de Aburrá alrededor de Aranjuez (solo para el fondo):
// el río Medellín al oeste, el fondo plano del valle, la ladera occidental
// que sube hasta ~2.700-3.000 m (Padre Amaya), la oriental que trepa hacia
// Santo Domingo y Arví, y los cerros que se reconocen desde el barrio (El
// Volador, Nutibara, Quitasol). Valores aproximados a partir de la elevación
// SRTM y la cartografía de OpenStreetMap.
//
// Coordenadas del juego (1 unidad = 1 m): x = este, z = sur (el norte es -z),
// origen en el centro del mapa. Las alturas se devuelven en metros del juego:
// y = altura sobre el nivel del mar − GEO_REF.

/** Altura sobre el mar que corresponde a y = 0 en el juego. */
export const GEO_REF = 1512;
/** Altura del fondo del valle junto al río frente a Aranjuez. */
export const VALLEY_FLOOR = 1460;

// Eje del río (este, en función del norte): baja casi recto de sur a norte
// y en Bello gira hacia el nororiente (Copacabana).
const RIVER = [
  [-40000, -1800],
  [-15000, -1400],
  [-8000, -1250],
  [0, -1000],
  [6000, -700],
  [10000, 800],
  [16000, 4200],
  [40000, 14000],
];

// Cerros: [este, norte, altura extra (m), radio (m)].
const HILLS = [
  [-3300, 1300, 160, 430], // Cerro El Volador (bosque, 1.628 m)
  [-2600, 5200, 85, 300], // Cerro Nutibara (Pueblito Paisa)
  [-2500, -11500, 1050, 1500], // Cerro Quitasol (Bello, 2.880 m)
  [-9800, 2500, 320, 2600], // Cerro del Padre Amaya
  [5200, 4000, 260, 1500], // Cerro Pan de Azúcar (suroriente)
].map(([e, n, h, r]) => ({ x: e, z: n, h, r })); // n positivo = sur (z del juego)

function lerpTable(t, v) {
  if (v <= t[0][0]) return t[0][1];
  for (let i = 1; i < t.length; i++) {
    if (v <= t[i][0]) {
      const [a0, b0] = t[i - 1];
      const [a1, b1] = t[i];
      return b0 + ((b1 - b0) * (v - a0)) / (a1 - a0);
    }
  }
  return t[t.length - 1][1];
}

/** Coordenada x (este) del río a la altura z del juego. */
export function riverX(z) {
  return lerpTable(RIVER, -z);
}

/** Fondo del valle (m s. n. m.): sube hacia el sur (Envigado) y baja al norte. */
function floorAsl(z) {
  const north = -z;
  return VALLEY_FLOOR + (north < 0 ? -north * 0.004 : -north * 0.0018);
}

// Ruido suave determinista (sin dependencias) para las ondulaciones de las laderas.
function hash(ix, iz) {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iz, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function valueNoise(x, z) {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const u = fx * fx * (3 - 2 * fx);
  const v = fz * fz * (3 - 2 * fz);
  const a = hash(ix, iz);
  const b = hash(ix + 1, iz);
  const c = hash(ix, iz + 1);
  const d = hash(ix + 1, iz + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

/** Ruido de crestas (lomos y cañadas de las laderas), en [0, 1]. */
function ridged(x, z) {
  let s = 0;
  let amp = 0.55;
  let f = 1;
  for (let o = 0; o < 4; o++) {
    const n = 1 - Math.abs(valueNoise(x * f + o * 17.3, z * f - o * 9.1) * 2 - 1);
    s += n * n * amp;
    f *= 2.03;
    amp *= 0.5;
  }
  return s;
}

/**
 * Altura del valle (m s. n. m.) en (x, z) del juego. Continua y suave: la
 * usan tanto el terreno de fondo cercano como el horizonte lejano.
 */
export function valleyAsl(x, z) {
  const floor = floorAsl(z);
  const dx = x - riverX(z);
  let h = floor;
  if (dx < 0) {
    // Occidente: fondo ancho (Castilla, Laureles) y luego la ladera hasta la cuchilla.
    const t = Math.max(0, -dx - 2300);
    h += 12 + (-dx / 2300) * 18 * Math.min(1, -dx / 2300);
    h += 1450 * (1 - Math.exp(-Math.pow(t / 5200, 1.6)));
  } else {
    // Oriente: sube desde el río por Aranjuez y Manrique hasta Santo Domingo y Arví.
    const t = Math.max(0, dx - 450);
    h += 1400 * (1 - Math.exp(-Math.pow(t / 6300, 1.3)));
  }
  // Lomos y cañadas que bajan hacia el río (alargados de oriente a
  // occidente, como las quebradas del valle); crecen con la altura sobre el
  // fondo, que es plano.
  const rel = Math.min(1, (h - floor) / 700);
  h += rel * (260 * ridged(x / 3400, z / 1100) - 110) + rel * 45 * (valueNoise(x / 700, z / 450) - 0.5);
  for (const c of HILLS) {
    const d2 = (x - c.x) ** 2 + (z - c.z) ** 2;
    h += c.h * Math.exp(-d2 / (2 * c.r * c.r));
  }
  return h;
}

/** Altura del valle en metros del juego. */
export function valleyHeight(x, z) {
  return valleyAsl(x, z) - GEO_REF;
}

/**
 * ¿Hay ciudad en ese punto? Barrios hasta ~1.950-2.050 m (Robledo, San
 * Javier, Santo Domingo), bosque y potreros más arriba; los cerros tutelares
 * (Volador, Nutibara) son verdes.
 */
export function urbanAmount(x, z, asl = valleyAsl(x, z)) {
  for (const c of HILLS.slice(0, 2)) {
    if ((x - c.x) ** 2 + (z - c.z) ** 2 < (c.r * 1.25) ** 2) return 0;
  }
  const limit = 1960 + 90 * (valueNoise(x / 900, z / 900) - 0.5) * 2;
  const k = 1 - Math.min(1, Math.max(0, (asl - (limit - 120)) / 240));
  // Parches verdes pequeños dentro de la ciudad (quebradas, parques).
  const patch = valueNoise(x / 260 + 31, z / 260 - 7);
  return patch < 0.1 ? k * 0.3 : k;
}
