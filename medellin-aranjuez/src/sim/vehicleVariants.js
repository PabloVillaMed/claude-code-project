// Variantes de cada tipo de vehículo: el tipo (taxi, sedán, camioneta, moto...)
// decide cómo se juega (animaciones, subirse, choques); la variante decide el
// modelo, sus medidas y su motor. Proporciones y colores pensados para las
// calles de Medellín: muchas motos, muchos hatchback y sedanes pequeños,
// taxis amarillos y carros blancos, grises y plateados.
//
// Los nombres son genéricos (sin marcas): el tráfico se parece al de la
// ciudad sin copiar logos ni modelos registrados.

/**
 * id -> {type, model (GLB en public/models/vehiculos), name?, spec (se suma a
 * VEHICLE_TYPES[type]), engine (perfil de sonido), traffic y parked (pesos
 * relativos dentro del tipo)}.
 */
export const VEHICLE_VARIANTS = {
  // ------------------------------------------------------------- taxis
  taxi: { type: 'taxi', model: 'hatchback', engine: 'carro', traffic: 4, parked: 4 },
  taxi_pequeno: {
    type: 'taxi',
    model: 'hatch_pequeno',
    spec: { length: 3.6, width: 1.6, height: 1.47, mass: 860, wheelBase: 2.38, maxSpeed: 37, accel: 7 },
    engine: 'carro_pequeno',
    traffic: 4,
    parked: 3,
  },
  taxi_sedan: {
    type: 'taxi',
    model: 'sedan_compacto',
    spec: { length: 4.29, width: 1.74, height: 1.52, mass: 1030, wheelBase: 2.63, maxSpeed: 40 },
    engine: 'carro',
    traffic: 2,
    parked: 2,
  },
  // ------------------------------------------------------------- particulares
  sedan: { type: 'sedan', model: 'sedan', engine: 'carro', traffic: 2, parked: 2 },
  sedan_compacto: {
    type: 'sedan',
    model: 'sedan_compacto',
    name: 'Sedán compacto',
    spec: { length: 4.29, width: 1.74, height: 1.52, mass: 1030, wheelBase: 2.63, maxSpeed: 42, accel: 8 },
    engine: 'carro',
    traffic: 3,
    parked: 3,
  },
  hatch_pequeno: {
    type: 'sedan',
    model: 'hatch_pequeno',
    name: 'Hatchback',
    spec: { length: 3.6, width: 1.6, height: 1.47, mass: 860, wheelBase: 2.38, maxSpeed: 38, accel: 7.5, steerMax: 0.63 },
    engine: 'carro_pequeno',
    traffic: 3,
    parked: 3,
  },
  hatch_compacto: {
    type: 'sedan',
    model: 'hatch_compacto',
    name: 'Hatchback',
    spec: { length: 3.85, width: 1.66, height: 1.45, mass: 950, wheelBase: 2.45, maxSpeed: 41, accel: 8, steerMax: 0.62 },
    engine: 'carro_pequeno',
    traffic: 2,
    parked: 2,
  },
  clasico: {
    type: 'sedan',
    model: 'clasico',
    name: 'Carro clásico',
    spec: { length: 3.66, width: 1.52, height: 1.72, mass: 760, wheelBase: 2.4, maxSpeed: 30, accel: 5, mu: 0.85, grip: 8.5 },
    engine: 'carro_viejo',
    traffic: 1,
    parked: 2,
  },
  // ------------------------------------------------------------- camionetas
  camioneta: { type: 'camioneta', model: 'suv', engine: 'camioneta', traffic: 2, parked: 2 },
  suv_compacta: {
    type: 'camioneta',
    model: 'suv_compacta',
    name: 'Camioneta compacta',
    spec: { length: 4.32, width: 1.82, height: 1.69, mass: 1280, wheelBase: 2.67, maxSpeed: 43, accel: 7.5 },
    engine: 'camioneta',
    traffic: 3,
    parked: 3,
  },
  suv_mediana: {
    type: 'camioneta',
    model: 'suv_mediana',
    name: 'Camioneta',
    spec: { length: 4.48, width: 1.85, height: 1.66, mass: 1550, wheelBase: 2.67, maxSpeed: 46, accel: 8 },
    engine: 'camioneta',
    traffic: 2,
    parked: 2,
  },
  // ------------------------------------------------------------- servicio
  policia: { type: 'policia', model: 'suv', engine: 'camioneta', traffic: 1, parked: 1 },
  buseta: { type: 'buseta', model: 'buseta', engine: 'diesel', traffic: 1, parked: 1 },
  // ------------------------------------------------------------- motos
  moto: { type: 'moto', model: 'moto', engine: 'moto4t', traffic: 4, parked: 4 },
  moto_2t: {
    type: 'moto',
    model: 'moto_2t',
    name: 'Moto 2T',
    spec: { length: 1.95, width: 0.72, height: 1.12, mass: 115, maxSpeed: 34, accel: 10 },
    engine: 'moto2t',
    traffic: 2,
    parked: 3,
  },
  moto_enduro: {
    type: 'moto',
    model: 'moto_enduro',
    name: 'Moto enduro',
    spec: { length: 2.05, width: 0.8, height: 1.2, mass: 110, maxSpeed: 32, accel: 10.5, mu: 1.0 },
    engine: 'moto2t',
    traffic: 1,
    parked: 2,
  },
  moto_tt: {
    type: 'moto',
    model: 'moto_tt',
    name: 'Moto doble propósito',
    spec: { length: 2.15, width: 0.9, height: 1.3, mass: 150, maxSpeed: 39, accel: 10.5 },
    engine: 'moto4t_grande',
    traffic: 1,
    parked: 1,
  },
  scooter: {
    type: 'moto',
    model: 'scooter',
    name: 'Scooter',
    spec: { length: 1.8, width: 0.7, height: 1.15, mass: 100, maxSpeed: 27, accel: 8.5, wheelBase: 1.25 },
    engine: 'scooter',
    traffic: 3,
    parked: 3,
  },
  // Moto de domicilios: la de siempre con la caja en la parrilla.
  domicilio: { type: 'moto', model: 'moto', name: 'Moto de domicilios', spec: { mass: 190, maxSpeed: 40 }, engine: 'moto4t', box: true, traffic: 3, parked: 2 },
};

/** Variante por defecto de cada tipo (la del modelo original). */
const DEFAULT = { taxi: 'taxi', sedan: 'sedan', camioneta: 'camioneta', policia: 'policia', buseta: 'buseta', moto: 'moto' };

export function defaultVariant(type) {
  return DEFAULT[type] ?? null;
}

/** Variantes de un tipo. */
export function variantsOf(type) {
  return Object.entries(VEHICLE_VARIANTS)
    .filter(([, v]) => v.type === type)
    .map(([id]) => id);
}

/**
 * Elige una variante del tipo según sus pesos (`kind`: 'traffic' o
 * 'parked'); `rand` devuelve [0, 1).
 */
export function pickVariant(type, rand, kind = 'traffic') {
  const ids = variantsOf(type);
  const w = (id) => VEHICLE_VARIANTS[id][kind === 'parked' ? 'parked' : 'traffic'] ?? 1;
  const total = ids.reduce((a, id) => a + w(id), 0);
  let r = rand() * total;
  for (const id of ids) {
    r -= w(id);
    if (r < 0) return id;
  }
  return ids[ids.length - 1] ?? defaultVariant(type);
}

/** Perfil del motor (sonido) de una variante o, sin ella, del tipo. */
export function engineProfile(type, variant) {
  return VEHICLE_VARIANTS[variant]?.engine ?? (type === 'moto' ? 'moto4t' : type === 'buseta' ? 'diesel' : type === 'camioneta' || type === 'policia' ? 'camioneta' : 'carro');
}

// Colores de carro más vistos en la ciudad (pesos): blanco, plata, gris,
// negro, rojo, azul oscuro y alguno verde, vinotinto o champaña.
const CAR_COLORS = [
  [0xf2f2f0, 24],
  [0xc3c7cb, 18],
  [0x6f757b, 14],
  [0x141619, 12],
  [0xa3171b, 11],
  [0x1c2f5e, 8],
  [0x5c1320, 4],
  [0x3f5a45, 3],
  [0xc9b99a, 3],
  [0x2f6fb0, 3],
];
// Motos: negras, rojas, azules, blancas y grises.
const MOTO_COLORS = [
  [0x111214, 30],
  [0xc41e24, 22],
  [0x1f3f8a, 16],
  [0xefefef, 12],
  [0x5a5e63, 10],
  [0x2a9d5f, 5],
  [0xe07b10, 5],
];
// Cajas de domicilios: colores de las plataformas y tiendas (sin logos).
export const BOX_COLORS = [0xff5a1f, 0xff5a1f, 0xe6231f, 0x1f9d4c, 0xf2b705, 0x1b1b1b];

function weighted(list, rand) {
  const total = list.reduce((a, [, w]) => a + w, 0);
  let r = rand() * total;
  for (const [c, w] of list) {
    r -= w;
    if (r < 0) return c;
  }
  return list[0][0];
}

/** Color de pintura al azar para un tipo (taxi, patrulla y buseta tienen el suyo). */
export function randomPaint(type, rand) {
  return weighted(type === 'moto' ? MOTO_COLORS : CAR_COLORS, rand);
}
