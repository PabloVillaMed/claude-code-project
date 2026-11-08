import { describe, expect, it } from 'vitest';
import { SIRENA, SIRENA_MEZCLA, SIRENA_TONO, elegirPatron, elegirSirenas, evalSerie, formaBarrido, mezclaSirena, rangoBarrido, seriesBarrido, sirenaDeseada, stepSirena, variacionUnidad } from '../../src/sim/sirena.js';
import { planPatrol } from '../../src/sim/policeAI.js';
import { WantedSystem } from '../../src/sim/wanted.js';
import { RoadGraph, autopilot, lanePoint } from '../../src/sim/roadNav.js';
import { createVehicleState, stepVehicle } from '../../src/sim/vehiclePhysics.js';
import { groundHeight } from '../../src/sim/terrain.js';
import { dist2D } from '../../src/sim/math.js';
import { makeRng } from '../../src/sim/rng.js';
import { city, cityEnv } from './helpers.js';

/** Situación base: unidad en camino, con estrellas, lejos del jugador. */
const base = (o = {}) => ({ id: 1, moto: false, wanted: true, leaving: false, state: 'pursuit', destroyed: false, pendingDeploy: null, mode: 'respond', seen: false, dist: 150, speed: 15, cruise: 17, ...o });

/** Avanza la sirena `seg` s con la situación que da `info(t)`; devuelve el registro. */
function correr(seg, info, st = {}, dt = 0.05) {
  const log = [];
  for (let t = 0; t < seg; t += dt) {
    stepSirena(st, info(t), dt);
    log.push({ t, on: st.on, patron: st.patron });
  }
  return { st, log };
}

describe('cuándo suena la sirena', () => {
  it('suena viniendo en camino o persiguiendo; en silencio llegando, buscando sin verte o retirándose', () => {
    expect(sirenaDeseada(base({ mode: 'respond' }))).toBe(true);
    expect(sirenaDeseada(base({ mode: 'pursue', seen: true, dist: 40 }))).toBe(true);
    expect(sirenaDeseada(base({ mode: 'tail', seen: true, dist: 25, moto: true }))).toBe(true);
    // Ya llegó: encima de ti y quieta.
    expect(sirenaDeseada(base({ mode: 'pursue', seen: true, dist: 8, speed: 0.5 }))).toBe(false);
    // Frenando para bajar a los agentes, bajados o volviendo a la patrulla.
    expect(sirenaDeseada(base({ mode: 'pursue', seen: true, dist: 18, pendingDeploy: 'contact' }))).toBe(false);
    expect(sirenaDeseada(base({ state: 'deployed' }))).toBe(false);
    expect(sirenaDeseada(base({ state: 'returning' }))).toBe(false);
    // Barrido sin verte: solo luces.
    expect(sirenaDeseada(base({ mode: 'search', seen: false }))).toBe(false);
    expect(sirenaDeseada(base({ mode: 'search', seen: true }))).toBe(true);
    // Cortando el paso: suena yendo, no esperando en el punto ni apostada sin verte.
    expect(sirenaDeseada(base({ mode: 'cut', seen: true, cruise: 19 }))).toBe(true);
    expect(sirenaDeseada(base({ mode: 'cut', seen: true, cruise: 0 }))).toBe(false);
    expect(sirenaDeseada(base({ mode: 'cut', seen: false, cruise: 17 }))).toBe(false);
    // Retirándose, sin estrellas, destruida o patrullando.
    expect(sirenaDeseada(base({ leaving: true }))).toBe(false);
    expect(sirenaDeseada(base({ wanted: false }))).toBe(false);
    expect(sirenaDeseada(base({ destroyed: true }))).toBe(false);
    expect(sirenaDeseada(base({ mode: 'patrol' }))).toBe(false);
  });

  it('no parpadea si te ven y te pierden a cada rato', () => {
    // Barriendo: la radio te ve y te pierde cada 0.25 s.
    const { log } = correr(20, (t) => base({ mode: 'search', seen: Math.floor(t / 0.25) % 2 === 0, dist: 60 }));
    let cambios = 0;
    for (let i = 1; i < log.length; i++) if (log[i].on !== log[i - 1].on) cambios++;
    expect(cambios).toBeLessThanOrEqual(2);
  });

  it('se apaga de una al bajar a los agentes o al retirarse, sin esperar', () => {
    for (const fin of [{ pendingDeploy: 'contact' }, { state: 'deployed' }, { leaving: true }, { wanted: false }]) {
      const st = {};
      correr(0.5, () => base({ mode: 'pursue', seen: true, dist: 40 }), st);
      expect(st.on).toBe(true);
      stepSirena(st, base({ mode: 'pursue', seen: true, dist: 30, ...fin }), 0.05);
      expect(st.on).toBe(false);
    }
  });

  it('después de apagarse espera un poco antes de volver a prender', () => {
    const st = {};
    correr(1, () => base(), st);
    stepSirena(st, base({ state: 'deployed' }), 0.05);
    expect(st.on).toBe(false);
    correr(SIRENA.holdOff * 0.6, () => base(), st);
    expect(st.on).toBe(false);
    correr(SIRENA.holdOff, () => base(), st);
    expect(st.on).toBe(true);
  });
});

describe('patrones de la sirena', () => {
  it('el carro va en wail de lejos y en yelp de cerca; la moto echa chirps', () => {
    const cuenta = (moto, cerca, trancon) => {
      const n = { wail: 0, yelp: 0, chirp: 0 };
      for (let i = 0; i < 200; i++) n[elegirPatron(moto, cerca, trancon, (i + 0.5) / 200)]++;
      return n;
    };
    expect(cuenta(false, false, false).wail).toBeGreaterThan(150);
    expect(cuenta(false, true, false).yelp).toBeGreaterThan(130);
    expect(cuenta(false, true, false).wail).toBeGreaterThan(0); // alternancia natural
    expect(cuenta(true, false, false).chirp).toBeGreaterThan(120);
    expect(cuenta(true, false, true).chirp).toBeGreaterThan(130);
    expect(cuenta(true, true, false).yelp).toBeGreaterThan(90);
  });

  it('acercándose pasa del wail al yelp, y no cambia de patrón a cada rato', () => {
    // Carros (unidades 1 a 12) que vienen de 300 m a 20 m/s y luego persiguen de cerca.
    const lejos = [];
    const cerca = [];
    for (let id = 1; id <= 12; id++) {
      const { log } = correr(30, (t) => base({ id, mode: t < 12 ? 'respond' : 'pursue', seen: t >= 12, dist: Math.max(20, 300 - t * 20) }));
      lejos.push(...log.filter((e) => e.t > 1 && e.t < 9));
      cerca.push(...log.filter((e) => e.t > 17));
      // Cambios separados al menos cambioMin.
      let ultimo = -Infinity;
      for (let i = 1; i < log.length; i++) {
        if (log[i].patron !== log[i - 1].patron && log[i - 1].patron) {
          expect(log[i].t - ultimo).toBeGreaterThanOrEqual(SIRENA.cambioMin - 1e-6);
          ultimo = log[i].t;
        }
      }
    }
    const frac = (arr, p) => arr.filter((e) => e.patron === p).length / arr.length;
    expect(frac(lejos, 'wail')).toBeGreaterThan(0.6);
    expect(frac(cerca, 'yelp')).toBeGreaterThan(0.6);
  });

  it('en un trancón el carro pasa a yelp (o chirps) aunque esté lejos', () => {
    const { log } = correr(12, (t) => base({ dist: 180, speed: t < 3 ? 15 : 1, cruise: 17 }));
    const final = log.filter((e) => e.t > 7);
    expect(final.every((e) => e.patron === 'yelp' || e.patron === 'chirp')).toBe(true);
  });

  it('cada unidad tiene su tono y su ritmo (que no suenen iguales ni en fase)', () => {
    const vs = [1, 2, 3, 4, 5, 6].map(variacionUnidad);
    expect(variacionUnidad(3)).toEqual(variacionUnidad(3));
    expect(new Set(vs.map((v) => v.tono.toFixed(4))).size).toBe(6);
    for (const v of vs) {
      expect(Math.abs(v.tono - 1)).toBeLessThanOrEqual(SIRENA_TONO.variacionTono + 1e-9);
      expect(Math.abs(v.ritmo - 1)).toBeLessThanOrEqual(SIRENA_TONO.variacionRitmo + 1e-9);
    }
    // Dos unidades iguales en todo eligen patrones distintos en algún momento.
    const a = correr(60, () => base({ id: 1 })).log;
    const b = correr(60, () => base({ id: 2 })).log;
    expect(a.some((e, i) => e.patron !== b[i].patron)).toBe(true);
  });

  it('el barrido sube más rápido de lo que baja y recorre de fMin a fMax', () => {
    const { fMin, fMax, subida } = SIRENA_TONO;
    expect(formaBarrido(0)).toBeCloseTo(0);
    expect(formaBarrido(subida)).toBeCloseTo(1);
    expect(formaBarrido(0.999)).toBeLessThan(0.01);
    const serie = seriesBarrido();
    const { base: f0, prof } = rangoBarrido(serie);
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < 400; i++) {
      const f = f0 + evalSerie(serie.real, serie.imag, i / 400) * prof;
      lo = Math.min(lo, f);
      hi = Math.max(hi, f);
    }
    expect(lo).toBeGreaterThan(fMin - 5);
    expect(hi).toBeLessThan(fMax + 5);
    expect(hi - lo).toBeGreaterThan((fMax - fMin) * 0.97);
  });
});

describe('cómo se oye la sirena', () => {
  it('baja con la distancia, pierde agudos y se calla pasado el máximo', () => {
    let prev = mezclaSirena(SIRENA_MEZCLA.refDist);
    expect(prev.gain).toBeCloseTo(SIRENA_MEZCLA.volumen);
    for (const d of [25, 50, 100, 150, 200]) {
      const m = mezclaSirena(d);
      expect(m.gain).toBeLessThan(prev.gain);
      expect(m.lp).toBeLessThan(prev.lp);
      expect(m.eco).toBeGreaterThanOrEqual(prev.eco);
      prev = m;
    }
    // -6 dB cada vez que se dobla la distancia (lejos del borde).
    expect(mezclaSirena(50).gain / mezclaSirena(25).gain).toBeCloseTo(0.5, 2);
    expect(mezclaSirena(SIRENA_MEZCLA.maxDist + 1).gain).toBe(0);
  });

  it('Doppler suave: más agudo acercándose, más grave alejándose, con tope', () => {
    expect(mezclaSirena(50, 20).pitch).toBeGreaterThan(1);
    expect(mezclaSirena(50, -20).pitch).toBeLessThan(1);
    expect(mezclaSirena(50, 0).pitch).toBe(1);
    expect(mezclaSirena(50, 300).pitch).toBeLessThanOrEqual(1 + SIRENA_MEZCLA.dopplerMax);
    // Más suave que el físico.
    expect(mezclaSirena(50, 20).pitch).toBeLessThan(343 / (343 - 20));
  });

  it('dentro de un carro cerrado se oye apagada', () => {
    const fuera = mezclaSirena(30);
    const dentro = mezclaSirena(30, 0, true);
    expect(dentro.gain).toBeCloseTo(fuera.gain * SIRENA_MEZCLA.cabinaGain);
    expect(dentro.lp).toBeLessThanOrEqual(SIRENA_MEZCLA.cabinaLp);
  });

  it('suenan a lo sumo dos, las más cercanas, sin cambiar a cada rato', () => {
    const c = [{ d: 90 }, { d: 30 }, { d: 60 }, { d: 300 }];
    const out = elegirSirenas(c, [], 2);
    expect(out.map((x) => x.d)).toEqual([30, 60]);
    // La de 60 sonaba; una nueva a 55 no la desplaza (margen), una a 40 sí.
    const sonando = [c[1], c[2]];
    const n55 = { d: 55 };
    expect(elegirSirenas([...c, n55], sonando, 2)).toEqual([c[1], c[2]]);
    const n40 = { d: 40 };
    expect(elegirSirenas([...c, n40], sonando, 2)).toContain(n40);
    // Más allá del máximo no suena ninguna.
    expect(elegirSirenas([{ d: 500 }], [], 2)).toEqual([]);
  });
});

describe('la sirena con la IA de la policía', () => {
  function patrolAt(g, x, z) {
    const n = g.nearestNode(x, z);
    const to = n.links[0].node;
    const p = lanePoint(g, n.id, to, 0.2);
    return { v: createVehicleState('policia', p.x, p.z, p.yaw, groundHeight), agent: { from: n.id, to, next: null }, ai: {}, st: {} };
  }

  it('acudiendo a la última posición suena; ya en la zona, barriendo sin verte, se calla', () => {
    const g = new RoadGraph(city());
    const env = cityEnv();
    const unit = patrolAt(g, -60, -120);
    const w = new WantedSystem();
    w.report('copAssault', { x: 100, z: 60 });
    const player = { x: -200, z: 250 }; // escondido lejos: nadie lo ve
    const rng = makeRng(5);
    const dt = 1 / 30;
    const porModo = { respond: [], search: [] };
    for (let t = 0; t < 45; t += dt) {
      w.update(dt, false, player);
      const plan = planPatrol(unit.ai, unit.v, unit.agent, { graph: g, wanted: w, seen: false, player, taken: [], rand: rng.next, dt });
      stepVehicle(unit.v, autopilot(g, unit.agent, unit.v, { cruise: plan.cruise, blockedAhead: Infinity, rand: rng.next, dt, target: plan.target }), dt, env);
      stepSirena(unit.st, { id: 3, moto: false, wanted: w.level > 0, leaving: false, state: 'pursuit', destroyed: false, pendingDeploy: null, mode: plan.mode, seen: false, dist: dist2D(unit.v.x, unit.v.z, player.x, player.z), speed: unit.v.forwardSpeed, cruise: plan.cruise }, dt);
      porModo[plan.mode]?.push(unit.st.on);
    }
    expect(porModo.respond.length).toBeGreaterThan(30);
    expect(porModo.respond.filter(Boolean).length / porModo.respond.length).toBeGreaterThan(0.9);
    // Tras apagarTras, en barrido queda en silencio.
    const barrido = porModo.search.slice(Math.ceil(SIRENA.apagarTras / dt) + 2);
    expect(barrido.length).toBeGreaterThan(30);
    expect(barrido.every((on) => !on)).toBe(true);
  });
});
