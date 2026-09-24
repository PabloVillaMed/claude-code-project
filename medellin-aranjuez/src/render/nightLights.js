// Iluminación nocturna dinámica con presupuesto fijo:
//  - Un grupo de N luces puntuales que se asignan a los faroles más cercanos
//    a la cámara (N según la calidad). El número de luces nunca cambia
//    durante el juego (así no se recompilan shaders al anochecer); de día se
//    apagan con `visible` y las dos variantes se precompilan en la carga.
//  - Un foco real con los faros del vehículo del jugador.
//  - Manchas de luz de los faros de todo el tráfico sobre el asfalto
//    (cuadros aditivos instanciados: prácticamente gratis).

import * as THREE from 'three';
import { groundHeight } from '../sim/terrain.js';

const LAMP_COLOR = 0xffc68a;
const MAX_POOLS = 48;

function headlightTexture() {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 256;
  const ctx = c.getContext('2d');
  // Haz alargado: fuerte cerca del carro (abajo) y difuso a lo lejos.
  const g = ctx.createRadialGradient(64, 250, 4, 64, 190, 190);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.45)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

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
      const l = new THREE.PointLight(LAMP_COLOR, 0, 24, 1.7);
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
    // Manchas de luz de los faros en el asfalto.
    const geo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    this.poolMat = new THREE.MeshBasicMaterial({ map: headlightTexture(), color: 0xfff0d8, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -6, fog: true });
    this.pools = new THREE.InstancedMesh(geo, this.poolMat, MAX_POOLS);
    this.pools.count = 0;
    this.pools.frustumCulled = false;
    this.pools.renderOrder = 2;
    scene.add(this.pools);
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._p = new THREE.Vector3();
    this._s = new THREE.Vector3();
    this._up = new THREE.Vector3(0, 1, 0);
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
    if (!this.on) {
      this.pools.count = 0;
      return;
    }
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
        if (idx !== undefined) this.lights[k].position.set(heads[idx].x, heads[idx].y, heads[idx].z);
      }
    }
    for (let k = 0; k < this.count; k++) {
      const l = this.lights[k];
      const target = this.assign[k] >= 0 ? 1 : 0;
      l.userData.level += (target - l.userData.level) * Math.min(1, dt * 3);
      const park = this.assign[k] >= 0 && this.heads[this.assign[k]].park;
      l.intensity = night * l.userData.level * (park ? 14 : 30);
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
        this.spot.intensity = 60 * night;
      } else this.spot.intensity = 0;
    }
    // Manchas de luz de los faros.
    let n = 0;
    for (const v of vehicles) {
      if (n >= MAX_POOLS) break;
      const s = v.state;
      if (s.destroyed || (v.driver !== 'npc' && v.driver !== 'player' && !v.chasing)) continue;
      if ((s.x - camPos.x) ** 2 + (s.z - camPos.z) ** 2 > 140 * 140) continue;
      const moto = v.type === 'moto';
      const len = moto ? 9 : 13;
      const wid = moto ? 3.2 : 5.2;
      const fx = -Math.sin(s.heading);
      const fz = -Math.cos(s.heading);
      const d = s.spec.length / 2 + len / 2 - 0.5;
      const x = s.x + fx * d;
      const z = s.z + fz * d;
      this._p.set(x, groundHeight(x, z) + 0.06, z);
      this._q.setFromAxisAngle(this._up, s.heading);
      this._s.set(wid, 1, len);
      this.pools.setMatrixAt(n++, this._m.compose(this._p, this._q, this._s));
    }
    this.pools.count = n;
    this.pools.instanceMatrix.needsUpdate = true;
    this.poolMat.opacity = 0.32 * night;
  }
}
