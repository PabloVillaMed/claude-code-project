// La estampida de las discotecas (sim/estampida.js): la cola por la puerta,
// nadie se atraviesa ni se queda trabado, y los del mezanine bajan por la
// escalera hasta el piso del salón.
import { describe, expect, it } from 'vitest';
import { city } from './helpers.js';
import { INTERIORES_ACTIVOS } from '../../src/sim/interiors.js';
import { nivelRumba } from '../../src/sim/nightlife.js';
import { armarGente, cupoClub, pasoSalida, salidaDe } from '../../src/sim/clubLife.js';
import { ESTAMPIDA, bajadaMezz, enMezz, escaleraMezz, frenoCola, rejillaMezz, restante } from '../../src/sim/estampida.js';

const C = city();
const byId = (id) => C.interiors.find((r) => r.id === id);
const enCiudad = INTERIORES_ACTIVOS ? it : it.skip;

/** Simula la estampida de los que corren de `r` (local: sin rotar al mundo) con el freno de la cola. */
function simular(r, personas, { dt = 0.05, vel = 4, segundos = 60 } = {}) {
  const S = salidaDe(r);
  const M = bajadaMezz(r);
  const extra = M ? restante(S, { lx: M.tramo[1].x, lz: M.tramo[1].z, k: -1 }) : 0;
  const run = personas.map((p, i) => {
    const mezz = M && enMezz(r, p.lx, p.lz, p.y);
    return { e: { lx: p.lx, lz: p.lz, y: p.y, k: -1, carril: ((i % 5) - 2) / 2, dx: 0, dz: 0 }, mezz, fuera: false, atasco: 0, pasa: 0 };
  });
  const n = run.length;
  const xs = new Float32Array(n);
  const ys = new Float32Array(n);
  const zs = new Float32Array(n);
  const dxs = new Float32Array(n);
  const dzs = new Float32Array(n);
  const prio = new Float32Array(n);
  let minSep = Infinity;
  let colados = 0;
  let t = 0;
  for (; t < segundos && run.some((c) => !c.fuera); t += dt) {
    for (let i = 0; i < n; i++) {
      const c = run[i];
      xs[i] = c.fuera ? 1e4 + i * 10 : c.e.lx;
      zs[i] = c.e.lz;
      ys[i] = c.e.y;
      dxs[i] = c.e.dx;
      dzs[i] = c.e.dz;
      prio[i] = c.fuera ? -1 : c.mezz ? restante(M, c.e, extra) : restante(S, c.e);
    }
    for (let i = 0; i < n; i++) {
      const c = run[i];
      if (c.fuera) continue;
      let f = c.pasa > 0 ? ESTAMPIDA.PASA_VEL : frenoCola(xs, ys, zs, dxs, dzs, prio, n, i);
      if (c.e.dx === 0 && c.e.dz === 0) f = 1; // (el primer paso define hacia dónde va)
      if (Math.hypot(c.e.lx - (c.ax ?? 1e9), c.e.lz - (c.az ?? 1e9)) > ESTAMPIDA.ATASCO_MUEVE) {
        c.ax = c.e.lx;
        c.az = c.e.lz;
        c.atasco = 0;
      }
      else if ((c.atasco += dt) > ESTAMPIDA.ATASCO && f < ESTAMPIDA.ATASCO_FRENO) {
        c.atasco = 0;
        c.pasa = ESTAMPIDA.ATASCO_PASA;
        c.colo = t;
        colados++;
      }
      c.pasa = Math.max(0, c.pasa - dt);
      if (c.mezz) {
        if (pasoSalida(r, M, c.e, vel * f * dt)) {
          c.mezz = false;
          c.e.k = -1;
        }
      } else c.fuera = pasoSalida(r, S, c.e, vel * f * dt);
    }
    // Separación entre los que siguen adentro del salón (lejos de la calle).
    if (t > 1.5)
      for (let i = 0; i < n; i++)
        for (let j = i + 1; j < n; j++) {
          const a = run[i];
          const b = run[j];
          if (a.fuera || b.fuera || Math.abs(a.e.y - b.e.y) > 1 || t - (a.colo ?? -9) < 3 || t - (b.colo ?? -9) < 3) continue;
          minSep = Math.min(minSep, Math.hypot(a.e.lx - b.e.lx, a.e.lz - b.e.lz));
        }
  }
  return { run, t, minSep, colados };
}

describe('estampida: el freno de la cola', () => {
  const F = (xs, zs, dirs, prio, i, ys = [0, 0]) => frenoCola(new Float32Array(xs), new Float32Array(ys), new Float32Array(zs), new Float32Array(dirs.map((d) => d[0])), new Float32Array(dirs.map((d) => d[1])), new Float32Array(prio), xs.length, i);

  it('frena al que tiene a alguien adelante y no al de adelante', () => {
    // Los dos van hacia +z, el 1 adelante: el 0 frena y el 1 sigue a toda.
    const f0 = F([0, 0], [0, 0.7], [[0, 1], [0, 1]], [5, 4], 0);
    expect(f0).toBeGreaterThan(0);
    expect(f0).toBeLessThan(1);
    expect(F([0, 0], [0, 0.7], [[0, 1], [0, 1]], [5, 4], 1)).toBe(1);
    // Aunque la prioridad diga otra cosa (la rejilla redondea): frena el de atrás.
    expect(F([0, 0], [0, 0.7], [[0, 1], [0, 1]], [3, 4], 0)).toBeLessThan(1);
    // Hacia un lado no frena; contra uno quieto, sí.
    expect(F([0, 0], [0, 0.7], [[1, 0], [0, 1]], [5, 4], 0)).toBe(1);
    expect(F([0, 0], [0, 0.7], [[0, 1], [0, 0]], [3, 4], 0)).toBeLessThan(1);
    // Pegado (a SEP_MIN o menos): quieto.
    expect(F([0, 0], [0, ESTAMPIDA.SEP_MIN * 0.9], [[0, 1], [0, 1]], [5, 4], 0)).toBe(0);
    // En otro piso (uno en el mezanine): no se estorban.
    expect(F([0, 0], [0, 0.7], [[0, 1], [0, 1]], [5, 4], 0, [0, 3.4])).toBe(1);
  });

  it('de frente pasa el que tiene menos camino (empate: el de menor índice), sin trabarse', () => {
    expect(F([0, 0], [0, 0.7], [[0, 1], [0, -1]], [4, 5], 0)).toBe(1);
    expect(F([0, 0], [0, 0.7], [[0, 1], [0, -1]], [4, 5], 1)).toBeLessThan(1);
    expect(F([0, 0], [0, 0.7], [[0, 1], [0, -1]], [4, 4], 0)).toBe(1);
    expect(F([0, 0], [0, 0.7], [[0, 1], [0, -1]], [4, 4], 1)).toBeLessThan(1);
  });
});

describe('estampida en los locales', () => {
  enCiudad('el local lleno sale entero por la puerta en cola, sin amontonarse ni trabarse', () => {
    for (const id of ['flow92', 'laclave', 'compadres', 'saborson']) {
      const r = byId(id);
      const G = armarGente(r, cupoClub(r.tam, 44, nivelRumba(0)));
      const corren = G.personas.filter((p) => p.panico === 'correr' || (ESTAMPIDA.SENTADOS_CORREN && p.panico === 'cubrirse') || (ESTAMPIDA.MEZZ_BAJA && enMezz(r, p.lx, p.lz, p.y)));
      expect(corren.length, id).toBeGreaterThan(5);
      const { run, t, minSep, colados } = simular(r, corren);
      // Colarse (pasar por encima tras un atasco largo) es la excepción.
      const quedan = run.filter((c) => !c.fuera);
      expect(quedan.length, `${id}: quedaron ${quedan.length} adentro a los ${t.toFixed(1)} s`).toBe(0);
      // Nadie se le monta encima al otro (salvo un instante al colarse de un atasco).
      expect(minSep, id).toBeGreaterThan(ESTAMPIDA.SEP_MIN * 0.55);
      expect(colados, id).toBeLessThanOrEqual(Math.ceil(corren.length * 0.2));
      // Y la cola va saliendo: el local grande se vacía en menos de un minuto.
      expect(t, id).toBeLessThan(60);
    }
  });

  enCiudad('del mezanine se baja por la escalera hasta el piso del salón', () => {
    const r = byId('flow92');
    expect(r.mezz).toBeTruthy();
    const st = escaleraMezz(r);
    expect(st).toBeTruthy();
    const g = rejillaMezz(r);
    expect(g.libre.some((v) => v)).toBe(true);
    const M = bajadaMezz(r);
    // Desde el sofá del VIP más lejano de la escalera.
    const m = r.mezz;
    const e = { lx: m.x1 - 1.2, lz: m.z1 - 0.8, y: m.y, k: -1, carril: 0, dx: 0, dz: 0 };
    let abajo = false;
    let maxY = -Infinity;
    for (let k = 0; k < 600 && !abajo; k++) {
      abajo = pasoSalida(r, M, e, 0.12);
      maxY = Math.max(maxY, e.y);
      // Nunca por fuera del mezanine ni de la escalera (no se tira por la baranda).
      const enEsc = e.lx >= st.x0 - 0.01 && e.lx <= st.x1 + 0.01 && e.lz >= st.z0 - 0.6 && e.lz <= st.z1 + 0.01;
      expect(enMezz(r, e.lx, e.lz, e.y) || enEsc, `se salió en (${e.lx.toFixed(2)}, ${e.lz.toFixed(2)}, y ${e.y.toFixed(2)})`).toBe(true);
    }
    expect(abajo).toBe(true);
    expect(e.y).toBeCloseTo(r.y0, 1);
    expect(maxY).toBeCloseTo(m.y, 1);
    // Y desde ahí, la salida normal llega a la calle.
    e.k = -1;
    const S = salidaDe(r);
    let fuera = false;
    for (let k = 0; k < 900 && !fuera; k++) fuera = pasoSalida(r, S, e, 0.15);
    expect(fuera).toBe(true);
  });
});
