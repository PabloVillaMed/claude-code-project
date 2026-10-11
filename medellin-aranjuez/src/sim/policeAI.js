// IA de la policía: qué hace cada patrulla y cada agente a pie según lo que
// sabe la radio (WantedSystem: última posición conocida y zona de búsqueda).
// La policía no conoce la posición real del jugador salvo cuando lo ve.
// Puro y determinista (el azar se inyecta): se prueba en police.test.js.

import { dist2D } from './math.js';

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
};

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
 * Plan de una patrulla en carro.
 *  ai: estado propio de la unidad (se inicializa solo)
 *  car: {x, z}; agent: agente del piloto automático {from, to, next, path}
 *  ctx: {graph, wanted, seen, player:{x,z}, taken:[{x,z}], rand, dt}
 * Devuelve {mode, target, cruise}: target es el punto final para el
 * piloto automático (tramo final fuera de la ruta).
 */
export function planPatrol(ai, car, agent, ctx) {
  const { graph, wanted, seen, player, rand, dt } = ctx;
  ai.timer = (ai.timer ?? 0) - dt;
  if (seen) {
    // Persecución: ruta al nodo más cercano al jugador (se recalcula si cambia).
    ai.mode = 'pursue';
    const n = graph.nearestNode(player.x, player.z);
    routeAgent(graph, agent, n.id);
    return { mode: 'pursue', target: { x: player.x, z: player.z }, cruise: POLICE_AI.pursuitCruise };
  }
  const c = wanted.zoneCenter();
  if (!c) {
    ai.mode = 'patrol';
    agent.path = null;
    agent.goal = null;
    return { mode: 'patrol', target: null, cruise: POLICE_AI.searchCruise };
  }
  const d = dist2D(car.x, car.z, c.x, c.z);
  if (ai.mode !== 'respond' && ai.mode !== 'search') ai.mode = d > POLICE_AI.arrive * 1.5 ? 'respond' : 'search';
  if (ai.mode === 'respond' && d <= POLICE_AI.arrive * 1.5) {
    ai.mode = 'search';
    ai.goalNode = null;
  }
  if (ai.mode === 'respond') {
    routeAgent(graph, agent, graph.nearestNode(c.x, c.z).id);
    return { mode: 'respond', target: c, cruise: POLICE_AI.respondCruise };
  }
  // Barrido: puntos de la zona repartidos entre las unidades.
  let gn = ai.goalNode != null ? graph.node(ai.goalNode) : null;
  const outside = gn && dist2D(gn.x, gn.z, c.x, c.z) > wanted.zoneRadius() + 20;
  if (!gn || outside || ai.timer <= 0 || dist2D(car.x, car.z, gn.x, gn.z) < POLICE_AI.arrive) {
    gn = pickSearchNode(graph, c, wanted.zoneRadius(), ctx.taken ?? [], rand, ai.goalNode);
    ai.goalNode = gn.id;
    ai.timer = POLICE_AI.searchGoalTime;
  }
  routeAgent(graph, agent, gn.id);
  return { mode: 'search', target: { x: gn.x, z: gn.z }, cruise: POLICE_AI.searchCruise };
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
 *  ctx: {graph, wanted, rand, dt}
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
  return footPath(graph, pos, target);
}
