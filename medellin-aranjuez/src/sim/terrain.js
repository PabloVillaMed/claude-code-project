// Terreno de ladera inspirado en Aranjuez: el barrio sube desde el río (oeste)
// hacia la montaña (este). Todo es analítico para que la física y el render
// coincidan exactamente.

export const GRID = {
  nx: 9, // manzanas en X
  nz: 9, // manzanas en Z
  pitch: 70, // distancia entre ejes de vías (m)
  asphaltHalf: 4.5, // media calzada (m) -> vía de 9 m, un carril por sentido
  blockInset: 4.5, // la manzana empieza donde termina el asfalto
  sidewalk: 2.5, // ancho del andén (m)
  curb: 0.15, // altura del sardinel/andén (m)
  laneOffset: 2.25, // centro del carril respecto al eje de la vía
};

/** Coordenada del eje de vía i (0..n). */
export const roadLine = (i, n) => (i - n / 2) * GRID.pitch;

export const MAP_MIN_X = roadLine(0, GRID.nx);
export const MAP_MAX_X = roadLine(GRID.nx, GRID.nx);
export const MAP_MIN_Z = roadLine(0, GRID.nz);
export const MAP_MAX_Z = roadLine(GRID.nz, GRID.nz);

/** Límite jugable (un poco más allá de las vías exteriores). */
export const PLAY_BOUNDS = {
  minX: MAP_MIN_X - 30,
  maxX: MAP_MAX_X + 30,
  minZ: MAP_MIN_Z - 30,
  maxZ: MAP_MAX_Z + 30,
};

// Morro de Moravia: una loma verde (jardín comunitario sobre el antiguo basurero).
export const MORAVIA = { x: roadLine(0, GRID.nx) + 35, z: roadLine(7, GRID.nz) + 35, h: 9, r: 18 };

/** Altura del terreno natural en (x, z). Pendiente media ~8 % con ondulaciones. */
export function terrainHeight(x, z) {
  let h =
    (x - MAP_MIN_X) * 0.075 +
    5.5 * Math.sin(z * 0.012 + 1.3) * Math.sin(x * 0.009) +
    2.0 * Math.sin(x * 0.021 + z * 0.017) +
    1.2 * Math.cos(z * 0.031 - x * 0.006);
  const dx = x - MORAVIA.x;
  const dz = z - MORAVIA.z;
  h += MORAVIA.h * Math.exp(-(dx * dx + dz * dz) / (2 * MORAVIA.r * MORAVIA.r));
  return h - 24;
}

/** Distancia desde (x) al eje de vía más cercano en un eje dado. */
function distToNearestLine(v, n) {
  const i = Math.round(v / GRID.pitch + n / 2);
  const ic = Math.min(n, Math.max(0, i));
  return Math.abs(v - roadLine(ic, n));
}

export function insideGrid(x, z) {
  return x >= MAP_MIN_X && x <= MAP_MAX_X && z >= MAP_MIN_Z && z <= MAP_MAX_Z;
}

/**
 * Manzanas fusionadas (sin vías internas). Cada una se expresa en índices de
 * manzana [ix0, iz0, ix1, iz1] inclusivos. El Jardín Botánico ocupa 2x2.
 */
export const MERGED_BLOCKS = [{ id: 'botanico', ix0: 0, iz0: 2, ix1: 1, iz1: 3 }];

export function mergedRect(m) {
  return {
    minX: roadLine(m.ix0, GRID.nx) + GRID.blockInset,
    maxX: roadLine(m.ix1 + 1, GRID.nx) - GRID.blockInset,
    minZ: roadLine(m.iz0, GRID.nz) + GRID.blockInset,
    maxZ: roadLine(m.iz1 + 1, GRID.nz) - GRID.blockInset,
  };
}
const MERGED_RECTS = MERGED_BLOCKS.map(mergedRect);

/** ¿El punto está sobre una calzada (asfalto) de la cuadrícula? */
export function onRoad(x, z) {
  for (const r of MERGED_RECTS) {
    if (x > r.minX && x < r.maxX && z > r.minZ && z < r.maxZ) return false;
  }
  const inX = z >= MAP_MIN_Z - GRID.asphaltHalf && z <= MAP_MAX_Z + GRID.asphaltHalf;
  const inZ = x >= MAP_MIN_X - GRID.asphaltHalf && x <= MAP_MAX_X + GRID.asphaltHalf;
  return (
    (inX && distToNearestLine(x, GRID.nx) <= GRID.asphaltHalf) ||
    (inZ && distToNearestLine(z, GRID.nz) <= GRID.asphaltHalf)
  );
}

/** ¿El punto está sobre la losa de una manzana (andén o interior)? */
export function onBlock(x, z) {
  return insideGrid(x, z) && !onRoad(x, z);
}

/** Altura del suelo caminable: terreno + andén si está sobre una manzana. */
export function groundHeight(x, z) {
  return terrainHeight(x, z) + (onBlock(x, z) ? GRID.curb : 0);
}

/**
 * Terreno de fondo (solo render): el valle de Medellín con el río al oeste
 * y laderas llenas de casas a ambos lados.
 */
export function backdropHeight(x, z) {
  const base = terrainHeight(x, z);
  // Hacia el oeste bajamos al río y luego sube la ladera occidental.
  const westT = Math.max(0, MAP_MIN_X - 60 - x);
  const riverDrop = -Math.min(westT, 500) * 0.06;
  const westRise = Math.max(0, westT - 700) * 0.22;
  // Hacia el este la montaña se empina (Santo Domingo, Popular…).
  const eastT = Math.max(0, x - MAP_MAX_X - 40);
  const eastRise = eastT * 0.16 + Math.max(0, eastT - 500) * 0.25;
  const ridges = 18 * Math.sin(z * 0.004 + x * 0.002) * Math.min(1, (westT + eastT) / 400);
  return base + riverDrop + westRise + eastRise + ridges;
}
