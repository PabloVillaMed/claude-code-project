// Efectos visuales: trazadoras, fogonazos, chispas, sangre, humo, fuego,
// explosiones y marcadores de misión / puntos de interés.

import * as THREE from 'three';
import { glowSprite } from './cityRenderer.js';

const MAX_PARTICLES = 1500;

export class Effects {
  constructor(scene) {
    this.scene = scene;
    // Partículas en un único Points con atributos dinámicos.
    this.pPos = new Float32Array(MAX_PARTICLES * 3);
    this.pCol = new Float32Array(MAX_PARTICLES * 3);
    this.pSize = new Float32Array(MAX_PARTICLES);
    this.particles = [];
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pPos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.pCol, 3));
    g.setAttribute('size', new THREE.BufferAttribute(this.pSize, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: glowSprite() } },
      vertexShader: /* glsl */ `
        attribute float size;
        attribute vec3 color;
        varying vec3 vColor;
        void main() {
          vColor = color;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * (420.0 / -mv.z);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D map;
        varying vec3 vColor;
        void main() {
          vec4 t = texture2D(map, gl_PointCoord);
          gl_FragColor = vec4(vColor * t.a, t.a);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(g, mat);
    this.points.frustumCulled = false;
    scene.add(this.points);

    // Humo (no aditivo, oscuro).
    this.smokePos = new Float32Array(400 * 3);
    this.smokeCol = new Float32Array(400 * 4);
    this.smokeSize = new Float32Array(400);
    this.smoke = [];
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(this.smokePos, 3));
    sg.setAttribute('color4', new THREE.BufferAttribute(this.smokeCol, 4));
    sg.setAttribute('size', new THREE.BufferAttribute(this.smokeSize, 1));
    const smat = new THREE.ShaderMaterial({
      uniforms: { map: { value: glowSprite() } },
      vertexShader: /* glsl */ `
        attribute float size;
        attribute vec4 color4;
        varying vec4 vColor;
        void main() {
          vColor = color4;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * (420.0 / -mv.z);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D map;
        varying vec4 vColor;
        void main() {
          float a = texture2D(map, gl_PointCoord).a * vColor.a;
          gl_FragColor = vec4(vColor.rgb, a);
        }
      `,
      transparent: true,
      depthWrite: false,
    });
    this.smokePoints = new THREE.Points(sg, smat);
    this.smokePoints.frustumCulled = false;
    scene.add(this.smokePoints);

    // Trazadoras.
    this.tracers = [];
    this.tracerMat = new THREE.LineBasicMaterial({ color: 0xffe2a0, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });

    // Luz de fogonazo / explosión reutilizable.
    this.flashLight = new THREE.PointLight(0xffb060, 0, 12, 2);
    scene.add(this.flashLight);
    this.flashTime = 0;
    this.explosions = [];
    this.fires = [];

    // Marcadores.
    this.markers = new Map();
    this.markerTime = 0;
  }

  _spawn(p) {
    if (this.particles.length >= MAX_PARTICLES) this.particles.shift();
    this.particles.push(p);
  }

  muzzleFlash(pos, dir) {
    for (let i = 0; i < 6; i++) {
      this._spawn({ x: pos.x, y: pos.y, z: pos.z, vx: dir.x * (4 + Math.random() * 6) + (Math.random() - 0.5), vy: dir.y * 5 + (Math.random() - 0.5), vz: dir.z * (4 + Math.random() * 6) + (Math.random() - 0.5), life: 0.06, max: 0.06, r: 1, g: 0.75, b: 0.35, size: 0.5, grav: 0 });
    }
    this.flashLight.position.copy(pos);
    this.flashLight.intensity = 30;
    this.flashLight.distance = 10;
    this.flashTime = 0.05;
  }

  tracer(from, to) {
    const g = new THREE.BufferGeometry().setFromPoints([from.clone(), to.clone()]);
    const line = new THREE.Line(g, this.tracerMat.clone());
    this.scene.add(line);
    this.tracers.push({ line, life: 0.07 });
  }

  impact(pos, normal, kind = 'spark') {
    if (kind === 'blood') {
      // La sangre no puede ser aditiva: va en el sistema de humo (alfa normal).
      for (let i = 0; i < 7; i++) {
        this.puff({ x: pos.x + (Math.random() - 0.5) * 0.2, y: pos.y + (Math.random() - 0.5) * 0.2, z: pos.z + (Math.random() - 0.5) * 0.2 }, 0.18, [0.42, 0.02, 0.02], 0.95, (Math.random() - 0.3) * 1.5, 0.45);
      }
      return;
    }
    const n = 10;
    for (let i = 0; i < n; i++) {
      const s = kind === 'blood' ? 2.5 : 5;
      const col = kind === 'blood' ? [0.5, 0.02, 0.02] : kind === 'dust' ? [0.45, 0.4, 0.35] : [1, 0.8, 0.4];
      this._spawn({
        x: pos.x,
        y: pos.y,
        z: pos.z,
        vx: (normal?.x ?? 0) * s + (Math.random() - 0.5) * s,
        vy: (normal?.y ?? 0) * s + Math.random() * s * 0.6,
        vz: (normal?.z ?? 0) * s + (Math.random() - 0.5) * s,
        life: kind === 'blood' ? 0.5 : 0.25,
        max: kind === 'blood' ? 0.5 : 0.25,
        r: col[0],
        g: col[1],
        b: col[2],
        size: kind === 'blood' ? 0.22 : 0.12,
        grav: 9.8,
        additive: kind !== 'blood',
      });
    }
    if (kind === 'dust') this.puff(pos, 0.5, [0.5, 0.47, 0.42], 0.4);
  }

  puff(pos, size = 1, color = [0.2, 0.2, 0.2], alpha = 0.6, vy = 1.2, life = 2) {
    if (this.smoke.length >= 400) this.smoke.shift();
    this.smoke.push({ x: pos.x, y: pos.y, z: pos.z, vx: (Math.random() - 0.5) * 0.6, vy, vz: (Math.random() - 0.5) * 0.6, life, max: life, size, grow: size * 1.5, color, alpha });
  }

  explosion(pos) {
    for (let i = 0; i < 120; i++) {
      const a = Math.random() * Math.PI * 2;
      const e = Math.random() * Math.PI - Math.PI / 4;
      const s = 6 + Math.random() * 14;
      this._spawn({ x: pos.x, y: pos.y + 0.5, z: pos.z, vx: Math.cos(a) * Math.cos(e) * s, vy: Math.sin(e) * s + 4, vz: Math.sin(a) * Math.cos(e) * s, life: 0.8, max: 0.8, r: 1, g: 0.55 + Math.random() * 0.3, b: 0.15, size: 1.2 + Math.random() * 1.5, grav: 6 });
    }
    for (let i = 0; i < 25; i++) this.puff({ x: pos.x + (Math.random() - 0.5) * 3, y: pos.y + 1, z: pos.z + (Math.random() - 0.5) * 3 }, 2.5, [0.08, 0.07, 0.07], 0.85, 2.5 + Math.random() * 2, 4);
    this.flashLight.position.set(pos.x, pos.y + 2, pos.z);
    this.flashLight.intensity = 800;
    this.flashLight.distance = 40;
    this.flashTime = 0.4;
  }

  /** Fuego continuo (vehículo en llamas). Devuelve un id para apagarlo. */
  fire(getPos, duration = 6) {
    const f = { getPos, t: duration, acc: 0 };
    this.fires.push(f);
    return f;
  }

  /** Marcador vertical (haz de luz) para objetivos y tiendas. */
  setMarker(id, pos, color = 0xffd200, height = 3.5) {
    let m = this.markers.get(id);
    if (!m) {
      const group = new THREE.Group();
      const beam = new THREE.Mesh(
        new THREE.CylinderGeometry(0.9, 0.9, height, 24, 1, true),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.14, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }),
      );
      beam.position.y = height / 2;
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.95, 0.06, 8, 32).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color }));
      ring.position.y = 0.1;
      const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.35, 0.7, 4).rotateX(Math.PI), new THREE.MeshBasicMaterial({ color }));
      arrow.position.y = height + 0.8;
      group.add(beam, ring, arrow);
      this.scene.add(group);
      m = { group, arrow };
      this.markers.set(id, m);
    }
    m.group.position.copy(pos);
    m.group.visible = true;
    return m;
  }

  removeMarker(id) {
    const m = this.markers.get(id);
    if (m) {
      m.group.removeFromParent();
      this.markers.delete(id);
    }
  }

  update(dt) {
    this.markerTime += dt;
    for (const m of this.markers.values()) {
      m.arrow.position.y = m.arrow.position.y * 0 + 4.3 + Math.sin(this.markerTime * 3) * 0.25;
      m.arrow.rotation.y += dt * 2;
    }
    // Partículas.
    const P = this.particles;
    for (let i = P.length - 1; i >= 0; i--) {
      const p = P[i];
      p.life -= dt;
      if (p.life <= 0) {
        P.splice(i, 1);
        continue;
      }
      p.vy -= p.grav * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
    }
    for (let i = 0; i < MAX_PARTICLES; i++) {
      const p = P[i];
      if (p) {
        const f = p.life / p.max;
        this.pPos[i * 3] = p.x;
        this.pPos[i * 3 + 1] = p.y;
        this.pPos[i * 3 + 2] = p.z;
        const k = p.additive === false ? 1 : f;
        this.pCol[i * 3] = p.r * k;
        this.pCol[i * 3 + 1] = p.g * k;
        this.pCol[i * 3 + 2] = p.b * k;
        this.pSize[i] = p.size * (0.5 + f * 0.5);
      } else {
        this.pSize[i] = 0;
      }
    }
    const pg = this.points.geometry;
    pg.attributes.position.needsUpdate = true;
    pg.attributes.color.needsUpdate = true;
    pg.attributes.size.needsUpdate = true;

    // Humo.
    const S = this.smoke;
    for (let i = S.length - 1; i >= 0; i--) {
      const s = S[i];
      s.life -= dt;
      if (s.life <= 0) {
        S.splice(i, 1);
        continue;
      }
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.z += s.vz * dt;
      s.size += s.grow * dt;
    }
    for (let i = 0; i < 400; i++) {
      const s = S[i];
      if (s) {
        const f = s.life / s.max;
        this.smokePos.set([s.x, s.y, s.z], i * 3);
        this.smokeCol.set([s.color[0], s.color[1], s.color[2], s.alpha * f], i * 4);
        this.smokeSize[i] = s.size;
      } else {
        this.smokeSize[i] = 0;
      }
    }
    const sg = this.smokePoints.geometry;
    sg.attributes.position.needsUpdate = true;
    sg.attributes.color4.needsUpdate = true;
    sg.attributes.size.needsUpdate = true;

    // Fuego.
    for (let i = this.fires.length - 1; i >= 0; i--) {
      const f = this.fires[i];
      f.t -= dt;
      f.acc += dt;
      const pos = f.getPos();
      while (f.acc > 0.03) {
        f.acc -= 0.03;
        this._spawn({ x: pos.x + (Math.random() - 0.5) * 1.2, y: pos.y + 0.8, z: pos.z + (Math.random() - 0.5) * 1.2, vx: (Math.random() - 0.5) * 0.5, vy: 2 + Math.random() * 2, vz: (Math.random() - 0.5) * 0.5, life: 0.5, max: 0.5, r: 1, g: 0.45 + Math.random() * 0.2, b: 0.1, size: 0.9, grav: 0 });
        if (Math.random() < 0.3) this.puff({ x: pos.x, y: pos.y + 1.5, z: pos.z }, 1.2, [0.07, 0.07, 0.07], 0.6, 2.2, 3);
      }
      if (f.t <= 0) this.fires.splice(i, 1);
    }

    // Trazadoras.
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const t = this.tracers[i];
      t.life -= dt;
      t.line.material.opacity = Math.max(0, t.life / 0.07);
      if (t.life <= 0) {
        t.line.removeFromParent();
        t.line.geometry.dispose();
        t.line.material.dispose();
        this.tracers.splice(i, 1);
      }
    }
    if (this.flashTime > 0) {
      this.flashTime -= dt;
      if (this.flashTime <= 0) this.flashLight.intensity = 0;
      else this.flashLight.intensity *= 0.85;
    }
  }
}
