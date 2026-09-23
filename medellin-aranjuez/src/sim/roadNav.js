// Navegación por la red vial: carriles (se conduce por la derecha, como en
// Colombia), elección de giros, búsqueda de rutas y piloto automático para
// el tráfico y la policía.

import { GRID } from './terrain.js';
import { clamp, dist2D, forwardX, forwardZ, wrapAngle, yawFromDir } from './math.js';

export class RoadGraph {
  constructor(city) {
    this.nodes = city.nodes;
    this.edges = city.edges;
    this.active = city.nodes.filter((n) => n.active);
  }

  node(id) {
    return this.nodes[id];
  }

  nearestNode(x, z) {
    let best = null;
    let bd = Infinity;
    for (const n of this.active) {
      const d = (n.x - x) ** 2 + (n.z - z) ** 2;
      if (d < bd) {
        bd = d;
        best = n;
      }
    }
    return best;
  }

  /** Arista más cercana y proyección del punto sobre ella. */
  nearestEdge(x, z) {
    let best = null;
    for (const e of this.edges) {
      const a = this.nodes[e.a];
      const b = this.nodes[e.b];
      const t = clamp(((x - a.x) * (b.x - a.x) + (z - a.z) * (b.z - a.z)) / (e.length * e.length), 0, 1);
      const px = a.x + (b.x - a.x) * t;
      const pz = a.z + (b.z - a.z) * t;
      const d = dist2D(x, z, px, pz);
      if (!best || d < best.dist) best = { edge: e, t, dist: d, x: px, z: pz };
    }
    return best;
  }

  /** Siguiente nodo al llegar a `at` viniendo de `from`, evitando la vuelta en U. */
  pickNext(from, at, rand = Math.random) {
    const links = this.nodes[at].links.filter((l) => l.node !== from);
    if (links.length === 0) return from;
    return links[Math.floor(rand() * links.length)].node;
  }

  /** Vecino de `at` (sin volver a `from` salvo sin salida) que más acerca a (tx,tz). */
  pickToward(from, at, tx, tz) {
    const links = this.nodes[at].links;
    let best = null;
    let bd = Infinity;
    for (const l of links) {
      if (l.node === from && links.length > 1) continue;
      const n = this.nodes[l.node];
      const d = dist2D(n.x, n.z, tx, tz);
      if (d < bd) {
        bd = d;
        best = l.node;
      }
    }
    return best ?? from;
  }

  /** Ruta más corta (Dijkstra) entre nodos; devuelve lista de ids. */
  route(startId, goalId) {
    const dist = new Map([[startId, 0]]);
    const prev = new Map();
    const open = new Set([startId]);
    while (open.size) {
      let cur = null;
      let cd = Infinity;
      for (const id of open) {
        const d = dist.get(id);
        if (d < cd) {
          cd = d;
          cur = id;
        }
      }
      open.delete(cur);
      if (cur === goalId) break;
      for (const l of this.nodes[cur].links) {
        const nd = cd + this.edges[l.edge].length;
        if (nd < (dist.get(l.node) ?? Infinity)) {
          dist.set(l.node, nd);
          prev.set(l.node, cur);
          open.add(l.node);
        }
      }
    }
    if (!dist.has(goalId)) return null;
    const path = [goalId];
    while (path[0] !== startId) path.unshift(prev.get(path[0]));
    return path;
  }

  /** ¿Todos los nodos activos están conectados? */
  isConnected() {
    if (!this.active.length) return false;
    const seen = new Set([this.active[0].id]);
    const stack = [this.active[0].id];
    while (stack.length) {
      const id = stack.pop();
      for (const l of this.nodes[id].links) {
        if (!seen.has(l.node)) {
          seen.add(l.node);
          stack.push(l.node);
        }
      }
    }
    return seen.size === this.active.length;
  }
}

/** Punto sobre el carril derecho de la arista from->to a una fracción t. */
export function lanePoint(graph, fromId, toId, t) {
  const a = graph.node(fromId);
  const b = graph.node(toId);
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const len = Math.hypot(dx, dz) || 1;
  // Derecha del sentido de marcha: (-dz, dx) normalizado… con yaw: right = (cos, -sin).
  const yaw = yawFromDir(dx, dz);
  const rx = Math.cos(yaw);
  const rz = -Math.sin(yaw);
  return {
    x: a.x + dx * t + rx * GRID.laneOffset,
    z: a.z + dz * t + rz * GRID.laneOffset,
    yaw,
    len,
  };
}

/**
 * Piloto automático. `agent` = {from, to, next}. Calcula la entrada de
 * conducción para seguir el carril derecho y girar en las intersecciones.
 * `opts` = {cruise, blockedAhead (distancia a obstáculo o Infinity), rand, target?}
 */
export function autopilot(graph, agent, v, opts) {
  const a = graph.node(agent.from);
  const b = graph.node(agent.to);
  const ex = b.x - a.x;
  const ez = b.z - a.z;
  const elen = Math.hypot(ex, ez) || 1;
  // Progreso a lo largo de la arista.
  let t = ((v.x - a.x) * ex + (v.z - a.z) * ez) / (elen * elen);
  const distToEnd = (1 - t) * elen;

  // Al acercarse al final, elegir el siguiente tramo.
  if (agent.next === undefined || agent.next === null) {
    agent.next = opts.target ? graph.pickToward(agent.from, agent.to, opts.target.x, opts.target.z) : graph.pickNext(agent.from, agent.to, opts.rand);
  }
  const turning = agent.next !== agent.from && isTurn(graph, agent.from, agent.to, agent.next);
  const uTurn = agent.next === agent.from;

  if (distToEnd < (uTurn ? 3 : 6.5)) {
    agent.from = agent.to;
    agent.to = agent.next;
    agent.next = null;
    return autopilot(graph, agent, v, opts);
  }

  // Punto objetivo a cierta distancia adelante sobre el carril (más lejos
  // para vehículos largos, que necesitan abrirse en los giros).
  const wb = v.spec?.wheelBase ?? 2.5;
  const look = clamp(2 + wb + Math.abs(v.forwardSpeed) * 0.6, 5, 16);
  let target;
  if (distToEnd > look || uTurn) {
    target = lanePoint(graph, agent.from, agent.to, clamp(t + look / elen, 0, 1));
  } else {
    const rest = look - distToEnd;
    const nb = graph.node(agent.next);
    const nlen = Math.hypot(nb.x - b.x, nb.z - b.z) || 1;
    target = lanePoint(graph, agent.to, agent.next, clamp(rest / nlen, 0, 1));
  }
  const desiredYaw = yawFromDir(target.x - v.x, target.z - v.z);
  const err = wrapAngle(desiredYaw - v.heading);
  // err > 0 => hay que girar a la izquierda => steer negativo.
  const steer = clamp(-err * 2.2, -1, 1);

  // Maniobra de recuperación: si quedó trabado contra algo, reversa girando.
  const dt = opts.dt ?? 1 / 30;
  if (agent.reverseTimer > 0) {
    agent.reverseTimer -= dt;
    return { throttle: 0, brake: 1, steer: -steer, handbrake: false };
  }

  // Velocidad deseada: más lenta en giros y cerca de intersecciones.
  let desired = opts.cruise;
  if (turning && distToEnd < 22) desired = Math.min(desired, 6.5);
  if (uTurn && distToEnd < 15) desired = Math.min(desired, 3);
  if (Math.abs(err) > 0.5) desired = Math.min(desired, 5);
  if (opts.blockedAhead < Infinity) {
    const stopDist = 4.5;
    desired = Math.min(desired, Math.max(0, (opts.blockedAhead - stopDist) * 0.8));
  }
  const speed = v.forwardSpeed;
  let throttle = 0;
  let brake = 0;
  if (speed < desired - 0.5) throttle = clamp((desired - speed) / 4, 0.25, 1);
  else if (speed > desired + 1) brake = clamp((speed - desired) / 6, 0.2, 1);
  if (desired === 0 && speed < 0.4) {
    throttle = 0;
    brake = 0;
  }
  if (throttle > 0.2 && Math.abs(speed) < 0.4 && opts.blockedAhead === Infinity) agent.stuck = (agent.stuck ?? 0) + dt;
  else agent.stuck = 0;
  if (agent.stuck > 1.2) {
    agent.stuck = 0;
    agent.reverseTimer = 1.6;
  }
  return { throttle, brake, steer, handbrake: false };
}

function isTurn(graph, from, at, next) {
  const a = graph.node(from);
  const b = graph.node(at);
  const c = graph.node(next);
  const d1x = b.x - a.x;
  const d1z = b.z - a.z;
  const d2x = c.x - b.x;
  const d2z = c.z - b.z;
  return Math.abs(d1x * d2z - d1z * d2x) > 1e-3;
}

/**
 * Distancia al obstáculo más cercano dentro del cono frontal de un vehículo.
 * `others` = lista de {x,z}. Devuelve Infinity si no hay nada.
 */
export function obstacleAhead(v, others, range = 16, halfWidth = 1.6) {
  const fx = forwardX(v.heading);
  const fz = forwardZ(v.heading);
  let best = Infinity;
  for (const o of others) {
    if (o === v) continue;
    const dx = o.x - v.x;
    const dz = o.z - v.z;
    const along = dx * fx + dz * fz;
    if (along <= 0 || along > range) continue;
    const lat = Math.abs(dx * -fz + dz * fx);
    if (lat < halfWidth + (o.r ?? 0.9)) best = Math.min(best, along);
  }
  return best;
}
