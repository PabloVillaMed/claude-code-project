// Navegación por la red vial: carriles (se conduce por la derecha, como en
// Colombia), elección de giros, búsqueda de rutas y piloto automático para
// el tráfico y la policía.

import { pointAlong, projectOnPolyline } from './geom2d.js';
import { clamp, dist2D, forwardX, forwardZ, wrapAngle, yawFromDir } from './math.js';

// Las vías del mapa real son polilíneas (no rectas): cada arista guarda sus
// puntos `pts` de a→b, las longitudes acumuladas `cum` y si es de una sola
// vía (`oneway` 1 = solo a→b, -1 = solo b→a).

/** Distancia del eje al centro del carril derecho de la vía. */
export function laneOffset(edge) {
  const lanes = Math.max(1, edge.lanes || 2);
  if (edge.oneway) return lanes >= 2 ? edge.width / 2 - edge.width / (2 * lanes) : 0;
  return clamp(edge.width / 4, 1.4, 3.2);
}

/** ¿Se puede circular por el enlace en ese sentido? */
export function linkAllowed(graph, link) {
  const e = graph.edges[link.edge];
  return !e.oneway || e.oneway === link.dir;
}

export class RoadGraph {
  constructor(city) {
    this.nodes = city.nodes;
    this.edges = city.edges;
    this.active = city.nodes.filter((n) => n.active);
    this.activeEdges = city.edges.filter((e) => e.active !== false);
    // Núcleo de la red (2-core): quita una y otra vez los nodos con una sola
    // salida. Lo que queda fuera son calles ciegas y bolsas sin salida, donde
    // el tráfico no entra (no sabe dar la vuelta en U en una calle angosta).
    const deg = new Map(this.nodes.map((n) => [n.id, new Set(n.links.map((l) => l.node)).size]));
    // El borde del mapa también cuenta como salida cerrada.
    const b = city.bounds;
    const edge = (n) => b && (n.x < b.minX + 30 || n.x > b.maxX - 30 || n.z < b.minZ + 30 || n.z > b.maxZ - 30);
    const stack = this.nodes.filter((n) => deg.get(n.id) <= 1 || edge(n)).map((n) => n.id);
    const removed = new Set();
    while (stack.length) {
      const id = stack.pop();
      if (removed.has(id)) continue;
      removed.add(id);
      for (const l of this.nodes[id].links) {
        if (removed.has(l.node)) continue;
        const d = deg.get(l.node) - 1;
        deg.set(l.node, d);
        if (d <= 1) stack.push(l.node);
      }
    }
    this.core = new Set(this.nodes.filter((n) => !removed.has(n.id)).map((n) => n.id));
    // Índice espacial de aristas activas para nearestEdge.
    this.cell = 40;
    this.grid = new Map();
    for (const e of this.activeEdges) {
      const seen = new Set();
      for (const [x, z] of densify(e.pts, this.cell / 2)) {
        const k = this._key(Math.floor(x / this.cell), Math.floor(z / this.cell));
        if (seen.has(k)) continue;
        seen.add(k);
        if (!this.grid.has(k)) this.grid.set(k, []);
        this.grid.get(k).push(e);
      }
    }
  }

  _key(i, j) {
    return i * 100003 + j;
  }

  node(id) {
    return this.nodes[id];
  }

  /** Enlace de `from` a `to` (el más corto si hay tramos paralelos). */
  link(from, to) {
    let best = null;
    for (const l of this.nodes[from].links) {
      if (l.node !== to) continue;
      if (!best || this.edges[l.edge].length < this.edges[best.edge].length) best = l;
    }
    return best;
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

  /** Arista más cercana y proyección del punto sobre ella ({edge, t, s, dist, x, z}). */
  nearestEdge(x, z) {
    let best = null;
    const ci = Math.floor(x / this.cell);
    const cj = Math.floor(z / this.cell);
    for (let r = 0; r < 60; r++) {
      const seen = new Set();
      for (let i = ci - r; i <= ci + r; i++) {
        for (let j = cj - r; j <= cj + r; j++) {
          if (Math.max(Math.abs(i - ci), Math.abs(j - cj)) !== r) continue;
          for (const e of this.grid.get(this._key(i, j)) ?? []) {
            if (seen.has(e)) continue;
            seen.add(e);
            const p = projectOnPolyline(e.pts, e.cum, x, z);
            if (!best || p.d < best.dist) best = { edge: e, t: p.s / (e.length || 1), s: p.s, dist: p.d, x: p.x, z: p.z };
          }
        }
      }
      // Una vez hallada una arista, basta revisar un anillo más.
      if (best && best.dist < r * this.cell) break;
    }
    return best;
  }

  /** Siguiente nodo al llegar a `at` viniendo de `from`, evitando la vuelta en U y el contravía. */
  pickNext(from, at, rand = Math.random, minWidth = 0) {
    const all = this.nodes[at].links;
    // Sin horquillas: donde una vía se parte en dos calzadas nadie da la
    // vuelta alrededor del separador (giro de más de ~145°), salvo que no haya más.
    const noHairpin = (ls) => {
      const f = ls.filter((l) => turnDot(this, from, at, l.node) > -0.82);
      return f.length ? f : ls;
    };
    if (minWidth) {
      // Vehículos largos: por las vías anchas mientras se pueda.
      const wide = noHairpin(all.filter((l) => l.node !== from && linkAllowed(this, l) && this.edges[l.edge].width >= minWidth && this.core.has(l.node)));
      if (wide.length) return wide[Math.floor(rand() * wide.length)].node;
    }
    // Las calles ciegas solo si no hay otra salida (el tráfico no da la vuelta en U ahí).
    let links = noHairpin(all.filter((l) => l.node !== from && linkAllowed(this, l) && this.core.has(l.node)));
    if (!links.length) links = all.filter((l) => l.node !== from && linkAllowed(this, l) && this.nodes[l.node].links.length > 1);
    if (!links.length) links = all.filter((l) => l.node !== from && linkAllowed(this, l));
    if (!links.length) links = all.filter((l) => l.node !== from);
    if (!links.length) return from;
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
      // El contravía penaliza (la policía en persecución sí lo usa si toca).
      const dead = !this.core.has(n.id) && dist2D(n.x, n.z, tx, tz) > 40;
      const d = dist2D(n.x, n.z, tx, tz) + (linkAllowed(this, l) ? 0 : 60) + (dead ? 200 : 0);
      if (d < bd) {
        bd = d;
        best = l.node;
      }
    }
    return best ?? from;
  }

  /** Ruta más corta (Dijkstra) entre nodos; devuelve lista de ids. `strict` respeta el sentido de las vías. */
  route(startId, goalId, strict = true) {
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
        const ok = linkAllowed(this, l);
        if (strict && !ok) continue;
        const nd = cd + this.edges[l.edge].length * (ok ? 1 : 4);
        if (nd < (dist.get(l.node) ?? Infinity)) {
          dist.set(l.node, nd);
          prev.set(l.node, cur);
          open.add(l.node);
        }
      }
    }
    if (!dist.has(goalId)) return strict ? this.route(startId, goalId, false) : null;
    const path = [goalId];
    while (path[0] !== startId) path.unshift(prev.get(path[0]));
    return path;
  }

  /** ¿Todos los nodos activos están conectados (sin mirar el sentido)? */
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

function densify(pts, step) {
  const out = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const [ax, az] = pts[i - 1];
    const [bx, bz] = pts[i];
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / step));
    for (let k = 1; k <= n; k++) out.push([ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n]);
  }
  return out;
}

/** Punto (en el sentido from→to) a la distancia s desde `from` sobre el eje. */
function axisAt(graph, link, s) {
  const e = graph.edges[link.edge];
  const L = e.length;
  const p = pointAlong(e.pts, e.cum, link.dir === 1 ? s : L - s);
  return link.dir === 1 ? p : { ...p, dx: -p.dx, dz: -p.dz };
}

/** Punto sobre el carril derecho de la arista from->to a una fracción t. */
export function lanePoint(graph, fromId, toId, t) {
  const link = graph.link(fromId, toId);
  if (!link) {
    // Sin arista directa: recta entre nodos (no debería pasar).
    const a = graph.node(fromId);
    const b = graph.node(toId);
    const yaw = yawFromDir(b.x - a.x, b.z - a.z);
    return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, yaw, len: Math.hypot(b.x - a.x, b.z - a.z) };
  }
  const e = graph.edges[link.edge];
  const p = axisAt(graph, link, clamp(t, 0, 1) * e.length);
  const yaw = yawFromDir(p.dx, p.dz);
  // Derecha del sentido de marcha: right = (cos yaw, -sin yaw).
  const off = laneOffset(e);
  return { x: p.x + Math.cos(yaw) * off, z: p.z - Math.sin(yaw) * off, yaw, len: e.length };
}

/** Progreso (m desde `from`) de un punto sobre la arista from→to. */
export function edgeProgress(graph, fromId, toId, x, z) {
  const link = graph.link(fromId, toId);
  if (!link) {
    const a = graph.node(fromId);
    const b = graph.node(toId);
    const len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    return { s: ((x - a.x) * (b.x - a.x) + (z - a.z) * (b.z - a.z)) / len, len };
  }
  const e = graph.edges[link.edge];
  const p = projectOnPolyline(e.pts, e.cum, x, z);
  return { s: link.dir === 1 ? p.s : e.length - p.s, len: e.length };
}

/**
 * Piloto automático. `agent` = {from, to, next}. Calcula la entrada de
 * conducción para seguir el carril derecho y girar en las intersecciones.
 * `opts` = {cruise, blockedAhead (distancia a obstáculo o Infinity), rand, target?}
 */
export function autopilot(graph, agent, v, opts, depth = 0) {
  // Progreso a lo largo de la arista (polilínea).
  const { s: prog, len: elen } = edgeProgress(graph, agent.from, agent.to, v.x, v.z);
  const t = prog / elen;
  const distToEnd = elen - prog;

  // Al acercarse al final, elegir el siguiente tramo.
  if (agent.next === undefined || agent.next === null) agent.next = chooseNext(graph, agent, opts, v);
  // Horquilla (dar la vuelta alrededor del separador donde la vía se parte en
  // dos calzadas): se maneja como una vuelta en U, despacio y sin cortar por el andén.
  const uTurn = agent.next === agent.from || turnDot(graph, agent.from, agent.to, agent.next) < -0.82;
  const turning = !uTurn && isTurn(graph, agent.from, agent.to, agent.next);

  // Los vehículos largos entran más al cruce antes de girar (giro abierto).
  // Igual en los giros cerrados de las calles reales (más de ~50°).
  const wb0 = v.spec?.wheelBase ?? 2.5;
  const longTurn = turning && wb0 > 3.5;
  if (distToEnd < (uTurn ? 3 : longTurn ? 2.5 : 6.5)) {
    agent.uTurned = uTurn;
    agent.from = agent.to;
    agent.to = agent.next;
    agent.next = null;
    if (depth < 4) return autopilot(graph, agent, v, opts, depth + 1);
  }

  // Punto objetivo a cierta distancia adelante sobre el carril (más lejos
  // para vehículos largos, que necesitan abrirse en los giros).
  const wb = v.spec?.wheelBase ?? 2.5;
  const look = wb > 3.5 ? clamp(1.5 + wb * 0.8 + Math.abs(v.forwardSpeed) * 0.45, 5, 13) : clamp(2 + wb + Math.abs(v.forwardSpeed) * 0.6, 5, 16);
  let target;
  if (distToEnd > look || uTurn) {
    target = lanePoint(graph, agent.from, agent.to, clamp(t + look / elen, 0, 1));
  } else if (longTurn) {
    // Hasta el fondo del carril actual y un poco más allá, luego gira.
    const end = lanePoint(graph, agent.from, agent.to, 1);
    const fx = Math.sin(end.yaw) * -1;
    const fz = Math.cos(end.yaw) * -1;
    const over = wb0 > 3.5 ? 2 : 0.5;
    target = { x: end.x + fx * over, z: end.z + fz * over };
  } else {
    const rest = look - distToEnd;
    const nlen = graph.link(agent.to, agent.next) ? graph.edges[graph.link(agent.to, agent.next).edge].length : 20;
    target = lanePoint(graph, agent.to, agent.next, clamp(rest / nlen, 0, 1));
  }
  // Curva por delante: cuánto cambia el rumbo del carril en los próximos metros.
  const ahead = lanePoint(graph, agent.from, agent.to, clamp(t + Math.min(25, distToEnd) / elen, 0, 1));
  const here = lanePoint(graph, agent.from, agent.to, clamp(t, 0, 1));
  // Muy afuera del carril al comienzo del tramo (tras una vuelta en U que se
  // abrió por la calle lateral): primero volver al cruce, sin cortar la esquina
  // por el andén.
  if (agent.uTurned) {
    const off = Math.hypot(here.x - v.x, here.z - v.z);
    if (prog > 10 || off < 2.5) agent.uTurned = false;
    else if (off > 4.5) {
      const n = graph.node(agent.from);
      target = { x: n.x, z: n.z };
    }
  }
  const bend = Math.abs(wrapAngle(ahead.yaw - here.yaw));
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
  // Los vehículos largos (busetas) giran más despacio para no montarse al andén.
  if (turning && distToEnd < 22) desired = Math.min(desired, wb > 3.5 ? 4.5 : 6.5);
  if (uTurn && distToEnd < 15) desired = Math.min(desired, 3);
  if (Math.abs(err) > 0.5) desired = Math.min(desired, 5);
  // Frena antes de las curvas (más los vehículos largos).
  if (bend > 0.25) desired = Math.min(desired, Math.max(4, (wb > 3.5 ? 9 : 13) - bend * (wb > 3.5 ? 9 : 8)));
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
    // Si se vuelve a trabar en el mismo sitio (contra un poste o una esquina
    // del andén), cada reversa es más larga para salir de verdad.
    const again = agent.lastStuck && Math.hypot(v.x - agent.lastStuck.x, v.z - agent.lastStuck.z) < 4;
    agent.stuckCount = again ? (agent.stuckCount ?? 0) + 1 : 0;
    agent.lastStuck = { x: v.x, z: v.z };
    agent.reverseTimer = 1.6 + Math.min(3, agent.stuckCount) * 0.9;
  }
  return { throttle, brake, steer, handbrake: false };
}

/**
 * Siguiente nodo del agente: el de su ruta (agent.path, calculada con
 * Dijkstra) si la tiene y va por ella; si no, hacia el objetivo o al azar.
 */
function chooseNext(graph, agent, opts, v) {
  const path = agent.path;
  if (path) {
    const i = path.indexOf(agent.to);
    if (i >= 0 && i + 1 < path.length) return path[i + 1];
  }
  if (opts.target) return graph.pickToward(agent.from, agent.to, opts.target.x, opts.target.z);
  return graph.pickNext(agent.from, agent.to, opts.rand, (v?.spec?.wheelBase ?? 0) > 3.5 ? 7.5 : 0);
}

/** Coseno del cambio de rumbo al pasar de from→at a at→next. */
function turnDot(graph, from, at, next) {
  const l1 = graph.link(from, at);
  const l2 = graph.link(at, next);
  if (!l1 || !l2) return 1;
  const e1 = graph.edges[l1.edge];
  const p1 = axisAt(graph, l1, e1.length - 0.01);
  const p2 = axisAt(graph, l2, 0.01);
  return p1.dx * p2.dx + p1.dz * p2.dz;
}

function isTurn(graph, from, at, next) {
  const l1 = graph.link(from, at);
  const l2 = graph.link(at, next);
  if (!l1 || !l2) return true;
  const e1 = graph.edges[l1.edge];
  const p1 = axisAt(graph, l1, e1.length - 0.01);
  const p2 = axisAt(graph, l2, 0.01);
  // Giro si cambia el rumbo más de ~25°.
  return p1.dx * p2.dx + p1.dz * p2.dz < 0.9;
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
