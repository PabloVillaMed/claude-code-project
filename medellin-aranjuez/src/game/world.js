// Población viva del barrio: tráfico, peatones, policía y pandilla.
// Une la simulación pura (sim/*) con los modelos 3D (render/*).

import { makeRng } from '../sim/rng.js';
import { dist2D, forwardX, forwardZ, yawFromDir } from '../sim/math.js';
import { groundHeight, onRoad } from '../sim/terrain.js';
import { createVehicleState, stepVehicle, vehicleObb, exitPoint, emptyDriveInput } from '../sim/vehiclePhysics.js';
import { RoadGraph, autopilot, lanePoint, obstacleAhead } from '../sim/roadNav.js';
import { createPed, nearestBlock, stepPed, PED } from '../sim/pedAI.js';
import { pointInPoly } from '../sim/geom2d.js';
import { POLICE_AI, canSee, planOfficerSearch, planPatrol } from '../sim/policeAI.js';
import { VehicleView } from '../render/vehicleMesh.js';
import { CharacterRig, randomLook } from '../render/characterRig.js';
import { walkStyle, walkSpeedScale, standingActivity, walkingActivity, speechGesture, idleVariant } from '../sim/animSelect.js';
import { Activities } from './activities.js';

let nextId = 1;

export class VehicleEntity {
  constructor(world, type, x, z, heading, opts = {}) {
    this.id = nextId++;
    this.world = world;
    this.state = createVehicleState(type, x, z, heading, groundHeight);
    this.view = new VehicleView(type, opts);
    world.scene.add(this.view.group);
    this.kind = opts.kind ?? 'parked';
    this.agent = opts.agent ?? null;
    this.driver = null; // 'player' | PedEntity
    this.driverRig = null;
    this.siren = false;
    this.cruise = opts.cruise ?? 11 + world.rng.next() * 3;
    this.burnTimer = -1;
    this.exploded = false;
    this.panic = 0;
    this.honk = 0;
    this.persistent = !!opts.persistent;
    this.input = emptyDriveInput();
    this.view.sync(this.state, 0, 0);
  }

  get type() {
    return this.state.type;
  }

  get pos() {
    return { x: this.state.x, y: this.state.y, z: this.state.z };
  }

  obb(pad = 0) {
    const o = vehicleObb(this.state, pad);
    o.mass = this.state.spec.mass;
    return o;
  }

  setDriverRig(look) {
    this.clearDriverRig();
    const rig = new CharacterRig(look);
    const seat = this.view.seat;
    rig.root.position.set(seat.x, seat.y - 0.5 + (this.type === 'moto' ? 0.35 : 0), seat.z);
    this.view.group.add(rig.root);
    this.driverRig = rig;
    this.driverLook = look;
  }

  clearDriverRig() {
    if (this.driverRig) {
      this.driverRig.dispose();
      this.driverRig = null;
    }
  }

  dispose() {
    this.clearDriverRig();
    this.view.dispose();
  }
}

export class PedEntity {
  constructor(world, sim, look, opts = {}) {
    this.id = nextId++;
    this.world = world;
    this.sim = sim;
    this.rig = new CharacterRig(look);
    this.look = look;
    world.scene.add(this.rig.root);
    this.faction = opts.faction ?? 'civil';
    this.weapon = opts.weapon ?? null;
    this.rig.setWeapon(this.weapon);
    this.fireCooldown = 1 + world.rng.next();
    this.deadTimer = 0;
    this.health = opts.health ?? 100;
    this.y = groundHeight(sim.x, sim.z);
    this.police = opts.police ?? null; // unidad de policía a la que pertenece
    this.missionGang = !!opts.missionGang;
    this.alerted = false;
    this.aggroRange = opts.aggroRange ?? 35;
    this.speech = 0;
    // Forma de caminar (pandilleros sobrados, rumberos de noche, gente de paseo).
    this.walkStyle = walkStyle({ id: this.id, faction: this.faction, female: !!look.female, hour: world.game?.env?.timeOfDay });
    if (sim.walkSpeed) sim.walkSpeed *= walkSpeedScale(this.walkStyle);
    this.stops = 0; // paradas / tramos: cada uno elige qué hace con las manos
    this.activity = null;
    this.lastMode = null;
    this.lastSpeech = null;
    this.idleClip = this.faction === 'civil' ? idleVariant(this.id) : null;
    this.act = null; // actividad del barrio en la que está (game/activities.js)
    this.lookT = 0;
  }

  get alive() {
    return this.sim.mode !== 'dead';
  }

  get x() {
    return this.sim.x;
  }

  get z() {
    return this.sim.z;
  }

  dispose() {
    this.rig.dispose();
  }
}

const TRAFFIC_TYPES = [
  ['taxi', 0.34],
  ['sedan', 0.24],
  ['moto', 0.22],
  ['camioneta', 0.12],
  ['buseta', 0.08],
];

export class World {
  constructor(game) {
    this.game = game;
    this.scene = game.scene;
    this.city = game.city;
    this.graph = new RoadGraph(this.city);
    this.rng = makeRng(2024);
    this.vehicles = [];
    this.peds = [];
    this.policeUnits = [];
    this.threats = [];
    this.quality = game.quality;
    this.spawnTimer = 0;
    this.blockIndex = this._indexBlocks();
    this.pedWorld = {
      blocks: this.city.blocks,
      blockAt: (x, z) => this.blockAt(x, z),
      collision: this.city.collision,
      rand: this.rng.next,
      threats: this.threats,
      player: { x: 0, z: 0 },
    };
    // Gente quieta del barrio: venteros detrás de su carreta y vecinos
    // sentados en las sillas plásticas frente a las tiendas.
    const spotRng = makeRng(99);
    this.fixedSpots = [];
    for (const p of this.city.props) {
      const fx = Math.sin(p.rot ?? 0);
      const fz = Math.cos(p.rot ?? 0);
      if (p.type === 'vendor') this.fixedSpots.push({ x: p.x - fx * 0.85, z: p.z - fz * 0.85, yaw: (p.rot ?? 0) + Math.PI, sit: false, ped: null });
      else if (p.type === 'chair' && spotRng.chance(0.45)) this.fixedSpots.push({ x: p.x, z: p.z, yaw: (p.rot ?? 0) + Math.PI, sit: true, ped: null });
    }
    this.fixedTimer = 0;
    // Vehículos parqueados (persistentes).
    for (const p of this.city.parkedVehicles) {
      this.vehicles.push(new VehicleEntity(this, p.type, p.x, p.z, p.heading, { kind: 'parked', persistent: true }));
    }
    // Vida cotidiana: ropa en los balcones, fumadores, dominó, picaditos...
    this.activities = new Activities(this);
  }

  _indexBlocks() {
    // Rejilla de 50 m → manzanas cuyo contorno la toca.
    const cell = 50;
    const grid = new Map();
    for (const b of this.city.blocks) {
      for (let i = Math.floor(b.minX / cell); i <= Math.floor(b.maxX / cell); i++) {
        for (let j = Math.floor(b.minZ / cell); j <= Math.floor(b.maxZ / cell); j++) {
          const k = `${i},${j}`;
          if (!grid.has(k)) grid.set(k, []);
          grid.get(k).push(b);
        }
      }
    }
    return { cell, grid };
  }

  /** Manzana (con andén) que contiene el punto, o null si está en la calzada. */
  blockAt(x, z) {
    const { cell, grid } = this.blockIndex;
    for (const b of grid.get(`${Math.floor(x / cell)},${Math.floor(z / cell)}`) ?? []) {
      if (b.ring && x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ && pointInPoly(x, z, b.curb)) return b;
    }
    return null;
  }

  /** Manzanas con andén a menos de `r` m (por caja) del punto. */
  blocksNear(x, z, r) {
    return this.city.blocks.filter((b) => b.ring && b.type !== 'rio' && x > b.minX - r && x < b.maxX + r && z > b.minZ - r && z < b.maxZ + r);
  }

  // ------------------------------------------------------------- población
  _pickTrafficType() {
    let r = this.rng.next();
    for (const [t, p] of TRAFFIC_TYPES) {
      if (r < p) return t;
      r -= p;
    }
    return 'taxi';
  }

  spawnTraffic(px, pz, minD = 70, maxD = 200, type = null) {
    // Posición aleatoria sobre una arista, lejos del jugador.
    for (let tries = 0; tries < 20; tries++) {
      const e = this.graph.activeEdges[Math.floor(this.rng.next() * this.graph.activeEdges.length)];
      if (e.cls === 'service' || !this.graph.core.has(e.a) || !this.graph.core.has(e.b)) continue;
      const forward = e.oneway ? e.oneway === 1 : this.rng.chance(0.5);
      const from = forward ? e.a : e.b;
      const to = forward ? e.b : e.a;
      const t = this.rng.range(0.2, 0.8);
      const p = lanePoint(this.graph, from, to, t);
      const d = dist2D(p.x, p.z, px, pz);
      if (d < minD || d > maxD) continue;
      if (this.vehicles.some((v) => dist2D(v.state.x, v.state.z, p.x, p.z) < 12)) continue;
      const vt = type ?? this._pickTrafficType();
      // Busetas y camiones solo por las vías anchas.
      if (['buseta', 'camion', 'bus'].includes(vt) && e.width < 7.5) continue;
      const v = new VehicleEntity(this, vt, p.x, p.z, p.yaw, { kind: 'traffic', agent: { from, to, next: null } });
      v.state.vx = forwardX(p.yaw) * 8;
      v.state.vz = forwardZ(p.yaw) * 8;
      v.state.forwardSpeed = 8;
      v.driver = 'npc';
      v.setDriverRig(randomLook(this.rng));
      this.vehicles.push(v);
      return v;
    }
    return null;
  }

  spawnPed(px, pz, minD = 35, maxD = 110, opts = {}) {
    const near = this.blocksNear(px, pz, maxD);
    if (!near.length) return null;
    for (let tries = 0; tries < 20; tries++) {
      const b = near[Math.floor(this.rng.next() * near.length)];
      const sim = createPed(b, this.rng, opts.sim);
      const dp = dist2D(sim.x, sim.z, px, pz);
      if (dp < minD || dp > maxD) continue;
      if (this.city.collision.pointBlocked(sim.x, sim.z)) continue;
      const ped = new PedEntity(this, sim, randomLook(this.rng, opts.outfit ?? 'civil'), opts);
      this.peds.push(ped);
      return ped;
    }
    return null;
  }

  spawnPedAt(x, z, opts = {}) {
    const b = this.blockAt(x, z) ?? nearestBlock(this.city.blocks, x, z);
    const sim = createPed(b, this.rng, opts.sim);
    sim.x = x;
    sim.z = z;
    const ped = new PedEntity(this, sim, opts.look ?? randomLook(this.rng, opts.outfit ?? 'civil'), opts);
    this.peds.push(ped);
    return ped;
  }

  /** Llena de inmediato el barrio alrededor de (x, z) con peatones y tráfico. */
  populate(x, z) {
    let guard = 0;
    while (this.peds.filter((p) => p.faction === 'civil' && !p.sim.fixed).length < this.quality.peds && guard++ < this.quality.peds * 3) this.spawnPed(x, z, 12, 110);
    guard = 0;
    while (this.vehicles.filter((v) => v.kind === 'traffic').length < this.quality.traffic && guard++ < this.quality.traffic * 3) this.spawnTraffic(x, z, 30, 200);
  }

  removeVehicle(v) {
    const i = this.vehicles.indexOf(v);
    if (i >= 0) this.vehicles.splice(i, 1);
    v.dispose();
  }

  removePed(p) {
    const i = this.peds.indexOf(p);
    if (i >= 0) this.peds.splice(i, 1);
    p.dispose();
  }

  addThreat(x, z, radius = 30, time = 0.6) {
    this.threats.push({ x, z, radius, t: time });
    for (const v of this.vehicles) if (v.kind === 'traffic' && dist2D(v.state.x, v.state.z, x, z) < radius * 1.5) v.panic = 12;
  }

  /** El conductor NPC sale corriendo del vehículo (robo). */
  ejectDriver(v, fleeFrom) {
    if (v.driver !== 'npc' && !(v.driver instanceof PedEntity)) return null;
    const look = v.driverLook;
    v.clearDriverRig();
    v.driver = null;
    v.kind = 'parked';
    v.agent = null;
    const p = exitPoint(v.state);
    const ped = this.spawnPedAt(p.x, p.z, { outfit: 'civil' });
    if (look) {
      ped.rig.dispose();
      ped.rig = new CharacterRig(look);
      this.scene.add(ped.rig.root);
    }
    ped.sim.mode = 'flee';
    ped.sim.fleeFrom = fleeFrom;
    ped.sim.timer = 10;
    return ped;
  }

  // ------------------------------------------------------------- actualización
  update(dt, player) {
    const px = player.x;
    const pz = player.z;
    this.pedWorld.player.x = px;
    this.pedWorld.player.z = pz;
    for (let i = this.threats.length - 1; i >= 0; i--) {
      this.threats[i].t -= dt;
      if (this.threats[i].t <= 0) this.threats.splice(i, 1);
    }

    // Mantener densidad de tráfico y peatones alrededor del jugador.
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      this.spawnTimer = 0.4;
      const traffic = this.vehicles.filter((v) => v.kind === 'traffic').length;
      if (traffic < this.quality.traffic) this.spawnTraffic(px, pz);
      const civ = this.peds.filter((p) => p.faction === 'civil' && !p.sim.fixed).length;
      if (civ < this.quality.peds) this.spawnPed(px, pz);
      // Despawn lejano.
      for (const v of [...this.vehicles]) {
        if (v.persistent || v.driver === 'player' || v === this.game.player.lastVehicle) continue;
        const d = dist2D(v.state.x, v.state.z, px, pz);
        // Tráfico trabado (una buseta en una esquina cerrada): si nadie lo ve, se recicla.
        if (v.kind === 'traffic') {
          const m = (v._moveCheck ??= { x: v.state.x, z: v.state.z, t: 0 });
          m.t += 0.4;
          if (Math.hypot(v.state.x - m.x, v.state.z - m.z) > 4) Object.assign(m, { x: v.state.x, z: v.state.z, t: 0 });
          if (m.t > 25 && d > 60) {
            this.removeVehicle(v);
            continue;
          }
        }
        if (d > 280 || (v.exploded && d > 120)) this.removeVehicle(v);
      }
      for (const p of [...this.peds]) {
        if (p.missionGang) continue;
        const d = dist2D(p.x, p.z, px, pz);
        if (d > 170 || (!p.alive && p.deadTimer > 30)) this.removePed(p);
      }
    }

    this._updateFixed(dt, px, pz);
    this.activities.update(dt, player);
    this._updateVehicles(dt, player);
    this._updatePeds(dt, player);
  }

  /** Aparece (y desaparece) la gente quieta cerca del jugador. */
  _updateFixed(dt, px, pz) {
    this.fixedTimer -= dt;
    if (this.fixedTimer > 0) return;
    this.fixedTimer = 0.5;
    const near = this.quality.pedDraw ?? 90;
    for (const sp of this.fixedSpots) {
      if (sp.ped && (!this.peds.includes(sp.ped) || !sp.ped.sim.fixed)) sp.ped = null; // se fue (huyó o la borraron)
      const d = dist2D(sp.x, sp.z, px, pz);
      if (!sp.ped && d < near * 0.8 && d > 8) {
        const ped = this.spawnPedAt(sp.x, sp.z, { outfit: 'civil' });
        ped.sim.fixed = true;
        ped.sim.sitting = sp.sit;
        ped.sim.mode = 'idle';
        ped.sim.yaw = sp.yaw;
        ped.sim.speed = 0;
        sp.ped = ped;
      } else if (sp.ped && d > near * 1.1) {
        this.removePed(sp.ped);
        sp.ped = null;
      }
    }
  }

  _updateVehicles(dt, player) {
    const night = this.game.env.night;
    const camPos = this.game.camera.position;
    const q = this.quality;
    const obstaclesFor = (self) => {
      const list = [];
      for (const o of this.vehicles) {
        if (o === self) continue;
        if (Math.abs(o.state.x - self.state.x) > 14 || Math.abs(o.state.z - self.state.z) > 14) continue;
        list.push(o.obb());
      }
      return list;
    };
    const aheadList = [];
    for (const v of this.vehicles) {
      const s = v.state;
      const far = dist2D(s.x, s.z, player.x, player.z) > 160;
      if (v.driver === 'player') {
        // El jugador maneja; la física se integra en Game.
      } else if ((v.kind === 'traffic' || v.kind === 'police') && v.agent && !s.destroyed) {
        aheadList.length = 0;
        for (const o of this.vehicles) {
          if (o !== v && Math.abs(o.state.x - s.x) < 20 && Math.abs(o.state.z - s.z) < 20) aheadList.push({ x: o.state.x, z: o.state.z, r: o.state.spec.width / 2 + 0.3 });
        }
        for (const p of this.peds) {
          if (p.alive && Math.abs(p.x - s.x) < 18 && Math.abs(p.z - s.z) < 18 && onRoad(p.x, p.z)) aheadList.push({ x: p.x, z: p.z, r: 0.5 });
        }
        if (!player.inVehicle) aheadList.push({ x: player.x, z: player.z, r: 0.5 });
        // Patrullas: siguen el plan de la IA policial (en persecución embisten).
        const nav = v.kind === 'police' && v.chasing ? v.nav : null;
        const blocked = nav?.mode === 'pursue' ? Infinity : obstacleAhead(s, aheadList, 14, s.spec.width / 2 + 0.2);
        const opts = { cruise: v.panic > 0 ? 17 : v.cruise, blockedAhead: blocked, rand: this.rng.next, dt };
        if (nav) {
          opts.target = nav.target;
          opts.cruise = nav.cruise;
        }
        v.input = autopilot(this.graph, v.agent, s, opts);
        if (v.panic > 0) v.panic -= dt;
        // Pitan si llevan rato bloqueados.
        if (blocked < 8 && Math.abs(s.forwardSpeed) < 0.5) v.honk += dt;
        else v.honk = 0;
        stepVehicle(s, v.input, dt, far ? { groundHeight, collision: this.city.collision } : { groundHeight, collision: this.city.collision, obstacles: obstaclesFor(v) });
      } else {
        // Estacionado / abandonado: sigue rodando hasta detenerse.
        const idle = { throttle: 0, brake: Math.abs(s.forwardSpeed) > 0.3 ? 0.4 : 0, steer: 0, handbrake: Math.abs(s.forwardSpeed) < 3 };
        if (Math.abs(s.forwardSpeed) > 0.05 || Math.abs(s.lateralSpeed) > 0.05) stepVehicle(s, idle, dt, { groundHeight, collision: this.city.collision, obstacles: obstaclesFor(v) });
      }
      // Daño -> fuego -> explosión.
      if (s.health <= 0 && v.burnTimer < 0 && !v.exploded) {
        v.burnTimer = 4.5;
        this.game.effects.fire(() => ({ x: s.x, y: s.y + 0.6, z: s.z }), 4.5);
        if (v.driver && v.driver !== 'player') {
          const ped = this.ejectDriver(v, { x: s.x, z: s.z });
          if (ped) ped.sim.timer = 15;
        }
      }
      if (v.burnTimer >= 0 && !v.exploded) {
        v.burnTimer -= dt;
        if (v.burnTimer <= 0) {
          v.exploded = true;
          s.destroyed = true;
          this.game.combat.explode({ x: s.x, y: s.y, z: s.z }, v);
        }
      }
      // Vehículos lejanos no se dibujan (los parqueados, que son muchos y
      // pequeños como las motos, desde más cerca).
      const dv = dist2D(s.x, s.z, camPos.x, camPos.z);
      const moving = v.driver || Math.abs(s.forwardSpeed) > 0.5 || v.burnTimer >= 0;
      v.view.group.visible = dv < (moving ? q.vehicleDraw ?? 260 : q.parkedDraw ?? 120);
      if (v.view.group.visible) v.view.sync(s, dt, night, v.siren);
      if (v.driverRig) {
        // Conductores: solo se dibujan (y animan) de cerca; en moto se ven desde más lejos.
        const dc = dist2D(s.x, s.z, camPos.x, camPos.z);
        const show = dc < (v.type === 'moto' ? q.driverDraw * 1.6 : q.driverDraw);
        v.driverRig.root.visible = show;
        if (show) {
          v.driverRig.setShadow(dc < q.shadowChars);
          v.driverRig.animate(dt, { speed: 0, onGround: true, driving: v.type === 'moto' ? 'moto' : 'car' });
        }
      }
    }
  }

  _updatePeds(dt, player) {
    const camPos = this.game.camera.position;
    for (const p of this.peds) {
      const s = p.sim;
      const d = dist2D(s.x, s.z, player.x, player.z);
      if (p.alive) {
        // Hostiles: detectar y atacar al jugador.
        if (p.faction !== 'civil' && !p.police) {
          const hostileNow = p.faction === 'gang' ? p.alerted || d < p.aggroRange : this.game.wanted.level > 0;
          if (hostileNow && !player.dead) {
            p.alerted = true;
            s.mode = 'attack';
            s.hostile = true;
            s.attackRange = p.weapon ? 12 : 1.4;
          } else if (s.mode === 'attack') {
            s.mode = 'walk';
            s.hostile = false;
          }
        }
        if (s.fixed) {
          // Quietos (sentados o atendiendo) hasta que algo los asuste.
          const th = this.threats.find((t) => dist2D(t.x, t.z, s.x, s.z) < t.radius);
          if (th && p.act?.threat(p, th)) {
            // La actividad se encarga (la del balcón se entra a la casa).
          } else if (th) {
            s.fixed = false;
            s.sitting = false;
            s.mode = 'flee';
            s.fleeFrom = { x: th.x, z: th.z };
            s.timer = 8 + this.rng.next() * 5;
          } else if (!p.act) s.speed = 0;
        }
        if (d < 150 && !s.fixed) stepPed(s, dt, this.pedWorld);
        if (s.mode === 'attack' && !player.dead && this.game.state === 'playing') this.game.combat.npcAttack(p, dt, player, d);
        // Atropellos.
        for (const v of this.vehicles) {
          const vs = v.state;
          const speed = Math.abs(vs.forwardSpeed);
          if (speed < 3.5) continue;
          if (Math.abs(vs.x - s.x) > 5 || Math.abs(vs.z - s.z) > 5) continue;
          const o = v.obb(0.35);
          const dx = s.x - o.x;
          const dz = s.z - o.z;
          const lx = dx * Math.cos(o.angle) - dz * Math.sin(o.angle);
          const lz = dx * -Math.sin(o.angle) - dz * Math.cos(o.angle);
          if (Math.abs(lx) < o.hx && Math.abs(lz) < o.hz) {
            this.game.combat.damagePed(p, speed * 7, v.driver === 'player' ? 'player' : 'vehicle', { x: vs.x, y: vs.y + 1, z: vs.z }, false, 'impact');
            // Empujón.
            const l = Math.hypot(dx, dz) || 1;
            s.x += (dx / l) * 1.2;
            s.z += (dz / l) * 1.2;
          }
        }
      } else {
        p.deadTimer += dt;
      }
      p.y = s.elev ?? groundHeight(s.x, s.z);
      p.rig.root.position.set(s.x, p.y, s.z);
      p.rig.root.rotation.y = s.yaw;
      // Solo se dibuja y anima de cerca; la sombra, más cerca todavía.
      const dc = dist2D(s.x, s.z, camPos.x, camPos.z);
      const visible = dc < this.quality.pedDraw;
      p.rig.root.visible = visible;
      if (visible) {
        p.rig.setShadow(dc < this.quality.shadowChars);
        const body = this._body(p, s, dt);
        const st = {
          speed: s.speed ?? 0,
          onGround: true,
          driving: s.sitting ? 'chair' : null,
          aiming: s.mode === 'attack' && !!p.weapon && s.speed < 0.5,
          dead: !p.alive,
          aimPitch: 0,
          style: body.style,
          upper: body.upper,
          fidget: body.fidget,
          idle: p.idleClip,
          lookAt: this._lookAt(p, s, dt, player),
        };
        if (p.act && p.alive) p.act.dress(p, st);
        p.rig.animate(dt, st);
      }
    }
  }

  /**
   * La gente se fija en quien pasa cerca: la cabeza sigue al jugador unos
   * segundos (a pie, a menos de 7 m y más o menos al frente; el rig limita el
   * giro del cuello). Después pierde el interés hasta que se aleje.
   */
  _lookAt(p, s, dt, player) {
    if (!p.alive || p.faction !== 'civil' || s.mode === 'flee' || player.inVehicle || player.dead) {
      p.lookT = 0;
      return null;
    }
    const d = dist2D(s.x, s.z, player.x, player.z);
    if (d > 9) p.lookT = 0;
    if (d > 7) return null;
    p.lookT += dt;
    if (p.lookT > 5 && d > 2.2) return null;
    const t = (this._lookPt ??= { x: 0, y: 0, z: 0 });
    t.x = player.x;
    t.y = player.y + 1.55;
    t.z = player.z;
    return t;
  }

  /**
   * Lenguaje corporal de un peatón visible: cómo camina, qué hace con las
   * manos (celular, hablar, escuchar) y si se entretiene con gestos de
   * relleno cuando está quieto. Las charlas y pregones vienen de dialogue.js:
   * quien habla gesticula (saluda con la mano al saludar), quien escucha
   * asiente de vez en cuando.
   */
  _body(p, s, dt) {
    const dlg = this.game.dialogue;
    const alive = p.alive;
    // Cada parada o tramo de caminata elige otra actividad (estable por peatón).
    if (s.mode !== p.lastMode) {
      p.lastMode = s.mode;
      p.stops++;
      p.activity = s.fixed ? null : s.mode === 'idle' ? standingActivity(p.id, p.stops) : s.mode === 'walk' ? walkingActivity(p.id, p.stops) : null;
    }
    const u = alive ? (dlg?.speechOf?.(p) ?? null) : null;
    if (u !== p.lastSpeech) {
      p.lastSpeech = u;
      const g = u ? speechGesture(u.line.cat) : null;
      if (g?.gesture) p.rig.play(g.gesture, { fadeIn: 0.25 });
      // El ventero a veces llama con la mano al empezar el pregón.
      else if (u && u.line.cat.startsWith('pregon') && Math.random() < 0.35) p.rig.play('wave', { fadeIn: 0.25 });
    }
    let upper = null;
    const listening = alive && !u && !!dlg?.listening?.(p);
    if (u) upper = speechGesture(u.line.cat).upper;
    else if (listening) {
      upper = 'listen';
      // (Azar visual con Math.random: no gasta el generador de la simulación.)
      if (!p.rig.gesture && Math.random() < dt * 0.12) p.rig.play(Math.random() < 0.8 ? 'nod' : 'laugh', { fadeIn: 0.3 });
    } else if (p.faction === 'civil' && (s.mode === 'idle' || s.mode === 'walk')) upper = p.activity;
    return {
      style: alive && p.health < 45 ? 'injured' : p.walkStyle,
      upper,
      fidget: alive && (s.fixed || s.mode === 'idle' || (p.faction === 'police' && (s.speed ?? 0) < 0.1)),
    };
  }

  // ------------------------------------------------------------- policía
  /**
   * Policía que busca de verdad: solo sabe dónde estás si alguien te ve (o
   * reporta un delito). Con eso (WantedSystem: última posición conocida y
   * zona de búsqueda) las patrullas persiguen por la ruta más corta, acuden a
   * la última posición, se reparten la zona y bajan a buscar a pie.
   * Devuelve {seen, nearest}.
   */
  updatePolice(dt, player, wanted) {
    const graph = this.graph;
    // Velocidad del jugador (para adelantar la zona hacia donde iba).
    const lp = (this._lastPlayerPos ??= { x: player.x, z: player.z });
    let pvx = (player.x - lp.x) / Math.max(dt, 1e-3);
    let pvz = (player.z - lp.z) / Math.max(dt, 1e-3);
    const pv = Math.hypot(pvx, pvz);
    if (pv > 35) {
      // Teletransporte o reaparición: no es una velocidad real.
      pvx = 0;
      pvz = 0;
    }
    lp.x = player.x;
    lp.z = player.z;

    // Refuerzos hasta la cantidad deseada (de a uno, cada 2 s).
    this.policeSpawnTimer = Math.max(0, (this.policeSpawnTimer ?? 0) - dt);
    if (this.policeUnits.filter((u) => !u.leaving).length < wanted.desiredUnits() && this.policeSpawnTimer <= 0) {
      if (this._spawnPolice(player, wanted)) this.policeSpawnTimer = 2;
    }

    // ¿Quién ve al jugador? (rayos cada 0.25 s por unidad).
    const target = { x: player.x, y: player.y + 1.2, z: player.z };
    const los = (e, t) => this.game.combat.lineOfSight(e, t);
    let seen = false;
    for (const u of this.policeUnits) {
      u.lookT = (u.lookT ?? this.rng.next() * 0.25) - dt;
      if (u.lookT <= 0) {
        u.lookT = 0.25;
        const s = u.vehicle.state;
        u.sees = !u.leaving && u.state === 'pursuit' && !s.destroyed && canSee({ x: s.x, y: s.y + 1.4, z: s.z }, target, POLICE_AI.carSight, los);
        for (const o of u.officers) {
          o.sees = o.alive && canSee({ x: o.x, y: o.y + 1.6, z: o.z }, target, POLICE_AI.footSight, los);
          if (o.sees) u.sees = true;
        }
      }
      if (u.sees && !u.leaving && wanted.level > 0) seen = true;
    }
    if (seen) wanted.spot(player.x, player.z, pvx, pvz);

    let nearest = Infinity;
    const ctx = { graph, wanted, seen, player, rand: this.rng.next, dt, taken: [] };
    for (const u of [...this.policeUnits]) {
      const v = u.vehicle;
      const s = v.state;
      // El jugador se robó la patrulla: la unidad se disuelve.
      if (v.driver === 'player') {
        for (const o of u.officers) o.police = null;
        this.policeUnits.splice(this.policeUnits.indexOf(u), 1);
        continue;
      }
      const d = dist2D(s.x, s.z, player.x, player.z);
      nearest = Math.min(nearest, d);
      if (wanted.level === 0 && !u.leaving) {
        u.leaving = true;
        v.siren = false;
        if (u.state === 'deployed') this._recall(u);
      }
      if (u.state === 'returning') {
        this._updateReturning(u, dt);
        continue;
      }
      if (u.leaving) {
        if (u.state === 'pursuit' && !v.driver && s.health > 0 && !s.destroyed) this._remount(u);
        v.chasing = false;
        v.nav = null;
        if (d > 200) this._removeUnit(u);
        continue;
      }
      // Muy lejos del jugador y de la zona: se reubica (vuelve como refuerzo).
      const c = wanted.zoneCenter();
      if (d > 320 && (!c || dist2D(s.x, s.z, c.x, c.z) > 250)) {
        this._removeUnit(u);
        continue;
      }
      ctx.taken = this.policeUnits.filter((o) => o !== u && o.ai.goalNode != null).map((o) => graph.node(o.ai.goalNode));

      if (u.state === 'pursuit') {
        if (s.destroyed || s.health <= 0 || !v.agent) {
          u.leaving = true; // patrulla inservible: la unidad se retira
          continue;
        }
        const prevMode = u.ai.mode;
        const plan = planPatrol(u.ai, s, v.agent, ctx);
        v.chasing = true;
        v.siren = true;
        v.nav = plan;
        const playerSlow = !player.inVehicle || player.speed < 6;
        // Contacto: frenar y bajar a los agentes.
        if (seen && d < 22 && playerSlow) u.pendingDeploy = 'contact';
        // Llegaron a la zona sin encontrarte: la mitad baja a buscar a pie.
        else if (plan.mode === 'search' && prevMode === 'respond' && wanted.level >= 2 && u.id % 2 === 0) u.pendingDeploy = 'search';
        if (u.pendingDeploy) {
          v.nav = { ...plan, cruise: 0 };
          if (Math.abs(s.forwardSpeed) < 1.2) this._deploy(u, u.pendingDeploy);
        }
      } else if (u.state === 'deployed') {
        u.deployT += dt;
        u.officers = u.officers.filter((o) => this.peds.includes(o));
        const alive = u.officers.filter((o) => o.alive);
        for (const o of alive) this._officerBrain(o, ctx);
        if (u.deployReason === 'contact' && !seen && wanted.sinceSeen > 3) {
          // Se les perdió: pasan a buscar a pie alrededor de donde te vieron.
          u.deployReason = 'search';
          u.deployT = 0;
        }
        const escapingByCar = seen && player.inVehicle && player.speed > 8 && d > 25;
        const tooFar = seen && d > 60;
        const doneSearching = u.deployReason === 'search' && !seen && u.deployT > POLICE_AI.footSearchTime;
        if (alive.length === 0 || escapingByCar || tooFar || doneSearching) this._recall(u, alive.length === 0 || escapingByCar);
      }
    }
    return { seen, nearest };
  }

  /** Cerebro de un agente a pie: si te ve, ataca; si no, busca por las calles. */
  _officerBrain(o, ctx) {
    const s = o.sim;
    s.hostile = true;
    if (o.sees) {
      s.mode = 'attack';
      s.attackRange = o.weapon ? 12 : 1.4;
      o.search = null;
      return;
    }
    o.search ??= {};
    const wps = planOfficerSearch(o.search, o, ctx);
    if (wps) {
      s.waypoints = wps;
      s.lastWpD = Infinity;
    }
    if (s.mode !== 'move') s.mode = 'move';
    // Corren si te acaban de perder de vista; después revisan caminando rápido.
    s.moveSpeed = PED.run * (ctx.wanted.sinceSeen < 8 ? 0.8 : 0.5);
  }

  /** Detenerse y bajar a los dos agentes de la patrulla. */
  _deploy(u, reason) {
    const v = u.vehicle;
    const s = v.state;
    u.pendingDeploy = null;
    u.state = 'deployed';
    u.deployReason = reason;
    u.deployT = 0;
    v.kind = 'parked';
    v.agent = null;
    v.nav = null;
    v.clearDriverRig();
    v.driver = null;
    for (let k = 0; k < 2; k++) {
      const side = k === 0 ? -1 : 1;
      const ox = s.x + Math.cos(s.heading) * side * 1.6;
      const oz = s.z - Math.sin(s.heading) * side * 1.6;
      const off = this.city.collision.resolveCircle(ox, oz, PED.radius);
      const o = this.spawnPedAt(off.x, off.z, { outfit: 'police', faction: 'police', weapon: 'pistol', police: u, health: 120, sim: { hostile: true } });
      o.sim.mode = reason === 'contact' ? 'attack' : 'move';
      o.sim.waypoints = [];
      u.officers.push(o);
    }
  }

  /** Los agentes vuelven caminando a la patrulla (o de una, si hay afán). */
  _recall(u, now = false) {
    const car = u.vehicle.state;
    u.state = 'returning';
    u.returnT = 0;
    for (const o of u.officers) {
      if (!o.alive) continue;
      if (now) {
        this.removePed(o);
        continue;
      }
      o.sim.mode = 'move';
      o.sim.waypoints = [{ x: car.x, z: car.z }];
      o.sim.lastWpD = Infinity;
      o.sim.moveSpeed = PED.run * 0.7;
    }
    u.officers = u.officers.filter((o) => o.alive && this.peds.includes(o));
    if (!u.officers.length) this._remount(u);
  }

  _updateReturning(u, dt) {
    const car = u.vehicle.state;
    u.returnT += dt;
    for (const o of [...u.officers]) {
      if (!o.alive || !this.peds.includes(o) || dist2D(o.x, o.z, car.x, car.z) < 2.6 || u.returnT > 12) {
        if (o.alive && this.peds.includes(o)) this.removePed(o);
        u.officers.splice(u.officers.indexOf(o), 1);
      }
    }
    if (!u.officers.length) this._remount(u);
  }

  /** La patrulla vuelve a rodar (buscando, o yéndose si ya no hay estrellas). */
  _remount(u) {
    const v = u.vehicle;
    u.officers = [];
    if (v.state.destroyed) {
      u.leaving = true;
      u.state = 'pursuit';
      return;
    }
    u.state = 'pursuit';
    u.ai = {};
    v.kind = 'police';
    v.driver = 'npc';
    v.setDriverRig(randomLook(this.rng, 'police'));
    const n = this.graph.nearestNode(v.state.x, v.state.z);
    v.agent = { from: n.id, to: n.links[0].node, next: null };
  }

  _spawnPolice(player, wanted) {
    // Llegan hacia la zona de búsqueda (no hacia la posición real), desde un
    // nodo vial a 80-170 m de ella y fuera de la vista inmediata del jugador.
    const c = wanted.zoneCenter() ?? { x: player.x, z: player.z };
    const cands = this.graph.active.filter((n) => {
      const d = dist2D(n.x, n.z, c.x, c.z);
      return d > 80 && d < 170 && dist2D(n.x, n.z, player.x, player.z) > 70;
    });
    if (!cands.length) return null;
    const n = cands[Math.floor(this.rng.next() * cands.length)];
    const to = this.graph.pickToward(-1, n.id, c.x, c.z);
    const p = lanePoint(this.graph, n.id, to, 0.1);
    const v = new VehicleEntity(this, 'policia', p.x, p.z, p.yaw, { kind: 'police', agent: { from: n.id, to, next: null }, cruise: 20 });
    v.driver = 'npc';
    v.setDriverRig(randomLook(this.rng, 'police'));
    v.chasing = true;
    v.siren = true;
    this.vehicles.push(v);
    const unit = { id: this._unitId = (this._unitId ?? 0) + 1, vehicle: v, officers: [], state: 'pursuit', leaving: false, ai: {}, sees: false };
    this.policeUnits.push(unit);
    return unit;
  }

  _removeUnit(u) {
    for (const o of u.officers) if (this.peds.includes(o)) this.removePed(o);
    if (this.vehicles.includes(u.vehicle) && u.vehicle.driver !== 'player') this.removeVehicle(u.vehicle);
    this.policeUnits.splice(this.policeUnits.indexOf(u), 1);
  }

  clearPolice() {
    for (const u of [...this.policeUnits]) this._removeUnit(u);
  }

  // ------------------------------------------------------------- pandilla
  spawnGang(at, count) {
    const out = [];
    for (let k = 0; k < count; k++) {
      const a = (k / count) * Math.PI * 2;
      const x = at.x + Math.cos(a) * 4;
      const z = at.z + 10 + Math.sin(a) * 4;
      const r = this.city.collision.resolveCircle(x, z, PED.radius);
      const g = this.spawnPedAt(r.x, r.z, { outfit: 'gang', faction: 'gang', weapon: k % 2 ? 'smg' : 'pistol', missionGang: true, health: 110, aggroRange: 32 });
      g.sim.mode = 'idle';
      g.sim.timer = 9999;
      g.sim.yaw = yawFromDir(at.x - x, at.z - z);
      out.push(g);
    }
    return out;
  }

  nearestVehicle(x, z, maxD = 4) {
    let best = null;
    let bd = maxD;
    for (const v of this.vehicles) {
      if (v.state.destroyed || v.exploded) continue;
      const d = dist2D(v.state.x, v.state.z, x, z) - Math.max(v.state.spec.width, v.state.spec.length) / 2;
      if (d < bd) {
        bd = d;
        best = v;
      }
    }
    return best;
  }

  lanePointNear(x, z) {
    const e = this.graph.nearestEdge(x, z);
    const rev = e.edge.oneway === -1;
    const from = rev ? e.edge.b : e.edge.a;
    const to = rev ? e.edge.a : e.edge.b;
    const p = lanePoint(this.graph, from, to, rev ? 1 - e.t : e.t);
    return { ...p, from, to };
  }
}
