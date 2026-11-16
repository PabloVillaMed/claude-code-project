// Desplomado en el puesto del carro (el conductor muerto o grave, sobre el
// timón; el copiloto, contra la guantera): pose por código encima de la
// postura sentada (render/characterRig.js `rig.post`). La espalda se dobla
// hacia adelante, el cuello cae y la cabeza se ladea hacia la puerta. Llega
// de a poco (no de golpe) y no arma nada nuevo por cuadro.
// Solo los personajes Rocketbox (con `rig.bones`); el muñeco de respaldo no.

import * as THREE from 'three';
import { setWorldQuat } from './characterRig.js';

// ------------------------------------------------ ajustables
export const DESPLOME = {
  spine: 0.78, // rad que se dobla la espalda (repartido en las vértebras) en el conductor
  spinePassenger: 0.55, // rad en el copiloto (la guantera queda más lejos que el timón)
  neck: 0.42, // rad que cae el cuello hacia adelante
  tilt: 0.38, // rad que se ladea la cabeza hacia su puerta
  speed: 2.2, // 1/s: qué tan rápido se desploma (de 0 a 1 en ~0,45 s)
};

const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _qr = new THREE.Quaternion();
const _right = new THREE.Vector3();
const _fwd = new THREE.Vector3();

function rot(bone, axis, ang) {
  if (!bone || !ang) return;
  _q.setFromAxisAngle(axis, ang);
  bone.getWorldQuaternion(_q2);
  setWorldQuat(bone, _q.multiply(_q2), 1);
}

/**
 * Pone a `rig` desplomado: `side` +1 conductor (lado izquierdo: la cabeza
 * cae hacia la puerta, a la izquierda), -1 copiloto. Devuelve el rig.
 */
export function slump(rig, side = 1) {
  rig.slumpW = rig.slumpW ?? 0;
  rig.slumpSide = side;
  rig.post = slumpPost;
  return rig;
}

/** Quita el desplome (el cuerpo sale del carro). */
export function unslump(rig) {
  if (rig.post === slumpPost) rig.post = null;
  rig.slumpW = 0;
}

function slumpPost(rig, step) {
  const B = rig.bones;
  if (!B?.Bip01_Spine) return;
  const w0 = rig.slumpW ?? 0;
  const w = (rig.slumpW = Math.min(1, w0 + (step || 0) * DESPLOME.speed));
  const k = w * w * (3 - 2 * w);
  rig.root.getWorldQuaternion(_qr);
  _right.set(1, 0, 0).applyQuaternion(_qr);
  _fwd.set(0, 0, -1).applyQuaternion(_qr);
  const side = rig.slumpSide ?? 1;
  const sp = (side > 0 ? DESPLOME.spine : DESPLOME.spinePassenger) * k;
  rot(B.Bip01_Spine, _right, -sp * 0.45);
  rot(B.Bip01_Spine1, _right, -sp * 0.35);
  rot(B.Bip01_Spine2, _right, -sp * 0.2);
  rot(B.Bip01_Neck, _right, -DESPLOME.neck * k);
  // Ladeada hacia su puerta: el conductor (izquierda) gira alrededor de
  // "adelante" en sentido contrario al copiloto.
  rot(B.Bip01_Head, _fwd, -side * DESPLOME.tilt * k);
}
