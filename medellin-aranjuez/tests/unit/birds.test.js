import { describe, expect, it } from 'vitest';
import { BirdSim, MAX_BIRDS, parrotWindow, pigeonHomes, scareDistance, vultureCount } from '../../src/sim/birds.js';

const flat = () => 10;
const spots = (x, z) => Array.from({ length: 12 }, (_, i) => ({ x: x + Math.cos(i) * 4, z: z + Math.sin(i) * 4 }));
const make = () => new BirdSim({ homes: [{ id: 'plaza', x: 0, z: 0, spots: spots(0, 0) }], groundHeight: flat, seed: 3 });
const far = { x: 60, y: 10, z: 0, speed: 0, inVehicle: false };
const step = (sim, secs, ctx) => {
  for (let t = 0; t < secs; t += 1 / 30) sim.update(1 / 30, { hour: 12, vehicles: [], ...ctx });
};

describe('pájaros', () => {
  it('pocos: unas decenas como máximo', () => {
    expect(MAX_BIRDS).toBeLessThanOrEqual(64);
    expect(MAX_BIRDS).toBeGreaterThanOrEqual(24);
  });

  it('las palomas picotean en el piso si nadie las molesta', () => {
    const sim = make();
    step(sim, 10, { player: far });
    const f = sim.flocks[0];
    expect(f.active).toBe(true);
    expect(f.birds.length).toBeGreaterThanOrEqual(5);
    for (const b of f.birds) {
      expect(b.state).toBe('ground');
      expect(b.y).toBe(10);
      expect(Math.hypot(b.x, b.z)).toBeLessThan(6);
    }
  });

  it('se espantan cuando el jugador se acerca corriendo, dan vueltas y vuelven a bajar', () => {
    const sim = make();
    step(sim, 2, { player: far });
    const f = sim.flocks[0];
    const b0 = f.birds[0];
    step(sim, 0.2, { player: { x: b0.x + 2, y: 10, z: b0.z, speed: 6, inVehicle: false } });
    expect(f.state).toBe('fly');
    step(sim, 3, { player: { x: b0.x + 2, y: 10, z: b0.z, speed: 0, inVehicle: false } });
    expect(Math.max(...f.birds.map((b) => b.y))).toBeGreaterThan(14);
    // El jugador se va: vuelven a la plaza.
    step(sim, 40, { player: far });
    expect(f.state).toBe('ground');
    for (const b of f.birds) expect(b.y).toBe(10);
  });

  it('caminando despacio se puede llegar más cerca que corriendo', () => {
    expect(scareDistance(1.4, false)).toBeLessThan(scareDistance(6, false));
    expect(scareDistance(0, true)).toBeLessThan(scareDistance(10, true));
  });

  it('un tiro cerca las espanta aunque el jugador esté lejos', () => {
    const sim = make();
    step(sim, 1, { player: far });
    sim.alarm(20, 0);
    step(sim, 0.1, { player: far });
    expect(sim.flocks[0].state).toBe('fly');
    const sim2 = make();
    step(sim2, 1, { player: far });
    sim2.alarm(200, 0);
    step(sim2, 0.1, { player: far });
    expect(sim2.flocks[0].state).toBe('ground');
  });

  it('un carro que pasa rápido las espanta; uno parqueado no', () => {
    const sim = make();
    step(sim, 1, { player: far });
    const b = sim.flocks[0].birds[0];
    step(sim, 0.1, { player: far, vehicles: [{ x: b.x + 1, z: b.z, speed: 0 }] });
    expect(sim.flocks[0].state).toBe('ground');
    step(sim, 0.1, { player: far, vehicles: [{ x: b.x + 3, z: b.z, speed: 12 }] });
    expect(sim.flocks[0].state).toBe('fly');
  });

  it('lejos de las plazas no se simulan palomas', () => {
    const sim = make();
    step(sim, 1, { player: { x: 900, y: 10, z: 0, speed: 0 } });
    expect(sim.flocks[0].active).toBe(false);
    expect(sim.list.filter((b) => b.kind === 'paloma').length).toBe(0);
  });

  it('gallinazos de día, muy alto; de noche no hay', () => {
    expect(vultureCount(12)).toBeGreaterThan(3);
    expect(vultureCount(21)).toBe(0);
    const sim = make();
    step(sim, 2, { player: far, hour: 12 });
    expect(sim.vultures.length).toBe(vultureCount(12));
    for (const v of sim.vultures) expect(v.y).toBeGreaterThan(90);
    step(sim, 0.1, { player: far, hour: 22 });
    expect(sim.vultures.length).toBe(0);
  });

  it('loros al amanecer y al atardecer, que cruzan y se van', () => {
    expect(parrotWindow(6)).toBe(true);
    expect(parrotWindow(17.5)).toBe(true);
    expect(parrotWindow(12)).toBe(false);
    const sim = make();
    step(sim, 6, { player: far, hour: 17.5 });
    expect(sim.parrots.length).toBe(1);
    step(sim, 70, { player: far, hour: 12 });
    expect(sim.parrots.length).toBe(0);
  });

  it('puntos para las palomas: solo piso libre y parejo', () => {
    const pois = [
      { id: 'parque', x: 0, z: 0 },
      { id: 'iglesia', x: 500, z: 0 },
    ];
    const gh = (x) => (x > 400 ? x : 0); // la iglesia está en una pendiente imposible
    const homes = pigeonHomes(pois, gh, (x) => x > 5); // muro al oriente del parque
    expect(homes.map((h) => h.id)).toEqual(['parque']);
    for (const s of homes[0].spots) expect(s.x).toBeLessThanOrEqual(5);
  });
});
