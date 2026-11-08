// IA de peatones: caminan por los andenes rodeando la manzana, cruzan la calle
// en las esquinas, se detienen a conversar, van a alguna parte (la tienda, el
// paradero, la casa), huyen ante disparos y atacan si son hostiles (policía,
// pandilla). Con un buscador de rutas (world.nav, sim/pedNav.js) los que van
// a un destino, huyen o persiguen siguen una ruta por el grafo peatonal en vez
// de ir en línea recta contra las paredes; sin él (pruebas viejas) todo es
// como antes.

import { clamp, dampAngle, dist2D, forwardX, forwardZ, yawFromDir } from './math.js';
import { DEST_KINDS, NAV_FAIL, NAV_NONE, NAV_OK, NAV_WAIT, createRoute } from './pedNav.js';

export const PED = { walk: 1.35, run: 5.2, radius: 0.35 };

// ------------------------------------------------------------------ rutas (constantes configurables)
export const ROUTE_REPATH_DIST = 3; // si el destino se movió más que esto (m)...
export const ROUTE_REPATH_MIN = 0.6; // ...y la ruta ya tiene esto (s), se busca otra (persecuciones)
export const ROUTE_RETRY = 1.5; // tras una búsqueda fallida, esto antes de intentar otra (s)
export const ROUTE_REACH = 1.0; // a esta distancia de un punto de la ruta ya va al siguiente (m)
export const ROUTE_REACH_LAST = 0.6; // y del último (m)
export const ROUTE_STUCK_SKIP = 1.2; // sin acercarse al punto que sigue durante esto (s), lo salta
export const ROUTE_STUCK_REPATH = 2; // puntos saltados por trabarse antes de buscar otra ruta
export const MOVE_DIRECT = 2.5; // en 'move', un punto más cerca que esto se camina derecho (m)
export const CHASE_LOS_EVERY = 0.5; // el que persigue revisa cada tanto si ve derecho al jugador (s)
export const CHASE_BLOCKED_MIN = 2; // sin línea libre sigue buscando la vuelta aunque esté a tiro, hasta esto (m)
export const FLEE_SAME_THREAT = 3; // otra amenaza a menos de esto de la que ya huye es la misma (no busca otra ruta)
export const FLEE_SAFE = 40; // al final de una ruta de huida, si la amenaza queda a menos de esto (m)...
export const FLEE_LEGS = 3; // ...busca otro tramo, hasta este número de tramos
export const GOTO_CHANCE = 0.45; // al terminar una pausa, probabilidad de ir a algún lado en vez de seguir deambulando
export const GOTO_MIN = 25; // el destino, a no menos de esto (m)...
export const GOTO_MAX = 140; // ...ni más de esto (m)
export const GOTO_GIVE_UP = 150; // si en este tiempo no llega, se rinde y vuelve a deambular (s)
export const GOTO_MAX_ROUTE = 220; // si la ruta a pie sale más larga que esto (m: mucha vuelta), no va
export const GOTO_ARRIVE = 0.9; // llegó: a esto de la puerta o del paradero (m)
export const GOTO_WEIGHTS = { tienda: 0.5, paradero: 0.15, casa: 0.35 }; // a dónde va la gente
export const GOTO_WAIT = { tienda: [5, 15], paradero: [15, 40], casa: [3, 8] }; // cuánto se queda al llegar (s)


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
 * threats: [{x,z,radius}], player:{x,z}, nav?: PedNav (sim/pedNav.js)}.
 */
export function stepPed(p, dt, world) {
  if (p.mode === 'dead') {
    p.speed = 0;
    return;
  }
  // Reaccionar a amenazas (disparos, explosiones, atropellos). La misma
  // amenaza cuadro tras cuadro no cambia de dónde huye (ni busca otra ruta).
  if (!p.hostile) {
    for (const th of world.threats) {
      if (dist2D(p.x, p.z, th.x, th.z) < th.radius) {
        if (p.mode !== 'flee' || !p.fleeFrom || dist2D(p.fleeFrom.x, p.fleeFrom.z, th.x, th.z) > FLEE_SAME_THREAT) p.fleeFrom = { x: th.x, z: th.z };
        p.mode = 'flee';
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
      // Al llegar a un destino se queda mirando la puerta (o la calle, en el paradero).
      if (p.faceYaw != null) p.yaw = dampAngle(p.yaw, p.faceYaw, 5, dt);
      p.timer -= dt;
      if (p.timer <= 0) {
        p.faceYaw = null;
        if (p.afterDest) {
          p.afterDest = false;
          rejoinSidewalk(p, world);
          break;
        }
        if (world.nav && p.faction === 'civil' && !p.hostile && world.rand() < GOTO_CHANCE && startGoto(p, world)) break;
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
    case 'goto':
      stepGoto(p, dt, world);
      break;
    case 'flee': {
      // Con buscador de rutas: por la ruta que más lo aleja; si no hay (o
      // espera su turno de búsqueda), derecho, alejándose, como siempre.
      if (!(world.nav && fleeRoute(p, dt, world))) {
        const dx = p.x - p.fleeFrom.x;
        const dz = p.z - p.fleeFrom.z;
        const d = Math.hypot(dx, dz) || 1;
        const tx = p.x + (dx / d) * 5;
        const tz = p.z + (dz / d) * 5;
        goToward(p, tx, tz, PED.run, dt);
      }
      p.timer -= dt;
      if (p.timer <= 0) rejoinSidewalk(p, world);
      break;
    }
    case 'move': {
      // Recorrer waypoints (agentes buscando a pie, de vuelta a la patrulla).
      // Si no avanza, salta el punto.
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
        if (p.route) p.route.status = NAV_NONE; // el siguiente punto, con ruta nueva
        break;
      }
      const speed = p.moveSpeed ?? PED.run * 0.6;
      // Con buscador: por el grafo peatonal hasta el punto (la ruta ya dobla
      // las esquinas; si el punto se ve derecho, la ruta es un solo tramo).
      if (world.nav && d > MOVE_DIRECT && navTo(p, wp.x, wp.z, speed, dt, world, true, 'move')) {
        p.stuck = 0;
        break;
      }
      // Trabado de frente contra algo delgado (un árbol o un poste del andén):
      // rodearlo de lado en vez de empujar derecho.
      if (p.stuck > 0.25) {
        const k = p.stuck < 0.85 ? 1 : -1;
        const ux = (wp.x - p.x) / d;
        const uz = (wp.z - p.z) / d;
        goToward(p, p.x + (ux - uz * k * 1.5) * 2, p.z + (uz + ux * k * 1.5) * 2, speed, dt);
      } else goToward(p, wp.x, wp.z, speed, dt);
      break;
    }
    case 'attack': {
      const pl = world.player;
      const d = dist2D(p.x, p.z, pl.x, pl.z);
      const desired = p.attackRange ?? 14;
      // ¿Lo ve derecho? (cada CHASE_LOS_EVERY s). Si una manzana se interpone,
      // le da la vuelta por la ruta en vez de quedarse contra la pared.
      let blocked = false;
      if (world.nav) {
        p.losT = (p.losT ?? 0) - dt;
        if (p.losT <= 0) {
          p.losT = CHASE_LOS_EVERY;
          p.losClear = world.nav.clear(p.x, p.z, pl.x, pl.z);
        }
        blocked = !p.losClear;
      }
      if (d > desired || (blocked && d > CHASE_BLOCKED_MIN)) {
        if (!(blocked && navTo(p, pl.x, pl.z, PED.run * 0.85, dt, world, true, 'attack'))) goToward(p, pl.x, pl.z, PED.run * 0.85, dt);
      } else {
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

// ------------------------------------------------------------------ rutas
/**
 * Sigue la ruta `r` (sim/pedNav.js) a `speed`. Devuelve false si ya no le
 * queda punto. Si no se acerca al que sigue durante ROUTE_STUCK_SKIP s (un
 * poste, otro peatón), primero lo rodea de lado y después lo salta; trabado
 * ROUTE_STUCK_REPATH veces, deja la ruta para que se busque otra.
 */
export function followRoute(p, r, speed, dt) {
  while (r.i < r.n) {
    const tx = r.xs[r.i];
    const tz = r.zs[r.i];
    const d = Math.hypot(tx - p.x, tz - p.z);
    if (d < (r.i === r.n - 1 ? ROUTE_REACH_LAST : ROUTE_REACH)) {
      r.i++;
      r.stuck = 0;
      r.lastD = Infinity;
      continue;
    }
    r.stuck = d < r.lastD - 0.01 ? 0 : r.stuck + dt;
    r.lastD = d;
    if (r.stuck > ROUTE_STUCK_SKIP) {
      r.i++;
      r.stuck = 0;
      r.lastD = Infinity;
      if (++r.skips >= ROUTE_STUCK_REPATH) {
        r.status = NAV_NONE;
        r.i = r.n;
        return false;
      }
      continue;
    }
    if (r.stuck > 0.25) {
      const k = r.stuck < 0.7 ? 1 : -1;
      const ux = (tx - p.x) / d;
      const uz = (tz - p.z) / d;
      goToward(p, p.x + (ux - uz * k * 1.5) * 2, p.z + (uz + ux * k * 1.5) * 2, speed, dt);
    } else goToward(p, tx, tz, speed, dt);
    return true;
  }
  return false;
}

/**
 * Ir hacia (tx, tz) por el grafo peatonal: pide la ruta si no la tiene (o si
 * el destino se movió) y la sigue. `purpose` separa los usos de la ruta del
 * peatón (perseguir, ir a un punto, ir a un destino). Devuelve false si este
 * cuadro no hay ruta que seguir (esperando presupuesto, sin camino o ya al
 * final): el que llama camina derecho.
 */
function navTo(p, tx, tz, speed, dt, world, cut, purpose) {
  const r = (p.route ??= createRoute());
  if (r.purpose !== purpose) {
    r.purpose = purpose;
    r.status = NAV_NONE;
  }
  r.t += dt;
  const moved = Math.hypot(r.gx - tx, r.gz - tz) > ROUTE_REPATH_DIST;
  if (r.status === NAV_OK && moved && r.t > ROUTE_REPATH_MIN) r.status = NAV_NONE;
  if (r.status === NAV_FAIL) {
    if (r.t < ROUTE_RETRY && !moved) return false;
    r.status = NAV_NONE;
  }
  if (r.status !== NAV_OK) {
    const st = world.nav.findPath(p.x, p.z, tx, tz, r, cut);
    r.t = 0;
    r.d0 = Math.hypot(tx - p.x, tz - p.z);
    if (st !== NAV_OK) return false;
  }
  if (followRoute(p, r, speed, dt)) return true;
  // Ruta cortada (larga, o el destino no se alcanza por el grafo): el resto
  // en otra búsqueda, salvo que ya no acerque nada.
  if (r.partial && r.status === NAV_OK) {
    r.status = r.d0 - Math.hypot(tx - p.x, tz - p.z) > 2 ? NAV_NONE : NAV_FAIL;
    r.t = 0;
  }
  return false;
}

/** Huida por el grafo (true si este cuadro la maneja la ruta de huida). */
function fleeRoute(p, dt, world) {
  const r = (p.route ??= createRoute());
  if (r.purpose !== 'flee' || p.fleeFor !== p.fleeFrom) {
    r.purpose = 'flee';
    r.status = NAV_NONE;
    p.fleeFor = p.fleeFrom;
    p.fleeLegs = 0;
  }
  if (r.status === NAV_FAIL) return false;
  if (r.status !== NAV_OK && world.nav.flee(p.x, p.z, p.fleeFrom.x, p.fleeFrom.z, r) !== NAV_OK) return false;
  if (followRoute(p, r, PED.run, dt)) return true;
  if (r.status !== NAV_OK) return false; // se trabó: otra búsqueda en el siguiente cuadro
  // Al final del tramo: si la amenaza sigue cerca, otro; si no, ya se calmó.
  if (dist2D(p.x, p.z, p.fleeFrom.x, p.fleeFrom.z) < FLEE_SAFE && ++p.fleeLegs < FLEE_LEGS) {
    r.status = NAV_NONE;
    return false;
  }
  p.timer = Math.min(p.timer, 0.5);
  p.speed = 0;
  return true;
}

/** Empezar a ir a un destino (tienda, paradero o casa) a una distancia razonable. */
function startGoto(p, world) {
  const k = world.nav.pickDestination(p.x, p.z, world.rand, GOTO_MIN, GOTO_MAX, GOTO_WEIGHTS);
  if (k < 0) return false;
  p.mode = 'goto';
  p.destIdx = k;
  p.timer = GOTO_GIVE_UP;
  if (p.route) p.route.status = NAV_NONE;
  return true;
}

/** Caminando a un destino por la ruta (sin cortar la calle por cualquier parte). */
function stepGoto(p, dt, world) {
  const D = world.nav?.graph.dest;
  if (!D || p.destIdx == null || p.destIdx >= D.n) {
    rejoinSidewalk(p, world);
    return;
  }
  const k = p.destIdx;
  const tx = D.x[k];
  const tz = D.z[k];
  const d = Math.hypot(tx - p.x, tz - p.z);
  p.timer -= dt;
  if (d < GOTO_ARRIVE || p.timer <= 0) {
    // Llegó (o se cansó de intentar): se queda un rato mirando la puerta.
    const [a, b] = GOTO_WAIT[DEST_KINDS[D.kind[k]]] ?? [3, 8];
    p.mode = 'idle';
    p.afterDest = true;
    p.faceYaw = d < GOTO_ARRIVE * 2 ? D.yaw[k] : null;
    p.timer = a + world.rand() * (b - a);
    p.speed = 0;
    p.destIdx = null;
    return;
  }
  if (navTo(p, tx, tz, p.walkSpeed, dt, world, false, 'goto')) {
    // Recién buscada y con demasiada vuelta (la puerta queda al otro lado de una
    // manzana enorme): mejor sigue deambulando.
    if (p.route.t === 0 && p.route.len > GOTO_MAX_ROUTE) rejoinSidewalk(p, world);
    return;
  }
  const st = p.route?.status;
  if (st === NAV_WAIT) p.speed = 0; // espera su turno de búsqueda
  else if (st === NAV_FAIL) rejoinSidewalk(p, world); // no hay cómo llegar: a deambular
  else goToward(p, tx, tz, p.walkSpeed, dt); // el último pedacito
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
