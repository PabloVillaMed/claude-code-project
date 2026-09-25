import { describe, expect, it } from 'vitest';
import { VEHICLE_TYPES, createVehicleState, emptyDriveInput, exitPoint, speedKmh, stepVehicle } from '../../src/sim/vehiclePhysics.js';
import { groundHeight } from '../../src/sim/terrain.js';
import { city, cityEnv, flatEnv } from './helpers.js';

const drive = (o = {}) => ({ ...emptyDriveInput(), ...o });
function simulate(v, inp, seconds, env, dt = 1 / 60) {
  let maxImpact = 0;
  for (let t = 0; t < seconds; t += dt) maxImpact = Math.max(maxImpact, stepVehicle(v, typeof inp === 'function' ? inp(t) : inp, dt, env));
  return maxImpact;
}

describe('vehículos', () => {
  for (const type of Object.keys(VEHICLE_TYPES)) {
    it(`${type}: acelera hasta cerca de su velocidad máxima sin pasarla`, () => {
      const env = flatEnv();
      const v = createVehicleState(type, 0, 0, 0, env.groundHeight);
      simulate(v, drive({ throttle: 1 }), 40, env);
      expect(v.forwardSpeed).toBeGreaterThan(VEHICLE_TYPES[type].maxSpeed * 0.8);
      expect(v.forwardSpeed).toBeLessThanOrEqual(VEHICLE_TYPES[type].maxSpeed);
      expect(v.z).toBeLessThan(-100); // avanza hacia el norte
    });
  }

  it('0 a 100 km/h del taxi en un tiempo razonable', () => {
    const env = flatEnv();
    const v = createVehicleState('taxi', 0, 0, 0, env.groundHeight);
    let t = 0;
    while (speedKmh(v) < 100 && t < 30) {
      stepVehicle(v, drive({ throttle: 1 }), 1 / 60, env);
      t += 1 / 60;
    }
    expect(t).toBeGreaterThan(4);
    expect(t).toBeLessThan(14);
  });

  it('frena hasta detenerse y luego va en reversa', () => {
    const env = flatEnv();
    const v = createVehicleState('sedan', 0, 0, 0, env.groundHeight);
    simulate(v, drive({ throttle: 1 }), 5, env);
    const zBrake = v.z;
    let t = 0;
    while (v.forwardSpeed > 0.5 && t < 10) {
      stepVehicle(v, drive({ brake: 1 }), 1 / 60, env);
      t += 1 / 60;
    }
    expect(t).toBeLessThan(2.5); // frena de ~100 km/h en menos de 2,5 s
    expect(v.z - zBrake).toBeLessThan(0); // siguió hacia adelante mientras frenaba
    expect(zBrake - v.z).toBeLessThan(40); // distancia de frenado razonable
    simulate(v, drive({ brake: 1 }), 4, env);
    expect(v.forwardSpeed).toBeLessThan(-2);
    expect(v.forwardSpeed).toBeGreaterThanOrEqual(-VEHICLE_TYPES.sedan.reverseMax);
  });

  it('gira a la derecha y a la izquierda (la derecha reduce el yaw)', () => {
    const env = flatEnv();
    const r = createVehicleState('taxi', 0, 0, 0, env.groundHeight);
    simulate(r, drive({ throttle: 0.6, steer: 1 }), 2, env);
    expect(r.x).toBeGreaterThan(1);
    const l = createVehicleState('taxi', 0, 0, 0, env.groundHeight);
    simulate(l, drive({ throttle: 0.6, steer: -1 }), 2, env);
    expect(l.x).toBeLessThan(-1);
  });

  it('describe un círculo completo sin derivar (radio de giro coherente)', () => {
    const env = flatEnv();
    const v = createVehicleState('sedan', 0, 0, 0, env.groundHeight);
    let turned = 0;
    let prev = v.heading;
    for (let t = 0; t < 60 && Math.abs(turned) < Math.PI * 2; t += 1 / 60) {
      stepVehicle(v, drive({ throttle: 0.35, steer: 1 }), 1 / 60, env);
      let d = v.heading - prev;
      if (d > Math.PI) d -= Math.PI * 2;
      if (d < -Math.PI) d += Math.PI * 2;
      turned += d;
      prev = v.heading;
    }
    expect(Math.abs(turned)).toBeGreaterThanOrEqual(Math.PI * 2);
    expect(Math.hypot(v.x, v.z)).toBeLessThan(12);
  });

  it('el freno de mano produce derrape (velocidad lateral)', () => {
    const env = flatEnv();
    const a = createVehicleState('sedan', 0, 0, 0, env.groundHeight);
    simulate(a, drive({ throttle: 1 }), 4, env);
    let maxLat = 0;
    for (let t = 0; t < 1; t += 1 / 60) {
      stepVehicle(a, drive({ steer: 1, handbrake: true }), 1 / 60, env);
      maxLat = Math.max(maxLat, Math.abs(a.lateralSpeed));
    }
    const b = createVehicleState('sedan', 0, 0, 0, env.groundHeight);
    simulate(b, drive({ throttle: 1 }), 4, env);
    let maxLatNoHb = 0;
    for (let t = 0; t < 1; t += 1 / 60) {
      stepVehicle(b, drive({ steer: 1 }), 1 / 60, env);
      maxLatNoHb = Math.max(maxLatNoHb, Math.abs(b.lateralSpeed));
    }
    expect(maxLat).toBeGreaterThan(maxLatNoHb * 1.5);
  });

  it('a alta velocidad el agarre limita el giro (subviraje) y a baja no', () => {
    const env = flatEnv();
    const run = (speed) => {
      const v = createVehicleState('sedan', 0, 0, 0, env.groundHeight);
      v.vz = -speed;
      v.forwardSpeed = speed;
      let maxAy = 0;
      for (let t = 0; t < 1.5; t += 1 / 60) {
        stepVehicle(v, drive({ throttle: 0.5, steer: 1 }), 1 / 60, env);
        maxAy = Math.max(maxAy, Math.abs(v.forwardSpeed * v.yawRate));
      }
      return maxAy;
    };
    const g = 9.8 * VEHICLE_TYPES.sedan.mu;
    expect(run(32)).toBeLessThan(g * 1.25);
    expect(run(32)).toBeGreaterThan(g * 0.6);
  });

  it('con freno de mano la cola se suelta y el contravolante frena el giro', () => {
    const env = flatEnv();
    const spin = (steerLater) => {
      const v = createVehicleState('sedan', 0, 0, 0, env.groundHeight);
      v.vz = -18;
      v.forwardSpeed = 18;
      for (let t = 0; t < 0.5; t += 1 / 60) stepVehicle(v, drive({ steer: 1, handbrake: true }), 1 / 60, env);
      for (let t = 0; t < 0.4; t += 1 / 60) stepVehicle(v, drive({ steer: steerLater, handbrake: false, throttle: 0.4 }), 1 / 60, env);
      return v;
    };
    const noHb = createVehicleState('sedan', 0, 0, 0, env.groundHeight);
    noHb.vz = -18;
    noHb.forwardSpeed = 18;
    for (let t = 0; t < 0.5; t += 1 / 60) stepVehicle(noHb, drive({ steer: 1 }), 1 / 60, env);
    const hb = createVehicleState('sedan', 0, 0, 0, env.groundHeight);
    hb.vz = -18;
    hb.forwardSpeed = 18;
    for (let t = 0; t < 0.5; t += 1 / 60) stepVehicle(hb, drive({ steer: 1, handbrake: true }), 1 / 60, env);
    expect(Math.abs(hb.yawRate)).toBeGreaterThan(Math.abs(noHb.yawRate) * 1.3);
    expect(hb.slip).toBeGreaterThan(noHb.slip);
    // Contravolante: girar al lado contrario reduce la rotación.
    expect(Math.abs(spin(-1).yawRate)).toBeLessThan(Math.abs(spin(1).yawRate));
  });

  it('la carrocería cabecea al frenar (nariz abajo) y al arrancar (nariz arriba)', () => {
    const env = flatEnv();
    const v = createVehicleState('taxi', 0, 0, 0, env.groundHeight);
    simulate(v, drive({ throttle: 1 }), 0.5, env);
    expect(v.bodyPitch).toBeGreaterThan(0.01);
    simulate(v, drive({ throttle: 1 }), 3, env);
    simulate(v, drive({ brake: 1 }), 0.4, env);
    expect(v.bodyPitch).toBeLessThan(-0.01);
  });

  it('choca contra una pared: no la atraviesa, rebota y recibe daño', () => {
    const env = flatEnv([{ minX: -20, maxX: 20, minZ: -61, maxZ: -60, minY: -1, maxY: 10 }]);
    const v = createVehicleState('taxi', 0, 0, 0, env.groundHeight);
    const impact = simulate(v, drive({ throttle: 1 }), 8, env, 1 / 30);
    expect(v.z).toBeGreaterThan(-60 + VEHICLE_TYPES.taxi.length / 2 - 0.05);
    expect(impact).toBeGreaterThan(5);
    expect(v.health).toBeLessThan(VEHICLE_TYPES.taxi.health);
  });

  it('no atraviesa paredes delgadas a máxima velocidad con frames largos', () => {
    const env = flatEnv([{ minX: -20, maxX: 20, minZ: -200.3, maxZ: -200, minY: -1, maxY: 10 }]);
    const v = createVehicleState('policia', 0, 0, 0, env.groundHeight);
    v.vz = -50;
    v.forwardSpeed = 50;
    simulate(v, drive({ throttle: 1 }), 6, env, 0.1);
    expect(v.z).toBeGreaterThan(-200);
  });

  it('en una loma: se va hacia atrás sin freno si es empinada, sube con acelerador', () => {
    const hill = (x, z) => -z * 0.2; // sube hacia el norte, 20 %
    const env = flatEnv([], hill);
    const v = createVehicleState('taxi', 0, 0, 0, env.groundHeight);
    simulate(v, drive({ throttle: 1 }), 6, env);
    expect(v.z).toBeLessThan(-20);
    expect(v.y).toBeGreaterThan(3);
    expect(v.pitch).toBeGreaterThan(0.1); // nariz arriba
    const bus = createVehicleState('buseta', 0, 0, 0, env.groundHeight);
    simulate(bus, drive({ throttle: 1 }), 8, env);
    expect(bus.z).toBeLessThan(-10); // hasta la buseta sube la loma
  });

  it('la moto se inclina al girar', () => {
    const env = flatEnv();
    const m = createVehicleState('moto', 0, 0, 0, env.groundHeight);
    simulate(m, drive({ throttle: 1 }), 3, env);
    simulate(m, drive({ throttle: 0.5, steer: 1 }), 0.8, env);
    expect(Math.abs(m.lean)).toBeGreaterThan(0.1);
  });

  it('empuja otros vehículos (obstáculos dinámicos)', () => {
    const env = flatEnv();
    env.obstacles = [{ x: 0, z: -15, hx: 0.9, hz: 2.2, angle: 0, mass: 1200 }];
    const v = createVehicleState('camioneta', 0, 0, 0, env.groundHeight);
    simulate(v, drive({ throttle: 1 }), 4, env);
    expect(v.z).toBeGreaterThan(-15 + 2.2 + VEHICLE_TYPES.camioneta.length / 2 - 0.3);
  });

  it('punto de salida del conductor queda al lado izquierdo', () => {
    const env = flatEnv();
    const v = createVehicleState('taxi', 0, 0, 0, env.groundHeight);
    const p = exitPoint(v);
    expect(p.x).toBeLessThan(-1);
  });

  it('en Aranjuez: conducir por la Carrera y chocar contra una manzana no deja el carro dentro', () => {
    const c = city();
    const env = cityEnv();
    // Arranca en una vía cerca de San Cayetano, de frente contra la fachada más cercana.
    const b = c.buildings.filter((h) => !h.interior && Math.hypot(h.frame.x - 52, h.frame.z + 115) < 200)[0];
    const f = b.frame;
    const sx = f.x + f.nx * (f.hv + 9);
    const sz = f.z + f.nz * (f.hv + 9);
    const v = createVehicleState('sedan', sx, sz, Math.atan2(f.nx, f.nz), groundHeight);
    simulate(v, drive({ throttle: 1 }), 12, env, 1 / 60);
    const corners = [
      [v.x, v.z],
      [v.x + 1, v.z],
      [v.x - 1, v.z],
    ];
    for (const [x, z] of corners) expect(c.collision.pointBlocked(x, z, v.y + 1)).toBe(false);
  });
});
