// Poses por código de las actividades del barrio, encima de lo que dejó el
// esqueleto animado (render/characterRig.js, `rig.post`): colgar ropa,
// patear, tapar, cargar el balón, barrer, poner una ficha de dominó y
// restregar la moto. Solo para los personajes Rocketbox (con `rig.bones`);
// el muñeco procedural de respaldo no las hace.

import * as THREE from 'three';
import { ik2, pointBone, setWorldQuat } from './characterRig.js';
import { clamp } from '../sim/math.js';

const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const smooth = (x) => {
  x = clamp(x, 0, 1);
  return x * x * (3 - 2 * x);
};

/** Marco del personaje: adelante, derecha (mundo) de su raíz. */
function frameOf(rig) {
  const q = rig.root.getWorldQuaternion(new THREE.Quaternion());
  return { fwd: new THREE.Vector3(0, 0, -1).applyQuaternion(q), right: new THREE.Vector3(1, 0, 0).applyQuaternion(q), q };
}

/** Gira un hueso (en mundo) `ang` rad alrededor de `axis`. */
function rotBone(bone, axis, ang) {
  if (!bone || !ang) return;
  _q.setFromAxisAngle(axis, ang);
  bone.getWorldQuaternion(_q2);
  setWorldQuat(bone, _q.multiply(_q2), 1);
}

/** Dobla la espalda hacia adelante (ang > 0) repartido en las vértebras. */
export function bendSpine(rig, ang, right = frameOf(rig).right) {
  const B = rig.bones;
  rotBone(B.Bip01_Spine, right, -ang * 0.45);
  rotBone(B.Bip01_Spine1, right, -ang * 0.35);
  rotBone(B.Bip01_Spine2, right, -ang * 0.2);
}

/** Mano `side` ('L' | 'R') a `target` (mundo), codo hacia `pole`. */
export function reach(rig, side, target, pole, w = 1) {
  const B = rig.bones;
  if (w < 0.01 || !B[`Bip01_${side}_UpperArm`]) return;
  ik2(B[`Bip01_${side}_UpperArm`], B[`Bip01_${side}_Forearm`], B[`Bip01_${side}_Hand`], target, pole, w);
}

/**
 * Colgar ropa. `h`: {bend (0..1: agachada al platón), arms (0..1: peso de
 * los brazos), l / r: objetivos de las manos (mundo)}.
 */
export function poseHang(rig, h) {
  if (!rig.bones?.Bip01_Spine) return;
  const { right } = frameOf(rig);
  if (h.bend > 0.01) {
    bendSpine(rig, 1.05 * smooth(h.bend), right);
    // Rodillas un poco dobladas para alcanzar el platón.
    rotBone(rig.bones.Bip01_L_Calf, right, -0.25 * h.bend);
    rotBone(rig.bones.Bip01_R_Calf, right, -0.25 * h.bend);
  }
  const w = smooth(h.arms);
  const pole = (s) => _a.copy(right).multiplyScalar(s * 0.8).addScaledVector(UP, -0.7);
  reach(rig, 'L', h.l, pole(-1).clone(), w);
  reach(rig, 'R', h.r, pole(1).clone(), w);
}

/** Punto medio entre las manos (mundo): ahí va la prenda que se está colgando. */
export function handsMid(rig, out = new THREE.Vector3()) {
  const B = rig.bones;
  if (!B?.Bip01_L_Hand) return rig.root.getWorldPosition(out).add(_v.set(0, 1.2, 0));
  B.Bip01_L_Hand.getWorldPosition(out);
  return out.add(B.Bip01_R_Hand.getWorldPosition(_v)).multiplyScalar(0.5);
}

/**
 * Patada con la pierna derecha: `k` de 0 a 1 (atrás, golpe, seguir el
 * movimiento y volver). `power` 0..1 (pase suave o remate).
 */
export function poseKick(rig, k, power = 0.6) {
  const B = rig.bones;
  if (!B?.Bip01_R_Thigh) return;
  const { right } = frameOf(rig);
  const back = -0.55 - 0.35 * power;
  const fwd = 0.7 + 0.6 * power;
  let swing;
  let knee;
  if (k < 0.4) {
    const t = smooth(k / 0.4);
    swing = back * t;
    knee = 1.3 * t;
  } else if (k < 0.55) {
    const t = (k - 0.4) / 0.15;
    swing = back + (fwd - back) * t;
    knee = 1.3 * (1 - t) + 0.05;
  } else {
    const t = smooth((k - 0.55) / 0.45);
    swing = fwd * (1 - t);
    knee = 0.05 + 0.25 * Math.sin(t * Math.PI);
  }
  const env = Math.sin(clamp(k, 0, 1) * Math.PI);
  // El cuerpo se echa atrás al golpear y los brazos se abren para equilibrar.
  bendSpine(rig, -0.18 * env * power, right);
  rotBone(B.Bip01_R_Thigh, right, swing);
  rotBone(B.Bip01_R_Calf, right, -knee);
  rotBone(B.Bip01_L_Calf, right, -0.25 * env);
  rotBone(B.Bip01_L_UpperArm, _v.copy(rig.root.getWorldDirection(_b)).negate(), -0.7 * env);
  rotBone(B.Bip01_R_UpperArm, _v.copy(rig.root.getWorldDirection(_b)).negate(), 0.5 * env);
}

/** Arquero listo: rodillas dobladas, cadera abajo y manos al frente. */
export function poseKeeper(rig, w) {
  const B = rig.bones;
  if (!B?.Bip01_L_Thigh || w < 0.01) return;
  const { fwd, right } = frameOf(rig);
  const a = 0.45 * w;
  const bend = 0.9 * w;
  rig.model.position.y -= 0.09 * w;
  rig.model.updateMatrixWorld(true);
  bendSpine(rig, 0.35 * w, right);
  for (const s of ['L', 'R']) {
    rotBone(B[`Bip01_${s}_Thigh`], right, a);
    rotBone(B[`Bip01_${s}_Calf`], right, -bend);
    rotBone(B[`Bip01_${s}_Foot`], right, bend - a);
  }
  const pel = B.Bip01_Pelvis.getWorldPosition(new THREE.Vector3());
  for (const [side, s] of [
    ['L', -1],
    ['R', 1],
  ]) {
    const t = pel.clone().addScaledVector(fwd, 0.42).addScaledVector(right, s * 0.3).addScaledVector(UP, 0.15);
    reach(rig, side, t, right.clone().multiplyScalar(s).addScaledVector(UP, -0.6), w);
  }
}

/** Con el balón en las manos, frente al pecho. `ball`: centro (mundo). */
export function poseHoldBall(rig, ball, w = 1, r = 0.11) {
  if (!rig.bones?.Bip01_L_Hand) return;
  const { right } = frameOf(rig);
  reach(rig, 'L', _a.copy(ball).addScaledVector(right, -r - 0.03), right.clone().negate().addScaledVector(UP, -0.8), w);
  reach(rig, 'R', _b.copy(ball).addScaledVector(right, r + 0.03), right.clone().addScaledVector(UP, -0.8), w);
}

/** Punto frente al pecho donde va el balón cargado (mundo). */
export function chestPoint(rig, out = new THREE.Vector3()) {
  const { fwd } = frameOf(rig);
  const s = rig.bones?.Bip01_Spine2 ?? rig.root;
  return s.getWorldPosition(out).addScaledVector(fwd, 0.28).addScaledVector(UP, -0.08);
}

/**
 * Barrer: la escoba (hija de la raíz) va de lado a lado frente a los pies
 * y las dos manos la agarran por el palo. `t`: tiempo del vaivén (s).
 */
export function poseSweep(rig, broom, t, w = 1) {
  const B = rig.bones;
  // Cerdas en el piso, delante, con vaivén lateral; el palo inclinado hacia la cadera.
  const sx = Math.sin(t * 2.6) * 0.32;
  const bottom = _a.set(sx, 0.02, -0.62);
  const top = _b.set(0.14 + sx * 0.25, 1.12, -0.12);
  const axis = top.clone().sub(bottom);
  const len = axis.length();
  axis.normalize();
  broom.position.copy(bottom);
  broom.quaternion.setFromUnitVectors(UP, axis);
  // Que las cerdas barran de lado (girar el palo sobre su eje).
  broom.quaternion.multiply(_q.setFromAxisAngle(UP, Math.cos(t * 2.6) * 0.2));
  broom.scale.setScalar(len / 1.25);
  if (!B?.Bip01_L_Hand || w < 0.01) return;
  const { right } = frameOf(rig);
  bendSpine(rig, 0.28 * w, right);
  rig.root.updateMatrixWorld(true);
  const hi = rig.root.localToWorld(bottom.clone().addScaledVector(axis, len * 0.92));
  const lo = rig.root.localToWorld(bottom.clone().addScaledVector(axis, len * 0.6));
  reach(rig, 'L', hi, right.clone().multiplyScalar(-0.8).addScaledVector(UP, -0.6), w);
  reach(rig, 'R', lo, right.clone().multiplyScalar(0.9).addScaledVector(UP, -0.5), w);
}

/** Estira el brazo derecho hasta `target` (poner una ficha, alcanzar algo). */
export function poseReach(rig, target, w) {
  if (!rig.bones?.Bip01_R_Hand || w < 0.01) return;
  const { right } = frameOf(rig);
  reach(rig, 'R', target, right.clone().multiplyScalar(0.7).addScaledVector(UP, -0.8), smooth(w));
  pointBone(rig.bones.Bip01_R_Hand, _v.copy(target).sub(rig.bones.Bip01_R_Forearm.getWorldPosition(_a)).normalize().addScaledVector(UP, -0.4).normalize(), smooth(w) * 0.7);
}

/** Restregar (lavar la moto): la mano derecha hace círculos sobre `center` (mundo). */
export function poseRub(rig, center, t, w = 1) {
  if (!rig.bones?.Bip01_R_Hand || w < 0.01) return;
  const { right, fwd } = frameOf(rig);
  const p = center.clone().addScaledVector(right, Math.cos(t * 5) * 0.12).addScaledVector(UP, Math.sin(t * 5) * 0.08);
  reach(rig, 'R', p, right.clone().multiplyScalar(0.8).addScaledVector(UP, -0.5), w);
  // La izquierda se apoya en la moto.
  reach(rig, 'L', center.clone().addScaledVector(right, -0.32).addScaledVector(UP, 0.08).addScaledVector(fwd, -0.03), right.clone().multiplyScalar(-0.8).addScaledVector(UP, -0.5), w * 0.8);
}
