// Cielo barato y bonito del valle:
//  - La dispersión atmosférica (Preetham, la de three/examples Sky.js) ya no
//    se calcula en cada píxel de la pantalla: se hornea en una textura
//    equirectangular pequeña (256×128, o 128×64 en calidad baja) solo cuando
//    el sol se mueve de verdad (~0,35°). La misma textura alimenta los
//    reflejos (PMREM) del atardecer y la noche.
//  - La cúpula lee esa textura y encima pinta, con muy pocas operaciones:
//    halo y disco del sol, luna llena, estrellas, el resplandor anaranjado de
//    la ciudad y nubes (cúmulos de la tarde y cirros) hechas con capas de un
//    ruido precalculado que se desplazan con el viento.
//  - Cerca del horizonte se funde con el color de la niebla, el mismo de la
//    bruma de las montañas (render/horizon.js).

import * as THREE from 'three';
import { GOLD, skyCoefficients, skyExposure, sunlightColor, skyRadiance, tileableCloudNoise, sunMoved } from '../sim/sky.js';
import { clamp, smoothstep } from '../sim/math.js';

const BAKE_FRAG = /* glsl */ `
  uniform vec3 uSunDir;
  uniform float uSunE;
  uniform vec3 uBetaR;
  uniform vec3 uBetaM;
  uniform float uMieG;
  uniform float uScale;
  uniform vec3 uGold;
  varying vec2 vUv;
  const float PI = 3.141592653589793;
  void main() {
    // Coordenadas equirectangulares (las mismas de three: equirectUv).
    float phi = ( vUv.x - 0.5 ) * 2.0 * PI;
    float el = ( vUv.y - 0.5 ) * PI;
    vec3 dir = vec3( cos( el ) * cos( phi ), sin( el ), cos( el ) * sin( phi ) );
    float za = acos( max( 0.0, dir.y ) );
    float inv = 1.0 / ( cos( za ) + 0.15 * pow( 93.885 - za * 180.0 / PI, -1.253 ) );
    vec3 fex = exp( -( uBetaR * 8.4E3 * inv + uBetaM * 1.25E3 * inv ) );
    float cosT = dot( dir, uSunDir );
    float rPhase = 0.05968310365946075 * ( 1.0 + pow( cosT * 0.5 + 0.5, 2.0 ) );
    float g2 = uMieG * uMieG;
    float mPhase = 0.07957747154594767 * ( 1.0 - g2 ) / pow( 1.0 - 2.0 * uMieG * cosT + g2, 1.5 );
    vec3 ratio = ( uBetaR * rPhase + uBetaM * mPhase ) / ( uBetaR + uBetaM );
    vec3 lin = pow( uSunE * ratio * ( 1.0 - fex ), vec3( 1.5 ) );
    lin *= mix( vec3( 1.0 ), pow( uSunE * ratio * fex, vec3( 0.5 ) ), clamp( pow( 1.0 - uSunDir.y, 5.0 ), 0.0, 1.0 ) );
    vec3 c = ( lin + 0.1 * fex ) * 0.04 + vec3( 0.0, 0.0003, 0.00075 );
    // Hora dorada: resplandor tibio alrededor del sol bajo (igual que sim/sky.js skyRadiance).
    float warm = ( 1.0 - smoothstep( 0.03, 0.3, uSunDir.y ) ) * pow( max( cosT, 0.0 ), 6.0 );
    c *= mix( vec3( 1.0 ), uGold, warm );
    c *= uScale; // exposición propia del cielo (skyExposure)
    // Debajo del horizonte (solo lo ven los reflejos): un poco más oscuro, como el valle.
    c *= mix( 1.0, 0.55, smoothstep( 0.0, -0.25, dir.y ) );
    gl_FragColor = vec4( c, 1.0 );
  }
`;

const DOME_VERT = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = position;
    // Solo la rotación de la vista: la cúpula está en el infinito y no hay que moverla con la cámara.
    gl_Position = projectionMatrix * vec4( mat3( viewMatrix ) * position, 1.0 );
    gl_Position.z = gl_Position.w; // en el plano lejano
  }
`;

const DOME_FRAG = /* glsl */ `
  uniform sampler2D uLut;
  uniform sampler2D uNoise;
  uniform vec3 uSunDir;
  uniform vec3 uMoonDir;
  uniform vec3 uSunTint;    // color del disco y del halo (ya con la extinción)
  uniform float uSunVis;     // 0 con el sol bajo el horizonte
  uniform vec3 uSunLight;    // luz del sol sobre las nubes
  uniform vec3 uAmbient;     // luz del cielo sobre las nubes
  uniform vec3 uFog;
  uniform float uFogK;
  uniform float uNight;
  uniform float uMoonVis;
  uniform float uCover;
  uniform float uCirrus;
  uniform vec4 uWind;        // desplazamiento de las dos capas de nubes
  uniform float uTime;
  varying vec3 vDir;

  float hash13( vec3 p3 ) {
    p3 = fract( p3 * 0.1031 );
    p3 += dot( p3, p3.zyx + 31.32 );
    return fract( ( p3.x + p3.y ) * p3.z );
  }

  void main() {
    vec3 d = normalize( vDir );
    vec2 luv = vec2( atan( d.z, d.x ) * 0.15915494 + 0.5, asin( clamp( d.y, -1.0, 1.0 ) ) * 0.31830989 + 0.5 );
    vec3 col = texture2D( uLut, luv ).rgb;

    // Sol: halo estrecho y disco (el halo ancho ya viene de la dispersión horneada).
    float cs = dot( d, uSunDir );
    float cp = max( cs, 0.0 );
    float cp2 = cp * cp;
    float cp8 = cp2 * cp2; cp8 *= cp8;
    float halo = pow( cp8, 40.0 ) * 0.9 + pow( cp8, 6.0 ) * 0.12; // ~cos^320 y ~cos^48
    col += uSunTint * halo * uSunVis;
    // El disco va aparte: solo él pasa del umbral del bloom (un destello pequeño, no un cielo blanco).
    vec3 disk = uSunTint * 7.0 * smoothstep( 0.99997, 0.999985, cs ) * uSunVis;
    float cloudA = 0.0;

    // Noche: estrellas (pocas: la luz de la ciudad las apaga cerca del horizonte) y luna.
    if ( uNight > 0.02 ) {
      vec3 p = d * 230.0;
      vec3 ci = floor( p );
      float h = hash13( ci );
      if ( h > 0.991 ) {
        vec3 o = vec3( hash13( ci + 17.1 ), hash13( ci + 31.7 ), hash13( ci + 53.3 ) );
        vec3 f = fract( p ) - 0.25 - o * 0.5;
        float s = max( 0.0, 1.0 - dot( f, f ) * 28.0 );
        float tw = 0.75 + 0.25 * sin( uTime * ( 2.0 + o.x * 3.0 ) + h * 90.0 );
        float mag = ( h - 0.991 ) / 0.009; // unas pocas brillantes, muchas tenues
        col += vec3( 0.85 + 0.15 * o.y, 0.9, 1.0 ) * s * s * mix( 0.25, 2.2, mag * mag ) * tw * uNight * smoothstep( 0.04, 0.45, d.y );
      }
      float md = dot( d, uMoonDir );
      if ( md > 0.999 && uMoonVis > 0.0 ) {
        vec3 t1 = normalize( cross( uMoonDir, vec3( 0.0, 1.0, 0.0 ) ) );
        vec3 t2 = cross( t1, uMoonDir );
        vec2 mu = vec2( dot( d, t1 ), dot( d, t2 ) ) / 0.0165;
        float maria = texture2D( uNoise, mu * 0.22 + 0.37 ).r;
        float limb = sqrt( max( 0.0, 1.0 - dot( mu, mu ) ) );
        float disk = smoothstep( 1.02, 0.96, length( mu ) );
        col = mix( col, vec3( 1.0, 0.97, 0.9 ) * ( 1.1 + 0.9 * limb ) * ( 0.7 + 0.45 * maria ), disk * uMoonVis );
      }
      col += vec3( 0.35, 0.42, 0.6 ) * pow( max( md, 0.0 ), 900.0 ) * 0.25 * uMoonVis;
      // Resplandor de la ciudad (sodio) en la bruma: fuerte en el horizonte, más hacia el centro.
      float hy = max( d.y, 0.0 );
      float g = exp( -hy * 9.0 ) * ( 0.75 + 0.25 * max( 0.0, -d.x * 0.6 + d.z * 0.4 ) );
      col += mix( vec3( 0.16, 0.12, 0.10 ), vec3( 0.55, 0.32, 0.16 ), exp( -hy * 16.0 ) ) * g * uNight;
    }

    // Nubes: capas de ruido proyectadas sobre un techo plano, movidas por el viento.
    if ( d.y > 0.0 && uCover > 0.01 ) {
      vec2 cpl = d.xz / ( d.y + 0.09 );
      vec2 uv = cpl * 0.16 + uWind.xy;
      float base = texture2D( uNoise, uv ).r;
      #ifdef SKY_LOW
        float n = base;
        float shade = 1.0;
      #else
        float det = texture2D( uNoise, uv * 3.3 + uWind.zw ).g;
        float n = base * 0.74 + det * 0.26;
        // Sombra propia: cuánta nube hay entre este punto y el sol.
        vec2 toSun = normalize( uSunDir.xz + vec2( 1e-4 ) ) * 0.045;
        float ns = texture2D( uNoise, uv + toSun ).r * 0.74 + det * 0.26;
        float shade = exp( -max( ns - ( 1.0 - uCover ), 0.0 ) * 5.5 );
      #endif
      float th = 1.0 - uCover;
      float dens = smoothstep( th, th + 0.2, n );
      float thick = smoothstep( th, th + 0.45, n );
      float fade = smoothstep( 0.0, 0.14, d.y );
      // Luz: sol (con sombra propia) + cielo; bordes plateados a contraluz.
      float edge = dens * ( 1.0 - thick ) * 2.0;
      float silver = clamp( 0.36 / pow( 1.64 - cs * 1.6, 1.5 ), 0.0, 4.0 );
      vec3 cc = uAmbient * ( 1.15 - 0.35 * thick ) + uSunLight * ( mix( 0.32, 1.0, shade ) * ( 1.0 - 0.3 * thick ) + silver * edge * 0.5 );
      // De noche la bruma de la ciudad las alumbra de naranja por debajo.
      cc += vec3( 0.075, 0.05, 0.035 ) * uNight + vec3( 0.012, 0.016, 0.024 ) * uMoonVis;
      // Perspectiva aérea: las lejanas se funden con el cielo.
      cc = mix( cc, col, ( 1.0 - smoothstep( 0.03, 0.4, d.y ) ) * 0.65 );
      cloudA = dens * fade * 0.96;
      col = mix( col, cc, cloudA );
      #ifndef SKY_LOW
        // Cirros: vetas altas y delgadas.
        float ci = texture2D( uNoise, cpl * vec2( 0.035, 0.11 ) + uWind.wz ).b;
        float cir = smoothstep( 0.55, 0.95, ci ) * uCirrus * fade * ( 1.0 - dens );
        col = mix( col, uAmbient * 1.3 + uSunLight * 0.8 + vec3( 0.05, 0.035, 0.03 ) * uNight, cir * 0.45 );
      #endif
    }

    // Cerca del horizonte, el mismo aire de la niebla y de las montañas.
    col = mix( col, uFog, uFogK * ( 1.0 - smoothstep( -0.02, 0.16, d.y ) ) );
    col = min( col, vec3( 4.0 ) ) + disk * ( 1.0 - cloudA );
    gl_FragColor = vec4( col, 1.0 );
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/** Luminancia del cenit de día (ver sim/sky.js skyExposure): cielo azul, no blanco. */
const SKY_TARGET = 0.35;

export class SkyDome {
  /**
   * @param {THREE.WebGLRenderer} renderer
   * @param {{ skyLow?: boolean }} opts skyLow: textura más pequeña y nubes de una sola capa.
   */
  constructor(renderer, opts = {}) {
    this.renderer = renderer;
    const low = !!opts.skyLow;
    const w = low ? 128 : 256;
    this.lut = new THREE.WebGLRenderTarget(w, w / 2, {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      generateMipmaps: false,
      depthBuffer: false,
      wrapS: THREE.RepeatWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
    });
    this.lut.texture.mapping = THREE.EquirectangularReflectionMapping;

    this.bakeMat = new THREE.ShaderMaterial({
      uniforms: { uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSunE: { value: 0 }, uBetaR: { value: new THREE.Vector3() }, uBetaM: { value: new THREE.Vector3() }, uMieG: { value: 0.76 }, uScale: { value: 1 }, uGold: { value: new THREE.Vector3().fromArray(GOLD) } },
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4( position.xy, 0.0, 1.0 ); }',
      fragmentShader: BAKE_FRAG,
      depthTest: false,
      depthWrite: false,
    });
    this.bakeScene = new THREE.Scene();
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.bakeMat);
    quad.frustumCulled = false;
    this.bakeScene.add(quad);
    this.bakeCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    const size = 128;
    this.noise = new THREE.DataTexture(tileableCloudNoise(size, 7), size, size, THREE.RGBAFormat);
    this.noise.wrapS = this.noise.wrapT = THREE.RepeatWrapping;
    this.noise.magFilter = THREE.LinearFilter;
    this.noise.minFilter = THREE.LinearMipmapLinearFilter;
    this.noise.generateMipmaps = true;
    this.noise.needsUpdate = true;

    this.uniforms = {
      uLut: { value: this.lut.texture },
      uNoise: { value: this.noise },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uMoonDir: { value: new THREE.Vector3(0, -1, 0) },
      uSunTint: { value: new THREE.Color(1, 1, 1) },
      uSunVis: { value: 1 },
      uSunLight: { value: new THREE.Color() },
      uAmbient: { value: new THREE.Color() },
      uFog: { value: new THREE.Color() },
      uFogK: { value: 0.75 },
      uNight: { value: 0 },
      uMoonVis: { value: 0 },
      uCover: { value: 0.4 },
      uCirrus: { value: 0.5 },
      uWind: { value: new THREE.Vector4() },
      uTime: { value: 0 },
    };
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: DOME_VERT,
      fragmentShader: DOME_FRAG,
      defines: low ? { SKY_LOW: 1 } : {},
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1, low ? 24 : 40, low ? 12 : 20), this.material);
    this.mesh.name = 'cielo';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -20; // primero el cielo, luego el horizonte (render/horizon.js)

    this.coeffs = null;
    this.bakedSun = null;
    this.bakes = 0;
    this.wind = new THREE.Vector4(0.13, 0.41, 0.77, 0.29);
  }

  /** Hornea la dispersión si el sol se movió; devuelve true si horneó. */
  bake(sunDir, force = false) {
    if (!force && !sunMoved(this.bakedSun, sunDir)) return false;
    this.bakedSun = { x: sunDir.x, y: sunDir.y, z: sunDir.z };
    const co = skyCoefficients(sunDir);
    this.coeffs = co;
    const u = this.bakeMat.uniforms;
    u.uSunDir.value.copy(sunDir);
    u.uSunE.value = co.sunE;
    u.uBetaR.value.fromArray(co.betaR);
    u.uBetaM.value.fromArray(co.betaM);
    u.uMieG.value = co.mieG;
    const scale = skyExposure(sunDir, co, SKY_TARGET);
    u.uScale.value = scale;
    const r = this.renderer;
    const prev = r.getRenderTarget();
    const xr = r.xr.enabled;
    r.xr.enabled = false;
    r.setRenderTarget(this.lut);
    r.render(this.bakeScene, this.bakeCam);
    r.setRenderTarget(prev);
    r.xr.enabled = xr;
    this.bakes++;

    // Colores que dependen solo del sol (CPU, una vez por horneado).
    const sl = sunlightColor(sunDir, co);
    // Nubes: más claras que el cielo pero sin encandilar el bloom (luminancia máx. ~1,6).
    let k = scale * 1.4;
    const l = (0.2126 * sl[0] + 0.7152 * sl[1] + 0.0722 * sl[2]) * k;
    if (l > 1.6) k *= 1.6 / l;
    // Al atardecer la luz rasante es muy roja y débil: sin esto las nubes quedaban
    // color vino; se aclaran hacia el naranja mientras el sol siga cerca del horizonte.
    else if (l > 1e-5 && l < 0.7) k *= Math.min(4, 0.7 / l) * smoothstep(-0.16, -0.02, sunDir.y);
    this.uniforms.uSunLight.value.setRGB(sl[0] * k, sl[1] * k, sl[2] * k);
    const zen = skyRadiance({ x: 0, y: 1, z: 0 }, sunDir, co);
    const side = skyRadiance({ x: -sunDir.x, y: 0.35, z: -sunDir.z }, sunDir, co);
    const a = 0.5 * scale;
    this.uniforms.uAmbient.value.setRGB((zen[0] + side[0]) * a, (zen[1] + side[1]) * a, (zen[2] + side[2]) * a);
    // Tinte del disco: el color del sol atravesando el aire (rojizo al ponerse).
    const t = [0, 1, 2].map((i) => Math.max(sl[i], 1e-6));
    const m = Math.max(...t);
    this.uniforms.uSunTint.value.setRGB(t[0] / m, t[1] / m, t[2] / m);
    return true;
  }

  /**
   * Por cuadro: solo uniformes (ninguna operación pesada).
   * s = { sunDir, moonDir, night, cover, cirrus, fog: THREE.Color, dt }
   */
  update(s) {
    const u = this.uniforms;
    this.bake(s.sunDir);
    u.uSunDir.value.copy(s.sunDir);
    u.uMoonDir.value.copy(s.moonDir);
    u.uSunVis.value = smoothstep(-0.03, 0.02, s.sunDir.y);
    u.uNight.value = s.night;
    u.uMoonVis.value = clamp(s.moonDir.y * 6, 0, 1) * s.night;
    u.uCover.value = s.cover;
    u.uCirrus.value = s.cirrus;
    u.uFog.value.copy(s.fog);
    u.uTime.value = (u.uTime.value + s.dt) % 1000;
    // Viento del oriente (alisios) hacia el occidente, lento; la capa de detalle un poco más rápida.
    const w = this.wind;
    w.x = (w.x + s.dt * 0.0022) % 1;
    w.y = (w.y + s.dt * 0.0007) % 1;
    w.z = (w.z + s.dt * 0.0061) % 1;
    w.w = (w.w + s.dt * 0.0024) % 1;
    u.uWind.value.copy(w);
  }

  dispose() {
    this.lut.dispose();
    this.noise.dispose();
    this.material.dispose();
    this.bakeMat.dispose();
    this.mesh.geometry.dispose();
  }
}
