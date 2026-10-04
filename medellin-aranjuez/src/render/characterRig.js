// Personajes humanos con esqueleto y animaciones reales (Microsoft Rocketbox,
// MIT). Cada instancia clona el avatar con SkeletonUtils (geometría y
// materiales compartidos) y tiene su propio AnimationMixer. Por capas:
//  1. Base (mezclador): reposo / caminar / trotar / correr (timeScale ajustado
//     a la velocidad real para que los pies no patinen), agachado, sentado
//     (conducir o silla) y salto. Cada ranura cambia de clip según el estilo
//     (`st.style`: cojeando, borracho, paseando, sobrado) o el asiento.
//  2. Brazos continuos (`st.upper`: celular, hablar, escuchar...), solo del
//     torso para arriba, encima de lo que hagan las piernas.
//  3. Gestos de una vez (`play(nombre)`: saludar, recibir, beber, abrir la
//     puerta, sentarse, levantarse...) y gestos de relleno cuando el
//     personaje lleva un rato quieto (`st.fidget`).
//  4. Por código: apuntar (IK de dos huesos en ambos brazos), golpe /
//     machetazo, manos al volante / manubrio y muerte.
// Los clips se escalan por avatar la primera vez que se usan y las capas 2 y
// 3 se evalúan a mano (sin acciones del mezclador): un peatón que solo camina
// no paga por el resto del catálogo.
//
// Si los GLB no están (o fallan), `new CharacterRig(look)` devuelve el muñeco
// procedural de siempre (ProceduralRig), con la misma API:
//   .root, .setWeapon(id), .muzzleWorld(v), .punch(), .animate(dt, st),
//   .play(nombre, opciones), .stopGesture(), .gesture, .hasClip(n),
//   .clipInfo(n), .dispose(), .deadBlend
//
// Además, para las actividades del barrio (game/activities.js): `st.lookAt`
// (la cabeza sigue un punto), `st.idle` (qué reposo usa), `st.seat`
// ('table': sentado a la mesa), `.post(rig, dt)` (pose por código al final
// de cada actualización: colgar ropa, patear, barrer...) y `.forceProp`
// (utilería fija en la mano derecha: cigarrillo).

import * as THREE from 'three';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { damp, lerp, clamp, angleDiff } from '../sim/math.js';
import { FIDGETS, pickFidget, fidgetDelay } from '../sim/animSelect.js';
import { assets } from './assets.js';
import { registerAssets } from './assetManifest.js';
import { ProceduralRig, randomLook as proceduralLook, PLAYER_LOOK as PROCEDURAL_PLAYER, buildWeaponMesh } from './proceduralRig.js';
import { weaponModel } from './weaponModels.js';

export { ProceduralRig, buildWeaponMesh };
// Utilidades de pose para las actividades (render/activityPoses.js).
export { ik2, pointBone, setWorldQuat };

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
  { key: ANIM_KEY, type: 'gltf', url: 'models/personajes/animaciones.glb', post: unpackClips },
]);

/**
 * El GLB de animaciones trae todos los clips empacados en una animación glTF
 * "empaque" de dos pistas (ver scripts/assets/rocketbox.mjs, packAnimations):
 * aquí se rearma un AnimationClip por clip. Sin empaque (formato anterior) se
 * deja tal cual.
 */
export function unpackClips(gltf) {
  const pk = gltf.scene?.userData?.packed;
  const pack = gltf.animations?.find((a) => a.name === 'empaque');
  if (!pk || !pack) return gltf;
  const lines = [pack.tracks.find((t) => t.name.endsWith('.quaternion')), pack.tracks.find((t) => t.name.endsWith('.position'))];
  gltf.animations = pk.clips.map((c) => {
    const tracks = [];
    for (const [bone, kind, first, n, base] of c.tracks) {
      const L = lines[kind];
      if (!L) continue;
      const size = kind ? 3 : 4;
      const times = new Float32Array(n);
      for (let i = 0; i < n; i++) times[i] = (L.times[first + i] - base) / pk.fps;
      const values = L.values.slice(first * size, (first + n) * size);
      const name = pk.bones[bone];
      tracks.push(kind ? new THREE.VectorKeyframeTrack(`${name}.position`, times, values) : new THREE.QuaternionKeyframeTrack(`${name}.quaternion`, times, values));
    }
    return new THREE.AnimationClip(c.name, c.duration, tracks);
  });
  return gltf;
}

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
const _qt = new THREE.Quaternion();
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _v4 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const X_AXIS = new THREE.Vector3(1, 0, 0);
const UP = new THREE.Vector3(0, 1, 0);

/** Prepara (una vez por avatar) la escena fuente, los clips disponibles y el agarre del arma. */
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
    // Clips de su género; los que no tienen versión femenina usan la masculina.
    const src = new Map();
    for (const c of anim.animations) {
      const pre = c.name.slice(0, 2);
      const name = c.name.slice(2);
      if (pre === `${g}_` || (pre === 'm_' && !src.has(name))) src.set(name, { raw: c, meta: meta[c.name] ?? {} });
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
    let props = null;
    if (hand) {
      const hq = hand.getWorldQuaternion(new THREE.Quaternion());
      const hqi = hq.clone().invert();
      const along = X_AXIS.clone().applyQuaternion(hq).normalize();
      const up = new THREE.Vector3(0, 0, 1);
      up.sub(_v.copy(along).multiplyScalar(up.dot(along))).normalize();
      const wq = weaponQuat(along, up, new THREE.Quaternion());
      const q = hqi.clone().multiply(wq);
      // Centro de la palma: un poco hacia los dedos y hacia la palma (abajo en T).
      const palmW = along.clone().multiplyScalar(0.075).add(new THREE.Vector3(0, -0.035, 0));
      const p = palmW.clone().applyQuaternion(hqi);
      grip = { q, p };
      // Utilería en la mano derecha (vaso, celular): marco de la palma en T
      // (dedos, normal de la palma hacia abajo, pulgar hacia delante).
      const palmN = new THREE.Vector3(0, -1, 0);
      const thumb = new THREE.Vector3().crossVectors(palmN, along).normalize();
      if (thumb.z < 0) thumb.negate();
      const frame = (x, y, z, off) => ({
        q: hqi.clone().multiply(new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z))),
        p: off.applyQuaternion(hqi),
      });
      props = {
        // Vaso: eje a lo largo del pulgar, por fuera de la palma.
        cup: frame(new THREE.Vector3().crossVectors(thumb, palmN), thumb, palmN, palmW.clone().addScaledVector(palmN, 0.03).addScaledVector(along, -0.01)),
        // Celular: a lo largo de los dedos, pegado a la palma.
        phone: frame(new THREE.Vector3().crossVectors(along, palmN), along, palmN, palmW.clone().addScaledVector(palmN, 0.012)),
      };
    }
    t = { scene: gltf.scene, src, clips: new Map(), hip, gender: g, grip, props, height: info.height ?? 1.75 };
  }
  templates.set(id, t);
  return t;
}

/**
 * Clip `name` escalado a la cadera del avatar (perezoso, compartido por todas
 * sus instancias): {clip, speed, duration, loop, kind, end} o null.
 */
function tplClip(tpl, name) {
  let c = tpl.clips.get(name);
  if (c !== undefined) return c;
  const s = tpl.src.get(name);
  c = null;
  if (s) {
    // La posición de la cadera viene normalizada (1.0 = altura de cadera); las
    // rotaciones se comparten tal cual.
    const tracks = s.raw.tracks.map((tr) => {
      if (tr.name !== 'Bip01.position') return tr;
      const tt = tr.clone();
      for (let i = 0; i < tt.values.length; i++) tt.values[i] *= tpl.hip;
      return tt;
    });
    const m = s.meta;
    const clip = new THREE.AnimationClip(name, s.raw.duration, tracks);
    c = { clip, name, speed: m.speed || 1, duration: clip.duration, loop: m.loop ?? m.kind !== 'once', kind: m.kind ?? 'loop', end: m.end ?? null };
  }
  tpl.clips.set(name, c);
  return c;
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

// Huesos de la capa de brazos (celular, hablar, beber...): brazos, cuello y
// cabeza. La columna se queda con la base: sentado, el torso se sostiene con
// la columna inclinada hacia delante y una columna de pie lo echaba para atrás.
const UPPER = /^Bip01_(Neck|Head|[LR]_(Clavicle|UpperArm|Forearm|Hand|Finger\d+))$/;

// Nodos de la mezcla de locomoción: [ranura, velocidad en el juego (m/s)].
const LOCO = [
  ['walk', 1.35],
  ['jog', 3.0],
  ['sprint', 5.2],
];

// Clip de caminar de cada estilo.
const STYLE_WALK = { injured: 'walk_injured', drunk: 'walk_drunk', stroll: 'walk_stroll', cool: 'walk_cool' };

// Utilería que aparece en la mano derecha con ciertos clips.
const PROP_OF = { phone: 'phone', text: 'phone', drink: 'cup', smoke_idle: 'cup' };
const PROP_KINDS = ['cup', 'phone', 'cig'];
const propMeshes = {};
function propMesh(kind) {
  if (kind === 'cig') return cigaretteMesh();
  const shared = (propMeshes[kind] ??=
    kind === 'cup'
      ? // Vaso desechable de gaseosa / tinto.
        { g: new THREE.CylinderGeometry(0.037, 0.029, 0.105, 14), m: new THREE.MeshStandardMaterial({ color: 0xf1ede4, roughness: 0.55 }) }
      : // Celular.
        { g: new THREE.BoxGeometry(0.07, 0.148, 0.009), m: new THREE.MeshStandardMaterial({ color: 0x1b1d22, roughness: 0.35, metalness: 0.2 }) });
  const mesh = new THREE.Mesh(shared.g, shared.m);
  mesh.name = kind === 'cup' ? 'vaso' : 'celular';
  mesh.castShadow = false;
  return mesh;
}

/**
 * Cigarrillo entre los dedos: papel blanco, filtro y la brasa (sin luz: un
 * material básico naranja que de noche se ve encendido). Geometría y
 * materiales compartidos por todos los fumadores.
 */
const cigShared = {};
function cigaretteMesh() {
  if (!cigShared.g) {
    cigShared.g = new THREE.CylinderGeometry(0.0045, 0.0045, 0.07, 6);
    cigShared.g.rotateZ(Math.PI / 2);
    cigShared.paper = new THREE.MeshStandardMaterial({ color: 0xf2f0ea, roughness: 0.8 });
    cigShared.fg = new THREE.CylinderGeometry(0.0047, 0.0047, 0.02, 6);
    cigShared.fg.rotateZ(Math.PI / 2);
    cigShared.filter = new THREE.MeshStandardMaterial({ color: 0xc98a45, roughness: 0.8 });
    cigShared.eg = new THREE.SphereGeometry(0.0052, 6, 4);
    cigShared.ember = new THREE.MeshBasicMaterial({ color: 0xff5a14 });
  }
  const g = new THREE.Group();
  g.name = 'cigarrillo';
  const paper = new THREE.Mesh(cigShared.g, cigShared.paper);
  const filter = new THREE.Mesh(cigShared.fg, cigShared.filter);
  filter.position.x = -0.045;
  const ember = new THREE.Mesh(cigShared.eg, cigShared.ember);
  ember.position.x = 0.036;
  ember.name = 'brasa';
  g.add(paper, filter, ember);
  for (const m of [paper, filter, ember]) m.castShadow = false;
  // El marco del vaso tiene X hacia afuera de la palma: el cigarrillo sale
  // entre los dedos índice y medio, un poco hacia la punta.
  g.userData.ember = ember;
  return g;
}

const smoothstep = (x) => x * x * (3 - 2 * x);

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
    // `look.scale`: muchachos (el picadito) un poco más bajitos.
    const s = (target / tpl.height) * clamp(look.height ?? 1, 0.96, 1.04) * (look.scale ?? 1);
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
    this.actions = {}; // acciones del mezclador, creadas al primer uso
    this.w = { idle: 1 }; // peso actual de cada clip de la base
    this._tw = {};
    this.slots = { idle: 'idle', walk: 'walk', jog: 'jog', sprint: 'sprint', crouch: 'crouch', sit: 'sit' };
    this.clock = Math.random() * 20;
    this.tCrouch = Math.random() * 3;
    this.airW = 0;
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
    this.sitHip = (tplClip(tpl, 'sit')?.clip.tracks.find((t) => t.name === 'Bip01.position')?.values[1] ?? 0.53) * s;
    // Capas encima del mezclador (brazos continuos y gestos).
    this.layers = [];
    this.upperName = null;
    this.still = 0;
    this.nextFidget = fidgetDelay(true, Math.random());
    this.lastFidget = null;
    this._binds = new Map();
    this.props = {};
    // Pose que dejó el mezclador: se repone antes de cada actualización (ver animate).
    this.poseBones = Object.values(this.bones).filter((b) => b.name.startsWith('Bip01'));
    this.animPose = this.poseBones.map((b) => b.quaternion.clone());
    this.hipBone = this.bones.Bip01 ?? null;
    this.animHip = this.hipBone ? this.hipBone.position.clone() : null;
    this.footDown = 0;
    // Giro: velocidad angular (para dar pasos al girar en el sitio e
    // inclinarse en las curvas).
    this.yawPrev = null;
    this.yawRate = 0;
    this.bank = 0;
    // Mirar a un punto (cabeza y cuello).
    this.lookW = 0;
    this.lookYaw = 0;
    this.lookPitch = 0;
    this.post = null;
    this.forceProp = null;
  }

  setWeapon(id) {
    if (id === this.weaponId) return;
    this.weaponId = id;
    if (this.weaponMesh) this.weaponMount.remove(this.weaponMesh);
    // Modelo real (o procedural de respaldo) con el cañón en -Z y la
    // empuñadura en el origen: el mismo marco del soporte de la mano.
    this.weaponMesh = weaponModel(id);
    this._shadowMeshes = null; // la lista de mallas con sombra cambió
    this._shadowOn = undefined;
    if (this.weaponMesh) this.weaponMount.add(this.weaponMesh);
  }

  muzzleWorld(out) {
    if (this.weaponMesh?.userData.muzzle) return this.weaponMesh.userData.muzzle.getWorldPosition(out);
    return (this.bones.Bip01_R_Hand ?? this.root).getWorldPosition(out);
  }

  punch() {
    this.punchTimer = 0.35;
  }

  // ------------------------------------------------------------ gestos
  hasClip(name) {
    return !!name && !!tplClip(this.tpl, name);
  }

  /** {duration, loop, end: {dx, dz, dyaw} en el marco de la raíz} o null. */
  clipInfo(name) {
    const c = tplClip(this.tpl, name);
    return c ? { duration: c.duration, loop: c.loop, end: c.end ? this._endDelta(c.end) : null } : null;
  }

  /**
   * Gesto de una vez (o en bucle con loop: true) encima de la base. Opciones:
   * speed, from / to (s del clip), fadeIn / fadeOut (s), hold (se queda en el
   * último cuadro hasta stopGesture o commitRootMotion), mask: 'auto' (todo
   * el cuerpo si está de pie y quieto; del torso para arriba caminando o
   * sentado) | 'full' | 'upper'. Devuelve la capa ({t, dur, w, ended...}).
   */
  play(name, opts = {}) {
    const c = tplClip(this.tpl, name);
    if (!c) return null;
    // Un gesto a la vez: el anterior se desvanece.
    for (const L of this.layers) {
      if (L.slot === 'gesture' && L.target > 0) {
        L.target = 0;
        L.fadeOut = Math.min(L.fadeOut, opts.fadeIn ?? 0.25);
      }
    }
    return this._layer(c, { slot: 'gesture', ...opts });
  }

  /** Desvanece el gesto en curso. */
  stopGesture(fade = 0.25) {
    for (const L of this.layers) {
      if (L.slot !== 'gesture') continue;
      L.target = 0;
      L.fadeOut = Math.max(0.01, fade);
    }
  }

  /** Nombre del gesto en curso (o null). */
  get gesture() {
    return this.gestureLayer?.name ?? null;
  }

  get gestureLayer() {
    for (let i = this.layers.length - 1; i >= 0; i--) if (this.layers[i].slot === 'gesture' && this.layers[i].target > 0) return this.layers[i];
    return null;
  }

  /**
   * Aplica el desplazamiento de cadera del gesto en curso que lo tenga
   * (sentarse, levantarse): devuelve {dx, dz, dyaw} en el marco de la raíz
   * para que quien la mueve la lleve allá. Desde ese momento el gesto se
   * dibuja relativo a la nueva raíz y se desvanece sin que la cadera salte.
   */
  commitRootMotion(fade = 0.2) {
    const L = this.layers.find((l) => l.slot === 'gesture' && l.c.end && !l.corr);
    if (!L) return null;
    const e = L.c.end;
    L.corr = { x: e.x * this.tpl.hip, z: e.z * this.tpl.hip, q: new THREE.Quaternion().setFromAxisAngle(Y_AXIS, -e.yaw) };
    L.target = 0;
    L.fadeOut = Math.max(0.01, fade);
    return this._endDelta(e);
  }

  _endDelta(e) {
    // Espacio del clip (mira a +Z) -> raíz (mira a -Z): giro de 180° y escala.
    const k = this.tpl.hip * this.scale;
    return { dx: -e.x * k, dz: -e.z * k, dyaw: e.yaw };
  }

  _layer(c, o) {
    const L = {
      name: c.name,
      c,
      slot: o.slot,
      t: o.from ?? 0,
      dur: Math.min(c.duration, o.to ?? c.duration),
      speed: o.speed ?? 1,
      loop: o.loop ?? o.slot === 'upper',
      mask: o.mask ?? 'auto',
      w: o.instant ? 1 : 0,
      target: 1,
      fadeIn: Math.max(0.01, o.fadeIn ?? 0.25),
      fadeOut: Math.max(0.01, o.fadeOut ?? 0.3),
      hold: !!o.hold,
      fidget: !!o.fidget,
      corr: null,
      ended: false,
      binds: this._bind(c),
    };
    this.layers.push(L);
    return L;
  }

  /** Interpoladores de las pistas de un clip sobre los huesos de esta instancia (caché corta). */
  _bind(c) {
    let b = this._binds.get(c.name);
    if (b) {
      this._binds.delete(c.name);
      this._binds.set(c.name, b);
      return b;
    }
    b = [];
    for (const tr of c.clip.tracks) {
      const [node, prop] = tr.name.split('.');
      const bone = this.bones[node];
      if (!bone) continue;
      b.push({ bone, interp: tr.createInterpolant(), pos: prop === 'position', upper: UPPER.test(node), root: node === 'Bip01' });
    }
    this._binds.set(c.name, b);
    if (this._binds.size > 8) this._binds.delete(this._binds.keys().next().value);
    return b;
  }

  /** Lógica de las capas (cada cuadro, aunque no se dibuje): qué suena, tiempos y fundidos. */
  _updateLayers(dt, st, moving, blocked, dead) {
    const driving = st.driving ?? null;
    // Brazos continuos.
    const want = !blocked && st.upper && this.hasClip(st.upper) ? st.upper : null;
    if (want !== this.upperName) {
      for (const L of this.layers) if (L.slot === 'upper') L.target = 0;
      this.upperName = want;
      if (want) this._layer(tplClip(this.tpl, want), { slot: 'upper', mask: 'upper', fadeIn: 0.4, fadeOut: 0.4, from: Math.random() * 3 });
    }
    // Gestos de relleno: de pie o en la silla, quieto y sin nada en las manos.
    const idle = st.fidget && !blocked && !moving && !want && (!driving || driving === 'chair') && !this.gestureLayer;
    if (idle) {
      this.still += dt;
      if (this.still >= this.nextFidget) {
        const name = pickFidget(st.fidgets ?? (driving ? FIDGETS.sit : FIDGETS.stand), this.lastFidget, Math.random(), (n) => this.hasClip(n));
        if (name) this.play(name, { fidget: true, fadeIn: 0.45, fadeOut: 0.55 });
        this.lastFidget = name;
        this.nextFidget = this.still + fidgetDelay(false, Math.random());
      }
    } else if (moving || blocked || !st.fidget) {
      this.still = 0;
      this.nextFidget = Math.max(this.nextFidget, 4);
    }
    // Tiempos y fundidos.
    for (let i = this.layers.length - 1; i >= 0; i--) {
      const L = this.layers[i];
      if (dead || (L.fidget && moving) || (blocked && (L.slot !== 'gesture' || L.fidget))) {
        L.target = 0;
        L.fadeOut = Math.min(L.fadeOut, 0.2);
      }
      L.t += dt * L.speed;
      if (!L.loop) {
        if (L.t >= L.dur) {
          L.t = L.dur;
          L.ended = true;
          if (!L.hold) L.target = 0;
        } else if (!L.hold && (L.dur - L.t) / L.speed < L.fadeOut) L.target = 0;
      }
      if (L.target > L.w) L.w = Math.min(L.target, L.w + dt / L.fadeIn);
      else L.w = Math.max(L.target, L.w - dt / L.fadeOut);
      if (L.target === 0 && L.w <= 0) {
        L.ended = true;
        this.layers.splice(i, 1);
      }
    }
  }

  /** Mezcla las capas sobre la pose del mezclador. */
  _applyLayers(moving, seated) {
    for (const L of this.layers) {
      if (L.w <= 0.001) continue;
      const w = smoothstep(Math.min(1, L.w));
      const seatedClip = L.name.startsWith('sit_') && !L.c.end;
      const upperOnly = L.mask === 'upper' || (L.mask === 'auto' && (moving || seated !== seatedClip));
      const t = L.loop ? L.t % L.c.duration : Math.min(L.t, L.dur);
      for (const b of L.binds) {
        if (upperOnly && !b.upper) continue;
        const v = b.interp.evaluate(t);
        if (b.pos) {
          _v4.set(v[0], v[1], v[2]);
          if (L.corr) {
            _v4.x -= L.corr.x;
            _v4.z -= L.corr.z;
            _v4.applyQuaternion(L.corr.q);
          }
          b.bone.position.lerp(_v4, w);
        } else {
          _q.set(v[0], v[1], v[2], v[3]);
          if (L.corr && b.root) _q.premultiply(L.corr.q);
          if (w >= 0.999) b.bone.quaternion.copy(_q);
          else b.bone.quaternion.slerp(_q, w);
        }
      }
    }
  }

  /** Vaso o celular en la mano derecha mientras algún clip lo pide. */
  _updateProps() {
    const hand = this.bones.Bip01_R_Hand;
    if (!hand || !this.tpl.props) return;
    let want = null;
    let best = 0.35;
    for (const L of this.layers) {
      const p = PROP_OF[L.name];
      if (p && L.w > best) {
        want = p;
        best = L.w;
      }
    }
    if (this.forceProp && (!want || want === 'cup')) want = this.forceProp;
    if (this.aimBlend > 0.3 || (this.weaponId && this.weaponId !== 'fists')) want = null;
    for (const kind of PROP_KINDS) {
      let m = this.props[kind];
      if (!m && want === kind) {
        m = this.props[kind] = propMesh(kind);
        const fr = this.tpl.props[kind === 'cig' ? 'cup' : kind];
        m.quaternion.copy(fr.q);
        m.position.copy(fr.p);
        hand.add(m);
      }
      if (m) m.visible = want === kind;
    }
    // Con las manos ocupadas (recibir, beber, saludar...) el arma no se ve.
    const busy = this.layers.some((L) => L.slot === 'gesture' && !L.fidget && L.w > 0.35 && !L.c.end);
    this.weaponMount.visible = !busy || this.aimBlend > 0.3;
  }

  /** Acción del mezclador para un clip de la base (creada al primer uso). */
  _action(name) {
    let a = this.actions[name];
    if (a === undefined) {
      const c = tplClip(this.tpl, name);
      a = this.actions[name] = c ? this.mixer.clipAction(c.clip) : null;
      if (a) {
        a.play();
        a.setEffectiveWeight(0);
        a.setEffectiveTimeScale(0); // el tiempo lo lleva este rig
      }
    }
    return a;
  }

  // ------------------------------------------------------------ animación
  /**
   * st = {speed, onGround, aiming, crouching, driving ('car'|'moto'|'chair'|null),
   *       dead, aimPitch, style, upper, fidget, handsFree, mountLift,
   *       idle, seat, lookAt: {x, y, z} | null}
   */
  animate(dt, st) {
    this.frame++;
    const realSpeed = st.speed ?? 0;
    const driving = st.driving ?? null;
    const dead = !!st.dead;
    const crouch = !!st.crouching && !driving;
    const air = !st.onGround && !driving && !dead;
    const moving = realSpeed > 0.3;

    // Velocidad de giro (rad/s, + = a la izquierda) medida en la raíz.
    const yaw = this.root.rotation.y;
    const turn = this.yawPrev == null || dt <= 0 ? 0 : angleDiff(this.yawPrev, yaw) / dt;
    this.yawPrev = yaw;
    this.yawRate = damp(this.yawRate, clamp(turn, -8, 8), 12, dt);
    // Girar en el sitio: los pies dan pasos cortos en vez de patinar (un poco
    // del ciclo de caminar, proporcional a lo rápido que gira).
    const onFoot = !driving && !air && !dead && !crouch && !st.aiming;
    const turnStep = onFoot && realSpeed < 0.6 ? clamp((Math.abs(this.yawRate) - 0.7) * 0.4, 0, 0.75) : 0;
    const speed = Math.max(realSpeed, turnStep);
    // Inclinación hacia adentro de la curva (más al correr).
    const bankT = onFoot && realSpeed > 1 ? clamp(this.yawRate * realSpeed * 0.018, -0.16, 0.16) : 0;
    this.bank = damp(this.bank, bankT, 6, dt);

    this.aimBlend = damp(this.aimBlend, st.aiming ? 1 : 0, 14, dt);
    this.deadBlend = damp(this.deadBlend, dead ? 1 : 0, 6, dt);
    this.driveBlend = damp(this.driveBlend, driving ? 1 : 0, 10, dt);
    this.lean = damp(this.lean, speed > 5.5 ? 0.12 : 0, 5, dt);
    if (this.punchTimer > 0) this.punchTimer -= dt;
    this._updateLayers(dt, st, moving, dead || air || !!st.aiming || crouch, dead);

    // Ranuras de la base: qué clip hace de reposo, caminar, trotar...
    const style = st.style ?? null;
    const S = this.slots;
    const pick = (name, fallback) => (this.hasClip(name) ? name : fallback);
    S.idle = style === 'drunk' ? pick('idle_drunk', 'idle') : st.idle ? pick(st.idle, 'idle') : 'idle';
    S.walk = style ? pick(STYLE_WALK[style], 'walk') : 'walk';
    S.jog = style === 'injured' ? pick('run_injured', 'jog') : 'jog';
    S.sit = driving === 'chair' ? pick(st.seat === 'table' ? 'sit_table' : 'sit_idle', 'sit') : 'sit';

    // Pesos objetivo de cada ranura.
    const tw = this._tw;
    for (const k in tw) tw[k] = 0;
    const add = (slot, x) => {
      if (x > 0) tw[S[slot]] = (tw[S[slot]] ?? 0) + x;
    };
    if (driving) add('sit', 1);
    else if (air) {
      // Solo airW (cuadro congelado del sprint, abajo).
    } else if (crouch) add('crouch', 1);
    else if (speed < 0.12) add('idle', 1);
    else if (speed < LOCO[0][1]) {
      const k = (speed - 0.12) / (LOCO[0][1] - 0.12);
      const idle = 1 - Math.min(1, k * 2.5);
      add('idle', idle);
      add('walk', 1 - idle);
    } else {
      let i = 0;
      while (i < LOCO.length - 1 && speed > LOCO[i + 1][1]) i++;
      if (i >= LOCO.length - 1) add('sprint', 1);
      else {
        const k = (speed - LOCO[i][1]) / (LOCO[i + 1][1] - LOCO[i][1]);
        add(LOCO[i][0], 1 - k);
        add(LOCO[i + 1][0], k);
      }
    }
    const rate = driving || dead ? 8 : 10;
    for (const k in tw) if (!(k in this.w)) this.w[k] = 0;
    for (const k in this.w) {
      this.w[k] = damp(this.w[k], tw[k] ?? 0, rate, dt);
      if (this.w[k] < 1e-4 && !tw[k]) this.w[k] = 0;
    }
    this.airW = damp(this.airW, air ? 1 : 0, rate, dt);

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
    for (const [slot] of LOCO) {
      const c = tplClip(this.tpl, S[slot]);
      const w = this.w[S[slot]] ?? 0;
      if (!c || w < 1e-3 || (slot === 'sprint' && air)) continue;
      const ts = clamp(speed / c.speed, 0.55, 1.6);
      cyc += (w * ts) / c.duration;
      wsum += w;
    }
    if (wsum > 0) this.phase = (this.phase + (step * cyc) / wsum) % 1;
    this.clock += step;
    this.tCrouch += step * (crouch && speed > 0.3 ? 1.6 : 1);

    // El mezclador de three.js solo escribe un hueso si su valor cambió desde
    // la actualización anterior. Con una pose quieta (sentado en la moto o el
    // carro, con la cadera en el cuadro 0 de "sit") deja de escribirlos, y las
    // rotaciones que ponen encima las capas (gestos, inclinar el torso, abrir
    // las piernas) se acumulaban cuadro a cuadro: tras unos segundos el
    // motociclista quedaba acostado hacia atrás o retorcido. Por eso se
    // devuelve cada hueso a la pose animada antes de mezclar.
    const pb = this.poseBones;
    for (let i = 0; i < pb.length; i++) pb[i].quaternion.copy(this.animPose[i]);
    if (this.hipBone) this.hipBone.position.copy(this.animHip);

    for (const name in this.w) {
      const w = this.w[name] + (name === S.sprint ? this.airW : 0);
      if (w < 1e-3) {
        this.actions[name]?.setEffectiveWeight(0);
        continue;
      }
      const a = this._action(name);
      if (!a) continue;
      a.setEffectiveWeight(w);
      const c = tplClip(this.tpl, name);
      const d = c.duration;
      // En el aire: cuadro de zancada del sprint (piernas abiertas), congelado.
      if (name === S.sprint && this.airW > 0.05) a.time = 0.25 * d;
      else if (c.kind === 'locomotion') a.time = this.phase * d;
      else if (c.kind === 'pose') a.time = 0;
      else a.time = (name === 'crouch' ? this.tCrouch : this.clock) % d;
    }
    // Agachado caminando: un poco del ciclo de caminar sobre el agachado.
    const walkA = crouch && speed > 0.3 ? this._action(S.walk) : null;
    if (crouch && speed > 0.3 && walkA) {
      walkA.setEffectiveWeight(0.35);
      walkA.time = this.phase * walkA.getClip().duration;
      this.phase = (this.phase + (step * speed) / 1.2) % 1;
    }
    this.mixer.update(0);
    for (let i = 0; i < pb.length; i++) this.animPose[i].copy(pb[i].quaternion);
    if (this.hipBone) this.animHip.copy(this.hipBone.position);

    // Capas: brazos continuos y gestos; utilería en la mano.
    if (this.layers.length) this._applyLayers(moving, !!driving);
    this._updateProps();

    // Sentado: cadera sobre el asiento. world.js/Game ponen la raíz en
    // asiento - 0.5 (+0.35 en moto); en carro se sube un poco para que se
    // vean hombros y brazos por la ventana.
    const db = this.driveBlend;
    // Sentado: en moto, en carro o en una silla plástica frente a la tienda.
    const seatHip = driving === 'moto' ? 0.55 : driving === 'chair' ? 0.47 : 0.64;
    this.model.position.set(0, (seatHip - this.sitHip) * db, 0);

    // Inclinación al correr / muerte (cae de espaldas).
    const d = this.deadBlend;
    this.body.rotation.x = d > 0.001 ? d * (Math.PI / 2) * 0.97 : -this.lean * (1 - this.aimBlend) + (st.bodyPitch ?? 0);
    this.body.rotation.z = d > 0.001 ? 0 : this.bank;
    this.body.position.y = d > 0.001 ? d * 0.13 : 0;
    if (st.bodyShift) this.body.position.z = st.bodyShift;
    else if (this.body.position.z) this.body.position.z = 0;

    // ---------------------------------------------- capas por código
    const a = this.aimBlend;
    const wheel = db > 0.01 && driving !== 'chair' && !st.handsFree;
    const needArms = a > 0.01 || this.punchTimer > 0 || wheel || (db > 0.01 && driving === 'moto') || d > 0.01;
    // Moto: puntos del modelo (asiento, puños, estriberas) y velocidad (vehicleMesh).
    const ride = driving === 'moto' ? this.root.parent?.userData.ride : null;
    this.footDown = damp(this.footDown, ride && Math.abs(ride.speed) < 0.8 ? 1 : 0, 5, step);
    if (needArms) {
      this.root.updateMatrixWorld(true);
      if (ride && db > 0.01) this._rideMoto(ride, db, a, st.mountLift ?? 0);
      else if (wheel) this._driveArms(driving === 'moto', db * (1 - a));
      if (a > 0.01 && d < 0.5) this._aimArms(st.aimPitch ?? 0, a);
      if (this.punchTimer > 0) this._punchArm();
      if (d > 0.01) this._limp(d);
    }
    // Mirar a alguien (cabeza y cuello), encima de todo lo anterior.
    this._look(st.lookAt ?? null, step, dead || a > 0.3 || db > 0.5);
    // Pose por código de la actividad en curso (colgar ropa, patear, barrer...).
    if (this.post) {
      this.root.updateMatrixWorld(true);
      this.post(this, step);
    }
  }

  /**
   * La cabeza (60 %) y el cuello (40 %) giran hacia `target` (mundo), con
   * límites de un cuello real y suavizado; sin objetivo vuelven al frente.
   */
  _look(target, dt, blocked) {
    const B = this.bones;
    const head = B.Bip01_Head;
    const neck = B.Bip01_Neck;
    if (!head || !neck) return;
    let wantW = 0;
    let wy = this.lookYaw;
    let wp = this.lookPitch;
    if (target && !blocked) {
      this.root.updateMatrixWorld(true);
      head.getWorldPosition(_v);
      const dx = target.x - _v.x;
      const dy = target.y - _v.y;
      const dz = target.z - _v.z;
      const h = Math.hypot(dx, dz);
      // Ángulo respecto al frente del cuerpo (la raíz mira a -Z).
      const face = Math.atan2(-dx, -dz);
      const rel = angleDiff(this.root.rotation.y, face);
      if (Math.abs(rel) < 1.9 && h > 0.2) {
        wantW = 1;
        wy = clamp(rel, -1.15, 1.15);
        wp = clamp(Math.atan2(dy, h), -0.45, 0.35);
      }
    }
    this.lookW = damp(this.lookW, wantW, 4, dt);
    this.lookYaw = damp(this.lookYaw, wy, 5, dt);
    this.lookPitch = damp(this.lookPitch, wp, 5, dt);
    if (this.lookW < 0.01) return;
    const w = smoothstep(Math.min(1, this.lookW));
    const right = _v2.set(1, 0, 0).applyQuaternion(this.root.getWorldQuaternion(_qt));
    for (const [bone, k] of [
      [neck, 0.4],
      [head, 0.6],
    ]) {
      _q.setFromAxisAngle(Y_AXIS, this.lookYaw * k * w);
      _q2.setFromAxisAngle(right, this.lookPitch * k * w);
      _q.multiply(_q2);
      bone.getWorldQuaternion(_q2);
      setWorldQuat(bone, _q.multiply(_q2), 1);
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
    const twoHanded = this.weaponId && !['pistol', 'machete', 'fists'].includes(this.weaponId);
    // Torso y cabeza acompañan la mira arriba/abajo. Con arma larga el torso
    // además gira a la derecha (hombro izquierdo adelante) para que la mano
    // izquierda alcance el guardamanos; la cabeza compensa el giro.
    const twist = twoHanded ? (this.weaponId === 'smg' ? 0.3 : 0.45) * w : 0;
    if (B.Bip01_Spine1) {
      _q.setFromAxisAngle(right, pitch * 0.35 * w);
      if (twist) _q.premultiply(_qt.setFromAxisAngle(Y_AXIS, -twist));
      B.Bip01_Spine1.getWorldQuaternion(_q2);
      setWorldQuat(B.Bip01_Spine1, _q.multiply(_q2), 1);
      if (twist && B.Bip01_Head) {
        B.Bip01_Head.getWorldQuaternion(_q2);
        setWorldQuat(B.Bip01_Head, _qt.setFromAxisAngle(Y_AXIS, twist * 0.7).multiply(_q2), 1);
      }
    }
    const shR = B.Bip01_R_UpperArm.getWorldPosition(new THREE.Vector3());
    const shL = B.Bip01_L_UpperArm.getWorldPosition(new THREE.Vector3());
    const mid = shR.clone().add(shL).multiplyScalar(0.5);
    let gripR;
    let gripL;
    if (twoHanded) {
      // Culata al hombro derecho, mano izquierda en el guardamanos.
      gripR = shR.clone().addScaledVector(fwd, this.weaponId === 'smg' ? 0.26 : 0.21).addScaledVector(up, -0.01).addScaledVector(right, 0.01);
      const lh = this.weaponMesh?.userData.leftHand;
      if (lh && this.tpl.grip) {
        // Mano izquierda donde la pide el modelo ("mano_izq"): origen del arma
        // (palma derecha) + el punto en el marco del arma; la muñeca queda un
        // poco por debajo y a la izquierda de la palma.
        const wq = weaponQuat(fwd, up, new THREE.Quaternion());
        const hq = wq.clone().multiply(this.tpl.grip.q.clone().invert());
        gripL = gripR.clone().add(_v.copy(this.tpl.grip.p).applyQuaternion(hq)).add(_v.copy(lh).applyQuaternion(wq));
        gripL.addScaledVector(up, -0.03).addScaledVector(right, -0.03);
      } else {
        gripL = gripR.clone().addScaledVector(fwd, this.weaponId === 'smg' ? 0.2 : 0.32).addScaledVector(up, 0.02).addScaledVector(right, -0.02);
      }
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

  /**
   * Postura de moto de calle (Pulsar 135): sentado sobre el asiento, torso
   * algo inclinado hacia adelante, manos en los puños, rodillas contra el
   * tanque y pies en las estriberas; detenido, el pie izquierdo al piso.
   * `ride` (espacio del vehículo, frente en -Z): seatY, seatZ, grips[izq, der],
   * pegs[izq, der], speed. `w`: peso de la postura; `aim`: el brazo derecho
   * lo lleva la mira (disparo desde la moto); `lift` (0..1): al montarse o
   * bajarse, la pierna derecha pasa por encima del asiento.
   */
  _rideMoto(ride, w, aim, lift = 0) {
    const B = this.bones;
    if (!B.Bip01_Pelvis || !B.Bip01_L_Thigh) return;
    const veh = this.root.parent;
    const toW = (p, out = new THREE.Vector3()) => veh.localToWorld(out.set(p.x, p.y, p.z));
    const { flat: fwd, right, q } = this._frame();
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(q);

    // 1. Cadera sobre el asiento (la articulación queda ~9 cm sobre el cojín).
    const pel = veh.worldToLocal(B.Bip01_Pelvis.getWorldPosition(new THREE.Vector3()));
    const tgt = new THREE.Vector3(0, ride.seatY + 0.09 * (this.scale / 0.97), ride.seatZ - 0.02);
    this.model.position.add(tgt.sub(pel).multiplyScalar(w));
    this.model.updateMatrixWorld(true);

    // 2. Torso inclinado hacia el manubrio (~20° de la cadera al cuello); la cabeza mira al frente.
    const spine = B.Bip01_Spine ?? B.Bip01_Spine1;
    const neck = B.Bip01_Neck ?? B.Bip01_Head;
    if (spine && neck) {
      const s0 = spine.getWorldPosition(new THREE.Vector3());
      const cur = neck.getWorldPosition(new THREE.Vector3()).sub(s0).normalize();
      const want = up.clone().multiplyScalar(Math.cos(0.5)).addScaledVector(fwd, Math.sin(0.5));
      spine.getWorldQuaternion(_q2);
      setWorldQuat(spine, _q.setFromUnitVectors(cur, want).multiply(_q2), w);
      if (B.Bip01_Head) {
        B.Bip01_Head.getWorldQuaternion(_q2);
        setWorldQuat(B.Bip01_Head, _q.setFromAxisAngle(right, 0.3 * w).multiply(_q2), 1);
      }
    }

    // 3. Manos en los puños: la muñeca un poco detrás y encima del centro del puño.
    for (const [side, s, wt] of [
      ['L', -1, w],
      ['R', 1, w * (1 - aim)],
    ]) {
      if (wt < 0.01) continue;
      const g = ride.grips[s < 0 ? 0 : 1];
      const wrist = toW(g).addScaledVector(fwd, -0.06).addScaledVector(up, 0.03).addScaledVector(right, -s * 0.01);
      const pole = right.clone().multiplyScalar(s * 0.8).addScaledVector(up, -0.5).addScaledVector(fwd, -0.4);
      ik2(B[`Bip01_${side}_UpperArm`], B[`Bip01_${side}_Forearm`], B[`Bip01_${side}_Hand`], wrist, pole, wt);
      // Dedos hacia adelante y abajo, envolviendo el puño.
      pointBone(B[`Bip01_${side}_Hand`], fwd.clone().addScaledVector(up, -0.55).addScaledVector(right, s * 0.15).normalize(), wt);
    }

    // 4. Piernas: pies en las estriberas, rodillas contra el tanque. Detenido,
    // el pie izquierdo baja al piso junto a la moto.
    for (const [side, s] of [
      ['L', -1],
      ['R', 1],
    ]) {
      const thigh = B[`Bip01_${side}_Thigh`];
      const calf = B[`Bip01_${side}_Calf`];
      const foot = B[`Bip01_${side}_Foot`];
      if (!thigh || !calf || !foot) continue;
      const peg = ride.pegs[s < 0 ? 0 : 1];
      // Tobillo sobre la estribera (el metatarso apoya en ella).
      const ankle = toW(peg).addScaledVector(up, 0.07).addScaledVector(fwd, -0.06);
      let pole = fwd.clone().addScaledVector(right, -s * 0.12).addScaledVector(up, 0.2);
      const down = s < 0 ? Math.max(this.footDown, lift > 0 ? 1 : 0) : 0;
      if (down > 0.01) {
        const ground = toW({ x: peg.x - 0.2, y: 0.08, z: peg.z - 0.12 });
        ankle.lerp(ground, down);
        pole = pole.lerp(right.clone().multiplyScalar(s * 0.6).add(fwd), down);
      }
      if (s > 0 && lift > 0.01) {
        // Pierna derecha por encima de la parte de atrás del asiento.
        const over = toW({ x: 0.1, y: ride.seatY + 0.45, z: ride.seatZ + 0.35 });
        ankle.lerp(over, Math.sin(Math.min(1, lift) * Math.PI));
      }
      ik2(thigh, calf, foot, ankle, pole, w);
      pointBone(foot, fwd.clone().addScaledVector(up, down > 0.5 ? -0.15 : -0.35).normalize(), w);
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
    // Cada esqueleto clonado tiene su textura de huesos en la GPU: sin esto
    // cada peatón que entra y sale del barrio dejaba una textura viva.
    const skeletons = new Set();
    this.model.traverse((o) => o.isSkinnedMesh && o.skeleton && skeletons.add(o.skeleton));
    for (const s of skeletons) s.dispose();
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
    if (tpl && tplClip(tpl, 'idle') && tplClip(tpl, 'walk')) return new SkinnedRig(look, tpl);
    return new ProceduralRig(look);
  }
}
