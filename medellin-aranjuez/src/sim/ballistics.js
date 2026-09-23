// Trazado de disparos contra la escena: edificios, suelo, personajes (cuerpo
// y cabeza) y vehículos. Puro y testeable.

import { rayVsObb3D, rayVsSphere, rayVsVerticalCapsule } from './collision.js';

// Cápsula del cuerpo: los extremos esféricos llegan de 0,05 m a 1,5 m (hombros).
export const BODY = { radius: 0.3, bottom: 0.35, top: 1.2, headY: 1.63, headR: 0.15 };

/**
 * @param o origen {x,y,z}; d dirección normalizada {x,y,z}
 * @param scene {collision, groundHeight, characters:[{ref,x,y,z,dead?}],
 *   vehicles:[{ref,obb,y,height}], ignore:Set}
 * @returns {t, x,y,z, kind:'building'|'ground'|'character'|'vehicle'|null, ref, headshot, normal}
 */
export function traceShot(o, d, maxDist, scene) {
  let best = { t: maxDist, kind: null, ref: null, headshot: false, normal: null };
  const ignore = scene.ignore ?? new Set();

  const b = scene.collision.raycast(o.x, o.y, o.z, d.x, d.y, d.z, maxDist);
  if (b && b.t < best.t) best = { t: b.t, kind: 'building', ref: b.box, headshot: false, normal: { x: b.nx, y: b.ny, z: b.nz } };

  for (const c of scene.characters ?? []) {
    if (ignore.has(c.ref)) continue;
    // Descarte rápido por distancia al rayo.
    const lx = c.x - o.x;
    const lz = c.z - o.z;
    const along = lx * d.x + lz * d.z;
    if (along < -1 || along > best.t + 1) continue;
    const lateral = Math.abs(lx * d.z - lz * d.x) / (Math.hypot(d.x, d.z) || 1);
    if (lateral > 1.2) continue;
    if (c.dead) {
      // Cuerpo en el piso: cápsula baja.
      const t = rayVsVerticalCapsule(o.x, o.y, o.z, d.x, d.y, d.z, c.x, c.z, c.y, c.y + 0.35, 0.45, best.t);
      if (t !== null && t < best.t) best = { t, kind: 'character', ref: c.ref, headshot: false, normal: { x: -d.x, y: -d.y, z: -d.z } };
      continue;
    }
    const th = rayVsSphere(o.x, o.y, o.z, d.x, d.y, d.z, c.x, c.y + BODY.headY, c.z, BODY.headR, best.t);
    if (th !== null && th < best.t) best = { t: th, kind: 'character', ref: c.ref, headshot: true, normal: { x: -d.x, y: -d.y, z: -d.z } };
    const tb = rayVsVerticalCapsule(o.x, o.y, o.z, d.x, d.y, d.z, c.x, c.z, c.y + BODY.bottom, c.y + BODY.top, BODY.radius, best.t);
    if (tb !== null && tb < best.t) best = { t: tb, kind: 'character', ref: c.ref, headshot: false, normal: { x: -d.x, y: -d.y, z: -d.z } };
  }

  for (const v of scene.vehicles ?? []) {
    if (ignore.has(v.ref)) continue;
    const t = rayVsObb3D(o.x, o.y, o.z, d.x, d.y, d.z, v.obb, v.y + 0.25, v.y + v.height, best.t);
    if (t !== null && t < best.t) best = { t, kind: 'vehicle', ref: v.ref, headshot: false, normal: { x: -d.x, y: -d.y, z: -d.z } };
  }

  // Suelo: marcha a pasos y refinamiento por bisección.
  if (scene.groundHeight) {
    const step = 0.75;
    let prevT = 0;
    for (let t = step; t <= best.t; t += step) {
      const y = o.y + d.y * t;
      const g = scene.groundHeight(o.x + d.x * t, o.z + d.z * t);
      if (y <= g) {
        let lo = prevT;
        let hi = t;
        for (let i = 0; i < 12; i++) {
          const m = (lo + hi) / 2;
          if (o.y + d.y * m <= scene.groundHeight(o.x + d.x * m, o.z + d.z * m)) hi = m;
          else lo = m;
        }
        best = { t: hi, kind: 'ground', ref: null, headshot: false, normal: { x: 0, y: 1, z: 0 } };
        break;
      }
      prevT = t;
    }
  }

  best.x = o.x + d.x * best.t;
  best.y = o.y + d.y * best.t;
  best.z = o.z + d.z * best.t;
  return best;
}

/** Aplica desviaciones (yaw/pitch) a una dirección normalizada. */
export function deviate(d, dYaw, dPitch) {
  // Base ortonormal alrededor de d.
  const up = Math.abs(d.y) > 0.99 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 };
  let rx = d.y * up.z - d.z * up.y;
  let ry = d.z * up.x - d.x * up.z;
  let rz = d.x * up.y - d.y * up.x;
  const rl = Math.hypot(rx, ry, rz);
  rx /= rl;
  ry /= rl;
  rz /= rl;
  const ux = ry * d.z - rz * d.y;
  const uy = rz * d.x - rx * d.z;
  const uz = rx * d.y - ry * d.x;
  const x = d.x + rx * Math.tan(dYaw) + ux * Math.tan(dPitch);
  const y = d.y + ry * Math.tan(dYaw) + uy * Math.tan(dPitch);
  const z = d.z + rz * Math.tan(dYaw) + uz * Math.tan(dPitch);
  const l = Math.hypot(x, y, z);
  return { x: x / l, y: y / l, z: z / l };
}
