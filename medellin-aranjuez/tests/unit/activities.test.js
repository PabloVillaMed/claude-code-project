import { describe, expect, it } from 'vitest';
import { ACTIVITY_COST, BALL, activitySpots, createBall, createMatch, chooseKick, facadePoint, fieldMatch, kickBall, nudgeBall, passPower, pickNearSpots, stepBall, stepMatch } from '../../src/sim/activities.js';
import { makeRng } from '../../src/sim/rng.js';

// Casa de prueba: fachada de 8 m sobre el eje x mirando a +z, con balcón en
// el segundo piso, puerta y local.
const face = { x0: 0, z0: 0, nx: 0, nz: 1, rx: 1, rz: 0, len: 8 };
function house(extra = {}) {
  return {
    face,
    floors: 3,
    floorH: 2.7,
    laundry: true,
    balconies: [{ floor: 1, u0: 2, u1: 6, v: 2.7 }],
    openings: [{ kind: 'door', floor: 0, u0: 1, u1: 1.9, v0: 0, v1: 2.1 }],
    shop: null,
    ...extra,
  };
}

describe('lugares de las actividades', () => {
  it('pone la ropa sobre la losa del balcón, frente a la cuerda', () => {
    // Muchas casas iguales: alguna saca la ropa (35 %).
    const buildings = Array.from({ length: 40 }, () => ({ groundY: 10 }));
    const spots = activitySpots({ buildings, props: [] }, { layoutOf: () => house(), edges: [] });
    const ropa = spots.filter((s) => s.kind === 'ropa');
    expect(ropa.length).toBeGreaterThan(5);
    for (const s of ropa) {
      expect(s.y).toBeCloseTo(10 + 2.7 + 0.03, 5); // encima de la losa
      expect(s.z).toBeGreaterThan(0.2); // afuera del muro...
      expect(s.z).toBeLessThan(0.95); // ...y antes de la baranda
      expect(s.x).toBeGreaterThan(2);
      expect(s.x).toBeLessThan(6);
      expect(s.line.az).toBeGreaterThan(s.z); // la cuerda, delante de ella
      expect(Math.cos(s.yaw)).toBeCloseTo(-1, 5); // mira a la calle (+z)
    }
  });

  it('no pone gente donde no se puede estar (calzada o muro)', () => {
    const buildings = Array.from({ length: 60 }, () => ({ groundY: 0 }));
    // Cada casa en su sitio (a 20 m de la anterior).
    const layoutOf = (b, i) => house({ face: { ...face, x0: i * 20 }, balconies: [], shop: { u0: 3, u1: 7 } });
    const all = activitySpots({ buildings, props: [] }, { layoutOf, edges: [] });
    expect(all.some((s) => s.kind === 'domino')).toBe(true);
    const none = activitySpots({ buildings, props: [] }, { layoutOf, edges: [], isFree: () => false });
    expect(none.filter((s) => s.kind !== 'ropa')).toHaveLength(0);
  });

  it('respeta las sillas del andén y separa las actividades', () => {
    const buildings = Array.from({ length: 60 }, () => ({ groundY: 0 }));
    const layoutOf = () => house({ balconies: [] });
    // Todas las casas en el mismo sitio: como mucho una actividad de primer piso.
    const spots = activitySpots({ buildings, props: [] }, { layoutOf, edges: [] });
    expect(spots.length).toBeLessThanOrEqual(1);
    const blocked = activitySpots({ buildings, props: [{ type: 'chair', x: 2.3, z: 0.4 }, { type: 'chair', x: 1.4, z: 0.9 }, { type: 'chair', x: 0.5, z: 0.4 }] }, { layoutOf, edges: [] });
    expect(blocked).toHaveLength(0);
  });

  it('arma partidos en canchas y en calles residenciales tranquilas', () => {
    const fr = { x: 5, z: 5, ux: 1, uz: 0, nx: 0, nz: 1, hu: 12, hv: 25 };
    const f = fieldMatch(fr, 'porteria');
    // El eje largo del campo es el de los arcos.
    expect(f.frame.hu).toBeCloseTo(23.5, 5);
    expect(f.frame.ux).toBe(0);
    expect(f.players).toBe(10);
    const edges = Array.from({ length: 200 }, (_, id) => ({ id, cls: 'residential', width: 7, pts: [[id * 100, 0], [id * 100 + 60, 0]] }));
    const spots = activitySpots({ buildings: [], props: [{ type: 'fieldPoly', frame: fr, placa: true }] }, { edges });
    const futbol = spots.filter((s) => s.kind === 'futbol');
    expect(futbol.find((s) => !s.street).goals).toBe('arquitos');
    const street = futbol.filter((s) => s.street);
    expect(street.length).toBeGreaterThan(2);
    expect(street.length).toBeLessThan(30);
    for (const s of street) {
      expect(s.frame.hv).toBeCloseTo(3.15, 5); // de andén a andén
      expect(s.frame.hu).toBeLessThanOrEqual(13);
    }
    // Avenidas y calles de una vía: no.
    const avenues = edges.map((e) => ({ ...e, cls: 'secondary' }));
    expect(activitySpots({ buildings: [], props: [] }, { edges: avenues })).toHaveLength(0);
  });

  it('elige los lugares más cercanos dentro del presupuesto', () => {
    const spots = [
      { kind: 'futbol', x: 10, z: 0 },
      { kind: 'fumar', x: 5, z: 0 },
      { kind: 'ropa', x: 30, z: 0 },
      { kind: 'futbol', x: 20, z: 0 },
      { kind: 'domino', x: 200, z: 0 },
    ];
    const got = pickNearSpots(spots, 0, 0, 60, 12);
    expect(got.map((s) => s.kind)).toEqual(['fumar', 'futbol', 'ropa']);
    // Lo que ya está en escena cuenta en el presupuesto.
    const active = new Set([spots[1], spots[0]]);
    expect(pickNearSpots(spots, 0, 0, 60, 10, { active }).map((s) => s.kind)).toEqual(['ropa']);
    expect(pickNearSpots(spots, 0, 0, 60, 30, { maxMatches: 2 }).filter((s) => s.kind === 'futbol')).toHaveLength(2);
    expect(ACTIVITY_COST.futbol).toBeGreaterThan(ACTIVITY_COST.fumar);
  });

  it('facadePoint va a lo largo del frente y hacia la calle', () => {
    expect(facadePoint(face, 3, 1)).toEqual({ x: 3, z: 1 });
  });
});

describe('balón', () => {
  const field = { hu: 20, hv: 10, goalW: 2, goalH: 2 };

  it('cae, rebota cada vez menos y se queda en el piso', () => {
    const b = createBall(0, 0);
    b.y = 2;
    let bounces = 0;
    let prevVy = 0;
    let maxAfter = 0;
    for (let i = 0; i < 400; i++) {
      stepBall(b, 1 / 60, field);
      if (prevVy < 0 && b.vy > 0) bounces++;
      if (bounces >= 1) maxAfter = Math.max(maxAfter, b.y);
      prevVy = b.vy;
    }
    expect(bounces).toBeGreaterThanOrEqual(2);
    expect(maxAfter).toBeLessThan(2 * BALL.bounce * BALL.bounce + 0.2);
    expect(b.y).toBeCloseTo(BALL.r, 5);
    expect(b.vy).toBe(0);
  });

  it('rueda y se frena por rozamiento', () => {
    const b = createBall(-15, 0);
    kickBall(b, 0, 0, 6, 0);
    let t = 0;
    while (Math.hypot(b.vu, b.vv) > 0 && t < 30) {
      stepBall(b, 1 / 60, field);
      t += 1 / 60;
    }
    expect(t).toBeLessThan(15);
    expect(b.u).toBeGreaterThan(-15 + 3);
    expect(b.u).toBeLessThan(20);
  });

  it('un pase de passPower(d) llega más o menos a d', () => {
    for (const d of [5, 10, 18]) {
      const b = createBall(-19, 0);
      kickBall(b, 0, 0, passPower(d), 0);
      for (let i = 0; i < 60 * 20; i++) stepBall(b, 1 / 60, { hu: 100, hv: 10 });
      expect(b.u + 19).toBeGreaterThan(d * 0.9);
      expect(b.u + 19).toBeLessThan(d * 2.2);
    }
  });

  it('rebota en los bordes y entra por la boca del arco', () => {
    const b = createBall(0, 0);
    kickBall(b, 0, 10, 12, 0);
    for (let i = 0; i < 90; i++) stepBall(b, 1 / 60, field);
    expect(Math.abs(b.v)).toBeLessThanOrEqual(field.hv);
    expect(b.vv).toBeLessThan(0.01); // rebotó
    const g = createBall(15, 0.5);
    kickBall(g, 30, 0.5, 14, 0);
    let goal = null;
    for (let i = 0; i < 120 && !goal; i++) goal = stepBall(g, 1 / 60, field);
    expect(goal).toBe('gol+');
    // Afuera del arco: rebota en la línea de fondo.
    const w = createBall(15, 6);
    kickBall(w, 30, 6, 14, 0);
    let out = null;
    for (let i = 0; i < 120; i++) out = stepBall(w, 1 / 60, field) ?? out;
    expect(out).toBeNull();
    expect(w.u).toBeLessThanOrEqual(field.hu);
  });

  it('el jugador puede patear el balón al pasar corriendo', () => {
    const b = createBall(0, 0);
    expect(nudgeBall(b, 3, 0, 5, 0)).toBe(false); // lejos
    expect(nudgeBall(b, -0.3, 0, 5, 0)).toBe(true);
    expect(b.vu).toBeGreaterThan(5);
  });
});

describe('partido', () => {
  it('juegan: patean, se pasan el balón y a veces hay gol', () => {
    const rng = makeRng(7);
    const m = createMatch({ hu: 20, hv: 10, goalW: 2.4, goalH: 2.1, goals: 'porteria' }, 8, rng.next);
    expect(m.players.filter((p) => p.keeper)).toHaveLength(2);
    let kicks = 0;
    let goals = 0;
    const touched = new Set();
    for (let i = 0; i < 30 * 180; i++) {
      for (const e of stepMatch(m, 1 / 30, rng.next)) {
        if (e.type === 'kick') {
          kicks++;
          touched.add(e.i);
        }
        if (e.type === 'goal') goals++;
      }
      // Nadie se sale mucho del campo.
      for (const p of m.players) {
        expect(Math.abs(p.u)).toBeLessThan(m.hu + 3);
        expect(Math.abs(p.v)).toBeLessThan(m.hv + 3);
      }
    }
    expect(kicks).toBeGreaterThan(40);
    expect(touched.size).toBeGreaterThanOrEqual(5);
    expect(goals).toBeGreaterThan(0);
    expect(m.score[0] + m.score[1]).toBe(goals);
  });

  it('el remate va al arco contrario y el pase a un compañero', () => {
    const m = createMatch({ hu: 12, hv: 6, goalW: 1.4, goalH: 1.9, goals: 'arquitos' }, 6, () => 0.3);
    const p = m.players[0]; // equipo 0 ataca hacia +u
    p.u = 8;
    p.v = 0;
    const k = chooseKick(m, p, () => 0.1);
    expect(k.shot).toBe(true);
    expect(k.tu).toBeGreaterThan(m.hu);
    p.u = -10;
    const pass = chooseKick(m, p, () => 0.9);
    expect(pass.shot).toBe(false);
    expect(m.players[pass.to].team).toBe(0);
  });

  it('cuando pasa un carro se hacen al andén con el balón en la mano', () => {
    const rng = makeRng(3);
    const m = createMatch({ hu: 12, hv: 3.2, goalW: 0.9, goalH: 1.2, goals: 'piedras' }, 6, rng.next);
    for (let i = 0; i < 60; i++) stepMatch(m, 1 / 30, rng.next);
    m.paused = true;
    for (let i = 0; i < 30 * 8; i++) stepMatch(m, 1 / 30, rng.next);
    expect(m.ball.holder).toBeGreaterThanOrEqual(0);
    for (const p of m.players) expect(Math.abs(p.v)).toBeGreaterThan(m.hv - 0.2);
    m.paused = false;
    let kicked = false;
    for (let i = 0; i < 30 * 5 && !kicked; i++) kicked = stepMatch(m, 1 / 30, rng.next).some((e) => e.type === 'kick');
    expect(kicked).toBe(true);
  });
});
