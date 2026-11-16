// El minijuego de baile de las discotecas (sim/danceGame.js) y el pulso de
// las pistas (sim/pulsos.js): patrones por estilo y semilla, juicio de los
// toques, puntos, combo y su bajada sin castigo, la tanda completa y la
// propina con tope por tanda y por noche.
import { describe, expect, it } from 'vitest';
import { CARRILES, PATRONES, PROPINA, RITMO, acertarSiguiente, avanzarTanda, emocionDe, juicioDe, multiplicador, notasCompas, nuevaTanda, pasoVistoso, precision, propinaTanda, puntosDe, resumenTanda, tocarTanda } from '../../src/sim/danceGame.js';
import { PULSOS, tempoPista, tiempoPista } from '../../src/sim/pulsos.js';
import { EMISORAS } from '../../src/game/radioStations.js';

const ESTILOS = ['regueton', 'salsa', 'popular', 'electronica'];

/** Juega una tanda entera: `toca(nota)` decide a cuántos s del golpe la toca (null = no la toca). */
function jugar(S, toca, paso = 0.05) {
  const spb = 60 / S.bpm;
  let b = S.inicio;
  const ev = [];
  for (let k = 0; k < 20000 && !S.terminada; k++) {
    b += paso / spb;
    for (const n of S.notas) {
      if (n.estado !== 0 || n.tocar === false) continue;
      if (n.tocar === undefined) n.tocar = toca(n);
      if (n.tocar === null) {
        n.tocar = false;
        continue;
      }
      if (b >= n.b + n.tocar / spb) {
        tocarTanda(S, n.carril, n.b + n.tocar / spb, ev);
        n.tocar = false;
      }
    }
    avanzarTanda(S, b, ev);
  }
  return ev;
}

describe('baile: patrones', () => {
  it('cada estilo tiene tres niveles, con notas dentro del compás y carriles válidos', () => {
    for (const e of ESTILOS) {
      expect(PATRONES[e]).toHaveLength(3);
      for (const nivel of PATRONES[e])
        for (const m of nivel) {
          expect(m.length).toBeGreaterThan(0);
          for (const [t, c] of m) {
            expect(t).toBeGreaterThanOrEqual(0);
            expect(t).toBeLessThan(4);
            expect(c >= 0 && c < CARRILES.length).toBe(true);
          }
        }
    }
  });

  it('mismo estilo, compás, nivel y semilla dan las mismas notas; otra semilla cambia el baile', () => {
    for (const e of ESTILOS) {
      const a = notasCompas(e, 7, 1, 42);
      expect(notasCompas(e, 7, 1, 42)).toEqual(a);
      let distinto = false;
      for (let c = 0; c < 16 && !distinto; c++) distinto = JSON.stringify(notasCompas(e, c, 2, 1)) !== JSON.stringify(notasCompas(e, c, 2, 99));
      expect(distinto).toBe(true);
    }
  });

  it('las notas caen en su compás, ordenadas, y los niveles altos traen más notas', () => {
    for (const e of ESTILOS) {
      let n0 = 0;
      let n2 = 0;
      for (let c = 0; c < 40; c++) {
        const ns = notasCompas(e, c, 0, 3);
        for (let i = 0; i < ns.length; i++) {
          expect(ns[i].b).toBeGreaterThanOrEqual(c * 4);
          expect(ns[i].b).toBeLessThan(c * 4 + 4);
          if (i) expect(ns[i].b).toBeGreaterThan(ns[i - 1].b);
        }
        n0 += ns.length;
        n2 += notasCompas(e, c, 2, 3).length;
      }
      expect(n2).toBeGreaterThan(n0 * 1.6);
    }
  });

  it('la salsa marca adelante (arriba) en el 1 y atrás (abajo) en el 5; el reguetón trae el contratiempo del dembow', () => {
    for (let c = 0; c < 20; c++) {
      const s = notasCompas('salsa', c, 0, 5);
      expect(s[0]).toEqual({ b: c * 4, carril: 2 });
      expect(s.some((n) => n.b === c * 4 + 2 && n.carril === 1)).toBe(true);
    }
    const offs = new Set();
    for (let c = 0; c < 30; c++) for (const n of notasCompas('regueton', c, 2, 1)) offs.add(+(n.b % 1).toFixed(2));
    expect(offs.has(0.75)).toBe(true);
    expect(offs.has(0.5)).toBe(true);
  });

  it('a tempo rápido se ralea: nunca más de NOTAS_SEG_MAX notas por segundo en un compás', () => {
    for (const e of ESTILOS)
      for (const bpm of [90, 126, 150, 180])
        for (let c = 0; c < 20; c++) {
          const ns = notasCompas(e, c, 2, 7, bpm);
          expect(ns.length / ((4 * 60) / bpm)).toBeLessThanOrEqual(RITMO.NOTAS_SEG_MAX + 1e-9);
        }
  });
});

describe('baile: juicio, puntos y combo', () => {
  it('ventanas generosas en segundos: perfecto, bien, justo y nada', () => {
    expect(juicioDe(0)).toBe('perfecto');
    expect(juicioDe(-0.07)).toBe('perfecto');
    expect(juicioDe(0.12)).toBe('bien');
    expect(juicioDe(-0.2)).toBe('justo');
    expect(juicioDe(0.3)).toBe(null);
    expect(RITMO.VENTANA.justo).toBeGreaterThanOrEqual(0.18);
  });

  it('el multiplicador sube con el combo hasta su tope y los puntos lo usan', () => {
    expect(multiplicador(0)).toBe(1);
    expect(multiplicador(RITMO.COMBO_PASO)).toBe(2);
    expect(multiplicador(1000)).toBe(RITMO.MULT_MAX);
    expect(puntosDe('perfecto', RITMO.COMBO_PASO)).toBe(RITMO.PUNTOS.perfecto * 2);
    expect(puntosDe('fallo', 30)).toBe(0);
  });

  it('pasos vistosos y emoción según el combo', () => {
    expect(pasoVistoso(0)).toBe('normal');
    expect(pasoVistoso(RITMO.COMBO_DOBLE)).toBe('doble');
    expect(pasoVistoso(RITMO.COMBO_VUELTA)).toBe('vuelta');
    expect(emocionDe(0)).toBe(0);
    expect(emocionDe(RITMO.COMBO_EMOCION * 3)).toBe(1);
  });

  it('el toque se juzga en segundos con el tempo de la tanda (a 90 y a 140 la ventana mide lo mismo)', () => {
    for (const bpm of [90, 140]) {
      const S = nuevaTanda('regueton', 1, 0, bpm);
      avanzarTanda(S, S.c0 * 4 - 1);
      const n = S.notas[0];
      const ev = tocarTanda(S, n.carril, n.b + (0.12 * bpm) / 60);
      expect(ev.tipo).toBe('bien');
      expect(S.combo).toBe(1);
    }
  });

  it('tocar sin nota o en otro carril es fallo; dos fallos seguidos bajan el combo a la mitad, sin restar puntos', () => {
    const S = nuevaTanda('electronica', 3, 0, 120);
    avanzarTanda(S, S.c0 * 4 + 40);
    // (avanzar tanto deja las primeras como falladas: tanda nueva para el combo)
    const T = nuevaTanda('electronica', 3, 0, 120);
    for (let k = 0; k < 10; k++) {
      avanzarTanda(T, T.c0 * 4 + k * 0.5);
      acertarSiguiente(T);
    }
    expect(T.combo).toBe(10);
    const pts = T.puntos;
    tocarTanda(T, 0, -50); // lejos de toda nota
    expect(T.combo).toBe(10); // un fallo solo no lo baja
    tocarTanda(T, 0, -50);
    expect(T.combo).toBe(5);
    expect(T.puntos).toBe(pts);
    expect(T.juicios.fallo).toBe(2);
    expect(S.juicios.fallo).toBeGreaterThan(0);
  });

  it('las notas que pasan sin tocarse cuentan como falladas', () => {
    const S = nuevaTanda('popular', 2, 0, 100);
    avanzarTanda(S, S.c0 * 4 + 4 + 1);
    expect(S.juzgadas).toBeGreaterThan(0);
    expect(S.acertadas).toBe(0);
    expect(S.juicios.fallo).toBe(S.juzgadas);
  });
});

describe('baile: la tanda', () => {
  it('cuenta de entrada, notas solo dentro de la tanda y fin con el último compás', () => {
    for (const e of ESTILOS) {
      const S = nuevaTanda(e, 11, 3.3, 96);
      expect(S.c0 * 4).toBeGreaterThanOrEqual(3.3 + RITMO.ENTRADA);
      const ev = jugar(S, () => 0);
      expect(ev.at(-1).tipo).toBe('fin');
      expect(S.terminada).toBe(true);
      expect(precision(S)).toBe(1);
      expect(S.juicios.perfecto).toBe(S.juzgadas);
      expect(S.comboMax).toBe(S.juzgadas);
      expect(S.juzgadas).toBeGreaterThan(RITMO.TANDA_COMPASES * 1.5);
    }
  });

  it('determinista: misma semilla y mismos toques dan el mismo puntaje', () => {
    const toca = (n) => (((n.b * 7) | 0) % 5 === 0 ? null : (((n.b * 13) | 0) % 3) * 0.05 - 0.05);
    const a = nuevaTanda('salsa', 77, 0, 105);
    const b = nuevaTanda('salsa', 77, 0, 105);
    jugar(a, toca);
    jugar(b, toca);
    expect(resumenTanda(a)).toEqual(resumenTanda(b));
    expect(a.juicios.fallo).toBeGreaterThan(0);
  });

  it('la dificultad sube con los compases', () => {
    const S = nuevaTanda('regueton', 5, 0, 95);
    jugar(S, () => 0);
    let primeros = 0;
    let ultimos = 0;
    for (let c = 0; c < 6; c++) primeros += notasCompas('regueton', S.c0 + c, 0, 5, 95).length;
    for (let c = 18; c < 24; c++) ultimos += notasCompas('regueton', S.c0 + c, 2, 5, 95).length;
    expect(ultimos).toBeGreaterThan(primeros);
  });
});

describe('baile: propina con tope', () => {
  it('bailando bien da plata, nunca más del tope de la tanda', () => {
    const S = nuevaTanda('regueton', 1, 0, 95);
    jugar(S, () => 0);
    const p = propinaTanda(S, 0);
    expect(p).toBeGreaterThan(0);
    expect(p).toBeLessThanOrEqual(PROPINA.MAX_TANDA);
    expect(p % PROPINA.REDONDEO).toBe(0);
  });

  it('con poca precisión o pocas notas no hay propina', () => {
    const S = nuevaTanda('regueton', 1, 0, 95);
    jugar(S, (n) => (((n.b * 4) | 0) % 3 === 0 ? 0 : null));
    expect(precision(S)).toBeLessThan(PROPINA.MIN_ACIERTO);
    expect(propinaTanda(S, 0)).toBe(0);
    const T = nuevaTanda('regueton', 1, 0, 95);
    avanzarTanda(T, T.c0 * 4 - 1);
    acertarSiguiente(T);
    expect(propinaTanda(T, 0)).toBe(0);
  });

  it('el tope de la noche: varias tandas perfectas no pasan de TOPE_NOCHE', () => {
    let ganado = 0;
    for (let k = 0; k < 10; k++) {
      const S = nuevaTanda('salsa', k + 1, 0, 100);
      jugar(S, () => 0);
      ganado += propinaTanda(S, ganado);
    }
    expect(ganado).toBe(PROPINA.TOPE_NOCHE);
  });
});

describe('pulso de las pistas', () => {
  it('cada pista de las emisoras de las discotecas está medida, con tempo y fase razonables', () => {
    for (const id of ['perreo', 'sabrosa', 'parce']) {
      const em = EMISORAS.find((e) => e.id === id);
      for (const p of em.pistas) {
        const v = PULSOS[`${id}/${p.id}`];
        expect(v, `${id}/${p.id}`).toBeTruthy();
        expect(v[0]).toBeGreaterThan(60);
        expect(v[0]).toBeLessThan(200);
        expect(v[1]).toBeGreaterThanOrEqual(0);
        expect(v[1]).toBeLessThan(60 / v[0]);
      }
    }
  });

  it('el tempo se lleva a la octava más cercana al del estilo y los tiempos cuentan desde el primer golpe', () => {
    expect(tempoPista('perreo/hands-up-cdk', 126)).toBeCloseTo(89.998, 3);
    expect(tempoPista('sabrosa/del-rio-bravo', 120)).toBeCloseTo(149.972, 2);
    expect(tempoPista('perreo/wayo-wayo', 95)).toBeCloseTo(94.992, 3);
    expect(tempoPista('no/existe', 95)).toBe(null);
    const [bpm, fase] = PULSOS['parce/la-tripleta'];
    expect(tiempoPista('parce/la-tripleta', fase, bpm)).toBeCloseTo(0, 6);
    expect(tiempoPista('parce/la-tripleta', fase + 60, bpm)).toBeCloseTo(bpm, 6);
    expect(tiempoPista('no/existe', 3, 95)).toBe(null);
  });
});
