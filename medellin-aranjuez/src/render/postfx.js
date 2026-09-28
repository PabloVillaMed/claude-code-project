// Postprocesado según la calidad: oclusión ambiental, bloom, antialias y
// salida con tonemapping ACES.

import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { N8AOPass } from 'n8ao';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';

// Viñeta sutil + gradación de color cálida (look cinematográfico).
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uVignette: { value: 0.35 },
    uSaturation: { value: 1.08 },
    uDamage: { value: 0 },
    uNight: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uVignette;
    uniform float uSaturation;
    uniform float uDamage;
    uniform float uNight;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      float l = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
      c.rgb = mix(vec3(l), c.rgb, uSaturation);
      // Noche: las sombras y medios tonos se enfrían y pierden algo de color
      // (visión nocturna); lo iluminado por postes y faros conserva su tono cálido.
      float dark = uNight * (1.0 - smoothstep(0.05, 0.5, l));
      c.rgb = mix(c.rgb, mix(vec3(l), c.rgb, 0.7) * vec3(0.9, 0.98, 1.14), dark);
      vec2 d = vUv - 0.5;
      float vig = uVignette * (1.0 - 0.45 * uNight); // de noche la viñeta no hunde los bordes
      float v = smoothstep(0.85, 0.2, length(d) * (1.0 + vig));
      c.rgb *= mix(1.0, v, vig * 1.4);
      // Destello rojo al recibir daño.
      float edge = smoothstep(0.25, 0.75, length(d) * 1.4);
      c.rgb = mix(c.rgb, vec3(0.6, 0.0, 0.0), uDamage * edge * 0.8);
      gl_FragColor = c;
    }
  `,
};

export class PostFX {
  constructor(renderer, scene, camera, quality) {
    this.renderer = renderer;
    this.enabled = quality.post;
    this.grade = null;
    if (!this.enabled) return;
    const size = renderer.getSize(new THREE.Vector2());
    const composer = new EffectComposer(renderer);
    if (quality.ao) {
      // Oclusión ambiental N8AO: dibuja la escena una sola vez y calcula la
      // oclusión desde la profundidad (GTAO necesitaba otro pase completo de
      // la escena y duplicaba las llamadas de dibujo).
      const ao = new N8AOPass(scene, camera, size.x, size.y);
      Object.assign(ao.configuration, {
        aoRadius: 2.2,
        distanceFalloff: 1.2,
        intensity: 2.6,
        halfRes: quality.ao === 'half',
        depthAwareUpsampling: true,
        gammaCorrection: false, // la corrección la hace OutputPass
        aoSamples: quality.ao === 'half' ? 12 : 16,
        denoiseSamples: 8,
      });
      this.ao = ao;
      composer.addPass(ao);
    } else {
      composer.addPass(new RenderPass(scene, camera));
    }
    // Umbral alto: solo brillan luces y reflejos intensos, no el cielo.
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.2, 0.35, 5);
    composer.addPass(this.bloom);
    composer.addPass(new OutputPass());
    this.grade = new ShaderPass(GradeShader);
    composer.addPass(this.grade);
    if (quality.smaa) composer.addPass(new SMAAPass(size.x * renderer.getPixelRatio(), size.y * renderer.getPixelRatio()));
    this.composer = composer;
  }

  setSize(w, h) {
    if (this.composer) this.composer.setSize(w, h);
  }

  setPixelRatio(pr) {
    if (this.composer) this.composer.setPixelRatio(pr);
  }

  setDamage(v) {
    if (this.grade) this.grade.uniforms.uDamage.value = v;
  }

  setNight(n) {
    if (this.bloom) {
      // De día solo destellos muy intensos; de noche brillan ventanas y postes.
      this.bloom.strength = 0.15 + n * 0.5;
      this.bloom.threshold = 5 - n * 3.9; // de noche brillan las luces, no el andén iluminado
    }
    if (this.grade) this.grade.uniforms.uNight.value = n;
  }

  render(scene, camera) {
    if (this.composer) this.composer.render();
    else this.renderer.render(scene, camera);
  }
}

// Presupuesto por calidad. pedDraw/driverDraw: distancia (m) a la que se
// dibujan peatones y conductores; shadowChars: hasta dónde proyectan sombra;
// treeNear: hasta dónde árboles y postes van con el modelo completo;
// hdTextures: color de 2048 px en las superficies principales.
// lampLights: luces reales en los faroles más cercanos; headlight: foco de los faros del jugador.
// vehicleDraw/parkedDraw: distancia a la que se dibujan vehículos en marcha y parqueados.
// minScale: resolución mínima que puede usar el escalado dinámico.
// skyLow: cielo horneado más pequeño y nubes de una sola capa (render/sky.js).
export const QUALITY_PRESETS = {
  baja: { label: 'Baja', skyLow: true, pixelRatio: 0.75, minScale: 0.5, shadows: 0, shadowExtent: 50, post: false, ao: false, smaa: false, hdTextures: false, horizonBearings: 480, horizonRings: 80, horizonLights: 6000, backdropHouses: 4000, peds: 24, traffic: 14, drawDistance: 900, pedDraw: 60, driverDraw: 35, shadowChars: 0, treeFar: 350, treeNear: 50, detailDraw: 80, lampLights: 0, headlight: false, vehicleDraw: 160, parkedDraw: 80 },
  media: { label: 'Media', pixelRatio: 1, minScale: 0.65, shadows: 2048, shadowExtent: 65, post: true, ao: false, smaa: true, hdTextures: false, horizonBearings: 640, horizonRings: 100, horizonLights: 10000, backdropHouses: 10000, peds: 34, traffic: 20, drawDistance: 1500, pedDraw: 80, driverDraw: 45, shadowChars: 25, treeFar: 500, treeNear: 65, detailDraw: 120, lampLights: 4, headlight: true, vehicleDraw: 200, parkedDraw: 100 },
  alta: { label: 'Alta', pixelRatio: 1, minScale: 0.75, shadows: 4096, shadowExtent: 80, post: true, ao: 'half', smaa: true, hdTextures: true, horizonBearings: 720, horizonRings: 110, horizonLights: 24000, backdropHouses: 16000, peds: 44, traffic: 26, drawDistance: 2500, pedDraw: 110, driverDraw: 60, shadowChars: 40, treeFar: 650, treeNear: 95, detailDraw: 170, lampLights: 8, headlight: true, vehicleDraw: 260, parkedDraw: 120 },
  ultra: { label: 'Ultra', pixelRatio: 1.5, minScale: 0.8, shadows: 4096, shadowExtent: 95, post: true, ao: 'full', smaa: true, hdTextures: true, horizonBearings: 960, horizonRings: 130, horizonLights: 32000, backdropHouses: 24000, peds: 56, traffic: 32, drawDistance: 4000, pedDraw: 140, driverDraw: 80, shadowChars: 60, treeFar: 900, treeNear: 130, detailDraw: 240, lampLights: 12, headlight: true, headlightShadow: true, vehicleDraw: 320, parkedDraw: 160 },
};
