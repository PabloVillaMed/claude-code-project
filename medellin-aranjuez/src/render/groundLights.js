// Luz de noche calculada en los shaders del piso (y, más tenue, de los muros):
//  - faroles: los N más cercanos a la cámara, con caída física (inverso del
//    cuadrado suavizado y con alcance), luz de sodio naranja o LED blanca;
//  - faros del tráfico: conos con borde suave desde los vehículos en marcha
//    más cercanos (dos haces por vehículo: izquierdo y derecho).
// Reemplaza los charcos de luz planos (cuadros aditivos que flotaban sobre
// las pendientes y se veían cuadrados). Los arreglos tienen tamaño fijo y los
// uniformes son compartidos: los shaders nunca se recompilan, solo cambian
// los valores cada cuadro.
//
// Uso:
//   applyGroundLights(material)                 // asfalto, andenes, sardinel, pasto, terreno
//   applyGroundLights(material, { walls: true }) // fachadas (más tenue)
//   groundLights.update(camPos, lampHeads, vehicles, night, opts)  // cada cuadro (lo llama NightLights)

import * as THREE from 'three';

export const MAX_LAMPS = 32;
export const MAX_BEAMS = 24; // vehículos (cada uno con dos haces)

// Colores (lineales) de las luminarias de Medellín: sodio de alta presión
// (naranja) en la mayoría de calles de barrio y LED blanco neutro en las
// vías principales, parques y remodelaciones recientes.
const SODIUM = new THREE.Color(1.0, 0.6, 0.26);
const LED = new THREE.Color(0.86, 0.9, 1.0);
const HEAD = new THREE.Color(1.0, 0.93, 0.8);

const U = {
  uGLLamp: { value: Array.from({ length: MAX_LAMPS }, () => new THREE.Vector4(0, -1e4, 0, 0)) }, // xyz, intensidad
  uGLLampCol: { value: Array.from({ length: MAX_LAMPS }, () => new THREE.Vector3()) },
  uGLBeamPos: { value: Array.from({ length: MAX_BEAMS }, () => new THREE.Vector4(0, -1e4, 0, 0)) }, // xyz, intensidad
  uGLBeamDir: { value: Array.from({ length: MAX_BEAMS }, () => new THREE.Vector4(0, 0, -1, 0.7)) }, // dir, media separación de los faros
  uGLLampRange: { value: 24 },
  uGLBeamRange: { value: 55 },
};

const VERT_DECL = /* glsl */ `
varying vec3 vGLWorld;
`;
const VERT_BODY = /* glsl */ `
{
  vec4 glw = vec4( transformed, 1.0 );
  #ifdef USE_INSTANCING
    glw = instanceMatrix * glw;
  #endif
  vGLWorld = ( modelMatrix * glw ).xyz;
}
`;

const FRAG_DECL = /* glsl */ `
varying vec3 vGLWorld;
uniform vec4 uGLLamp[ ${MAX_LAMPS} ];
uniform vec3 uGLLampCol[ ${MAX_LAMPS} ];
uniform vec4 uGLBeamPos[ ${MAX_BEAMS} ];
uniform vec4 uGLBeamDir[ ${MAX_BEAMS} ];
uniform float uGLLampRange;
uniform float uGLBeamRange;

// Caída de una luz puntual: inverso del cuadrado (con núcleo para no
// explotar bajo la lámpara) y ventana suave hasta el alcance (como three.js).
float glFalloff( float d2, float range ) {
  float w = clamp( 1.0 - pow( d2 / ( range * range ), 2.0 ), 0.0, 1.0 );
  return w * w / max( d2, 1.0 );
}

// Haz de un faro desde p en dirección dir (unitaria): cono de bordes suaves.
float glBeam( vec3 p, vec3 dir, vec3 nW ) {
  vec3 L = p - vGLWorld;
  float d2 = dot( L, L );
  vec3 l = L * inversesqrt( max( d2, 1e-4 ) );
  float c = dot( -l, dir );
  // Núcleo intenso (~13°) y halo que se apaga hacia ~30°.
  float cone = smoothstep( 0.86, 0.975, c ) * 0.75 + smoothstep( 0.8, 0.9, c ) * 0.25;
  // El haz llega rasante al asfalto: sin algo de ayuda (como la reflexión
  // hacia atrás del asfalto que ve el conductor) el piso casi no se ilumina.
  float nl = dot( nW, l );
  float lam = smoothstep( -0.05, 0.08, nl ) * ( 0.3 + 0.7 * max( nl, 0.0 ) );
  // Núcleo de 8 m: junto al parachoques no se quema.
  float w = clamp( 1.0 - pow( d2 / ( uGLBeamRange * uGLBeamRange ), 2.0 ), 0.0, 1.0 );
  return cone * lam * w * w / max( d2, 64.0 );
}
`;

const FRAG_BODY = /* glsl */ `
{
  vec3 nW = normalize( inverseTransformDirection( normal, viewMatrix ) );
  vec3 glIrr = vec3( 0.0 );
  for ( int i = 0; i < ${MAX_LAMPS}; i ++ ) {
    vec4 lp = uGLLamp[ i ];
    if ( lp.w <= 0.0 ) continue;
    vec3 L = lp.xyz - vGLWorld;
    float d2 = dot( L, L );
    if ( d2 > uGLLampRange * uGLLampRange ) continue;
    float lam = max( dot( nW, L * inversesqrt( d2 ) ), 0.0 );
    glIrr += uGLLampCol[ i ] * ( lp.w * lam * glFalloff( d2, uGLLampRange ) );
  }
  for ( int i = 0; i < ${MAX_BEAMS}; i ++ ) {
    vec4 bp = uGLBeamPos[ i ];
    if ( bp.w <= 0.0 ) continue;
    vec3 toP = bp.xyz - vGLWorld;
    if ( dot( toP, toP ) > uGLBeamRange * uGLBeamRange ) continue;
    vec3 dir = uGLBeamDir[ i ].xyz;
    vec3 side = normalize( vec3( -dir.z, 0.0, dir.x ) ) * uGLBeamDir[ i ].w;
    glIrr += vec3( ${HEAD.r.toFixed(3)}, ${HEAD.g.toFixed(3)}, ${HEAD.b.toFixed(3)} ) * ( bp.w * ( glBeam( bp.xyz + side, dir, nW ) + glBeam( bp.xyz - side, dir, nW ) ) );
  }
  reflectedLight.directDiffuse += glIrr * GLIGHT_GAIN * BRDF_Lambert( material.diffuseColor );
}
`;

/**
 * Añade la luz de faroles y faros a un material estándar (MeshStandard /
 * MeshPhysical / Lambert con `material.diffuseColor`). `walls`: fachadas y
 * muros, con menos intensidad (la luz de los postes baña el primer piso).
 * Se puede llamar sobre materiales compartidos; se aplica una sola vez.
 */
export function applyGroundLights(material, { walls = false } = {}) {
  if (!material || material.userData.groundLights) return material;
  material.userData.groundLights = true;
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (sh, r) => {
    prev?.call(material, sh, r);
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', `#include <common>\n${VERT_DECL}`).replace('#include <project_vertex>', `#include <project_vertex>\n${VERT_BODY}`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\n#define GLIGHT_GAIN ${walls ? '0.55' : '1.0'}\n${FRAG_DECL}`)
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>\n${FRAG_BODY}`);
  };
  // Programa distinto al del mismo material sin la luz del piso.
  const key = material.customProgramCacheKey?.bind(material);
  material.customProgramCacheKey = () => `${key ? key() : ''}|gl${walls ? 'w' : 'g'}`;
  material.needsUpdate = true;
  return material;
}

// ------------------------------------------------------------ actualización
const _order = [];
let _lastCam = null;
let _frame = 0;

/** Color de cada farol: LED blanco en parques y en ~1 de cada 3 calles (fijo por posición). */
export function lampColor(h, out) {
  if (h.led === undefined) {
    const k = Math.sin(Math.round(h.x) * 12.9898 + Math.round(h.z) * 78.233) * 43758.5453;
    h.led = !!h.park || k - Math.floor(k) < 0.33;
  }
  const c = h.led ? LED : SODIUM;
  return out.isColor ? out.copy(c) : out.set(c.r, c.g, c.b);
}

export const groundLights = {
  uniforms: U,
  /** Intensidad base de un farol y de cada haz de un faro (en unidades de la luz del juego). */
  lampPower: 110,
  beamPower: 520,
  /**
   * @param camPos Vector3 de la cámara.
   * @param lampHeads [{x, y, z, park?}] cabezas de los faroles (props.js).
   * @param vehicles VehicleEntity[] (world.vehicles).
   * @param night 0 (día) .. 1 (noche).
   * @param opts.skipVehicle vehículo cuyos faros ya ilumina una luz real (SpotLight del jugador).
   * @param opts.lampScale(i) factor por farol (p. ej. menos si ya tiene PointLight real).
   */
  update(camPos, lampHeads, vehicles, night, opts = {}) {
    const on = night > 0.04;
    const L = U.uGLLamp.value;
    const C = U.uGLLampCol.value;
    // Faroles más cercanos: se reordena cada 10 cuadros o si la cámara se movió.
    _frame++;
    const moved = !_lastCam || _lastCam.distanceToSquared(camPos) > 16;
    if (on && lampHeads.length && (moved || _frame % 10 === 0)) {
      (_lastCam ??= new THREE.Vector3()).copy(camPos);
      _order.length = 0;
      for (let i = 0; i < lampHeads.length; i++) {
        const h = lampHeads[i];
        const d = (h.x - camPos.x) ** 2 + (h.z - camPos.z) ** 2;
        if (_order.length < MAX_LAMPS || d < _order[_order.length - 1][0]) {
          let j = _order.length < MAX_LAMPS ? _order.length : MAX_LAMPS - 1;
          while (j > 0 && _order[j - 1][0] > d) {
            _order[j] = _order[j - 1];
            j--;
          }
          _order[j] = [d, i];
        }
      }
    }
    // Los del borde del conjunto se desvanecen con la distancia (sin saltos al entrar/salir).
    const far = _order.length ? Math.sqrt(_order[_order.length - 1][0]) : 1;
    for (let k = 0; k < MAX_LAMPS; k++) {
      const e = on ? _order[k] : null;
      if (!e) {
        L[k].w = 0;
        continue;
      }
      const h = lampHeads[e[1]];
      const d = Math.sqrt(e[0]);
      const fade = _order.length < MAX_LAMPS ? 1 : 1 - THREE.MathUtils.smoothstep(d, far * 0.72, far);
      const scale = opts.lampScale ? opts.lampScale(e[1]) : 1;
      L[k].set(h.x, h.y, h.z, night * fade * scale * this.lampPower * (h.park ? 0.55 : 1));
      lampColor(h, C[k]);
    }
    // Faros de los vehículos en marcha más cercanos.
    const P = U.uGLBeamPos.value;
    const D = U.uGLBeamDir.value;
    let n = 0;
    if (on && night > 0.1) {
      const cand = [];
      for (const v of vehicles) {
        const s = v.state;
        if (s.destroyed || v === opts.skipVehicle || (v.driver !== 'npc' && v.driver !== 'player' && !v.chasing && !(v.driver && typeof v.driver === 'object'))) continue;
        const d = (s.x - camPos.x) ** 2 + (s.z - camPos.z) ** 2;
        if (d < 160 * 160) cand.push([d, v]);
      }
      cand.sort((a, b) => a[0] - b[0]);
      for (const [, v] of cand) {
        if (n >= MAX_BEAMS) break;
        const s = v.state;
        const moto = v.type === 'moto';
        const fx = -Math.sin(s.heading);
        const fz = -Math.cos(s.heading);
        const half = s.spec.length / 2;
        const hy = moto ? 0.9 : v.type === 'buseta' ? 0.9 : 0.7;
        // Inclinado hacia el piso: el centro del haz toca el asfalto a ~18 m;
        // sigue el cabeceo de la calle.
        const pitch = s.pitch ?? 0;
        const dy = Math.sin(pitch) - hy / 18;
        const inv = 1 / Math.hypot(fx * Math.cos(pitch), dy, fz * Math.cos(pitch));
        P[n].set(s.x + fx * (half - 0.1), s.y + hy + Math.sin(pitch) * half, s.z + fz * (half - 0.1), night * this.beamPower * (moto ? 0.6 : 1));
        D[n].set(fx * Math.cos(pitch) * inv, dy * inv, fz * Math.cos(pitch) * inv, moto ? 0 : s.spec.width * 0.36);
        n++;
      }
    }
    for (let k = n; k < MAX_BEAMS; k++) P[k].w = 0;
  },
};
