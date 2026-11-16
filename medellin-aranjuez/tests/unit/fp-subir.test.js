// Subir y bajar del vehículo en primera persona (cameraRig ctx.board con la
// cabeza, game/boarding.js cameraBlend / BOARD_FP): la cámara sigue en los
// ojos, sin pasar a tercera, y solo al final se mezcla con la del vehículo.
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { CameraRig, FOOT_VIEWS } from '../../src/game/cameraRig.js';

const none = { raycast: () => null };
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
    expect(cam.position.distanceTo(new THREE.Vector3(-1.1, 1.62, 0.4))).toBeLessThan(0.02);
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
    let maxDev = 0;
    for (let i = 0; i < 60; i++) {
      const j = i % 2 ? 0.03 : -0.03; // 3 cm de un cuadro al otro
      rig.update(1 / 60, ctx(board({ hy: 1.62 + j })));
      maxDev = Math.max(maxDev, Math.abs(cam.position.y - 1.62));
    }
    expect(maxDev).toBeLessThan(0.03);
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
