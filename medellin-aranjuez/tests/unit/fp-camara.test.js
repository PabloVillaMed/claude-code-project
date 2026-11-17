// Primera persona con cuerpo (v3.9): la cámara va en los ojos siguiendo al
// hueso de la cabeza (game/cameraRig.js fpHeadLocal, springAxis, fpHeadLeash,
// fpEye), no a la cápsula; la cabeza y lo que lleva no se dibujan para la
// cámara pero sí dan sombra (render/characterRig.js fpHide / fpShow).
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  CameraRig,
  FOOT_VIEWS,
  FP_DOWN_PUSH,
  FP_HEAD_EYE_FWD,
  FP_HEAD_EYE_UP,
  FP_HEAD_FOLLOW,
  FP_HEAD_LAG,
  FP_PITCH_MAX,
  FP_PITCH_MIN,
  FP_WALL_GAP,
  fpEye,
  fpHeadLeash,
  fpHeadLocal,
  springAxis,
} from '../../src/game/cameraRig.js';
import { fpHidden, fpHide, fpShow } from '../../src/render/characterRig.js';

const none = { raycast: () => null };
const Y = 10; // pie de la cápsula (alto de sobra sobre cualquier terreno)
const primera = (rig) => {
  rig.setFirstPerson(true);
  rig.zoomLevel = FOOT_VIEWS.indexOf('primera');
  return rig;
};
// Cabeza a `fwd` m adelante y `up` m de alto (cuerpo con rumbo `yaw` en x, z).
const head = (fwd, up, yaw = 0, x = 0, z = 0, side = 0) => ({
  x: x - Math.sin(yaw) * fwd + Math.cos(yaw) * side,
  y: Y + up,
  z: z - Math.cos(yaw) * fwd - Math.sin(yaw) * side,
});
const ctx = (o = {}) => ({ x: 0, y: Y, z: 0, inVehicle: false, aiming: false, sprinting: false, lookX: 0, lookY: 0, speed: 0, bodyYaw: 0, ...o });
// Cámara en el marco del cuerpo: [lado, alto, adelante].
const local = (p, yaw = 0, x = 0, z = 0) => fpHeadLocal(p.x - x, p.y - Y, p.z - z, yaw, [0, 0, 0]);

describe('matemática de los ojos', () => {
  it('fpHeadLocal: adelante es -Z girado con el rumbo; derecha +X', () => {
    for (const yaw of [0, 0.7, Math.PI / 2, -2.5]) {
      const h = head(0.3, 1.5, yaw, 0, 0, 0.05);
      const l = fpHeadLocal(h.x, h.y - Y, h.z, yaw, [0, 0, 0]);
      expect(l[0]).toBeCloseTo(0.05, 9);
      expect(l[1]).toBeCloseTo(1.5, 9);
      expect(l[2]).toBeCloseTo(0.3, 9);
    }
  });

  it('fpEye: al frente, los ojos sobre y delante del hueso de la cabeza', () => {
    const e = fpEye(0.01, 1.54, 0.008, 0, [0, 0, 0]);
    expect(e[0]).toBeCloseTo(0.01, 9);
    expect(e[1]).toBeCloseTo(1.54 + FP_HEAD_EYE_UP, 9);
    expect(e[2]).toBeCloseTo(0.008 + FP_HEAD_EYE_FWD, 9);
  });

  it('fpEye: mirando abajo el cuello se dobla (adelante y abajo) y la cámara se adelanta; arriba no', () => {
    let prev = fpEye(0, 1.5, 0, 0, [0, 0, 0]);
    for (let p = -0.1; p >= FP_PITCH_MIN - 1e-9; p -= 0.1) {
      const e = fpEye(0, 1.5, 0, p, [0, 0, 0]);
      expect(e[2]).toBeGreaterThan(prev[2]);
      expect(e[1]).toBeLessThan(prev[1]);
      prev = e;
    }
    // Del todo abajo: bien delante de la cara (el cuello por dentro queda fuera de la vista).
    const down = fpEye(0, 1.5, 0, FP_PITCH_MIN, [0, 0, 0]);
    expect(down[2]).toBeGreaterThan(0.2);
    expect(down[2]).toBeLessThan(FP_HEAD_EYE_FWD + FP_HEAD_EYE_UP + FP_DOWN_PUSH + 1e-9);
    // Arriba: no se adelanta (ni sube más de la cuenta).
    const up = fpEye(0, 1.5, 0, FP_PITCH_MAX, [0, 0, 0]);
    expect(up[2]).toBeLessThan(FP_HEAD_EYE_FWD);
    expect(up[1] - 1.5).toBeLessThan(FP_HEAD_EYE_UP + FP_HEAD_EYE_FWD);
    // Más allá de los topes, lo mismo que en el tope.
    expect(fpEye(0, 1.5, 0, -3, [0, 0, 0])).toEqual(down);
    expect(fpEye(0, 1.5, 0, 3, [0, 0, 0])).toEqual(up);
  });

  it('springAxis: llega sin pasarse y da lo mismo en pasos largos o cortos', () => {
    const p = [0];
    const v = [0];
    let max = 0;
    for (let i = 0; i < 120; i++) {
      springAxis(p, v, 0, 1, FP_HEAD_FOLLOW, 1 / 60);
      max = Math.max(max, p[0]);
    }
    expect(p[0]).toBeGreaterThan(0.99);
    expect(max).toBeLessThanOrEqual(1 + 1e-9);
    const a = [0];
    const av = [0];
    const b = [0];
    const bv = [0];
    springAxis(a, av, 0, 1, 8, 0.1);
    for (let i = 0; i < 4; i++) springAxis(b, bv, 0, 1, 8, 0.025);
    expect(a[0]).toBeCloseTo(b[0], 9);
    // Un cuadro larguísimo no lo dispara.
    const c = [0];
    springAxis(c, [0], 0, 1, 8, 5);
    expect(c[0]).toBeGreaterThan(0.99);
    expect(c[0]).toBeLessThanOrEqual(1);
  });

  it('springAxis: se come la mayor parte del cabeceo de cada paso corriendo (~2,6 pasos/s)', () => {
    const p = [0.35];
    const v = [0];
    const xs = [];
    for (let i = 0; i < 240; i++) {
      const t = i / 60;
      springAxis(p, v, 0, 0.35 + 0.07 * Math.sin(2 * Math.PI * 2.6 * t), FP_HEAD_FOLLOW, 1 / 60);
      if (i >= 60) xs.push(p[0]);
    }
    // La cabeza va y viene 14 cm; la cámara, menos de 3,5.
    expect(Math.max(...xs) - Math.min(...xs)).toBeLessThan(0.035);
  });

  it('fpHeadLeash: el resorte no se queda atrás, ni encima ni debajo, más de FP_HEAD_LAG', () => {
    const raw = [0, 1.4, 0.35];
    const p = [0, 1.6, 0.0];
    const v = [0, 0.5, -0.5];
    fpHeadLeash(p, v, raw);
    expect(p[2]).toBeCloseTo(0.35 - FP_HEAD_LAG, 9);
    expect(p[1]).toBeCloseTo(1.4 + FP_HEAD_LAG, 9);
    expect(v[2]).toBe(0);
    expect(v[1]).toBe(0);
    const q = [0, 1.0, 0.6];
    fpHeadLeash(q, [0, 0, 0], raw);
    expect(q[1]).toBeCloseTo(1.4 - FP_HEAD_LAG, 9);
    expect(q[2]).toBe(0.6); // (adelante sí puede quedar: ahí no hay cuerpo)
  });
});

describe('CameraRig en primera persona con la cabeza del esqueleto', () => {
  it('quieto: la cámara va en los ojos, encima y delante del hueso de la cabeza', () => {
    const cam = new THREE.PerspectiveCamera();
    const rig = primera(new CameraRig(cam, none));
    rig.yaw = 0;
    rig.pitch = 0;
    for (let i = 0; i < 30; i++) rig.update(1 / 60, ctx({ head: head(0.008, 1.544) }));
    const l = local(cam.position);
    expect(l[1]).toBeCloseTo(1.544 + FP_HEAD_EYE_UP, 3);
    expect(l[2]).toBeCloseTo(0.008 + FP_HEAD_EYE_FWD, 3);
    expect(Math.abs(l[0])).toBeLessThan(1e-3);
  });

  it('corriendo, la cabeza baja y se adelanta: la cámara va con ella (no queda fija a la cápsula)', () => {
    for (const yaw of [0, 1.2]) {
      const cam = new THREE.PerspectiveCamera();
      const rig = primera(new CameraRig(cam, none));
      rig.yaw = yaw;
      rig.pitch = -0.1;
      for (let i = 0; i < 90; i++) rig.update(1 / 60, ctx({ head: head(0.35, 1.40, yaw, 0, 0), bodyYaw: yaw }));
      const l = local(cam.position, yaw);
      expect(l[2]).toBeGreaterThan(0.35 + 0.08);
      expect(l[1]).toBeLessThan(1.40 + FP_HEAD_EYE_UP + 0.03);
      expect(l[1]).toBeGreaterThan(1.40);
    }
  });

  it('arrancar a correr mirando abajo: los ojos nunca quedan detrás de la cabeza ni encima del cuello', () => {
    const cam = new THREE.PerspectiveCamera();
    const rig = primera(new CameraRig(cam, none));
    rig.yaw = 0;
    rig.pitch = FP_PITCH_MIN;
    let minAhead = 9;
    let maxAbove = -9;
    for (let i = 0; i < 90; i++) {
      // En 0,3 s la cabeza se adelanta 35 cm y baja 14 cm (la cápsula ya va a 7 m/s hacia -Z).
      const k = Math.min(1, i / 18);
      const s = k * k * (3 - 2 * k);
      const hf = 0.008 + 0.342 * s;
      const hu = 1.544 - 0.144 * s;
      const z = -7 * (i / 60);
      rig.update(1 / 60, ctx({ z, head: head(hf, hu, 0, 0, z) }));
      const l = local(cam.position, 0, 0, z);
      minAhead = Math.min(minAhead, l[2] - hf);
      maxAbove = Math.max(maxAbove, l[1] - hu);
    }
    // Mirando del todo abajo: siempre bien delante del hueso de la cabeza (antes del arreglo, hasta 29 cm detrás).
    expect(minAhead).toBeGreaterThan(0.12);
    expect(maxAbove).toBeLessThan(FP_HEAD_EYE_UP + FP_HEAD_LAG);
  });

  it('la cápsula corriendo no deja atrás a la cámara (antes se atrasaba v/k: 12 cm a 7 m/s)', () => {
    const cam = new THREE.PerspectiveCamera();
    const rig = primera(new CameraRig(cam, none));
    rig.yaw = 0;
    rig.pitch = 0;
    for (let i = 0; i < 60; i++) {
      const z = -7.4 * (i / 60);
      rig.update(1 / 60, ctx({ z, head: head(0.35, 1.4, 0, 0, z) }));
      if (i > 20) expect(local(cam.position, 0, 0, z)[2]).toBeGreaterThan(0.35 + FP_HEAD_EYE_FWD - 0.01);
    }
  });

  it('el cabeceo de cada paso casi no pasa a la cámara', () => {
    const cam = new THREE.PerspectiveCamera();
    const rig = primera(new CameraRig(cam, none));
    rig.yaw = 0;
    rig.pitch = 0;
    const f = [];
    const u = [];
    for (let i = 0; i < 240; i++) {
      const t = i / 60;
      const h = head(0.35 + 0.07 * Math.sin(2 * Math.PI * 2.6 * t), 1.40 + 0.04 * Math.sin(2 * Math.PI * 5.2 * t), 0, 0, 0, 0.06 * Math.sin(2 * Math.PI * 1.3 * t));
      rig.update(1 / 60, ctx({ head: h }));
      if (i >= 60) {
        const l = local(cam.position);
        f.push(l[2]);
        u.push(l[1]);
      }
    }
    expect(Math.max(...f) - Math.min(...f)).toBeLessThan(0.04);
    expect(Math.max(...u) - Math.min(...u)).toBeLessThan(0.02);
  });

  it('tope de la mirada propio en primera persona; en tercera, el de siempre', () => {
    const rig = primera(new CameraRig(new THREE.PerspectiveCamera(), none));
    rig.pitch = 0;
    rig.update(1 / 60, ctx({ head: head(0.008, 1.544), lookY: 5 }));
    expect(rig.pitch).toBeCloseTo(FP_PITCH_MIN, 9);
    rig.update(1 / 60, ctx({ head: head(0.008, 1.544), lookY: -9 }));
    expect(rig.pitch).toBeCloseTo(FP_PITCH_MAX, 9);
    const tp = new CameraRig(new THREE.PerspectiveCamera(), none);
    tp.update(1 / 60, ctx({ lookY: 5 }));
    expect(tp.pitch).toBeCloseTo(-1.25, 9);
  });

  it('con la cabeza adelantada contra una pared, la cámara no la atraviesa', () => {
    // Pared en x = 2; mirando a +X.
    const wall = {
      raycast(ox, oy, oz, dx, dy, dz, max) {
        if (dx <= 0) return null;
        const t = (2 - ox) / dx;
        return t >= 0 && t <= max ? { t } : null;
      },
    };
    const cam = new THREE.PerspectiveCamera();
    const rig = primera(new CameraRig(cam, wall));
    const yaw = -Math.PI / 2;
    rig.yaw = yaw;
    rig.pitch = -0.2;
    for (let i = 0; i < 30; i++) rig.update(1 / 60, ctx({ x: 1.7, head: head(0.35, 1.4, yaw, 1.7, 0), bodyYaw: yaw }));
    expect(cam.position.x).toBeLessThanOrEqual(2 - FP_WALL_GAP + 1e-6);
    expect(cam.position.x).toBeGreaterThan(1.7);
  });

  it('en tercera persona la cabeza no cambia nada', () => {
    const a = new THREE.PerspectiveCamera();
    const b = new THREE.PerspectiveCamera();
    const r1 = new CameraRig(a, none);
    const r2 = new CameraRig(b, none);
    for (let i = 0; i < 30; i++) {
      r1.update(1 / 60, ctx({ head: head(0.35, 1.4) }));
      r2.update(1 / 60, ctx({ head: null }));
    }
    expect(a.position.distanceTo(b.position)).toBeLessThan(1e-9);
  });
});

describe('cabeza oculta para la cámara, con sombra', () => {
  it('fpHide: al dibujarse para la cámara no escribe color ni profundidad, y se repone después', () => {
    const mat = new THREE.MeshStandardMaterial();
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), mat);
    mesh.castShadow = true;
    let calls = 0;
    mesh.onBeforeRender = () => calls++;
    const prevAfter = mesh.onAfterRender;
    fpHide(mesh);
    fpHide(mesh); // (dos veces: igual)
    expect(fpHidden(mesh)).toBe(true);
    mesh.onBeforeRender(null, null, null, null, mat, null);
    expect(calls).toBe(1); // (el callback que tenía la malla sigue corriendo: el LOD de la animación)
    expect(mat.colorWrite).toBe(false);
    expect(mat.depthWrite).toBe(false);
    mesh.onAfterRender(null, null, null, null, mat, null);
    expect(mat.colorWrite).toBe(true);
    expect(mat.depthWrite).toBe(true);
    // Sigue visible y con sombra (visible = false también quitaba la sombra de la cabeza).
    expect(mesh.visible).toBe(true);
    expect(mesh.castShadow).toBe(true);
    fpShow(mesh);
    expect(fpHidden(mesh)).toBe(false);
    expect(mesh.onAfterRender).toBe(prevAfter);
    mesh.onBeforeRender(null, null, null, null, mat, null);
    expect(calls).toBe(2);
    expect(mat.colorWrite).toBe(true);
  });

  it('un material compartido queda igual para los demás que lo usan', () => {
    const mat = new THREE.MeshStandardMaterial({ depthWrite: true });
    const hidden = new THREE.Mesh(new THREE.BoxGeometry(), mat);
    fpHide(hidden);
    hidden.onBeforeRender(null, null, null, null, mat, null);
    hidden.onAfterRender(null, null, null, null, mat, null);
    expect(mat.colorWrite).toBe(true);
    expect(mat.depthWrite).toBe(true);
  });
});
