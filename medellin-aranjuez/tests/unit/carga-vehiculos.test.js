// El barrido del techo de cada plantilla de vehículo (cientos de rayos por el
// eje x = 0) se hace contra midPlaneProxy: una copia con solo los triángulos
// que cruzan ese plano. Debe dar EXACTAMENTE el mismo primer impacto que el
// modelo entero (así el letrero del taxi, la barra de la patrulla y el puesto
// del conductor quedan donde estaban), con los modelos reales y con casos raros.
import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { hit, midPlaneProxy } from '../../src/render/vehicleMesh.js';

const down = new THREE.Vector3(0, -1, 0);

/** Barrido como el de modelTemplate (más denso), viejo contra nuevo: lista de diferencias. */
function sweepMismatches(body, step = 0.01) {
  body.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(body);
  const proxy = midPlaneProxy(body);
  const o = new THREE.Vector3();
  const bad = [];
  let hits = 0;
  for (let z = box.min.z - 0.2; z <= box.max.z + 0.2; z += step) {
    const a = hit(body, o.set(0, box.max.y + 1, z), down);
    const b = hit(proxy, o.set(0, box.max.y + 1, z), down);
    if (a) hits++;
    const same = a === null ? b === null : b !== null && Object.is(a.distance, b.distance) && Object.is(a.point.x, b.point.x) && Object.is(a.point.y, b.point.y) && Object.is(a.point.z, b.point.z);
    if (!same) bad.push({ z, a: a?.point.toArray() ?? null, b: b?.point.toArray() ?? null });
  }
  return { bad, hits, proxy };
}

function triangles(root) {
  let n = 0;
  root.traverse((o) => {
    if (o.isMesh) n += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3;
  });
  return n;
}

describe('carga: barrido del techo de los vehículos contra la copia del eje', () => {
  it('con los modelos reales (escala no uniforme como en modelTemplate)', async () => {
    await MeshoptDecoder.ready;
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    // Los que no traen imágenes (en node no hay con qué decodificarlas).
    for (const name of ['moto', 'clasico', 'hatch_pequeno', 'suv_compacta', 'scooter']) {
      const buf = fs.readFileSync(path.resolve('public/models/vehiculos', `${name}.glb`));
      const gltf = await new Promise((res, rej) => loader.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '', res, rej));
      const body = new THREE.Group();
      body.add(gltf.scene);
      body.scale.set(1.13, 0.94, 1.07);
      const { bad, hits, proxy } = sweepMismatches(body);
      expect(bad, name).toEqual([]);
      expect(hits, name).toBeGreaterThan(20);
      // Y de verdad prueba menos triángulos.
      expect(proxy).not.toBe(body);
      expect(triangles(proxy), name).toBeLessThan(triangles(body) * 0.5);
    }
  });

  it('con grupos y varios materiales, caras traseras, sin índice, rango de dibujo y capas', () => {
    const body = new THREE.Group();
    const box = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.8, 2, 3, 2, 5), [
      new THREE.MeshBasicMaterial({ side: THREE.FrontSide }),
      new THREE.MeshBasicMaterial({ side: THREE.BackSide }),
      new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }),
      new THREE.MeshBasicMaterial(),
      new THREE.MeshBasicMaterial({ side: THREE.BackSide }),
      new THREE.MeshBasicMaterial(),
    ]);
    box.rotation.set(0.3, 0.2, -0.15);
    box.position.set(0.05, 0.5, 0.2);
    const knot = new THREE.Mesh(new THREE.TorusKnotGeometry(0.5, 0.15, 64, 8).toNonIndexed(), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    knot.position.set(-0.1, 1.4, -0.6);
    knot.scale.set(1, 0.6, 1.4);
    const sphere = new THREE.Mesh(new THREE.SphereGeometry(0.4, 24, 16), new THREE.MeshBasicMaterial({ side: THREE.BackSide }));
    sphere.geometry.setDrawRange(30, 600);
    sphere.position.set(0, 0.9, 1.1);
    const hidden = new THREE.Mesh(new THREE.BoxGeometry(3, 0.1, 3), new THREE.MeshBasicMaterial());
    hidden.position.y = 2.5;
    hidden.layers.set(3); // el raycaster no la ve: ni antes ni ahora
    const noMat = new THREE.Mesh(new THREE.BoxGeometry(3, 0.1, 3));
    noMat.material = undefined;
    noMat.position.y = 2.2;
    const inner = new THREE.Group();
    inner.rotation.y = 0.4;
    inner.scale.set(0.8, 1.3, 1);
    inner.add(knot, sphere);
    body.add(box, inner, hidden, noMat);
    body.scale.set(1.1, 0.9, 1.2);
    const { bad, hits } = sweepMismatches(body, 0.005);
    expect(bad).toEqual([]);
    expect(hits).toBeGreaterThan(100);
  });

  it('si hay algo que no sabe copiar (una línea), usa el modelo tal cual', () => {
    const body = new THREE.Group();
    body.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial()));
    body.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 1, 0)])));
    body.updateMatrixWorld(true);
    expect(midPlaneProxy(body)).toBe(body);
  });
});
