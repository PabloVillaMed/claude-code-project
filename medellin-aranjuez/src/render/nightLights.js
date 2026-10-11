// Iluminación nocturna dinámica con presupuesto fijo:
//  - Un grupo de N luces puntuales que se asignan a los faroles más cercanos
//    a la cámara (N según la calidad). El número de luces nunca cambia
//    durante el juego (así no se recompilan shaders al anochecer); de día se
//    apagan con `visible` y las dos variantes se precompilan en la carga.
//  - Un foco real con los faros del vehículo del jugador.
//  - La luz de todos los faroles cercanos y de los faros del tráfico sobre el
//    piso y los muros se calcula en los shaders (render/groundLights.js).

import * as THREE from 'three';
import { groundHeight } from '../sim/terrain.js';
import { groundLights, lampColor } from './groundLights.js';

export class NightLights {
  constructor(scene, quality, lampHeads = []) {
    this.scene = scene;
    this.heads = lampHeads;
    this.count = Math.min(quality.lampLights ?? 0, lampHeads.length);
    this.lights = [];
    this.assign = new Array(this.count).fill(-1);
    this.timer = 0;
    this.on = true;
    for (let i = 0; i < this.count; i++) {
      const l = new THREE.PointLight(0xffc68a, 0, 24, 1.7);
      l.userData.level = 0;
      scene.add(l);
      this.lights.push(l);
    }
    // Faros del jugador.
    this.spot = null;
    if (quality.headlight) {
      this.spot = new THREE.SpotLight(0xfff1dc, 0, 55, 0.48, 0.55, 1.4);
      this.spot.castShadow = !!quality.headlightShadow;
      if (this.spot.castShadow) this.spot.shadow.mapSize.set(1024, 1024);
      scene.add(this.spot, this.spot.target);
    }
    // Número de haces de faros activos en groundLights (pruebas: __game.lights().pools).
    this.pools = { count: 0 };
    this._lampScale = (i) => {
      // Un farol que ya tiene PointLight real ilumina el piso con ella: la luz
      // del shader se reduce para no sumarlas (con transición suave).
      const k = this.assign.indexOf(i);
      return k < 0 ? 1 : 1 - 0.65 * this.lights[k].userData.level;
    };
  }

  /** Enciende/apaga el grupo (cambia la variante de shaders: ambas se precompilan). */
  setEnabled(on) {
    if (this.on === on) return;
    this.on = on;
    for (const l of this.lights) l.visible = on;
    if (this.spot) this.spot.visible = on;
  }

  update(dt, camPos, night, vehicles, playerVehicle) {
    this.setEnabled(night > 0.04);
    groundLights.update(camPos, this.heads, vehicles, night, { lampScale: this._lampScale });
    this.pools.count = groundLights.uniforms.uGLBeamPos.value.filter((p) => p.w > 0).length;
    if (!this.on) return;
    // Reasignar los faroles más cercanos cada 0.3 s (conservando los que siguen cerca).
    this.timer -= dt;
    if (this.timer <= 0 && this.count) {
      this.timer = 0.3;
      const heads = this.heads;
      const d2 = heads.map((h, i) => [(h.x - camPos.x) ** 2 + (h.z - camPos.z) ** 2, i]);
      d2.sort((a, b) => a[0] - b[0]);
      const want = new Set(d2.slice(0, this.count).map((e) => e[1]));
      const keep = new Set();
      for (let k = 0; k < this.count; k++) if (want.has(this.assign[k])) keep.add(this.assign[k]);
      const free = [...want].filter((i) => !keep.has(i));
      for (let k = 0; k < this.count; k++) {
        if (keep.has(this.assign[k])) continue;
        const idx = free.pop();
        this.assign[k] = idx ?? -1;
        this.lights[k].userData.level = 0; // entra desde apagada: sin saltos
        if (idx !== undefined) {
          this.lights[k].position.set(heads[idx].x, heads[idx].y, heads[idx].z);
          lampColor(heads[idx], this.lights[k].color); // sodio o LED, como su luz en el piso
        }
      }
    }
    for (let k = 0; k < this.count; k++) {
      const l = this.lights[k];
      const target = this.assign[k] >= 0 ? 1 : 0;
      l.userData.level += (target - l.userData.level) * Math.min(1, dt * 3);
      const park = this.assign[k] >= 0 && this.heads[this.assign[k]].park;
      l.intensity = night * l.userData.level * (park ? 12 : 24);
    }
    // Foco de los faros del jugador.
    if (this.spot) {
      if (playerVehicle && night > 0.2) {
        const s = playerVehicle.state;
        const fx = -Math.sin(s.heading);
        const fz = -Math.cos(s.heading);
        const half = s.spec.length / 2;
        this.spot.position.set(s.x + fx * half, s.y + 0.8, s.z + fz * half);
        this.spot.target.position.set(s.x + fx * (half + 18), groundHeight(s.x + fx * 18, s.z + fz * 18), s.z + fz * (half + 18));
        this.spot.target.updateMatrixWorld();
        this.spot.intensity = 14 * night; // el piso lo iluminan los haces de groundLights; esto es para personas y carros
      } else this.spot.intensity = 0;
    }
  }
}
