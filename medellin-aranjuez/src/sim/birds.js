// Pájaros del barrio (lógica pura, sin Three.js):
//  - Palomas en parques y plazas: caminan y picotean; si el jugador se
//    acerca (o pasa un carro, o suena un tiro) la bandada entera arranca a
//    volar, da vueltas sobre la plaza y vuelve a bajar cuando está tranquila.
//  - Gallinazos planeando en las térmicas, muy alto sobre el valle, de día.
//  - Bandadas de loros que cruzan el cielo al amanecer y al atardecer, gritando.
// Unas pocas decenas de pájaros como máximo: render/birds.js los dibuja en
// una sola malla instanciada, con el aleteo en el sombreador.

import { clamp, smoothstep } from './math.js';
import { makeRng } from './rng.js';

export const BIRD_LIMITS = { flocksActive: 3, pigeonsPerFlock: 8, vultures: 7, parrotFlocks: 2, parrotsPerFlock: 8 };
/** Máximo de pájaros a la vez (tamaño de la malla instanciada). */
export const MAX_BIRDS = BIRD_LIMITS.flocksActive * BIRD_LIMITS.pigeonsPerFlock + BIRD_LIMITS.vultures + BIRD_LIMITS.parrotFlocks * BIRD_LIMITS.parrotsPerFlock;

const ACTIVE_RADIUS = 140; // palomas simuladas y dibujadas solo cerca del jugador
const SHOT_RADIUS = 45;

/** ¿Hora de loros? Salen de los dormideros al amanecer y vuelven al atardecer. */
export function parrotWindow(hour) {
  return (hour >= 5.5 && hour <= 7.3) || (hour >= 17 && hour <= 18.7);
}

/** Cuántos gallinazos planean según la hora (necesitan las térmicas del día). */
export function vultureCount(hour) {
  const k = smoothstep(7, 8.5, hour) * (1 - smoothstep(16.5, 17.8, hour));
  return Math.round(BIRD_LIMITS.vultures * k);
}

/**
 * ¿Asusta esto a las palomas? Distancia a la que se espantan según quién
 * se acerca: a pie depende de la rapidez (caminando se puede llegar cerca),
 * un vehículo en marcha a unos metros.
 */
export function scareDistance(speed, inVehicle) {
  if (inVehicle) return speed > 2 ? 7 + speed * 0.25 : 2.5;
  return 3 + clamp(speed, 0, 8) * 0.9;
}

/** Plazas y parques donde hay palomas (ids de los lugares del mapa). */
export const PIGEON_PLACES = ['parque', 'iglesia', 'cayetano', 'consuelo', 'cancha', 'mercado', 'madreLaura', 'bermejala', 'claret', 'sanesteban', 'metro'];

/**
 * Busca, alrededor de cada lugar, puntos de piso libres y parejos (sin muros
 * ni desniveles) donde puedan caminar las palomas. `blocked(x, z)` dice si
 * hay un obstáculo; los lugares con muy pocos puntos libres se descartan.
 */
export function pigeonHomes(pois, groundHeight, blocked, places = PIGEON_PLACES) {
  const homes = [];
  for (const id of places) {
    const poi = pois.find((q) => q.id === id);
    if (!poi) continue;
    const y0 = groundHeight(poi.x, poi.z);
    const spots = [];
    for (let r = 0; r <= 10; r += 2) {
      const n = r === 0 ? 1 : Math.round(r * 2.2);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + r;
        const x = poi.x + Math.cos(a) * r;
        const z = poi.z + Math.sin(a) * r;
        if (Math.abs(groundHeight(x, z) - y0) > 0.8 || blocked(x, z)) continue;
        spots.push({ x, z });
      }
    }
    if (spots.length < 6) continue;
    // El centro de la bandada es el promedio de los puntos libres.
    const cx = spots.reduce((s, p) => s + p.x, 0) / spots.length;
    const cz = spots.reduce((s, p) => s + p.z, 0) / spots.length;
    homes.push({ id, x: cx, z: cz, spots });
  }
  return homes;
}

function makeBird(kind, x, y, z, rng) {
  return { kind, x, y, z, vx: 0, vy: 0, vz: 0, yaw: rng.range(-Math.PI, Math.PI), pitch: 0, bank: 0, phase: rng.range(0, 6.28), freq: 7, amp: 0, ground: 0, scale: 1, state: 'ground', t: 0, wait: rng.range(0, 3), delay: 0, target: null, visible: true };
}

/** Rumbo de la geometría (mira hacia +Z) para una velocidad. */
const headingOf = (vx, vz) => Math.atan2(vx, vz);

function wrap(a) {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

export class BirdSim {
  /**
   * @param {{ homes: {x:number,z:number,spots:{x:number,z:number}[]}[], groundHeight: (x:number,z:number)=>number, seed?: number }} opts
   * homes: plazas y parques con puntos de piso libres (sin muros) para las palomas.
   */
  constructor({ homes, groundHeight, seed = 11 }) {
    this.rng = makeRng(seed);
    this.gh = groundHeight;
    this.time = 0;
    this.flocks = homes.filter((h) => h.spots.length > 0).map((h, i) => ({ id: i, home: h, birds: null, state: 'ground', timer: 0, calm: 0, threat: null, active: false }));
    this.vultures = [];
    this.thermals = [];
    this.parrots = [];
    this.parrotTimer = 4;
    this.shots = [];
    this.events = [];
    this.list = []; // pájaros visibles este cuadro (para dibujar)
  }

  /** Un tiro o una explosión: se espantan las palomas cercanas. */
  alarm(x, z, radius = SHOT_RADIUS) {
    this.shots.push({ x, z, r: radius });
  }

  /**
   * ctx = { player: {x,y,z,speed,inVehicle}, vehicles?: [{x,z,speed}], hour, focus?: {x,z} }
   * Devuelve la lista de pájaros a dibujar; los sonidos quedan en `events`.
   */
  update(dt, ctx) {
    this.time += dt;
    this.events.length = 0;
    const p = ctx.player;
    const focus = ctx.focus ?? p;
    this._pigeons(dt, p, focus, ctx.vehicles ?? []);
    this._vultures(dt, focus, ctx.hour);
    this._parrots(dt, focus, ctx.hour);
    this.shots.length = 0;
    const out = this.list;
    out.length = 0;
    for (const f of this.flocks) if (f.active) for (const b of f.birds) out.push(b);
    for (const b of this.vultures) out.push(b);
    for (const fl of this.parrots) for (const b of fl.birds) out.push(b);
    return out;
  }

  // ---------------------------------------------------------------- palomas
  _pigeons(dt, p, focus, vehicles) {
    const rng = this.rng;
    // Solo las bandadas más cercanas.
    const near = this.flocks
      .map((f) => ({ f, d: Math.hypot(f.home.x - focus.x, f.home.z - focus.z) }))
      .filter((o) => o.d < ACTIVE_RADIUS)
      .sort((a, b) => a.d - b.d)
      .slice(0, BIRD_LIMITS.flocksActive)
      .map((o) => o.f);
    for (const f of this.flocks) {
      const on = near.includes(f);
      if (on && !f.active) this._spawnFlock(f);
      f.active = on;
    }
    for (const f of near) {
      const hx = f.home.x;
      const hz = f.home.z;
      // ¿Algo las asusta?
      let threat = null;
      const dp = Math.hypot(p.x - hx, p.z - hz);
      if (!p.dead && dp < 16) {
        for (const b of f.birds) {
          if (b.state !== 'ground' && b.state !== 'land') continue;
          if (Math.hypot(b.x - p.x, b.z - p.z) < scareDistance(p.speed ?? 0, !!p.inVehicle)) {
            threat = { x: p.x, z: p.z };
            break;
          }
        }
      }
      if (!threat) {
        for (const v of vehicles) {
          if (Math.abs(v.x - hx) > 14 || Math.abs(v.z - hz) > 14 || (v.speed ?? 0) < 2) continue;
          for (const b of f.birds) {
            if (b.state === 'ground' && Math.hypot(b.x - v.x, b.z - v.z) < scareDistance(v.speed, true)) {
              threat = { x: v.x, z: v.z };
              break;
            }
          }
          if (threat) break;
        }
      }
      for (const s of this.shots) if (Math.hypot(s.x - hx, s.z - hz) < s.r) threat = { x: s.x, z: s.z, shot: true };
      if (threat) {
        f.calm = 0;
        if (f.state === 'ground' || f.state === 'land') {
          f.state = 'fly';
          f.timer = rng.range(7, 12);
          for (const b of f.birds) {
            const ax = b.x - threat.x;
            const az = b.z - threat.z;
            const al = Math.hypot(ax, az) || 1;
            b.state = 'takeoff';
            b.delay = rng.range(0, threat.shot ? 0.15 : 0.35);
            b.t = 0;
            b.vx = (ax / al) * rng.range(3, 5) + rng.range(-1, 1);
            b.vz = (az / al) * rng.range(3, 5) + rng.range(-1, 1);
            b.vy = rng.range(3.2, 4.6);
            b.orbit = rng.range(0, Math.PI * 2);
          }
          this.events.push({ type: 'aleteo', x: hx, y: this.gh(hx, hz) + 1, z: hz, n: f.birds.length });
        } else f.timer = Math.max(f.timer, 5);
      } else f.calm += dt;

      if (f.state === 'fly') {
        f.timer -= dt;
        if (f.timer <= 0 && f.calm > 4 && dp > 9) {
          f.state = 'land';
          for (const b of f.birds) {
            b.state = 'land';
            b.target = this._spot(f);
          }
        }
      }
      if (f.state === 'land' && f.birds.every((b) => b.state === 'ground')) f.state = 'ground';
      // Zureo de vez en cuando si el jugador está cerca y todo está tranquilo.
      if (f.state === 'ground' && dp < 18 && rng.chance(dt * 0.25)) {
        const b = f.birds[Math.floor(rng.next() * f.birds.length)];
        this.events.push({ type: 'zureo', x: b.x, y: b.y + 0.2, z: b.z });
      }
      for (const b of f.birds) this._pigeon(dt, f, b);
    }
  }

  _spawnFlock(f) {
    const rng = this.rng;
    f.birds = [];
    f.state = 'ground';
    const n = rng.int(5, BIRD_LIMITS.pigeonsPerFlock);
    for (let i = 0; i < n; i++) {
      const s = this._spot(f);
      const b = makeBird('paloma', s.x, this.gh(s.x, s.z), s.z, rng);
      b.target = this._spot(f);
      b.scale = rng.range(0.9, 1.08);
      f.birds.push(b);
    }
  }

  _spot(f) {
    const s = this.rng.pick(f.home.spots);
    return { x: s.x + this.rng.range(-0.8, 0.8), z: s.z + this.rng.range(-0.8, 0.8) };
  }

  _pigeon(dt, f, b) {
    const rng = this.rng;
    b.t += dt;
    const gy = (x, z) => this.gh(x, z);
    if (b.state === 'ground') {
      // Caminar a saltitos hacia un punto, picotear un rato, elegir otro.
      b.ground = 1;
      b.amp = 0;
      b.pitch = 0;
      b.bank = 0;
      if (b.wait > 0) {
        b.wait -= dt;
        b.freq = 6; // picotear
      } else {
        const dx = b.target.x - b.x;
        const dz = b.target.z - b.z;
        const d = Math.hypot(dx, dz);
        if (d > 0.08) {
          const sp = 0.38;
          b.x += (dx / d) * Math.min(d, sp * dt);
          b.z += (dz / d) * Math.min(d, sp * dt);
          b.yaw = headingOf(dx, dz);
          b.freq = 9; // cabeceo al caminar
        } else {
          b.wait = rng.range(1.5, 5); // se queda picoteando y luego busca otro punto
          b.target = this._spot(f);
        }
      }
      b.y = gy(b.x, b.z);
      b.vx = b.vy = b.vz = 0;
      return;
    }
    b.ground = 0;
    if (b.state === 'takeoff') {
      if (b.t < b.delay) {
        b.ground = 1;
        return;
      }
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.z += b.vz * dt;
      b.vy = Math.max(1.2, b.vy - 1.2 * dt);
      b.amp = 1;
      b.freq = 16;
      if (b.t > b.delay + 1.3) b.state = 'circle';
    } else if (b.state === 'circle') {
      // Vueltas sobre la plaza: seguir un punto que gira alrededor de ella.
      b.orbit += dt * 0.55;
      const R = 13 + (b.phase % 1) * 6;
      const tx = f.home.x + Math.cos(b.orbit) * R;
      const tz = f.home.z + Math.sin(b.orbit) * R;
      const ty = gy(f.home.x, f.home.z) + 12 + (b.phase % 1.7) * 3;
      this._seek(b, tx, ty, tz, 8.5, 2.2, dt);
      // Aletea y planea a ratos.
      const glide = Math.sin(this.time * 0.9 + b.phase * 3) > 0.35;
      b.amp = glide ? 0.12 : 0.8;
      b.freq = glide ? 3 : 12;
    } else if (b.state === 'land') {
      const tx = b.target.x;
      const tz = b.target.z;
      const ty = gy(tx, tz);
      const d = Math.hypot(tx - b.x, tz - b.z);
      const sp = Math.min(8, d * 0.9 + 1.2);
      this._seek(b, tx, ty + Math.min(d * 0.35, 10), tz, sp, 3, dt);
      b.amp = d < 6 ? 0.95 : 0.5; // frena aleteando al llegar
      b.freq = d < 6 ? 14 : 10;
      if (d < 1.5) {
        // Últimos metros: se posa directo (sin pasarse del punto).
        const k = Math.min(1, dt * 3);
        b.x += (tx - b.x) * k;
        b.z += (tz - b.z) * k;
        b.y += (ty - b.y) * k;
      }
      b.landT = (b.landT ?? 0) + dt;
      if ((d < 0.5 && b.y - ty < 0.6) || b.landT > 15) {
        b.landT = 0;
        b.x = tx;
        b.z = tz;
        b.state = 'ground';
        b.y = ty;
        b.wait = rng.range(0.5, 2);
        b.target = this._spot(f);
      }
    }
    b.yaw = headingOf(b.vx, b.vz);
    const hs = Math.hypot(b.vx, b.vz);
    b.pitch = clamp(Math.atan2(b.vy, hs + 0.01), -0.6, 0.8);
  }

  /** Dirige la velocidad hacia un punto (giro suave, `k` = agilidad). */
  _seek(b, tx, ty, tz, speed, k, dt) {
    const dx = tx - b.x;
    const dy = ty - b.y;
    const dz = tz - b.z;
    const d = Math.hypot(dx, dy, dz) || 1;
    const a = 1 - Math.exp(-k * dt);
    const prevYaw = headingOf(b.vx, b.vz);
    b.vx += ((dx / d) * speed - b.vx) * a;
    b.vy += ((dy / d) * speed - b.vy) * a;
    b.vz += ((dz / d) * speed - b.vz) * a;
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.z += b.vz * dt;
    const turn = wrap(headingOf(b.vx, b.vz) - prevYaw) / Math.max(dt, 1e-3);
    b.bank += (clamp(-turn * 0.35, -0.9, 0.9) - b.bank) * a;
  }

  // ---------------------------------------------------------------- gallinazos
  _vultures(dt, focus, hour) {
    const rng = this.rng;
    const want = vultureCount(hour);
    // Dos térmicas cerca del jugador; si se aleja mucho, otras nuevas.
    for (let i = 0; i < 2; i++) {
      let th = this.thermals[i];
      if (!th || Math.hypot(th.x - focus.x, th.z - focus.z) > 650) {
        const a = rng.range(0, Math.PI * 2);
        const r = rng.range(120, 320);
        const x = focus.x + Math.cos(a) * r;
        const z = focus.z + Math.sin(a) * r;
        th = this.thermals[i] = { x, z, base: Math.max(this.gh(x, z), this.gh(focus.x, focus.z)) + rng.range(95, 150), r: rng.range(35, 60) };
      }
      // Las térmicas derivan despacio con el viento (del oriente).
      th.x -= dt * 0.6;
    }
    while (this.vultures.length > want) this.vultures.pop();
    while (this.vultures.length < want) {
      const i = this.vultures.length;
      const th = this.thermals[i % 2];
      const b = makeBird('gallinazo', th.x, th.base, th.z, rng);
      b.scale = rng.range(2.1, 2.5);
      b.th = i % 2;
      b.ang = rng.range(0, Math.PI * 2);
      b.climb = rng.range(0, 60);
      b.dir = rng.chance(0.5) ? 1 : -1;
      b.flapT = rng.range(4, 14);
      b.state = 'soar';
      this.vultures.push(b);
    }
    for (const b of this.vultures) {
      const th = this.thermals[b.th];
      const R = th.r * (0.8 + 0.4 * ((b.phase * 7) % 1));
      const v = 10;
      b.ang += (v / R) * dt * b.dir;
      // Suben en espiral por la térmica y vuelven a empezar abajo.
      b.climb = (b.climb + dt * 0.9) % 80;
      const x = th.x + Math.cos(b.ang) * R;
      const z = th.z + Math.sin(b.ang) * R;
      const y = th.base + b.climb;
      b.vx = (x - b.x) / Math.max(dt, 1e-3);
      b.vz = (z - b.z) / Math.max(dt, 1e-3);
      b.x = x;
      b.y = y;
      b.z = z;
      // Tangente del círculo (no depende del cuadro).
      b.yaw = headingOf(-Math.sin(b.ang) * b.dir, Math.cos(b.ang) * b.dir);
      b.bank = -0.28 * b.dir;
      b.pitch = 0.04;
      // Casi siempre planeando (alas quietas); de vez en cuando unos aletazos lentos.
      b.flapT -= dt;
      if (b.flapT < 0) {
        b.amp = 0.55;
        b.freq = 4.5;
        if (b.flapT < -1.4) b.flapT = rng.range(8, 18);
      } else {
        b.amp = 0.05;
        b.freq = 1.3;
      }
    }
  }

  // ---------------------------------------------------------------- loros
  _parrots(dt, focus, hour) {
    const rng = this.rng;
    if (parrotWindow(hour)) {
      this.parrotTimer -= dt;
      if (this.parrotTimer <= 0 && this.parrots.length < BIRD_LIMITS.parrotFlocks) {
        this.parrotTimer = rng.range(22, 50);
        this._spawnParrots(focus);
      }
    } else this.parrotTimer = Math.min(this.parrotTimer, rng.range(3, 8));
    for (let i = this.parrots.length - 1; i >= 0; i--) {
      const fl = this.parrots[i];
      fl.s += fl.speed * dt;
      const cx = fl.x0 + fl.dx * fl.s;
      const cz = fl.z0 + fl.dz * fl.s;
      const yaw = headingOf(fl.dx, fl.dz);
      for (const b of fl.birds) {
        // Formación suelta: cada uno ondula un poco alrededor de su puesto.
        const w = this.time * b.wf + b.phase;
        b.x = cx + b.ox * fl.dz + b.oz * fl.dx + Math.sin(w) * 0.8;
        b.z = cz - b.ox * fl.dx + b.oz * fl.dz + Math.cos(w * 0.7) * 0.8;
        b.y = fl.y + b.oy + Math.sin(w * 1.3) * 0.6;
        b.yaw = yaw + Math.sin(w) * 0.08;
        b.bank = Math.cos(w) * 0.15;
        b.pitch = Math.cos(w * 1.3) * 0.08;
        const glide = Math.sin(this.time * 1.7 + b.phase * 5) > 0.8;
        b.amp = glide ? 0.1 : 0.72;
        b.freq = glide ? 3 : 21;
      }
      // Gritos mientras pasan (se oyen si están cerca).
      fl.call -= dt;
      if (fl.call <= 0) {
        fl.call = rng.range(0.25, 0.9);
        const b = rng.pick(fl.birds);
        if (Math.hypot(b.x - focus.x, b.z - focus.z) < 160) this.events.push({ type: 'loro', x: b.x, y: b.y, z: b.z });
      }
      if (fl.s > fl.len) this.parrots.splice(i, 1);
    }
  }

  _spawnParrots(focus) {
    const rng = this.rng;
    const a = rng.range(0, Math.PI * 2);
    const dx = Math.cos(a);
    const dz = Math.sin(a);
    const off = rng.range(-70, 70);
    const L = 330;
    const fl = { x0: focus.x - dx * L + dz * off, z0: focus.z - dz * L - dx * off, dx, dz, s: 0, len: L * 2, speed: rng.range(12, 15), y: this.gh(focus.x, focus.z) + rng.range(24, 42), birds: [], call: 0.5 };
    const n = rng.int(5, BIRD_LIMITS.parrotsPerFlock);
    for (let i = 0; i < n; i++) {
      const b = makeBird('loro', fl.x0, fl.y, fl.z0, rng);
      b.state = 'fly';
      b.ox = rng.range(-6, 6);
      b.oz = rng.range(-7, 3);
      b.oy = rng.range(-2, 2);
      b.wf = rng.range(0.8, 1.4);
      b.scale = rng.range(0.95, 1.1);
      fl.birds.push(b);
    }
    this.parrots.push(fl);
  }
}
