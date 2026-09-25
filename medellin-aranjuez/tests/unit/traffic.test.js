import { describe, expect, it } from 'vitest';
import { RoadGraph, autopilot, laneOffset, lanePoint, linkAllowed, obstacleAhead } from '../../src/sim/roadNav.js';
import { pointAlong } from '../../src/sim/geom2d.js';
import { createVehicleState, stepVehicle } from '../../src/sim/vehiclePhysics.js';
import { groundHeight, onRoad } from '../../src/sim/terrain.js';
import { makeRng } from '../../src/sim/rng.js';
import { city, cityEnv } from './helpers.js';

// Puntos de referencia en Aranjuez (mapa real).
const CAYETANO = { x: 52, z: -115 };
const COMFAMA = { x: -53, z: -255 };
const PARQUE = { x: 662, z: -434 };

function spawnAgent(g, fromId, rng) {
  const from = g.node(fromId);
  const to = (from.links.find((l) => linkAllowed(g, l)) ?? from.links[0]).node;
  const p = lanePoint(g, fromId, to, 0.3);
  return { agent: { from: fromId, to, next: null }, p, rng };
}

describe('tráfico y navegación vial', () => {
  it('se conduce por la derecha', () => {
    const g = new RoadGraph(city());
    const e = g.activeEdges.find((x) => !x.oneway && x.length > 40);
    const p = lanePoint(g, e.a, e.b, 0.5);
    const axis = pointAlong(e.pts, e.cum, e.length / 2);
    // Derecha del sentido de marcha = (cos yaw, -sin yaw).
    const right = (p.x - axis.x) * Math.cos(p.yaw) - (p.z - axis.z) * Math.sin(p.yaw);
    expect(right).toBeCloseTo(laneOffset(e), 1);
    // Y al revés, el otro carril.
    const q = lanePoint(g, e.b, e.a, 0.5);
    expect(Math.hypot(q.x - p.x, q.z - p.z)).toBeCloseTo(2 * laneOffset(e), 1);
  });

  it('las vías de un solo sentido se respetan en las rutas', () => {
    const g = new RoadGraph(city());
    const start = g.nearestNode(COMFAMA.x, COMFAMA.z);
    const goal = g.nearestNode(PARQUE.x, PARQUE.z);
    const path = g.route(start.id, goal.id);
    expect(path[0]).toBe(start.id);
    expect(path[path.length - 1]).toBe(goal.id);
    for (let i = 1; i < path.length; i++) {
      const l = g.link(path[i - 1], path[i]);
      expect(l).toBeTruthy();
      expect(linkAllowed(g, l)).toBe(true);
    }
  });

  it('detecta obstáculos solo en el cono frontal', () => {
    const v = { x: 0, z: 0, heading: 0 };
    expect(obstacleAhead(v, [{ x: 0, z: -8 }])).toBeCloseTo(8);
    expect(obstacleAhead(v, [{ x: 0, z: 8 }])).toBe(Infinity);
    expect(obstacleAhead(v, [{ x: 6, z: -8 }])).toBe(Infinity);
  });

  it('carros con piloto automático circulan 3 min por Aranjuez sin salirse de la vía ni chocar edificios', () => {
    const c = city();
    const g = new RoadGraph(c);
    const env = cityEnv();
    const rng = makeRng(11);
    const cars = [];
    const near = g.active.filter((n) => Math.hypot(n.x - CAYETANO.x, n.z - CAYETANO.z) < 350 && n.links.length >= 3);
    for (let k = 0; k < 8; k++) {
      const n = near[(k * 7) % near.length];
      const { agent, p } = spawnAgent(g, n.id, rng);
      const v = createVehicleState(k % 3 === 0 ? 'buseta' : 'taxi', p.x, p.z, p.yaw, groundHeight);
      cars.push({ v, agent, offRoad: 0, samples: 0, startX: p.x, startZ: p.z, travelled: 0, lastX: p.x, lastZ: p.z });
    }
    const dt = 1 / 30;
    for (let t = 0; t < 180; t += dt) {
      for (const car of cars) {
        const others = cars.filter((o) => o !== car).map((o) => ({ x: o.v.x, z: o.v.z, r: 1.2 }));
        const input = autopilot(g, car.agent, car.v, { cruise: 12, blockedAhead: obstacleAhead(car.v, others), rand: rng.next, dt });
        const obstacles = cars.filter((o) => o !== car).map((o) => ({ x: o.v.x, z: o.v.z, hx: o.v.spec.width / 2, hz: o.v.spec.length / 2, angle: o.v.heading, mass: o.v.spec.mass }));
        stepVehicle(car.v, input, dt, { ...env, obstacles });
        car.samples++;
        if (!onRoad(car.v.x, car.v.z)) car.offRoad++;
        const e = g.nearestEdge(car.v.x, car.v.z);
        if (e.t > 0.2 && e.t < 0.8) {
          car.latSum = (car.latSum ?? 0) + Math.abs(e.dist - laneOffset(e.edge));
          car.latN = (car.latN ?? 0) + 1;
        }
        car.travelled += Math.hypot(car.v.x - car.lastX, car.v.z - car.lastZ);
        car.lastX = car.v.x;
        car.lastZ = car.v.z;
      }
    }
    for (const car of cars) {
      // Las busetas (7,8 m) se montan en el andén al girar en las calles
      // estrechas y curvas, como en la vida real; los carros casi nunca.
      const isBus = car.v.type === 'buseta';
      expect(car.offRoad / car.samples).toBeLessThan(isBus ? 0.15 : 0.03);
      // En las rectas van por su carril (desvío medio pequeño).
      if (!isBus) expect(car.latSum / car.latN).toBeLessThan(0.6);
      expect(car.v.health).toBeGreaterThan(car.v.spec.health * 0.5);
      expect(car.travelled).toBeGreaterThan(400); // de verdad recorren el barrio
    }
  }, 20000); // 3 min simulados de 8 carros: holgura para máquinas lentas

  it('la patrulla persigue: llega cerca de un objetivo lejano', { timeout: 30000 }, () => {
    const c = city();
    const g = new RoadGraph(c);
    const env = cityEnv();
    const start = g.nearestNode(COMFAMA.x, COMFAMA.z);
    const { agent, p } = spawnAgent(g, start.id);
    const v = createVehicleState('policia', p.x, p.z, p.yaw, groundHeight);
    const target = { x: 330, z: -330 };
    let best = Infinity;
    for (let t = 0; t < 120; t += 1 / 30) {
      const input = autopilot(g, agent, v, { cruise: 20, blockedAhead: Infinity, rand: Math.random, target });
      stepVehicle(v, input, 1 / 30, env);
      best = Math.min(best, Math.hypot(v.x - target.x, v.z - target.z));
    }
    expect(best).toBeLessThan(25);
  });

  it('frena ante un obstáculo detenido', () => {
    const c = city();
    const g = new RoadGraph(c);
    const env = cityEnv();
    const e = g.activeEdges.find((x) => !x.oneway && x.length > 50 && x.pts.length === 2 && Math.hypot(x.pts[0][0] - CAYETANO.x, x.pts[0][1] - CAYETANO.z) < 400);
    const n = g.node(e.a);
    const link = g.link(e.a, e.b);
    const agent = { from: n.id, to: link.node, next: null };
    const p = lanePoint(g, n.id, link.node, 0.1);
    const v = createVehicleState('taxi', p.x, p.z, p.yaw, groundHeight);
    const obstacle = lanePoint(g, n.id, link.node, 0.7);
    let minDist = Infinity;
    for (let t = 0; t < 20; t += 1 / 30) {
      const input = autopilot(g, agent, v, { cruise: 12, blockedAhead: obstacleAhead(v, [{ x: obstacle.x, z: obstacle.z }]), rand: Math.random });
      stepVehicle(v, input, 1 / 30, env);
      minDist = Math.min(minDist, Math.hypot(v.x - obstacle.x, v.z - obstacle.z));
    }
    expect(minDist).toBeGreaterThan(2.5);
    expect(Math.abs(v.forwardSpeed)).toBeLessThan(0.5);
  });
});
