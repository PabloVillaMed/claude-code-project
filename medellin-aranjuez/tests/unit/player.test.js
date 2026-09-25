import { describe, expect, it } from 'vitest';
import { PLAYER, createPlayerState, emptyMoveInput, stepPlayer } from '../../src/sim/playerController.js';
import { groundHeight } from '../../src/sim/terrain.js';
import { city, cityEnv, flatEnv } from './helpers.js';

const input = (o = {}) => ({ ...emptyMoveInput(), ...o });

function simulate(s, inp, seconds, env, dt = 1 / 60) {
  for (let t = 0; t < seconds; t += dt) stepPlayer(s, typeof inp === 'function' ? inp(t) : inp, dt, env);
  return s;
}

describe('movilidad a pie', () => {
  it('camina hacia adelante según la cámara (yaw 0 = norte, -Z)', () => {
    const env = flatEnv();
    const s = createPlayerState(0, 0, env.groundHeight);
    simulate(s, input({ forward: 1 }), 1, env);
    expect(s.pos.z).toBeLessThan(-3.5);
    expect(Math.abs(s.pos.x)).toBeLessThan(1e-6);
    expect(s.speed).toBeCloseTo(PLAYER.runSpeed, 1);
  });

  it('se mueve relativo a la cámara (cámara al este)', () => {
    const env = flatEnv();
    const s = createPlayerState(0, 0, env.groundHeight);
    simulate(s, input({ forward: 1, camYaw: -Math.PI / 2 }), 1, env);
    expect(s.pos.x).toBeGreaterThan(3.5);
    expect(Math.abs(s.pos.z)).toBeLessThan(1e-6);
  });

  it('el movimiento diagonal no es más rápido', () => {
    const env = flatEnv();
    const s = createPlayerState(0, 0, env.groundHeight);
    simulate(s, input({ forward: 1, right: 1 }), 1, env);
    expect(s.speed).toBeLessThanOrEqual(PLAYER.runSpeed + 1e-6);
  });

  it('correr es más rápido que trotar, agachado más lento, y la estamina se agota', () => {
    const env = flatEnv();
    const s = createPlayerState(0, 0, env.groundHeight);
    simulate(s, input({ forward: 1, sprint: true }), 1, env);
    expect(s.speed).toBeCloseTo(PLAYER.sprintSpeed, 1);
    simulate(s, input({ forward: 1, sprint: true }), 10, env);
    expect(s.exhausted).toBe(true);
    expect(s.speed).toBeCloseTo(PLAYER.runSpeed, 1);
    const c = createPlayerState(0, 0, env.groundHeight);
    simulate(c, input({ forward: 1, crouch: true }), 1, env);
    expect(c.speed).toBeCloseTo(PLAYER.crouchSpeed, 1);
    // Recuperación
    simulate(s, input(), 6, env);
    expect(s.exhausted).toBe(false);
    expect(s.stamina).toBe(PLAYER.staminaMax);
  });

  it('se detiene al soltar las teclas', () => {
    const env = flatEnv();
    const s = createPlayerState(0, 0, env.groundHeight);
    simulate(s, input({ forward: 1 }), 1, env);
    simulate(s, input(), 0.5, env);
    expect(s.speed).toBeLessThan(0.01);
  });

  it('salta a una altura realista y aterriza', () => {
    const env = flatEnv();
    const s = createPlayerState(0, 0, env.groundHeight);
    let maxY = 0;
    let t = 0;
    for (; t < 2; t += 1 / 60) {
      stepPlayer(s, input({ jump: t < 0.1 }), 1 / 60, env);
      maxY = Math.max(maxY, s.pos.y);
    }
    const expected = (PLAYER.jumpVelocity * PLAYER.jumpVelocity) / (2 * -PLAYER.gravity);
    expect(maxY).toBeGreaterThan(expected * 0.9);
    expect(maxY).toBeLessThan(expected * 1.1);
    expect(s.onGround).toBe(true);
    expect(s.pos.y).toBe(0);
  });

  it('mantener saltar no produce saltos infinitos (bunny hop)', () => {
    const env = flatEnv();
    const s = createPlayerState(0, 0, env.groundHeight);
    let jumps = 0;
    let wasGround = true;
    for (let t = 0; t < 3; t += 1 / 60) {
      stepPlayer(s, input({ jump: true }), 1 / 60, env);
      if (wasGround && !s.onGround) jumps++;
      wasGround = s.onGround;
    }
    expect(jumps).toBe(1);
  });

  it('no atraviesa paredes, ni siquiera con framerate muy bajo', () => {
    const env = flatEnv([{ minX: -5, maxX: 5, minZ: -3.2, maxZ: -3, minY: 0, maxY: 5 }]);
    for (const dt of [1 / 144, 1 / 60, 1 / 15, 0.1]) {
      const s = createPlayerState(0, 0, env.groundHeight);
      simulate(s, input({ forward: 1, sprint: true }), 3, env, dt);
      expect(s.pos.z, `dt=${dt}`).toBeGreaterThanOrEqual(-3 + PLAYER.radius - 1e-3);
    }
  });

  it('se desliza a lo largo de la pared al chocar en diagonal', () => {
    const env = flatEnv([{ minX: -50, maxX: 50, minZ: -3.2, maxZ: -3, minY: 0, maxY: 5 }]);
    const s = createPlayerState(0, 0, env.groundHeight);
    simulate(s, input({ forward: 1, right: 1 }), 3, env);
    expect(s.pos.x).toBeGreaterThan(5);
    expect(s.pos.z).toBeGreaterThanOrEqual(-3 + PLAYER.radius - 1e-3);
  });

  it('puede saltar sobre un obstáculo bajo pero no caminar a través', () => {
    const low = { minX: -5, maxX: 5, minZ: -4, maxZ: -3, minY: 0, maxY: 0.8 };
    const env = flatEnv([low]);
    const walker = createPlayerState(0, 0, env.groundHeight);
    simulate(walker, input({ forward: 1 }), 3, env);
    expect(walker.pos.z).toBeGreaterThan(-3);
    const jumper = createPlayerState(0, 0, env.groundHeight);
    simulate(jumper, (t) => input({ forward: 1, sprint: true, jump: t > 0.2 && t < 0.3 }), 3, env);
    expect(jumper.pos.z).toBeLessThan(-6);
  });

  it('sube andenes (15 cm) y sigue pendientes sin despegarse', () => {
    const curb = (x, z) => (z < -2 ? 0.15 : 0);
    const env = flatEnv([], curb);
    const s = createPlayerState(0, 0, env.groundHeight);
    simulate(s, input({ forward: 1 }), 2, env);
    expect(s.pos.y).toBeCloseTo(0.15);
    expect(s.onGround).toBe(true);
    const slope = (x, z) => -z * 0.15; // sube hacia el norte
    const env2 = flatEnv([], slope);
    const p = createPlayerState(0, 0, env2.groundHeight);
    let airborne = 0;
    for (let t = 0; t < 4; t += 1 / 60) {
      stepPlayer(p, input({ forward: -1, sprint: true }), 1 / 60, env2); // bajando
      if (!p.onGround) airborne++;
    }
    expect(airborne).toBe(0);
    expect(p.pos.y).toBeCloseTo(slope(0, p.pos.z), 3);
  });

  it('empujado por vehículos (obstáculos dinámicos)', () => {
    const env = flatEnv();
    env.obstacles = [{ x: 0, z: -3, hx: 0.9, hz: 2.2, angle: 0 }];
    const s = createPlayerState(0, 0, env.groundHeight);
    simulate(s, input({ forward: 1 }), 2, env);
    expect(s.pos.z).toBeGreaterThan(-3 + 2.2);
  });

  it('en Aranjuez: caminar 20 s en cada dirección nunca queda dentro de un edificio', () => {
    const c = city();
    const env = cityEnv();
    for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2, 0.7, 2.3]) {
      const s = createPlayerState(c.spawn.x, c.spawn.z, groundHeight);
      simulate(s, input({ forward: 1, sprint: true, camYaw: yaw }), 20, env, 1 / 30);
      expect(c.collision.pointBlocked(s.pos.x, s.pos.z, s.pos.y + 1)).toBe(false);
      expect(s.pos.y).toBeGreaterThan(groundHeight(s.pos.x, s.pos.z) - 0.01);
    }
  });

  it('en Aranjuez: recorre una calle real de punta a punta', () => {
    const c = city();
    const env = cityEnv();
    // Por el eje de una vía larga y curva cerca de San Cayetano.
    const e = c.edges.find((x) => x.active && x.pts.length >= 4 && x.length > 80 && Math.hypot(x.pts[0][0] - 52, x.pts[0][1] + 115) < 500);
    const waypoints = e.pts.map(([x, z]) => ({ x, z }));
    const s = createPlayerState(waypoints[0].x, waypoints[0].z, groundHeight);
    for (const wp of waypoints) {
      for (let t = 0; t < 60; t += 1 / 60) {
        const dx = wp.x - s.pos.x;
        const dz = wp.z - s.pos.z;
        if (Math.hypot(dx, dz) < 0.6) break;
        stepPlayer(s, input({ forward: 1, camYaw: Math.atan2(-dx, -dz) }), 1 / 60, env);
      }
      expect(Math.hypot(wp.x - s.pos.x, wp.z - s.pos.z)).toBeLessThan(0.8);
    }
  });
});
