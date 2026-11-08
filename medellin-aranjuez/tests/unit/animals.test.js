import { describe, expect, it } from 'vitest';
import {
  ANIMAL_BUDGETS,
  ANIMAL_KINDS,
  ANIMAL_MAX,
  AnimalSim,
  CROSS_MAX,
  MIN_SEPARATION,
  RAT_HOME,
  SPAWN_MIN_DIST,
  SPAWN_VIEW_DIST,
  SPECIES,
  STREET_EDGE,
  VIEW_COS,
  WALL_EDGE,
  animalBudget,
  ratHours,
  sidewalkPoints,
} from '../../src/sim/animals.js';
import { GRID, groundHeight, onRoad } from '../../src/sim/terrain.js';
import { city } from './helpers.js';

// Todo sobre la ciudad real: el grafo del andén sale de sus manzanas.
const C = city();
const nodes = sidewalkPoints(C);
const trash = C.props.filter((q) => q.type === 'trashbag').map((q) => ({ x: q.x, z: q.z }));
const blocked = (x, z) => C.collision.pointBlocked(x, z, groundHeight(x, z) + 0.25);
const sim = (seed = 3) => new AnimalSim({ sidewalk: nodes, trash, groundHeight, blocked, seed });
const TAU = Math.PI * 2;

// Distancia de (x, z) al anillo del andén (el centro del andén), con una grilla de nodos.
const G = 10;
const grid = new Map();
nodes.forEach((n, i) => {
  const k = Math.floor(n.x / G) * 100003 + Math.floor(n.z / G);
  if (!grid.has(k)) grid.set(k, []);
  grid.get(k).push(i);
});
function ringDist(x, z) {
  let best = Infinity;
  for (let i = Math.floor(x / G) - 1; i <= Math.floor(x / G) + 1; i++)
    for (let j = Math.floor(z / G) - 1; j <= Math.floor(z / G) + 1; j++)
      for (const k of grid.get(i * 100003 + j) ?? []) {
        const a = nodes[k];
        const b = nodes[a.next];
        const ex = b.x - a.x;
        const ez = b.z - a.z;
        const t = Math.max(0, Math.min(1, ((x - a.x) * ex + (z - a.z) * ez) / (ex * ex + ez * ez || 1)));
        best = Math.min(best, Math.hypot(x - a.x - ex * t, z - a.z - ez * t));
      }
  return best;
}
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
// El jugador parado en el andén cerca del punto de salida; la cámara mira hacia +x.
const P0 = nodes[nearestNode(C.spawn.x, C.spawn.z)];
const P = { x: P0.x, z: P0.z };
const ULTRA = animalBudget(56);
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
// Medio ancho del andén de verdad, del centro al sardinel o a la fachada.
const ANDEN = Math.min(GRID.ring, GRID.sidewalk - GRID.ring);

describe('animales de la calle', () => {
  it('pocos, según la calidad, y con tope', () => {
    expect(animalBudget(24)).toEqual({ total: 4, perro: 2, gato: 1, rata: 2 });
    expect(animalBudget(34)).toEqual({ total: 6, perro: 3, gato: 1, rata: 3 });
    expect(animalBudget(44)).toEqual({ total: 8, perro: 3, gato: 2, rata: 4 });
    expect(animalBudget(56)).toEqual({ total: 10, perro: 4, gato: 2, rata: 5 });
    for (const b of ANIMAL_BUDGETS) for (const k of ANIMAL_KINDS) expect(animalBudget(b.peds)[k]).toBeLessThanOrEqual(ANIMAL_MAX[k]);
    expect(ratHours(22)).toBe(true);
    expect(ratHours(3)).toBe(true);
    expect(ratHours(12)).toBe(false);
  });

  it('el grafo del andén: anillos cerrados entre el sardinel y las casas, esquinas y cruces cortos', () => {
    expect(nodes.length).toBeGreaterThan(1000);
    let corners = 0;
    let crosses = 0;
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i];
      expect(nodes[a.next].prev).toBe(i);
      expect(Math.hypot(nodes[a.next].x - a.x, nodes[a.next].z - a.z)).toBeLessThan(7.5);
      expect(Math.hypot(a.nx, a.nz)).toBeCloseTo(1, 3);
      if (a.corner) corners++;
      for (const j of a.cross ?? []) {
        crosses++;
        expect(a.corner).toBe(1);
        expect(nodes[j].block).not.toBe(a.block);
        expect(Math.hypot(nodes[j].x - a.x, nodes[j].z - a.z)).toBeLessThan(CROSS_MAX);
      }
    }
    // Todo el ancho por donde andan es andén: ni calzada (hasta `out`, que se encoge donde
    // la vía se come el borde) ni dentro de las casas; y casi siempre queda andén de sobra.
    let road = 0;
    let narrow = 0;
    let n = 0;
    for (let i = 0; i < nodes.length; i += 7) {
      const a = nodes[i];
      n++;
      if (a.out < 0.4) narrow++;
      expect(a.out).toBeLessThanOrEqual(STREET_EDGE);
      for (const lat of [-a.out, 0, WALL_EDGE]) if (onRoad(a.x + a.nx * lat, a.z + a.nz * lat)) road++;
    }
    expect(road / n).toBeLessThan(0.002);
    expect(narrow / n).toBeLessThan(0.01);
    expect(corners).toBeGreaterThan(100);
    expect(crosses).toBeGreaterThan(50);
  });

  it('siempre sobre el andén (salvo un perro cruzando por la esquina), sin arrancar, frenar ni girar en seco, y sin patinar', () => {
    const s = sim(5);
    const prev = new Map();
    const st = { frames: 0, off: 0, road: 0, crosses: 0, maxCrossT: 0, dv: 0, dyaw: 0, skate: 0, strideBad: 0 };
    const dt = 0.05;
    let px = P.x;
    let pz = P.z;
    let at = 0;
    // 12 minutos (de día y de noche), el jugador cambiando de sitio, tiros de vez en cuando y la cámara girando.
    run(s, 720, (t) => {
      if (Math.floor(t / 120) !== at) {
        at = Math.floor(t / 120);
        const q = nodes[(at * 997) % nodes.length];
        px = q.x;
        pz = q.z;
      }
      if (t % 45 < dt) s.alarm(px + 15, pz, 30);
      return { ...ctx({ focus: { x: px, z: pz }, player: { x: px, z: pz, speed: 0, inVehicle: false }, view: { x: px, z: pz, fx: Math.cos(t * 0.1), fz: Math.sin(t * 0.1) } }), hour: t < 360 ? 11 : 23 };
    }, dt, (sm) => {
      for (const a of sm.list) {
        st.frames++;
        if (a.mode !== 'cross') {
          if (ringDist(a.x, a.z) > ANDEN) {
            st.off++;
            if (st.off < 6) (st.offInfo ??= []).push([a.kind, a.mode, a.act, ringDist(a.x, a.z).toFixed(2), a.lat.toFixed(2), a.speed.toFixed(2), nodes[a.node].corner, a.node].join(':'));
          }
          if (onRoad(a.x, a.z)) st.road++;
        } else st.maxCrossT = Math.max(st.maxCrossT, a.crossT);
        const p = prev.get(a.id);
        if (p) {
          if (p.mode !== 'cross' && a.mode === 'cross') {
            st.crosses++;
            // Cruza desde una esquina con cruce, hacia la manzana de enfrente, y solo los perros.
            expect(a.kind).toBe('perro');
            expect(nodes[a.node].corner).toBe(1);
            expect(nodes[a.node].cross).toContain(a.crossTo);
          }
          const sp = SPECIES[a.kind];
          st.dv = Math.max(st.dv, Math.abs(a.speed - p.speed) / (2 * Math.max(sp.bolt, sp.brake) * dt));
          st.dyaw = Math.max(st.dyaw, Math.abs(Math.atan2(Math.sin(a.yaw - p.yaw), Math.cos(a.yaw - p.yaw))) / (sp.turn[1] * dt));
          // La fase del paso avanza con lo que de verdad se movió: quieto no da pasos y la zancada es la de la especie.
          const moved = a.vel * dt;
          const dph = (a.phase - p.phase + TAU) % TAU;
          if (moved < 1e-6 && dph > 1e-6) st.skate++;
          if (moved > 1e-3 && dph > 1e-4) {
            const stride = (TAU * moved) / dph;
            if (stride < sp.stride[0] * a.scale * 0.99 || stride > sp.stride[1] * a.scale * 1.01) st.strideBad++;
          }
        }
        prev.set(a.id, { mode: a.mode, speed: a.speed, yaw: a.yaw, phase: a.phase });
      }
    });
    expect(st.frames).toBeGreaterThan(20000);
    expect(st.offInfo ?? []).toEqual([]);
    expect(st.off).toBe(0);
    expect(st.road).toBe(0);
    expect(st.crosses).toBeGreaterThan(0);
    expect(st.maxCrossT).toBeLessThan(12); // nunca quedan en la calle más de lo que dura un cruce
    expect(st.dv).toBeLessThanOrEqual(1.0001);
    expect(st.dyaw).toBeLessThanOrEqual(1.0001);
    expect(st.skate).toBe(0);
    expect(st.strideBad).toBe(0);
  });

  it('aparecen lejos o a la espalda, separados, y nunca pasan del cupo', () => {
    const s = sim(7);
    const seen = new Set();
    let spawns = 0;
    const view = { x: P.x, z: P.z, fx: 1, fz: 0 };
    run(s, 120, ctx({ view }), 0.1, (sm) => {
      const c = sm.counts();
      for (const k of ANIMAL_KINDS) expect(c[k]).toBeLessThanOrEqual(ULTRA[k]);
      expect(sm.list.length).toBeLessThanOrEqual(ULTRA.total);
      for (const a of sm.list) {
        if (seen.has(a.id)) continue;
        seen.add(a.id);
        spawns++;
        const d = Math.hypot(a.x - P.x, a.z - P.z);
        expect(d).toBeGreaterThanOrEqual(SPAWN_MIN_DIST - 1);
        const front = ((a.x - view.x) * view.fx + (a.z - view.z) * view.fz) / d > VIEW_COS;
        if (front) expect(d).toBeGreaterThanOrEqual(SPAWN_VIEW_DIST - 1);
        for (const b of sm.list) if (b !== a) expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThanOrEqual(MIN_SEPARATION - 1);
      }
    });
    expect(spawns).toBeGreaterThanOrEqual(ULTRA.perro + ULTRA.gato);
    // De día no hay ratas.
    expect(s.counts().rata).toBe(0);
    // En Baja, menos.
    const b = sim(7);
    run(b, 60, ctx({ budget: animalBudget(24) }), 0.1);
    expect(b.counts()).toEqual({ perro: 2, gato: 1, rata: 0 });
  });

  it('de noche salen las ratas, junto a la basura y pegadas a la pared; al amanecer se van', () => {
    const s = sim(5);
    let far = 0;
    let lat = 0;
    let n = 0;
    run(s, 80, ctx({ hour: 23 }), 0.1, (sm) => {
      for (const r of sm.list) {
        if (r.kind !== 'rata') continue;
        if (!trash.some((t) => Math.hypot(t.x - r.x, t.z - r.z) < RAT_HOME + 5)) far++;
        lat += r.lat;
        n++;
      }
    });
    expect(s.list.filter((a) => a.kind === 'rata').length).toBeGreaterThan(0);
    expect(far).toBe(0);
    expect(lat / n).toBeGreaterThan(0.6); // casi siempre del lado de las casas
    run(s, 6, ctx({ hour: 9, focus: { x: P.x + 1000, z: P.z } }), 0.6);
    expect(s.counts().rata).toBe(0);
  });

  it('con un tiro salen corriendo por el andén, acelerando (no de una) y bajando el ritmo', () => {
    const s = sim(11);
    run(s, 20, ctx());
    expect(s.list.length).toBeGreaterThan(0);
    const before = new Map(s.list.map((a) => [a.id, a.speed]));
    s.alarm(P.x, P.z, 400);
    s.update(0.05, ctx());
    expect(s.list.every((a) => a.mode === 'flee')).toBe(true);
    for (const a of s.list) expect(a.speed - before.get(a.id)).toBeLessThanOrEqual(SPECIES[a.kind].bolt * 0.05 + 1e-9);
    const dog = s.list.find((a) => a.kind === 'perro');
    let top = 0;
    let gait = 0;
    run(s, 1.5, ctx(), 0.05, () => {
      top = Math.max(top, dog.speed);
      gait = Math.max(gait, dog.gait);
    });
    expect(top).toBeGreaterThan(SPECIES.perro.trot[1]); // a la carrera
    expect(gait).toBeGreaterThan(1.5);
    run(s, 12, ctx());
    expect(dog.mode).not.toBe('flee');
    expect(ringDist(dog.x, dog.z)).toBeLessThan(ANDEN);
  });

  it('el gato sentado sale disparado si uno se le arrima, y el perro mira al jugador', () => {
    const s = sim(12);
    const cat = s.spawnAt('gato', P.x, P.z, { mode: 'rest', rest: 1, timer: 30 });
    expect(cat).toBeTruthy();
    s.update(0.05, ctx({ player: { x: cat.x + 2, z: cat.z, speed: 1.4, inVehicle: false } }));
    expect(cat.mode).toBe('flee');
    const q = nodes[nearestNode(P.x + 60, P.z)];
    const dog = s.spawnAt('perro', q.x, q.z, { mode: 'rest', rest: 1, timer: 30 });
    const player = { x: dog.x + 6 * Math.sin(dog.yaw + 0.9), z: dog.z + 6 * Math.cos(dog.yaw + 0.9), speed: 0, inVehicle: false };
    run(s, 1.5, ctx({ focus: player, player }));
    expect(dog.headYaw).toBeCloseTo(0.9, 1);
  });

  it('se sientan o se echan de a poco, y al caminar se paran', () => {
    const s = sim(14);
    const a = s.spawnAt('perro', P.x, P.z, { mode: 'rest', rest: 2, timer: 50 });
    a.pose = 0;
    const far = ctx({ player: null });
    s.update(0.1, far);
    expect(a.pose).toBeGreaterThan(0);
    expect(a.pose).toBeLessThan(1);
    run(s, 2, far, 0.1);
    expect(a.pose).toBeCloseTo(2, 5);
    expect(a.speed).toBe(0);
  });

  it('ningún perro cruza con un carro cerca', () => {
    // Un carro quieto en la mitad de cada cruce del barrio.
    const vehicles = [];
    for (const a of nodes) for (const j of a.cross ?? []) vehicles.push({ x: (a.x + nodes[j].x) / 2, z: (a.z + nodes[j].z) / 2, speed: 0 });
    const s = sim(5);
    let crosses = 0;
    run(s, 300, ctx({ vehicles }), 0.1, (sm) => {
      for (const a of sm.list) if (a.mode === 'cross') crosses++;
    });
    expect(crosses).toBe(0);
  });

  it('los perros le ladran al que pasa cerca', () => {
    const s = sim(15);
    const q = nodes[nearestNode(P.x + 60, P.z)];
    const dog = s.spawnAt('perro', q.x, q.z, { mode: 'rest', rest: 1, timer: 999 });
    const at = (d) => ({ x: dog.x + d, z: dog.z, speed: 0, inVehicle: true });
    const far = run(s, 60, ctx({ focus: at(30), player: at(30) }), 0.1).filter((e) => e.kind === 'ladrido');
    const near = run(s, 60, ctx({ focus: at(6), player: at(6) }), 0.1).filter((e) => e.kind === 'ladrido');
    expect(near.length).toBeGreaterThan(far.length);
  });

  it('lejos del jugador desaparecen', () => {
    const s = sim(13);
    run(s, 20, ctx(), 0.1);
    expect(s.list.length).toBeGreaterThan(0);
    s.update(0.6, ctx({ focus: { x: P.x + 5000, z: P.z } }));
    expect(s.list.length).toBe(0);
  });

  it('es determinista', () => {
    const snap = (s) => s.list.map((a) => [a.kind, a.x.toFixed(5), a.z.toFixed(5), a.yaw.toFixed(5), a.mode, a.pose.toFixed(4)].join(':')).join('|');
    const a = sim(21);
    const b = sim(21);
    const c = (t) => ctx({ hour: t < 30 ? 11 : 23 });
    run(a, 60, c);
    run(b, 60, c);
    expect(snap(a)).toBe(snap(b));
    expect(snap(a).length).toBeGreaterThan(0);
  });
});
