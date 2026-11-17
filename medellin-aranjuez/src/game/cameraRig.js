// Cámara en tercera persona: órbita con el ratón, hombro al apuntar (X cambia
// de hombro), primera persona opcional a pie, cámara de persecución en
// vehículos, suavizado ajustable, colisión con edificios y temblor.

import * as THREE from 'three';
import { clamp, damp, dampAngle, wrapAngle } from '../sim/math.js';
import { groundHeight } from '../sim/terrain.js';
import { BOARD_FP } from './boarding.js';

// ------------------------------------------- primera persona (ajustables)
// La cámara va en los ojos del propio personaje: sigue al hueso de la cabeza
// del esqueleto (Game.js lo pasa en ctx.head), no a la cápsula, porque al
// trotar y correr la animación baja la cabeza hasta 18 cm y la adelanta hasta
// 40 cm (con la cámara fija a la cápsula quedaba detrás y encima de la
// cabeza: se veían el cuello por dentro, los hombros y la espalda). Un resorte
// se come el cabeceo de cada paso y, al mirar abajo, los ojos giran con el
// cuello y se adelantan: se ven el pecho, las piernas y los pies desde donde
// se verían. La cabeza, lo que lleva puesto en ella y lo que cuelga del cuello
// no se dibujan para la cámara pero sí dan sombra (characterRig.setFirstPerson)
// y los brazos sostienen el arma frente a ella (characterRig.fpArms, con el
// estado `rig.fp` que se calcula aquí).
/** Sin esqueleto (muerto o el muñeco de respaldo): altura de los ojos (m) de pie y agachado. */
export const FP_EYE_HEIGHT = 1.62;
export const FP_EYE_HEIGHT_CROUCH = 1.12;
/** Sin esqueleto: cuánto va la cámara delante del eje del cuerpo (m). */
export const FP_EYE_AHEAD = 0.14;
/** Ojos respecto al hueso de la cabeza (m): arriba y adelante (un poco por delante de la cara oculta). */
export const FP_HEAD_EYE_UP = 0.085;
export const FP_HEAD_EYE_FWD = 0.11;
/** Fracción del cabeceo de la mirada que dobla el cuello: los ojos giran alrededor del hueso de la cabeza (abajo: adelante y abajo). */
export const FP_NECK_BEND = 0.6;
/** Mirando del todo abajo, la cámara se adelanta esto más (m): el cuello por dentro y el pecho quedan fuera del plano cercano. */
export const FP_DOWN_PUSH = 0.08;
/**
 * Resorte que sigue a la cabeza (rad/s, sin rebote): alto y adelante, y de
 * lado. Corriendo la cabeza sube y baja ~8 cm y va y viene ~14 cm en cada
 * paso; con 8 pasa ~1 cm. Más alto sigue más el paso (marea); más bajo se
 * atrasa al arrancar a correr.
 */
export const FP_HEAD_FOLLOW = 8;
export const FP_HEAD_FOLLOW_SIDE = 5;
/**
 * Atraso máximo (m) del resorte respecto a la cabeza: detrás de ella o por
 * encima / por debajo. Al arrancar a correr la cabeza se adelanta 35 cm en
 * 0,3 s y el resorte solo se quedaba atrás hasta 20 cm (mirando abajo se veía
 * el cuello por dentro); al pararse de agachado, igual hacia arriba.
 */
export const FP_HEAD_LAG = 0.06;
/** Cuánto del corrimiento lateral de la cabeza pasa a la cámara (0…1): el vaivén de lado al correr marea. */
export const FP_HEAD_SIDE = 0.5;
/** Tope de la mirada en primera persona (rad): abajo (casi vertical, con el cuello doblado no se mete al cuerpo) y arriba. */
export const FP_PITCH_MIN = -1.3;
export const FP_PITCH_MAX = 0.9;
/** Distancia mínima (m) de la cámara a la pared de enfrente (los ojos van adelante del eje del cuerpo). */
export const FP_WALL_GAP = 0.12;
/** Plano cercano (m) en primera persona (las manos quedan a 20-50 cm); en tercera persona, el de la cámara. */
export const FP_NEAR = 0.04;
/** Rapidez (1/s) con que el arma sube a la mira (ADS) o baja a la cadera (~0,25 s). */
export const FP_ADS_RATE = 12;
/** Cabeceo al caminar (m, a 5 m/s): del arma (vertical; la mitad hacia el lado) y de la cámara. */
export const FP_BOB_WEAPON = 0.03;
export const FP_BOB_CAMERA = 0.022;
/** Vaivén: el arma se atrasa al girar (m por rad/s de giro) hasta FP_SWAY_MAX (m). */
export const FP_SWAY = 0.012;
export const FP_SWAY_MAX = 0.045;
/** Retroceso del arma por unidad de `kick` (el mismo que levanta la cámara): hacia atrás (m) y cabeceo (rad). */
export const FP_KICK_BACK = 3;
export const FP_KICK_PITCH = 5;
/** Tope del retroceso acumulado (unidades de `kick`: la escopeta da 0,03 por tiro). */
export const FP_KICK_MAX = 0.035;
/** Una pared a menos de esto (m) delante de los ojos empieza a retraer el arma (del todo a FP_WALL_MIN). */
export const FP_WALL_REACH = 0.95;
export const FP_WALL_MIN = 0.3;

// ------------------------------------- subir / bajar de un vehículo (ajustable)
// Con la animación de subir / bajar (game/boarding.js cameraBlend: ctx.board)
// la cámara pasa suave de la de a pie, siguiendo al personaje que camina a la
// puerta, a la de persecución (y al revés al bajarse), sin saltos.
/** Cabeceo (rad) al que llega la cámara al terminar de subirse (un poco desde arriba, como al manejar). */
export const BOARD_CAM_PITCH = -0.15;

// ------------------------------------------ manejando (ajustables)
/** El campo de visión sube con la rapidez: grados por m/s, hasta VEH_FOV_MAX (VEH_FOV_MAX_HOOD desde el capó). */
export const VEH_FOV_PER_MS = 0.3;
export const VEH_FOV_MAX = 12;
export const VEH_FOV_MAX_HOOD = 8;
/**
 * En moto la cámara se ladea con la inclinación (fracción de la de la moto)
 * con rapidez CAM_ROLL_RATE (1/s). En 0 (por defecto desde v3.6) el horizonte
 * queda derecho: ladeado mareaba y estorbaba para ir centrado (v3.5: 0,3).
 */
export const CAM_MOTO_ROLL = 0;
export const CAM_ROLL_RATE = 5;

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
    return { dist: 0, height: crouching ? FP_EYE_HEIGHT_CROUCH : FP_EYE_HEIGHT, shoulder: 0, fovAdd: aiming ? -10 : sprinting ? 4 : 0, first: true, ahead: FP_EYE_AHEAD };
  }
  if (aiming) return { dist: 2.5, height: 1.6, shoulder: 0.78 * side, fovAdd: -12, first: false, ahead: 0 };
  const dist = { normal: 4.2, lejos: 6, cerca: 2.8 }[view] ?? 4.2;
  // Un poco corrida al hombro: el personaje no tapa el centro de la pantalla.
  return { dist, height: 1.55, shoulder: (view === 'cerca' ? 0.42 : 0.3) * side, fovAdd: sprinting ? 5 : 0, first: false, ahead: 0 };
}

/**
 * Primera persona: el hueso de la cabeza (dx, dy, dz: mundo, desde el pie de
 * la cápsula) en el marco del cuerpo con rumbo `yaw` (adelante = -Z girado).
 * Escribe [lado (derecha +), alto, adelante] en `out`.
 */
export function fpHeadLocal(dx, dy, dz, yaw, out) {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  out[0] = dx * c - dz * s;
  out[1] = dy;
  out[2] = -dx * s - dz * c;
  return out;
}

/**
 * Resorte críticamente amortiguado (sin rebote) del eje `i` de `pos` (con su
 * velocidad en `vel`) hacia `target`, con rapidez `w` (rad/s). Exacto para
 * cualquier dt (un cuadro largo no lo dispara).
 */
export function springAxis(pos, vel, i, target, w, dt) {
  const x = pos[i] - target;
  const e = Math.exp(-w * dt);
  const t = (vel[i] + w * x) * dt;
  vel[i] = (vel[i] - w * t) * e;
  pos[i] = target + (x + t) * e;
}

/**
 * La cabeza filtrada (`pos`, con su velocidad `vel`: [lado, alto, adelante])
 * no se queda más de FP_HEAD_LAG detrás de la de verdad (`raw`) ni por
 * encima o por debajo de ella: si el resorte se atrasa, se arrastra (los ojos
 * nunca quedan dentro del cuello). Adelante sí puede quedar: ahí no hay cuerpo.
 */
export function fpHeadLeash(pos, vel, raw) {
  if (pos[2] < raw[2] - FP_HEAD_LAG) {
    pos[2] = raw[2] - FP_HEAD_LAG;
    if (vel[2] < 0) vel[2] = 0;
  }
  if (pos[1] > raw[1] + FP_HEAD_LAG) {
    pos[1] = raw[1] + FP_HEAD_LAG;
    if (vel[1] > 0) vel[1] = 0;
  } else if (pos[1] < raw[1] - FP_HEAD_LAG) {
    pos[1] = raw[1] - FP_HEAD_LAG;
    if (vel[1] < 0) vel[1] = 0;
  }
}

/**
 * Primera persona: los ojos en el marco del cuerpo (m desde el pie de la
 * cápsula: [lado, alto, adelante] en `out`) a partir del hueso de la cabeza
 * (ya filtrado) y del cabeceo `pitch` de la mirada. Los ojos van
 * FP_HEAD_EYE_UP / FP_HEAD_EYE_FWD sobre y delante del hueso, giran con el
 * cuello (FP_NECK_BEND del cabeceo) y, mirando abajo, se adelantan hasta
 * FP_DOWN_PUSH más.
 */
export function fpEye(side, up, fwd, pitch, out) {
  const p = clamp(pitch, FP_PITCH_MIN, FP_PITCH_MAX);
  const a = p * FP_NECK_BEND;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const d = clamp(p / FP_PITCH_MIN, 0, 1); // 0 al frente o arriba … 1 del todo abajo
  out[0] = side;
  out[1] = up + FP_HEAD_EYE_FWD * s + FP_HEAD_EYE_UP * c;
  out[2] = fwd + FP_HEAD_EYE_FWD * c - FP_HEAD_EYE_UP * s + FP_DOWN_PUSH * d * d * (3 - 2 * d);
  return out;
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
    this.baseNear = camera.near;
    // Primera persona: lo que characterRig.fpArms necesita para el arma en
    // las manos (ads 0 cadera … 1 mira; bob/sway en m; kick; retract 0…1).
    this.fp = { ads: 0, bobPhase: 0, bobAmp: 0, bobX: 0, bobY: 0, swayX: 0, swayY: 0, kick: 0, kickBack: 0, kickPitch: 0, retract: 0 };
    // Primera persona con esqueleto: la cabeza filtrada ([lado, alto,
    // adelante] y su velocidad) y los ojos que salen de ella (fpEye).
    this.fpHead = { pos: [0, 0, 0], vel: [0, 0, 0], on: false };
    this.fpEye = [0, 0, 0];
    this._hl = [0, 0, 0];
    this._be = [0, 0, 0]; // (subiendo / bajando: los ojos respecto al hueso de la cabeza)
    this._pivot = new THREE.Vector3();
  }

  kick(a) {
    this.recoil += a;
    this.fp.kick = Math.min(this.fp.kick + a, FP_KICK_MAX);
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
   * ctx = {x,y,z, inVehicle, vehicleHeading, vehicleSpeed, vehicleSize, vehicleLean (moto, rad), moto,
   * aiming, sprinting, crouching, lookBehind, lookX, lookY, board, head, bodyYaw, simDt}
   * head (primera persona a pie): {x, y, z} del hueso de la cabeza en el
   * mundo, con bodyYaw el rumbo del cuerpo dibujado y simDt el paso del
   * juego (el de la animación); null = sin esqueleto.
   * board (subiendo / bajando, game/boarding.js cameraBlend): {w (0 a pie …
   * 1 en el vehículo), x, y, z del personaje animado, vx, vy, vz, heading,
   * size, moto del vehículo, enter} o null.
   */
  update(dt, ctx) {
    const hasLook = Math.abs(ctx.lookX) + Math.abs(ctx.lookY) > 1e-4;
    const B = ctx.board ?? null;
    // Primera persona subiendo / bajando: la cámara en los ojos (sin pasar a
    // tercera), siguiendo la cabeza con el cuello estable (game/boarding.js BOARD_FP).
    const E = B && B.head && this.footViewName === 'primera' ? B : null;
    if (E) {
      if (!this._fpb) this._fpb = { off: wrapAngle(this.yaw - E.bodyYaw), pitch: this.pitch, yaw: E.bodyYaw, x: E.hx, y: E.hy, z: E.hz };
      const fb = this._fpb;
      fb.off = wrapAngle(fb.off - ctx.lookX);
      if (!hasLook) fb.off = damp(fb.off, 0, 1.5, dt); // (sin ratón, vuelve a mirar al frente del cuerpo)
      fb.pitch = clamp(fb.pitch - ctx.lookY, -1.25, 0.9);
      fb.yaw = dampAngle(fb.yaw, E.bodyYaw, BOARD_FP.turn, dt);
      const k = 1 - Math.exp(-BOARD_FP.follow * dt);
      fb.x += (E.hx - fb.x) * k;
      fb.y += (E.hy - fb.y) * k;
      fb.z += (E.hz - fb.z) * k;
      const ey = wrapAngle(fb.yaw + fb.off);
      this.yaw = wrapAngle(ey + wrapAngle(E.heading - ey) * E.fpW);
      this.pitch = fb.pitch + (BOARD_CAM_PITCH - fb.pitch) * E.fpW;
      this._board = null;
    } else this._fpb = null;
    if (E) {
      // (rumbo y cabeceo ya puestos arriba)
    } else if (B?.enter) {
      // Subiéndose: la órbita va sola hasta detrás del vehículo, a la par de
      // la animación (el ratón corre la órbita de partida).
      if (!this._board) this._board = { yaw: this.yaw, pitch: this.pitch };
      const bs = this._board;
      bs.yaw = wrapAngle(bs.yaw - ctx.lookX);
      bs.pitch = clamp(bs.pitch - ctx.lookY, -1.25, 0.9);
      this.yaw = wrapAngle(bs.yaw + wrapAngle(B.heading - bs.yaw) * B.w);
      this.pitch = bs.pitch + (BOARD_CAM_PITCH - bs.pitch) * B.w;
    } else {
      this._board = null;
      this.yaw = wrapAngle(this.yaw - ctx.lookX);
      // (En primera persona a pie, el tope propio: el cuello se dobla y los ojos no se meten al cuerpo.)
      const fpLook = !ctx.inVehicle && this.footViewName === 'primera';
      this.pitch = clamp(this.pitch - ctx.lookY - this.recoil, fpLook ? FP_PITCH_MIN : -1.25, fpLook ? FP_PITCH_MAX : 0.9);
    }
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
    if (E) {
      // De los ojos (w = 0) a la cámara del vehículo (w = 1): solo al final de
      // la subida o al principio de la bajada (E.fpW).
      const vc = vehicleCamera(VEHICLE_VIEWS[this.vehicleView], E.size, 0, !!E.moto);
      const w = E.fpW;
      dist = vc.dist * w;
      height = vc.height * w;
      ahead = (vc.ahead ?? 0) * w;
    } else if (B) {
      // Subiendo / bajando: mezcla de la cámara a pie (la primera persona, en
      // tercera mientras tanto) y la de persecución, con el vehículo quieto.
      const vc = vehicleCamera(VEHICLE_VIEWS[this.vehicleView], B.size, 0, !!B.moto);
      const fc = footCamera(this.footViewName === 'primera' ? 'normal' : this.footViewName, { side: this.side });
      const w = B.w;
      dist = fc.dist + (vc.dist - fc.dist) * w;
      height = fc.height + (vc.height - fc.height) * w;
      shoulder = fc.shoulder * (1 - w);
      ahead = (vc.ahead ?? 0) * w;
    } else if (ctx.inVehicle) {
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
      fov += Math.min(hood ? VEH_FOV_MAX_HOOD : VEH_FOV_MAX, sp * VEH_FOV_PER_MS);
    } else {
      const fc = footCamera(this.footViewName, { aiming: !!ctx.aiming, sprinting: !!ctx.sprinting, crouching: !!ctx.crouching, side: this.side });
      dist = fc.dist;
      height = fc.height;
      shoulder = fc.shoulder;
      fov += fc.fovAdd;
      eyes = fc.first;
      eyeAhead = fc.ahead;
      // Primera persona con esqueleto: los ojos salen de la cabeza filtrada (alto aquí; lado y adelante abajo).
      if (eyes && ctx.head) height = this._followHead(dt, ctx)[1];
    }
    if (!(eyes && ctx.head)) this.fpHead.on = false;
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
    if (B) {
      // (La mezcla ya es suave: sin el atraso del suavizado.)
      this.shoulderCur = shoulder;
      this.dist = dist;
    } else {
      this.shoulderCur = damp(this.shoulderCur, shoulder, 10, dt);
      this.dist = damp(this.dist, dist, 8, dt);
    }
    this.fov = damp(this.fov, fov, 8, dt);

    // Capó: el pivote va adelante, sobre el vehículo, en la dirección en que apunta.
    const h = B ? B.heading : (ctx.vehicleHeading ?? 0);
    if (E) {
      const w = E.fpW;
      const fb = this._fpb;
      // Los ojos sobre y delante del hueso de la cabeza, como a pie (fpEye; el
      // rumbo, el del cuerpo suavizado): al soltar la animación no hay salto.
      const eo = fpEye(0, 0, 0, this.pitch, this._be);
      const ex = fb.x - Math.sin(fb.yaw) * eo[2];
      const ey = fb.y + eo[1];
      const ez = fb.z - Math.cos(fb.yaw) * eo[2];
      this.target.set(ex + (E.vx - Math.sin(h) * ahead - ex) * w, ey + (E.vy + height - ey) * w, ez + (E.vz - Math.cos(h) * ahead - ez) * w);
    } else if (B) {
      const w = B.w;
      this.target.set(B.x + (B.vx - B.x) * w - Math.sin(h) * ahead, B.y + (B.vy - B.y) * w + height, B.z + (B.vz - B.z) * w - Math.cos(h) * ahead);
    } else this.target.set(ctx.x - Math.sin(h) * ahead, ctx.y + height, ctx.z - Math.cos(h) * ahead);
    if (this.first) {
      this.smoothedTarget.copy(this.target);
      this.first = false;
    }
    const lerpK = snap ? 60 : (ctx.inVehicle ? 14 : 22) * smoothingFactor(this.smoothing);
    this.smoothedTarget.x = damp(this.smoothedTarget.x, this.target.x, lerpK, dt);
    this.smoothedTarget.y = damp(this.smoothedTarget.y, this.target.y, lerpK * 0.6, dt);
    this.smoothedTarget.z = damp(this.smoothedTarget.z, this.target.z, lerpK, dt);
    if (E) this.smoothedTarget.copy(this.target); // (los ojos ya van suavizados)
    else if (eyes) {
      // En los ojos, a la par de la cápsula: suavizada se atrasaba v/k (12 cm
      // corriendo) y quedaba detrás de la cabeza. (La altura sí se suaviza: los escalones.)
      this.smoothedTarget.x = this.target.x;
      this.smoothedTarget.z = this.target.z;
    }

    const yaw = ctx.lookBehind && ctx.inVehicle ? this.yaw + Math.PI : this.yaw;
    const cp = Math.cos(this.pitch);
    const fx = -Math.sin(yaw) * cp;
    const fy = Math.sin(this.pitch);
    const fz = -Math.cos(yaw) * cp;
    const rx = Math.cos(yaw);
    const rz = -Math.sin(yaw);
    const t = this.smoothedTarget;
    const sh = this.shoulderCur;
    const pivot = this._pivot.set(t.x, t.y, t.z);
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
    const hint = ctx.hint ?? null; // adentro de un local (game/interiors.js): más cerca y dentro del salón
    if (hint && !eyes && !hood) d = Math.min(d, hint.maxDist);
    if (eyes) {
      // Primera persona: en los ojos (con esqueleto, donde va la cabeza en el
      // marco del cuerpo; si no, un poco adelante del eje), sin atravesar la
      // pared de enfrente (rayo en horizontal desde el eje del cuerpo).
      const head = !!ctx.head;
      const by = head ? (ctx.bodyYaw ?? yaw) : yaw;
      const side = head ? this.fpEye[0] : 0;
      const fwdA = head ? this.fpEye[2] : eyeAhead;
      let ox = -Math.sin(by) * fwdA + Math.cos(by) * side;
      let oz = -Math.cos(by) * fwdA - Math.sin(by) * side;
      const len = Math.hypot(ox, oz);
      if (len > 1e-4) {
        const gap = head ? FP_WALL_GAP : 0.2;
        const he = this.collision.raycast(pivot.x, pivot.y, pivot.z, ox / len, 0, oz / len, len + gap);
        const a = he ? Math.max(0, he.t - gap) / len : 1;
        if (a < 1) {
          ox *= a;
          oz *= a;
        }
      }
      this.pos.set(pivot.x + ox, pivot.y, pivot.z + oz);
      this._updateFp(dt, ctx, fx, fy, fz);
      // Cabeceo leve de la cámara al caminar (menos al apuntar).
      const F = this.fp;
      const k = FP_BOB_CAMERA * F.bobAmp * (1 - 0.7 * F.ads);
      this.pos.y += Math.abs(Math.sin(F.bobPhase)) * k - k * 0.5;
      this.pos.x += rx * Math.cos(F.bobPhase) * k * 0.3;
      this.pos.z += rz * Math.cos(F.bobPhase) * k * 0.3;
    } else {
      if (!hood) {
        // ...y acercar la cámara si una pared se interpone.
        const hit = this.collision.raycast(pivot.x, pivot.y, pivot.z, -fx, -fy, -fz, d + 0.3);
        if (hit) d = Math.max(Math.min(d, 0.6), hit.t - 0.3); // (en los ojos, d ≈ 0: no la echa para atrás)
      }
      this.pos.set(pivot.x - fx * d, pivot.y - fy * d, pivot.z - fz * d);
    }
    if (hint && !eyes) {
      this.pos.y += hint.lift;
      hint.clamp(this.pos);
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
    // En moto: un poco de ladeo con la inclinación (no al mirar atrás ni subiéndose).
    const rollT = ctx.inVehicle && ctx.moto && !B && !ctx.lookBehind ? (ctx.vehicleLean ?? 0) * CAM_MOTO_ROLL : 0;
    this.roll = damp(this.roll ?? 0, rollT, CAM_ROLL_RATE, dt);
    if (Math.abs(this.roll) > 1e-4) this.camera.rotateZ(this.roll);
    // Primera persona: plano cercano más corto (las manos y el arma van muy cerca).
    const near = eyes || (E && E.fpW < 0.5) ? FP_NEAR : this.baseNear;
    if (Math.abs(this.camera.fov - this.fov) > 0.01 || this.camera.near !== near) {
      this.camera.fov = this.fov;
      this.camera.near = near;
      this.camera.updateProjectionMatrix();
    }
  }

  /**
   * Primera persona con esqueleto: lleva la cabeza (ctx.head, en el marco del
   * cuerpo de rumbo ctx.bodyYaw) por el resorte y devuelve los ojos ([lado,
   * alto, adelante] desde el pie de la cápsula: fpEye). Sin asignar memoria.
   */
  _followHead(dt, ctx) {
    const H = ctx.head;
    const hl = fpHeadLocal(H.x - ctx.x, H.y - ctx.y, H.z - ctx.z, ctx.bodyYaw ?? this.yaw, this._hl);
    hl[0] *= FP_HEAD_SIDE;
    const F = this.fpHead;
    if (!F.on) {
      // Recién en los ojos: arranca donde está la cabeza, sin arrastrar nada viejo.
      for (let i = 0; i < 3; i++) {
        F.pos[i] = hl[i];
        F.vel[i] = 0;
      }
      F.on = true;
    } else {
      const st = ctx.simDt ?? dt; // (la cabeza va con el reloj del juego)
      springAxis(F.pos, F.vel, 0, hl[0], FP_HEAD_FOLLOW_SIDE, st);
      springAxis(F.pos, F.vel, 1, hl[1], FP_HEAD_FOLLOW, st);
      springAxis(F.pos, F.vel, 2, hl[2], FP_HEAD_FOLLOW, st);
      fpHeadLeash(F.pos, F.vel, hl);
    }
    return fpEye(F.pos[0], F.pos[1], F.pos[2], this.pitch, this.fpEye);
  }

  /**
   * Estado del arma en primera persona: mira (ADS), cabeceo al caminar
   * (ctx.speed), vaivén al girar (ctx.lookX/lookY), retroceso y retracción
   * ante una pared (rayo por la mira desde los ojos, sin asignar memoria).
   */
  _updateFp(dt, ctx, fx, fy, fz) {
    const F = this.fp;
    F.ads = damp(F.ads, ctx.aiming ? 1 : 0, FP_ADS_RATE, dt);
    const sp = Math.min(Math.abs(ctx.speed ?? 0), 8);
    // Un paso cada medio ciclo: ~1,8 pasos/s caminando, ~2,8 corriendo.
    F.bobPhase = (F.bobPhase + dt * (sp > 0.2 ? 4.2 + sp * 0.75 : 0)) % (Math.PI * 2);
    F.bobAmp = damp(F.bobAmp, Math.min(1.2, sp / 5), 6, dt);
    const b = FP_BOB_WEAPON * F.bobAmp * (1 - 0.75 * F.ads);
    F.bobY = (Math.abs(Math.sin(F.bobPhase)) - 0.5) * b;
    F.bobX = Math.cos(F.bobPhase) * b * 0.5;
    // Vaivén: el arma se queda atrás al girar y vuelve sola.
    const inv = dt > 1e-4 ? 1 / dt : 0;
    const tx = clamp(-(ctx.lookX ?? 0) * inv * FP_SWAY, -FP_SWAY_MAX, FP_SWAY_MAX);
    const ty = clamp((ctx.lookY ?? 0) * inv * FP_SWAY, -FP_SWAY_MAX, FP_SWAY_MAX);
    F.swayX = damp(F.swayX, tx * (1 - 0.6 * F.ads), 9, dt);
    F.swayY = damp(F.swayY, ty * (1 - 0.6 * F.ads), 9, dt);
    F.kick = damp(F.kick, 0, 14, dt);
    F.kickBack = F.kick * FP_KICK_BACK;
    F.kickPitch = F.kick * FP_KICK_PITCH;
    const hit = this.collision.raycast(this.pos.x, this.pos.y, this.pos.z, fx, fy, fz, FP_WALL_REACH);
    const want = hit ? clamp((FP_WALL_REACH - hit.t) / (FP_WALL_REACH - FP_WALL_MIN), 0, 1) : 0;
    F.retract = damp(F.retract, want, want > F.retract ? 16 : 7, dt);
  }

  /** Rayo de puntería por el centro de la pantalla. */
  aimRay() {
    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);
    const o = this.camera.position;
    return { origin: { x: o.x, y: o.y, z: o.z }, dir: { x: dir.x, y: dir.y, z: dir.z } };
  }
}
