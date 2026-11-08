import { describe, expect, it } from 'vitest';
import {
  ANIMAL_HEALTH,
  ANIMAL_HITBOX,
  ANIMAL_RAY,
  AnimalSim,
  CORPSE_MIN_TIME,
  CORPSE_UNSEEN_TIME,
  DEATH_ALARM_RADIUS,
  DEATH_BLEND,
  LIMP_SPEED,
  LIMP_TIME,
  RUNOVER_DAMAGE,
  SPECIES,
  animalBudget,
  rayVsAnimal,
  sidewalkPoints,
} from '../../src/sim/animals.js';
import { traceShot } from '../../src/sim/ballistics.js';
import { groundHeight } from '../../src/sim/terrain.js';
import { city } from './helpers.js';

// Golpes, heridas y muerte de los animales, sobre la ciudad real (como animals.test.js).
const C = city();
const nodes = sidewalkPoints(C);
const trash = C.props.filter((q) => q.type === 'trashbag').map((q) => ({ x: q.x, z: q.z }));
const blocked = (x, z) => C.collision.pointBlocked(x, z, groundHeight(x, z) + 0.25);
const sim = (seed = 3) => new AnimalSim({ sidewalk: nodes, trash, groundHeight, blocked, seed });
const nearestNode = (x, z) => {
  let best = 0;
  let bd = Infinity;
  nodes.forEach((n, i) => {
    const d = Math.hypot(n.x - x, n.z - z);
    if (d < bd) {
      bd = d;
      best = i;
    }
  });
  return best;
};
const P0 = nodes[nearestNode(C.spawn.x, C.spawn.z)];
const P = { x: P0.x, z: P0.z };
const ULTRA = animalBudget(56);
// La cámara mira hacia +x desde el jugador; `look` la voltea hacia un punto.
const ctx = (extra = {}) => ({ focus: P, player: { x: P.x, z: P.z, speed: 0, inVehicle: false }, hour: 11, budget: ULTRA, view: { x: P.x, z: P.z, fx: 1, fz: 0 }, vehicles: [], ...extra });
const run = (s, seconds, c, dt = 0.05, each = null) => {
  const events = [];
  for (let t = 0; t < seconds; t += dt) {
    s.update(dt, typeof c === 'function' ? c(t) : c);
    events.push(...s.events);
    if (each) each(s, t);
  }
  return events;
};
// Un animal quieto en el andén, `n` nodos (~3 m cada uno) más allá del jugador, para dispararle.
const along = (n) => {
  let i = nearestNode(P.x, P.z);
  for (let k = 0; k < n; k++) i = nodes[i].next;
  return nodes[i];
};
const still = (s, kind, n = 2) => s.spawnAt(kind, along(n).x, along(n).z, { mode: 'rest', rest: 0, timer: 999 });
// La cámara desde el jugador mirando hacia el animal (sign 1) o de espaldas (-1).
const viewTo = (a, sign = 1) => {
  const d = Math.hypot(a.x - P.x, a.z - P.z);
  return { x: P.x, z: P.z, fx: (sign * (a.x - P.x)) / d, fz: (sign * (a.z - P.z)) / d };
};

describe('caja de impacto de los animales', () => {
  it('tiene el tamaño de cada especie (perro ~0,6 m, gato ~0,3, rata ~0,12)', () => {
    const top = (k) => Math.max(ANIMAL_HITBOX[k].h, ANIMAL_HITBOX[k].head[0] + ANIMAL_HITBOX[k].head[2]);
    expect(top('perro')).toBeGreaterThan(0.55);
    expect(top('perro')).toBeLessThan(0.8);
    expect(top('gato')).toBeGreaterThan(0.28);
    expect(top('gato')).toBeLessThan(0.45);
    expect(top('rata')).toBeGreaterThan(0.09);
    expect(top('rata')).toBeLessThan(0.16);
  });

  it('el rayo le pega al tronco y a la cabeza, y no pasa por encima ni al lado', () => {
    const a = { kind: 'perro', x: 10, y: 0, z: 0, yaw: 0, scale: 1 }; // mira hacia +z
    const hb = ANIMAL_HITBOX.perro;
    // De lado, a la altura del lomo: tronco.
    const t = rayVsAnimal(0, 0.35, 0, 1, 0, 0, a, 50);
    expect(t).toBeCloseTo(10 - hb.r, 2);
    expect(ANIMAL_RAY.head).toBe(false);
    // A la altura de la cabeza, por donde está la cabeza (adelante): cabeza.
    const th = rayVsAnimal(0, hb.head[0], hb.head[1], 1, 0, 0, a, 50);
    expect(th).not.toBeNull();
    expect(ANIMAL_RAY.head).toBe(true);
    // Por encima del lomo (en el medio) o un metro al lado: nada.
    expect(rayVsAnimal(0, 0.9, 0, 1, 0, 0, a, 50)).toBeNull();
    expect(rayVsAnimal(0, 0.35, 1, 1, 0, 0, a, 50)).toBeNull();
    // Más lejos que maxDist: nada.
    expect(rayVsAnimal(0, 0.35, 0, 1, 0, 0, a, 5)).toBeNull();
    // Girado 90°, a lo largo: el elipsoide es más largo que ancho.
    const b = { ...a, yaw: Math.PI / 2 };
    expect(rayVsAnimal(0, 0.3, 0, 1, 0, 0, b, 50)).toBeLessThan(10 - hb.r - 0.1);
    // La escala lo agranda.
    expect(rayVsAnimal(0, 0.35, 0, 1, 0, 0, { ...a, scale: 1.2 }, 50)).toBeLessThan(t);
  });

  it('la rata es chiquita: a 10 cm del piso le pega, a 25 cm no', () => {
    const a = { kind: 'rata', x: 5, y: 0, z: 0, yaw: 0, scale: 1 };
    expect(rayVsAnimal(0, 0.05, 0, 1, 0, 0, a, 50)).not.toBeNull();
    expect(rayVsAnimal(0, 0.25, 0, 1, 0, 0, a, 50)).toBeNull();
  });

  it('traceShot devuelve el animal (y los muertos no estorban)', () => {
    const s = sim(5);
    const dog = still(s, 'perro');
    const scene = { collision: { raycast: () => null }, groundHeight: () => -10, characters: [], vehicles: [], animals: s.list };
    const o = { x: dog.x - 5, y: dog.y + 0.35, z: dog.z };
    const hit = traceShot(o, { x: 1, y: 0, z: 0 }, 20, scene);
    expect(hit.kind).toBe('animal');
    expect(hit.ref).toBe(dog);
    expect(hit.t).toBeLessThan(5);
    s.damage(dog, 999, o.x, o.z);
    const miss = traceShot(o, { x: 1, y: 0, z: 0 }, 20, scene);
    expect(miss.kind).not.toBe('animal');
  });
});

describe('heridas y muerte', () => {
  it('cada especie tiene su salud: herido sigue vivo, huye y cojea', () => {
    const s = sim(7);
    const dog = still(s, 'perro');
    expect(dog.health).toBe(ANIMAL_HEALTH.perro);
    expect(s.damage(dog, 20, P.x, P.z)).toBe('hurt');
    expect(dog.health).toBe(ANIMAL_HEALTH.perro - 20);
    expect(dog.mode).toBe('flee');
    expect(dog.limpT).toBe(LIMP_TIME);
    // Huye más despacio que uno sano (va a LIMP_SPEED de su velocidad).
    let top = 0;
    run(s, 2, ctx(), 0.05, () => (top = Math.max(top, dog.speed)));
    expect(top).toBeLessThan(SPECIES.perro.run * LIMP_SPEED + 0.01);
    expect(top).toBeGreaterThan(1);
    // Se queja (al siguiente cuadro, porque el golpe llegó desde afuera).
    const s2 = sim(7);
    const d2 = still(s2, 'perro');
    s2.damage(d2, 10, P.x, P.z);
    s2.update(0.05, ctx());
    expect(s2.events.some((e) => e.kind === 'gemido')).toBe(true);
  });

  it('al morir queda echado de lado (transición corta), quieto, y los de cerca huyen', () => {
    const s = sim(9);
    const dog = still(s, 'perro');
    const cat = s.spawnAt('gato', dog.x + 4, dog.z, { mode: 'rest', rest: 1, timer: 999 });
    expect(Math.hypot(cat.x - dog.x, cat.z - dog.z)).toBeLessThan(DEATH_ALARM_RADIUS);
    expect(s.damage(dog, ANIMAL_HEALTH.perro, P.x, P.z)).toBe('dead');
    expect(dog.mode).toBe('dead');
    expect(dog.dead).toBe(0);
    s.update(DEATH_BLEND / 2, ctx());
    expect(dog.dead).toBeGreaterThan(0.3);
    expect(dog.dead).toBeLessThan(0.7);
    const x = dog.x;
    const z = dog.z;
    run(s, 3, ctx());
    expect(dog.dead).toBe(1);
    expect(dog.x).toBe(x);
    expect(dog.z).toBe(z);
    expect(dog.amp).toBeLessThan(0.01);
    expect(Math.abs(dog.side)).toBe(1);
    expect(cat.mode).not.toBe('rest'); // salió corriendo
    // Ya muerto no recibe más daño.
    expect(s.damage(dog, 50, P.x, P.z)).toBeNull();
  });

  it('cae para el lado contrario del golpe', () => {
    const s = sim(9);
    const dog = still(s, 'perro');
    const rx = Math.cos(dog.yaw);
    const rz = -Math.sin(dog.yaw);
    s.damage(dog, 999, dog.x - rx * 5, dog.z - rz * 5); // golpe desde su izquierda
    expect(dog.side).toBe(1); // queda sobre su derecha
  });

  it('el cuerpo cuenta para el tope y desaparece cuando lleva rato sin verse', () => {
    const s = sim(11);
    const dog = still(s, 'perro', 3);
    s.damage(dog, 999, P.x, P.z);
    // Mirándolo: no se va aunque pase el tiempo.
    const looking = ctx({ view: viewTo(dog) });
    run(s, CORPSE_MIN_TIME + CORPSE_UNSEEN_TIME + 5, looking, 0.1);
    expect(s.list).toContain(dog);
    expect(dog.unseenT).toBe(0);
    // Sigue contando para el cupo de perros.
    expect(s.counts().perro).toBeLessThanOrEqual(ULTRA.perro);
    // De espaldas: a los CORPSE_UNSEEN_TIME (y medio segundo de la revisión) ya no está.
    const away = ctx({ view: viewTo(dog, -1) });
    run(s, CORPSE_UNSEEN_TIME - 0.5, away, 0.1);
    expect(s.list).toContain(dog);
    run(s, 1.5, away, 0.1);
    expect(s.list).not.toContain(dog);
  });

  it('no se va antes de CORPSE_MIN_TIME aunque no se vea', () => {
    const s = sim(11);
    const dog = still(s, 'perro', 3);
    s.damage(dog, 999, P.x, P.z);
    const away = ctx({ view: viewTo(dog, -1) });
    run(s, CORPSE_MIN_TIME - 1, away, 0.1);
    expect(s.list).toContain(dog);
    run(s, 2, away, 0.1);
    expect(s.list).not.toContain(dog);
  });

  it('atropello: un carro rápido por encima mata a la rata; uno parado no', () => {
    const s = sim(13);
    const rat = s.spawnAt('rata', along(2).x, along(2).z, { mode: 'rest', timer: 999 });
    const car = { x: rat.x, z: rat.z, speed: 0, hx: 0.9, hz: 2.2, angle: 0, player: true };
    run(s, 0.3, ctx({ vehicles: [car], hour: 23 }));
    expect(rat.mode).not.toBe('dead');
    car.speed = 12;
    car.x = rat.x;
    car.z = rat.z;
    const ev = run(s, 0.1, ctx({ vehicles: [car], hour: 23 }));
    expect(rat.mode).toBe('dead');
    expect(rat.lastHit).toBe('impact');
    expect(rat.byPlayer).toBe(true);
    expect(ev.some((e) => e.kind === 'chillido')).toBe(true);
  });

  it('un perro atropellado despacio queda herido (una vez por pasada)', () => {
    const s = sim(13);
    const dog = still(s, 'perro');
    const v = 4; // m/s
    const car = { x: dog.x, z: dog.z, speed: v, hx: 0.9, hz: 2.2, angle: 0 };
    s.update(0.05, ctx({ vehicles: [car] }));
    expect(dog.mode).not.toBe('dead');
    expect(dog.health).toBeCloseTo(ANIMAL_HEALTH.perro - v * RUNOVER_DAMAGE, 6);
    car.x = dog.x;
    car.z = dog.z;
    s.update(0.05, ctx({ vehicles: [car] }));
    expect(dog.health).toBeCloseTo(ANIMAL_HEALTH.perro - v * RUNOVER_DAMAGE, 6);
  });

  it('golpe cuerpo a cuerpo: el animal de adelante y a la mano', () => {
    const s = sim(17);
    const cat = still(s, 'gato', 1);
    const x = cat.x - 1; // a un metro, mirando hacia +x
    expect(s.meleeTarget(x, cat.z, 1, 0, 1.9)?.a).toBe(cat);
    expect(s.meleeTarget(x, cat.z, -1, 0, 1.9)).toBeNull(); // de espaldas
    expect(s.meleeTarget(x, cat.z, 1, 0, 0.3)).toBeNull(); // muy lejos
  });

  it('explosión: mata a los de cerca', () => {
    const s = sim(19);
    const dog = still(s, 'perro');
    s.blast(dog.x + 1, dog.z, 9, 180);
    expect(dog.mode).toBe('dead');
  });

  it('es determinista con tiros, atropellos y cuerpos', () => {
    const snap = (s) => s.list.map((a) => [a.kind, a.x.toFixed(5), a.z.toFixed(5), a.mode, a.health.toFixed(3), a.dead.toFixed(4), a.side, a.limpT.toFixed(3)].join(':')).join('|');
    const go = () => {
      const s = sim(23);
      run(s, 0.05, ctx(), 0.05, (sm) => {
        if (!sm.list.some((a) => a.kind === 'perro')) still(sm, 'perro');
      });
      run(s, 40, (t) => ctx({ hour: t < 20 ? 11 : 23 }), 0.05, (sm, t) => {
        const a = sm.list[Math.floor(t * 7) % Math.max(1, sm.list.length)];
        if (a && Math.floor(t * 20) % 37 === 0) sm.damage(a, 15, P.x, P.z);
      });
      return s;
    };
    const a = go();
    const b = go();
    expect(snap(a)).toBe(snap(b));
    expect(a.list.some((x) => x.mode === 'dead' || x.limpT > 0 || x.health < ANIMAL_HEALTH[x.kind])).toBe(true);
  });
});
