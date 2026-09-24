// Registro central de recursos externos. Cada área (personajes, vehículos,
// utilería, texturas/cielo) añade aquí su manifiesto; Game.init los carga.
// Todo lo de public/ debe tener su licencia anotada en ASSETS-CREDITS.md.

import { assets } from './assets.js';

// Se completa en los módulos de cada área.
export const MANIFEST = [];

export function registerAssets(entries) {
  MANIFEST.push(...entries);
  assets.register(entries);
}
