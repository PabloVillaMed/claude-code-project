import { describe, expect, it } from 'vitest';
import { createPed, stepPed, ringCorners, PED } from '../../src/sim/pedAI.js';
import { onBlock, onRoad } from '../../src/sim/terrain.js';
import { makeRng } from '../../src/sim/rng.js';
import { pointInPoly } from '../../src/sim/geom2d.js';
import { city } from './helpers.js';

function makeWorld(c, rng, extra = {}) {
  return {
    blocks: c.blocks,
    blockAt: (x, z) => c.blocks.find((b) => b.ring && x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ && pointInPoly(x, z, b.curb)) ?? null,
    collision: c.collision,
    rand: rng.next,
    threats: [],
    player: { x: 0, z: 0 },
    ...extra,
  };
}

const walkable = (c) => c.blocks.filter((b) => b.ring && b.type === 'residencial');

describe('peatones (NPC)', () => {
  it('caminan por los andenes: casi nunca en la calzada salvo al cruzar', () => {
    const c = city();
    const rng = makeRng(5);
    const world = makeWorld(c, rng);
    const peds = walkable(c).slice(0, 60).map((b) => createPed(b, rng));
    let onRoadSamples = 0;
    let crossing = 0;
    let total = 0;
    for (let t = 0; t < 120; t += 1 / 20) {
      for (const p of peds) {
        stepPed(p, 1 / 20, world);
        total++;
        if (p.mode === 'cross') crossing++;
        else if (onRoad(p.x, p.z)) onRoadSamples++;
      }
    }
    expect(onRoadSamples / total).toBeLessThan(0.01);
    expect(crossing).toBeGreaterThan(0); // alguno cruzó la calle
  });

  it('nunca quedan dentro de edificios', () => {
    const c = city();
    const rng = makeRng(6);
    const world = makeWorld(c, rng);
    const peds = walkable(c).map((b) => createPed(b, rng));
    for (let t = 0; t < 60; t += 1 / 20) for (const p of peds) stepPed(p, 1 / 20, world);
    for (const p of peds) expect(c.collision.pointBlocked(p.x, p.z)).toBe(false);
  });

  it('huyen de los disparos y luego vuelven a caminar', () => {
    const c = city();
    const rng = makeRng(7);
    const block = c.blocks.find((b) => b.type === 'residencial');
    const p = createPed(block, rng);
    const world = makeWorld(c, rng, { threats: [{ x: p.x + 2, z: p.z, radius: 30 }] });
    const d0 = Math.abs(p.x - (p.x + 2));
    const shooterX = p.x + 2;
    const shooterZ = p.z;
    stepPed(p, 1 / 20, world);
    expect(p.mode).toBe('flee');
    world.threats = [];
    for (let t = 0; t < 2; t += 1 / 20) stepPed(p, 1 / 20, world);
    expect(Math.hypot(p.x - shooterX, p.z - shooterZ)).toBeGreaterThan(d0 + 5);
    expect(p.speed).toBeCloseTo(PED.run);
    for (let t = 0; t < 20; t += 1 / 20) stepPed(p, 1 / 20, world);
    expect(['walk', 'idle', 'cross']).toContain(p.mode);
  });

  it('los hostiles persiguen al jugador y se detienen a distancia de tiro', () => {
    const c = city();
    const rng = makeRng(8);
    const block = walkable(c)[10];
    const p = createPed(block, rng, { hostile: true, faction: 'parche', attackRange: 10 });
    p.mode = 'attack';
    // El jugador más adelante por el mismo andén.
    const [px, pz] = block.ring[p.corner];
    const world = makeWorld(c, rng, { player: { x: px, z: pz } });
    for (let t = 0; t < 20; t += 1 / 20) stepPed(p, 1 / 20, world);
    const d = Math.hypot(p.x - world.player.x, p.z - world.player.z);
    expect(d).toBeLessThanOrEqual(10.5);
    expect(p.speed).toBe(0);
  });

  it('los muertos no se mueven', () => {
    const c = city();
    const rng = makeRng(9);
    const p = createPed(walkable(c)[0], rng);
    p.mode = 'dead';
    const x = p.x;
    stepPed(p, 1, makeRng(1) && makeWorld(c, rng));
    expect(p.x).toBe(x);
  });

  it('las esquinas del anillo peatonal quedan sobre el andén', () => {
    let bad = 0;
    let n = 0;
    for (const b of walkable(city())) {
      for (const k of ringCorners(b)) {
        n++;
        if (!onBlock(k.x, k.z)) bad++;
      }
    }
    // Algunas esquinas muy cerradas quedan a ras de la calzada.
    expect(bad / n).toBeLessThan(0.06);
  });
});
