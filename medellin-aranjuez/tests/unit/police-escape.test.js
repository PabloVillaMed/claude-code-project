import { describe, expect, it } from 'vitest';
import { WantedSystem, MAX_UNITS } from '../../src/sim/wanted.js';
import { POLICE_AI, DISPATCH, PoliceDispatch, assignRoles, canSee, pickSpawnNode, planPatrol, policeMotoVariant } from '../../src/sim/policeAI.js';
import { RoadGraph, autopilot, lanePoint } from '../../src/sim/roadNav.js';
import { createVehicleState, stepVehicle } from '../../src/sim/vehiclePhysics.js';
import { groundHeight } from '../../src/sim/terrain.js';
import { dist2D } from '../../src/sim/math.js';
import { makeRng } from '../../src/sim/rng.js';
import { city, cityEnv } from './helpers.js';

// Persecuciones simuladas sin render: el mismo despacho (PoliceDispatch),
// papeles (assignRoles), visión con línea de vista contra los edificios y
// planes de patrulla (planPatrol) que usa game/world.js, con las unidades y el
// carro del jugador manejados por el piloto automático y la física real.

const STARS = {
  3: ['copAssault'],
  5: ['copAssault', 'copKill', 'copKill'],
};

/** Ruta del jugador hacia el nodo (de una muestra) más lejos de la policía. */
function fleeRoute(g, agent, pv, units, wanted, rng) {
  const from = wanted.zoneCenter() ?? pv;
  let best = null;
  let bestScore = -Infinity;
  for (let k = 0; k < 24; k++) {
    const n = g.active[Math.floor(rng.next() * g.active.length)];
    if (dist2D(n.x, n.z, pv.x, pv.z) < 250) continue;
    let near = dist2D(n.x, n.z, from.x, from.z);
    for (const u of units) near = Math.min(near, dist2D(n.x, n.z, u.v.x, u.v.z) * 1.3);
    if (near > bestScore) {
      bestScore = near;
      best = n;
    }
  }
  if (!best) return;
  agent.goal = best.id;
  agent.path = g.route(agent.to, best.id);
  agent.next = null;
}

/**
 * stars: 3 o 5. hold: s que el jugador se queda quieto (la balacera) antes de
 * huir; flee: m/s de crucero del carro del jugador (0 = no huye).
 */
function simulate({ stars, seconds, hold = 0, flee = 0, seed = 1, start = { x: 52, z: -115 } }) {
  const c = city();
  const g = new RoadGraph(c);
  const env = cityEnv();
  const rng = makeRng(seed);
  const dt = 1 / 20;
  const los = (a, b) => {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dz = b.z - a.z;
    const d = Math.hypot(dx, dy, dz);
    return d < 0.01 || !c.collision.raycast(a.x, a.y, a.z, dx / d, dy / d, dz / d, d);
  };
  // El jugador, en su carro.
  const n0 = g.nearestNode(start.x, start.z);
  const to0 = n0.links[0].node;
  const p0 = lanePoint(g, n0.id, to0, 0.3);
  const pv = createVehicleState('sedan', p0.x, p0.z, p0.yaw, groundHeight);
  const pAgent = { from: n0.id, to: to0, next: null };
  const wanted = new WantedSystem();
  for (const crime of STARS[stars]) wanted.report(crime, { x: pv.x, z: pv.z });
  const dispatch = new PoliceDispatch();
  const units = [];
  let nextId = 1;
  const out = { escapedAt: null, spawned: [], maxNear: 0, maxNearEarly: 0, firstContact: null, seenAfterFlee: 0, maxActive: 0, kinds: [], roles: new Set() };
  const last = { x: pv.x, z: pv.z };
  let seen = false;
  let lookT = 0;
  let routeT = 0;
  for (let t = 0; t < seconds; t += dt) {
    // --- jugador
    const fleeing = flee > 0 && t >= hold;
    if (fleeing) {
      routeT -= dt;
      if (!pAgent.path || pAgent.to === pAgent.goal || routeT <= 0) {
        fleeRoute(g, pAgent, pv, units, wanted, rng);
        routeT = 25;
      }
    }
    const pin = fleeing ? autopilot(g, pAgent, pv, { cruise: flee, blockedAhead: Infinity, rand: rng.next, dt }) : { throttle: 0, brake: 1, steer: 0, handbrake: true };
    stepVehicle(pv, pin, dt, env);
    const player = { x: pv.x, y: pv.y, z: pv.z, inVehicle: true, speed: Math.abs(pv.forwardSpeed) };
    const playerVel = { x: (pv.x - last.x) / dt, z: (pv.z - last.z) / dt };
    last.x = pv.x;
    last.z = pv.z;

    // --- despacho (como world.updatePolice)
    const order = dispatch.step(dt, wanted.level, units);
    if (order === 'retire') {
      let far = units[0];
      for (const u of units) if (dist2D(u.v.x, u.v.z, pv.x, pv.z) > dist2D(far.v.x, far.v.z, pv.x, pv.z)) far = u;
      units.splice(units.indexOf(far), 1);
      assignRoles(units);
    } else if (order) {
      const zc = wanted.zoneCenter() ?? player;
      const n = pickSpawnNode(g, zc, player, units.map((u) => u.v), rng.next);
      if (!n) dispatch.failed();
      else {
        const to = g.pickToward(-1, n.id, zc.x, zc.z);
        const p = lanePoint(g, n.id, to, 0.1);
        const v = order === 'moto' ? createVehicleState('moto', p.x, p.z, p.yaw, groundHeight, policeMotoVariant()) : createVehicleState('policia', p.x, p.z, p.yaw, groundHeight);
        units.push({ id: nextId++, kind: order, v, agent: { from: n.id, to, next: null }, ai: {}, stopT: 0 });
        out.spawned.push(t);
        out.kinds.push(order);
        assignRoles(units);
      }
    }
    out.maxActive = Math.max(out.maxActive, units.length);

    // --- visión (rayos cada 0.25 s)
    lookT -= dt;
    if (lookT <= 0) {
      lookT = 0.25;
      seen = false;
      if (wanted.level > 0) {
        for (const u of units) {
          if (canSee({ x: u.v.x, y: u.v.y + 1.4, z: u.v.z }, { x: pv.x, y: pv.y + 1.2, z: pv.z }, POLICE_AI.carSight, los)) seen = true;
        }
      }
    }
    if (seen) wanted.spot(pv.x, pv.z, playerVel.x, playerVel.z);
    if (seen && fleeing) out.seenAfterFlee += dt;
    wanted.update(dt, seen, { x: pv.x, z: pv.z });
    if (wanted.level === 0 && out.escapedAt == null) out.escapedAt = t;
    if (wanted.level === 0) break;

    // --- planes y física de las unidades
    const taken = [];
    let near = 0;
    for (const u of [...units]) {
      const s = u.v;
      const d = dist2D(s.x, s.z, pv.x, pv.z);
      if (d < 25) near++;
      if (d < 25 && out.firstContact == null) out.firstContact = t;
      const zc = wanted.zoneCenter();
      if (d > 320 && (!zc || dist2D(s.x, s.z, zc.x, zc.z) > 250)) {
        units.splice(units.indexOf(u), 1);
        assignRoles(units);
        continue;
      }
      taken.length = 0;
      for (const o of units) if (o !== u && o.ai.goalNode != null) taken.push(g.node(o.ai.goalNode));
      const plan = planPatrol(u.ai, s, u.agent, { graph: g, wanted, seen, player, playerVel, taken, rand: rng.next, dt, role: u.role, moto: u.kind === 'moto' });
      out.roles.add(u.role);
      // Contacto con el jugador quieto: frenan y se bajan (aquí solo se detienen).
      if (seen && d < 22 && player.speed < 6) u.stopT = 3;
      u.stopT -= dt;
      const input = autopilot(g, u.agent, s, { cruise: u.stopT > 0 ? 0 : plan.cruise, blockedAhead: Infinity, rand: rng.next, dt, target: plan.target });
      stepVehicle(s, input, dt, env);
    }
    out.maxNear = Math.max(out.maxNear, near);
    if (t < 20) out.maxNearEarly = Math.max(out.maxNearEarly, near);
  }
  out.level = wanted.level;
  return out;
}

describe('escapar de la policía (simulación sin render)', () => {
  it('los refuerzos llegan escalonados, mezclados con motos, y no se apilan encima del jugador', () => {
    const r = simulate({ stars: 5, seconds: 40 });
    // La primera unidad sale a los segundos, no al instante, y las demás de a una.
    expect(r.spawned[0]).toBeGreaterThanOrEqual(DISPATCH.firstDelay[5] - 0.1);
    for (let k = 1; k < r.spawned.length; k++) expect(r.spawned[k] - r.spawned[k - 1]).toBeGreaterThanOrEqual(DISPATCH.interval[5] - 0.1);
    expect(r.maxActive).toBeLessThanOrEqual(MAX_UNITS[5]);
    // Nadie llega encima en los primeros segundos y en los primeros 20 s hay a lo sumo dos cerca.
    expect(r.firstContact).toBeGreaterThan(6);
    expect(r.maxNearEarly).toBeLessThanOrEqual(2);
    // Más motos que camionetas, y no todas persiguen: unas cortan el paso y otras barren.
    const motos = r.kinds.filter((k) => k === 'moto').length;
    expect(motos).toBeGreaterThan(r.kinds.length - motos);
    expect(r.roles.has('cut') || r.roles.has('sweep')).toBe(true);
  });

  it('el tope de unidades a la vez sube con las estrellas (1 a 5, contando motos)', () => {
    expect(MAX_UNITS).toEqual([0, 1, 2, 3, 4, 5]);
    const d = new PoliceDispatch();
    const units = [];
    for (let t = 0; t < 120; t += 0.1) {
      const o = d.step(0.1, 3, units);
      if (o === 'car' || o === 'moto') units.push({ kind: o });
    }
    expect(units.length).toBe(3);
    // Bajan a 1 estrella: se retiran de a una hasta quedar una.
    let retired = 0;
    for (let t = 0; t < 20; t += 0.1) if (d.step(0.1, 1, units) === 'retire') units.pop(), retired++;
    expect(retired).toBe(2);
    expect(units.length).toBe(1);
  });

  it('con 3 estrellas y un carro rápido se puede escapar en un tiempo razonable', () => {
    const r = simulate({ stars: 3, seconds: 240, hold: 14, flee: 30 });
    expect(r.firstContact).not.toBeNull(); // sí llegaron a donde estaba
    expect(r.escapedAt).not.toBeNull();
    expect(r.escapedAt - 14).toBeLessThan(120);
  });

  it('con 5 estrellas es más difícil, pero posible', () => {
    const r3 = simulate({ stars: 3, seconds: 240, hold: 14, flee: 30 });
    const r5 = simulate({ stars: 5, seconds: 480, hold: 14, flee: 30 });
    expect(r5.escapedAt).not.toBeNull();
    expect(r5.escapedAt).toBeGreaterThan(r3.escapedAt + 20);
    expect(r5.escapedAt - 14).toBeLessThan(300);
  });

  it('quieto en la calle con 3 estrellas no te escapas: llegan y te ven', () => {
    const r = simulate({ stars: 3, seconds: 90 });
    expect(r.escapedAt).toBeNull();
    expect(r.level).toBe(3);
    expect(r.firstContact).toBeLessThan(40);
  });
});
