// La pinta del jugador sobre el avatar Rocketbox ('jugador'): recolorea en el
// shader las islas UV de la textura del cuerpo (camiseta, mangas, brazos si
// el buso es de manga larga, jean, tenis) y pega a los huesos mallas simples
// para lo que el avatar no trae: gorra (plana o curva) en la cabeza, capota
// y bolsillo del buso, cadena al cuello, canguro terciado y gafas.
//
// Las mallas se arman una vez por avatar y prenda en el espacio del modelo
// en reposo (pose en T, mirando a +Z) y se pasan al marco del hueso; todas
// comparten tres materiales (tela, metal y lente) con color por vértice.
//
// Islas UV de m019_body (textura 1024², origen arriba a la izquierda):
//   camiseta  x 0.327-0.673, y 0.02-0.875 · mangas x <0.31 | >0.69, y 0.435-0.585
//   brazos    mismas columnas, y 0.585-0.84 (piel)
//   jean      x <0.28 | >0.72, y <0.435
//   tenis     capellada negra y > 0.87, x 0.21-0.40 | 0.60-0.79; suela y 0.69-0.87

import * as THREE from 'three';
import { ROPA_BY_ID } from '../sim/ropa.js';

const cloth = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });
const metal = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.28, metalness: 1 });
const lens = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.06, metalness: 0.75, envMapIntensity: 1.6 });

const col = (hex) => new THREE.Color().setHex(hex); // sRGB -> lineal

/** Recoloreado de la ropa en el shader del cuerpo (uniformes compartidos por la instancia). */
function outfitMaterial(src) {
  const m = src.clone();
  const u = {
    uShirt: { value: new THREE.Color(1, 1, 1) },
    uShirt2: { value: new THREE.Color(1, 1, 1) },
    uShirtMode: { value: 0 }, // 0 original, 1 liso, 2 rayas, 3 franja
    uLong: { value: 0 },
    uPants: { value: new THREE.Color(1, 1, 1) },
    uPants2: { value: new THREE.Color(1, 1, 1) },
    uPantsMode: { value: 0 }, // 0 original, 1 jean teñido, 2 sudadera
    uShoe: { value: new THREE.Color(1, 1, 1) },
    uShoe2: { value: new THREE.Color(1, 1, 1) },
    uShoeMode: { value: 0 }, // 0 original, 1 tenis de color, 2 chanclas con medias
  };
  m.userData.outfit = u;
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u);
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform vec3 uShirt; uniform vec3 uShirt2; uniform float uShirtMode; uniform float uLong;
uniform vec3 uPants; uniform vec3 uPants2; uniform float uPantsMode;
uniform vec3 uShoe; uniform vec3 uShoe2; uniform float uShoeMode;
bool pintaPiel( vec3 c ) { return c.r > c.g * 1.12 && c.g > c.b * 1.05 && c.r > 0.12 && c.r - c.b > 0.08; }`,
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
#ifdef USE_MAP
  {
    vec2 q = vMapUv;
    vec3 c = diffuseColor.rgb;
    float lum = dot( c, vec3( 0.2126, 0.7152, 0.0722 ) );
    bool lado = q.x < 0.31 || q.x > 0.69;
    bool torso = q.x > 0.327 && q.x < 0.673 && q.y > 0.02 && q.y < 0.875;
    bool manga = lado && q.y > 0.435 && q.y < 0.585;
    if ( uShirtMode > 0.5 && ( torso || manga ) ) {
      vec3 t = uShirt;
      if ( uShirtMode > 1.5 && uShirtMode < 2.5 && torso ) t = mix( uShirt, uShirt2, step( 0.5, fract( ( q.x - 0.327 ) * 16.0 ) ) );
      if ( uShirtMode > 2.5 && torso ) {
        float y = q.y < 0.45 ? q.y : q.y - 0.55;
        t = mix( uShirt, uShirt2, step( 0.14, y ) * step( y, 0.19 ) );
      }
      diffuseColor.rgb = t * clamp( lum / 0.8, 0.35, 1.1 );
    }
    if ( uLong > 0.5 && lado && q.y >= 0.585 && q.y < 0.84 && pintaPiel( c ) ) {
      diffuseColor.rgb = uShirt * clamp( 0.55 + lum * 1.2, 0.5, 1.0 );
    }
    if ( uPantsMode > 0.5 && q.y < 0.435 && ( q.x < 0.28 || q.x > 0.72 ) ) {
      float k = clamp( lum / 0.2, 0.45, 1.5 );
      vec3 p = uPants * k;
      if ( uPantsMode > 1.5 ) {
        // Sudadera: tela lisa con franja a los lados de la pierna.
        float e = min( abs( q.x - 0.012 ), abs( q.x - 0.988 ) );
        p = mix( uPants * mix( 1.0, k, 0.35 ), uPants2, step( e, 0.012 ) );
      }
      diffuseColor.rgb = p;
    }
    bool zap = ( ( q.x > 0.21 && q.x < 0.40 ) || ( q.x > 0.60 && q.x < 0.79 ) ) && q.y > 0.87;
    bool suela = ( ( q.x > 0.235 && q.x < 0.325 ) || ( q.x > 0.675 && q.x < 0.765 ) ) && q.y > 0.69 && q.y <= 0.87;
    if ( uShoeMode > 0.5 && zap && !pintaPiel( c ) && lum < 0.3 ) {
      if ( uShoeMode < 1.5 ) diffuseColor.rgb = uShoe * clamp( 0.55 + lum * 8.0, 0.5, 1.2 );
      else {
        // Chanclas con medias blancas: la capellada es media y una tira de color la cruza.
        bool tira = q.y > 0.925 && q.y < 0.955;
        diffuseColor.rgb = tira ? uShoe : uShoe2 * clamp( 0.72 + lum * 3.0, 0.7, 1.0 );
      }
    }
    if ( uShoeMode > 1.5 && suela && lum > 0.3 ) diffuseColor.rgb = uShoe * 0.8;
  }
#endif`,
      );
  };
  m.customProgramCacheKey = () => 'pinta-jugador';
  return m;
}

// ------------------------------------------------------------------ medidas del avatar
const measures = new WeakMap();

/** Medidas del avatar en reposo: cabeza, ojos, cuello, pecho y espalda (una vez por plantilla). */
function measure(scene) {
  if (measures.has(scene)) return measures.get(scene);
  scene.updateMatrixWorld(true);
  const bone = (n) => scene.getObjectByName(n);
  const wp = (n) => bone(n)?.getWorldPosition(new THREE.Vector3()) ?? null;
  const head = wp('Bip01_Head');
  const neck = wp('Bip01_Neck');
  const re = wp('Bip01_REye');
  const le = wp('Bip01_LEye');
  const pts = { head: [], body: [] };
  const v = new THREE.Vector3();
  scene.traverse((o) => {
    if (!o.isSkinnedMesh) return;
    const pos = o.geometry.attributes.position;
    const list = /head/i.test(o.material?.name ?? o.name) ? pts.head : pts.body;
    for (let i = 0; i < pos.count; i += 1) {
      v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
      list.push(v.x, v.y, v.z);
    }
  });
  const eyeY = re && le ? (re.y + le.y) / 2 : head.y + 0.08;
  // Cráneo: puntos de la cabeza por encima de los ojos.
  let top = -Infinity;
  const b = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
  for (let i = 0; i < pts.head.length; i += 3) {
    const [x, y, z] = [pts.head[i], pts.head[i + 1], pts.head[i + 2]];
    top = Math.max(top, y);
    if (y > eyeY + 0.01) {
      b.minX = Math.min(b.minX, x);
      b.maxX = Math.max(b.maxX, x);
      b.minZ = Math.min(b.minZ, z);
      b.maxZ = Math.max(b.maxZ, z);
    }
  }
  // Frente y espalda del tronco a una altura dada (franja central).
  const slab = (y0, y1, xMax = 0.12) => {
    let f = -Infinity;
    let k = Infinity;
    for (let i = 0; i < pts.body.length; i += 3) {
      const [x, y, z] = [pts.body[i], pts.body[i + 1], pts.body[i + 2]];
      if (y < y0 || y > y1 || Math.abs(x) > xMax) continue;
      f = Math.max(f, z);
      k = Math.min(k, z);
    }
    return { front: f, back: k };
  };
  const m = {
    top,
    eyeY,
    eyeZ: re && le ? Math.max(re.z, le.z) : b.maxZ - 0.02,
    eyeX: re && le ? Math.abs(re.x - le.x) / 2 : 0.032,
    skull: { cx: (b.minX + b.maxX) / 2, cz: (b.minZ + b.maxZ) / 2, rx: (b.maxX - b.minX) / 2, rz: (b.maxZ - b.minZ) / 2 },
    neck,
    chest: slab(neck.y - 0.2, neck.y - 0.12),
    collar: slab(neck.y - 0.08, neck.y - 0.03, 0.06),
    belly: slab(neck.y - 0.5, neck.y - 0.42),
    shoulderX: 0.17,
  };
  measures.set(scene, m);
  return m;
}

// ------------------------------------------------------------------ mallas
/** Pinta de color una geometría (atributo color) y la devuelve. */
function paint(g, hex) {
  const c = col(hex);
  const n = g.attributes.position.count;
  const a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) a.set([c.r, c.g, c.b], i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
}

function merge(parts) {
  // Unión simple de geometrías indexadas (posición, normal, color).
  const geos = parts.map((g) => (g.index ? g.toNonIndexed() : g));
  let n = 0;
  for (const g of geos) n += g.attributes.position.count;
  const pos = new Float32Array(n * 3);
  const nor = new Float32Array(n * 3);
  const cl = new Float32Array(n * 3);
  let o = 0;
  for (const g of geos) {
    pos.set(g.attributes.position.array, o * 3);
    nor.set(g.attributes.normal.array, o * 3);
    cl.set(g.attributes.color.array, o * 3);
    o += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.BufferAttribute(cl, 3));
  return out;
}

/** Gorra: copa en media esfera, visera recta (plana) o curva, botón y costuras. */
function capGeo(m, it) {
  const s = m.skull;
  const base = m.eyeY + 0.038;
  const h = m.top + 0.016 - base;
  const rx = s.rx * 1.1 + 0.006;
  const rz = s.rz * 1.06 + 0.006;
  const crown = new THREE.SphereGeometry(1, 22, 10, 0, Math.PI * 2, 0, Math.PI / 2);
  crown.scale(rx, h, rz);
  // Un poco echada para atrás: la frente más baja que la nuca.
  crown.rotateX(-0.12);
  crown.translate(s.cx, base + 0.004, s.cz - 0.004);
  paint(crown, it.color);
  const parts = [crown];
  // Banda de la copa (un pelo más ancha, del segundo color en la plana).
  const band = new THREE.CylinderGeometry(1, 1, 0.012, 22, 1, true);
  band.scale(rx * 1.005, 1, rz * 1.005);
  band.rotateX(-0.12);
  band.translate(s.cx, base + 0.01, s.cz - 0.004);
  parts.push(paint(band, it.type === 'gorra-plana' ? it.color : it.color));
  // Visera: medio óvalo extruido.
  const flat = it.type === 'gorra-plana';
  const vw = rx * 0.98;
  const vl = flat ? 0.085 : 0.075;
  const sh = new THREE.Shape();
  sh.moveTo(-vw, 0);
  sh.absellipse(0, 0, vw, vl, Math.PI, 0, true);
  sh.lineTo(-vw, 0);
  const visor = new THREE.ExtrudeGeometry(sh, { depth: 0.007, bevelEnabled: false, curveSegments: 14 });
  // De XY (Y = hacia delante) a XZ con Z hacia delante.
  visor.rotateX(Math.PI / 2);
  visor.scale(1, 1, -1);
  const p = visor.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const z = p.getZ(i);
    // La curva dobla los lados hacia abajo y la punta un poco.
    if (!flat) p.setY(i, p.getY(i) - 0.035 * (x / vw) ** 2 - 0.12 * z * z * 4);
  }
  visor.computeVertexNormals();
  visor.rotateX(flat ? 0.02 : 0.2);
  visor.translate(s.cx, base - (flat ? 0.002 : 0.004), s.cz + rz * 0.9);
  paint(visor, flat ? it.color : it.color2 ?? it.color);
  parts.push(visor);
  // Calcomanía dorada en la visera plana (la de siempre, sin marca).
  if (flat) {
    const st = new THREE.BoxGeometry(0.018, 0.0015, 0.018);
    st.translate(s.cx + vw * 0.45, base + 0.004, s.cz + rz * 0.9 + 0.035);
    parts.push(paint(st, 0xd8a93a));
  }
  const btn = new THREE.CylinderGeometry(0.008, 0.009, 0.006, 10);
  btn.translate(s.cx, m.top + 0.017, s.cz - 0.006);
  parts.push(paint(btn, it.color2 ?? it.color));
  return merge(parts);
}

/** Capota del buso recogida en la nuca, cordones y bolsillo canguro. */
function hoodGeo(m, it) {
  const n = m.neck;
  const parts = [];
  const ring = new THREE.TorusGeometry(0.085, 0.032, 8, 18, Math.PI * 1.35);
  ring.rotateX(Math.PI / 2);
  ring.rotateY(Math.PI / 2 + Math.PI * 0.675 - Math.PI);
  ring.scale(1.15, 0.8, 1.0);
  ring.translate(n.x, n.y - 0.035, (m.collar.front + m.collar.back) / 2 - 0.01);
  parts.push(paint(ring, it.color));
  const back = new THREE.SphereGeometry(1, 12, 8);
  back.scale(0.11, 0.085, 0.045);
  back.translate(n.x, n.y - 0.02, m.collar.back - 0.035);
  parts.push(paint(back, it.color));
  for (const sx of [-0.035, 0.035]) {
    const cord = new THREE.BoxGeometry(0.006, 0.12, 0.006);
    cord.translate(n.x + sx, n.y - 0.13, m.chest.front + 0.012);
    parts.push(paint(cord, 0xeeeeee));
  }
  const pocket = new THREE.BoxGeometry(0.24, 0.1, 0.014);
  pocket.translate(n.x, n.y - 0.47, m.belly.front + 0.004);
  const dark = col(it.color).multiplyScalar(0.8).getHex(THREE.LinearSRGBColorSpace);
  parts.push(paint(pocket, new THREE.Color().setHex(dark, THREE.LinearSRGBColorSpace).getHex()));
  return merge(parts);
}

/** Cadena: anillo delgado alrededor del cuello, caído adelante, con dije. */
function chainGeo(m, it) {
  const n = m.neck;
  const zc = (m.collar.front + m.collar.back) / 2;
  const rz = (m.collar.front - m.collar.back) / 2 + 0.012;
  const ring = new THREE.TorusGeometry(1, it.id === 'cadena-dorada' ? 0.075 : 0.05, 6, 36);
  ring.rotateX(Math.PI / 2);
  ring.scale(0.078, 0.078, rz);
  // Tubo de grosor constante: el torus escalado lo afina; se compensa con el radio.
  const p = ring.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const z = p.getZ(i);
    // Cae por delante (sobre el pecho) y sube por la nuca.
    p.setY(i, p.getY(i) - Math.max(0, z / rz) * 0.075);
  }
  ring.computeVertexNormals();
  ring.translate(n.x, n.y - 0.05, zc + 0.006);
  const parts = [paint(ring, it.color)];
  const dije = new THREE.CylinderGeometry(0.012, 0.012, 0.004, 12);
  dije.rotateX(Math.PI / 2);
  dije.translate(n.x, n.y - 0.05 - 0.075 - 0.016, m.chest.front + 0.012);
  parts.push(paint(dije, it.color));
  return merge(parts);
}

/** Canguro terciado: bolso en el pecho y correa del hombro izquierdo a la cadera derecha. */
function bagGeo(m, it) {
  const n = m.neck;
  const parts = [];
  const tilt = 0.45;
  const bag = new THREE.BoxGeometry(0.2, 0.09, 0.055);
  bag.rotateZ(tilt);
  bag.translate(n.x - 0.02, n.y - 0.24, m.chest.front + 0.03);
  parts.push(paint(bag, it.color));
  const zip = new THREE.BoxGeometry(0.19, 0.006, 0.004);
  zip.rotateZ(tilt);
  zip.translate(n.x - 0.02 - 0.005, n.y - 0.225, m.chest.front + 0.059);
  parts.push(paint(zip, it.color2 ?? 0x111111));
  // Correas: adelante y atrás, en diagonal (del hombro izquierdo del personaje a la cadera derecha).
  for (const [z, len] of [[m.chest.front + 0.012, 0.52], [m.chest.back - 0.012, 0.56]]) {
    const s = new THREE.BoxGeometry(0.035, len, 0.006);
    s.rotateZ(-0.62);
    s.translate(n.x + 0.0, n.y - 0.2, z);
    parts.push(paint(s, 0x151515));
  }
  return merge(parts);
}

/** Gafas: dos lentes, puente y patas hasta las orejas. */
function glassesGeo(m, it) {
  const z = m.eyeZ + 0.03;
  const y = m.eyeY + 0.002;
  const cx = m.skull.cx;
  const lensParts = [];
  const frame = [];
  for (const sx of [-1, 1]) {
    const l = new THREE.CylinderGeometry(0.026, 0.026, 0.004, 16);
    l.rotateX(Math.PI / 2);
    l.scale(1.15, 0.8, 1);
    l.translate(cx + sx * (m.eyeX + 0.004), y, z);
    lensParts.push(paint(l, it.color));
    const t = new THREE.BoxGeometry(0.004, 0.006, 0.105);
    t.translate(cx + sx * (m.eyeX + 0.034), y + 0.008, z - 0.052);
    frame.push(paint(t, 0x111111));
  }
  const br = new THREE.BoxGeometry(0.022, 0.004, 0.004);
  br.translate(cx, y + 0.012, z);
  frame.push(paint(br, 0x111111));
  const top = new THREE.BoxGeometry(2 * m.eyeX + 0.07, 0.005, 0.006);
  top.translate(cx, y + 0.02, z - 0.001);
  frame.push(paint(top, 0x111111));
  return { lens: merge(lensParts), frame: merge(frame) };
}

// ------------------------------------------------------------------ montaje
const geoCache = new WeakMap(); // escena de la plantilla -> Map(id -> [{geo, mat, bone}])

function accessory(scene, it) {
  let cache = geoCache.get(scene);
  if (!cache) geoCache.set(scene, (cache = new Map()));
  if (cache.has(it.id)) return cache.get(it.id);
  const m = measure(scene);
  const list = [];
  const add = (geo, mat, boneName) => {
    const bone = scene.getObjectByName(boneName);
    if (!bone) return;
    geo.applyMatrix4(bone.matrixWorld.clone().invert());
    geo.computeBoundingSphere();
    list.push({ geo, mat, bone: boneName });
  };
  if (it.slot === 'cabeza') add(capGeo(m, it), cloth, 'Bip01_Head');
  else if (it.type === 'buso') add(hoodGeo(m, it), cloth, 'Bip01_Spine2');
  else if (it.slot === 'cuello') add(chainGeo(m, it), metal, 'Bip01_Spine2');
  else if (it.slot === 'cintura') add(bagGeo(m, it), cloth, 'Bip01_Spine2');
  else if (it.slot === 'ojos') {
    const g = glassesGeo(m, it);
    add(g.lens, lens, 'Bip01_Head');
    add(g.frame, cloth, 'Bip01_Head');
  }
  cache.set(it.id, list);
  return list;
}

/**
 * Viste al personaje con la pinta `outfit` ({cabeza, torso, piernas, pies,
 * cuello, cintura, ojos} -> id de sim/ropa.js). Solo cambia lo necesario; en
 * el muñeco procedural de respaldo no hace nada.
 */
export function applyOutfit(rig, outfit) {
  if (!rig?.model || !rig.tpl) return false;
  const st = (rig._outfit ??= { mat: null, meshes: [] });
  if (!st.mat) {
    rig.model.traverse((o) => {
      if (o.isSkinnedMesh && /body/i.test(o.material?.name ?? '')) {
        st.mat = outfitMaterial(o.material);
        o.material = st.mat;
      }
    });
  }
  const u = st.mat?.userData.outfit;
  const get = (slot) => ROPA_BY_ID[outfit?.[slot]] ?? null;
  const top = get('torso');
  const legs = get('piernas');
  const feet = get('pies');
  if (u) {
    const mode = !top ? 0 : top.pattern === 'rayas' ? 2 : top.pattern === 'franja' ? 3 : 1;
    u.uShirtMode.value = top?.color == null ? 0 : mode;
    if (top?.color != null) u.uShirt.value.setHex(top.color);
    u.uShirt2.value.setHex(top?.color2 ?? 0xffffff);
    u.uLong.value = top?.long ? 1 : 0;
    u.uPantsMode.value = legs?.color == null ? 0 : legs.type === 'sudadera' ? 2 : 1;
    if (legs?.color != null) u.uPants.value.setHex(legs.color);
    u.uPants2.value.setHex(legs?.color2 ?? 0xffffff);
    u.uShoeMode.value = !feet || (feet.type === 'tenis' && feet.color == null) ? 0 : feet.type === 'chanclas' ? 2 : 1;
    if (feet?.color != null) u.uShoe.value.setHex(feet.color);
    u.uShoe2.value.setHex(feet?.color2 ?? 0xffffff);
  }
  // Accesorios pegados a los huesos.
  for (const mesh of st.meshes) mesh.removeFromParent();
  st.meshes = [];
  const scene = rig.tpl.scene;
  for (const slot of ['cabeza', 'torso', 'cuello', 'cintura', 'ojos']) {
    const it = get(slot);
    if (!it || (slot === 'torso' && it.type !== 'buso')) continue;
    for (const a of accessory(scene, it)) {
      const bone = rig.bones[a.bone];
      if (!bone) continue;
      const mesh = new THREE.Mesh(a.geo, a.mat);
      mesh.name = `ropa-${it.id}`;
      mesh.castShadow = true;
      bone.add(mesh);
      st.meshes.push(mesh);
    }
  }
  // La lista de mallas con sombra cambió (ver setRigShadow).
  rig._shadowMeshes = null;
  rig._shadowOn = undefined;
  return true;
}
