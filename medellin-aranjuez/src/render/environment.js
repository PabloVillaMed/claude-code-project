// Cielo físico, sol con sombras que siguen al jugador, ciclo día/noche,
// niebla atmosférica del valle y reflejos (PMREM) del cielo.

import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { clamp, smoothstep } from '../sim/math.js';
import { dayEnvironment } from './photoMaterials.js';

/**
 * El disco solar del cielo físico llega a valores HDR enormes que desbordan
 * los búferes de media precisión del postprocesado (pantalla blanca y NaN).
 * Se limita su radiancia máxima.
 */
function clampSky(sky, max) {
  const m = sky.material;
  m.fragmentShader = m.fragmentShader.replace('gl_FragColor = vec4( texColor, 1.0 );', `gl_FragColor = vec4( min( texColor, vec3( ${max.toFixed(1)} ) ), 1.0 );`);
  m.needsUpdate = true;
}

export class Environment {
  constructor(renderer, scene, quality) {
    this.renderer = renderer;
    this.scene = scene;
    this.quality = quality;
    this.timeOfDay = 16.5; // 4:30 p. m. — luz dorada
    this.timeScale = 60; // 1 minuto real = 1 hora de juego
    this.paused = false;
    this.brightness = 1; // ajuste del jugador (multiplica la exposición)

    this.sky = new Sky();
    this.sky.scale.setScalar(20000);
    // Por debajo del umbral del bloom (5): el halo del sol ya no lava la imagen
    // cuando se mira hacia él (antes todo el occidente quedaba blanco en la tarde).
    clampSky(this.sky, 4.2);
    const u = this.sky.material.uniforms;
    u.turbidity.value = 5;
    u.rayleigh.value = 1.6;
    u.mieCoefficient.value = 0.004;
    u.mieDirectionalG.value = 0.76;
    this.sky.renderOrder = -20; // primero el cielo, luego el horizonte (render/horizon.js)
    scene.add(this.sky);

    this.sun = new THREE.DirectionalLight(0xffffff, 3);
    this.sun.castShadow = quality.shadows > 0;
    const sm = quality.shadows || 1024;
    this.sun.shadow.mapSize.set(sm, sm);
    const ext = quality.shadowExtent;
    Object.assign(this.sun.shadow.camera, { left: -ext, right: ext, top: ext, bottom: -ext, near: 1, far: 600 });
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.04;
    scene.add(this.sun, this.sun.target);

    this.hemi = new THREE.HemisphereLight(0xbfd8ff, 0x5a4a38, 0.9);
    scene.add(this.hemi);

    // Luna (un poco azulada, desde lo alto): de noche es la luz de relleno
    // que deja leer calles, andenes y personas lejos de los postes.
    this.moon = new THREE.DirectionalLight(0xa8bcff, 0);
    scene.add(this.moon, this.moon.target);

    scene.fog = new THREE.FogExp2(0xc9d6df, 0.0003);

    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.envScene = new THREE.Scene();
    this.envSky = new Sky();
    this.envSky.scale.setScalar(1000);
    clampSky(this.envSky, 16);
    this.envScene.add(this.envSky);
    this.envTarget = null;
    this.envTimer = 0;
    // HDRI real (Poly Haven, CC0) para la luz ambiental y reflejos de día.
    this.dayEnv = dayEnvironment(this.pmrem);
    this.sunDir = new THREE.Vector3();
    this.night = 0;
    this._stars();
    this._cityGlow();
    this.update(0, new THREE.Vector3());
    this._refreshEnv();
  }

  _stars() {
    const n = 1500;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const u = Math.random() * 2 - 1;
      const t = Math.random() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u);
      pos.set([r * Math.cos(t) * 9000, Math.abs(u) * 9000 + 300, r * Math.sin(t) * 9000], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    // Estrellas pegadas al plano lejano (como el cielo) y dibujadas antes que
    // las montañas del horizonte, que las tapan.
    const mat = new THREE.PointsMaterial({ color: 0xffffff, size: 1.3, sizeAttenuation: false, transparent: false, blending: THREE.AdditiveBlending, opacity: 0, depthWrite: false, fog: false });
    mat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader.replace('#include <project_vertex>', '#include <project_vertex>\n  gl_Position.z = gl_Position.w;');
    };
    this.stars = new THREE.Points(g, mat);
    this.stars.frustumCulled = false;
    this.stars.renderOrder = -15;
    this.scene.add(this.stars);
  }

  /**
   * Resplandor de la ciudad en el cielo nocturno: el valle de Aburrá iluminado
   * con sodio tiñe de naranja pardo la bruma cerca del horizonte. Una cúpula
   * con degradado (aditiva, una sola llamada) entre el cielo y el horizonte.
   */
  _cityGlow() {
    const mat = new THREE.ShaderMaterial({
      uniforms: { uStrength: { value: 0 } },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize( position );
          gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
          gl_Position.z = gl_Position.w; // en el plano lejano, como el cielo
        }`,
      fragmentShader: /* glsl */ `
        uniform float uStrength;
        varying vec3 vDir;
        void main() {
          float h = max( vDir.y, 0.0 );
          // Fuerte en el horizonte, se apaga hacia los ~25°; un poco más hacia el sur y el occidente (el centro).
          float g = exp( -h * 9.0 ) * ( 0.75 + 0.25 * max( 0.0, -vDir.x * 0.6 + vDir.z * 0.4 ) );
          vec3 c = mix( vec3( 0.16, 0.12, 0.10 ), vec3( 0.55, 0.32, 0.16 ), exp( -h * 16.0 ) );
          gl_FragColor = vec4( c * g * uStrength, 1.0 );
        }`,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: true,
      side: THREE.BackSide,
      fog: false,
    });
    this.glow = new THREE.Mesh(new THREE.SphereGeometry(5000, 32, 12, 0, Math.PI * 2, 0, Math.PI / 2 + 0.05), mat);
    this.glow.frustumCulled = false;
    this.glow.renderOrder = -16; // después del cielo, antes de estrellas y montañas
    this.scene.add(this.glow);
  }

  /** El cielo estrellado acompaña a la cámara (está "en el infinito"). */
  followCamera(pos) {
    this.stars.position.copy(pos);
    this.glow.position.copy(pos);
  }

  get hours() {
    return Math.floor(this.timeOfDay);
  }

  get clockText() {
    const h = Math.floor(this.timeOfDay);
    const m = Math.floor((this.timeOfDay - h) * 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  setTime(h) {
    this.timeOfDay = ((h % 24) + 24) % 24;
    this.envTimer = 999;
  }

  _refreshEnv() {
    const u = this.envSky.material.uniforms;
    const su = this.sky.material.uniforms;
    for (const k of ['turbidity', 'rayleigh', 'mieCoefficient', 'mieDirectionalG']) u[k].value = su[k].value;
    u.sunPosition.value.copy(this.sunDir);
    // De día: HDRI fotográfico. Al atardecer y de noche: el cielo físico
    // (sigue la hora y el color del sol).
    if (this.dayEnv && this.night < 0.2 && this.sunDir.y > 0.18) {
      this.scene.environment = this.dayEnv;
      this.scene.environmentIntensity = 0.5;
      return;
    }
    if (this.envTarget) this.envTarget.dispose();
    this.envTarget = this.pmrem.fromScene(this.envScene, 0, 0.1, 2000);
    this.scene.environment = this.envTarget.texture;
    // De noche el cielo físico queda negro: bajamos la intensidad del entorno.
    this.scene.environmentIntensity = 0.2 + 0.35 * (1 - this.night);
  }

  update(dt, focus) {
    if (!this.paused) this.timeOfDay = (this.timeOfDay + (dt * this.timeScale) / 3600) % 24;
    // Medellín está cerca del ecuador: el sol sale ~6:00 y se pone ~18:00.
    // Oriente = +X en nuestro mapa (la montaña): el sol sale por detrás de ella
    // y se pone sobre la ladera occidental. Un poco inclinado hacia el sur.
    const a = ((this.timeOfDay - 6) / 12) * Math.PI;
    this.sunDir.set(Math.cos(a), Math.sin(a), 0.3).normalize();
    this.sky.material.uniforms.sunPosition.value.copy(this.sunDir);

    const dayF = smoothstep(-0.12, 0.25, this.sunDir.y);
    this.night = 1 - smoothstep(-0.18, 0.08, this.sunDir.y);
    const golden = 1 - smoothstep(0.05, 0.45, this.sunDir.y);

    const sunColor = new THREE.Color().setRGB(1, 0.93 - golden * 0.3, 0.85 - golden * 0.5);
    this.sun.color.copy(sunColor);
    this.sun.intensity = 2.7 * dayF;
    this.sun.position.copy(focus).addScaledVector(this.sunDir, 300);
    this.sun.target.position.copy(focus);
    // Estabiliza las sombras moviendo el objetivo en pasos de texel.
    const texel = (this.quality.shadowExtent * 2) / (this.quality.shadows || 1024);
    this.sun.target.position.x = Math.round(focus.x / texel) * texel;
    this.sun.target.position.z = Math.round(focus.z / texel) * texel;
    this.sun.position.copy(this.sun.target.position).addScaledVector(this.sunDir, 300);
    this.sun.target.updateMatrixWorld();

    this.moon.intensity = 0.75 * this.night;
    this.moon.position.copy(focus).add(new THREE.Vector3(-100, 220, 60));
    this.moon.target.position.copy(focus);
    this.moon.target.updateMatrixWorld();

    // De noche el cielo no es negro: la bruma del valle devuelve la luz de la
    // ciudad (azul grisáceo arriba, cálido desde el piso iluminado).
    const n = this.night;
    this.hemi.intensity = 0.12 + 0.38 * dayF + 0.42 * n;
    this.hemi.color.setRGB(0.55 + 0.2 * dayF - 0.05 * n, 0.65 + 0.2 * dayF - 0.03 * n, 0.9);
    this.hemi.groundColor.setRGB(0.28 * (0.3 + dayF) + 0.2 * n, 0.24 * (0.3 + dayF) + 0.12 * n, 0.2 * (0.3 + dayF) + 0.05 * n);
    this.glow.material.uniforms.uStrength.value = n;

    // Niebla: bruma dorada al atardecer, azul noche, neblina clara de día.
    const fog = this.scene.fog;
    const dayFog = new THREE.Color(0xbfcfda);
    const duskFog = new THREE.Color(0xe0a878);
    // Noche: bruma gris azulada con algo del naranja de la ciudad.
    const nightFog = new THREE.Color(0x232833);
    const c = dayFog.clone().lerp(duskFog, golden * dayF).lerp(nightFog, this.night);
    fog.color.copy(c);
    // Aire del valle: la misma bruma que usa el horizonte lejano (render/horizon.js),
    // así las laderas cercanas y las montañas se ven con la misma distancia.
    fog.density = 0.00018 + 0.0002 * golden;
    // Con la luz de la ciudad apenas se ven unas pocas estrellas.
    this.stars.material.opacity = clamp(this.night * 0.5, 0, 0.5);
    this.renderer.toneMappingExposure = (0.62 + 0.28 * dayF + 0.6 * this.night) * this.brightness;

    this.envTimer += dt;
    if (this.envTimer > 8) {
      this.envTimer = 0;
      this._refreshEnv();
    }
  }
}
