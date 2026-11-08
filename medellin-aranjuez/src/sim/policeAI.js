// IA de la policía: qué hace cada patrulla y cada agente a pie según lo que
// sabe la radio (WantedSystem: última posición conocida y zona de búsqueda).
// La policía no conoce la posición real del jugador salvo cuando lo ve.
// Puro y determinista (el azar se inyecta): se prueba en police.test.js.

import { dist2D } from './math.js';
import { MAX_UNITS } from './wanted.js';
import { VEHICLE_VARIANTS } from './vehicleVariants.js';

export const POLICE_AI = {
  hear: 12, // a esta distancia te detectan aunque no haya línea de vista
  carSight: 85, // alcance de vista desde una patrulla (con línea de vista)
  footSight: 65, // alcance de vista de un agente a pie
  arrive: 18, // m para dar por alcanzado un punto en carro
  searchGoalTime: 22, // s máximos yendo a un mismo punto de búsqueda
  pursuitCruise: 21, // m/s persiguiendo
  respondCruise: 17, // m/s acudiendo a la última posición conocida
  searchCruise: 11, // m/s barriendo la zona
  footSearchRadius: 40, // radio de búsqueda a pie alrededor del centro de la zona
  footGoalTime: 14, // s máximos por punto de búsqueda a pie
  footSearchTime: 28, // s que buscan a pie antes de volver a la patrulla
  engageDist: 28, // m: a esta distancia, la unidad que te vea te persigue sea cual sea su papel
  cutLead: 4, // s: las que cortan el paso van adonde vas a estar en este tiempo…
  cutMinAhead: 50, // …y al menos estos m por delante de ti
  cutCruise: 19, // m/s yendo a cortar el paso
  cutRethink: 1.2, // s entre recálculos del punto de corte (cada uno es una ruta nueva)
  cutEdge: 0.7, // sin verte, esperan a esta fracción del radio de la zona, hacia donde ibas
};

// Despacho por radio: cuándo sale cada refuerzo y de qué tipo. El tope de
// unidades a la vez por nivel está en wanted.js (MAX_UNITS). Las unidades
// llegan escalonadas y por lados distintos: no todas al mismo punto.
export const DISPATCH = {
  firstDelay: [0, 6, 5, 4.5, 4, 3.5], // s (por nivel) desde que suben las estrellas hasta que sale la primera unidad
  interval: [0, 16, 13, 10, 8, 6.5], // s (por nivel) entre un refuerzo y el siguiente: baja con las estrellas
  retireEvery: 3, // s entre unidades que se retiran cuando bajan las estrellas
  spawnMin: 80, // m mínimos del centro de la zona donde aparecen los refuerzos…
  spawnMax: 170, // …y máximos
  spawnPlayerClear: 70, // m mínimos al jugador (que no aparezcan encima)
  spawnSpread: 120, // m: prefieren nodos lejos de las otras unidades (llegan por lados distintos)
  motoMinLevel: 1, // desde este nivel salen motos
  motoShare: 0.6, // fracción de motos entre las unidades (en el barrio hay más motos que camionetas)
  // Papel de cada unidad por orden de llegada: persiguen ('chase'), cortan el
  // paso más adelante ('cut') o barren la zona de búsqueda ('sweep').
  roles: ['chase', 'cut', 'sweep', 'chase', 'cut'],
};

// Motos de la Policía Metropolitana del Valle de Aburrá (Honda XRE 300 de
// doble propósito): conductor y parrillero. Más rápidas entre el tráfico,
// menos resistentes que la camioneta.
export const POLICE_MOTO = {
  variant: 'policia_moto', // variante de sim/vehicleVariants.js (moto_tt blanca y verde con luces)
  fallbackVariant: 'moto_tt', // la que se usa mientras esa variante no exista
  // (La vida, la velocidad máxima y la aceleración de la moto están en
  // sim/vehicleVariants.js POLICE_MOTO_SPEC.)
  cruiseMul: 1.12, // multiplican la velocidad de crucero de las patrullas
  gunnerMinLevel: 3, // desde estas estrellas el parrillero dispara desde la moto
  gunnerRange: 30, // m máximos para disparar desde la moto
  gunnerMaxAngle: 1.3, // rad: dispara a lo que tiene al frente o al lado, no hacia atrás
  gunnerAim: 0.9, // s apuntando antes del primer tiro (de la moto se dispara mal)
  gunnerSlow: 0.8, // s de más entre tiros que a pie (van saltando en la moto)
  deployOffset: 0.9, // m a cada lado de la moto donde se bajan los agentes
  pillionBack: 0.42, // m detrás del conductor donde va sentado el parrillero
  pillionUp: 0.07, // m más alto que el conductor (el asiento de atrás sube)
};

/** Variante de la moto de la Policía (o la de respaldo si aún no existe). */
export function policeMotoVariant() {
  return VEHICLE_VARIANTS[POLICE_MOTO.variant]?.type === 'moto' ? POLICE_MOTO.variant : POLICE_MOTO.fallbackVariant;
}

/** ¿Un policía en `eye` ve el objetivo? `los(eye, target)` = línea de vista libre. */
export function canSee(eye, target, range, los) {
  const d = Math.hypot(target.x - eye.x, target.z - eye.z);
  if (d < POLICE_AI.hear) return true;
  if (d > range) return false;
  return los(eye, target);
}

/** Nodos viales activos dentro de un círculo. */
export function nodesInCircle(graph, cx, cz, r) {
  return graph.active.filter((n) => dist2D(n.x, n.z, cx, cz) <= r);
}

/**
 * Nodo de búsqueda dentro de la zona, lo más lejos posible de los puntos que
 * ya revisan otras unidades (así se reparten la zona en vez de amontonarse).
 */
export function pickSearchNode(graph, center, radius, taken, rand, avoidId = null) {
  let cands = nodesInCircle(graph, center.x, center.z, radius);
  if (!cands.length) cands = [graph.nearestNode(center.x, center.z)];
  let best = cands[0];
  let bestScore = -Infinity;
  for (const n of cands) {
    let spread = 80;
    for (const t of taken) spread = Math.min(spread, dist2D(n.x, n.z, t.x, t.z));
    const score = spread + rand() * 30 - (n.id === avoidId && cands.length > 1 ? 1000 : 0);
    if (score > bestScore) {
      bestScore = score;
      best = n;
    }
  }
  return best;
}

/** Fija la ruta del agente de conducción hacia `goalId` (si cambió la meta). */
function routeAgent(graph, agent, goalId) {
  if (agent.goal === goalId && agent.path) return;
  agent.goal = goalId;
  agent.path = graph.route(agent.to, goalId);
  agent.next = null; // la próxima decisión sigue la ruta nueva
}

/**
 * Ir a cortar el paso en (x, z): ruta al nodo más cercano, recalculada cada
 * POLICE_AI.cutRethink s. Ya en el punto, la unidad se queda ahí esperando.
 */
function cutTo(ai, car, agent, graph, dt, pointFn, cruise) {
  ai.cutT = (ai.cutT ?? 0) - dt;
  if (ai.mode !== 'cut' || ai.cutT <= 0 || ai.goalNode == null) {
    ai.mode = 'cut';
    ai.cutT = POLICE_AI.cutRethink;
    const p = pointFn();
    ai.goalNode = graph.nearestNode(p.x, p.z).id;
  }
  const gn = graph.node(ai.goalNode);
  routeAgent(graph, agent, gn.id);
  const there = dist2D(car.x, car.z, gn.x, gn.z) < POLICE_AI.arrive * 0.6;
  return { mode: 'cut', target: { x: gn.x, z: gn.z }, cruise: there ? 0 : cruise };
}

/**
 * Plan de una patrulla (carro o moto).
 *  ai: estado propio de la unidad (se inicializa solo)
 *  car: {x, z}; agent: agente del piloto automático {from, to, next, path}
 *  ctx: {graph, wanted, seen, player:{x,z}, playerVel?:{x,z}, taken:[{x,z}],
 *        rand, dt, role?: 'chase'|'cut'|'sweep', moto?: bool}
 * Según el papel: 'chase' persigue y acude a la última posición; 'cut' va a
 * cortarte el paso más adelante; 'sweep' barre la zona sin ir encima de ti.
 * Perdido el rastro (wanted.trailLost) ya nadie corta el paso: las que
 * perseguían terminan de llegar a la última posición y todas barren la zona.
 * Devuelve {mode, target, cruise}: target es el punto final para el
 * piloto automático (tramo final fuera de la ruta). Las motos no embisten:
 * en vez de 'pursue' su modo es 'tail' (siguen de cerca esquivando el tráfico).
 */
export function planPatrol(ai, car, agent, ctx) {
  const { graph, wanted, seen, player, rand, dt } = ctx;
  const role = ctx.role ?? 'chase';
  const mul = ctx.moto ? POLICE_MOTO.cruiseMul : 1;
  ai.timer = (ai.timer ?? 0) - dt;
  if (seen) {
    const dp = dist2D(car.x, car.z, player.x, player.z);
    if (role === 'chase' || dp < POLICE_AI.engageDist) {
      // Persecución: ruta al nodo más cercano al jugador (se recalcula si cambia).
      ai.mode = 'pursue';
      const n = graph.nearestNode(player.x, player.z);
      routeAgent(graph, agent, n.id);
      return { mode: ctx.moto ? 'tail' : 'pursue', target: { x: player.x, z: player.z }, cruise: POLICE_AI.pursuitCruise * mul };
    }
    if (role === 'cut') {
      // Adonde vas a estar en unos segundos; quieto o a pie, al otro lado de ti.
      return cutTo(ai, car, agent, graph, dt, () => {
        const pv = ctx.playerVel ?? { x: 0, z: 0 };
        const sp = Math.hypot(pv.x, pv.z);
        const ux = sp > 3 ? pv.x / sp : (player.x - car.x) / (dp || 1);
        const uz = sp > 3 ? pv.z / sp : (player.z - car.z) / (dp || 1);
        const ahead = Math.max(POLICE_AI.cutMinAhead, sp * POLICE_AI.cutLead);
        return { x: player.x + ux * ahead, z: player.z + uz * ahead };
      }, POLICE_AI.cutCruise * mul);
    }
    // 'sweep': cierran la zona alrededor de donde te ven (abajo).
  }
  const c = wanted.zoneCenter();
  if (!c) {
    ai.mode = 'patrol';
    agent.path = null;
    agent.goal = null;
    return { mode: 'patrol', target: null, cruise: POLICE_AI.searchCruise * mul };
  }
  const lost = !seen && !!wanted.trailLost?.();
  const lv = wanted.lastVel ?? { x: 0, z: 0 };
  if (role === 'cut' && !seen && !lost && Math.hypot(lv.x, lv.z) > 3) {
    // Sin verte: esperan en el borde de la zona, hacia donde ibas.
    return cutTo(ai, car, agent, graph, dt, () => {
      const sp = Math.hypot(lv.x, lv.z);
      const r = wanted.zoneRadius() * POLICE_AI.cutEdge;
      return { x: c.x + (lv.x / sp) * r, z: c.z + (lv.z / sp) * r };
    }, POLICE_AI.respondCruise * mul);
  }
  const d = dist2D(car.x, car.z, c.x, c.z);
  if (role === 'sweep' || (lost && role === 'cut')) {
    // Barren sin pasar por la última posición (allá va la que persigue).
    if (ai.mode !== 'search') {
      ai.mode = 'search';
      ai.goalNode = null;
    }
  } else {
    if (ai.mode !== 'respond' && ai.mode !== 'search') ai.mode = d > POLICE_AI.arrive * 1.5 ? 'respond' : 'search';
    if (ai.mode === 'respond' && d <= POLICE_AI.arrive * 1.5) {
      ai.mode = 'search';
      ai.goalNode = null;
    }
  }
  if (ai.mode === 'respond') {
    routeAgent(graph, agent, graph.nearestNode(c.x, c.z).id);
    return { mode: 'respond', target: c, cruise: POLICE_AI.respondCruise * mul };
  }
  // Barrido: puntos de la zona repartidos entre las unidades.
  let gn = ai.goalNode != null ? graph.node(ai.goalNode) : null;
  const outside = gn && dist2D(gn.x, gn.z, c.x, c.z) > wanted.zoneRadius() + 20;
  if (!gn || outside || ai.timer <= 0 || dist2D(car.x, car.z, gn.x, gn.z) < POLICE_AI.arrive) {
    // Las que barren evitan también el centro: no se amontonan donde estás.
    const taken = role === 'sweep' ? [...(ctx.taken ?? []), c] : ctx.taken ?? [];
    gn = pickSearchNode(graph, c, wanted.zoneRadius(), taken, rand, ai.goalNode);
    ai.goalNode = gn.id;
    ai.timer = POLICE_AI.searchGoalTime;
  }
  routeAgent(graph, agent, gn.id);
  return { mode: 'search', target: { x: gn.x, z: gn.z }, cruise: (seen ? POLICE_AI.respondCruise : POLICE_AI.searchCruise) * mul };
}

// ------------------------------------------------------------- despacho
/**
 * La radio despacha los refuerzos escalonados: el primero a los
 * DISPATCH.firstDelay s de subir las estrellas y los demás cada
 * DISPATCH.interval s, hasta el tope del nivel (MAX_UNITS). Si cae una unidad,
 * la siguiente tarda un intervalo entero. Al bajar las estrellas, sobran
 * unidades y se retiran de a una.
 */
export class PoliceDispatch {
  constructor() {
    this.level = 0;
    this.timer = 0; // s hasta el próximo refuerzo
    this.retireT = 0;
  }

  /**
   * active: unidades que siguen en el caso ({kind: 'car'|'moto'}), en orden
   * de llegada. Devuelve 'car' o 'moto' (sale un refuerzo de ese tipo),
   * 'retire' (sobra una unidad) o null.
   */
  step(dt, level, active) {
    if (level <= 0) {
      this.level = 0;
      this.timer = 0;
      this.retireT = 0;
      return null;
    }
    const max = MAX_UNITS[level] ?? 0;
    // Suben las estrellas: la radio despacha pronto (pero no al instante).
    if (level > this.level) this.timer = Math.min(this.timer > 0 ? this.timer : Infinity, DISPATCH.firstDelay[level] ?? 0);
    this.level = level;
    const n = active.length;
    if (n > max) {
      this.retireT -= dt;
      if (this.retireT > 0) return null;
      this.retireT = DISPATCH.retireEvery;
      return 'retire';
    }
    this.retireT = 0;
    if (n === max) {
      this.timer = Math.max(this.timer, DISPATCH.interval[level] ?? 0);
      return null;
    }
    this.timer -= dt;
    if (this.timer > 0) return null;
    this.timer = DISPATCH.interval[level] ?? 0;
    return this.kindFor(level, active);
  }

  /** No hubo dónde ponerlo: se reintenta en un segundo. */
  failed() {
    this.timer = 1;
  }

  /** Motos y patrullas mezcladas (más motos), desde DISPATCH.motoMinLevel. */
  kindFor(level, active) {
    if (level < DISPATCH.motoMinLevel) return 'car';
    let motos = 0;
    for (const u of active) if (u.kind === 'moto') motos++;
    return motos < Math.round(DISPATCH.motoShare * (active.length + 1)) ? 'moto' : 'car';
  }
}

/**
 * Papeles de las unidades activas (en orden de llegada) según
 * DISPATCH.roles; las motos persiguen primero (se cuelan en el tráfico) y las
 * patrullas cortan el paso y barren.
 */
export function assignRoles(active) {
  const list = active.map((_, i) => DISPATCH.roles[i % DISPATCH.roles.length]);
  let chase = list.filter((r) => r === 'chase').length;
  const others = list.filter((r) => r !== 'chase');
  for (const u of active) u.role = null;
  for (const u of active) {
    if (u.kind === 'moto' && chase > 0) {
      u.role = 'chase';
      chase--;
    }
  }
  for (const u of active) {
    if (u.role) continue;
    if (chase > 0) {
      u.role = 'chase';
      chase--;
    } else u.role = others.shift() ?? 'sweep';
  }
  return active;
}

/**
 * Nodo vial donde aparece un refuerzo: a DISPATCH.spawnMin-spawnMax m del
 * centro de la zona, fuera de la vista inmediata del jugador y, en lo
 * posible, lejos de las otras unidades (así llegan por lados distintos).
 */
export function pickSpawnNode(graph, center, player, others, rand) {
  let best = null;
  let bestScore = -Infinity;
  for (const n of graph.active) {
    const d = dist2D(n.x, n.z, center.x, center.z);
    if (d < DISPATCH.spawnMin || d > DISPATCH.spawnMax || dist2D(n.x, n.z, player.x, player.z) < DISPATCH.spawnPlayerClear) continue;
    let spread = DISPATCH.spawnSpread;
    for (const o of others) spread = Math.min(spread, dist2D(n.x, n.z, o.x, o.z));
    const score = spread + rand() * 40;
    if (score > bestScore) {
      bestScore = score;
      best = n;
    }
  }
  return best;
}

/** Camino a pie: por la red vial si el destino está lejos (las calles están despejadas). */
export function footPath(graph, from, to) {
  if (dist2D(from.x, from.z, to.x, to.z) < 20) return [{ x: to.x, z: to.z }];
  const a = graph.nearestNode(from.x, from.z);
  const b = graph.nearestNode(to.x, to.z);
  const ids = graph.route(a.id, b.id);
  if (!ids) return [{ x: to.x, z: to.z }];
  const pts = ids.map((id) => ({ x: graph.node(id).x, z: graph.node(id).z }));
  // Si el segundo nodo queda más cerca que el primero, no hace falta volver al primero.
  if (pts.length > 1 && dist2D(from.x, from.z, pts[1].x, pts[1].z) < dist2D(pts[0].x, pts[0].z, pts[1].x, pts[1].z)) pts.shift();
  pts.push({ x: to.x, z: to.z });
  return pts;
}

/**
 * Plan de un agente a pie que NO ve al jugador: primero la última posición
 * conocida, después puntos de calle al azar alrededor de ella.
 *  st: estado propio del agente; pos: {x, z}
 *  ctx: {graph, wanted, rand, dt, pedNav?: true si el peatón usa world.nav}
 * Devuelve waypoints nuevos, o null si sigue con los que tiene.
 */
export function planOfficerSearch(st, pos, ctx) {
  const { graph, wanted, rand, dt } = ctx;
  st.timer = (st.timer ?? 0) - dt;
  const c = wanted.zoneCenter();
  if (!c) return null;
  const moved = st.center && dist2D(st.center.x, st.center.z, c.x, c.z) > 8;
  if (st.target && !moved && st.timer > 0 && dist2D(pos.x, pos.z, st.target.x, st.target.z) > 2) return null;
  let target;
  if (!st.center || moved) {
    target = { x: c.x, z: c.z };
  } else {
    const nodes = nodesInCircle(graph, c.x, c.z, POLICE_AI.footSearchRadius);
    const n = nodes.length ? nodes[Math.floor(rand() * nodes.length) % nodes.length] : graph.nearestNode(c.x, c.z);
    // Un punto de la calle cerca del nodo (las calles miden ~10 m).
    target = { x: n.x + (rand() - 0.5) * 8, z: n.z + (rand() - 0.5) * 8 };
  }
  st.center = { x: c.x, z: c.z };
  st.target = target;
  st.timer = POLICE_AI.footGoalTime;
  // Con buscador de rutas a pie (sim/pedNav.js), basta el destino: el agente
  // llega por el grafo peatonal (andenes y cruces), no por el centro de la vía.
  if (ctx.pedNav) return [{ x: target.x, z: target.z }];
  return footPath(graph, pos, target);
}
