// Cielo (render/sky.js: dispersión horneada, nubes, luna y estrellas), sol
// con sombras que siguen al jugador, ciclo día/noche, niebla atmosférica del
// valle y reflejos (PMREM) del cielo.

import * as THREE from 'three';
import { smoothstep } from '../sim/math.js';
import { sunDirection, moonDirection, cloudCover, sunMoved } from '../sim/sky.js';
import { dayEnvironment } from './photoMaterials.js';
import { SkyDome } from './sky.js';

// ------------------------------------------------------------------ configurables
/**
 * Pase de sombras del sol: de noche el sol queda en intensidad 0 pero el mapa
 * de sombras (4096² en Alta) se seguía dibujando cada cuadro sin aportar nada
 * (en la 92 de noche era ~30 % del cuadro). Con la intensidad por debajo de
 * SOMBRA_SOL_APAGA el mapa deja de actualizarse (shadow.autoUpdate = false) y
 * vuelve por encima de SOMBRA_SOL_PRENDE (la diferencia es la histéresis: no
 * titila al amanecer). No se toca castShadow: el número de luces con sombra
 * es parte de la clave de los programas y cambiarlo los recompilaría todos.
 */
export const SOMBRA_SOL_APAGA = 0.02;
export const SOMBRA_SOL_PRENDE = 0.05;

// Colores de la niebla (fijos) y temporales reciclados: nada se crea por cuadro.
const FOG_DIA = new THREE.Color(0xbfcfda);
const FOG_TARDE = new THREE.Color(0xe0a878);
const FOG_NOCHE = new THREE.Color(0x232833); // bruma gris azulada con algo del naranja de la ciudad
const _fog = new THREE.Color();
const LUNA_OFFSET = new THREE.Vector3(-100, 220, 60);

export class Environment {
  constructor(renderer, scene, quality) {
    this.renderer = renderer;
    this.scene = scene;
    this.quality = quality;
    this.timeOfDay = 16.5; // 4:30 p. m. — luz dorada
    this.timeScale = 60; // 1 minuto real = 1 hora de juego
    this.paused = false;
    this.brightness = 1; // ajuste del jugador (multiplica la exposición)

    // Nubosidad del día (cambia un poco de un día al otro, ver sim/sky.js cloudCover).
    this.day = 0.5;
    this.skyDome = new SkyDome(renderer, { skyLow: !!quality.skyLow });
    scene.add(this.skyDome.mesh);

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
    this.envTarget = null;
    this.envSun = null; // sol con el que se hicieron los reflejos
    this.envNight = -1;
    this.envRefreshes = 0;
    // HDRI real (Poly Haven, CC0) para la luz ambiental y reflejos de día.
    this.dayEnv = dayEnvironment(this.pmrem);
    this.sunDir = new THREE.Vector3();
    this.moonDir = new THREE.Vector3();
    this.night = 0;
    this.cover = 0.4;
    this.update(0, new THREE.Vector3());
    this._refreshEnv();
  }

  /** Objetos del cielo (para medir su costo aparte). */
  skyObjects() {
    return [this.skyDome.mesh];
  }

  /** La cúpula no necesita seguir a la cámara (usa solo la rotación de la vista). */
  followCamera() {}

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
    this.envSun = null; // reflejos al día con la nueva hora
  }

  _refreshEnv() {
    this.envSun = this.sunDir.clone();
    this.envNight = this.night;
    // De día: HDRI fotográfico. Al atardecer y de noche: el mismo cielo horneado
    // (textura equirectangular pequeña: el PMREM sale mucho más barato que
    // volver a dibujar un cielo completo en un cubo).
    if (this.dayEnv && this.night < 0.2 && this.sunDir.y > 0.18) {
      this.scene.environment = this.dayEnv;
      this.scene.environmentIntensity = 0.5;
      return;
    }
    this.skyDome.bake(this.sunDir);
    this.envTarget = this.pmrem.fromEquirectangular(this.skyDome.lut.texture, this.envTarget);
    this.envRefreshes++;
    this.scene.environment = this.envTarget.texture;
    // De noche el cielo queda casi negro: bajamos la intensidad del entorno.
    this.scene.environmentIntensity = 0.2 + 0.35 * (1 - this.night);
  }

  update(dt, focus) {
    if (!this.paused) {
      const t = this.timeOfDay + (dt * this.timeScale) / 3600;
      // Día nuevo, cielo nuevo: unos días amanecen más nublados que otros.
      if (t >= 24) this.day = Math.random();
      this.timeOfDay = t % 24;
    }
    // Medellín está cerca del ecuador: el sol sale ~6:00 y se pone ~18:00.
    // Oriente = +X en nuestro mapa (la montaña): el sol sale por detrás de ella
    // y se pone sobre la ladera occidental. Un poco inclinado hacia el sur.
    const sd = sunDirection(this.timeOfDay);
    this.sunDir.set(sd.x, sd.y, sd.z);
    const md = moonDirection(this.timeOfDay);
    this.moonDir.set(md.x, md.y, md.z);

    const dayF = smoothstep(-0.12, 0.25, this.sunDir.y);
    this.night = 1 - smoothstep(-0.18, 0.08, this.sunDir.y);
    const golden = 1 - smoothstep(0.05, 0.45, this.sunDir.y);

    this.sun.color.setRGB(1, 0.93 - golden * 0.3, 0.85 - golden * 0.5);
    this.sun.intensity = 2.7 * dayF;
    // Sin sol no se dibuja su mapa de sombras (ver SOMBRA_SOL_APAGA).
    if (this.sun.castShadow) {
      const sh = this.sun.shadow;
      if (sh.autoUpdate && this.sun.intensity < SOMBRA_SOL_APAGA) sh.autoUpdate = false;
      else if (!sh.autoUpdate && this.sun.intensity > SOMBRA_SOL_PRENDE) {
        sh.autoUpdate = true;
        sh.needsUpdate = true;
      }
    }
    this.sun.position.copy(focus).addScaledVector(this.sunDir, 300);
    this.sun.target.position.copy(focus);
    // Estabiliza las sombras moviendo el objetivo en pasos de texel.
    const texel = (this.quality.shadowExtent * 2) / (this.quality.shadows || 1024);
    this.sun.target.position.x = Math.round(focus.x / texel) * texel;
    this.sun.target.position.z = Math.round(focus.z / texel) * texel;
    this.sun.position.copy(this.sun.target.position).addScaledVector(this.sunDir, 300);
    this.sun.target.updateMatrixWorld();

    this.moon.intensity = 0.55 * this.night;
    this.moon.position.copy(focus).add(LUNA_OFFSET);
    this.moon.target.position.copy(focus);
    this.moon.target.updateMatrixWorld();

    // De noche el cielo no es negro: la bruma del valle devuelve la luz de la
    // ciudad (azul grisáceo arriba, cálido desde el piso iluminado).
    const n = this.night;
    this.hemi.intensity = 0.12 + 0.38 * dayF + 0.28 * n;
    this.hemi.color.setRGB(0.55 + 0.2 * dayF - 0.05 * n, 0.65 + 0.2 * dayF - 0.03 * n, 0.9);
    this.hemi.groundColor.setRGB(0.28 * (0.3 + dayF) + 0.2 * n, 0.24 * (0.3 + dayF) + 0.12 * n, 0.2 * (0.3 + dayF) + 0.05 * n);

    // Niebla: bruma dorada al atardecer, azul noche, neblina clara de día.
    const fog = this.scene.fog;
    const c = _fog.copy(FOG_DIA).lerp(FOG_TARDE, golden * dayF).lerp(FOG_NOCHE, this.night);
    fog.color.copy(c);
    // Aire del valle: la misma bruma que usa el horizonte lejano (render/horizon.js),
    // así las laderas cercanas y las montañas se ven con la misma distancia.
    fog.density = 0.00018 + 0.0002 * golden;
    // Cielo: nubosidad según la hora (mañanas despejadas, tardes de cúmulos).
    this.cover = cloudCover(this.timeOfDay, this.day);
    const h = this.timeOfDay;
    const cirrus = 0.35 + 0.45 * (1 - smoothstep(9, 13, h)) * smoothstep(5, 7, h);
    const sky = (this._skyArgs ??= { sunDir: this.sunDir, moonDir: this.moonDir, night: 0, cover: 0, cirrus: 0, fog: c, dt: 0 });
    sky.night = this.night;
    sky.cover = this.cover;
    sky.cirrus = cirrus;
    sky.dt = dt;
    this.skyDome.update(sky);
    this.renderer.toneMappingExposure = (0.62 + 0.28 * dayF + 0.6 * this.night) * this.brightness;

    // Reflejos: solo si el sol se movió de verdad (o cambió la noche); con el
    // HDRI de día no hay nada que rehacer.
    const wantDay = !!this.dayEnv && this.night < 0.2 && this.sunDir.y > 0.18;
    const usingDay = this.scene.environment === this.dayEnv;
    if (!this.envSun || wantDay !== usingDay || (!wantDay && (sunMoved(this.envSun, this.sunDir, 2) || Math.abs(this.night - this.envNight) > 0.08))) this._refreshEnv();
  }
}
