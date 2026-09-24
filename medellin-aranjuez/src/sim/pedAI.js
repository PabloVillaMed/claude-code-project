// IA de peatones: caminan por los andenes rodeando la manzana, cruzan la calle
// en las esquinas, se detienen a conversar, huyen ante disparos y atacan si
// son hostiles (policía, pandilla).

import { clamp, dampAngle, dist2D, forwardX, forwardZ, yawFromDir } from './math.js';
import { GRID } from './terrain.js';

export const PED = { walk: 1.35, run: 5.2, radius: 0.35 };

/** Esquinas del anillo peatonal de una manzana en sentido horario. */
export function ringCorners(block) {
  const r = block.ring;
  return [
    { x: r.minX, z: r.minZ },
    { x: r.maxX, z: r.minZ },
    { x: r.maxX, z: r.maxZ },
    { x: r.minX, z: r.maxZ },
  ];
}

export function createPed(block, rng, opts = {}) {
  const corners = ringCorners(block);
  const c = rng.int(0, 3);
  const a = corners[c];
  const b = corners[(c + 1) % 4];
  const t = rng.next();
  return {
    x: a.x + (b.x - a.x) * t,
    z: a.z + (b.z - a.z) * t,
    yaw: 0,
    speed: 0,
    block,
    corner: (c + 1) % 4,
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
      const corners = ringCorners(p.block);
      const c = corners[p.corner];
      const d = goToward(p, c.x, c.z, p.walkSpeed, dt);
      if (d < 0.3) {
        // En la esquina: seguir o cruzar la calle hacia la manzana vecina.
        if (world.rand() < 0.3) {
          const cross = crossingTarget(p, world);
          if (cross) {
            p.mode = 'cross';
            p.target = cross;
            break;
          }
        }
        p.corner = (p.corner + p.dir + 4) % 4;
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
  const b = world.blockAt(p.x, p.z) ?? nearestBlock(world.blocks, p.x, p.z);
  p.block = b;
  const corners = ringCorners(b);
  let best = 0;
  let bd = Infinity;
  corners.forEach((c, i) => {
    const d = dist2D(c.x, c.z, p.x, p.z);
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
  let best = blocks[0];
  let bd = Infinity;
  for (const b of blocks) {
    const d = dist2D(b.cx, b.cz, x, z);
    if (d < bd) {
      bd = d;
      best = b;
    }
  }
  return best;
}

/** Busca la esquina de la manzana vecina al otro lado de la calle. */
function crossingTarget(p, world) {
  const corners = ringCorners(p.block);
  const c = corners[p.corner];
  const across = GRID.asphaltHalf * 2 + GRID.sidewalk + 0.2;
  const options = [];
  for (const [dx, dz] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ]) {
    const tx = c.x + dx * across;
    const tz = c.z + dz * across;
    const b = world.blockAt(tx, tz);
    if (!b || b === p.block) continue;
    const bc = ringCorners(b);
    let ci = 0;
    let bd = Infinity;
    bc.forEach((k, i) => {
      const d = dist2D(k.x, k.z, tx, tz);
      if (d < bd) {
        bd = d;
        ci = i;
      }
    });
    if (bd < 2) options.push({ x: bc[ci].x, z: bc[ci].z, block: b, corner: ci });
  }
  if (!options.length) return null;
  return options[Math.floor(world.rand() * options.length)];
}

/** Dirección en la que mira el peatón (para disparos de la IA). */
export function pedForward(p) {
  return { x: forwardX(p.yaw), z: forwardZ(p.yaw) };
}

export function clampHealth(h) {
  return clamp(h, 0, 100);
}
