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
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.2, 0.35, 2.2);
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

  setDamage(v) {
    if (this.grade) this.grade.uniforms.uDamage.value = v;
  }

  setNight(n) {
    if (this.bloom) {
      this.bloom.strength = 0.18 + n * 0.5;
      this.bloom.threshold = 2.2 - n * 1.4;
    }
  }

  render(scene, camera) {
    if (this.composer) this.composer.render();
    else this.renderer.render(scene, camera);
  }
}

export const QUALITY_PRESETS = {
  baja: { label: 'Baja', pixelRatio: 0.8, shadows: 0, shadowExtent: 60, post: false, ao: false, smaa: false, backdropHouses: 3000, peds: 24, traffic: 14, drawDistance: 900 },
  media: { label: 'Media', pixelRatio: 1, shadows: 2048, shadowExtent: 70, post: true, ao: false, smaa: false, backdropHouses: 6000, peds: 34, traffic: 20, drawDistance: 1500 },
  alta: { label: 'Alta', pixelRatio: 1, shadows: 4096, shadowExtent: 80, post: true, ao: true, smaa: true, backdropHouses: 9000, peds: 44, traffic: 26, drawDistance: 2500 },
  ultra: { label: 'Ultra', pixelRatio: 2, shadows: 4096, shadowExtent: 90, post: true, ao: true, smaa: true, backdropHouses: 14000, peds: 56, traffic: 32, drawDistance: 4000 },
};
