// La vida adentro de las discotecas (sim/clubLife.js y sim/baile.js): cupos
// por hora y calidad, reparto por tipo de local, parejas, tempos, que nadie
// quede metido en un mueble ni tapando la puerta, rutas de salida sin
// atravesar nada, los bailes por código y el determinismo.
import { describe, expect, it } from 'vitest';
import { city } from './helpers.js';
import { INTERIORES_ACTIVOS, PLANES, alturaInterior } from '../../src/sim/interiors.js';
import { nivelRumba } from '../../src/sim/nightlife.js';
import { QUALITY_PRESETS } from '../../src/render/postfx.js';
import { AMBIENTES, CLUB_CUPO, GENTE, RUTAS, TEMPOS, apartarse, armarGente, campoHacia, compas, cupoClub, ocupado, pasoSalida, puestosBarra, rejilla, repartoClub, rutaEntre, salidaDe, tempoDe, tiempos, zonasLibres } from '../../src/sim/clubLife.js';
import { BAILE, ESTILOS, brindis, caidaElectronica, cambioDJ, giroVuelta, hayVuelta, nuevaPose, pasoSalsa, poseBaile, poseBartender, poseBillar, poseCubrirse, poseDJ, poseMusico, poseSentado } from '../../src/sim/baile.js';

const C = city();
const byId = (id) => C.interiors.find((r) => r.id === id);
const enCiudad = INTERIORES_ACTIVOS ? it : it.skip;
const PEDS = Object.fromEntries(Object.entries(QUALITY_PRESETS).map(([k, q]) => [k, q.peds]));
const llena = (r, calidad = 'alta', hora = 0) => armarGente(r, cupoClub(r.tam, PEDS[calidad], nivelRumba(hora)));

describe('discotecas por dentro: cupos', () => {
  it('a medianoche en Alta: 40 o más en los grandes, 28 en los medianos y 16 en los bares', () => {
    expect(cupoClub('grande', PEDS.alta, nivelRumba(0))).toBeGreaterThanOrEqual(40);
    expect(cupoClub('mediano', PEDS.alta, nivelRumba(0))).toBeGreaterThanOrEqual(28);
    expect(cupoClub('bar', PEDS.alta, nivelRumba(0))).toBeGreaterThanOrEqual(16);
  });

  it('Ultra más, Baja pocos; de día nadie; temprano menos que a medianoche', () => {
    for (const tam of ['grande', 'mediano', 'bar']) {
      const n = (k, h = 0) => cupoClub(tam, PEDS[k], nivelRumba(h));
      expect(n('ultra')).toBeGreaterThan(n('alta'));
      expect(n('alta')).toBeGreaterThan(n('media'));
      expect(n('media')).toBeGreaterThan(n('baja'));
      expect(n('baja')).toBeLessThanOrEqual(16);
      expect(n('alta', 12)).toBe(0);
      expect(n('alta', 5)).toBe(0);
      expect(n('alta', 19.5)).toBeGreaterThan(0);
      expect(n('alta', 19.5)).toBeLessThan(n('alta', 23));
      expect(n('alta', 23)).toBe(n('alta', 0.5));
    }
    expect(CLUB_CUPO.map(([p]) => p)).toEqual([56, 44, 34, 0]);
  });

  enCiudad('la gente que se arma de verdad llega a la meta en los ocho locales (Alta, medianoche)', () => {
    const meta = { grande: 40, mediano: 28, bar: 16 };
    for (const r of C.interiors) expect(llena(r).personas.length, r.id).toBeGreaterThanOrEqual(meta[r.tam]);
  });
});

describe('discotecas por dentro: quién hay según el local', () => {
  const cuenta = (g, rol) => g.personas.filter((p) => p.rol === rol).length;

  enCiudad('cada tema tiene su ambiente y cada local su personal', () => {
    expect(Object.keys(AMBIENTES).sort()).toEqual([...new Set(Object.values(PLANES).map((p) => p.tema))].sort());
    for (const id of ['flow92', 'neon92', 'bajocero']) {
      const g = llena(byId(id));
      expect(cuenta(g, 'dj'), id).toBe(1);
      expect(cuenta(g, 'bartender'), id).toBe(2);
      expect(cuenta(g, 'meseros') + cuenta(g, 'mesero'), id).toBe(2);
      expect(cuenta(g, 'vip'), id).toBeGreaterThanOrEqual(6);
      expect(cuenta(g, 'baile'), id).toBeGreaterThanOrEqual(14);
      expect(cuenta(g, 'musico'), id).toBe(0);
    }
    expect(cuenta(llena(byId('bajocero')), 'bailarin')).toBe(2);
    expect(cuenta(llena(byId('flow92')), 'bailarin')).toBe(0);
    // Orquesta en la salsoteca (cinco) y trío en el bar de son.
    const clave = llena(byId('laclave'));
    expect(clave.personas.filter((p) => p.rol === 'musico').map((p) => p.inst).sort()).toEqual(['congas', 'maracas', 'piano', 'timbales', 'voz']);
    expect(cuenta(clave, 'dj')).toBe(0);
    const son = llena(byId('saborson'));
    expect(son.personas.filter((p) => p.rol === 'musico').map((p) => p.inst).sort()).toEqual(['bongó', 'maracas', 'voz']);
    // Animador (con micrófono) en la fonda; rockola y billar en la cantina.
    const fonda = llena(byId('laruana'));
    expect(cuenta(fonda, 'animador')).toBe(1);
    expect(fonda.personas.find((p) => p.rol === 'animador').prop).toBe('micro');
    const cantina = llena(byId('compadres'));
    expect(cuenta(cantina, 'billar')).toBe(2);
    expect(cuenta(cantina, 'rockola')).toBe(1);
    expect(cuenta(cantina, 'dj')).toBe(0);
    expect(cuenta(llena(byId('elguaro')), 'rockola')).toBe(1);
  });

  enCiudad('en todos hay quien atienda, gente en la barra, en las mesas y bailando', () => {
    for (const r of C.interiors) {
      const g = llena(r);
      expect(cuenta(g, 'bartender'), r.id).toBeGreaterThanOrEqual(1);
      expect(cuenta(g, 'barra'), r.id).toBeGreaterThanOrEqual(2);
      expect(cuenta(g, 'mesa'), r.id).toBeGreaterThanOrEqual(2);
      expect(cuenta(g, 'baile'), r.id).toBeGreaterThanOrEqual(2);
      // El reparto suma el cupo.
      const n = cupoClub(r.tam, PEDS.alta, 1);
      expect(Object.values(repartoClub(r, n)).reduce((a, b) => a + b, 0), r.id).toBe(n);
      // Los que bailan llevan el estilo del local (o el vaivén de la música popular).
      const estilo = tempoDe(r).estilo;
      for (const p of g.personas.filter((q) => q.rol === 'baile')) expect([estilo, 'abrazo', 'popular']).toContain(p.estilo);
    }
  });

  enCiudad('con poca gente (Baja, o temprano) sigue habiendo quien atienda y nadie baila solo en una salsoteca vacía', () => {
    for (const r of C.interiors) {
      const g = llena(r, 'baja');
      expect(g.personas.length, r.id).toBeGreaterThanOrEqual(6);
      expect(g.personas.length, r.id).toBeLessThanOrEqual(16);
      expect(cuenta(g, 'bartender'), r.id).toBeGreaterThanOrEqual(1);
      const temprano = llena(r, 'alta', 19.2);
      expect(temprano.personas.length, r.id).toBeLessThan(llena(r).personas.length);
      expect(cuenta(temprano, 'bartender'), r.id).toBeGreaterThanOrEqual(1);
    }
  });
});

describe('discotecas por dentro: parejas y rondas', () => {
  enCiudad('en la salsoteca casi todos bailan en pareja, hombre y mujer, frente a frente', () => {
    for (const id of ['laclave', 'saborson']) {
      const g = llena(byId(id));
      const bailan = g.personas.filter((p) => p.rol === 'baile');
      const enPareja = bailan.filter((p) => p.pareja >= 0);
      expect(enPareja.length, id).toBeGreaterThanOrEqual(bailan.length - 1);
      expect(enPareja.length, id).toBeGreaterThanOrEqual(8);
      for (const p of enPareja) {
        const q = g.personas[p.pareja];
        expect(q.pareja).toBe(p.i);
        expect(q.unidad).toBe(p.unidad);
        expect(p.female).not.toBe(q.female);
        expect(p.lider).toBe(!p.female);
        expect(p.estilo).toBe('salsa');
        // A la distancia del agarre y mirándose.
        expect(Math.hypot(p.lx - q.lx, p.lz - q.lz)).toBeCloseTo(BAILE.SALSA_DIST, 5);
        const d = Math.hypot(q.lx - p.lx, q.lz - p.lz);
        expect(((q.lx - p.lx) / d) * p.dx + ((q.lz - p.lz) / d) * p.dz).toBeCloseTo(1, 5);
      }
    }
  });

  enCiudad('en el reguetón hay parejas y rondas que se miran al centro; en la electrónica los solos miran a la cabina', () => {
    const g = llena(byId('flow92'));
    const rondas = g.unidades.map((u, k) => ({ u, k })).filter((o) => o.u.tipo === 'ronda');
    expect(rondas.length).toBeGreaterThanOrEqual(2);
    for (const { u, k } of rondas) {
      const ms = g.personas.filter((p) => p.unidad === k);
      expect(ms.length).toBe(u.n);
      expect(ms.length).toBeGreaterThanOrEqual(3);
      expect(new Set(ms.map((p) => p.female)).size).toBe(2); // mixta
      for (const p of ms) {
        const d = Math.hypot(u.cx - p.lx, u.cz - p.lz);
        expect(((u.cx - p.lx) / d) * p.dx + ((u.cz - p.lz) / d) * p.dz).toBeCloseTo(1, 5);
      }
    }
    expect(g.unidades.filter((u) => u.tipo === 'pareja').length).toBeGreaterThanOrEqual(2);
    const r = byId('neon92');
    const solos = llena(r).personas.filter((p) => p.rol === 'baile' && p.unidad >= 0 && p.pareja < 0 && p.estilo === 'electronica');
    const cab = r.spots.cabina[0];
    const alDj = solos.filter((p) => (cab.lx - p.lx) * p.dx + (cab.lz - p.lz) * p.dz > 0);
    expect(alDj.length).toBeGreaterThanOrEqual(Math.min(4, solos.length));
  });

  enCiudad('en la fonda y los bares hay abrazos de lado (hombro con hombro, mirando al mismo lado)', () => {
    for (const id of ['laruana', 'compadres', 'elguaro']) {
      const g = llena(byId(id));
      const ab = g.personas.filter((p) => p.estilo === 'abrazo');
      expect(ab.length, id).toBeGreaterThanOrEqual(2);
      for (const p of ab) {
        const q = g.personas[p.pareja];
        expect(Math.hypot(p.lx - q.lx, p.lz - q.lz)).toBeCloseTo(BAILE.ABRAZO_DIST, 5);
        expect(p.dx * q.dx + p.dz * q.dz).toBeCloseTo(1, 5);
        // El que lleva queda a la izquierda del otro (su derecha da al amigo).
        if (p.lider) expect((q.lx - p.lx) * p.dz + (q.lz - p.lz) * -p.dx).toBeLessThan(0);
      }
    }
  });
});

describe('discotecas por dentro: nadie estorba ni queda metido en un mueble', () => {
  enCiudad('los de pie no tocan muebles, nadie tapa la puerta ni la escalera y hay espacio entre todos', () => {
    for (const r of C.interiors) {
      const g = llena(r, 'ultra');
      const zonas = zonasLibres(r);
      for (const p of g.personas) {
        expect(Number.isFinite(p.x) && Number.isFinite(p.z) && Number.isFinite(p.y), r.id).toBe(true);
        expect(p.lx, r.id).toBeGreaterThan(r.X0 + 0.2);
        expect(p.lx, r.id).toBeLessThan(r.X1 - 0.2);
        expect(p.lz, r.id).toBeGreaterThan(r.Z0 + 0.2);
        expect(p.lz, r.id).toBeLessThan(r.Z1 - 0.2);
        expect(Math.hypot(p.dx, p.dz), `${r.id} ${p.rol}`).toBeCloseTo(1, 5);
        // Parado en un piso de verdad (salón, tarima, plataforma o mezanine); el sentado, a la altura de su asiento.
        const piso = alturaInterior(r, p.lx, p.lz, p.y + 0.2);
        if (!p.sentado) expect(Math.abs(piso - p.y), `${r.id} ${p.rol} y`).toBeLessThan(0.02);
        else expect(p.y - piso, `${r.id} ${p.rol} asiento`).toBeLessThan(0.4);
        if (p.sentado) continue;
        for (const z of zonas) expect(p.lx >= z.x0 && p.lx <= z.x1 && p.lz >= z.z0 && p.lz <= z.z1 && Math.abs(p.y - r.y0) < 0.1, `${r.id} ${p.rol} en zona libre`).toBe(false);
        for (const it of r.items) {
          if (!it.solid || it.y > p.y + 1 || it.y + it.h < p.y + 0.1) continue;
          const m = 0.12;
          expect(p.lx > it.x0 - m && p.lx < it.x1 + m && p.lz > it.z0 - m && p.lz < it.z1 + m, `${r.id}: ${p.rol} dentro de ${it.t}`).toBe(false);
        }
      }
      for (const a of g.personas)
        for (const b of g.personas) {
          if (b.i <= a.i || Math.abs(a.y - b.y) > 0.6) continue;
          const d = Math.hypot(a.lx - b.lx, a.lz - b.lz);
          expect(d, `${r.id}: ${a.rol} y ${b.rol}`).toBeGreaterThan(a.pareja === b.i ? 0.4 : 0.42);
        }
    }
  });

  enCiudad('los que bailan quedan en la pista (o cerca) y no en el pasillo de la puerta', () => {
    for (const r of C.interiors) {
      const p = r.pista;
      for (const q of llena(r).personas.filter((o) => o.rol === 'baile')) {
        expect(ocupado(r, q.lx, q.lz, 0.15), r.id).toBe(false);
        if (!p) continue;
        const m = GENTE.BORDE_PISTA + GENTE.RADIO + 0.6;
        expect(q.lx > p.x0 - m && q.lx < p.x1 + m && q.lz > p.z0 - m && q.lz < p.z1 + m, r.id).toBe(true);
      }
    }
  });

  enCiudad('en la barra: de pie entre los bancos o sentados en un banco, sin encimarse', () => {
    for (const r of C.interiors) {
      for (const it of r.items.filter((o) => o.t === 'barra')) {
        const ps = puestosBarra(it);
        expect(ps.length, r.id).toBeGreaterThanOrEqual(2);
        for (const a of ps) for (const b of ps) if (a !== b) expect(Math.hypot(a.lx - b.lx, a.lz - b.lz), r.id).toBeGreaterThan(0.6);
        // Todos del lado de los clientes, mirando el mostrador.
        for (const a of ps) expect(a.lx >= it.x0 && a.lx <= it.x1 && a.lz >= it.z0 && a.lz <= it.z1).toBe(false);
      }
    }
  });

  it('apartarse: solo cerca del jugador, alejándose de él y con tope', () => {
    const o = { x: 0, z: 0 };
    expect(apartarse(2, 0, 0.7, 0.5, o)).toEqual({ x: 0, z: 0 });
    apartarse(0.3, 0, 0.7, 0.5, o);
    expect(o.x).toBeCloseTo(0.4, 6);
    expect(o.z).toBe(0);
    apartarse(0, -0.1, 0.7, 0.25, o);
    expect(o.z).toBeCloseTo(-0.25, 6);
  });
});

describe('discotecas por dentro: tempo y compás', () => {
  it('tempos por estilo y cuenta de 8 en la salsa', () => {
    expect(TEMPOS.regueton.bpm).toBeCloseTo(95, 0);
    expect(TEMPOS.salsa.bpm).toBeCloseTo(95, 0);
    expect(TEMPOS.salsa.cuentas).toBe(2);
    expect(TEMPOS.popular.bpm).toBeCloseTo(120, 0);
    expect(TEMPOS.electronica.bpm).toBeCloseTo(126, 0);
    expect(tiempos(60, 95)).toBeCloseTo(95, 6);
    // Salsa: el compás de 8 cuentas dura 4 tiempos.
    const t8 = (4 * 60) / TEMPOS.salsa.bpm;
    expect(compas(t8 * 0.5, TEMPOS.salsa).cuenta).toBeCloseTo(4, 6);
    expect(compas(t8 * 3.25, TEMPOS.salsa).compas).toBe(3);
    expect(compas(t8 * 3.25, TEMPOS.salsa).cuenta).toBeCloseTo(2, 6);
    // El golpe cae en cada tiempo.
    expect(compas(60 / 126, TEMPOS.electronica).golpe).toBeCloseTo(1, 6);
    expect(compas(30 / 126, TEMPOS.electronica).golpe).toBeCloseTo(0, 6);
  });

  enCiudad('cada local baila lo suyo', () => {
    const e = (id) => tempoDe(byId(id)).estilo;
    expect(e('flow92')).toBe('regueton');
    expect(e('bajocero')).toBe('regueton');
    expect(e('neon92')).toBe('electronica');
    expect(e('laclave')).toBe('salsa');
    expect(e('saborson')).toBe('salsa');
    for (const id of ['laruana', 'compadres', 'elguaro']) expect(e(id)).toBe('popular');
    for (const r of C.interiors) expect(ESTILOS).toContain(tempoDe(r).estilo);
  });
});

describe('discotecas por dentro: bailes por código', () => {
  const P = { id: 7, energia: 1, espejo: 1, unidad: 3, cuentas: 2, alto: 1.7, altoPareja: 1.6 };

  it('todas las poses dan números finitos, los pies no se hunden y las manos quedan al alcance', () => {
    const o = nuevaPose();
    for (const estilo of [...ESTILOS, 'abrazo', 'meneo'])
      for (const lider of [true, false])
        for (let b = 0; b < 130; b += 0.173) {
          poseBaile(o, estilo, b, { ...P, lider });
          for (const [k, v] of Object.entries(o)) expect(Number.isFinite(v), `${estilo} ${k}`).toBe(true);
          expect(o.piY).toBeGreaterThanOrEqual(0);
          expect(o.pdY).toBeGreaterThanOrEqual(0);
          expect(Math.abs(o.hx)).toBeLessThan(0.12);
          expect(o.hy).toBeGreaterThan(-0.14);
          expect(o.hy).toBeLessThan(0.1);
          for (const s of ['bi', 'bd']) {
            expect(o[`${s}W`]).toBeGreaterThanOrEqual(0);
            expect(o[`${s}W`]).toBeLessThanOrEqual(1);
            // Desde el hombro: al alcance del brazo.
            if (o[`${s}W`] > 0 && !o[`${s}A`]) expect(Math.hypot(o[`${s}X`] - (s === 'bi' ? 0.19 : -0.19), o[`${s}Y`], o[`${s}Z`])).toBeLessThan(0.62);
          }
        }
    for (let t = 0; t < 40; t += 0.31) {
      for (const f of [() => poseDJ(o, t, P), () => poseBartender(o, t, P), () => poseSentado(o, t, P), () => poseCubrirse(o, 1, t), () => poseBillar(o, t, { ...P, tira: true }), ...['congas', 'timbales', 'bongó', 'piano', 'voz', 'maracas', 'animador'].map((i) => () => poseMusico(o, i, t, P))]) {
        poseBaile(o, 'meneo', 0, P);
        f();
        for (const v of Object.values(o)) expect(Number.isFinite(v)).toBe(true);
      }
    }
  });

  it('reguetón: rebota con el bajo (abajo en el tiempo) y la cadera va de lado a lado cada dos tiempos; al espejo, al revés', () => {
    const o = nuevaPose();
    const en = (b, espejo = 1) => ({ ...poseBaile(o, 'regueton', b, { ...P, espejo }) });
    expect(en(4).hy).toBeLessThan(en(4.5).hy - 0.03);
    expect(en(4).hx).toBeGreaterThan(0.03);
    expect(en(5).hx).toBeLessThan(-0.03);
    expect(en(4, -1).hx).toBeCloseTo(-en(4).hx, 9);
    expect(en(4, -1).cRz).toBeCloseTo(-en(4).cRz, 9);
    // El talón que se levanta es el del pie sin peso.
    expect(en(4).pdT).toBeGreaterThan(0.2);
    expect(en(4).piT).toBe(0);
  });

  it('electrónica: salta entre tiempo y tiempo, y en la caída del bajo todos suben las dos manos', () => {
    const o = nuevaPose();
    const en = (b) => ({ ...poseBaile(o, 'electronica', b, P) });
    expect(en(20.5).hy).toBeGreaterThan(en(20).hy + 0.04);
    expect(caidaElectronica(8)).toBeCloseTo(1, 6);
    expect(caidaElectronica(40)).toBe(0);
    const arriba = en(8);
    expect(arriba.biW).toBeCloseTo(1, 6);
    expect(arriba.bdW).toBeCloseTo(1, 6);
    expect(arriba.biY).toBeGreaterThan(0.25);
    expect(arriba.bdY).toBeGreaterThan(0.25);
  });

  it('salsa: paso básico en 8 (1-2-3 adelante con el izquierdo, 5-6-7 atrás con el derecho, pausa en 4 y 8)', () => {
    const s = (c) => ({ ...pasoSalsa(c) });
    expect(s(0).pi).toBe(0);
    expect(s(0.99).pi).toBeCloseTo(1, 6);
    expect(s(1.5).pi).toBe(1);
    expect(s(2.99).pi).toBeCloseTo(0, 6);
    expect(s(3.5).pi).toBe(0);
    expect(s(3.5).pd).toBe(0);
    expect(s(4.99).pd).toBeCloseTo(-1, 6);
    expect(s(6.99).pd).toBeCloseTo(0, 6);
    expect(s(7.5).pd).toBe(0);
    // Pausas: en 4 y en 8 nada se mueve.
    for (const c of [3.7, 3.9, 7.7, 7.9]) {
      expect(s(c).z).toBeCloseTo(0, 6);
      expect(s(c).li + s(c).ld).toBe(0);
    }
    // El pie solo se levanta mientras se mueve y el cuerpo va y vuelve sin saltos.
    for (let c = 0; c < 8; c += 0.01) {
      const a = s(c);
      const b = s(c + 0.01);
      expect(Math.abs(a.z - b.z)).toBeLessThan(0.03);
      expect(Math.abs(a.pi - b.pi)).toBeLessThan(0.05);
      expect(Math.abs(a.peso - b.peso)).toBeLessThan(0.08);
      expect(a.li).toBeGreaterThanOrEqual(0);
    }
    // Ella hace lo mismo corrido medio compás: cuando él va adelante, ella va atrás.
    for (const c of [0.5, 1.2, 4.6, 5.5]) expect(s(c + 4).z).toBeCloseTo(-s(c).z, 9);
  });

  it('salsa en pareja: se mueven como una unidad y las manos se encuentran en el mismo punto', () => {
    const o = nuevaPose();
    const D = BAILE.SALSA_DIST;
    let conVuelta = 0;
    for (let b = 0; b < 64; b += 0.11) {
      const k = Math.floor((b * 2) / 8);
      const el = { ...poseBaile(o, 'salsa', b, { ...P, lider: true }) };
      const ella = { ...poseBaile(o, 'salsa', b, { ...P, lider: false }) };
      if (hayVuelta(P.unidad, k)) {
        conVuelta++;
        continue;
      }
      // En el eje de la pareja (él en -D/2 mirando a +, ella en +D/2 mirando a -): lo que él avanza, ella lo retrocede.
      expect(el.hz + ella.hz).toBeCloseTo(0, 9);
      expect(ella.yaw).toBe(0);
      // Mano A: la izquierda de él con la derecha de ella. Mano B: al revés.
      expect(-D / 2 + el.biZ).toBeCloseTo(D / 2 - ella.bdZ, 6);
      expect(el.biX).toBeCloseTo(-ella.bdX, 6);
      expect(el.biY).toBeCloseTo(ella.bdY, 6);
      expect(-D / 2 + el.bdZ).toBeCloseTo(D / 2 - ella.biZ, 6);
      expect(el.bdX).toBeCloseTo(-ella.biX, 6);
      expect(el.bdY).toBeCloseTo(ella.biY, 6);
      expect(el.biA + el.bdA + ella.biA + ella.bdA).toBe(4);
    }
    expect(conVuelta).toBeGreaterThan(20); // de vez en cuando hay vuelta
  });

  it('la vuelta: ella gira una vuelta entera entre el 5 y el 7 bajo el brazo de él, y sueltan la otra mano', () => {
    expect(giroVuelta(3)).toBeCloseTo(0, 9);
    expect(giroVuelta(4.2)).toBeCloseTo(0, 9);
    expect(giroVuelta(5.6)).toBeCloseTo(-Math.PI, 6);
    expect(giroVuelta(7)).toBeCloseTo(-Math.PI * 2, 9);
    let k = 0;
    while (!hayVuelta(P.unidad, k)) k++;
    const o = nuevaPose();
    const b = (k * 8 + 5.6) / 2;
    const el = { ...poseBaile(o, 'salsa', b, { ...P, lider: true }) };
    const ella = { ...poseBaile(o, 'salsa', b, { ...P, lider: false }) };
    expect(ella.yaw).toBeCloseTo(-Math.PI, 3);
    expect(el.yaw).toBe(0);
    expect(el.biY).toBeGreaterThan(P.altoPareja + 0.1); // la mano de él, sobre la cabeza de ella
    expect(ella.bdY).toBeGreaterThan(P.alto + 0.1);
    expect(el.bdW).toBeLessThan(0.05);
    expect(ella.biW).toBeLessThan(0.05);
    // La frecuencia de las vueltas es la configurada (más o menos).
    let n = 0;
    for (let q = 0; q < 600; q++) if (hayVuelta(5, q)) n++;
    expect(n / 600).toBeGreaterThan(0.6 / BAILE.SALSA_VUELTA_CADA);
    expect(n / 600).toBeLessThan(1.5 / BAILE.SALSA_VUELTA_CADA);
  });

  it('música popular: vaivén lento y brindis con el vaso arriba (todo el grupo a la vez)', () => {
    const o = nuevaPose();
    const en = (b, extra = {}) => ({ ...poseBaile(o, 'popular', b, { ...P, ...extra }) });
    // Un vaivén cada 4 tiempos.
    expect(en(0).hx).toBeGreaterThan(0.03);
    expect(en(2).hx).toBeLessThan(-0.03);
    let hubo = 0;
    for (let b = 0; b < BAILE.POPULAR_BRINDIS_CADA; b += 0.25) {
      const br = brindis(b, 3);
      expect(br).toBeGreaterThanOrEqual(0);
      expect(br).toBeLessThanOrEqual(1);
      if (br > 0.95) {
        hubo++;
        // El vaso (mano derecha) por encima del hombro; el mismo grupo brinda a la vez.
        expect(en(b, { id: 1 }).bdY).toBeGreaterThan(0.3);
        expect(en(b, { id: 99 }).bdY).toBeGreaterThan(0.3);
      } else if (br < 0.01) expect(en(b).bdY).toBeLessThan(0);
    }
    expect(hubo).toBeGreaterThan(4);
    expect(hubo).toBeLessThan(BAILE.POPULAR_BRINDIS_CADA); // no todo el tiempo
  });

  it('DJ: una mano en la consola y, en los cambios, el brazo arriba', () => {
    const o = nuevaPose();
    poseBaile(o, 'meneo', 0, P);
    const quieto = { ...poseDJ(o, 12.3, { ...P, consolaY: 1.12, consolaZ: 0.6 }) };
    expect(cambioDJ(12.3)).toBe(0);
    expect(quieto.bdY).toBeCloseTo(1.17, 1);
    expect(quieto.bdZ).toBeGreaterThan(0.5);
    const cambio = { ...poseDJ(o, BAILE.DJ_CAMBIO_CADA + 2, { ...P, consolaY: 1.12, consolaZ: 0.6 }) };
    expect(cambioDJ(BAILE.DJ_CAMBIO_CADA + 2)).toBeCloseTo(1, 6);
    expect(cambio.bdY).toBeGreaterThan(P.alto + 0.1);
  });
});

describe('discotecas por dentro: salida en un susto', () => {
  enCiudad('todos los que corren llegan al andén sin atravesar muros ni muebles', () => {
    for (const r of C.interiors) {
      const S = salidaDe(r);
      const corren = llena(r, 'ultra').personas.filter((p) => p.panico === 'correr');
      expect(corren.length, r.id).toBeGreaterThan(4);
      for (const p of corren) {
        const e = { lx: p.lx, lz: p.lz, y: p.y, k: -1, carril: ((p.i % 5) - 2) / 2, dx: 0, dz: 0 };
        let fuera = false;
        for (let n = 0; n < 900 && !fuera; n++) {
          fuera = pasoSalida(r, S, e, 0.15);
          // Adentro del salón (o en el vano de la puerta / ya afuera, frente a ella).
          const enSalon = e.lx > r.X0 && e.lx < r.X1 && e.lz > r.Z0 && e.lz < r.Z1 + 0.01;
          const enPuerta = e.lx > r.door.x0 && e.lx < r.door.x1 && e.lz >= r.Z1;
          expect(enSalon || enPuerta, `${r.id} ${p.rol} se salió en (${e.lx.toFixed(2)}, ${e.lz.toFixed(2)})`).toBe(true);
          if (n < 3) continue; // (arranca pegado a su mesa alta o a la barra)
          for (const it of r.items) {
            if (!it.solid || it.walk || it.y > e.y + 1 || it.y + it.h < e.y + 0.15) continue;
            expect(e.lx > it.x0 + 0.03 && e.lx < it.x1 - 0.03 && e.lz > it.z0 + 0.03 && e.lz < it.z1 - 0.03, `${r.id}: ${p.rol} atraviesa ${it.t} en (${e.lx.toFixed(2)}, ${e.lz.toFixed(2)})`).toBe(false);
          }
        }
        expect(fuera, `${r.id} ${p.rol} no salió (quedó en ${e.lx.toFixed(2)}, ${e.lz.toFixed(2)}, k ${e.k})`).toBe(true);
        expect(e.lz).toBeGreaterThan(1.5);
        expect(Math.abs(e.lx)).toBeLessThan(1.1);
      }
    }
  });

  enCiudad('en el sótano la salida sube la escalera hasta el nivel de la puerta', () => {
    const r = byId('laclave');
    const S = salidaDe(r);
    const p = llena(r).personas.find((q) => q.rol === 'baile');
    const e = { lx: p.lx, lz: p.lz, y: p.y, k: -1, carril: 0, dx: 0, dz: 0 };
    expect(p.y).toBeCloseTo(r.y0, 6);
    let maxSalto = 0;
    for (let n = 0; n < 900; n++) {
      const y0 = e.y;
      if (pasoSalida(r, S, e, 0.1)) break;
      maxSalto = Math.max(maxSalto, Math.abs(e.y - y0));
    }
    expect(e.y).toBeCloseTo(r.floorY, 1);
    expect(maxSalto).toBeLessThan(0.45); // sube de escalón en escalón
  });

  enCiudad('la rejilla deja pasar del fondo a la puerta y los meseros tienen ruta entre sus puntos', () => {
    for (const r of C.interiors) {
      const g = rejilla(r);
      expect(g.libre.reduce((a, b) => a + b, 0), r.id).toBeGreaterThan(g.libre.length * 0.3);
      const campo = campoHacia(g, 0, r.Z1 - 0.6);
      const mesero = llena(r).personas.find((p) => p.rol === 'mesero');
      expect(mesero, r.id).toBeTruthy();
      expect(mesero.paradas.length, r.id).toBeGreaterThanOrEqual(1);
      for (let k = 0; k + 1 < mesero.paradas.length; k++) {
        const a = mesero.paradas[k];
        const b = mesero.paradas[k + 1];
        const ruta = rutaEntre(g, a.lx, a.lz, b.lx, b.lz);
        expect(ruta, r.id).toBeTruthy();
        expect(Math.hypot(ruta[ruta.length - 1].x - b.lx, ruta[ruta.length - 1].z - b.lz), r.id).toBeLessThan(0.8);
      }
      expect(campo.dist.some((d) => d > 100)).toBe(true);
    }
  });

  enCiudad('rutaEntre guarda el campo de cada parada en la rejilla: la misma ruta sin recalcularlo, con tope', () => {
    const r = byId('flow92');
    const g = rejilla(r);
    const [a, b] = llena(r).personas.find((p) => p.rol === 'mesero').paradas;
    const sinCache = rutaEntre(rejilla(r), a.lx, a.lz, b.lx, b.lz);
    const ruta1 = rutaEntre(g, a.lx, a.lz, b.lx, b.lz);
    const campo = g.campos.get(`${b.lx},${b.lz}`);
    const ruta2 = rutaEntre(g, a.lx + 0.4, a.lz, b.lx, b.lz);
    expect(ruta1).toEqual(sinCache);
    expect(g.campos.size).toBe(1);
    expect(g.campos.get(`${b.lx},${b.lz}`)).toBe(campo);
    expect(ruta2[ruta2.length - 1]).toEqual(ruta1[ruta1.length - 1]);
    for (let k = 0; k < RUTAS.CAMPOS_GUARDADOS + 5; k++) rutaEntre(g, a.lx, a.lz, b.lx + (k % 3) * 0.1, b.lz - k * 0.05);
    expect(g.campos.size).toBeLessThanOrEqual(RUTAS.CAMPOS_GUARDADOS);
  });
});

describe('discotecas por dentro: determinismo', () => {
  enCiudad('mismo local, mismo cupo y misma semilla: la misma gente; otra semilla, otra', () => {
    for (const r of C.interiors) {
      const a = armarGente(r, 30, 5);
      const b = armarGente(r, 30, 5);
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
      const c = armarGente(r, 30, 6);
      expect(JSON.stringify(a.personas.map((p) => [p.lx, p.lz]))).not.toBe(JSON.stringify(c.personas.map((p) => [p.lx, p.lz])));
    }
  });

  it('los bailes no dependen del azar: mismo tiempo y misma persona, misma pose', () => {
    const o1 = nuevaPose();
    const o2 = nuevaPose();
    for (const estilo of ESTILOS) {
      poseBaile(o1, estilo, 37.3, { id: 4, lider: true, unidad: 2, cuentas: 2 });
      poseBaile(o2, 'popular', 2, { id: 9 });
      poseBaile(o2, estilo, 37.3, { id: 4, lider: true, unidad: 2, cuentas: 2 });
      expect(o2).toEqual(o1);
    }
  });
});
