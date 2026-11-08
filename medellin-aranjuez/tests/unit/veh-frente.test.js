// Todas las motos avanzan hacia su frente: con el acelerador la física va hacia
// -Z del vehículo (rumbo 0), y el modelo armado por vehicleMesh tiene la rueda
// que vira, el manubrio (donde van las manos del piloto) y la farola en -Z, y
// el sillín y la rueda trasera hacia +Z. Así el piloto (hijo del grupo del
// vehículo, characterRig) mira hacia donde avanza. Cubre el error de la AKT TT
// (moto_tt.glb tiene el frente en +Z y la plantilla la gira con `flip`).
import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { assets } from '../../src/render/assets.js';
import { VehicleView } from '../../src/render/vehicleMesh.js';
import { VEHICLE_VARIANTS } from '../../src/sim/vehicleVariants.js';
import { createVehicleState, emptyDriveInput, stepVehicle } from '../../src/sim/vehiclePhysics.js';

const flat = { groundHeight: () => 0, collision: { query: () => [] }, bounds: { minX: -1e5, maxX: 1e5, minZ: -1e5, maxZ: 1e5 } };
const MOTOS = Object.entries(VEHICLE_VARIANTS).filter(([, v]) => v.type === 'moto');

beforeAll(async () => {
  await MeshoptDecoder.ready;
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  for (const model of new Set(MOTOS.map(([, v]) => v.model))) {
    const buf = fs.readFileSync(path.resolve('public/models/vehiculos', `${model}.glb`));
    const gltf = await new Promise((res, rej) => loader.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '', res, rej));
    assets.items.set(`vehiculos/${model}`, gltf);
  }
});

/** Posición de un nodo en el espacio del vehículo. */
function local(view, o) {
  view.group.updateMatrixWorld(true);
  return new THREE.Vector3().setFromMatrixPosition(o.matrixWorld);
}

describe('motos: acelerar es avanzar hacia el frente del modelo', () => {
  it('hay motos de todas las variantes (incluida la de la Policía)', () => {
    const ids = MOTOS.map(([id]) => id);
    for (const id of ['moto', 'moto_2t', 'moto_enduro', 'moto_tt', 'scooter', 'domicilio', 'policia_moto']) expect(ids).toContain(id);
  });

  for (const [id] of MOTOS) {
    it(id, () => {
      // Física: con rumbo 0 el frente es -Z; acelerar suma velocidad hacia allá.
      const s = createVehicleState('moto', 0, 0, 0, () => 0, id);
      for (let i = 0; i < 60; i++) stepVehicle(s, { ...emptyDriveInput(), throttle: 1 }, 1 / 60, flat);
      expect(s.forwardSpeed, id).toBeGreaterThan(2);
      expect(s.z, id).toBeLessThan(-1);
      expect(Math.abs(s.x), id).toBeLessThan(0.05);
      // Freno sostenido: se detiene y luego va en reversa (hacia +Z).
      const z1 = s.z;
      for (let i = 0; i < 60 * 6; i++) stepVehicle(s, { ...emptyDriveInput(), brake: 1 }, 1 / 60, flat);
      expect(s.forwardSpeed, id).toBeLessThan(0);
      expect(s.z, id).toBeGreaterThan(z1);

      // Modelo: armado desde el GLB (no el de respaldo).
      const view = new VehicleView('moto', { variant: id });
      expect(view.fromModel, id).toBe(true);
      // La rueda que vira queda adelante (-Z) y la otra atrás.
      expect(view.frontPivots.length, id).toBe(1);
      const front = local(view, view.frontPivots[0]);
      const others = view.wheels.map((w) => local(view, w.pivot ?? w)).filter((p) => p.distanceTo(front) > 0.3);
      expect(front.z, id).toBeLessThan(-0.4);
      for (const p of others) expect(p.z, id).toBeGreaterThan(0.3);
      // Piloto: sillín detrás del manubrio (las manos van adelante: mira hacia -Z).
      const ride = view.group.userData.ride;
      expect(ride, id).toBeTruthy();
      for (const g of ride.grips) expect(g.z, id).toBeLessThan(ride.seatZ - 0.25);
      expect(ride.seatZ, id).toBeGreaterThan(front.z + 0.6);
      // Lo que el GLB marca como de adelante (parabrisas, farola) en -Z y la
      // luz de stop en +Z: así no basta con el nombre de las ruedas.
      const zOf = (name) => {
        const o = view.group.getObjectByName(name);
        return o ? new THREE.Box3().setFromObject(o).getCenter(new THREE.Vector3()).z : null;
      };
      for (const n of ['carroceria_vidrio', 'carroceria_faro']) if (zOf(n) !== null) expect(zOf(n), `${id} ${n}`).toBeLessThan(ride.seatZ - 0.2);
      if (zOf('carroceria_stop') !== null) expect(zOf('carroceria_stop'), id).toBeGreaterThan(ride.seatZ - 0.1);
      // Espejos y puños (lo más alto y ancho por encima del sillín) delante de él.
      let top = null;
      const p = new THREE.Vector3();
      view.chassis.traverse((o) => {
        if (!o.isMesh || !o.geometry.attributes.position) return;
        const a = o.geometry.attributes.position;
        for (let i = 0; i < a.count; i++) {
          p.fromBufferAttribute(a, i).applyMatrix4(o.matrixWorld);
          if (Math.abs(p.x) > 0.25 && p.y > ride.seatY + 0.1 && (!top || p.y > top.y)) top = p.clone();
        }
      });

      expect(top, id).toBeTruthy();
      expect(top.z, id).toBeLessThan(ride.seatZ);
    });
  }
});
