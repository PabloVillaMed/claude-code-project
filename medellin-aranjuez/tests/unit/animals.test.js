import { describe, expect, it } from 'vitest';
import { AnimalSim, SPECIES, animalBudget, ratHours, sidewalkPoints } from '../../src/sim/animals.js';
import { generateCity } from '../../src/sim/cityLayout.js';

// Una calle de prueba: andén cada 5 m en una franja de 200 m, bolsas de basura
// cada 15 m y una pared en x > 60 (ahí no se puede entrar).
const sidewalk = [];
for (let x = -100; x <= 100; x += 5) for (const z of [-4, 4]) sidewalk.push({ x, z });
const trash = [];
for (let x = -90; x <= 90; x += 15) trash.push({ x, z: 5 });
const wall = (x) => x > 60;
const sim = (seed = 3) => new AnimalSim({ sidewalk, trash, groundHeight: () => 0, blocked: (x) => wall(x), seed });
const run = (s, seconds, ctx, dt = 0.1) => {
  const events = [];
  for (let t = 0; t < seconds; t += dt) {
    s.update(dt, ctx);
    events.push(...s.events);
  }
  return events;
};
const DAY = { focus: { x: 0, z: 0 }, hour: 11, budget: animalBudget(44) };

describe('animales de la calle', () => {
  it('pocos, según la calidad', () => {
    const b = animalBudget(24);
    const u = animalBudget(56);
    expect(b.perro + b.gato + b.rata).toBeLessThan(12);
    expect(u.perro).toBeGreaterThan(b.perro);
    expect(ratHours(22)).toBe(true);
    expect(ratHours(3)).toBe(true);
    expect(ratHours(12)).toBe(false);
  });

  it('aparecen en el andén, ni muy cerca ni muy lejos, y de día no hay ratas', () => {
    const s = sim();
    run(s, 15, DAY);
    const c = s.counts();
    expect(c.perro).toBe(DAY.budget.perro);
    expect(c.gato).toBe(DAY.budget.gato);
    expect(c.rata).toBe(0);
    for (const a of s.list) {
      expect(wall(a.x)).toBe(false);
      expect(Math.hypot(a.x, a.z)).toBeLessThan(100);
    }
  });

  it('de noche salen las ratas, junto a la basura', () => {
    const s = sim(5);
    s.update(0.6, { ...DAY, hour: 23 });
    for (let i = 0; i < 40; i++) s.update(0.6, { ...DAY, hour: 23 });
    const rats = s.list.filter((a) => a.kind === 'rata');
    expect(rats.length).toBe(DAY.budget.rata);
    // Al aparecer estaban a menos de 1,5 m de una bolsa (después se mueven entre ellas).
    expect(rats.every((r) => trash.some((t) => Math.abs(t.x - r.x) < 40))).toBe(true);
    // Al amanecer se van las que no están junto al jugador.
    for (let i = 0; i < 10; i++) s.update(0.6, { ...DAY, hour: 9, focus: { x: 1000, z: 0 } });
    expect(s.counts().rata).toBe(0);
  });

  it('nunca se meten a la pared aunque caminen y huyan', () => {
    const s = sim(9);
    run(s, 60, { ...DAY, focus: { x: 40, z: 0 } });
    s.alarm(40, 0, 80);
    run(s, 10, { ...DAY, focus: { x: 40, z: 0 } });
    for (const a of s.list) expect(wall(a.x), `${a.kind} en x=${a.x.toFixed(1)}`).toBe(false);
  });

  it('salen corriendo con un tiro y con el jugador encima', () => {
    const s = sim(11);
    run(s, 10, DAY);
    s.alarm(0, 0, 200);
    s.update(0.1, DAY);
    expect(s.list.every((a) => a.mode === 'flee')).toBe(true);
    expect(s.list.every((a) => a.speed === SPECIES[a.kind].flee)).toBe(true);
    // El gato huye del que se le arrima caminando.
    const t = sim(12);
    run(t, 10, DAY);
    const cat = t.list.find((a) => a.kind === 'gato');
    run(t, 6, DAY); // se calma
    cat.mode = 'rest';
    cat.timer = 30;
    t.update(0.1, { ...DAY, player: { x: cat.x + 1, z: cat.z, speed: 1.4, inVehicle: false } });
    expect(cat.mode).toBe('flee');
  });

  it('lejos del jugador desaparecen', () => {
    const s = sim(13);
    run(s, 10, DAY);
    expect(s.list.length).toBeGreaterThan(0);
    s.update(0.6, { ...DAY, focus: { x: 5000, z: 0 } });
    expect(s.list.length).toBe(0);
  });

  it('se sientan o se echan de a poco, y al caminar se paran', () => {
    const s = sim(14);
    run(s, 4, DAY);
    const a = s.list.find((q) => q.kind === 'perro');
    a.mode = 'rest';
    a.timer = 50;
    a.speed = 0;
    a.rest = 2;
    a.pose = 0;
    s.update(0.1, DAY);
    expect(a.pose).toBeGreaterThan(0);
    expect(a.pose).toBeLessThan(1);
    run(s, 2, DAY);
    expect(a.pose).toBeCloseTo(2, 5);
  });

  it('los perros le ladran al que pasa cerca', () => {
    const s = sim(15);
    run(s, 5, DAY);
    const dog = s.list.find((q) => q.kind === 'perro');
    const ev = run(s, 60, { ...DAY, player: { x: dog.x + 30, z: dog.z, speed: 0, inVehicle: true } }).filter((e) => e.kind === 'ladrido');
    const near = run(s, 60, { ...DAY, player: { x: dog.x + 6, z: dog.z, speed: 0, inVehicle: true } }).filter((e) => e.kind === 'ladrido');
    expect(near.length).toBeGreaterThan(ev.length);
  });

  it('en la ciudad real hay andén de sobra para pasearse', () => {
    const pts = sidewalkPoints(generateCity(4));
    expect(pts.length).toBeGreaterThan(3000);
  });
});
