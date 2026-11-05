import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { checkStatic, freezeStatic, sceneSkipsHidden, skipWhenHidden, thawStatic } from '../../src/render/staticScene.js';

const P = THREE.Object3D.prototype;
afterEach(() => vi.restoreAllMocks());

/** Ciudad de juguete: dos manzanas fijas (con hijos) y un "metro" con un tren que se mueve. */
function toyCity() {
  const scene = new THREE.Scene();
  const city = new THREE.Group();
  city.name = 'ciudad';
  city.position.set(10, 0, 0);
  scene.add(city);
  const blocks = [];
  for (let i = 0; i < 2; i++) {
    const b = new THREE.Group();
    b.position.set(i * 50, 0, 5);
    b.rotation.y = 0.3 * i;
    const m = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
    m.position.set(1, 2, 3);
    b.add(m);
    city.add(b);
    blocks.push(b);
  }
  const metro = new THREE.Group();
  metro.name = 'metro';
  const station = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
  station.position.set(0, 8, 0);
  const train = new THREE.Group();
  train.userData.dinamico = true;
  const car = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
  car.position.z = 2;
  train.add(car);
  metro.add(station, train);
  city.add(metro);
  return { scene, city, blocks, metro, station, train, car };
}

const worldPos = (o) => new THREE.Vector3().setFromMatrixPosition(o.matrixWorld);

describe('freezeStatic: ciudad con matrices fijas', () => {
  it('calcula las matrices una vez y no vuelve a recorrer lo estático; lo dinámico y sus ancestros siguen vivos', () => {
    const t = toyCity();
    const st = freezeStatic(t.city, { dynamic: (o) => o.userData.dinamico === true });
    // Congelados: las dos manzanas (con su malla) y la estación; vivos: ciudad, metro y el tren.
    expect(st.roots).toEqual([t.blocks[0], t.blocks[1], t.station]);
    expect(st.nodes.length).toBe(5);
    expect(t.blocks[0].children[0].matrixAutoUpdate).toBe(false);
    expect(t.blocks[0].children[0].matrixWorldAutoUpdate).toBe(false);
    expect(t.train.matrixAutoUpdate).toBe(true);
    // Posición en el mundo correcta desde el comienzo (padre + hijo).
    expect(worldPos(t.blocks[0].children[0]).toArray()).toEqual([11, 2, 8]);
    const spy = vi.spyOn(P, 'updateMatrix');
    t.scene.updateMatrixWorld();
    // Escena, ciudad, metro, tren y vagón: nada de lo congelado.
    expect(spy).toHaveBeenCalledTimes(5);
    // El tren se mueve y se sigue viendo donde está.
    t.train.position.x = 7;
    t.scene.updateMatrixWorld();
    expect(worldPos(t.car).toArray()).toEqual([17, 0, 2]);
    expect(checkStatic(st)).toMatchObject({ moved: 0, added: 0, roots: 3, nodes: 5, dynamic: 1 });
  });

  it('sin nada dinámico congela la raíz entera', () => {
    const t = toyCity();
    const st = freezeStatic(t.city);
    expect(st.roots).toEqual([t.city]);
    const spy = vi.spyOn(P, 'updateMatrix');
    t.scene.updateMatrixWorld();
    expect(spy).toHaveBeenCalledTimes(1); // solo la escena
  });

  it('checkStatic avisa si algo congelado se movió o se le agregó un hijo', () => {
    const t = toyCity();
    const st = freezeStatic(t.city, { dynamic: (o) => o.userData.dinamico === true });
    t.blocks[1].children[0].position.y = 9; // se movió sin que three lo vea
    t.station.add(new THREE.Object3D()); // hijo nuevo dentro de algo congelado
    const r = checkStatic(st);
    expect(r.moved).toBe(1);
    expect(r.added).toBe(1);
    expect(r.sample.join(' ')).toMatch(/movido: Group\/Mesh/);
  });

  it('thawStatic devuelve todo a como estaba', () => {
    const t = toyCity();
    const st = freezeStatic(t.city, { dynamic: (o) => o.userData.dinamico === true });
    thawStatic(st);
    expect(Object.prototype.hasOwnProperty.call(t.blocks[0], 'updateMatrixWorld')).toBe(false);
    t.blocks[0].position.x = 3;
    t.scene.updateMatrixWorld();
    expect(worldPos(t.blocks[0].children[0]).x).toBeCloseTo(14, 6);
  });
});

describe('skipWhenHidden: vehículos y personajes ocultos', () => {
  function toyScene() {
    const scene = sceneSkipsHidden(new THREE.Scene());
    const car = new THREE.Group();
    const wheel = new THREE.Object3D();
    wheel.position.set(1, 0, 0);
    car.add(wheel);
    scene.add(car);
    skipWhenHidden(car);
    skipWhenHidden(car); // idempotente
    return { scene, car, wheel };
  }

  it('oculto no se recorre al dibujar; al volverse visible se actualiza', () => {
    const { scene, car, wheel } = toyScene();
    scene.updateMatrixWorld();
    car.visible = false;
    car.position.set(5, 0, 0);
    const spy = vi.spyOn(P, 'updateMatrix');
    scene.updateMatrixWorld();
    expect(spy).toHaveBeenCalledTimes(1); // solo la escena
    car.visible = true;
    scene.updateMatrixWorld();
    expect(worldPos(wheel).toArray()).toEqual([6, 0, 0]);
  });

  it('una llamada explícita (o getWorldPosition) sí actualiza aunque esté oculto', () => {
    const { scene, car, wheel } = toyScene();
    car.visible = false;
    car.position.set(0, 0, 4);
    expect(wheel.getWorldPosition(new THREE.Vector3()).toArray()).toEqual([1, 0, 4]);
    car.position.set(0, 0, 9);
    car.updateMatrixWorld(true);
    expect(worldPos(wheel).toArray()).toEqual([1, 0, 9]);
    scene.updateMatrixWorld();
    expect(worldPos(wheel).toArray()).toEqual([1, 0, 9]);
  });
});
