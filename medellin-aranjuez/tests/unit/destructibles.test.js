// Postes, faroles, placas y árboles que se tumban con el vehículo
// (sim/destructibles.js): registro caja → objeto, umbrales por tipo, caída
// con rebote hasta el piso y reposición lejos del jugador.
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { CollisionWorld } from '../../src/sim/collision.js';
import { createVehicleState, stepVehicle } from '../../src/sim/vehiclePhysics.js';
import {
  Destructibles,
  velocidadParaTumbar,
  velocidadQueQueda,
  TUMBABLES,
  VEL_TUMBA_POSTE,
  VEL_TUMBA_ARBOL,
  ARBOL_ESCALA_FIRME,
  ARBOL_ALTO_FIRME,
  MAX_CAYENDO,
  TIEMPO_TUMBADO,
  DIST_REPONER,
  DE_PIE,
  CAYENDO,
  TUMBADO,
} from '../../src/sim/destructibles.js';
import { city } from './helpers.js';
import { ChunkedInstances } from '../../src/render/props.js';
import { DestructiblesView, fallMatrix } from '../../src/render/destructibles.js';

/** Mundo plano con utilería suelta (cajas como las de addPropCollider) y paredes. */
function mundo(props, paredes = []) {
  const collision = new CollisionWorld(8);
  for (const w of paredes) collision.add({ ...w, kind: 'building' });
  for (const p of props) collision.add({ minX: p.x - p.collider.hx, maxX: p.x + p.collider.hx, minZ: p.z - p.collider.hz, maxZ: p.z + p.collider.hz, kind: p.type });
  const reg = new Destructibles({ props, collision }, { groundHeight: () => 0 });
  const env = { groundHeight: () => 0, collision, breakables: reg, bounds: { minX: -1e6, maxX: 1e6, minZ: -1e6, maxZ: 1e6 } };
  return { collision, reg, env };
}

const poste = (x, z) => ({ type: 'pole', x, z, h: 9, collider: { hx: 0.15, hz: 0.15 } });
const arbol = (x, z, scale = 1, kind = 'mango') => ({ type: 'tree', kind, x, z, scale, collider: { hx: 0.25, hz: 0.25 } });

/** Vehículo que va hacia -Z (rumbo 0) a `vel` m/s desde (0, z0) con el acelerador a fondo. */
function lanzar(tipo, vel, env, z0 = 0, segundos = 1.2) {
  const v = createVehicleState(tipo, 0, z0, 0, () => 0);
  v.vz = -vel;
  v.forwardSpeed = vel;
  let minVel = vel;
  for (let i = 0; i < Math.round(segundos * 60); i++) {
    stepVehicle(v, { throttle: 0.3, brake: 0, steer: 0, handbrake: false }, 1 / 60, env);
    minVel = Math.min(minVel, Math.hypot(v.vx, v.vz));
  }
  return { v, minVel };
}

describe('registro de utilería tumbable', () => {
  it('casa cada colisionador de la ciudad con su objeto, en O(1) por el id de la caja', () => {
    const c = city();
    const n = c.props.filter((p) => p.collider && TUMBABLES[p.type]).length;
    const reg = new Destructibles(c);
    expect(reg.entries.length).toBe(n);
    expect(n).toBeGreaterThan(5000);
    for (const e of reg.entries.slice(0, 400)) {
      expect(reg.entryOf(e.box)).toBe(e);
      expect(e.box.kind).toBe(e.prop.type);
      expect(Math.abs((e.box.minX + e.box.maxX) / 2 - e.prop.x)).toBeLessThan(1e-6);
      expect(Math.abs((e.box.minZ + e.box.maxZ) / 2 - e.prop.z)).toBeLessThan(1e-6);
    }
    // Lo que no se tumba (edificios, sillas, semáforos) no tiene entrada.
    const otra = c.collision.boxes.find((b) => b.kind === 'building');
    expect(reg.entryOf(otra)).toBe(null);
    expect(reg.entryOf(c.collision.boxes.find((b) => b.kind === 'trafficLight'))).toBe(null);
    // Armar el registro no toca la ciudad.
    expect(reg.stats().tumbados).toBe(0);
  });

  it('la rejilla quita y devuelve una caja sin reconstruirse ni duplicarla', () => {
    const collision = new CollisionWorld(8);
    const b = collision.add({ minX: 7.9, maxX: 8.2, minZ: -0.1, maxZ: 0.2, kind: 'pole' }); // toca 4 celdas
    collision.add({ minX: 20, maxX: 21, minZ: 0, maxZ: 1, kind: 'building' });
    const cells = collision.cells.size;
    expect(collision.pointBlocked(8, 0)).toBe(true);
    expect(collision.remove(b)).toBe(true);
    expect(collision.pointBlocked(8, 0)).toBe(false);
    expect(collision.query(7, -1, 9, 1)).toHaveLength(0);
    expect(collision.raycast(0, 0, 0, 1, 0, 0, 15)).toBe(null);
    expect(collision.remove(b)).toBe(false);
    expect(collision.boxes).toHaveLength(2);
    expect(collision.restore(b)).toBe(true);
    expect(collision.restore(b)).toBe(false);
    expect(collision.query(7, -1, 9, 1)).toEqual([b]);
    expect(collision.pointBlocked(8, 0)).toBe(true);
    expect(collision.cells.size).toBe(cells);
  });
});

describe('quién tumba qué', () => {
  it('umbrales por tipo: postes y placas con carro o moto, árboles solo con carro y no los muy grandes', () => {
    for (const t of ['pole', 'lamp', 'parkLamp', 'streetSign']) {
      expect(velocidadParaTumbar(t, { dosRuedas: false })).toBe(VEL_TUMBA_POSTE);
      expect(velocidadParaTumbar(t, { dosRuedas: true })).toBe(VEL_TUMBA_POSTE);
    }
    expect(velocidadParaTumbar('tree', { dosRuedas: false, escala: 1 })).toBe(VEL_TUMBA_ARBOL);
    expect(VEL_TUMBA_ARBOL).toBeGreaterThan(VEL_TUMBA_POSTE);
    expect(velocidadParaTumbar('tree', { dosRuedas: true, escala: 1 })).toBe(Infinity);
    expect(velocidadParaTumbar('tree', { dosRuedas: false, escala: ARBOL_ESCALA_FIRME })).toBe(Infinity);
    expect(velocidadParaTumbar('tree', { dosRuedas: false, escala: 1, especie: 'ceiba' })).toBe(Infinity);
    expect(velocidadParaTumbar('building')).toBe(Infinity);
    expect(velocidadParaTumbar('chair')).toBe(Infinity);
    // Pierde parte de la velocidad, no toda; un bus pesado pierde menos.
    expect(velocidadQueQueda('pole', 1250)).toBeGreaterThan(0.5);
    expect(velocidadQueQueda('pole', 1250)).toBeLessThan(1);
    expect(velocidadQueQueda('pole', 5500)).toBeGreaterThan(velocidadQueQueda('pole', 1250));
  });

  it('una moto a 8 m/s tumba el poste: lo atraviesa, pierde algo de velocidad y no se frena en seco', () => {
    const { reg, collision, env } = mundo([poste(0, -6)]);
    const e = reg.entries[0];
    const { v, minVel } = lanzar('moto', 8, env);
    expect(e.estado).not.toBe(DE_PIE);
    expect(v.z).toBeLessThan(-7); // pasó por donde estaba el poste
    expect(minVel).toBeGreaterThan(8 * 0.6);
    expect(minVel).toBeLessThan(8);
    expect(v.lastImpact).toBe(0);
    expect(collision.pointBlocked(0, -6)).toBe(false);
    expect(reg.nEventos).toBeGreaterThan(0);
    expect(reg.eventos[0].tipo).toBe('golpe');
    // Cae hacia donde iba la moto (-Z).
    expect(e.dirZ).toBeLessThan(-0.9);
  });

  it('despacio no lo tumba: el vehículo choca como contra un muro', () => {
    const { reg, collision, env } = mundo([poste(0, -6)]);
    const { v } = lanzar('sedan', VEL_TUMBA_POSTE * 0.6, env, 0, 2);
    expect(reg.entries[0].estado).toBe(DE_PIE);
    expect(collision.pointBlocked(0, -6)).toBe(true);
    expect(v.z).toBeGreaterThan(-6);
  });

  it('árboles: el carro rápido lo tumba, la moto y el carro lento no, y el muy grande tampoco', () => {
    const caso = (tipo, vel, a = arbol(0, -6)) => {
      const { reg, env } = mundo([a]);
      lanzar(tipo, vel, env);
      return reg.entries[0].estado;
    };
    expect(caso('sedan', 12)).not.toBe(DE_PIE);
    expect(caso('moto', 14)).toBe(DE_PIE);
    expect(caso('sedan', VEL_TUMBA_ARBOL - 2)).toBe(DE_PIE);
    expect(caso('sedan', 14, arbol(0, -6, 1.45))).toBe(DE_PIE);
  });
});

describe('caída', () => {
  it('gira hasta el piso con un rebote corto y queda acostada', () => {
    const { reg } = mundo([poste(0, 0)]);
    const e = reg.entries[0];
    reg.tumbar(e, 1, 0, 10);
    expect(e.estado).toBe(CAYENDO);
    let maxAng = 0;
    let bajo = false;
    let tiempo = 0;
    for (let i = 0; i < 600 && e.estado === CAYENDO; i++) {
      reg.update(1 / 60, 0, 0);
      tiempo += 1 / 60;
      maxAng = Math.max(maxAng, e.ang);
      if (maxAng >= e.reposo - 1e-6 && e.ang < e.reposo - 0.02) bajo = true; // rebotó
    }
    expect(e.estado).toBe(TUMBADO);
    expect(tiempo).toBeGreaterThan(0.6);
    expect(tiempo).toBeLessThan(4);
    expect(bajo).toBe(true);
    expect(e.ang).toBeCloseTo(e.reposo, 6);
    expect(e.reposo).toBeGreaterThan(1.45);
    expect(e.reposo).toBeLessThanOrEqual(Math.PI / 2);
    // La base se arrastró un poco hacia +X y la punta quedó en el piso.
    expect(e.desliz).toBeGreaterThan(0.1);
    expect(e.desliz).toBeLessThan(3);
    const p = reg.punta(e, {});
    expect(p.x).toBeGreaterThan(8);
    expect(p.y).toBeLessThan(0.5);
    // Eventos: el golpe y el porrazo contra el piso.
    const tipos = reg.eventos.slice(0, reg.nEventos).map((ev) => ev.tipo);
    expect(tipos).toContain('golpe');
    expect(tipos).toContain('suelo');
  });

  it('contra una pared queda recostado en vez de atravesarla', () => {
    const { reg } = mundo([poste(0, 0)], [{ minX: 3, maxX: 10, minZ: -5, maxZ: 5, minY: -1, maxY: 20 }]);
    const e = reg.entries[0];
    reg.tumbar(e, 1, 0, 10);
    for (let i = 0; i < 600 && e.estado === CAYENDO; i++) reg.update(1 / 60, 0, 0);
    expect(e.estado).toBe(TUMBADO);
    expect(e.ang).toBeLessThan(0.6);
    expect(reg.punta(e, {}).x).toBeLessThan(3.3);
  });

  it('marca solo lo que cambió y no pasa del tope de objetos cayendo', () => {
    const props = [];
    for (let i = 0; i < MAX_CAYENDO + 3; i++) props.push(poste(i * 3, 0));
    const { reg } = mundo(props);
    reg.update(1 / 60, 0, 0);
    expect(reg.nCambiados).toBe(0);
    for (const e of reg.entries) reg.tumbar(e, 0, 1, 9);
    expect(reg.nCambiados).toBe(reg.entries.length);
    expect(reg.nCayendo).toBe(MAX_CAYENDO);
    // Los primeros que llegaron se asentaron de una para dejar sitio.
    expect(reg.entries[0].estado).toBe(TUMBADO);
    expect(reg.entries[2].estado).toBe(TUMBADO);
    expect(reg.entries.at(-1).estado).toBe(CAYENDO);
    reg.limpiarCambios();
    reg.update(1 / 60, 0, 0);
    expect(reg.nCambiados).toBe(MAX_CAYENDO);
  });
});

describe('reposición', () => {
  function tumbado() {
    const m = mundo([poste(0, 0)]);
    const e = m.reg.entries[0];
    m.reg.tumbar(e, 1, 0, 10);
    for (let i = 0; i < 600 && e.estado === CAYENDO; i++) m.reg.update(1 / 60, 0, 0);
    return { ...m, e };
  }
  const esperar = (reg, s, px, pz, visto) => {
    for (let t = 0; t < s; t += 0.25) reg.update(0.25, px, pz, visto);
  };

  it('vuelve a ponerse de pie, con su colisionador, cuando el jugador está lejos y no lo ve', () => {
    const { reg, collision, e } = tumbado();
    expect(collision.pointBlocked(0, 0)).toBe(false);
    esperar(reg, TIEMPO_TUMBADO * 0.5, DIST_REPONER * 2, 0, () => false);
    expect(e.estado).toBe(TUMBADO); // todavía no es hora
    esperar(reg, TIEMPO_TUMBADO, DIST_REPONER * 2, 0, () => false);
    expect(e.estado).toBe(DE_PIE);
    expect(e.ang).toBe(0);
    expect(collision.pointBlocked(0, 0)).toBe(true);
    expect(reg.cambiados.slice(0, reg.nCambiados)).toContain(e);
  });

  it('no se repone si el jugador está cerca o lo está viendo', () => {
    const cerca = tumbado();
    esperar(cerca.reg, TIEMPO_TUMBADO * 2, DIST_REPONER * 0.5, 0, () => false);
    expect(cerca.e.estado).toBe(TUMBADO);
    const visto = tumbado();
    let preguntas = 0;
    esperar(visto.reg, TIEMPO_TUMBADO * 2, DIST_REPONER * 2, 0, () => (preguntas++, true));
    expect(visto.e.estado).toBe(TUMBADO);
    expect(preguntas).toBeGreaterThan(0);
    expect(visto.collision.pointBlocked(0, 0)).toBe(false);
  });

  it('se puede volver a tumbar después de reponerse', () => {
    const { reg, e } = tumbado();
    reg.reponer(e);
    expect(reg.tumbar(e, 0, -1, 9)).toBe(true);
    expect(e.estado).toBe(CAYENDO);
    expect(reg.total).toBe(2);
  });
});

describe('enlace con el dibujo', () => {
  it('un árbol que ya dibujado mide ARBOL_ALTO_FIRME o más queda firme; uno normal no', () => {
    const { reg } = mundo([arbol(0, 0), arbol(5, 0)]);
    const [bajo, alto] = reg.entries;
    reg.enlazar(bajo, {}, ARBOL_ALTO_FIRME - 3);
    reg.enlazar(alto, {}, ARBOL_ALTO_FIRME + 0.5);
    expect(bajo.minCarro).toBe(VEL_TUMBA_ARBOL);
    expect(bajo.h).toBe(ARBOL_ALTO_FIRME - 3);
    expect(alto.minCarro).toBe(Infinity);
    // Lo que no quedó enlazado no se tumba (no se vería caer).
    const otro = mundo([poste(0, 0), poste(4, 0)]);
    otro.reg.enlazar(otro.reg.entries[0], {});
    expect(otro.reg.fijarSinDibujo()).toBe(1);
    expect(otro.reg.entries[1].minCarro).toBe(Infinity);
    expect(otro.reg.entries[0].minCarro).toBe(VEL_TUMBA_POSTE);
  });

  it('fallMatrix gira sobre la base: la base no se mueve y la punta va hacia el lado del golpe', () => {
    const e = { dirX: 0.6, dirZ: -0.8, ang: Math.PI / 2, giro: 0.4, desliz: 0, dy: 0 };
    const m = fallMatrix(e, 5, 1, 2, new THREE.Matrix4());
    const base = new THREE.Vector3(5, 1, 2).applyMatrix4(m);
    const punta = new THREE.Vector3(5, 10, 2).applyMatrix4(m);
    expect(base.distanceTo(new THREE.Vector3(5, 1, 2))).toBeLessThan(1e-9);
    expect(punta.x).toBeCloseTo(5 + 0.6 * 9, 6);
    expect(punta.y).toBeCloseTo(1, 6);
    expect(punta.z).toBeCloseTo(2 - 0.8 * 9, 6);
    // Con la base corrida, todo se corre igual.
    e.desliz = 0.5;
    e.ang = 0;
    e.giro = 0;
    const b2 = new THREE.Vector3(5, 1, 2).applyMatrix4(fallMatrix(e, 5, 1, 2, m));
    expect(b2.x).toBeCloseTo(5.3, 6);
    expect(b2.z).toBeCloseTo(1.6, 6);
  });

  it('al tumbar uno solo se reescribe SU matriz (16 números, en su trozo) y al reponerse vuelve a la original', () => {
    const props = [poste(0, 0), poste(3, 0), poste(6, 0), poste(400, 0)];
    const { reg } = mundo(props);
    const geo = new THREE.BoxGeometry(0.3, 9, 0.3).translate(0, 4.5, 0);
    geo.computeBoundingBox();
    const tpl = { key: 'poste', cerca: [{ geometry: geo, material: new THREE.MeshStandardMaterial() }], lejos: null, extras: {}, box: geo.boundingBox, height: 9 };
    const refs = new Map();
    const set = new ChunkedInstances(tpl, { perInstance: true, refs, name: 'postes' });
    for (const p of props) set.add(p.x, 0, p.z, 0, 1, 1, 1, null, null, p);
    const root = new THREE.Group();
    const lodChunks = [];
    set.build(root, lodChunks);
    expect(lodChunks.length).toBe(2); // el de x = 400 queda en otro trozo
    const head = { off: false };
    const vista = new DestructiblesView({ root, propInstances: refs, propLights: new Map([[props[1], head]]) }, reg);
    expect(vista.enlazados).toBe(4);
    expect(vista.firmes).toBe(0);
    const h = refs.get(props[1]);
    const otroTrozo = refs.get(props[3]).lc;
    const lv = h.lc.levels[0];
    const antes = Float32Array.from(h.lc.srcMatrix);
    const vOtro = otroTrozo.levels[0].matrix.version;
    lv.matrix.clearUpdateRanges();
    const e = reg.entries[1];
    reg.tumbar(e, 1, 0, 10);
    for (let i = 0; i < 20; i++) {
      reg.update(1 / 60, 0, 0);
      vista.update();
    }
    expect(reg.nCambiados).toBe(0);
    // Solo cambió la instancia 1; las otras del trozo, igual.
    const ahora = h.lc.srcMatrix;
    for (let k = 0; k < antes.length; k++) if (Math.floor(k / 16) !== h.i) expect(ahora[k]).toBe(antes[k]);
    expect(ahora[h.i * 16 + 4]).not.toBeCloseTo(antes[h.i * 16 + 4], 3); // el eje Y ya está inclinado
    for (const r of lv.matrix.updateRanges) {
      expect(r.count).toBe(16);
      expect(r.start).toBe(h.lc.slot[h.i] * 16);
    }
    expect(otroTrozo.levels[0].matrix.version).toBe(vOtro); // el otro trozo ni se toca
    // El farol se apaga mientras está tumbado y la esfera de recorte lo cubre.
    expect(head.off).toBe(true);
    const im = lv.meshes[0];
    const tip = new THREE.Vector3(props[1].x + 9, 0, 0).sub(h.group.position);
    expect(im.boundingSphere.containsPoint(tip)).toBe(true);
    reg.reponer(e);
    vista.update();
    for (let k = 0; k < antes.length; k++) expect(ahora[k]).toBe(antes[k]);
    expect(head.off).toBe(false);
  });
});
