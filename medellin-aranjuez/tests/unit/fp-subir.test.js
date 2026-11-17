// Subir y bajar del vehículo en primera persona (cameraRig ctx.board con la
// cabeza, game/boarding.js cameraBlend / BOARD_FP): la cámara sigue en los
// ojos, sin pasar a tercera, y solo al final se mezcla con la del vehículo.
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { CameraRig, FOOT_VIEWS, fpEye } from '../../src/game/cameraRig.js';

const none = { raycast: () => null };
/** Los ojos que van con el hueso de la cabeza en (hx, hy, hz): encima y delante (rumbo `yaw`), como a pie. */
const eyesAt = (hx, hy, hz, yaw, pitch) => {
  const e = fpEye(0, 0, 0, pitch, [0, 0, 0]);
  return new THREE.Vector3(hx - Math.sin(yaw) * e[2], hy + e[1], hz - Math.cos(yaw) * e[2]);
};
const board = (o = {}) => ({ enter: true, w: 0.3, x: -2, y: 0, z: 0, vx: 0, vy: 0, vz: 0, heading: 0, size: 4.3, moto: false, head: true, hx: -1.1, hy: 1.62, hz: 0.4, bodyYaw: 0.8, fpW: 0, ...o });
const ctx = (b) => ({ x: b.vx, y: 0, z: b.vz, inVehicle: true, vehicleHeading: 0, vehicleSpeed: 0, vehicleSize: 4.3, lookX: 0, lookY: 0, board: b });
const primera = (rig) => {
  rig.setFirstPerson(true);
  rig.zoomLevel = FOOT_VIEWS.indexOf('primera');
  return rig;
};

describe('subir y bajar en primera persona', () => {
  it('la cámara va en los ojos y mira hacia donde va el cuerpo (no salta a tercera)', () => {
    const cam = new THREE.PerspectiveCamera();
    const rig = primera(new CameraRig(cam, none));
    rig.yaw = 0.8;
    for (let i = 0; i < 30; i++) rig.update(1 / 60, ctx(board()));
    // (Los ojos sobre y delante del hueso de la cabeza, igual que a pie: fpEye.)
    expect(cam.position.distanceTo(eyesAt(-1.1, 1.62, 0.4, 0.8, rig.pitch))).toBeLessThan(0.02);
    expect(cam.position.y).toBeGreaterThan(1.62 + 0.05);
    expect(rig.yaw).toBeCloseTo(0.8, 2);
    // El cuerpo gira (se sienta mirando al frente): la mirada lo sigue sin saltos.
    let maxStep = 0;
    let prev = rig.yaw;
    for (let i = 0; i < 90; i++) {
      rig.update(1 / 60, ctx(board({ bodyYaw: 0 })));
      maxStep = Math.max(maxStep, Math.abs(rig.yaw - prev));
      prev = rig.yaw;
    }
    expect(Math.abs(rig.yaw)).toBeLessThan(0.05);
    expect(maxStep).toBeLessThan(0.08);
  });

  it('el temblor del hueso de la cabeza no pasa entero a la cámara (cuello estable)', () => {
    const cam = new THREE.PerspectiveCamera();
    const rig = primera(new CameraRig(cam, none));
    for (let i = 0; i < 30; i++) rig.update(1 / 60, ctx(board()));
    const y0 = cam.position.y; // (los ojos, encima del hueso)
    let maxDev = 0;
    for (let i = 0; i < 60; i++) {
      const j = i % 2 ? 0.03 : -0.03; // 3 cm de un cuadro al otro
      rig.update(1 / 60, ctx(board({ hy: 1.62 + j })));
      maxDev = Math.max(maxDev, Math.abs(cam.position.y - y0));
    }
    expect(maxDev).toBeLessThan(0.03);
  });

  it('al terminar de bajarse la cámara no salta: los ojos son los mismos que a pie (antes, 20 cm mirando abajo)', () => {
    for (const pitch of [-0.05, -0.7, -1.2]) {
      const cam = new THREE.PerspectiveCamera();
      const rig = primera(new CameraRig(cam, none));
      rig.yaw = 0.8;
      rig.pitch = pitch;
      const exit = board({ enter: false, w: 0, fpW: 0, bodyYaw: 0.8, hx: -1.1, hy: 1.55, hz: 0.4 });
      for (let i = 0; i < 60; i++) rig.update(1 / 60, { ...ctx(exit), inVehicle: false });
      const a = cam.position.clone();
      // Ya de pie: la cápsula debajo de la cabeza y el juego pasa la cabeza (ctx.head).
      rig.update(1 / 60, { x: -1.1, y: 0, z: 0.4, inVehicle: false, lookX: 0, lookY: 0, head: { x: -1.1, y: 1.55, z: 0.4 }, bodyYaw: 0.8 });
      expect(cam.position.distanceTo(a)).toBeLessThan(0.03);
    }
  });

  it('al final de la subida termina en la cámara del vehículo, igual que en tercera', () => {
    const a = new THREE.PerspectiveCamera();
    const b = new THREE.PerspectiveCamera();
    const fp = primera(new CameraRig(a, none));
    const tp = new CameraRig(b, none);
    for (let i = 0; i < 120; i++) {
      fp.update(1 / 60, ctx(board({ w: 1, fpW: 1, bodyYaw: 0 })));
      tp.update(1 / 60, ctx(board({ w: 1, fpW: 1, bodyYaw: 0 })));
    }
    expect(a.position.distanceTo(b.position)).toBeLessThan(0.05);
    expect(a.position.z).toBeGreaterThan(3); // detrás del carro
  });

  it('en tercera persona, la cabeza no cambia nada', () => {
    const a = new THREE.PerspectiveCamera();
    const b = new THREE.PerspectiveCamera();
    const r1 = new CameraRig(a, none);
    const r2 = new CameraRig(b, none);
    for (let i = 0; i < 30; i++) {
      r1.update(1 / 60, ctx(board()));
      r2.update(1 / 60, ctx(board({ head: false })));
    }
    expect(a.position.distanceTo(b.position)).toBeLessThan(1e-9);
    expect(a.position.distanceTo(new THREE.Vector3(-1.1, 1.62, 0.4))).toBeGreaterThan(1);
  });
});
