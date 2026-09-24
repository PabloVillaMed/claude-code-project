import { describe, expect, it } from 'vitest';
import { WantedSystem, SEARCH } from '../../src/sim/wanted.js';
import { POLICE_AI, canSee, footPath, pickSearchNode, planOfficerSearch, planPatrol } from '../../src/sim/policeAI.js';
import { RoadGraph, autopilot, lanePoint } from '../../src/sim/roadNav.js';
import { createVehicleState, stepVehicle } from '../../src/sim/vehiclePhysics.js';
import { createPed, stepPed } from '../../src/sim/pedAI.js';
import { groundHeight } from '../../src/sim/terrain.js';
import { dist2D } from '../../src/sim/math.js';
import { makeRng } from '../../src/sim/rng.js';
import { city, cityEnv } from './helpers.js';

function patrolAt(g, x, z) {
  const n = g.nearestNode(x, z);
  const to = n.links[0].node;
  const p = lanePoint(g, n.id, to, 0.2);
  return { v: createVehicleState('policia', p.x, p.z, p.yaw, groundHeight), agent: { from: n.id, to, next: null }, ai: {} };
}

/** Simula una patrulla con la IA durante `seconds`; `player` puede moverse con onStep. */
function drive(g, unit, wanted, { seconds, player, seen = () => false, rng = makeRng(5), onStep = () => {} }) {
  const env = cityEnv();
  const dt = 1 / 30;
  const goals = new Set();
  for (let t = 0; t < seconds; t += dt) {
    const isSeen = seen(unit.v, t);
    if (isSeen) wanted.spot(player.x, player.z);
    wanted.update(dt, isSeen, player);
    const plan = planPatrol(unit.ai, unit.v, unit.agent, { graph: g, wanted, seen: isSeen, player, taken: [], rand: rng.next, dt });
    if (unit.ai.goalNode != null) goals.add(unit.ai.goalNode);
    const input = autopilot(g, unit.agent, unit.v, { cruise: plan.cruise, blockedAhead: Infinity, rand: rng.next, dt, target: plan.target });
    stepVehicle(unit.v, input, dt, env);
    onStep(t, plan);
  }
  return { goals };
}

describe('lo que sabe la policía (nivel de búsqueda)', () => {
  it('solo conoce la posición que alguien vio o reportó', () => {
    const w = new WantedSystem();
    w.report('murder', { x: 10, z: 20 });
    expect(w.lastKnown).toEqual({ x: 10, z: 20 });
    // El jugador huye sin ser visto: la policía sigue creyendo que está donde lo vieron.
    for (let t = 0; t < 5; t += 0.1) w.update(0.1, false, { x: 10 + t * 8, z: 20 });
    expect(w.lastKnown).toEqual({ x: 10, z: 20 });
    // Un policía lo ve: la radio actualiza la posición.
    w.update(0.1, true, { x: 90, z: 20 });
    expect(w.lastKnown).toEqual({ x: 90, z: 20 });
    expect(w.sinceSeen).toBe(0);
  });

  it('la zona de búsqueda crece mientras no te ven y tiene tope', () => {
    const w = new WantedSystem();
    w.report('murder', { x: 0, z: 0 });
    const r0 = w.zoneRadius();
    expect(r0).toBeCloseTo(SEARCH.zoneBase + SEARCH.zonePerStar * 2);
    for (let t = 0; t < 10; t += 0.1) w.update(0.1, false, { x: 500, z: 500 });
    expect(w.zoneRadius()).toBeGreaterThan(r0 + 10);
    for (let t = 0; t < 100; t += 0.1) w.update(0.1, false, { x: 500, z: 500 });
    expect(w.zoneRadius()).toBeLessThanOrEqual(r0 * 1.6 + 1e-6);
  });

  it('escondido dentro de la zona las estrellas tardan más en bajar que fuera de ella', () => {
    const inside = new WantedSystem();
    const outside = new WantedSystem();
    for (const w of [inside, outside]) w.report('murder', { x: 0, z: 0 });
    for (let t = 0; t < inside.cooldownFor(2) + 0.5; t += 0.1) {
      inside.update(0.1, false, { x: 5, z: 5 });
      outside.update(0.1, false, { x: 400, z: 400 });
    }
    expect(outside.level).toBe(1);
    expect(inside.level).toBe(2);
  });

  it('la zona se corre hacia donde ibas cuando te perdieron de vista', () => {
    const w = new WantedSystem();
    w.report('shotsFired', { x: 0, z: 0 });
    w.spot(0, 0, 10, 0); // iba hacia el este a 10 m/s
    w.update(0.1, true, { x: 0, z: 0 }); // (el juego confirma la posición sin velocidad)
    for (let t = 0; t < 3; t += 0.1) w.update(0.1, false, { x: 300, z: 0 });
    expect(w.zoneCenter().x).toBeGreaterThan(10);
    expect(w.zoneCenter().z).toBeCloseTo(0);
  });
});

describe('visión de la policía', () => {
  const never = () => false;
  const always = () => true;
  it('de cerca te oyen aunque haya una pared; de lejos necesitan línea de vista', () => {
    expect(canSee({ x: 0, z: 0 }, { x: 5, z: 0 }, 80, never)).toBe(true);
    expect(canSee({ x: 0, z: 0 }, { x: 40, z: 0 }, 80, never)).toBe(false);
    expect(canSee({ x: 0, z: 0 }, { x: 40, z: 0 }, 80, always)).toBe(true);
    expect(canSee({ x: 0, z: 0 }, { x: 120, z: 0 }, 80, always)).toBe(false);
  });
});

describe('patrullas', () => {
  it('el piloto automático sigue la ruta calculada', () => {
    const g = new RoadGraph(city());
    const a = g.nearestNode(-100, -100);
    const b = g.nearestNode(150, 120);
    const path = g.route(a.links[0].node, b.id);
    const agent = { from: a.id, to: path[0], next: null, path };
    const p = lanePoint(g, a.id, path[0], 0.2);
    const v = createVehicleState('policia', p.x, p.z, p.yaw, groundHeight);
    const visited = [agent.to];
    const env = cityEnv();
    for (let t = 0; t < 90 && agent.to !== b.id; t += 1 / 30) {
      const input = autopilot(g, agent, v, { cruise: 14, blockedAhead: Infinity, rand: Math.random, dt: 1 / 30 });
      stepVehicle(v, input, 1 / 30, env);
      if (visited[visited.length - 1] !== agent.to) visited.push(agent.to);
    }
    expect(agent.to).toBe(b.id);
    // Todos los nodos por los que pasó son de la ruta, en orden.
    expect(visited).toEqual(path.slice(0, visited.length));
  });

  it('persiguen al jugador que ven por la ruta más corta', () => {
    const g = new RoadGraph(city());
    const unit = patrolAt(g, -250, -200);
    const w = new WantedSystem();
    const player = { x: 120, z: 90 };
    w.report('murder', player);
    let best = Infinity;
    drive(g, unit, w, { seconds: 70, player, seen: () => true, onStep: () => (best = Math.min(best, dist2D(unit.v.x, unit.v.z, player.x, player.z))) });
    expect(unit.ai.mode).toBe('pursue');
    expect(best).toBeLessThan(25);
  });

  it('sin verte acuden a la última posición conocida, no a donde de verdad estás', () => {
    const g = new RoadGraph(city());
    // Refuerzo que llega desde ~200 m (el juego los crea a 80-170 m de la zona).
    const unit = patrolAt(g, -60, -120);
    const w = new WantedSystem();
    const lastSeen = { x: 100, z: 60 };
    w.report('copAssault', lastSeen);
    const hidden = { x: -200, z: 250 }; // el jugador ya se fue muy lejos
    let bestLast = Infinity;
    let bestReal = Infinity;
    const modes = new Set();
    drive(g, unit, w, {
      seconds: 45,
      player: hidden,
      onStep: (t, plan) => {
        modes.add(plan.mode);
        bestLast = Math.min(bestLast, dist2D(unit.v.x, unit.v.z, lastSeen.x, lastSeen.z));
        bestReal = Math.min(bestReal, dist2D(unit.v.x, unit.v.z, hidden.x, hidden.z));
      },
    });
    expect(modes.has('respond')).toBe(true);
    expect(bestLast).toBeLessThan(POLICE_AI.arrive * 1.5 + 5);
    expect(modes.has('search')).toBe(true);
    expect(bestReal).toBeGreaterThan(120);
  });

  it('ya en la zona la barren: recorren varios puntos dentro de ella', () => {
    const g = new RoadGraph(city());
    const center = { x: 20, z: 40 };
    const unit = patrolAt(g, center.x, center.z);
    const w = new WantedSystem();
    w.report('copAssault', center);
    w.report('copKill', center);
    w.report('copKill', center); // 5 estrellas: siguen buscando todo el minuto y medio
    const { goals } = drive(g, unit, w, { seconds: 90, player: { x: 600, z: 600 } });
    expect(w.level).toBeGreaterThan(0);
    expect(goals.size).toBeGreaterThanOrEqual(3);
    const c = w.zoneCenter();
    const maxR = (SEARCH.zoneBase + SEARCH.zonePerStar * 5) * 1.6;
    for (const id of goals) {
      const n = g.node(id);
      expect(dist2D(n.x, n.z, c.x, c.z)).toBeLessThanOrEqual(maxR + 1);
    }
  });

  it('varias unidades se reparten la zona en vez de ir al mismo punto', () => {
    const g = new RoadGraph(city());
    const c = { x: 0, z: 0 };
    const rng = makeRng(3);
    const a = pickSearchNode(g, c, 110, [], rng.next);
    const b = pickSearchNode(g, c, 110, [a], rng.next);
    const d = pickSearchNode(g, c, 110, [a, b], rng.next);
    expect(dist2D(a.x, a.z, b.x, b.z)).toBeGreaterThan(50);
    expect(Math.min(dist2D(d.x, d.z, a.x, a.z), dist2D(d.x, d.z, b.x, b.z))).toBeGreaterThan(40);
  });
});

describe('agentes a pie', () => {
  function footWorld(c, rng) {
    return {
      blocks: c.blocks,
      blockAt: (x, z) => c.blocks.find((b) => x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ) ?? null,
      collision: c.collision,
      rand: rng.next,
      threats: [],
      player: { x: 9999, z: 9999 },
    };
  }

  it('el camino a pie va por las calles y termina en el destino', () => {
    const g = new RoadGraph(city());
    const from = { x: -150, z: -120 };
    const to = { x: 130, z: 110 };
    const pts = footPath(g, from, to);
    expect(pts.length).toBeGreaterThan(3);
    expect(pts[pts.length - 1]).toEqual(to);
    expect(footPath(g, { x: 0, z: 0 }, { x: 5, z: 5 })).toEqual([{ x: 5, z: 5 }]);
  });

  it('buscan: primero la última posición conocida y luego puntos alrededor, sin trabarse', () => {
    const c = city();
    const g = new RoadGraph(c);
    const rng = makeRng(9);
    const w = new WantedSystem();
    const lastSeen = g.nearestNode(40, 30);
    w.report('copAssault', { x: lastSeen.x, z: lastSeen.z });
    const start = g.nearestNode(-120, -80);
    const block = c.blocks[0];
    const p = createPed(block, rng, { hostile: true, faction: 'police' });
    p.x = start.x;
    p.z = start.z;
    p.mode = 'move';
    const world = footWorld(c, rng);
    const st = {};
    let reachedCenter = false;
    const targets = [];
    const dt = 1 / 20;
    for (let t = 0; t < 150; t += dt) {
      const wps = planOfficerSearch(st, p, { graph: g, wanted: w, rand: rng.next, dt });
      if (wps) {
        p.waypoints = wps;
        p.lastWpD = Infinity;
        targets.push(st.target);
      }
      p.mode = 'move';
      stepPed(p, dt, world);
      w.update(dt, false, { x: 9999, z: 9999 });
      if (dist2D(p.x, p.z, lastSeen.x, lastSeen.z) < 3) reachedCenter = true;
    }
    expect(reachedCenter).toBe(true);
    expect(targets.length).toBeGreaterThanOrEqual(3);
    for (const tg of targets.slice(1)) expect(dist2D(tg.x, tg.z, lastSeen.x, lastSeen.z)).toBeLessThan(POLICE_AI.footSearchRadius + 10);
    // Terminó dentro de la zona de búsqueda.
    expect(dist2D(p.x, p.z, lastSeen.x, lastSeen.z)).toBeLessThan(POLICE_AI.footSearchRadius + 15);
  });
});
