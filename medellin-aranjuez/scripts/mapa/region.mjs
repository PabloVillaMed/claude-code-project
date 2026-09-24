// Región del mapa del juego: de Moravia (con el Morro y la estación Caribe) a
// Aranjuez (parque e iglesia San Nicolás). Coordenadas WGS84.
export const REGION = { south: 6.2742, north: 6.2882, west: -75.5712, east: -75.5535 };
// Margen que se descarga alrededor (para vías que salen del mapa y el terreno).
export const MARGIN_DEG = 0.0025;
// Origen del sistema local (metros): centro de la región. x = oriente, z = sur.
export const ORIGIN = { lat: (REGION.south + REGION.north) / 2, lon: (REGION.west + REGION.east) / 2 };
const M_PER_DEG_LAT = 110574;
const M_PER_DEG_LON = 111320 * Math.cos((ORIGIN.lat * Math.PI) / 180);
export function project(lat, lon) {
  return [(lon - ORIGIN.lon) * M_PER_DEG_LON, -(lat - ORIGIN.lat) * M_PER_DEG_LAT];
}
export function unproject(x, z) {
  return [ORIGIN.lat - z / M_PER_DEG_LAT, ORIGIN.lon + x / M_PER_DEG_LON];
}
