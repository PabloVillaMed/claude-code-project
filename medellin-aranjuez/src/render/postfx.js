// Postprocesado según la calidad: oclusión ambiental, bloom, antialias y
// salida con tonemapping ACES.

import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';

// Viñeta sutil + gradación de color cálida (look cinematográfico).
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uVignette: { value: 0.35 },
    uSaturation: { value: 1.08 },
    uDamage: { value: 0 },
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
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      float l = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
      c.rgb = mix(vec3(l), c.rgb, uSaturation);
      vec2 d = vUv - 0.5;
      float v = smoothstep(0.85, 0.2, length(d) * (1.0 + uVignette));
      c.rgb *= mix(1.0, v, uVignette * 1.4);
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
    composer.addPass(new RenderPass(scene, camera));
    if (quality.ao) {
      const ao = new GTAOPass(scene, camera, size.x, size.y);
      ao.output = GTAOPass.OUTPUT.Default;
      ao.blendIntensity = 0.85;
      ao.updateGtaoMaterial({ radius: 0.6, distanceExponent: 1.5, thickness: 1.5, scale: 1 });
      composer.addPass(ao);
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
      this.bloom.threshold = 5 - n * 4.2;
    }
  }

  render(scene, camera) {
    if (this.composer) this.composer.render();
    else this.renderer.render(scene, camera);
  }
}

// Presupuesto por calidad. pedDraw/driverDraw: distancia (m) a la que se
// dibujan peatones y conductores; shadowChars: hasta dónde proyectan sombra.
// minScale: resolución mínima que puede usar el escalado dinámico.
export const QUALITY_PRESETS = {
  baja: { label: 'Baja', pixelRatio: 0.75, minScale: 0.5, shadows: 0, shadowExtent: 50, post: false, ao: false, smaa: false, backdropHouses: 2500, peds: 20, traffic: 12, drawDistance: 800, pedDraw: 55, driverDraw: 35, shadowChars: 0, treeNear: 45 },
  media: { label: 'Media', pixelRatio: 1, minScale: 0.6, shadows: 1024, shadowExtent: 55, post: true, ao: false, smaa: false, backdropHouses: 5000, peds: 28, traffic: 16, drawDistance: 1200, pedDraw: 70, driverDraw: 40, shadowChars: 20, treeNear: 55 },
  alta: { label: 'Alta', pixelRatio: 1, minScale: 0.7, shadows: 2048, shadowExtent: 65, post: true, ao: false, smaa: true, backdropHouses: 8000, peds: 36, traffic: 22, drawDistance: 2000, pedDraw: 90, driverDraw: 50, shadowChars: 30, treeNear: 70 },
  ultra: { label: 'Ultra', pixelRatio: 1.5, minScale: 0.75, shadows: 4096, shadowExtent: 85, post: true, ao: true, smaa: true, backdropHouses: 12000, peds: 48, traffic: 28, drawDistance: 3000, pedDraw: 120, driverDraw: 70, shadowChars: 45, treeNear: 100 },
};
