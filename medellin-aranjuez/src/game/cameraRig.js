// Cámara en tercera persona: órbita con el ratón, hombro al apuntar (X cambia
// de hombro), primera persona opcional a pie, cámara de persecución en
// vehículos, suavizado ajustable, colisión con edificios y temblor.

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

/** Vistas a pie (V las recorre): normal, lejos, cerca y, si se activa, primera persona. */
export const FOOT_VIEWS = ['normal', 'lejos', 'cerca', 'primera'];

/** Vistas a pie disponibles según la configuración. */
export function footViews(firstPerson) {
  return firstPerson ? FOOT_VIEWS : FOOT_VIEWS.slice(0, 3);
}

/**
 * Distancia, altura y desplazamiento lateral de la cámara a pie. `side` es
 * 1 (hombro derecho) o -1 (izquierdo).
 */
export function footCamera(view, { aiming = false, sprinting = false, crouching = false, side = 1 } = {}) {
  if (view === 'primera') {
    // Ojos del personaje (un poco adelante para no ver el interior de la cabeza).
    return { dist: 0, height: crouching ? 1.12 : 1.62, shoulder: 0, fovAdd: aiming ? -10 : sprinting ? 4 : 0, first: true, ahead: 0.3 };
  }
  if (aiming) return { dist: 2.5, height: 1.6, shoulder: 0.78 * side, fovAdd: -12, first: false, ahead: 0 };
  const dist = { normal: 4.2, lejos: 6, cerca: 2.8 }[view] ?? 4.2;
  // Un poco corrida al hombro: el personaje no tapa el centro de la pantalla.
  return { dist, height: 1.55, shoulder: (view === 'cerca' ? 0.42 : 0.3) * side, fovAdd: sprinting ? 5 : 0, first: false, ahead: 0 };
}

/**
 * Suavizado de la cámara (0 rígida … 1 muy suave; 0,5 es el de siempre):
 * factor que multiplica la rapidez con que la cámara alcanza al jugador.
 */
export function smoothingFactor(s) {
  const v = Number.isFinite(s) ? Math.min(1, Math.max(0, s)) : 0.5;
  return Math.pow(2, (0.5 - v) * 2.4);
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
    this.zoomLevel = 0; // vista a pie (FOOT_VIEWS)
    this.firstPersonEnabled = false; // configuración: incluir la primera persona en V
    this.side = 1; // 1 hombro derecho, -1 izquierdo (X)
    this.shoulderCur = 0; // desplazamiento lateral suavizado
    this.smoothing = 0.5; // configuración: suavizado (smoothingFactor)
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

  /** V: a pie alterna distancias (y la primera persona si está activa); en vehículo, cerca / lejos / capó (en moto, sobre el hombro). */
  cycleZoom() {
    if (this.inVehicle) this.vehicleView = (this.vehicleView + 1) % VEHICLE_VIEWS.length;
    else this.zoomLevel = (this.zoomLevel + 1) % footViews(this.firstPersonEnabled).length;
  }

  /** X: cambia la cámara de hombro. */
  swapShoulder() {
    this.side = -this.side;
  }

  /** Vista de vehículo por defecto (configuración). */
  setVehicleView(name) {
    const i = VEHICLE_VIEWS.indexOf(name);
    if (i >= 0) this.vehicleView = i;
  }

  /** Activa o quita la primera persona de las vistas a pie. */
  setFirstPerson(on) {
    this.firstPersonEnabled = !!on;
    if (this.zoomLevel >= footViews(this.firstPersonEnabled).length) this.zoomLevel = 0;
  }

  get vehicleViewName() {
    return VEHICLE_VIEWS[this.vehicleView];
  }

  get footViewName() {
    return footViews(this.firstPersonEnabled)[this.zoomLevel] ?? 'normal';
  }

  /** ¿La cámara está en los ojos del personaje? (a pie, vista primera persona) */
  get firstPerson() {
    return !this.inVehicle && this.footViewName === 'primera';
  }

  /**
   * ctx = {x,y,z, inVehicle, vehicleHeading, vehicleSpeed, vehicleSize, moto,
   * aiming, sprinting, crouching, lookBehind, lookX, lookY}
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
    let eyes = false;
    let eyeAhead = 0;
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
        this.yaw = dampAngle(this.yaw, behind, Math.min(6, 2.2 + sp * 0.12) * Math.sqrt(smoothingFactor(this.smoothing)), dt);
        this.pitch = damp(this.pitch, -0.16 - Math.min(0.06, sp / 400), 2.5, dt);
      }
      fov += Math.min(hood ? 8 : 12, sp * 0.3);
    } else {
      const fc = footCamera(this.footViewName, { aiming: !!ctx.aiming, sprinting: !!ctx.sprinting, crouching: !!ctx.crouching, side: this.side });
      dist = fc.dist;
      height = fc.height;
      shoulder = fc.shoulder;
      fov += fc.fovAdd;
      eyes = fc.first;
      eyeAhead = fc.ahead;
    }
    // Al cambiar a la vista de capó o a la primera persona (o salir de ellas) el salto es inmediato.
    const snap = hood || eyes;
    if (snap !== this.snapView) {
      this.snapView = snap;
      this.hood = hood;
      this.first = true;
      this.dist = dist;
      this.shoulderCur = shoulder;
    }
    this.hood = hood;
    this.shoulderCur = damp(this.shoulderCur, shoulder, 10, dt);
    this.dist = damp(this.dist, dist, 8, dt);
    this.fov = damp(this.fov, fov, 8, dt);

    // Capó: el pivote va adelante, sobre el vehículo, en la dirección en que apunta.
    const h = ctx.vehicleHeading ?? 0;
    this.target.set(ctx.x - Math.sin(h) * ahead, ctx.y + height, ctx.z - Math.cos(h) * ahead);
    if (this.first) {
      this.smoothedTarget.copy(this.target);
      this.first = false;
    }
    const lerpK = snap ? 60 : (ctx.inVehicle ? 14 : 22) * smoothingFactor(this.smoothing);
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
    const sh = this.shoulderCur;
    const pivot = new THREE.Vector3(t.x, t.y, t.z);
    // Colisión: el hombro no puede meterse en una pared (junto a un muro, la
    // cámara vuelve al centro)...
    if (Math.abs(sh) > 0.01) {
      const sd = Math.sign(sh);
      const hs = this.collision.raycast(t.x, t.y, t.z, rx * sd, 0, rz * sd, Math.abs(sh) + 0.25);
      const s2 = hs ? Math.max(0, hs.t - 0.25) * sd : sh;
      pivot.x += rx * s2;
      pivot.z += rz * s2;
    }
    let d = this.dist;
    if (eyes) {
      // Primera persona: un poco adelante de los ojos (en horizontal: al mirar
      // abajo se ve el cuerpo desde afuera), sin atravesar la pared de enfrente.
      const hx = -Math.sin(yaw);
      const hz = -Math.cos(yaw);
      const he = this.collision.raycast(pivot.x, pivot.y, pivot.z, hx, 0, hz, eyeAhead + 0.2);
      const a = he ? Math.max(0, he.t - 0.2) : eyeAhead;
      this.pos.set(pivot.x + hx * a, pivot.y, pivot.z + hz * a);
    } else {
      if (!hood) {
        // ...y acercar la cámara si una pared se interpone.
        const hit = this.collision.raycast(pivot.x, pivot.y, pivot.z, -fx, -fy, -fz, d + 0.3);
        if (hit) d = Math.max(0.6, hit.t - 0.3);
      }
      this.pos.set(pivot.x - fx * d, pivot.y - fy * d, pivot.z - fz * d);
    }
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
