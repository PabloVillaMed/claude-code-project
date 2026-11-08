// Damas de compañía (sim/companions.js): hora, cupo por calidad, puestos en
// el andén, cuándo se le puede ofrecer, lugar tranquilo, sustos, estados de
// la cita (fundido, cobro y vida) y la pinta de salir.
import { describe, expect, it } from 'vitest';
import { city } from './helpers.js';
import { onRoad } from '../../src/sim/terrain.js';
import { ROPA_BY_ID } from '../../src/sim/ropa.js';
import { makeRng } from '../../src/sim/rng.js';
import { QUALITY_PRESETS } from '../../src/render/postfx.js';
import { buildStreetLife } from '../../src/sim/streetLife.js';
import { discotecasDe } from '../../src/sim/nightlife.js';
import {
  BAJAR_VEL,
  CITA_DURACION,
  CITA_FUNDIDO,
  OFRECER_LADO,
  OFRECER_VEL,
  PRECIO,
  PUESTOS_AVENIDA,
  PUESTOS_RUMBA,
  SUSTO_CHOQUE,
  SUSTO_DISPARO,
  TOPE_DAMAS,
  TRANQUILO_TIEMPO,
  VIDA_MAX,
  aMarco,
  alcanza,
  avisoLugar,
  cobrar,
  esDeNoche,
  fundidoCita,
  lugarTranquilo,
  motivoSusto,
  nuevaCita,
  pasoCita,
  pintaDama,
  puedeOfrecer,
  puestosDamas,
  topeDamas,
} from '../../src/sim/companions.js';

// Contexto de un paso de la cita: el jugador manejando, quieto y en un lugar solo.
const tranquilo = (extra = {}) => ({ sentada: true, abajo: false, enCarro: true, muerto: false, vel: 0, peatones: 0, policia: false, buscado: 0, disparo: null, choque: 0, plata: 1000, ...extra });
const correr = (c, seg, ctx, dt = 0.05) => {
  const evs = [];
  for (let t = 0; t < seg - 1e-9; t += dt) {
    const e = pasoCita(c, dt, ctx);
    if (e) evs.push(e);
  }
  return evs;
};

describe('damas de compañía: hora y cupo', () => {
  it('solo de noche, de 21:00 a 4:00', () => {
    expect(esDeNoche(12)).toBe(false);
    expect(esDeNoche(20.9)).toBe(false);
    expect(esDeNoche(21)).toBe(true);
    expect(esDeNoche(23.5)).toBe(true);
    expect(esDeNoche(0)).toBe(true);
    expect(esDeNoche(3.9)).toBe(true);
    expect(esDeNoche(4)).toBe(false);
    expect(esDeNoche(24 + 22)).toBe(true);
  });

  it('el tope sale de la calidad (y nunca pasa de unas pocas)', () => {
    for (const [k, q] of Object.entries(QUALITY_PRESETS)) expect(topeDamas(q)).toBe(TOPE_DAMAS[k]);
    expect(topeDamas({ peds: 20 })).toBe(TOPE_DAMAS.baja);
    expect(topeDamas({ peds: 60 })).toBe(TOPE_DAMAS.alta);
    for (const n of Object.values(TOPE_DAMAS)) expect(n).toBeLessThanOrEqual(5);
    expect(TOPE_DAMAS.baja).toBeLessThanOrEqual(TOPE_DAMAS.alta);
  });
});

describe('damas de compañía: puestos en el andén', () => {
  const c = city();
  const { plazas, homeless } = buildStreetLife(c);
  const ps = puestosDamas(c, { avoid: [...plazas, ...homeless] });

  it('unos en la 92 y otros en esquinas de avenida, deterministas', () => {
    expect(ps.filter((p) => p.tipo === 'rumba').length).toBe(PUESTOS_RUMBA);
    expect(ps.filter((p) => p.tipo === 'avenida').length).toBeGreaterThanOrEqual(PUESTOS_AVENIDA - 2);
    expect(puestosDamas(c, { avoid: [...plazas, ...homeless] })).toEqual(ps);
    expect(new Set(ps.map((p) => p.id)).size).toBe(ps.length);
  });

  it('sobre el andén (no en la calzada ni contra un obstáculo), con la calle al frente', () => {
    for (const p of ps) {
      expect(onRoad(p.x, p.z)).toBe(false);
      expect(c.collision.pointBlocked(p.x, p.z)).toBe(false);
      // A pocos metros hacia donde mira hay calzada (ahí para el carro).
      const f = [1.5, 2, 2.5, 3, 3.5, 4].some((d) => onRoad(p.x + Math.sin(p.yaw) * d, p.z + Math.cos(p.yaw) * d));
      expect(f).toBe(true);
    }
  });

  it('lejos de las plazas, los habitantes de calle, el punto de partida y la fila de las discotecas', () => {
    for (const p of ps) {
      for (const q of [...plazas, ...homeless]) expect(Math.hypot(p.x - q.x, p.z - q.z)).toBeGreaterThan(24);
      expect(Math.hypot(p.x - c.spawn.x, p.z - c.spawn.z)).toBeGreaterThan(50);
      if (p.tipo === 'rumba') for (const d of discotecasDe(c)) expect(Math.hypot(p.x - d.fx, p.z - d.fz)).toBeGreaterThan(8.5);
    }
    // Los de la rumba, sobre la 92 (cerca de algún local).
    for (const p of ps.filter((q) => q.tipo === 'rumba')) expect(Math.min(...discotecasDe(c).map((d) => Math.hypot(p.x - d.fx, p.z - d.fz)))).toBeLessThan(14);
  });
});

describe('damas de compañía: invitarla', () => {
  const car = { ancho: 1.8, largo: 4.2, lado: 1 };

  it('el marco del carro: adelante es +z y gira con el heading', () => {
    const h = 0.7;
    const f = aMarco(Math.sin(h) * 3, Math.cos(h) * 3, h);
    expect(f.x).toBeCloseTo(0, 6);
    expect(f.z).toBeCloseTo(3, 6);
    const r = aMarco(Math.cos(h) * 2, -Math.sin(h) * 2, h);
    expect(r.x).toBeCloseTo(2, 6);
    expect(r.z).toBeCloseTo(0, 6);
  });

  it('solo del lado del copiloto, a la altura del carro y con el carro quieto', () => {
    expect(puedeOfrecer({ ...car, lx: 2.2, lz: 0, vel: 0 })).toBe(true);
    expect(puedeOfrecer({ ...car, lx: 0.9 + OFRECER_LADO - 0.1, lz: 1.5, vel: OFRECER_VEL * 0.5 })).toBe(true);
    expect(puedeOfrecer({ ...car, lx: 0.9 + OFRECER_LADO + 0.3, lz: 0, vel: 0 })).toBe(false); // muy lejos
    expect(puedeOfrecer({ ...car, lx: -2.2, lz: 0, vel: 0 })).toBe(false); // del lado del conductor
    expect(puedeOfrecer({ ...car, lado: -1, lx: -2.2, lz: 0, vel: 0 })).toBe(true);
    expect(puedeOfrecer({ ...car, lx: 2.2, lz: 5, vel: 0 })).toBe(false); // adelante del carro
    expect(puedeOfrecer({ ...car, lx: 2.2, lz: 0, vel: OFRECER_VEL + 0.5 })).toBe(false); // en marcha
  });

  it('sin plata no se sube; el cobro descuenta el precio y llena la vida sin pasarse', () => {
    expect(alcanza(PRECIO - 1)).toBe(false);
    expect(alcanza(PRECIO)).toBe(true);
    expect(cobrar({ dinero: 1000, vida: 35 })).toEqual({ dinero: 1000 - PRECIO, vida: VIDA_MAX });
    expect(cobrar({ dinero: 500, vida: 100 }).vida).toBe(VIDA_MAX);
    expect(cobrar({ dinero: 500, vida: 20 }, PRECIO, 30).vida).toBe(50);
  });
});

describe('damas de compañía: lugar tranquilo y sustos', () => {
  it('tranquilo = sin peatones, sin policía y sin que lo busquen', () => {
    expect(lugarTranquilo({ peatones: 0, policia: false, buscado: 0 })).toBe(true);
    expect(lugarTranquilo({ peatones: 1, policia: false, buscado: 0 })).toBe(false);
    expect(lugarTranquilo({ peatones: 0, policia: true, buscado: 0 })).toBe(false);
    expect(lugarTranquilo({ peatones: 0, policia: false, buscado: 1 })).toBe(false);
  });

  it('el aviso del HUD dice qué falta', () => {
    expect(avisoLugar({ peatones: 0, policia: true, vel: 0 })).toBe('policia');
    expect(avisoLugar({ peatones: 3, policia: false, vel: 0 })).toBe('gente');
    expect(avisoLugar({ peatones: 0, policia: false, vel: 6 })).toBe('para');
    expect(avisoLugar({ peatones: 0, policia: false, vel: 0 })).toBe('espera');
  });

  it('se asusta con disparos cerca, la policía detrás o un choque fuerte', () => {
    expect(motivoSusto({ disparo: null, buscado: 0, choque: 0 })).toBe(null);
    expect(motivoSusto({ disparo: SUSTO_DISPARO - 1 })).toBe('disparos');
    expect(motivoSusto({ disparo: SUSTO_DISPARO + 10 })).toBe(null);
    expect(motivoSusto({ buscado: 2 })).toBe('policia');
    expect(motivoSusto({ choque: SUSTO_CHOQUE + 1 })).toBe('choque');
    expect(motivoSusto({ choque: SUSTO_CHOQUE - 3 })).toBe(null);
  });
});

describe('damas de compañía: la cita', () => {
  it('se sienta, espera el lugar tranquilo, fundido, cobra a la mitad y se baja', () => {
    const c = nuevaCita();
    expect(c.estado).toBe('subiendo');
    expect(pasoCita(c, 0.05, tranquilo({ sentada: false }))).toBe(null);
    expect(pasoCita(c, 0.05, tranquilo())).toBe('a_bordo');
    // Con gente cerca no cuenta; el carro en marcha tampoco.
    expect(correr(c, 10, tranquilo({ peatones: 2 }))).toEqual([]);
    expect(correr(c, 10, tranquilo({ vel: 5 }))).toEqual([]);
    expect(c.quieto).toBe(0);
    // Quieto y solo: a los TRANQUILO_TIEMPO s, el fundido.
    expect(correr(c, TRANQUILO_TIEMPO - 0.2, tranquilo())).toEqual([]);
    expect(correr(c, 0.4, tranquilo())).toEqual(['lugar']);
    expect(c.estado).toBe('cita');
    expect(fundidoCita(c)).toBeLessThan(0.5);
    correr(c, CITA_FUNDIDO + 0.2, tranquilo());
    expect(fundidoCita(c)).toBe(1);
    const evs = correr(c, CITA_DURACION, tranquilo());
    expect(evs).toEqual(['cobro', 'fin', 'salir']);
    expect(c.cobrado).toBe(true);
    expect(c.estado).toBe('bajando');
    expect(fundidoCita(c)).toBe(0);
    expect(pasoCita(c, 0.05, tranquilo({ abajo: true }))).toBe('abajo');
    expect(c.estado).toBe('se_va');
  });

  it('el fundido entra, se queda en negro y sale sin saltos', () => {
    const c = { estado: 'cita', t: 0 };
    let prev = 0;
    for (let t = 0; t <= CITA_DURACION; t += 0.05) {
      c.t = t;
      const f = fundidoCita(c);
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThanOrEqual(1);
      expect(Math.abs(f - prev)).toBeLessThan(0.1);
      prev = f;
    }
    c.t = CITA_DURACION / 2;
    expect(fundidoCita(c)).toBe(1);
  });

  it('un susto la baja sin cobrar; si el carro va rápido, espera a que frene', () => {
    const c = nuevaCita();
    pasoCita(c, 0.05, tranquilo());
    expect(pasoCita(c, 0.05, tranquilo({ vel: 12, disparo: 10 }))).toBe('susto');
    expect(c.estado).toBe('bajando');
    expect(c.motivo).toBe('susto');
    expect(correr(c, 2, tranquilo({ vel: 12 }))).toEqual([]);
    expect(pasoCita(c, 0.05, tranquilo({ vel: BAJAR_VEL - 0.5 }))).toBe('salir');
    expect(pasoCita(c, 0.05, tranquilo({ abajo: true }))).toBe('abajo');
    expect(c.estado).toBe('asustada');
    expect(c.cobrado).toBe(false);
  });

  it('un choque fuerte o la policía también; en pleno negro (antes del cobro) se corta', () => {
    const a = nuevaCita();
    pasoCita(a, 0.05, tranquilo());
    expect(pasoCita(a, 0.05, tranquilo({ choque: SUSTO_CHOQUE + 2 }))).toBe('susto');
    const b = nuevaCita();
    pasoCita(b, 0.05, tranquilo());
    correr(b, TRANQUILO_TIEMPO + 0.2, tranquilo());
    expect(b.estado).toBe('cita');
    expect(pasoCita(b, 0.05, tranquilo({ buscado: 1 }))).toBe('susto');
    expect(b.cobrado).toBe(false);
  });

  it('si el jugador se baja, ella también (sin cobrar) y de una', () => {
    const c = nuevaCita();
    pasoCita(c, 0.05, tranquilo());
    expect(pasoCita(c, 0.05, tranquilo({ enCarro: false, vel: 8 }))).toBe('abandono');
    expect(pasoCita(c, 0.05, tranquilo({ enCarro: false, vel: 8 }))).toBe('salir');
    expect(c.cobrado).toBe(false);
  });

  it('si el jugador se tira del carro en una balacera, ella huye asustada (no es abandono)', () => {
    const c = nuevaCita();
    pasoCita(c, 0.05, tranquilo());
    expect(pasoCita(c, 0.05, tranquilo({ enCarro: false, vel: 9, disparo: 5 }))).toBe('susto');
    expect(pasoCita(c, 0.05, tranquilo({ enCarro: false, vel: 9 }))).toBe('salir');
    expect(pasoCita(c, 0.05, tranquilo({ enCarro: false, abajo: true }))).toBe('abajo');
    expect(c.estado).toBe('asustada');
  });

  it('si en el camino se gastó la plata, no hay cobro ni vida', () => {
    const c = nuevaCita();
    pasoCita(c, 0.05, tranquilo());
    correr(c, TRANQUILO_TIEMPO + 0.2, tranquilo());
    const evs = correr(c, CITA_DURACION, tranquilo({ plata: PRECIO - 1 }));
    expect(evs[0]).toBe('sin_plata');
    expect(c.cobrado).toBe(false);
    expect(c.estado).toBe('bajando');
  });
});

describe('damas de compañía: pinta de salir', () => {
  it('prendas de rumba que existen en sim/ropa.js (no se venden: hidden)', () => {
    const rng = makeRng(7);
    for (let i = 0; i < 40; i++) {
      const o = pintaDama(rng);
      expect(o.torso).toBeTruthy();
      expect(o.piernas).toBeTruthy();
      for (const id of Object.values(o)) {
        expect(ROPA_BY_ID[id]).toBeTruthy();
        if (ROPA_BY_ID[id].slot === 'torso') expect(ROPA_BY_ID[id].hidden).toBe(true);
      }
    }
  });
});
