// Terreno de ladera inspirado en Aranjuez: el barrio sube desde el río (oeste)
// hacia la montaña (este). Todo es analítico para que la física y el render
// coincidan exactamente.

import { valleyHeight } from './geography.js';

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

// Morro de Moravia: una loma verde (jardín comunitario sobre el antiguo
// basurero), al oeste de la Carrera 52, hacia el río.
export const MORAVIA = { x: roadLine(0, GRID.nx) + 35, z: roadLine(3, GRID.nz) + 35, h: 9, r: 18 };

/**
 * Altura del terreno natural en (x, z). Perfil según la elevación real (SRTM):
 * casi plano junto a Carabobo y Moravia (~5 %) y cada vez más empinado hacia
 * Manrique (~10 %), con poca variación norte-sur y ondulaciones suaves.
 */
export function terrainHeight(x, z) {
  const d = x - MAP_MIN_X;
  let h =
    d * 0.055 +
    d * d * 0.00004 +
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
 * manzana [ix0, iz0, ix1, iz1] inclusivos. El Jardín Botánico ocupa 2x2, al
 * este de la Carrera 52 y al lado de la estación Universidad (Calle 73).
 */
export const MERGED_BLOCKS = [{ id: 'botanico', ix0: 1, iz0: 5, ix1: 2, iz1: 6 }];

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
 * Terreno de fondo (solo render): junto al mapa sigue la ladera del barrio y
 * se funde con la geografía del valle (sim/geography.js), la misma que usa el
 * horizonte lejano, para que el río y las laderas empaten sin escalones.
 */
export function backdropHeight(x, z) {
  const ox = Math.max(0, MAP_MIN_X - x, x - MAP_MAX_X);
  const oz = Math.max(0, MAP_MIN_Z - z, z - MAP_MAX_Z);
  const out = Math.hypot(ox, oz);
  if (out <= 0) return terrainHeight(x, z);
  const t = Math.min(1, out / 380);
  const w = t * t * (3 - 2 * t);
  return terrainHeight(x, z) * (1 - w) + valleyHeight(x, z) * w;
}
