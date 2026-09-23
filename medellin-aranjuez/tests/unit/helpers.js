import { generateCity } from '../../src/sim/cityLayout.js';
import { groundHeight } from '../../src/sim/terrain.js';
import { CollisionWorld } from '../../src/sim/collision.js';

let cached = null;
/** Ciudad compartida entre pruebas (la generación es determinista). */
export function city() {
  if (!cached) cached = generateCity(4);
  return cached;
}

export function cityEnv(extra = {}) {
  const c = city();
  return { groundHeight, collision: c.collision, ...extra };
}

/** Entorno plano con paredes a medida para pruebas aisladas. */
export function flatEnv(boxes = [], ground = 0) {
  const collision = new CollisionWorld(8);
  for (const b of boxes) collision.add({ ...b });
  const bounds = { minX: -1e6, maxX: 1e6, minZ: -1e6, maxZ: 1e6 };
  return { groundHeight: typeof ground === 'function' ? ground : () => ground, collision, bounds };
}

export function run(steps, dt, fn) {
  for (let i = 0; i < steps; i++) fn(i);
}
