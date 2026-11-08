// Muestrario del calentamiento de programas (Game._warmUp).
//
// Un programa de WebGL que se compila en pleno juego es un tirón: con D3D11
// (ANGLE) cada uno cuesta de 50 a 500 ms (en la persecución de la 3.5 el
// cuadro en que llegaba la primera patrulla tardaba 1,2 s). El calentamiento
// compila lo que hay en la escena al arrancar, pero se le escapaban dos cosas:
//   - lo que se crea después: policías y pandilleros (otros avatares, con
//     chaleco), las armas, la ropa de los balcones, la utilería de las
//     actividades y la patrulla y la moto de la policía; aquí se arma una
//     muestra de cada uno, se dibuja una vez (también en el mapa de sombras)
//     y se libera. (Medido con una sonda: 9 programas compilados en pleno
//     juego entre la 92 de noche y una persecución; con esto, ninguno.)
//   - lo que está oculto al arrancar (grupos de efectos, partes de la ciudad
//     lejos de la cámara, los animales sin nadie en el andén): revealHidden
//     los deja visibles solo mientras se compila.
import * as THREE from 'three';
import { AVATARS, CharacterRig, randomLook } from './characterRig.js';
import { WEAPON_MODELS } from './weaponModels.js';
import { ballMesh, broomMesh, bucketMesh, buildClothesline, buildDominoTable, ragMesh, releaseProp, smallGoal, stoneGoal } from './activityProps.js';
import { VehicleView } from './vehicleMesh.js';
import { applyOutfit } from './outfit.js';
import { makeRng } from '../sim/rng.js';
import { VEHICLE_VARIANTS } from '../sim/vehicleVariants.js';
import { pintaRumba } from '../sim/nightlife.js';

// ------------------------------------------------------------------ ajustables
/** Grupos de AVATARS del muestrario: los que llegan con la policía y las misiones, y los civiles vestidos (la ropa cambia el material del cuerpo: la gente de la 92). */
export const MUESTRA_AVATARES = ['police', 'gang', 'civil'];
/** Metros delante de la cámara donde se pone el muestrario (dentro del mapa de sombras). */
export const MUESTRA_DIST = 5;
/** Separación (m) entre las muestras, en fila de lado a lado. */
export const MUESTRA_PASO = 0.9;
/** Compilar también lo oculto (false = solo lo visible y el muestrario, como antes). */
export const COMPILAR_OCULTOS = true;
/** Los programas del calentamiento no se destruyen al liberar sus materiales (ver pinPrograms). */
export const FIJAR_PROGRAMAS = true;

/**
 * Arma el muestrario delante de la cámara (sin agregarlo a la escena).
 * Devuelve { group, release } (release lo saca y libera lo que sea solo suyo).
 */
export function buildWarmupSamples(camera, groundHeight) {
  const group = new THREE.Group();
  group.name = 'muestrario-calentamiento';
  const rng = makeRng(4242);
  const rigs = [];
  const props = [];
  // Personajes: uno por avatar de los grupos que llegan después, cada uno con un arma.
  const ids = MUESTRA_AVATARES.flatMap((k) => (AVATARS[k] ?? []).map((a) => ({ outfit: k, ...a })));
  while (ids.length < WEAPON_MODELS.length) ids.push({ outfit: 'civil', ...AVATARS.civil[ids.length % AVATARS.civil.length] });
  ids.forEach((a, i) => {
    const look = randomLook(rng, a.outfit);
    look.avatar = a.id;
    look.female = a.gender === 'f';
    const rig = new CharacterRig(look);
    if (i < WEAPON_MODELS.length) rig.setWeapon(WEAPON_MODELS[i]);
    if (a.outfit === 'civil') applyOutfit(rig, pintaRumba(rng, look.female));
    rigs.push(rig);
    group.add(rig.root);
  });
  // Ropa de balcón (prendas instanciadas y la que va en la mano) y utilería de las actividades.
  const line = buildClothesline(new THREE.Vector3(-1, 2, 0), new THREE.Vector3(1, 2, 0), 0, new THREE.Vector3(0, 0, 0.5), 0);
  line.setHung(line.slots);
  line.hand.visible = true;
  line.group.add(line.hand);
  props.push(line.group);
  const table = buildDominoTable(4);
  props.push(table.group, broomMesh(), ballMesh(0.11), smallGoal(1.2, 0.8), stoneGoal(1.2), bucketMesh(), ragMesh());
  for (const p of props) group.add(p);
  // Un vehículo de cada variante (la patrulla y la moto de la policía llegan
  // después; el taxi que se pide o una variante rara pueden no estar al arrancar).
  const views = Object.entries(VEHICLE_VARIANTS).map(([id, v]) => new VehicleView(v.type, { variant: id }));
  for (const v of views) group.add(v.group);
  // En fila de lado a lado, delante de la cámara y sobre el piso.
  const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion).setY(0).normalize();
  const side = new THREE.Vector3(-fwd.z, 0, fwd.x);
  const items = [...rigs.map((r) => r.root), ...props, ...views.map((v) => v.group)];
  items.forEach((o, i) => {
    const u = (i - (items.length - 1) / 2) * MUESTRA_PASO;
    const x = camera.position.x + fwd.x * MUESTRA_DIST + side.x * u;
    const z = camera.position.z + fwd.z * MUESTRA_DIST + side.z * u;
    o.position.set(x, groundHeight(x, z), z);
  });
  const release = () => {
    group.removeFromParent();
    for (const r of rigs) r.dispose();
    for (const v of views) v.dispose();
    // (Sin liberar los materiales: si se liberan, three destruye los programas
    // que solo ellos usaban y el primero que aparezca los vuelve a compilar.)
    for (const p of props) releaseProp(p, true);
  };
  return { group, release };
}

/**
 * Los programas compilados hasta ahora (el calentamiento) no se destruyen
 * aunque se libere el último material que los usa: three los destruye cuando
 * su cuenta de usos llega a 0 y el siguiente que los necesite (la próxima
 * ropa de balcón, el próximo efecto) los vuelve a compilar, con su tirón.
 * Son unos 200 programas ya compilados: mantenerlos no cuesta casi nada.
 */
export function pinPrograms(renderer) {
  if (!FIJAR_PROGRAMAS) return 0;
  const list = renderer.info.programs ?? [];
  for (const p of list) {
    if (p.pinned) continue;
    p.pinned = true;
    p.usedTimes++;
  }
  return list.length;
}

/**
 * Deja visible (para compilar) todo lo oculto de `scene` que no tenga luces
 * (prender una luz cambiaría la clave de los programas: saldrían otros).
 * Devuelve la función que lo vuelve a ocultar.
 */
export function revealHidden(scene) {
  if (!COMPILAR_OCULTOS) return () => {};
  const shown = [];
  // Los que tienen una luz debajo (un solo recorrido: se marcan los ancestros de cada luz).
  const withLight = new Set();
  scene.traverse((o) => {
    if (!o.isLight) return;
    for (let p = o; p && !withLight.has(p); p = p.parent) withLight.add(p);
  });
  scene.traverse((o) => {
    if (o.visible || o === scene || withLight.has(o)) return;
    o.visible = true;
    shown.push(o);
  });
  return () => {
    for (const o of shown) o.visible = false;
  };
}
