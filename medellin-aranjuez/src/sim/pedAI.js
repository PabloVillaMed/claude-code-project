// IA de peatones: caminan por los andenes rodeando la manzana, cruzan la calle
// en las esquinas, se detienen a conversar, huyen ante disparos y atacan si
// son hostiles (policía, pandilla).

import { clamp, dampAngle, dist2D, forwardX, forwardZ, yawFromDir } from './math.js';

export const PED = { walk: 1.35, run: 5.2, radius: 0.35 };

// El andén de cada manzana es un polígono (`block.ring`, línea por donde se
// camina); los peatones van de vértice en vértice y cruzan la calle en los
// vértices que tienen cruce (`block.cross`: índice → [{block, i}]).

/** Vértices del anillo peatonal de una manzana. */
export function ringCorners(block) {
  return block.ring.map(([x, z]) => ({ x, z }));
}

export function createPed(block, rng, opts = {}) {
  const r = block.ring;
  const n = r.length;
  const c = rng.int(0, n - 1);
  const [ax, az] = r[c];
  const [bx, bz] = r[(c + 1) % n];
  const t = rng.next();
  return {
    x: ax + (bx - ax) * t,
    z: az + (bz - az) * t,
    yaw: 0,
    speed: 0,
    block,
    corner: (c + 1) % n,
    dir: rng.chance(0.5) ? 1 : -1,
    mode: 'walk',
    timer: rng.range(4, 20),
    target: null,
    health: opts.health ?? 100,
    hostile: opts.hostile ?? false,
    faction: opts.faction ?? 'civil',
    fleeFrom: null,
    walkSpeed: PED.walk * rng.range(0.85, 1.15),
    ...opts,
  };
}

function goToward(p, tx, tz, speed, dt) {
  const dx = tx - p.x;
  const dz = tz - p.z;
  const d = Math.hypot(dx, dz);
  if (d < 1e-3) return 0;
  const step = Math.min(d, speed * dt);
  p.x += (dx / d) * step;
  p.z += (dz / d) * step;
  p.yaw = dampAngle(p.yaw, yawFromDir(dx, dz), 8, dt);
  p.speed = speed;
  return d;
}

/**
 * Avanza un peatón. `world` = {blocks, blockAt(x,z), collision, rand,
 * threats: [{x,z,radius}], player:{x,z}}.
 */
export function stepPed(p, dt, world) {
  if (p.mode === 'dead') {
    p.speed = 0;
    return;
  }
  // Reaccionar a amenazas (disparos, explosiones, atropellos).
  if (!p.hostile) {
    for (const th of world.threats) {
      if (dist2D(p.x, p.z, th.x, th.z) < th.radius) {
        p.mode = 'flee';
        p.fleeFrom = { x: th.x, z: th.z };
        p.timer = 8 + world.rand() * 6;
        break;
      }
    }
  }

  switch (p.mode) {
    case 'walk': {
      const ring = p.block.ring;
      const [cx, cz] = ring[p.corner % ring.length];
      const d = goToward(p, cx, cz, p.walkSpeed, dt);
      if (d < 0.3) {
        // En la esquina: seguir o cruzar la calle hacia la manzana vecina.
        if (p.block.cross?.has(p.corner) && world.rand() < 0.35) {
          const cross = crossingTarget(p, world);
          if (cross) {
            p.mode = 'cross';
            p.target = cross;
            break;
          }
        }
        p.corner = (p.corner + p.dir + ring.length) % ring.length;
      }
      p.timer -= dt;
      if (p.timer <= 0) {
        p.mode = 'idle';
        p.timer = 2 + world.rand() * 5;
      }
      break;
    }
    case 'idle':
      p.speed = 0;
      p.timer -= dt;
      if (p.timer <= 0) {
        p.mode = 'walk';
        p.timer = 8 + world.rand() * 20;
      }
      break;
    case 'cross': {
      const d = goToward(p, p.target.x, p.target.z, p.walkSpeed * 1.2, dt);
      if (d < 0.3) {
        p.block = p.target.block;
        p.corner = p.target.corner;
        p.mode = 'walk';
        p.target = null;
      }
      break;
    }
    case 'flee': {
      const dx = p.x - p.fleeFrom.x;
      const dz = p.z - p.fleeFrom.z;
      const d = Math.hypot(dx, dz) || 1;
      const tx = p.x + (dx / d) * 5;
      const tz = p.z + (dz / d) * 5;
      goToward(p, tx, tz, PED.run, dt);
      p.timer -= dt;
      if (p.timer <= 0) rejoinSidewalk(p, world);
      break;
    }
    case 'move': {
      // Recorrer waypoints (agentes buscando a pie). Si no avanza, salta el punto.
      const wp = p.waypoints?.[0];
      if (!wp) {
        p.speed = 0;
        p.arrived = true;
        break;
      }
      // Distancia medida tras la colisión del cuadro anterior: si no baja, está trabado.
      const d = Math.hypot(wp.x - p.x, wp.z - p.z);
      p.stuck = d < (p.lastWpD ?? Infinity) - 0.01 ? 0 : (p.stuck ?? 0) + dt;
      p.lastWpD = d;
      if (d < 1.2 || p.stuck > 1.5) {
        p.waypoints.shift();
        p.stuck = 0;
        p.lastWpD = Infinity;
        break;
      }
      goToward(p, wp.x, wp.z, p.moveSpeed ?? PED.run * 0.6, dt);
      break;
    }
    case 'attack': {
      const pl = world.player;
      const d = dist2D(p.x, p.z, pl.x, pl.z);
      const desired = p.attackRange ?? 14;
      if (d > desired) goToward(p, pl.x, pl.z, PED.run * 0.85, dt);
      else {
        p.speed = 0;
        p.yaw = dampAngle(p.yaw, yawFromDir(pl.x - p.x, pl.z - p.z), 10, dt);
      }
      break;
    }
    default:
      break;
  }

  // Colisión con edificios.
  const res = world.collision.resolveCircle(p.x, p.z, PED.radius);
  p.x = res.x;
  p.z = res.z;
}

/** Tras huir, volver a la manzana más cercana y seguir caminando. */
export function rejoinSidewalk(p, world) {
  let b = world.blockAt(p.x, p.z);
  if (!b?.ring) b = nearestBlock(world.blocks, p.x, p.z);
  p.block = b;
  let best = 0;
  let bd = Infinity;
  b.ring.forEach(([x, z], i) => {
    const d = dist2D(x, z, p.x, p.z);
    if (d < bd) {
      bd = d;
      best = i;
    }
  });
  p.corner = best;
  p.mode = 'walk';
  p.timer = 10 + world.rand() * 10;
}

export function nearestBlock(blocks, x, z) {
  let best = null;
  let bd = Infinity;
  for (const b of blocks) {
    if (!b.ring) continue;
    if (x < b.minX - bd || x > b.maxX + bd || z < b.minZ - bd || z > b.maxZ + bd) continue;
    for (const [vx, vz] of b.ring) {
      const d = dist2D(vx, vz, x, z);
      if (d < bd) {
        bd = d;
        best = b;
      }
    }
  }
  return best ?? blocks[0];
}

/** Cruce desde la esquina actual hacia la manzana vecina al otro lado de la calle. */
function crossingTarget(p, world) {
  const opts = p.block.cross?.get(p.corner);
  if (!opts?.length) return null;
  const o = opts[Math.floor(world.rand() * opts.length)];
  const b = world.blocks[o.block];
  if (!b?.ring) return null;
  const [x, z] = b.ring[o.i];
  return { x, z, block: b, corner: o.i };
}

/** Dirección en la que mira el peatón (para disparos de la IA). */
export function pedForward(p) {
  return { x: forwardX(p.yaw), z: forwardZ(p.yaw) };
}

export function clampHealth(h) {
  return clamp(h, 0, 100);
}
