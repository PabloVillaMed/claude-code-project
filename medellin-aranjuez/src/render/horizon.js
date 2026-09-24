// Horizonte del Valle de Aburrá: las montañas que rodean Medellín hasta
// ~34 km, con el río, la ciudad trepando por las laderas y sus luces de noche.
//
// Cómo se dibuja sin alargar el plano lejano de la cámara:
//  - Es un campo de alturas polar (rumbo × distancia) con la geografía real
//    (sim/geography.js). En el sombreador cada vértice se proyecta en la
//    dirección exacta desde la cámara (paralaje correcto) sobre un cilindro
//    de radio fijo, y la profundidad se escribe según la distancia real, así
//    un cerro cercano tapa bien a la cordillera de atrás.
//  - Se dibuja antes que todo lo opaco (renderOrder negativo) y al terminar
//    se borra el búfer de profundidad: la ciudad y el fondo cercano se
//    pintan encima como si el horizonte estuviera en el infinito.
//  - Iluminación propia (sol, cielo, bruma que aumenta con la distancia y el
//    esmog del fondo del valle) y luces de la ciudad como puntos aditivos.

import * as THREE from 'three';
import { makeRng } from '../sim/rng.js';
import { VALLEY_FLOOR, GEO_REF, urbanAmount, valleyAsl, valleyHeight } from '../sim/geography.js';

const D_MIN = 1400;
const D_MAX = 34000;
const R = 400; // radio del cilindro de proyección (unidades del mundo)

const PROJECT = /* glsl */ `
  uniform vec3 uCam;
  uniform float uMaxD;
  float projectHorizon(vec3 world, float bias) {
    vec3 rel = world - uCam;
    float hd = max(length(rel.xz), 1.0);
    vec3 p = uCam + rel * (${R.toFixed(1)} / hd);
    gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
    float dn = clamp((hd - bias) / uMaxD, 0.0, 1.0);
    gl_Position.z = (dn * 2.0 - 1.0) * gl_Position.w;
    return hd;
  }
`;

const VERT = /* glsl */ `
  ${PROJECT}
  attribute vec3 albedo;
  attribute float urban;
  varying vec3 vWorld;
  varying vec3 vNormal;
  varying vec3 vAlbedo;
  varying float vUrban;
  varying float vDist;
  void main() {
    vWorld = position;
    vNormal = normal;
    vAlbedo = albedo;
    vUrban = urban;
    vDist = projectHorizon(position, 0.0);
  }
`;

const FRAG = /* glsl */ `
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform vec3 uSkyColor;
  uniform vec3 uGroundColor;
  uniform vec3 uHaze;
  uniform float uHazeK;
  uniform float uNight;
  uniform float uFloorY;
  varying vec3 vWorld;
  varying vec3 vNormal;
  varying vec3 vAlbedo;
  varying float vUrban;
  varying float vDist;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
  }

  void main() {
    float detail = 1.0 - smoothstep(9000.0, 24000.0, vDist);
    // Microrrelieve: cañadas pequeñas que la malla no alcanza a modelar.
    vec2 q = vWorld.xz / vec2(260.0, 110.0);
    float e = 0.35;
    vec2 grad = vec2(vnoise(q + vec2(e, 0.0)) - vnoise(q - vec2(e, 0.0)), vnoise(q + vec2(0.0, e)) - vnoise(q - vec2(0.0, e)));
    vec3 n = normalize(vNormal + vec3(-grad.x, 0.0, -grad.y) * 0.9 * detail);
    vec3 albedo = vAlbedo;
    // Monte: bosque en las cañadas (más empinado), potrero en los lomos, y
    // manchas a dos escalas.
    float steep = 1.0 - n.y;
    float m = vnoise(vWorld.xz / 520.0) * 0.55 + vnoise(vWorld.xz / 120.0) * 0.3 + vnoise(vWorld.xz / 38.0) * 0.15;
    vec3 forest = vec3(0.03, 0.055, 0.028);
    vec3 pasture = vec3(0.12, 0.15, 0.06);
    vec3 wild = mix(pasture, forest, clamp(0.25 + steep * 2.2 + (m - 0.5) * 1.3, 0.0, 1.0));
    albedo = mix(albedo, wild * (0.8 + 0.4 * m), detail * (1.0 - vUrban));
    // Tejido urbano: manzanas de ladrillo, techos grises y edificios claros.
    if (vUrban > 0.01) {
      vec2 cell = floor(vWorld.xz / 38.0);
      float h = hash(cell);
      vec3 brick = vec3(0.22, 0.125, 0.085) * (0.8 + 0.4 * hash(cell + 7.3));
      vec3 tone = h > 0.86 ? vec3(0.38, 0.37, 0.35) : h > 0.68 ? vec3(0.19, 0.18, 0.17) : brick;
      // Árboles y calles entre las manzanas.
      float green = step(0.8, vnoise(vWorld.xz / 90.0));
      tone = mix(tone, vec3(0.05, 0.08, 0.035), green * 0.8);
      albedo = mix(albedo, tone * (0.85 + 0.3 * vnoise(vWorld.xz / 9.0)), vUrban * 0.85);
    }
    float ndl = max(dot(n, uSunDir), 0.0);
    float sky = 0.5 + 0.5 * n.y;
    vec3 col = albedo * (uSunColor * ndl + mix(uGroundColor, uSkyColor, sky));
    // Ciudad encendida: resplandor anaranjado de noche sobre las laderas.
    col += uNight * vUrban * vec3(0.9, 0.45, 0.16) * 0.012;
    // Bruma: aumenta con la distancia; más densa sobre el fondo del valle (esmog).
    float smog = 1.0 - smoothstep(0.0, 420.0, vWorld.y - uFloorY);
    float f = 1.0 - exp(-vDist * uHazeK * (1.0 + 0.9 * smog));
    col = mix(col, uHaze, clamp(f, 0.0, 0.93));
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const LIGHTS_VERT = /* glsl */ `
  ${PROJECT}
  uniform float uNight;
  uniform float uTime;
  uniform float uScale;
  attribute vec3 color;
  attribute float seed;
  varying vec3 vColor;
  void main() {
    float hd = projectHorizon(position, 45.0);
    float tw = 0.8 + 0.2 * sin(uTime * (1.3 + seed * 3.0) + seed * 40.0);
    float fade = clamp(1.25 - hd / 16000.0, 0.25, 1.0);
    vColor = color * uNight * tw * fade;
    gl_PointSize = uScale * (hd < 5000.0 ? 2.2 : 1.6);
  }
`;

const LIGHTS_FRAG = /* glsl */ `
  varying vec3 vColor;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float a = 1.0 - smoothstep(0.1, 0.5, length(c));
    gl_FragColor = vec4(vColor * a, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/** Colores base (lineales) según la altura y la ciudad (también los usa el fondo cercano). */
export function albedoAt(x, z, asl, urb, slope, rng) {
  // Montaña: potrero claro en lomas, bosque oscuro en cañadas y en lo alto.
  const forest = [0.035, 0.06, 0.03];
  const pasture = [0.11, 0.14, 0.055];
  const high = asl > 2300 ? 1 : 0;
  const k = Math.min(1, Math.max(0, 0.35 + slope * 1.8 + high * 0.35 + (rng() - 0.5) * 0.3));
  const g = forest.map((f, i) => pasture[i] * (1 - k) + f * k);
  const u = [0.22, 0.14, 0.1];
  return g.map((c, i) => c * (1 - urb) + u[i] * urb);
}

export class Horizon {
  constructor(scene, quality) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.name = 'horizonte';
    scene.add(this.group);
    this.uniforms = {
      uCam: { value: new THREE.Vector3() },
      uMaxD: { value: D_MAX * 1.05 },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uSunColor: { value: new THREE.Color() },
      uSkyColor: { value: new THREE.Color() },
      uGroundColor: { value: new THREE.Color() },
      uHaze: { value: new THREE.Color() },
      uHazeK: { value: 0.00005 },
      uNight: { value: 0 },
      uFloorY: { value: VALLEY_FLOOR - GEO_REF },
      uTime: { value: 0 },
      uScale: { value: 1 },
    };
    this._buildTerrain(quality);
    this._buildLights(quality);
    // Al terminar el horizonte se borra la profundidad: lo que sigue (la
    // ciudad, el fondo cercano) siempre queda delante.
    const clear = new THREE.Mesh(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0, 0, 0, 0], 3)), new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, depthTest: false }));
    clear.geometry.setDrawRange(0, 0);
    clear.frustumCulled = false;
    clear.renderOrder = -8;
    clear.onAfterRender = (renderer) => renderer.clearDepth();
    this.group.add(clear);
  }

  _buildTerrain(quality) {
    const nb = quality.horizonBearings ?? 720;
    const nd = quality.horizonRings ?? 110;
    const ratio = Math.pow(D_MAX / D_MIN, 1 / (nd - 1));
    const dist = Array.from({ length: nd }, (_, j) => D_MIN * Math.pow(ratio, j));
    const count = nb * nd;
    const pos = new Float32Array(count * 3);
    const nor = new Float32Array(count * 3);
    const alb = new Float32Array(count * 3);
    const urb = new Float32Array(count);
    const rng = makeRng(2024);
    const r = () => rng.next();
    const e = 12;
    for (let j = 0; j < nd; j++) {
      for (let i = 0; i < nb; i++) {
        const b = (i / nb) * Math.PI * 2;
        const x = Math.sin(b) * dist[j];
        const z = -Math.cos(b) * dist[j];
        const asl = valleyAsl(x, z);
        const k = j * nb + i;
        pos.set([x, asl - GEO_REF, z], k * 3);
        // Normal por diferencias finitas (con paso proporcional a la malla).
        const s = Math.max(e, dist[j] * 0.004);
        const hx = valleyAsl(x + s, z) - valleyAsl(x - s, z);
        const hz = valleyAsl(x, z + s) - valleyAsl(x, z - s);
        const n = new THREE.Vector3(-hx, 2 * s, -hz).normalize();
        nor.set([n.x, n.y, n.z], k * 3);
        const u = urbanAmount(x, z, asl);
        urb[k] = u;
        alb.set(albedoAt(x, z, asl, u, 1 - n.y, r), k * 3);
      }
    }
    // Triángulos de lejos hacia cerca (la profundidad ya ordena, pero así se
    // evita trabajo inútil de sombreado en las tarjetas gráficas sin early-z).
    const idx = [];
    for (let j = nd - 2; j >= 0; j--) {
      for (let i = 0; i < nb; i++) {
        const a = j * nb + i;
        const b2 = j * nb + ((i + 1) % nb);
        const c = (j + 1) * nb + i;
        const d = (j + 1) * nb + ((i + 1) % nb);
        idx.push(a, c, b2, b2, c, d);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setAttribute('albedo', new THREE.BufferAttribute(alb, 3));
    g.setAttribute('urban', new THREE.BufferAttribute(urb, 1));
    g.setIndex(idx);
    const mat = new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: VERT, fragmentShader: FRAG, side: THREE.DoubleSide, fog: false });
    mat.name = 'horizonte';
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.name = 'horizonte';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -10;
    this.group.add(this.mesh);
  }

  _buildLights(quality) {
    const n = quality.horizonLights ?? 16000;
    const rng = makeRng(77);
    const pos = [];
    const col = [];
    const seed = [];
    const dMax = 18000;
    let tries = 0;
    while (seed.length < n && tries < n * 30) {
      tries++;
      // Muestreo uniforme por área: más luces lejos, como en la realidad.
      const D = Math.sqrt(rng.next() * (dMax * dMax - D_MIN * D_MIN) + D_MIN * D_MIN);
      const b = rng.next() * Math.PI * 2;
      const x = Math.sin(b) * D;
      const z = -Math.cos(b) * D;
      if (urbanAmount(x, z) < rng.next() * 1.1) continue;
      pos.push(x, valleyHeight(x, z) + 6, z);
      const r = rng.next();
      // Sodio anaranjado (la mayoría) y LED blanco de las vías nuevas.
      if (r < 0.62) col.push(1.0, 0.55, 0.22);
      else if (r < 0.9) col.push(0.95, 0.9, 0.8);
      else col.push(0.75, 0.85, 1.0);
      seed.push(rng.next());
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setAttribute('seed', new THREE.Float32BufferAttribute(seed, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: LIGHTS_VERT,
      fragmentShader: LIGHTS_FRAG,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: false, // en la lista opaca, antes de borrar la profundidad
      fog: false,
    });
    mat.name = 'horizonte-luces';
    this.lights = new THREE.Points(g, mat);
    this.lights.frustumCulled = false;
    this.lights.renderOrder = -9;
    this.group.add(this.lights);
  }

  /** Luz, bruma y cámara del cuadro actual. */
  update(dt, camera, env, pixelRatio = 1) {
    const u = this.uniforms;
    u.uCam.value.copy(camera.position);
    u.uTime.value += dt;
    u.uNight.value = env.night;
    u.uScale.value = pixelRatio;
    u.uSunDir.value.copy(env.sunDir);
    // Mismo reparto de luz que la escena (el sol se atenúa al ponerse).
    // Lambert como en MeshStandardMaterial (÷π) más un término de cielo que
    // hace las veces de la luz ambiental de la escena (IBL).
    u.uSunColor.value.copy(env.sun.color).multiplyScalar(env.sun.intensity / Math.PI);
    const amb = env.hemi.intensity / Math.PI + 0.55 * (1 - env.night) + env.moon.intensity * 0.15;
    u.uSkyColor.value.copy(env.hemi.color).multiplyScalar(amb);
    u.uGroundColor.value.copy(env.hemi.groundColor).multiplyScalar(amb);
    u.uHaze.value.copy(this.scene.fog.color);
    this.lights.visible = env.night > 0.02;
  }
}
