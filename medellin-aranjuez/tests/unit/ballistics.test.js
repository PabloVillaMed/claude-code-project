import { describe, expect, it } from 'vitest';
import { traceShot, deviate } from '../../src/sim/ballistics.js';
import { flatEnv } from './helpers.js';

describe('balística', () => {
  const env = flatEnv([{ minX: 40, maxX: 42, minZ: -5, maxZ: 5, minY: 0, maxY: 10 }]);
  const scene = (extra = {}) => ({ collision: env.collision, groundHeight: env.groundHeight, characters: [], vehicles: [], ...extra });

  it('impacta el cuerpo y la cabeza de un personaje', () => {
    const target = { ref: 'npc', x: 20, y: 0, z: 0 };
    const body = traceShot({ x: 0, y: 1.2, z: 0 }, { x: 1, y: 0, z: 0 }, 100, scene({ characters: [target] }));
    expect(body.kind).toBe('character');
    expect(body.headshot).toBe(false);
    expect(body.t).toBeCloseTo(19.7, 1);
    const head = traceShot({ x: 0, y: 1.62, z: 0 }, { x: 1, y: 0, z: 0 }, 100, scene({ characters: [target] }));
    expect(head.headshot).toBe(true);
  });

  it('las paredes bloquean el disparo', () => {
    const target = { ref: 'npc', x: 50, y: 0, z: 0 };
    const r = traceShot({ x: 0, y: 1.2, z: 0 }, { x: 1, y: 0, z: 0 }, 100, scene({ characters: [target] }));
    expect(r.kind).toBe('building');
    expect(r.t).toBeCloseTo(40);
  });

  it('impacta vehículos y el suelo', () => {
    const v = { ref: 'car', obb: { x: 10, z: 0, hx: 0.9, hz: 2.2, angle: 0 }, y: 0, height: 1.5 };
    const r = traceShot({ x: 0, y: 1, z: 0 }, { x: 1, y: 0, z: 0 }, 100, scene({ vehicles: [v] }));
    expect(r.kind).toBe('vehicle');
    expect(r.t).toBeCloseTo(9.1);
    const d = { x: Math.SQRT1_2, y: -Math.SQRT1_2, z: 0 };
    const g = traceShot({ x: 0, y: 2, z: 0 }, d, 100, scene());
    expect(g.kind).toBe('ground');
    expect(g.x).toBeCloseTo(2, 1);
    expect(g.y).toBeCloseTo(0, 1);
  });

  it('ignora al tirador', () => {
    const me = { ref: 'me', x: 0.5, y: 0, z: 0 };
    const r = traceShot({ x: 0, y: 1.2, z: 0 }, { x: 1, y: 0, z: 0 }, 30, scene({ characters: [me], ignore: new Set(['me']) }));
    expect(r.kind).toBe(null);
  });

  it('deviate conserva la norma y desvía el ángulo pedido', () => {
    const d = deviate({ x: 0, y: 0, z: -1 }, 0.05, 0);
    expect(Math.hypot(d.x, d.y, d.z)).toBeCloseTo(1);
    expect(Math.acos(-d.z)).toBeCloseTo(0.05, 3);
  });
});
