// Las ruedas de adelante de los carros no oscilan: el giro visual copia la
// dirección (v.steer); la del jugador sigue una curva suave que no se pasa ni
// depende del tiempo entre cuadros; la del tráfico no da el latigazo al otro
// lado antes de girar (el objetivo saltaba al comienzo del carril siguiente,
// que en un giro a la derecha queda a la izquierda) ni se pasa de largo al
// salir; la rueda vira en su pivote y rueda sobre su propio eje (girada, no
// cabecea al rodar), y sin nada tumbado el brinco por rueda es cero exacto.
import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { assets } from '../../src/render/assets.js';
import { VehicleView } from '../../src/render/vehicleMesh.js';
import { VEHICLE_VARIANTS } from '../../src/sim/vehicleVariants.js';
import { createVehicleState, stepVehicle } from '../../src/sim/vehiclePhysics.js';
import { RoadGraph, autopilot, lanePoint } from '../../src/sim/roadNav.js';
import { CollisionWorld } from '../../src/sim/collision.js';
import { Destructibles } from '../../src/sim/destructibles.js';

const plano = () => {
  const collision = new CollisionWorld(8);
  return { groundHeight: () => 0, collision, bounds: { minX: -1e6, maxX: 1e6, minZ: -1e6, maxZ: 1e6 } };
};
const neutro = (steer = 0) => ({ throttle: 0, brake: 0, steer, handbrake: false });

/** Tiempos entre cuadros: fijos (20, 30 y 60 por segundo) e irregulares (1/60..1/20, semilla fija). */
function pasos(tipo, segundos) {
  if (tipo !== 'irregular') return Array.from({ length: Math.round(segundos / tipo) }, () => tipo);
  let s = 7;
  const out = [];
  for (let t = 0; t < segundos; ) {
    s = (s * 16807) % 2147483647;
    const dt = 1 / 60 + (s / 2147483647) * (1 / 20 - 1 / 60);
    out.push(dt);
    t += dt;
  }
  return out;
}
const TIEMPOS = [1 / 20, 1 / 30, 1 / 60, 'irregular'];

describe('dirección del jugador (el giro visual de las ruedas de adelante)', () => {
  for (const tipo of TIEMPOS) {
    it(`con el timón quieto converge sin pasarse ni oscilar (dt ${tipo === 'irregular' ? tipo : (1 / tipo).toFixed(0) + ' cps'})`, () => {
      // Quieto: el tope de la dirección no cambia con la rapidez.
      const v = createVehicleState('sedan', 0, 0, 0, () => 0);
      const tope = v.spec.steerMax;
      const env = plano();
      let t = 0;
      let prev = 0;
      for (const dt of pasos(tipo, 1.5)) {
        stepVehicle(v, neutro(1), dt, env);
        t += dt;
        // Sube sin pasarse: la curva exponencial exacta, sea cual sea el dt.
        expect(v.steer).toBeGreaterThanOrEqual(prev);
        expect(v.steer).toBeLessThanOrEqual(tope);
        expect(v.steer).toBeCloseTo(tope * (1 - Math.exp(-8 * t)), 9);
        prev = v.steer;
      }
      expect(v.steer).toBeGreaterThan(tope * 0.99);
      // Soltando vuelve al centro sin cruzarlo.
      t = 0;
      const desde = v.steer;
      for (const dt of pasos(tipo, 1.5)) {
        stepVehicle(v, neutro(0), dt, env);
        t += dt;
        expect(v.steer).toBeLessThanOrEqual(prev);
        expect(v.steer).toBeGreaterThanOrEqual(0);
        expect(v.steer).toBeCloseTo(desde * Math.exp(-8 * t), 9);
        prev = v.steer;
      }
      expect(Math.abs(v.forwardSpeed)).toBe(0);
    });
  }
});

/**
 * Cruce en + de vías rectas de doble sentido (8 m). 0 es el centro; cada brazo
 * (sur, norte, este, oeste) tiene un nodo a 60 m (1, 3, 5, 7) y otro a 160 m
 * (2, 4, 6, 8), para que después del giro siga derecho.
 */
function cruce() {
  const nodes = [{ id: 0, x: 0, z: 0, active: true, links: [] }];
  const edges = [];
  const unir = (a, b) => {
    const A = nodes[a];
    const B = nodes[b];
    const L = Math.hypot(B.x - A.x, B.z - A.z);
    const e = { id: edges.length, a, b, pts: [[A.x, A.z], [B.x, B.z]], cum: [0, L], length: L, width: 8, lanes: 2, oneway: 0, active: true };
    edges.push(e);
    A.links.push({ node: b, edge: e.id, dir: 1 });
    B.links.push({ node: a, edge: e.id, dir: -1 });
  };
  for (const [dx, dz] of [
    [0, 1],
    [0, -1],
    [1, 0],
    [-1, 0],
  ]) {
    const mid = nodes.length;
    nodes.push({ id: mid, x: dx * 60, z: dz * 60, active: true, links: [] }, { id: mid + 1, x: dx * 160, z: dz * 160, active: true, links: [] });
    unir(0, mid);
    unir(mid, mid + 1);
  }
  return new RoadGraph({ nodes, edges });
}

/** Un taxi llega por el sur (hacia -Z) y gira hacia `next` (5 derecha, 7 izquierda). Devuelve la dirección cuadro a cuadro. */
function girar(next, tipo) {
  const g = cruce();
  const p = lanePoint(g, 1, 0, 0.1);
  const v = createVehicleState('taxi', p.x, p.z, p.yaw, () => 0);
  const agent = { from: 1, to: 0, next };
  const env = plano();
  const steer = [];
  const heading = [];
  for (const dt of pasos(tipo, 14)) {
    const input = autopilot(g, agent, v, { cruise: 10, blockedAhead: Infinity, rand: () => 0.5, dt });
    stepVehicle(v, input, dt, env);
    steer.push(v.steer);
    heading.push(v.heading);
    // Hasta 35 m después del cruce por la vía nueva.
    if (Math.abs(v.x) > 35) break;
  }
  return { steer, heading, v };
}

describe('dirección del tráfico al girar en un cruce', () => {
  for (const tipo of TIEMPOS) {
    for (const [next, nombre, lado] of [
      [5, 'a la derecha', 1],
      [7, 'a la izquierda', -1],
    ]) {
      it(`${nombre}: sin latigazo al otro lado antes de girar ni vaivén al salir (dt ${tipo === 'irregular' ? tipo : (1 / tipo).toFixed(0) + ' cps'})`, () => {
        const { steer, heading, v } = girar(next, tipo);
        // Giró de verdad (90°) y siguió por la vía nueva.
        expect(Math.abs(v.x)).toBeGreaterThan(35);
        expect(Math.abs(Math.abs(v.heading) - Math.PI / 2)).toBeLessThan(0.15);
        // Mientras no ha girado ni 60°, la rueda nunca va al otro lado.
        const pico = Math.max(...steer.map((s) => s * lado));
        expect(pico).toBeGreaterThan(0.3);
        const iPico = steer.findIndex((s) => s * lado === pico);
        for (let i = 0; i < steer.length && Math.abs(heading[i]) < Math.PI / 3; i++) expect(steer[i] * lado, `cuadro ${i}`).toBeGreaterThan(-0.02);
        // Al salir se endereza: lo que se pasa al otro lado es poco (menos de
        // 0,05 rad, ~3°) y no hay vaivén (cambios de lado de más de 0,02 rad).
        const despues = steer.slice(iPico).map((s) => s * lado);
        expect(Math.min(...despues)).toBeGreaterThan(-0.05);
        let cruces = 0;
        let lad = 1;
        for (const s of despues) {
          if (s * lad < -0.02) {
            cruces++;
            lad = -lad;
          }
        }
        expect(cruces).toBeLessThanOrEqual(1);
      });
    }
  }
});

// Modelos sin texturas (en Node no hay con qué decodificar las WebP): el
// clásico (ruedas del modelo corridas a un lado), una camioneta y un hatchback.
const CARROS = ['clasico', 'suv_mediana', 'hatch_compacto'];

describe('la rueda de adelante vira en su pivote y rueda sobre su propio eje', () => {
  beforeAll(async () => {
    await MeshoptDecoder.ready;
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    for (const id of CARROS) {
      const model = VEHICLE_VARIANTS[id].model;
      const buf = fs.readFileSync(path.resolve('public/models/vehiculos', `${model}.glb`));
      const gltf = await new Promise((res, rej) => loader.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '', res, rej));
      assets.items.set(`vehiculos/${model}`, gltf);
    }
  });
  const vista = (id) => new VehicleView(VEHICLE_VARIANTS[id].type, { variant: id });

  /** Eje de la rueda en el marco del suelo del carro: {yaw, caida}; y el centro de su malla y del eje en el mundo. */
  function medir(view, spin) {
    view.group.updateMatrixWorld(true);
    const qi = view._fit.qa.clone().invert();
    const a = new THREE.Vector3().setFromMatrixColumn(spin.matrixWorld, 0).normalize().applyQuaternion(qi);
    if (a.x < 0) a.negate();
    const eje = new THREE.Vector3().setFromMatrixPosition(spin.matrixWorld);
    let malla = null;
    spin.traverse((o) => (malla ??= o.isMesh ? o : null));
    malla.geometry.computeBoundingBox();
    const centro = malla.geometry.boundingBox.getCenter(new THREE.Vector3()).applyMatrix4(malla.matrixWorld);
    return { yaw: Math.atan2(a.z, a.x), caida: Math.asin(a.y), eje, centro };
  }

  it.each(CARROS)('%s: girada y rodando una vuelta entera, rumbo = dirección, caída 0, centro de la malla en el eje y el eje quieto', (id) => {
    const view = vista(id);
    expect(view.fromModel).toBe(true);
    expect(view.frontPivots.length).toBe(2);
    const v = createVehicleState(VEHICLE_VARIANTS[id].type, 0, 0, 0.7, () => 0, id);
    v.bodyPitch = 0.03; // la carrocería cabecea y se balancea; las ruedas no
    v.bodyRoll = -0.04;
    for (const steer of [0, 0.35, -0.5]) {
      v.steer = steer;
      const ref = new Map();
      for (let k = 0; k <= 24; k++) {
        v.wheelSpin = (k / 24) * Math.PI * 2 + 1000; // también con el giro acumulado de un viaje largo
        view.sync(v, 1 / 60, 0);
        for (const spin of view.wheels) {
          const m = medir(view, spin);
          const delantera = view.frontPivots.includes(spin.parent);
          expect(m.yaw, `rumbo ${steer} ${k}`).toBeCloseTo(delantera ? steer : 0, 6);
          expect(m.caida, `caída ${steer} ${k}`).toBeCloseTo(0, 6);
          expect(m.centro.distanceTo(m.eje), 'malla descentrada').toBeLessThan(1e-4);
          if (!ref.has(spin)) ref.set(spin, m.eje.clone());
          expect(m.eje.distanceTo(ref.get(spin)), 'el eje se mueve al rodar').toBeLessThan(1e-6);
        }
      }
    }
  });

  it('sin nada tumbado el brinco por rueda es exactamente cero (ruedas y carro iguales con o sin él)', () => {
    // Utilería de pie al lado del carro: no cuenta.
    const props = [
      { type: 'pole', x: 1, z: 0.5, h: 9, collider: { hx: 0.15, hz: 0.15 } },
      { type: 'tree', kind: 'mango', x: -1.2, z: -1, scale: 1, collider: { hx: 0.25, hz: 0.25 } },
    ];
    const collision = new CollisionWorld(8);
    for (const p of props) collision.add({ minX: p.x - p.collider.hx, maxX: p.x + p.collider.hx, minZ: p.z - p.collider.hz, maxZ: p.z + p.collider.hz, kind: p.type });
    const reg = new Destructibles({ props, collision }, { groundHeight: () => 0 });
    expect(reg.tumbados.length).toBe(0);
    for (let x = -3; x <= 3; x += 0.25) for (let z = -3; z <= 3; z += 0.25) expect(reg.alturaTumbado(x, z)).toBe(0);
    const s = createVehicleState('sedan', 0, 0, 0, () => 0);
    expect(reg.pisar(s, s.spec, 0, -1, 1, 0)).toBe(0);
    expect(s.tronco).toBe(0);

    const pose = (bump) => {
      VehicleView.bumpAt = bump;
      const view = vista('clasico');
      const v = createVehicleState('sedan', 0.3, -0.2, 0.4, () => 0, 'clasico');
      v.steer = 0.3;
      const out = [];
      for (let k = 0; k < 30; k++) {
        v.wheelSpin = k * 0.4;
        view.sync(v, 1 / 30, 0);
        view.group.updateMatrixWorld(true);
        for (const w of view.wheels) out.push(...new THREE.Vector3().setFromMatrixPosition(w.matrixWorld).toArray());
        out.push(...view.group.position.toArray(), ...view.group.quaternion.toArray());
      }
      return out;
    };
    try {
      // Como lo pone el juego (Game.js): la cuenta solo cuando hay algo tumbado.
      const con = pose((x, z) => (reg.tumbados.length ? reg.alturaTumbado(x, z) : 0));
      const sin = pose(null);
      expect(con).toEqual(sin);
      // Y aunque se consultara siempre, sin tumbados da lo mismo.
      expect(pose((x, z) => reg.alturaTumbado(x, z))).toEqual(sin);
    } finally {
      VehicleView.bumpAt = null;
    }
  });
});
