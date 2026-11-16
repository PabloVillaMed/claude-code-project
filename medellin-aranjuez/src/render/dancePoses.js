// Bailes y gestos por código sobre el esqueleto de los personajes Rocketbox
// (render/characterRig.js, `rig.post`): toma la pose en números de
// sim/baile.js (cadera, pecho, cabeza, pies y manos en el marco del
// personaje) y la pone encima de la pose base que dejó el mezclador.
//
// Para que sea barato con decenas de personas bailando no usa las matrices
// de mundo de three (cada getWorldQuaternion recorre y recalcula la cadena de
// padres): lleva su propia cinemática de 21 huesos en el espacio del modelo
// (cuaterniones y posiciones reciclados, sin asignaciones por cuadro) y con
// ella resuelve las piernas (los pies se quedan en el piso aunque la cadera
// baje o se corra) y los brazos (la mano va a donde dice la pose) con una IK
// analítica de dos huesos. Convención de Bip01: el eje X de cada hueso va a
// lo largo del hueso y la rodilla y el codo doblan sobre su eje Z (flexión =
// giro negativo), igual en los dos lados.
//
// También arma la utilería de la rumba que va en la mano (micrófono,
// maracas, botella, bandeja con botella y bengala, taco de billar).

import * as THREE from 'three';

// ------------------------------------------------------------------ configurables
/** Codo: hacia dónde apunta con la mano abajo y con la mano arriba (marco del personaje: x a su lado de afuera, y, z). */
const CODO_ABAJO = [0.45, -0.75, -0.5];
const CODO_ARRIBA = [0.95, -0.05, -0.3];
/** Rodilla: hacia adelante y un poco hacia afuera. */
const RODILLA = [0.14, 0, 1];
/** Largo (m) del tobillo a la punta del pie (el talón se levanta girando sobre la punta). */
const PIE_LARGO = 0.13;
/** Chispas de la bengala del mesero y su tamaño (m). */
const BENGALA_CHISPAS = 16;
const BENGALA_TAM = 0.05;

const NOMBRES = ['Bip01', 'Bip01_Pelvis', 'Bip01_Spine', 'Bip01_Spine1', 'Bip01_Spine2', 'Bip01_Neck', 'Bip01_Head', 'Bip01_L_Clavicle', 'Bip01_L_UpperArm', 'Bip01_L_Forearm', 'Bip01_L_Hand', 'Bip01_R_Clavicle', 'Bip01_R_UpperArm', 'Bip01_R_Forearm', 'Bip01_R_Hand', 'Bip01_L_Thigh', 'Bip01_L_Calf', 'Bip01_L_Foot', 'Bip01_R_Thigh', 'Bip01_R_Calf', 'Bip01_R_Foot'];
const PADRE = [-1, 0, 1, 2, 3, 4, 5, 5, 7, 8, 9, 5, 11, 12, 13, 2, 15, 16, 2, 18, 19];
const N = NOMBRES.length;
const SPINE = 2;
const SPINE1 = 3;
const SPINE2 = 4;
const NECK = 5;
const HEAD = 6;
const BRAZO = [[7, 8, 9, 10], [11, 12, 13, 14]]; // clavícula, brazo, antebrazo, mano (izquierdo, derecho)
const PIERNA = [[15, 16, 17], [18, 19, 20]]; // muslo, pantorrilla, pie

const _e = new THREE.Euler(0, 0, 0, 'YXZ');
const _qd = new THREE.Quaternion();
const _qi = new THREE.Quaternion();
const _qt = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _v = new THREE.Vector3();
const _T = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _n = new THREE.Vector3();
const _X = new THREE.Vector3();
const _Y = new THREE.Vector3();
const _Z = new THREE.Vector3();
const _E = new THREE.Vector3();
const _pole = new THREE.Vector3();
const sst = (x) => {
  const t = x < 0 ? 0 : x > 1 ? 1 : x;
  return t * t * (3 - 2 * t);
};

/**
 * Datos de baile del personaje (una vez por rig): huesos, cinemática
 * reciclada y medidas. null si no es un avatar Rocketbox con la jerarquía
 * esperada (el muñeco procedural de respaldo no baila por código).
 */
export function prepararBaile(rig) {
  if (rig._baile !== undefined) return rig._baile;
  const B = rig.bones;
  const b = B ? NOMBRES.map((n) => B[n]) : [];
  if (!rig.model || b.length !== N || b.some((x) => !x)) return (rig._baile = null);
  for (let i = 1; i < N; i++) if (b[i].parent !== b[PADRE[i]]) return (rig._baile = null);
  // Nodos fijos entre el modelo y Bip01.
  const preQ = new THREE.Quaternion();
  const preP = new THREE.Vector3();
  const chain = [];
  for (let n = b[0].parent; n && n !== rig.model; n = n.parent) chain.unshift(n);
  for (const c of chain) {
    preP.add(_v.copy(c.position).applyQuaternion(preQ));
    preQ.multiply(c.quaternion);
  }
  const D = {
    b,
    q: b.map(() => new THREE.Quaternion()),
    qb: b.map(() => new THREE.Quaternion()),
    p: b.map(() => new THREE.Vector3()),
    preQ,
    preQi: preQ.clone().invert(),
    preP,
    lado: 1,
    pie: [new THREE.Vector3(), new THREE.Vector3()],
    largo: { muslo: b[16].position.length(), pantorrilla: b[17].position.length(), brazo: b[9].position.length(), antebrazo: b[10].position.length() },
    nivel: null, // utilería que se mantiene derecha (la bandeja): {mesh, mano (0 izquierda / 1 derecha)}
    hombro: 1.4,
  };
  rig._baile = D;
  // ¿De qué lado del modelo queda la izquierda del personaje? (y la altura del hombro, de pie)
  for (let i = 0; i < N; i++) fk(D, i);
  D.lado = D.p[8].x >= D.p[12].x ? 1 : -1;
  D.hombro = D.p[8].y * (rig.scale ?? 1);
  return D;
}

/** Altura del hombro (m) y estatura del personaje (para apuntar las manos de la pareja). */
export function medidasBaile(rig) {
  const D = prepararBaile(rig);
  const alto = (rig.tpl?.height ?? 1.75) * (rig.scale ?? 1);
  return { hombro: D?.hombro ?? alto * 0.82, alto };
}

/** Cinemática del hueso i a partir de su padre (orientación y posición en el espacio del modelo). */
function fk(D, i) {
  const pa = PADRE[i];
  const bone = D.b[i];
  if (pa < 0) {
    D.q[i].multiplyQuaternions(D.preQ, bone.quaternion);
    D.p[i].copy(bone.position).applyQuaternion(D.preQ).add(D.preP);
  } else {
    D.q[i].multiplyQuaternions(D.q[pa], bone.quaternion);
    D.p[i].copy(bone.position).applyQuaternion(D.q[pa]).add(D.p[pa]);
  }
}

/** Solo la posición del hueso i (su orientación ya está puesta). */
function fkPos(D, i) {
  const pa = PADRE[i];
  D.p[i].copy(D.b[i].position).applyQuaternion(D.q[pa]).add(D.p[pa]);
}

/** Escribe el giro local del hueso i desde su orientación en el modelo (mezclado con peso w). */
function local(D, i, w = 1) {
  const pa = PADRE[i];
  _qi.copy(pa < 0 ? D.preQ : D.q[pa]).invert();
  _qt.multiplyQuaternions(_qi, D.q[i]);
  const q = D.b[i].quaternion;
  if (w >= 0.999) q.copy(_qt);
  else {
    q.slerp(_qt, w);
    // (La cadena de abajo sigue desde lo que de verdad quedó.)
    D.q[i].multiplyQuaternions(pa < 0 ? D.preQ : D.q[pa], q);
  }
}

/** Giro en el marco del personaje (cabeceo, giro a la izquierda, ladeo a la izquierda) como cuaternión del modelo. */
function giro(D, rx, ry, rz) {
  _e.set(rx, ry * D.lado, -rz * D.lado, 'YXZ');
  return _qd.setFromEuler(_e);
}

/** El hueso i queda con su orientación de la base más el giro (rx, ry, rz) del marco del personaje. */
function absoluto(D, i, rx, ry, rz) {
  D.q[i].multiplyQuaternions(giro(D, rx, ry, rz), D.qb[i]);
  fkPos(D, i);
  local(D, i);
}

/**
 * IK de dos huesos en el espacio del modelo: la punta (mano o pie) va a T
 * doblando hacia `pole`. Deja la orientación completa de los dos huesos (eje
 * X a lo largo, Z en la bisagra) y sus giros locales (con peso w).
 */
function ik(D, iUp, iLow, iEnd, T, pole, a, b, w) {
  const S = D.p[iUp];
  _dir.subVectors(T, S);
  const d = Math.min(Math.max(_dir.length(), 0.06), a + b - 0.004);
  _dir.normalize();
  const cosA = Math.min(1, Math.max(-1, (a * a + d * d - b * b) / (2 * a * d)));
  const sinA = Math.sqrt(1 - cosA * cosA);
  _n.copy(pole).addScaledVector(_dir, -pole.dot(_dir));
  if (_n.lengthSq() < 1e-6) _n.set(0, 0, 1).addScaledVector(_dir, -_dir.z);
  _n.normalize();
  _Z.crossVectors(_dir, _n).normalize();
  // Primer hueso: del hombro (cadera) al codo (rodilla).
  _X.copy(_dir).multiplyScalar(cosA).addScaledVector(_n, sinA);
  _Y.crossVectors(_Z, _X);
  D.q[iUp].setFromRotationMatrix(_m.makeBasis(_X, _Y, _Z));
  local(D, iUp, w);
  // Segundo: del codo a la mano (con peso < 1 el codo no quedó justo en el plano: se reortogonaliza).
  fk(D, iLow);
  _E.copy(D.p[iLow]);
  _X.copy(S).addScaledVector(_dir, d).sub(_E).normalize();
  _Z.addScaledVector(_X, -_Z.dot(_X)).normalize();
  _Y.crossVectors(_Z, _X);
  if (w >= 0.999) {
    D.q[iLow].setFromRotationMatrix(_m.makeBasis(_X, _Y, _Z));
    local(D, iLow, 1);
  } else {
    // Mezcla en el espacio de la articulación: de la flexión de la base a la de la IK.
    _qt.copy(D.q[iLow]);
    D.q[iLow].setFromRotationMatrix(_m.makeBasis(_X, _Y, _Z));
    const pa = PADRE[iLow];
    _qi.copy(D.q[pa]).invert();
    _qd.multiplyQuaternions(_qi, D.q[iLow]);
    D.b[iLow].quaternion.slerp(_qd, w);
    D.q[iLow].multiplyQuaternions(D.q[pa], D.b[iLow].quaternion);
  }
  fkPos(D, iEnd);
}

/**
 * Pone la pose `o` (sim/baile.js) sobre el esqueleto del rig, encima de la
 * pose base. `w` 0..1: cuánto de la pose (para entrar y salir del baile sin
 * salto). Llamar desde `rig.post` (después del mezclador y las capas).
 */
export function aplicarPose(rig, o, w = 1) {
  const D = prepararBaile(rig);
  if (!D) return false;
  const k = 1 / (rig.scale || 1); // de metros a unidades del modelo
  const L = D.lado;
  const q = D.q;
  const p = D.p;
  for (let i = 0; i < N; i++) {
    fk(D, i);
    D.qb[i].copy(q[i]);
  }
  const piernas = o.piernas > 0.5;
  if (piernas) {
    D.pie[0].copy(p[17]);
    D.pie[1].copy(p[20]);
    // Cadera: se corre (y con ella todo el cuerpo; los pies vuelven a su sitio más abajo).
    p[0].x += o.hx * k * L * w;
    p[0].y += o.hy * k * w;
    p[0].z += o.hz * k * w;
    D.b[0].position.copy(p[0]).sub(D.preP).applyQuaternion(D.preQi);
    fkPos(D, 1);
    // Caderas (Bip01_Spine carga los muslos y el tronco).
    absoluto(D, SPINE, o.cRx * w, o.cRy * w, o.cRz * w);
  }
  // Pecho: repartido en dos vértebras; la cabeza se queda derecha más lo que diga la pose.
  absoluto(D, SPINE1, o.tRx * 0.5 * w, o.tRy * 0.5 * w, o.tRz * 0.5 * w);
  absoluto(D, SPINE2, o.tRx * w, o.tRy * w, o.tRz * w);
  fk(D, NECK);
  if (piernas || o.kRx || o.kRy || o.kRz || o.tRx) absoluto(D, HEAD, (o.kRx + o.tRx * 0.25) * w, o.kRy * w, o.kRz * w);
  // Piernas: cada pie donde lo dejó la base más su corrimiento.
  if (piernas) {
    for (let s = 0; s < 2; s++) {
      const [iT, iC, iF] = PIERNA[s];
      const izq = s === 0;
      const dx = izq ? o.piX : o.pdX;
      const dy = izq ? o.piY : o.pdY;
      const dz = izq ? o.piZ : o.pdZ;
      const tal = (izq ? o.piT : o.pdT) * w;
      fkPos(D, iT);
      // El talón sube girando sobre la punta del pie: el tobillo sube y se adelanta un poco.
      _T.copy(D.pie[s]);
      _T.x += dx * k * L * w;
      _T.y += (dy * w + PIE_LARGO * Math.sin(tal)) * k;
      _T.z += (dz * w + PIE_LARGO * (1 - Math.cos(tal))) * k;
      _pole.set(RODILLA[0] * (izq ? L : -L), RODILLA[1], RODILLA[2]);
      ik(D, iT, iC, iF, _T, _pole, D.largo.muslo, D.largo.pantorrilla, 1);
      // El pie conserva su orientación de la base (plano en el piso) más el talón levantado.
      q[iF].multiplyQuaternions(giro(D, tal, 0, 0), D.qb[iF]);
      local(D, iF);
    }
  }
  // Brazos.
  for (let s = 0; s < 2; s++) {
    const [iCl, iU, iF, iH] = BRAZO[s];
    const izq = s === 0;
    const bw = (izq ? o.biW : o.bdW) * w;
    fk(D, iCl);
    fk(D, iU);
    if (bw > 0.01) {
      const x = (izq ? o.biX : o.bdX) * k * L;
      const y = (izq ? o.biY : o.bdY) * k;
      const z = (izq ? o.biZ : o.bdZ) * k;
      if ((izq ? o.biA : o.bdA) > 0.5) _T.set(x, y, z);
      else _T.set(p[iU].x + x, p[iU].y + y, p[iU].z + z);
      // El codo: abajo y atrás con la mano baja; hacia afuera con la mano arriba.
      const t = sst((_T.y - p[iU].y + 0.08 * k) / (0.3 * k));
      const lado = izq ? L : -L;
      _pole.set((CODO_ABAJO[0] + (CODO_ARRIBA[0] - CODO_ABAJO[0]) * t) * lado, CODO_ABAJO[1] + (CODO_ARRIBA[1] - CODO_ABAJO[1]) * t, CODO_ABAJO[2] + (CODO_ARRIBA[2] - CODO_ABAJO[2]) * t);
      ik(D, iU, iF, iH, _T, _pole, D.largo.brazo, D.largo.antebrazo, bw);
    }
    // Utilería que va derecha en esta mano (la bandeja del mesero).
    if (D.nivel && D.nivel.mano === s) {
      if (bw <= 0.01) {
        fk(D, iF);
        fkPos(D, iH);
      }
      q[iH].multiplyQuaternions(q[iF], D.b[iH].quaternion);
      D.nivel.mesh.quaternion.copy(q[iH]).invert();
    }
  }
  // La vuelta: gira el modelo entero sobre sus pies.
  rig.model.rotation.y = Math.PI + o.yaw * L * w;
  return true;
}

/** Deja el rig como estaba (el modelo sin el giro de la vuelta). */
export function soltarPose(rig) {
  if (rig?.model && rig._baile) rig.model.rotation.y = Math.PI;
}

// ------------------------------------------------------------------ utilería de la rumba
const compartido = {};
function partes() {
  if (compartido.listo) return compartido;
  const std = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.5, ...extra });
  const C = compartido;
  C.negro = std(0x17181b, { roughness: 0.4, metalness: 0.3 });
  C.gris = std(0x8d9096, { roughness: 0.35, metalness: 0.8 });
  C.madera = std(0x8a5a2b, { roughness: 0.6 });
  C.rojo = std(0xb3261e, { roughness: 0.5 });
  C.vidrio = std(0x1f5a2c, { roughness: 0.15, metalness: 0.1, emissive: 0x0c2a12 });
  C.plata = std(0xd9dadd, { roughness: 0.25, metalness: 0.9 });
  C.chispa = new THREE.PointsMaterial({ color: 0xffd9a0, size: BENGALA_TAM, sizeAttenuation: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
  // Micrófono: mango y cabeza.
  C.mango = new THREE.CylinderGeometry(0.014, 0.012, 0.17, 8);
  C.cabeza = new THREE.SphereGeometry(0.03, 10, 8);
  // Maraca.
  C.maracaMango = new THREE.CylinderGeometry(0.009, 0.009, 0.14, 6);
  C.maraca = new THREE.SphereGeometry(0.045, 10, 8);
  // Botella.
  C.botella = new THREE.CylinderGeometry(0.034, 0.034, 0.2, 10);
  C.cuello = new THREE.CylinderGeometry(0.012, 0.03, 0.1, 8);
  // Bandeja.
  C.bandeja = new THREE.CylinderGeometry(0.17, 0.16, 0.012, 18);
  // Taco de billar.
  C.taco = new THREE.CylinderGeometry(0.006, 0.013, 1.42, 6);
  C.listo = true;
  return C;
}

const malla = (g, m, x = 0, y = 0, z = 0) => {
  const o = new THREE.Mesh(g, m);
  o.position.set(x, y, z);
  o.castShadow = false;
  return o;
};

/** Marco de agarre en la mano `lado` ('L' / 'R') del avatar, como el del vaso (eje Y a lo largo del pulgar, por fuera de la palma). Una vez por avatar. */
function agarre(tpl, lado) {
  const cache = (tpl.agarres ??= {});
  if (cache[lado]) return cache[lado];
  if (lado === 'R' && tpl.props?.cup) return (cache.R = tpl.props.cup);
  tpl.scene.updateMatrixWorld(true);
  const hand = tpl.scene.getObjectByName(`Bip01_${lado}_Hand`);
  if (!hand) return null;
  const hq = hand.getWorldQuaternion(new THREE.Quaternion());
  const hqi = hq.clone().invert();
  const along = new THREE.Vector3(1, 0, 0).applyQuaternion(hq).normalize();
  const palmN = new THREE.Vector3(0, -1, 0);
  const thumb = new THREE.Vector3().crossVectors(palmN, along).normalize();
  if (thumb.z < 0) thumb.negate();
  const palmW = along.clone().multiplyScalar(0.075).add(new THREE.Vector3(0, -0.035, 0));
  const x = new THREE.Vector3().crossVectors(thumb, palmN);
  const q = hqi.clone().multiply(new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, thumb, palmN)));
  const p = palmW.clone().addScaledVector(palmN, 0.03).addScaledVector(along, -0.01).applyQuaternion(hqi);
  return (cache[lado] = { q, p });
}

/**
 * Pone en la mano del rig la utilería `tipo`: 'micro', 'maracas' (una en
 * cada mano), 'botella', 'bandeja' (en la izquierda, derecha y con botella y
 * bengala), 'bandeja-sola' (la misma sin bengala) o 'taco'. Devuelve {objs, bengala} (bengala: los puntos de las
 * chispas, para animarlos con animarBengala) o null. Se quita con quitarUtileria.
 */
export function ponerUtileria(rig, tipo) {
  if (!rig?.tpl || !rig.bones?.Bip01_R_Hand) return null;
  const C = partes();
  const objs = [];
  let bengala = null;
  const en = (lado, hijos) => {
    const fr = agarre(rig.tpl, lado);
    const hand = rig.bones[`Bip01_${lado}_Hand`];
    if (!fr || !hand) return null;
    const g = new THREE.Group();
    g.name = `rumba-${tipo}`;
    g.quaternion.copy(fr.q);
    g.position.copy(fr.p);
    for (const h of hijos) g.add(h);
    hand.add(g);
    objs.push(g);
    return g;
  };
  if (tipo === 'micro') en('R', [malla(C.mango, C.negro, 0, 0.02, 0), malla(C.cabeza, C.gris, 0, 0.125, 0)]);
  else if (tipo === 'maracas') {
    for (const lado of ['L', 'R']) en(lado, [malla(C.maracaMango, C.madera, 0, 0.0, 0), malla(C.maraca, C.rojo, 0, 0.1, 0)]);
  } else if (tipo === 'botella') en('R', [malla(C.botella, C.vidrio, 0, 0.03, 0), malla(C.cuello, C.vidrio, 0, 0.18, 0)]);
  else if (tipo === 'taco') en('R', [malla(C.taco, C.madera, 0, 0.25, 0)]);
  else if (tipo === 'bandeja' || tipo === 'bandeja-sola') {
    // Sobre la palma izquierda, siempre derecha (aplicarPose la nivela): bandeja, botella y la bengala ('bandeja-sola': sin bengala).
    const fr = agarre(rig.tpl, 'L');
    const hand = rig.bones.Bip01_L_Hand;
    if (!fr || !hand) return null;
    const g = new THREE.Group();
    g.name = 'rumba-bandeja';
    g.position.copy(fr.p);
    const tray = new THREE.Group();
    tray.add(malla(C.bandeja, C.plata, 0, 0.045, 0), malla(C.botella, C.vidrio, 0.03, 0.15, 0.02), malla(C.cuello, C.vidrio, 0.03, 0.3, 0.02));
    if (tipo === 'bandeja') {
      const pos = new Float32Array(BENGALA_CHISPAS * 3);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0.03, 0.42, 0.02), 0.5);
      bengala = new THREE.Points(geo, C.chispa);
      bengala.name = 'rumba-bengala';
      bengala.userData.fase = Math.random() * 10;
      tray.add(bengala);
    }
    g.add(tray);
    hand.add(g);
    objs.push(g);
    const D = prepararBaile(rig);
    if (D) D.nivel = { mesh: tray, mano: 0 };
  }
  rig._poseDirty = true;
  return objs.length ? { objs, bengala } : null;
}

/** Quita la utilería que puso ponerUtileria (las geometrías y materiales son compartidos; la de las chispas, propia). */
export function quitarUtileria(rig, u) {
  if (!u) return;
  for (const o of u.objs) o.removeFromParent();
  u.bengala?.geometry.dispose();
  if (rig?._baile) rig._baile.nivel = null;
  if (rig) rig._poseDirty = true;
}

/** Chispas de la bengala en el tiempo t (s): salen de la boca de la botella y caen. */
export function animarBengala(points, t) {
  const a = points.geometry.attributes.position;
  const arr = a.array;
  const f = points.userData.fase ?? 0;
  for (let i = 0; i < BENGALA_CHISPAS; i++) {
    const s = i * 12.9898 + f;
    const vida = (t * (1.4 + (i % 5) * 0.22) + s) % 1;
    const ang = s * 7.3 + t * 3;
    const rad = vida * 0.16;
    arr[i * 3] = 0.03 + Math.cos(ang) * rad;
    arr[i * 3 + 1] = 0.36 + vida * 0.2 - vida * vida * 0.26;
    arr[i * 3 + 2] = 0.02 + Math.sin(ang) * rad;
  }
  a.needsUpdate = true;
}

/**
 * Botellas con bengala sobre las mesitas de los VIP ocupados: dos mallas
 * instanciadas (botella y cuello) y un solo Points con las chispas de todas
 * (3 llamadas de dibujo por local). `poner(lista)` con [{x, y, z}] (mundo, y
 * = tapa de la mesita), `animar(t)` cada cuadro y `dispose()` al salir.
 */
export function botellasVip(max) {
  const C = partes();
  const group = new THREE.Group();
  group.name = 'rumba-botellas-vip';
  // (Su propia copia del vidrio: el mismo material en las botellas de la mano, sin instancias, hacía que three
  // volviera a buscar el programa en cada cambio, dos veces por cuadro.)
  C.vidrioInst ??= C.vidrio.clone();
  const cuerpo = new THREE.InstancedMesh(C.botella, C.vidrioInst, max);
  const cuello = new THREE.InstancedMesh(C.cuello, C.vidrioInst, max);
  const pos = new Float32Array(max * BENGALA_CHISPAS * 3);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const chispas = new THREE.Points(geo, C.chispa);
  for (const o of [cuerpo, cuello, chispas]) {
    o.frustumCulled = false;
    o.castShadow = false;
  }
  cuerpo.count = cuello.count = 0;
  geo.setDrawRange(0, 0);
  group.add(cuerpo, cuello, chispas);
  const sitios = [];
  return {
    group,
    get n() {
      return sitios.length;
    },
    poner(lista) {
      sitios.length = 0;
      for (const p of lista.slice(0, max)) sitios.push({ x: p.x, y: p.y, z: p.z });
      sitios.forEach((p, i) => {
        cuerpo.setMatrixAt(i, _m.makeTranslation(p.x, p.y + 0.1, p.z));
        cuello.setMatrixAt(i, _m.makeTranslation(p.x, p.y + 0.25, p.z));
      });
      cuerpo.count = cuello.count = sitios.length;
      cuerpo.instanceMatrix.needsUpdate = cuello.instanceMatrix.needsUpdate = true;
      geo.setDrawRange(0, sitios.length * BENGALA_CHISPAS);
    },
    animar(t) {
      for (let k = 0; k < sitios.length; k++) {
        const p = sitios[k];
        for (let i = 0; i < BENGALA_CHISPAS; i++) {
          const s = i * 12.9898 + k * 3.7;
          const vida = (t * (1.4 + (i % 5) * 0.22) + s) % 1;
          const ang = s * 7.3 + t * 3;
          const rad = vida * 0.16;
          const j = (k * BENGALA_CHISPAS + i) * 3;
          pos[j] = p.x + Math.cos(ang) * rad;
          pos[j + 1] = p.y + 0.31 + vida * 0.2 - vida * vida * 0.26;
          pos[j + 2] = p.z + Math.sin(ang) * rad;
        }
      }
      if (sitios.length) geo.attributes.position.needsUpdate = true;
    },
    dispose() {
      group.removeFromParent();
      geo.dispose();
      cuerpo.dispose();
      cuello.dispose();
    },
  };
}

/** Una muestra de cada pieza de utilería (para el calentamiento de programas: render/warmupSamples.js). */
export function muestrasUtileria() {
  const C = partes();
  const g = new THREE.Group();
  g.name = 'muestras-rumba';
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0.3, 0, 0.05, 0.35, 0]), 3));
  // (Geometrías copiadas: el calentamiento libera las de sus muestras y estas son compartidas.)
  g.add(malla(C.mango.clone(), C.negro), malla(C.cabeza.clone(), C.gris, 0, 0.1, 0), malla(C.maraca.clone(), C.rojo, 0.1, 0, 0), malla(C.maracaMango.clone(), C.madera, 0.1, 0, 0), malla(C.botella.clone(), C.vidrio, 0.2, 0, 0), malla(C.bandeja.clone(), C.plata, 0.3, 0, 0), new THREE.Points(geo, C.chispa));
  // (La botella instanciada de los VIP es otro programa: también se compila.)
  C.vidrioInst ??= C.vidrio.clone();
  const inst = new THREE.InstancedMesh(C.botella.clone(), C.vidrioInst, 1);
  inst.setMatrixAt(0, _m.makeTranslation(0.4, 0.1, 0));
  g.add(inst);
  return g;
}
