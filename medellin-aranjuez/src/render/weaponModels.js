// Modelos 3D de las armas (ver scripts/assets/armas.mjs y ASSETS-CREDITS.md).
// Los GLB vienen normalizados: metros a escala real, cañón hacia -Z, arriba
// +Y, origen en la empuñadura (donde la mano derecha agarra), un nodo vacío
// "boca" en la boca del cañón y "mano_izq" donde apoya la mano izquierda.
//
// `weaponModel(id)` devuelve un clon listo para colgar del soporte del arma
// (mismo marco: cañón -Z, origen en la empuñadura) con
//   userData.muzzle   → Object3D en la boca del cañón (fogonazo y disparos);
//   userData.leftHand → Vector3 local de la mano izquierda (o null).
// Si el GLB no está (o falló), usa el arma procedural de siempre.

import * as THREE from 'three';
import { assets } from './assets.js';
import { registerAssets } from './assetManifest.js';
import { buildWeaponMesh } from './proceduralRig.js';

export const WEAPON_MODELS = ['machete', 'pistol', 'smg', 'shotgun', 'rifle'];

/** Íconos laterales del HUD (silueta clara sobre transparente, 256×96). */
export const WEAPON_ICONS = Object.fromEntries(['fists', ...WEAPON_MODELS].map((id) => [id, `models/armas/iconos/${id}.png`]));

registerAssets(WEAPON_MODELS.map((id) => ({ key: `armas/${id}`, type: 'gltf', url: `models/armas/${id}.glb` })));

const prepared = new Set();

/** Ajustes de una sola vez sobre la escena cargada (compartida por los clones). */
function prepare(id, scene) {
  if (prepared.has(id)) return;
  prepared.add(id);
  scene.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true;
    o.receiveShadow = false;
    const m = o.material;
    if (m) m.envMapIntensity = 0.9;
  });
}

/** ¿Está cargado el modelo real de esta arma? */
export function hasWeaponModel(id) {
  return assets.has(`armas/${id}`);
}

/** Clon del modelo real del arma, o el procedural si no hay GLB. Null para puños. */
export function weaponModel(id) {
  if (!id || id === 'fists') return null;
  const gltf = assets.gltf(`armas/${id}`);
  if (!gltf) return proceduralWeapon(id);
  prepare(id, gltf.scene);
  const g = gltf.scene.clone(true);
  g.name = `arma_${id}`;
  const boca = g.getObjectByName('boca');
  const izq = g.getObjectByName('mano_izq');
  g.userData.muzzle = boca ?? g;
  g.userData.leftHand = izq ? izq.getWorldPosition(new THREE.Vector3()) : null; // g está en el origen
  g.userData.real = true;
  return g;
}

/** Arma procedural en el marco del soporte (cañón -Z, origen en la empuñadura). */
function proceduralWeapon(id) {
  const m = buildWeaponMesh(id);
  m.rotation.set(0, 0, 0);
  m.position.set(0, -0.04, 0.02);
  const g = new THREE.Group();
  g.add(m);
  g.userData.muzzle = m.userData.muzzle;
  g.userData.leftHand = null;
  g.userData.real = false;
  return g;
}
