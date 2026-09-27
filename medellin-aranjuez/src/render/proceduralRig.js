// Personaje humanoide procedural (muñeco de cápsulas) con esqueleto
// jerárquico y animación por código: reposo, caminar, correr, apuntar, golpe,
// conducir moto/carro, agachado, salto y muerte. Es el respaldo cuando no
// están los modelos Rocketbox (ver characterRig.js).

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { damp, lerp } from '../sim/math.js';
import { weaponModel } from './weaponModels.js';

const geoCache = new Map();
const matCache = new Map();

function geo(key, make) {
  if (!geoCache.has(key)) geoCache.set(key, make());
  return geoCache.get(key);
}

function mat(color, rough = 0.8, extra = {}) {
  const k = `${color}-${rough}-${JSON.stringify(extra)}`;
  if (!matCache.has(k)) matCache.set(k, new THREE.MeshStandardMaterial({ color, roughness: rough, ...extra }));
  return matCache.get(k);
}

const limb = (r, len) => geo(`limb${r}-${len}`, () => {
  const g = new THREE.CapsuleGeometry(r, len, 4, 10);
  g.translate(0, -len / 2, 0);
  return g;
});

const SKIN = [0xf1c7a5, 0xd9a47c, 0xb97d56, 0x8d5a3b, 0x6b4029, 0xe8b894];
const HAIR = [0x1b120c, 0x2e1f14, 0x4a3020, 0x0d0d0d, 0x6b4a2c];
const SHIRTS = [0xffffff, 0xd62828, 0x1d3557, 0xf1c40f, 0x2a9d8f, 0x6c757d, 0xe76f51, 0x264653, 0x8338ec, 0x06d6a0, 0xf4a261, 0x111111];
const PANTS = [0x2b3a55, 0x1f2a44, 0x3b3b3b, 0x5c4a3a, 0xc2b280, 0x111111];

export function randomLook(rng, outfit = 'civil') {
  const look = {
    skin: rng.pick(SKIN),
    hair: rng.pick(HAIR),
    shirt: rng.pick(SHIRTS),
    pants: rng.pick(PANTS),
    shoes: rng.pick([0x111111, 0xffffff, 0x5a3b22, 0x333333]),
    female: rng.chance(0.45),
    height: rng.range(0.92, 1.06),
    build: rng.range(0.9, 1.15),
    cap: rng.chance(0.25),
    capColor: rng.pick(SHIRTS),
    outfit,
  };
  if (outfit === 'police') {
    Object.assign(look, { shirt: 0x3d4a2a, pants: 0x3d4a2a, shoes: 0x111111, cap: true, capColor: 0x2f3a20, vest: 0xc8f000, female: rng.chance(0.25) });
  } else if (outfit === 'gang') {
    Object.assign(look, { shirt: rng.pick([0x111111, 0x7a0e0e, 0x1d3557, 0xffffff]), pants: rng.pick([0x1f2a44, 0x111111]), cap: rng.chance(0.7), capColor: rng.pick([0x111111, 0xd62828, 0xffffff]), female: false });
  }
  return look;
}

export const PLAYER_LOOK = { skin: 0xd9a47c, hair: 0x1b120c, shirt: 0xf5f5f5, pants: 0x2b3a55, shoes: 0xffffff, female: false, height: 1.0, build: 1.05, cap: true, capColor: 0x0b5d3b, outfit: 'player', chain: true };

export class ProceduralRig {
  constructor(look) {
    this.look = look;
    this.root = new THREE.Group();
    this.body = new THREE.Group(); // se inclina / cae
    this.root.add(this.body);
    const s = look.height;
    const b = look.build;
    const skin = mat(look.skin, 0.6);
    const shirt = mat(look.shirt, 0.85);
    const pants = mat(look.pants, 0.9);
    const shoes = mat(look.shoes, 0.5);
    const hair = mat(look.hair, 0.7);

    // Cadera
    this.hips = new THREE.Group();
    this.hips.position.y = 0.95 * s;
    this.body.add(this.hips);
    const pelvis = new THREE.Mesh(geo(`pelvis${b}`, () => new RoundedBoxGeometry(0.34 * b, 0.2, 0.2, 2, 0.06)), pants);
    pelvis.position.y = 0.02;
    this.hips.add(pelvis);

    // Torso (pecho) — pivote en la cintura para inclinarse.
    this.spine = new THREE.Group();
    this.spine.position.y = 0.08;
    this.hips.add(this.spine);
    const chestW = (look.female ? 0.34 : 0.4) * b;
    const torso = new THREE.Mesh(geo(`torso${chestW}`, () => new RoundedBoxGeometry(chestW, 0.52, 0.22, 3, 0.08)), shirt);
    torso.position.y = 0.26;
    this.spine.add(torso);
    if (look.vest) {
      const vest = new THREE.Mesh(geo(`vest${chestW}`, () => new RoundedBoxGeometry(chestW + 0.04, 0.4, 0.26, 2, 0.06)), mat(look.vest, 0.5, { emissive: 0x2a3300 }));
      vest.position.y = 0.3;
      this.spine.add(vest);
    }
    if (look.chain) {
      const chain = new THREE.Mesh(geo('chain', () => new THREE.TorusGeometry(0.09, 0.008, 6, 20)), mat(0xd4af37, 0.25, { metalness: 1 }));
      chain.position.set(0, 0.44, -0.1);
      chain.rotation.x = 1.2;
      this.spine.add(chain);
    }

    // Cabeza
    this.neck = new THREE.Group();
    this.neck.position.y = 0.54;
    this.spine.add(this.neck);
    const neckMesh = new THREE.Mesh(limb(0.05, 0.06), skin);
    neckMesh.position.y = 0.08;
    this.neck.add(neckMesh);
    const head = new THREE.Mesh(geo('head', () => {
      const g = new THREE.SphereGeometry(0.11, 18, 14);
      g.scale(0.92, 1.12, 1);
      return g;
    }), skin);
    head.position.y = 0.19;
    this.neck.add(head);
    const nose = new THREE.Mesh(geo('nose', () => new THREE.ConeGeometry(0.018, 0.05, 6).rotateX(-Math.PI / 2)), skin);
    nose.position.set(0, 0.18, -0.11);
    this.neck.add(nose);
    for (const x of [-0.04, 0.04]) {
      const eye = new THREE.Mesh(geo('eye', () => new THREE.SphereGeometry(0.013, 8, 6)), mat(0x1a1a1a, 0.2));
      eye.position.set(x, 0.215, -0.095);
      this.neck.add(eye);
    }
    const hairMesh = new THREE.Mesh(
      geo(`hair${look.female}`, () => {
        const g = new THREE.SphereGeometry(0.118, 16, 10, 0, Math.PI * 2, 0, look.female ? Math.PI * 0.62 : Math.PI * 0.45);
        g.scale(0.95, 1.1, 1.05);
        return g;
      }),
      hair,
    );
    hairMesh.position.set(0, 0.2, 0.008);
    this.neck.add(hairMesh);
    if (look.female) {
      const pony = new THREE.Mesh(limb(0.04, 0.16), hair);
      pony.position.set(0, 0.25, 0.1);
      pony.rotation.x = -0.4;
      this.neck.add(pony);
    }
    if (look.cap) {
      const capMat = mat(look.capColor, 0.7);
      const cap = new THREE.Mesh(geo('cap', () => new THREE.SphereGeometry(0.122, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2)), capMat);
      cap.position.y = 0.23;
      const visor = new THREE.Mesh(geo('visor', () => new THREE.BoxGeometry(0.2, 0.015, 0.12)), capMat);
      visor.position.set(0, 0.235, -0.15);
      this.neck.add(cap, visor);
    }

    // Brazos
    const armR = 0.05 * b;
    this.shoulderL = this._arm(-1, chestW, armR, shirt, skin);
    this.shoulderR = this._arm(1, chestW, armR, shirt, skin);

    // Piernas
    this.thighL = this._leg(-1, b, pants, shoes);
    this.thighR = this._leg(1, b, pants, shoes);

    this.body.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = false;
      }
    });

    this.weaponMount = new THREE.Group();
    this.shoulderR.userData.hand.add(this.weaponMount);
    this.weaponMesh = null;
    this.weaponId = null;
    this.phase = Math.random() * 10;
    this.aimBlend = 0;
    this.pose = 'idle';
    this.punchTimer = 0;
    this.deadBlend = 0;
    this.driveBlend = 0;
    this.lean = 0;
  }

  _arm(side, chestW, r, shirt, skin) {
    const sh = new THREE.Group();
    sh.position.set(side * (chestW / 2 + 0.03), 0.47, 0);
    this.spine.add(sh);
    const upper = new THREE.Mesh(limb(r, 0.22), shirt);
    sh.add(upper);
    const elbow = new THREE.Group();
    elbow.position.y = -0.28;
    sh.add(elbow);
    const fore = new THREE.Mesh(limb(r * 0.85, 0.2), skin);
    elbow.add(fore);
    const hand = new THREE.Group();
    hand.position.y = -0.27;
    elbow.add(hand);
    const palm = new THREE.Mesh(geo('palm', () => new RoundedBoxGeometry(0.07, 0.09, 0.04, 2, 0.015)), skin);
    palm.position.y = -0.02;
    hand.add(palm);
    sh.userData = { elbow, hand };
    return sh;
  }

  _leg(side, b, pants, shoes) {
    const th = new THREE.Group();
    th.position.set(side * 0.1 * b, -0.02, 0);
    this.hips.add(th);
    const thigh = new THREE.Mesh(limb(0.075 * b, 0.34), pants);
    th.add(thigh);
    const knee = new THREE.Group();
    knee.position.y = -0.44;
    th.add(knee);
    const shin = new THREE.Mesh(limb(0.06 * b, 0.34), pants);
    knee.add(shin);
    const shoe = new THREE.Mesh(geo('shoe', () => new RoundedBoxGeometry(0.1, 0.08, 0.24, 2, 0.03)), shoes);
    shoe.position.set(0, -0.46, -0.04);
    knee.add(shoe);
    th.userData = { knee };
    return th;
  }

  /** Cambia el arma visible en la mano. */
  setWeapon(id) {
    if (id === this.weaponId) return;
    this.weaponId = id;
    if (this.weaponMesh) this.weaponMount.remove(this.weaponMesh);
    this.weaponMesh = null;
    const model = weaponModel(id);
    if (model) {
      // El modelo trae el cañón en -Z; en este muñeco la mano apunta hacia -Y.
      const g = new THREE.Group();
      g.add(model);
      g.rotation.x = -Math.PI / 2;
      g.position.y = -0.05;
      g.userData.muzzle = model.userData.muzzle;
      this.weaponMesh = g;
      this.weaponMount.add(g);
    }
    this._shadowMeshes = null; // la lista de mallas con sombra cambió
  }

  /** Posición del cañón en coordenadas del mundo. */
  muzzleWorld(out) {
    if (this.weaponMesh?.userData.muzzle) return this.weaponMesh.userData.muzzle.getWorldPosition(out);
    return this.shoulderR.userData.hand.getWorldPosition(out);
  }

  punch() {
    this.punchTimer = 0.35;
  }

  // Sin clips de captura: los gestos (characterRig.SkinnedRig.play) no hacen nada.
  play() {
    return null;
  }

  stopGesture() {}

  hasClip() {
    return false;
  }

  clipInfo() {
    return null;
  }

  get gesture() {
    return null;
  }

  /**
   * Anima el personaje. state = {speed, onGround, aiming, crouching,
   * driving ('car'|'moto'|null), dead, aimPitch}
   */
  animate(dt, st) {
    const speed = st.speed ?? 0;
    const running = speed > 3.2;
    this.phase += dt * (running ? speed * 1.55 : speed * 2.6 + 0.001);
    const p = this.phase;
    const k = Math.min(1, speed / 2);
    const amp = running ? 0.95 : 0.55;

    this.aimBlend = damp(this.aimBlend, st.aiming ? 1 : 0, 14, dt);
    this.deadBlend = damp(this.deadBlend, st.dead ? 1 : 0, 6, dt);
    this.driveBlend = damp(this.driveBlend, st.driving ? 1 : 0, 10, dt);
    this.lean = damp(this.lean, running ? 0.25 : speed > 0.2 ? 0.06 : 0, 6, dt);

    // Piernas
    let tl = Math.sin(p) * amp * k;
    let tr = Math.sin(p + Math.PI) * amp * k;
    let kl = Math.max(0, -Math.sin(p - 0.6)) * (running ? 1.5 : 0.8) * k;
    let kr = Math.max(0, -Math.sin(p + Math.PI - 0.6)) * (running ? 1.5 : 0.8) * k;
    let hipY = Math.abs(Math.cos(p)) * 0.04 * k;
    if (!st.onGround && !st.driving) {
      tl = 0.6;
      tr = -0.2;
      kl = 1.1;
      kr = 0.4;
      hipY = 0;
    }
    if (st.crouching) {
      tl += 0.9;
      tr += 0.9;
      kl += 1.5;
      kr += 1.5;
      hipY -= 0.3;
    }
    // Sentado conduciendo.
    const db = this.driveBlend;
    const moto = st.driving === 'moto';
    tl = lerp(tl, moto ? 1.1 : 1.45, db);
    tr = lerp(tr, moto ? 1.1 : 1.45, db);
    kl = lerp(kl, moto ? 1.3 : 1.45, db);
    kr = lerp(kr, moto ? 1.3 : 1.45, db);
    this.thighL.rotation.set(tl, 0, moto ? -0.25 * db : 0);
    this.thighR.rotation.set(tr, 0, moto ? 0.25 * db : 0);
    this.thighL.userData.knee.rotation.x = -kl;
    this.thighR.userData.knee.rotation.x = -kr;
    this.hips.position.y = 0.95 * this.look.height + hipY - db * 0.42;

    // Torso
    const breathe = Math.sin(performance.now() * 0.002) * 0.01;
    this.spine.rotation.x = -this.lean * (1 - this.aimBlend) + breathe - (moto ? 0.3 * db : 0);
    this.spine.rotation.y = Math.sin(p) * 0.08 * k * (1 - this.aimBlend);
    this.neck.rotation.x = (st.aimPitch ?? 0) * 0.5 * this.aimBlend;

    // Brazos
    let al = Math.sin(p + Math.PI) * amp * 0.8 * k;
    let ar = Math.sin(p) * amp * 0.8 * k;
    let el = 0.3 + (running ? 1.1 : 0.3) * k;
    let er = el;
    // Apuntar: brazo derecho al frente, izquierdo de apoyo.
    const a = this.aimBlend;
    const pitch = st.aimPitch ?? 0;
    const twoHanded = this.weaponId && this.weaponId !== 'pistol' && this.weaponId !== 'machete';
    ar = lerp(ar, Math.PI / 2 + pitch, a);
    er = lerp(er, 0.05, a);
    al = lerp(al, twoHanded ? Math.PI / 2 + pitch - 0.1 : al, a);
    el = lerp(el, twoHanded ? 0.5 : el, a);
    // Golpe / machetazo.
    if (this.punchTimer > 0) {
      this.punchTimer -= dt;
      const t = 1 - this.punchTimer / 0.35;
      const hit = Math.sin(t * Math.PI);
      ar = lerp(ar, this.weaponId === 'machete' ? 2.6 - t * 2.4 : 1.6, hit);
      er = lerp(er, 0.1, hit);
    }
    // Conduciendo: manos al volante/manubrio.
    al = lerp(al, moto ? 1.1 : 1.2, db * (1 - a));
    ar = lerp(ar, moto ? 1.1 : 1.2, db * (1 - a));
    el = lerp(el, 0.5, db * (1 - a));
    er = lerp(er, 0.5, db * (1 - a));
    this.shoulderL.rotation.set(al, 0, lerp(0.08, twoHanded ? -0.35 : 0.08, a) * (1 - db) + (moto ? 0.3 * db : 0));
    this.shoulderR.rotation.set(ar, 0, lerp(-0.08, 0.05, a) * (1 - db) - (moto ? 0.3 * db : 0));
    this.shoulderL.userData.elbow.rotation.x = el;
    this.shoulderR.userData.elbow.rotation.x = er;

    // Muerte: cae de espaldas.
    const d = this.deadBlend;
    this.body.rotation.x = d * (Math.PI / 2);
    this.body.position.y = d * 0.12;
    this.body.position.z = 0;
  }

  setShadow(on) {
    for (const o of (this._shadowMeshes ??= collectMeshes(this.root))) o.castShadow = on;
  }

  dispose() {
    this.root.removeFromParent();
  }
}

/**
 * Armas procedurales de respaldo (si faltan los GLB de weaponModels.js); el
 * cañón apunta hacia -Y local (dirección de la mano).
 */
export function buildWeaponMesh(id) {
  const g = new THREE.Group();
  const metal = mat(0x1d1f22, 0.35, { metalness: 0.8 });
  const wood = mat(0x6b4226, 0.6);
  const add = (geom, m, x, y, z) => {
    const mesh = new THREE.Mesh(geom, m);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    g.add(mesh);
    return mesh;
  };
  let length = 0.2;
  switch (id) {
    case 'machete': {
      add(new THREE.BoxGeometry(0.03, 0.12, 0.035), wood, 0, 0, 0);
      const blade = add(new THREE.BoxGeometry(0.008, 0.5, 0.06), mat(0xc9ccd1, 0.2, { metalness: 1 }), 0, 0, -0.32);
      blade.rotation.x = Math.PI / 2;
      length = 0.55;
      break;
    }
    case 'pistol':
      add(new THREE.BoxGeometry(0.035, 0.1, 0.035), metal, 0, 0, 0.0);
      add(new THREE.BoxGeometry(0.04, 0.04, 0.2), metal, 0, 0.05, -0.07);
      length = 0.17;
      break;
    case 'smg':
      add(new THREE.BoxGeometry(0.04, 0.11, 0.035), metal, 0, 0, 0);
      add(new THREE.BoxGeometry(0.05, 0.07, 0.34), metal, 0, 0.05, -0.1);
      add(new THREE.BoxGeometry(0.03, 0.16, 0.035), metal, 0, -0.06, -0.08);
      length = 0.27;
      break;
    case 'shotgun':
      add(new THREE.BoxGeometry(0.05, 0.08, 0.3), wood, 0, 0.02, 0.17);
      add(new THREE.CylinderGeometry(0.018, 0.018, 0.62).rotateX(Math.PI / 2), metal, 0, 0.05, -0.28);
      add(new THREE.BoxGeometry(0.05, 0.05, 0.18), wood, 0, 0.0, -0.22);
      length = 0.6;
      break;
    case 'rifle':
      add(new THREE.BoxGeometry(0.05, 0.09, 0.26), wood, 0, 0.02, 0.18);
      add(new THREE.BoxGeometry(0.05, 0.08, 0.36), metal, 0, 0.05, -0.1);
      add(new THREE.CylinderGeometry(0.014, 0.014, 0.3).rotateX(Math.PI / 2), metal, 0, 0.06, -0.42);
      add(new THREE.BoxGeometry(0.035, 0.2, 0.06), metal, 0, -0.07, -0.08).rotation.x = -0.35;
      length = 0.58;
      break;
    default:
      break;
  }
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.05, -length);
  g.add(muzzle);
  g.userData.muzzle = muzzle;
  // Orientar: cañón (-Z del modelo) a lo largo de -Y de la mano.
  g.rotation.x = -Math.PI / 2;
  g.position.y = -0.05;
  return g;
}

function collectMeshes(root) {
  const out = [];
  root.traverse((o) => o.isMesh && out.push(o));
  return out;
}
