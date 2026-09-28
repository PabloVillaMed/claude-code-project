// Cámara en tercera persona: órbita con el ratón, hombro al apuntar, cámara de
// persecución en vehículos, colisión con edificios y temblor.

import * as THREE from 'three';
import { clamp, damp, dampAngle, wrapAngle } from '../sim/math.js';
import { groundHeight } from '../sim/terrain.js';

/** Vistas de vehículo (V las recorre): persecución cerca (por defecto), lejos y capó. */
export const VEHICLE_VIEWS = ['cerca', 'lejos', 'capo'];

/**
 * Distancia, altura y avance del pivote de la cámara de vehículo según la
 * vista, el largo del vehículo `s` (m), la rapidez `sp` (m/s) y si es moto.
 */
export function vehicleCamera(view, s, sp, moto) {
  const fast = 1 + Math.min(0.18, sp / 150); // un poco más atrás a alta velocidad
  if (view === 'lejos') return { dist: (s * 1.55 + 3) * fast, height: 1.2 + s * 0.22, ahead: 0 };
  if (view === 'capo') {
    // En moto no hay capó: sobre el hombro del piloto, muy cerca.
    if (moto) return { dist: 1.7, height: 1.45, ahead: 0 };
    return { dist: 0.05, height: 1.05 + s * 0.04, ahead: s * 0.28, hood: true };
  }
  // Cerca: el vehículo ocupa buena parte de la pantalla, como en los juegos de mundo abierto.
  return { dist: (moto ? 2.9 : s * 0.95 + 2.3) * fast, height: moto ? 1.35 : 0.95 + s * 0.17, ahead: 0 };
}

export class CameraRig {
  constructor(camera, collision) {
    this.camera = camera;
    this.collision = collision;
    this.yaw = 0;
    this.pitch = -0.12;
    this.dist = 4.2;
    this.fov = 65;
    this.baseFov = 65;
    this.shakeAmt = 0;
    this.recoil = 0;
    this.idleLook = 0;
    this.mode = 'foot';
    this.zoomLevel = 1; // V alterna distancias
    this.vehicleView = 0; // vista del vehículo (VEHICLE_VIEWS)
    this.inVehicle = false;
    this.pos = new THREE.Vector3();
    this.target = new THREE.Vector3();
    this.smoothedTarget = new THREE.Vector3();
    this.first = true;
  }

  kick(a) {
    this.recoil += a;
  }

  shake(a) {
    this.shakeAmt = Math.max(this.shakeAmt, a);
  }

  /** V: a pie alterna tres distancias; en vehículo, cerca / lejos / capó (en moto, sobre el hombro). */
  cycleZoom() {
    if (this.inVehicle) this.vehicleView = (this.vehicleView + 1) % VEHICLE_VIEWS.length;
    else this.zoomLevel = (this.zoomLevel + 1) % 3;
  }

  get vehicleViewName() {
    return VEHICLE_VIEWS[this.vehicleView];
  }

  /**
   * ctx = {x,y,z, inVehicle, vehicleHeading, vehicleSpeed, vehicleSize,
   * aiming, sprinting, lookBehind, lookX, lookY}
   */
  update(dt, ctx) {
    const hasLook = Math.abs(ctx.lookX) + Math.abs(ctx.lookY) > 1e-4;
    this.yaw = wrapAngle(this.yaw - ctx.lookX);
    this.pitch = clamp(this.pitch - ctx.lookY - this.recoil, -1.25, 0.9);
    this.recoil = damp(this.recoil, 0, 18, dt);
    if (hasLook) this.idleLook = 0;
    else this.idleLook += dt;

    let dist;
    let height;
    let shoulder = 0;
    let fov = this.baseFov;
    let ahead = 0;
    let hood = false;
    this.inVehicle = !!ctx.inVehicle;
    if (ctx.inVehicle) {
      const s = ctx.vehicleSize;
      const sp = Math.abs(ctx.vehicleSpeed);
      const vc = vehicleCamera(VEHICLE_VIEWS[this.vehicleView], s, sp, !!ctx.moto);
      dist = vc.dist;
      height = vc.height;
      ahead = vc.ahead;
      hood = !!vc.hood;
      // Volver detrás del vehículo si no se mueve el ratón: más rápido cuanto
      // más rápido se va (y mirando hacia donde derrapa: vehicleHeading).
      if (hood) {
        // Desde el capó se mira siempre hacia adelante (el ratón mira un poco a los lados).
        this.yaw = dampAngle(this.yaw, ctx.vehicleHeading, this.idleLook > 0.4 ? 10 : 3, dt);
        this.pitch = damp(this.pitch, -0.06, 4, dt);
      } else if (this.idleLook > 0.6 && sp > 2) {
        const behind = ctx.vehicleSpeed >= 0 ? ctx.vehicleHeading : ctx.vehicleHeading + Math.PI;
        this.yaw = dampAngle(this.yaw, behind, Math.min(6, 2.2 + sp * 0.12), dt);
        this.pitch = damp(this.pitch, -0.16 - Math.min(0.06, sp / 400), 2.5, dt);
      }
      fov += Math.min(hood ? 8 : 12, sp * 0.3);
    } else {
      dist = [4.2, 6, 2.8][this.zoomLevel];
      height = 1.55;
      if (ctx.aiming) {
        dist = 2.5;
        shoulder = 0.78;
        fov = this.baseFov - 12;
        height = 1.6;
      } else if (ctx.sprinting) {
        fov += 5;
      }
    }
    // Al cambiar a la vista de capó (o salir de ella) el salto es inmediato.
    if (hood !== this.hood) {
      this.hood = hood;
      this.first = true;
      this.dist = dist;
    }
    this.dist = damp(this.dist, dist, 8, dt);
    this.fov = damp(this.fov, fov, 8, dt);

    // Capó: el pivote va adelante, sobre el vehículo, en la dirección en que apunta.
    const h = ctx.vehicleHeading ?? 0;
    this.target.set(ctx.x - Math.sin(h) * ahead, ctx.y + height, ctx.z - Math.cos(h) * ahead);
    if (this.first) {
      this.smoothedTarget.copy(this.target);
      this.first = false;
    }
    const lerpK = hood ? 60 : ctx.inVehicle ? 14 : 22;
    this.smoothedTarget.x = damp(this.smoothedTarget.x, this.target.x, lerpK, dt);
    this.smoothedTarget.y = damp(this.smoothedTarget.y, this.target.y, lerpK * 0.6, dt);
    this.smoothedTarget.z = damp(this.smoothedTarget.z, this.target.z, lerpK, dt);

    const yaw = ctx.lookBehind && ctx.inVehicle ? this.yaw + Math.PI : this.yaw;
    const cp = Math.cos(this.pitch);
    const fx = -Math.sin(yaw) * cp;
    const fy = Math.sin(this.pitch);
    const fz = -Math.cos(yaw) * cp;
    const rx = Math.cos(yaw);
    const rz = -Math.sin(yaw);
    const t = this.smoothedTarget;
    const pivot = new THREE.Vector3(t.x + rx * shoulder, t.y, t.z + rz * shoulder);
    // Colisión: acercar la cámara si una pared se interpone.
    let d = this.dist;
    const hit = hood ? null : this.collision.raycast(pivot.x, pivot.y, pivot.z, -fx, -fy, -fz, d + 0.3);
    if (hit) d = Math.max(0.6, hit.t - 0.3);
    this.pos.set(pivot.x - fx * d, pivot.y - fy * d, pivot.z - fz * d);
    const gh = groundHeight(this.pos.x, this.pos.z) + 0.35;
    if (this.pos.y < gh) this.pos.y = gh;

    // Temblor.
    if (this.shakeAmt > 0.001) {
      this.pos.x += (Math.random() - 0.5) * this.shakeAmt;
      this.pos.y += (Math.random() - 0.5) * this.shakeAmt;
      this.pos.z += (Math.random() - 0.5) * this.shakeAmt;
      this.shakeAmt = damp(this.shakeAmt, 0, 5, dt);
    }
    this.camera.position.copy(this.pos);
    this.camera.lookAt(pivot.x + fx * 10, pivot.y + fy * 10, pivot.z + fz * 10);
    if (Math.abs(this.camera.fov - this.fov) > 0.01) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }
  }

  /** Rayo de puntería por el centro de la pantalla. */
  aimRay() {
    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);
    const o = this.camera.position;
    return { origin: { x: o.x, y: o.y, z: o.z }, dir: { x: dir.x, y: dir.y, z: dir.z } };
  }
}
