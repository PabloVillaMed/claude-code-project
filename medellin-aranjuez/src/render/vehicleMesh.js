// Modelos procedurales de vehículos: taxi amarillo, sedán, camioneta,
// patrulla de la Policía, buseta de barrio y moto. Pintura con clearcoat.

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { textTexture } from './textures.js';

const PAINTS = [0xc0c4c8, 0xf2f2f2, 0x9b1c1c, 0x111316, 0x1e3a6b, 0x4a4f55, 0x6b8f71, 0xb87333];

const cache = new Map();
function shared(key, make) {
  if (!cache.has(key)) cache.set(key, make());
  return cache.get(key);
}

const paint = (color) =>
  shared(`paint${color}`, () => new THREE.MeshPhysicalMaterial({ color, metalness: 0.45, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.08 }));
const glassMat = () => shared('glass', () => new THREE.MeshPhysicalMaterial({ color: 0x0e1418, metalness: 0.1, roughness: 0.04, clearcoat: 1, transparent: true, opacity: 0.88 }));
const tireMat = () => shared('tire', () => new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.9 }));
const rimMat = () => shared('rim', () => new THREE.MeshStandardMaterial({ color: 0xb8bcc0, metalness: 0.9, roughness: 0.25 }));
const blackMat = () => shared('trim', () => new THREE.MeshStandardMaterial({ color: 0x1b1b1b, roughness: 0.6 }));
const chromeMat = () => shared('chrome', () => new THREE.MeshStandardMaterial({ color: 0xdddddd, metalness: 1, roughness: 0.12 }));

function profileGeo(points, width, bevel = 0.06) {
  const shape = new THREE.Shape();
  shape.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) shape.lineTo(points[i][0], points[i][1]);
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, { depth: width - bevel * 2, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 3, curveSegments: 4 });
  // Forma: X = largo (+X frente), Y = alto, Z = ancho -> vehículo: frente hacia -Z.
  g.rotateY(Math.PI / 2);
  g.translate(-(width - bevel * 2) / 2, 0, 0);
  g.computeVertexNormals();
  return g;
}

// Perfiles laterales [largo, alto] con el frente en +X.
function bodyProfile(type, L) {
  const h = L / 2;
  switch (type) {
    case 'taxi':
      return {
        body: [[-h, 0.32], [-h, 0.95], [-h + 0.15, 1.0], [h - 0.75, 0.95], [h - 0.1, 0.8], [h, 0.55], [h - 0.05, 0.32]],
        cabin: [[-h + 0.12, 0.98], [-h + 0.3, 1.46], [h - 1.4, 1.48], [h - 0.78, 0.96]],
      };
    case 'camioneta':
    case 'policia':
      return {
        body: [[-h, 0.42], [-h, 1.08], [-h + 0.1, 1.12], [h - 0.95, 1.12], [h - 0.12, 1.02], [h, 0.7], [h - 0.05, 0.42]],
        cabin: [[-h + 0.12, 1.1], [-h + 0.25, 1.72], [h - 1.55, 1.74], [h - 1.0, 1.1]],
      };
    default:
      return {
        body: [[-h, 0.34], [-h, 0.86], [-h + 0.25, 0.94], [-h + 0.9, 0.95], [h - 1.1, 0.92], [h - 0.15, 0.78], [h, 0.52], [h - 0.05, 0.34]],
        cabin: [[-h + 0.85, 0.93], [-h + 1.35, 1.38], [h - 1.75, 1.4], [h - 1.12, 0.92]],
      };
  }
}

export class VehicleView {
  constructor(type, opts = {}) {
    this.type = type;
    this.group = new THREE.Group();
    this.group.rotation.order = 'YXZ';
    this.chassis = new THREE.Group();
    this.group.add(this.chassis);
    this.wheels = [];
    this.frontPivots = [];
    this.lights = { head: null, tail: null, bar: [] };
    this.color = opts.color ?? PAINTS[Math.floor(Math.random() * PAINTS.length)];
    if (type === 'moto') this._buildMoto(opts);
    else if (type === 'buseta') this._buildBus(opts);
    else this._buildCar(type, opts);
    this.group.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    this.sirenPhase = 0;
    this.burnt = false;
  }

  _lights(width, L, frontY, rearY) {
    const head = new THREE.MeshStandardMaterial({ color: 0xfff6e0, emissive: 0xfff1d0, emissiveIntensity: 0.2, roughness: 0.1 });
    const tail = new THREE.MeshStandardMaterial({ color: 0x6a0000, emissive: 0xff1a1a, emissiveIntensity: 0.3, roughness: 0.3 });
    const hg = new THREE.BoxGeometry(0.32, 0.12, 0.06);
    for (const s of [-1, 1]) {
      const hl = new THREE.Mesh(hg, head);
      hl.position.set(s * (width / 2 - 0.25), frontY, -L / 2 - 0.01);
      const tl = new THREE.Mesh(hg, tail);
      tl.position.set(s * (width / 2 - 0.22), rearY, L / 2 + 0.01);
      this.chassis.add(hl, tl);
    }
    this.lights.head = head;
    this.lights.tail = tail;
  }

  _wheel(x, z, r, w, front) {
    const pivot = new THREE.Group();
    pivot.position.set(x, r, z);
    const spin = new THREE.Group();
    const tire = new THREE.Mesh(shared(`tire${r}-${w}`, () => new THREE.CylinderGeometry(r, r, w, 20).rotateZ(Math.PI / 2)), tireMat());
    const rim = new THREE.Mesh(shared(`rim${r}-${w}`, () => new THREE.CylinderGeometry(r * 0.62, r * 0.62, w + 0.02, 12).rotateZ(Math.PI / 2)), rimMat());
    spin.add(tire, rim);
    pivot.add(spin);
    this.group.add(pivot);
    this.wheels.push(spin);
    if (front) this.frontPivots.push(pivot);
  }

  _buildCar(type, opts) {
    const dims = {
      taxi: [3.7, 1.65],
      sedan: [4.4, 1.8],
      camioneta: [4.7, 1.95],
      policia: [4.5, 1.85],
    }[type];
    const [L, W] = dims;
    const color = type === 'taxi' ? 0xf7c600 : type === 'policia' ? 0xf4f4f4 : this.color;
    this.color = color;
    const prof = bodyProfile(type, L);
    this.paint = paint(color);
    const body = new THREE.Mesh(profileGeo(prof.body, W), this.paint);
    const cabin = new THREE.Mesh(profileGeo(prof.cabin, W * 0.86, 0.05), glassMat());
    this.chassis.add(body, cabin);
    // Techo pintado sobre el vidrio.
    const roofY = prof.cabin[1][1];
    const roofL = prof.cabin[2][0] - prof.cabin[1][0];
    const roof = new THREE.Mesh(new RoundedBoxGeometry(W * 0.84, 0.06, roofL + 0.1, 2, 0.02), this.paint);
    roof.position.set(0, roofY + 0.01, -(prof.cabin[1][0] + prof.cabin[2][0]) / 2);
    this.chassis.add(roof);
    // Parachoques y retrovisores.
    for (const z of [-L / 2 - 0.02, L / 2 + 0.02]) {
      const bump = new THREE.Mesh(new RoundedBoxGeometry(W * 0.98, 0.18, 0.12, 2, 0.04), blackMat());
      bump.position.set(0, prof.body[0][1] + 0.05, z);
      this.chassis.add(bump);
    }
    for (const s of [-1, 1]) {
      const mirror = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.1, 0.08), this.paint);
      mirror.position.set(s * (W / 2 + 0.06), prof.cabin[0][1] + 0.12, -(prof.cabin[3][0]) + 0.1);
      this.chassis.add(mirror);
    }
    // Rejilla frontal.
    const grille = new THREE.Mesh(new THREE.BoxGeometry(W * 0.45, 0.14, 0.04), chromeMat());
    grille.position.set(0, prof.body[0][1] + 0.3, -L / 2 - 0.02);
    this.chassis.add(grille);
    this._lights(W, L, prof.body[0][1] + 0.35, prof.body[0][1] + 0.45);

    if (type === 'taxi') {
      const signTex = textTexture('TAXI', { w: 256, h: 96, bg: '#ffffff', fg: '#111111', font: 'bold 70px Arial', border: '#111111' });
      const signMat = new THREE.MeshStandardMaterial({ map: signTex, emissive: 0xffffff, emissiveMap: signTex, emissiveIntensity: 0.3 });
      const sign = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.2, 0.25), [blackMat(), blackMat(), blackMat(), blackMat(), signMat, signMat]);
      sign.position.set(0, roofY + 0.14, roof.position.z);
      this.chassis.add(sign);
      this.lights.sign = signMat;
      // Franja de cuadros en los costados.
      const checker = document.createElement('canvas');
      checker.width = 128;
      checker.height = 16;
      const ctx = checker.getContext('2d');
      for (let i = 0; i < 16; i++) {
        ctx.fillStyle = i % 2 ? '#111' : '#fff';
        ctx.fillRect(i * 8, 0, 8, 8);
        ctx.fillStyle = i % 2 ? '#fff' : '#111';
        ctx.fillRect(i * 8, 8, 8, 8);
      }
      const ct = new THREE.CanvasTexture(checker);
      ct.magFilter = THREE.NearestFilter;
      for (const s of [-1, 1]) {
        const strip = new THREE.Mesh(new THREE.PlaneGeometry(L * 0.7, 0.1), new THREE.MeshStandardMaterial({ map: ct }));
        strip.rotation.y = s * Math.PI / 2;
        strip.position.set(s * (W / 2 + 0.005), 0.75, 0.05);
        this.chassis.add(strip);
      }
    }
    if (type === 'policia') {
      for (const s of [-1, 1]) {
        const stripe = new THREE.Mesh(new THREE.PlaneGeometry(L * 0.9, 0.22), new THREE.MeshStandardMaterial({ color: 0x0b6b3a }));
        stripe.rotation.y = s * Math.PI / 2;
        stripe.position.set(s * (W / 2 + 0.005), 0.8, 0);
        this.chassis.add(stripe);
        const labelTex = textTexture('POLICÍA', { w: 512, h: 128, bg: '#f4f4f4', fg: '#0b6b3a', font: 'bold 90px Arial', border: '#f4f4f4' });
        const label = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.35), new THREE.MeshStandardMaterial({ map: labelTex }));
        label.rotation.y = s * Math.PI / 2;
        label.position.set(s * (W / 2 + 0.006), 1.0, 0.2);
        if (s < 0) label.scale.x = 1;
        this.chassis.add(label);
      }
      // Barra de luces roja/azul.
      const bar = new THREE.Group();
      const base = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.1, 0.3), blackMat());
      bar.add(base);
      for (const [x, c] of [[-0.35, 0xff0000], [0.35, 0x0044ff]]) {
        const m = new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.1, transparent: true, opacity: 0.9 });
        const l = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.14, 0.28), m);
        l.position.set(x, 0.1, 0);
        bar.add(l);
        this.lights.bar.push(m);
      }
      bar.position.set(0, roofY + 0.1, roof.position.z);
      this.chassis.add(bar);
    }

    const r = type === 'camioneta' || type === 'policia' ? 0.38 : 0.32;
    const wb = { taxi: 2.4, sedan: 2.7, camioneta: 2.85, policia: 2.75 }[type];
    for (const s of [-1, 1]) {
      this._wheel(s * (W / 2 - 0.12), -wb / 2, r, 0.22, true);
      this._wheel(s * (W / 2 - 0.12), wb / 2, r, 0.22, false);
    }
    this.seat = { x: -0.38, y: 0.35, z: 0.1 };
    // Conductor al lado izquierdo (Colombia).
  }

  _buildBus(opts) {
    const L = 7.8;
    const W = 2.3;
    const colors = [0x1d4e89, 0xd62828, 0x2a9d8f, 0xf4a261];
    const base = opts.color ?? colors[Math.floor(Math.random() * colors.length)];
    this.paint = paint(0xf2f2f2);
    const body = new THREE.Mesh(new RoundedBoxGeometry(W, 2.35, L, 3, 0.18), this.paint);
    body.position.y = 1.55;
    this.chassis.add(body);
    const stripeMat = paint(base);
    for (const y of [0.75, 1.1]) {
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(W + 0.02, 0.18, L - 0.3), y === 0.75 ? stripeMat : paint(0xf7c600));
      stripe.position.y = y;
      this.chassis.add(stripe);
    }
    const win = new THREE.Mesh(new THREE.BoxGeometry(W + 0.03, 0.8, L - 1.6), glassMat());
    win.position.set(0, 2.05, 0.4);
    const wind = new THREE.Mesh(new THREE.BoxGeometry(W - 0.2, 1.0, 0.05), glassMat());
    wind.position.set(0, 1.95, -L / 2 - 0.01);
    this.chassis.add(win, wind);
    const destTex = textTexture('ARANJUEZ - CENTRO', { w: 1024, h: 128, bg: '#111111', fg: '#ffb000', font: 'bold 80px Arial', border: '#111111' });
    const dest = new THREE.Mesh(new THREE.PlaneGeometry(W - 0.3, 0.25), new THREE.MeshStandardMaterial({ map: destTex, emissive: 0xffffff, emissiveMap: destTex, emissiveIntensity: 0.6 }));
    dest.position.set(0, 2.6, -L / 2 - 0.03);
    dest.rotation.y = Math.PI;
    this.chassis.add(dest);
    this._lights(W, L, 0.8, 0.9);
    for (const s of [-1, 1]) {
      this._wheel(s * (W / 2 - 0.2), -L / 2 + 1.5, 0.48, 0.3, true);
      this._wheel(s * (W / 2 - 0.2), L / 2 - 1.6, 0.48, 0.3, false);
    }
    this.seat = { x: -0.6, y: 0.9, z: -L / 2 + 1.2 };
  }

  _buildMoto(opts) {
    const color = opts.color ?? [0xd62828, 0x111111, 0x1d3557, 0xf2f2f2, 0x2a9d8f][Math.floor(Math.random() * 5)];
    this.paint = paint(color);
    const frame = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 1.1), blackMat());
    frame.position.set(0, 0.55, 0);
    frame.rotation.x = 0.15;
    const tank = new THREE.Mesh(new RoundedBoxGeometry(0.3, 0.22, 0.5, 2, 0.08), this.paint);
    tank.position.set(0, 0.82, -0.2);
    const seat = new THREE.Mesh(new RoundedBoxGeometry(0.26, 0.1, 0.6, 2, 0.04), blackMat());
    seat.position.set(0, 0.85, 0.32);
    const engine = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.28, 0.35), chromeMat());
    engine.position.set(0, 0.45, 0.0);
    const fork = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.8), chromeMat());
    fork.position.set(0, 0.65, -0.72);
    fork.rotation.x = -0.35;
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.7).rotateZ(Math.PI / 2), blackMat());
    bar.position.set(0, 1.05, -0.62);
    const exhaust = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 0.6).rotateX(Math.PI / 2), chromeMat());
    exhaust.position.set(0.16, 0.38, 0.35);
    const fender = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.04, 0.5), this.paint);
    fender.position.set(0, 0.68, 0.72);
    this.chassis.add(frame, tank, seat, engine, fork, bar, exhaust, fender);
    const head = new THREE.MeshStandardMaterial({ color: 0xfff6e0, emissive: 0xfff1d0, emissiveIntensity: 0.2 });
    const tail = new THREE.MeshStandardMaterial({ color: 0x6a0000, emissive: 0xff1a1a, emissiveIntensity: 0.3 });
    const hl = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.06, 12).rotateX(Math.PI / 2), head);
    hl.position.set(0, 0.95, -0.8);
    const tl = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.06, 0.04), tail);
    tl.position.set(0, 0.8, 0.98);
    this.chassis.add(hl, tl);
    this.lights.head = head;
    this.lights.tail = tail;
    this._wheel(0, -0.72, 0.3, 0.1, true);
    this._wheel(0, 0.68, 0.3, 0.12, false);
    this.seat = { x: 0, y: 0.45, z: 0.25 };
  }

  /** Sincroniza con el estado de la simulación. */
  sync(v, dt, night, siren = false) {
    this.group.position.set(v.x, v.y, v.z);
    this.group.rotation.set(v.pitch, v.heading, v.roll + (v.lean ?? 0));
    for (const w of this.wheels) w.rotation.x = -v.wheelSpin;
    for (const p of this.frontPivots) p.rotation.y = -v.steer;
    if (this.lights.head) this.lights.head.emissiveIntensity = 0.2 + night * 4;
    if (this.lights.tail) {
      const braking = v.throttle === 0 && Math.abs(v.forwardSpeed) > 0.5;
      this.lights.tail.emissiveIntensity = 0.3 + night * 1.2 + (braking ? 2.5 : 0);
    }
    if (this.lights.sign) this.lights.sign.emissiveIntensity = 0.3 + night * 1.5;
    if (this.lights.bar.length) {
      this.sirenPhase += dt * 8;
      const on = siren ? Math.sin(this.sirenPhase) > 0 : false;
      this.lights.bar[0].emissiveIntensity = siren ? (on ? 6 : 0.2) : 0.1;
      this.lights.bar[1].emissiveIntensity = siren ? (on ? 0.2 : 6) : 0.1;
    }
    if (v.destroyed && !this.burnt) this.burn();
  }

  burn() {
    this.burnt = true;
    const burnt = shared('burnt', () => new THREE.MeshStandardMaterial({ color: 0x151210, roughness: 1 }));
    this.group.traverse((o) => {
      if (o.isMesh && o.material !== tireMat()) o.material = burnt;
    });
  }

  dispose() {
    this.group.removeFromParent();
  }
}
