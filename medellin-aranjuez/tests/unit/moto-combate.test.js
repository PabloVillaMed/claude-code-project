import { describe, expect, it } from 'vitest';
import { RIDER_HIT, riderHitbox } from '../../src/sim/riders.js';
import { traceShot } from '../../src/sim/ballistics.js';
import { MOTO_FALL, createVehicleState, emptyDriveInput, standUpMoto, startMotoFall, stepVehicle } from '../../src/sim/vehiclePhysics.js';
import { flatEnv } from './helpers.js';

// Dispararle al que va en moto: cajas de impacto del piloto y del parrillero
// (sim/riders.js) y la moto que se queda sin piloto (MOTO_FALL).

const SEAT_Y = 0.99; // pelvis del piloto (asiento de la moto de la Policía)
const SEAT_Z = 0.1;
const BACK = 0.42; // el parrillero, más atrás

describe('cajas de impacto de los que van en moto', () => {
  const moto = { x: 0, y: 0, z: 0, heading: 0, lean: 0 };

  it('cabeza y torso sobre el asiento; el parrillero detrás del piloto', () => {
    const d = riderHitbox(moto, SEAT_Y, SEAT_Z);
    expect(d.hy).toBeCloseTo(SEAT_Y + RIDER_HIT.headUp, 5);
    expect(d.y0).toBeGreaterThan(SEAT_Y);
    expect(d.y1).toBeLessThan(d.hy - RIDER_HIT.headR);
    expect(Math.abs(d.hx)).toBeLessThan(1e-9);
    const p = riderHitbox(moto, SEAT_Y + 0.07, SEAT_Z + BACK);
    // Rumbo 0: adelante es -Z, así que "detrás" es +Z.
    expect(p.hz - d.hz).toBeCloseTo(BACK, 5);
    expect(p.hy).toBeGreaterThan(d.hy);
  });

  it('con la moto ladeada la cabeza se corre hacia ese lado (y gira con el rumbo)', () => {
    const lean = 0.3; // + = hacia la izquierda
    const d = riderHitbox({ ...moto, lean }, SEAT_Y, SEAT_Z);
    const h = SEAT_Y + RIDER_HIT.headUp;
    expect(d.hx).toBeCloseTo(-h * Math.sin(lean), 5); // izquierda de rumbo 0 = -X
    expect(d.hy).toBeCloseTo(h * Math.cos(lean), 5);
    // Rumbo de 90° (mira hacia -X): la izquierda queda hacia +Z.
    const t = riderHitbox({ ...moto, heading: Math.PI / 2, lean }, SEAT_Y, SEAT_Z);
    expect(t.hz).toBeGreaterThan(0.3);
  });

  it('el tiro a la cabeza del piloto es tiro a la cabeza; a la moto, abajo, no le pega a él', () => {
    const env = flatEnv();
    const c = { ref: 'piloto', rider: true, dead: false, ...riderHitbox({ ...moto, x: 15 }, SEAT_Y, SEAT_Z) };
    const scene = { collision: env.collision, groundHeight: env.groundHeight, characters: [c], vehicles: [] };
    const head = traceShot({ x: 0, y: c.hy, z: c.hz }, { x: 1, y: 0, z: 0 }, 100, scene);
    expect(head.kind).toBe('character');
    expect(head.ref).toBe('piloto');
    expect(head.headshot).toBe(true);
    const chest = traceShot({ x: 0, y: SEAT_Y + 0.25, z: c.z }, { x: 1, y: 0, z: 0 }, 100, scene);
    expect(chest.kind).toBe('character');
    expect(chest.headshot).toBe(false);
    // A la altura del motor (0,45 m) la bala pasa por debajo del torso.
    const low = traceShot({ x: 0, y: 0.45, z: c.z }, { x: 1, y: 0, z: 0 }, 100, scene);
    expect(low.kind).not.toBe('character');
  });
});

describe('moto sin piloto: se ladea, cae y se desliza', () => {
  const env = flatEnv();
  const roll = (v, secs, dt = 1 / 60) => {
    const idle = emptyDriveInput();
    for (let t = 0; t < secs; t += dt) stepVehicle(v, idle, dt, env);
  };

  it('cae como un péndulo (no de golpe), queda acostada y para tras unos metros', () => {
    const v = createVehicleState('moto', 0, 0, 0, () => 0);
    v.vz = -11; // 40 km/h hacia adelante (rumbo 0 = -Z)
    v.forwardSpeed = 11;
    startMotoFall(v, 1);
    roll(v, 0.2);
    expect(v.lean).toBeGreaterThan(0);
    expect(v.lean).toBeLessThan(MOTO_FALL.restLean * 0.5); // arranca despacio
    roll(v, 1.0);
    expect(v.lean).toBeGreaterThan(MOTO_FALL.restLean * 0.9); // ya en el piso
    roll(v, 4);
    expect(v.lean).toBeCloseTo(MOTO_FALL.restLean, 2);
    expect(v.fallSettled).toBe(true);
    expect(Math.abs(v.forwardSpeed)).toBeLessThan(0.1);
    const slid = Math.hypot(v.x, v.z);
    expect(slid).toBeGreaterThan(4);
    expect(slid).toBeLessThan(25);
    // Al montarse alguien, la levantan.
    standUpMoto(v);
    expect(v.fallen).toBe(0);
    expect(v.lean).toBe(0);
  });

  it('quieta también cae (hacia el lado pedido) y no sale rodando hacia atrás', () => {
    const v = createVehicleState('moto', 0, 0, 0, () => 0);
    startMotoFall(v, -1);
    roll(v, 3);
    expect(v.lean).toBeCloseTo(-MOTO_FALL.restLean, 2);
    expect(Math.hypot(v.x, v.z)).toBeLessThan(0.5);
  });

  it('acostada en una loma no sigue rodando cuesta abajo', () => {
    const slope = flatEnv([], (x, z) => z * 0.15); // 15 %: baja hacia -Z (adelante con rumbo 0)
    const v = createVehicleState('moto', 0, 0, 0, slope.groundHeight);
    v.vz = -6;
    v.forwardSpeed = 6;
    startMotoFall(v, 1);
    const idle = emptyDriveInput();
    for (let t = 0; t < 4; t += 1 / 60) stepVehicle(v, idle, 1 / 60, slope);
    const z1 = v.z;
    for (let t = 0; t < 3; t += 1 / 60) stepVehicle(v, idle, 1 / 60, slope);
    expect(Math.abs(v.z - z1)).toBeLessThan(0.05);
    expect(v.fallSettled).toBe(true);
  });

  it('una moto con piloto no se cae (la inclinación sigue con su tope)', () => {
    const v = createVehicleState('moto', 0, 0, 0, () => 0);
    for (let t = 0; t < 3; t += 1 / 60) stepVehicle(v, { throttle: 1, brake: 0, steer: 1, handbrake: false, wheelie: false }, 1 / 60, env);
    expect(v.fallen).toBe(0);
    expect(Math.abs(v.lean)).toBeLessThan(0.31);
  });
});
