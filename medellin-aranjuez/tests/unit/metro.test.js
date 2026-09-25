import { describe, expect, it } from 'vitest';
import { createPlayerState, emptyMoveInput, stepPlayer } from '../../src/sim/playerController.js';
import { groundHeight } from '../../src/sim/terrain.js';
import { city, cityEnv } from './helpers.js';

const input = (o = {}) => ({ ...emptyMoveInput(), ...o });

/** Camina hacia cada punto (x, z) del mundo; devuelve el estado. */
function walk(s, pts, env, maxT = 40) {
  for (const wp of pts) {
    for (let t = 0; t < maxT; t += 1 / 60) {
      const dx = wp.x - s.pos.x;
      const dz = wp.z - s.pos.z;
      if (Math.hypot(dx, dz) < 0.5) break;
      stepPlayer(s, input({ forward: 1, camYaw: Math.atan2(-dx, -dz) }), 1 / 60, env);
    }
  }
  return s;
}

describe('estación Caribe del metro', () => {
  it('es como la real: a nivel, plataforma central entre las dos vías y dos puentes peatonales', () => {
    const S = city().metro.geo;
    expect(S.platforms.length).toBe(1);
    const p = S.platforms[0];
    expect(p.c0).toBeLessThan(0);
    expect(p.c1).toBeGreaterThan(0);
    expect(p.c1 - p.c0).toBeGreaterThan(7);
    expect(S.bridges.map((b) => b.name).sort()).toEqual(['Moravia', 'Terminal del Norte']);
    // Accesible: ascensor desde el andén y en la llegada de cada puente.
    expect(S.elevators.length).toBe(3);
  });

  it('se llega a pie desde Moravia: escalera, puente sobre el río, vestíbulo y escalera al andén', () => {
    const c = city();
    const S = c.metro.geo;
    const { W } = S.frame;
    const env = cityEnv();
    const P = (a, cc) => {
      const [x, z] = W(a, cc);
      return { x, z };
    };
    const east = S.bridges.find((b) => b.sgn > 0);
    const st = east.stair;
    const cm = (st.c0 + st.c1) / 2;
    const start = P(st.a1 + 1.5, cm);
    const s = createPlayerState(start.x, start.z, groundHeight);
    walk(s, [P(st.a1 - 0.5, cm), P(st.a0 + 0.3, cm), P(0, cm), P(0, 13), P(0, 9)], env);
    // Arriba, en el vestíbulo.
    expect(s.pos.y).toBeCloseTo(S.yC, 0);
    const down = S.stairs.find((r) => r.kind === 'escalera' && r.y1 === S.yP);
    const dc = (down.c0 + down.c1) / 2;
    walk(s, [P(3, dc), P(down.a0 + 0.3, dc), P(down.a1 - 0.3, dc), P(down.a1 + 3, dc)], env);
    // En el andén central.
    expect(s.pos.y).toBeCloseTo(S.yP, 1);
    const [a, cc] = S.frame.toLocal(s.pos.x, s.pos.z);
    expect(a).toBeGreaterThan(down.a1);
    expect(Math.abs(cc)).toBeLessThan(3);
  });

  it('el ascensor del andén sube al vestíbulo', () => {
    const S = city().metro.geo;
    const e = S.elevators[0];
    const { W } = S.frame;
    const [x, z] = W((e.a0 + e.a1) / 2, (e.c0 + e.c1) / 2);
    const env = cityEnv();
    const s = createPlayerState(x, z, (xx, zz) => groundHeight(xx, zz, e.y0 + 0.1));
    expect(s.pos.y).toBeCloseTo(e.y0, 0);
    e.y = e.y0;
    e.state = 'wait';
    e.timer = 0.5;
    e.target = e.y1;
    let top = 0;
    for (let t = 0; t < 15; t += 1 / 60) {
      S.update(1 / 60);
      stepPlayer(s, input(), 1 / 60, env);
      top = Math.max(top, s.pos.y);
    }
    expect(top).toBeGreaterThan(S.yC - 0.2);
  });
});
