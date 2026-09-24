// Personajes humanos con esqueleto y animaciones reales (Microsoft Rocketbox,
// MIT). Cada instancia clona el avatar con SkeletonUtils (geometría y
// materiales compartidos) y tiene su propio AnimationMixer. Los clips se
// mezclan por peso según el estado: reposo / caminar / trotar / correr
// (timeScale ajustado a la velocidad real para que los pies no patinen),
// agachado, sentado (conducir), salto; y por código encima de la animación:
// apuntar (IK de dos huesos en ambos brazos), golpe / machetazo y muerte.
//
// Si los GLB no están (o fallan), `new CharacterRig(look)` devuelve el muñeco
// procedural de siempre (ProceduralRig), con la misma API:
//   .root, .setWeapon(id), .muzzleWorld(v), .punch(), .animate(dt, st),
//   .dispose(), .deadBlend

import * as THREE from 'three';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { damp, lerp, clamp } from '../sim/math.js';
import { assets } from './assets.js';
import { registerAssets } from './assetManifest.js';
import { ProceduralRig, randomLook as proceduralLook, PLAYER_LOOK as PROCEDURAL_PLAYER, buildWeaponMesh } from './proceduralRig.js';

export { ProceduralRig, buildWeaponMesh };

// ------------------------------------------------------------------ catálogo
// Ver scripts/assets/rocketbox.mjs (fuente de cada avatar y conversión).
export const AVATARS = {
  player: [{ id: 'jugador', gender: 'm' }],
  civil: [
    { id: 'civil-m1', gender: 'm' },
    { id: 'civil-m2', gender: 'm' },
    { id: 'civil-m3', gender: 'm' },
    { id: 'civil-m4', gender: 'm' },
    { id: 'civil-f1', gender: 'f' },
    { id: 'civil-f2', gender: 'f' },
    { id: 'civil-f3', gender: 'f' },
    { id: 'civil-f4', gender: 'f' },
  ],
  police: [
    { id: 'policia-1', gender: 'm' },
    { id: 'policia-2', gender: 'm' },
  ],
  gang: [
    { id: 'pandilla-1', gender: 'm' },
    { id: 'pandilla-2', gender: 'm' },
  ],
};
const ANIM_KEY = 'personajes/animaciones';

registerAssets([
  ...Object.values(AVATARS)
    .flat()
    .map((a) => ({ key: `personajes/${a.id}`, type: 'gltf', url: `models/personajes/${a.id}.glb` })),
  { key: ANIM_KEY, type: 'gltf', url: 'models/personajes/animaciones.glb' },
]);

/** Aspecto aleatorio: el de siempre + qué avatar usar. */
export function randomLook(rng, outfit = 'civil') {
  const look = proceduralLook(rng, outfit);
  const list = AVATARS[outfit] ?? AVATARS.civil;
  const pool = list.filter((a) => a.gender === (look.female ? 'f' : 'm'));
  const pickFrom = pool.length ? pool : list;
  const a = pickFrom[Math.floor(rng.next() * pickFrom.length) % pickFrom.length];
  look.avatar = a.id;
  look.female = a.gender === 'f';
  return look;
}

export const PLAYER_LOOK = { ...PROCEDURAL_PLAYER, avatar: 'jugador' };

// ------------------------------------------------------------------ plantillas
const templates = new Map();
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const X_AXIS = new THREE.Vector3(1, 0, 0);
const UP = new THREE.Vector3(0, 1, 0);

/** Prepara (una vez por avatar) la escena fuente, los clips escalados y el agarre del arma. */
function getTemplate(id) {
  if (templates.has(id)) return templates.get(id);
  const gltf = assets.gltf(`personajes/${id}`);
  const anim = assets.gltf(ANIM_KEY);
  let t = null;
  if (gltf && anim) {
    const info = gltf.scene.userData ?? {};
    const hip = info.hipHeight ?? 0.9;
    const g = info.gender === 'f' ? 'f' : 'm';
    const meta = anim.scene.userData?.clips ?? {};
    const clips = {};
    for (const c of anim.animations) {
      if (!c.name.startsWith(`${g}_`)) continue;
      const clip = c.clone();
      // La posición de la cadera viene normalizada (1.0 = altura de cadera).
      for (const tr of clip.tracks) if (tr.name === 'Bip01.position') for (let i = 0; i < tr.values.length; i++) tr.values[i] *= hip;
      clips[c.name.slice(2)] = { clip, speed: meta[c.name]?.speed || 1 };
    }
    gltf.scene.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = false;
        const m = o.material;
        if (m && !m.userData.rbFixed) {
          m.userData.rbFixed = true;
          m.envMapIntensity = 0.8;
          if (m.name === 'chaleco') m.emissive?.setHex(0x3a4a00);
        }
      }
    });
    // Agarre del arma: en la pose de reposo (brazos en T, pulgar hacia
    // delante) el cañón sigue al eje X de la mano y la parte de arriba del
    // arma apunta hacia delante (+Z del modelo).
    gltf.scene.updateMatrixWorld(true);
    const hand = gltf.scene.getObjectByName('Bip01_R_Hand');
    let grip = null;
    if (hand) {
      const hq = hand.getWorldQuaternion(new THREE.Quaternion());
      const along = X_AXIS.clone().applyQuaternion(hq).normalize();
      const up = new THREE.Vector3(0, 0, 1);
      up.sub(_v.copy(along).multiplyScalar(up.dot(along))).normalize();
      const wq = weaponQuat(along, up, new THREE.Quaternion());
      const q = hq.clone().invert().multiply(wq);
      // Centro de la palma: un poco hacia los dedos y hacia la palma (abajo en T).
      const palmW = along.clone().multiplyScalar(0.075).add(new THREE.Vector3(0, -0.035, 0));
      const p = palmW.applyQuaternion(hq.clone().invert());
      grip = { q, p };
    }
    t = { scene: gltf.scene, clips, hip, gender: g, grip, height: info.height ?? 1.75 };
  }
  templates.set(id, t);
  return t;
}

/** Cuaternión de un arma cuyo cañón (-Z) apunta a `dir` y su parte de arriba (+Y) a `up`. */
function weaponQuat(dir, up, out) {
  _m.lookAt(_v3.set(0, 0, 0), dir, up);
  return out.setFromRotationMatrix(_m);
}

/** Orienta un hueso (en mundo) para que su eje X apunte en `dir` (vector unitario del mundo). */
function pointBone(bone, dir, weight = 1) {
  bone.getWorldQuaternion(_q);
  const cur = _v.copy(X_AXIS).applyQuaternion(_q);
  _q2.setFromUnitVectors(cur, dir).multiply(_q); // nueva orientación en mundo
  setWorldQuat(bone, _q2, weight);
}

/** Pone la orientación de mundo de un hueso (mezclada con `weight`). */
const _qs = new THREE.Quaternion();
function setWorldQuat(bone, worldQ, weight = 1) {
  bone.parent.getWorldQuaternion(_qs).invert();
  _qs.multiply(worldQ);
  if (weight >= 1) bone.quaternion.copy(_qs);
  else bone.quaternion.slerp(_qs, weight);
  bone.updateMatrixWorld(true);
}

/** IK analítica de dos huesos: lleva la mano a `target` doblando el codo hacia `pole`. */
function ik2(upper, fore, hand, target, pole, weight) {
  const S = upper.getWorldPosition(new THREE.Vector3());
  const E = fore.getWorldPosition(new THREE.Vector3());
  const H = hand.getWorldPosition(new THREE.Vector3());
  const a = S.distanceTo(E);
  const b = E.distanceTo(H);
  const toT = new THREE.Vector3().subVectors(target, S);
  const d = clamp(toT.length(), 0.05, a + b - 0.002);
  const dir = toT.normalize();
  const cosA = clamp((a * a + d * d - b * b) / (2 * a * d), -1, 1);
  const sinA = Math.sqrt(1 - cosA * cosA);
  const n = pole.clone().sub(_v2.copy(dir).multiplyScalar(pole.dot(dir)));
  if (n.lengthSq() < 1e-6) n.set(0, -1, 0);
  n.normalize();
  const elbow = S.clone().addScaledVector(dir, a * cosA).addScaledVector(n, a * sinA);
  pointBone(upper, elbow.clone().sub(S).normalize(), weight);
  const E2 = fore.getWorldPosition(new THREE.Vector3());
  const T2 = S.clone().addScaledVector(dir, d);
  pointBone(fore, T2.sub(E2).normalize(), weight);
}

// Nodos de la mezcla de locomoción: [clip, velocidad en el juego (m/s)].
const LOCO = [
  ['walk', 1.35],
  ['jog', 3.0],
  ['sprint', 5.2],
];

// ------------------------------------------------------------------ rig con piel
export class SkinnedRig {
  constructor(look, tpl) {
    this.look = look;
    this.tpl = tpl;
    this.root = new THREE.Group();
    this.body = new THREE.Group(); // se inclina / cae
    this.root.add(this.body);
    this.model = SkeletonUtils.clone(tpl.scene);
    this.model.rotation.y = Math.PI; // el avatar mira a +Z; el juego a -Z
    // Estatura: ~1.76 m hombres y ~1.64 m mujeres, con algo de variación.
    const target = tpl.gender === 'f' ? 1.64 : 1.76;
    const s = (target / tpl.height) * clamp(look.height ?? 1, 0.96, 1.04);
    this.model.scale.setScalar(s);
    this.scale = s;
    this.body.add(this.model);
    this.bones = {};
    this.model.traverse((o) => {
      if (o.isBone) this.bones[o.name] = o;
      if (o.isSkinnedMesh) {
        o.castShadow = true;
        // Solo se anima lo que se dibuja (y más lento lo lejano).
        o.onBeforeRender = (r, sc, cam) => {
          this.rendered = this.frame;
          this.viewDist = cam.position.distanceTo(this.root.getWorldPosition(_v3));
        };
      }
    });
    this.mixer = new THREE.AnimationMixer(this.model);
    this.actions = {};
    for (const [name, { clip }] of Object.entries(tpl.clips)) {
      const a = this.mixer.clipAction(clip);
      a.play();
      a.setEffectiveWeight(0);
      a.setEffectiveTimeScale(0); // el tiempo lo lleva este rig
      this.actions[name] = a;
    }
    this.w = { idle: 1, walk: 0, jog: 0, sprint: 0, crouch: 0, sit: 0, air: 0 };
    this.t = { idle: Math.random() * 2, crouch: Math.random() * 3 };
    this.phase = Math.random();
    this.frame = 0;
    this.rendered = 0;
    this.viewDist = 0;
    this.accum = 0;
    this.weaponMount = new THREE.Group();
    const hand = this.bones.Bip01_R_Hand;
    if (hand && tpl.grip) {
      this.weaponMount.quaternion.copy(tpl.grip.q);
      this.weaponMount.position.copy(tpl.grip.p);
      hand.add(this.weaponMount);
    }
    this.weaponMesh = null;
    this.weaponId = null;
    this.aimBlend = 0;
    this.punchTimer = 0;
    this.deadBlend = 0;
    this.driveBlend = 0;
    this.lean = 0;
    this.sitHip = (tpl.clips.sit?.clip.tracks.find((t) => t.name === 'Bip01.position')?.values[1] ?? 0.53) * s;
  }

  setWeapon(id) {
    if (id === this.weaponId) return;
    this.weaponId = id;
    if (this.weaponMesh) this.weaponMount.remove(this.weaponMesh);
    this.weaponMesh = id && id !== 'fists' ? buildWeaponMesh(id) : null;
    this._shadowMeshes = null; // la lista de mallas con sombra cambió
    this._shadowOn = undefined;
    if (this.weaponMesh) {
      // buildWeaponMesh orienta el cañón para el muñeco; aquí el agarre ya
      // está calculado: cañón en -Z y empuñadura en el origen.
      this.weaponMesh.rotation.set(0, 0, 0);
      this.weaponMesh.position.set(0, -0.04, 0.02);
      this.weaponMount.add(this.weaponMesh);
    }
  }

  muzzleWorld(out) {
    if (this.weaponMesh?.userData.muzzle) return this.weaponMesh.userData.muzzle.getWorldPosition(out);
    return (this.bones.Bip01_R_Hand ?? this.root).getWorldPosition(out);
  }

  punch() {
    this.punchTimer = 0.35;
  }

  animate(dt, st) {
    this.frame++;
    const speed = st.speed ?? 0;
    const driving = st.driving ?? null;
    const dead = !!st.dead;
    const crouch = !!st.crouching && !driving;
    const air = !st.onGround && !driving && !dead;

    this.aimBlend = damp(this.aimBlend, st.aiming ? 1 : 0, 14, dt);
    this.deadBlend = damp(this.deadBlend, dead ? 1 : 0, 6, dt);
    this.driveBlend = damp(this.driveBlend, driving ? 1 : 0, 10, dt);
    this.lean = damp(this.lean, speed > 5.5 ? 0.12 : 0, 5, dt);
    if (this.punchTimer > 0) this.punchTimer -= dt;

    // Pesos objetivo de cada clip.
    const tw = { idle: 0, walk: 0, jog: 0, sprint: 0, crouch: 0, sit: 0, air: 0 };
    if (driving) tw.sit = 1;
    else if (air) tw.air = 1;
    else if (crouch) {
      tw.crouch = 1;
    } else if (speed < 0.12) tw.idle = 1;
    else if (speed < LOCO[0][1]) {
      const k = (speed - 0.12) / (LOCO[0][1] - 0.12);
      tw.idle = 1 - Math.min(1, k * 2.5);
      tw.walk = 1 - tw.idle;
    } else {
      let i = 0;
      while (i < LOCO.length - 1 && speed > LOCO[i + 1][1]) i++;
      if (i >= LOCO.length - 1) tw.sprint = 1;
      else {
        const k = (speed - LOCO[i][1]) / (LOCO[i + 1][1] - LOCO[i][1]);
        tw[LOCO[i][0]] = 1 - k;
        tw[LOCO[i + 1][0]] = k;
      }
    }
    const rate = driving || dead ? 8 : 10;
    for (const k in this.w) this.w[k] = damp(this.w[k], tw[k], rate, dt);

    // Lo que no se dibuja no se anima (y lo lejano, a menor frecuencia).
    this.accum += dt;
    const visible = this.frame - this.rendered <= 2 || this.frame < 3;
    const every = !visible ? 8 : this.viewDist > 70 ? 3 : this.viewDist > 35 ? 2 : 1;
    if (this.frame % every !== 0 && this.punchTimer <= 0 && this.deadBlend < 0.01) return;
    const step = this.accum;
    this.accum = 0;
    if (!visible) return;

    // Fase compartida de locomoción (los ciclos quedan sincronizados).
    let cyc = 0;
    let wsum = 0;
    for (const [name] of LOCO) {
      const c = this.tpl.clips[name];
      if (!c || this.w[name] < 1e-3) continue;
      const ts = clamp(speed / c.speed, 0.55, 1.6);
      cyc += (this.w[name] * ts) / c.clip.duration;
      wsum += this.w[name];
    }
    if (wsum > 0) this.phase = (this.phase + (step * cyc) / wsum) % 1;
    this.t.idle += step;
    this.t.crouch += step * (crouch && speed > 0.3 ? 1.6 : 1);

    const A = this.actions;
    const set = (name, weight, time) => {
      const a = A[name];
      if (!a) return;
      a.setEffectiveWeight(weight);
      a.time = time % a.getClip().duration;
    };
    set('idle', this.w.idle, this.t.idle);
    set('crouch', this.w.crouch, this.t.crouch);
    set('sit', this.w.sit, 0);
    for (const [name] of LOCO) set(name, name === 'sprint' ? this.w.sprint + this.w.air : this.w[name], this.phase * (A[name]?.getClip().duration ?? 1));
    // En el aire: cuadro de zancada del sprint (piernas abiertas), congelado.
    if (this.w.air > 0.05 && A.sprint) A.sprint.time = 0.25 * A.sprint.getClip().duration;
    // Agachado caminando: un poco del ciclo de caminar sobre el agachado.
    if (crouch && speed > 0.3 && A.walk) {
      A.walk.setEffectiveWeight(0.35);
      A.walk.time = this.phase * A.walk.getClip().duration;
      this.phase = (this.phase + (step * speed) / 1.2) % 1;
    }
    this.mixer.update(0);

    // Sentado: cadera sobre el asiento. world.js/Game ponen la raíz en
    // asiento - 0.5 (+0.35 en moto); en carro se sube un poco para que se
    // vean hombros y brazos por la ventana.
    const db = this.driveBlend;
    // Sentado: en moto, en carro o en una silla plástica frente a la tienda.
    const seatHip = driving === 'moto' ? 0.55 : driving === 'chair' ? 0.47 : 0.64;
    this.model.position.y = (seatHip - this.sitHip) * db;
    this.model.position.z = 0;

    // Inclinación al correr / muerte (cae de espaldas).
    const d = this.deadBlend;
    this.body.rotation.x = d > 0.001 ? d * (Math.PI / 2) * 0.97 : -this.lean * (1 - this.aimBlend);
    this.body.position.y = d > 0.001 ? d * 0.13 : 0;

    // ---------------------------------------------- capas por código
    const a = this.aimBlend;
    const needArms = a > 0.01 || this.punchTimer > 0 || (db > 0.01 && driving !== 'chair') || d > 0.01;
    if (needArms) {
      this.root.updateMatrixWorld(true);
      if (db > 0.01 && driving !== 'chair') this._driveArms(driving === 'moto', db * (1 - a));
      if (a > 0.01 && d < 0.5) this._aimArms(st.aimPitch ?? 0, a);
      if (this.punchTimer > 0) this._punchArm();
      if (d > 0.01) this._limp(d);
    }
  }

  /** Marco del personaje en el mundo: adelante, derecha, arriba. */
  _frame(pitch = 0) {
    const q = this.root.getWorldQuaternion(new THREE.Quaternion());
    const fwd = new THREE.Vector3(0, Math.sin(pitch), -Math.cos(pitch)).applyQuaternion(q);
    const flat = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
    return { fwd, flat, right, q };
  }

  _aimArms(pitch, w) {
    const B = this.bones;
    if (!B.Bip01_R_UpperArm) return;
    const { fwd, right } = this._frame(pitch);
    const up = new THREE.Vector3().crossVectors(right, fwd).normalize();
    // Torso y cabeza acompañan la mira arriba/abajo.
    if (B.Bip01_Spine1) {
      _q.setFromAxisAngle(right, pitch * 0.35 * w);
      B.Bip01_Spine1.getWorldQuaternion(_q2);
      setWorldQuat(B.Bip01_Spine1, _q.multiply(_q2), 1);
    }
    const shR = B.Bip01_R_UpperArm.getWorldPosition(new THREE.Vector3());
    const shL = B.Bip01_L_UpperArm.getWorldPosition(new THREE.Vector3());
    const mid = shR.clone().add(shL).multiplyScalar(0.5);
    const twoHanded = this.weaponId && !['pistol', 'machete', 'fists'].includes(this.weaponId);
    let gripR;
    let gripL;
    if (twoHanded) {
      // Culata al hombro derecho, mano izquierda en el guardamanos.
      gripR = shR.clone().addScaledVector(fwd, 0.26).addScaledVector(up, -0.01).addScaledVector(right, 0.01);
      gripL = gripR.clone().addScaledVector(fwd, this.weaponId === 'smg' ? 0.2 : 0.32).addScaledVector(up, 0.02).addScaledVector(right, -0.02);
    } else {
      // Pistola a dos manos, brazos extendidos al frente.
      gripR = mid.clone().addScaledVector(fwd, 0.48).addScaledVector(up, -0.03).addScaledVector(right, 0.03);
      gripL = gripR.clone().addScaledVector(right, -0.05).addScaledVector(up, -0.03).addScaledVector(fwd, -0.02);
    }
    const poleR = right.clone().multiplyScalar(0.6).addScaledVector(up, -1);
    const poleL = right.clone().multiplyScalar(-0.6).addScaledVector(up, -1);
    ik2(B.Bip01_R_UpperArm, B.Bip01_R_Forearm, B.Bip01_R_Hand, gripR, poleR, w);
    // Mano derecha: el arma apunta en `fwd` con la parte de arriba hacia `up`.
    if (this.tpl.grip) {
      const wq = weaponQuat(fwd, up, new THREE.Quaternion());
      const hq = wq.multiply(this.tpl.grip.q.clone().invert());
      setWorldQuat(B.Bip01_R_Hand, hq, w);
    }
    if (this.weaponId && this.weaponId !== 'machete') {
      ik2(B.Bip01_L_UpperArm, B.Bip01_L_Forearm, B.Bip01_L_Hand, gripL, poleL, w);
    }
  }

  _punchArm() {
    const B = this.bones;
    if (!B.Bip01_R_UpperArm) return;
    const t = 1 - this.punchTimer / 0.35;
    const hit = Math.sin(t * Math.PI);
    const { flat, right } = this._frame();
    const sh = B.Bip01_R_UpperArm.getWorldPosition(new THREE.Vector3());
    let target;
    if (this.weaponId === 'machete') {
      // Machetazo: de arriba-atrás a adelante-abajo.
      const ang = lerp(2.3, -0.5, t);
      target = sh.clone().addScaledVector(flat, Math.cos(ang) * 0.5).add(new THREE.Vector3(0, Math.sin(ang) * 0.5, 0));
    } else {
      target = sh.clone().addScaledVector(flat, 0.6).addScaledVector(right, -0.12).add(new THREE.Vector3(0, -0.05, 0));
    }
    ik2(B.Bip01_R_UpperArm, B.Bip01_R_Forearm, B.Bip01_R_Hand, target, right.clone().add(new THREE.Vector3(0, -1, 0)), hit);
  }

  _driveArms(moto, w) {
    const B = this.bones;
    if (!B.Bip01_R_UpperArm) return;
    const { flat, right } = this._frame();
    const hips = (B.Bip01_Pelvis ?? this.root).getWorldPosition(new THREE.Vector3());
    const up = new THREE.Vector3(0, 1, 0);
    if (moto) {
      // Moto tipo cruiser: espalda casi recta, apenas inclinada al manubrio.
      if (B.Bip01_Spine1) {
        _q.setFromAxisAngle(right, -0.18 * w);
        B.Bip01_Spine1.getWorldQuaternion(_q2);
        setWorldQuat(B.Bip01_Spine1, _q.multiply(_q2), 1);
      }
    }
    // Manubrio de cruiser: alto, cerca del pecho y ancho.
    const reach = moto ? 0.5 : 0.42;
    const height = moto ? 0.42 : 0.32;
    const spread = moto ? 0.36 : 0.19;
    const c = hips.clone().addScaledVector(flat, reach).addScaledVector(up, height);
    ik2(B.Bip01_R_UpperArm, B.Bip01_R_Forearm, B.Bip01_R_Hand, c.clone().addScaledVector(right, spread), right.clone().addScaledVector(up, -1), w);
    ik2(B.Bip01_L_UpperArm, B.Bip01_L_Forearm, B.Bip01_L_Hand, c.clone().addScaledVector(right, -spread), right.clone().negate().addScaledVector(up, -1), w);
    if (moto) {
      // Piernas abiertas a los lados del tanque.
      for (const [name, s] of [
        ['Bip01_L_Thigh', -1],
        ['Bip01_R_Thigh', 1],
      ]) {
        const b = B[name];
        if (!b) continue;
        _q.setFromAxisAngle(flat, s * 0.25 * w);
        b.getWorldQuaternion(_q2);
        setWorldQuat(b, _q.multiply(_q2), 1);
      }
    }
  }

  /** Cuerpo sin fuerza al morir: brazos abiertos y rodillas algo dobladas. */
  _limp(d) {
    const B = this.bones;
    // Marco del cuerpo ya caído (arriba = hacia la cabeza).
    const q = this.body.getWorldQuaternion(new THREE.Quaternion());
    const flat = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
    if (B.Bip01_R_UpperArm) pointBone(B.Bip01_R_UpperArm, right.clone().addScaledVector(up, -0.35).addScaledVector(flat, -0.2).normalize(), d);
    if (B.Bip01_L_UpperArm) pointBone(B.Bip01_L_UpperArm, right.clone().negate().addScaledVector(up, 0.25).addScaledVector(flat, -0.15).normalize(), d);
    if (B.Bip01_R_Forearm) pointBone(B.Bip01_R_Forearm, right.clone().addScaledVector(up, 0.4).normalize(), d * 0.8);
    if (B.Bip01_Head) {
      _q.setFromAxisAngle(flat, 0.4 * d);
      B.Bip01_Head.getWorldQuaternion(_q2);
      setWorldQuat(B.Bip01_Head, _q.multiply(_q2), 1);
    }
    if (B.Bip01_L_Calf) {
      _q.setFromAxisAngle(right, -0.5 * d);
      B.Bip01_L_Thigh.getWorldQuaternion(_q2);
      setWorldQuat(B.Bip01_L_Thigh, _q.multiply(_q2), 1);
    }
  }

  /** Sombra solo de cerca: cada personaje con sombra repite su malla con esqueleto en el mapa de sombras. */
  setShadow(on) {
    setRigShadow(this, on);
  }

  dispose() {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.model);
    this.root.removeFromParent();
  }
}

/** Activa/desactiva castShadow de todas las mallas del personaje (solo si cambia). */
export function setRigShadow(rig, on) {
  if (rig._shadowOn === on) return;
  rig._shadowOn = on;
  rig._shadowMeshes ??= [];
  if (!rig._shadowMeshes.length) rig.root.traverse((o) => o.isMesh && rig._shadowMeshes.push(o));
  for (const m of rig._shadowMeshes) m.castShadow = on;
}

// ------------------------------------------------------------------ fábrica
/**
 * `new CharacterRig(look)` devuelve un SkinnedRig (Rocketbox) si el avatar y
 * las animaciones están cargados; si no, el ProceduralRig de respaldo.
 */
export class CharacterRig {
  constructor(look) {
    const id = look.avatar ?? (look.outfit === 'player' ? 'jugador' : null);
    const tpl = id ? getTemplate(id) : null;
    if (tpl && tpl.clips.idle && tpl.clips.walk) return new SkinnedRig(look, tpl);
    return new ProceduralRig(look);
  }
}
