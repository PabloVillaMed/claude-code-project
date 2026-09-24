import { describe, expect, it } from 'vitest';
import { RoadGraph, autopilot, lanePoint, obstacleAhead } from '../../src/sim/roadNav.js';
import { createVehicleState, stepVehicle } from '../../src/sim/vehiclePhysics.js';
import { GRID, groundHeight, onRoad } from '../../src/sim/terrain.js';
import { makeRng } from '../../src/sim/rng.js';
import { city, cityEnv } from './helpers.js';

function spawnAgent(g, fromId, rng) {
  const from = g.node(fromId);
  const to = from.links[0].node;
  const p = lanePoint(g, fromId, to, 0.3);
  return { agent: { from: fromId, to, next: null }, p, rng };
}

describe('tráfico y navegación vial', () => {
  it('se conduce por la derecha', () => {
    const g = new RoadGraph(city());
    const a = g.active[0];
    const link = a.links.find((l) => g.node(l.node).z === a.z && g.node(l.node).x > a.x);
    const p = lanePoint(g, a.id, link.node, 0.5);
    // Yendo al este, la derecha es el sur (+Z).
    expect(p.z - a.z).toBeCloseTo(GRID.laneOffset);
  });

  it('ruta más corta entre esquinas opuestas', () => {
    const g = new RoadGraph(city());
    const start = g.active[0];
    const goal = g.active[g.active.length - 1];
    const path = g.route(start.id, goal.id);
    expect(path[0]).toBe(start.id);
    expect(path[path.length - 1]).toBe(goal.id);
    expect(path.length).toBe(GRID.nx + GRID.nz + 1);
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
    for (let k = 0; k < 8; k++) {
      const n = g.active[(k * 13) % g.active.length];
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
          car.latSum = (car.latSum ?? 0) + Math.abs(e.dist - GRID.laneOffset);
          car.latN = (car.latN ?? 0) + 1;
        }
        car.travelled += Math.hypot(car.v.x - car.lastX, car.v.z - car.lastZ);
        car.lastX = car.v.x;
        car.lastZ = car.v.z;
      }
    }
    for (const car of cars) {
      // Las busetas (7,8 m) se montan un poco en el andén al girar en calles
      // estrechas, como en la vida real; los carros no.
      const isBus = car.v.type === 'buseta';
      expect(car.offRoad / car.samples).toBeLessThan(isBus ? 0.12 : 0.01);
      // En las rectas van por su carril (desvío medio pequeño).
      if (!isBus) expect(car.latSum / car.latN).toBeLessThan(0.6);
      expect(car.v.health).toBeGreaterThan(car.v.spec.health * 0.5);
      expect(car.travelled).toBeGreaterThan(400); // de verdad recorren el barrio
    }
  }, 20000); // 3 min simulados de 8 carros: holgura para máquinas lentas

  it('la patrulla persigue: llega cerca de un objetivo lejano', () => {
    const c = city();
    const g = new RoadGraph(c);
    const env = cityEnv();
    const start = g.nearestNode(-280, -280);
    const { agent, p } = spawnAgent(g, start.id);
    const v = createVehicleState('policia', p.x, p.z, p.yaw, groundHeight);
    const target = { x: 175, z: 175 };
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
    const n = g.nearestNode(0, 0);
    const link = n.links.find((l) => g.node(l.node).z < n.z);
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
