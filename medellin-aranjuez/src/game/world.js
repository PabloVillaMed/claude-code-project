// Población viva del barrio: tráfico, peatones, policía y pandilla.
// Une la simulación pura (sim/*) con los modelos 3D (render/*).

import { makeRng } from '../sim/rng.js';
import { dist2D, forwardX, forwardZ, yawFromDir } from '../sim/math.js';
import { groundHeight, onRoad } from '../sim/terrain.js';
import { createVehicleState, stepVehicle, vehicleObb, exitPoint, emptyDriveInput } from '../sim/vehiclePhysics.js';
import { RoadGraph, autopilot, lanePoint, obstacleAhead } from '../sim/roadNav.js';
import { createPed, stepPed, PED } from '../sim/pedAI.js';
import { VehicleView } from '../render/vehicleMesh.js';
import { CharacterRig, randomLook } from '../render/characterRig.js';

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
    // Vehículos parqueados (persistentes).
    for (const p of this.city.parkedVehicles) {
      this.vehicles.push(new VehicleEntity(this, p.type, p.x, p.z, p.heading, { kind: 'parked', persistent: true }));
    }
  }

  _indexBlocks() {
    return this.city.blocks;
  }

  blockAt(x, z) {
    for (const b of this.blockIndex) if (x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ) return b;
    return null;
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
      const e = this.graph.edges[Math.floor(this.rng.next() * this.graph.edges.length)];
      const forward = this.rng.chance(0.5);
      const from = forward ? e.a : e.b;
      const to = forward ? e.b : e.a;
      const t = this.rng.range(0.2, 0.8);
      const p = lanePoint(this.graph, from, to, t);
      const d = dist2D(p.x, p.z, px, pz);
      if (d < minD || d > maxD) continue;
      if (this.vehicles.some((v) => dist2D(v.state.x, v.state.z, p.x, p.z) < 12)) continue;
      const vt = type ?? this._pickTrafficType();
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
    for (let tries = 0; tries < 20; tries++) {
      const b = this.city.blocks[Math.floor(this.rng.next() * this.city.blocks.length)];
      const d = dist2D(b.cx, b.cz, px, pz);
      if (d > maxD + 40) continue;
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
    const b = this.blockAt(x, z) ?? this.city.blocks[0];
    const sim = createPed(b, this.rng, opts.sim);
    sim.x = x;
    sim.z = z;
    const ped = new PedEntity(this, sim, randomLook(this.rng, opts.outfit ?? 'civil'), opts);
    this.peds.push(ped);
    return ped;
  }

  /** Llena de inmediato el barrio alrededor de (x, z) con peatones y tráfico. */
  populate(x, z) {
    let guard = 0;
    while (this.peds.filter((p) => p.faction === 'civil').length < this.quality.peds && guard++ < this.quality.peds * 3) this.spawnPed(x, z, 12, 110);
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
      const civ = this.peds.filter((p) => p.faction === 'civil').length;
      if (civ < this.quality.peds) this.spawnPed(px, pz);
      // Despawn lejano.
      for (const v of [...this.vehicles]) {
        if (v.persistent || v.driver === 'player' || v === this.game.player.lastVehicle) continue;
        const d = dist2D(v.state.x, v.state.z, px, pz);
        if (d > 280 || (v.exploded && d > 120)) this.removeVehicle(v);
      }
      for (const p of [...this.peds]) {
        if (p.missionGang) continue;
        const d = dist2D(p.x, p.z, px, pz);
        if (d > 170 || (!p.alive && p.deadTimer > 30)) this.removePed(p);
      }
    }

    this._updateVehicles(dt, player);
    this._updatePeds(dt, player);
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
        const blocked = v.kind === 'police' && v.chasing ? Infinity : obstacleAhead(s, aheadList, 14, s.spec.width / 2 + 0.2);
        const opts = { cruise: v.panic > 0 ? 17 : v.cruise, blockedAhead: blocked, rand: this.rng.next, dt };
        if (v.kind === 'police' && v.chasing) {
          opts.target = { x: player.x, z: player.z };
          opts.cruise = 21;
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
      v.view.sync(s, dt, night, v.siren);
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
        if (p.faction !== 'civil') {
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
        if (d < 150) stepPed(s, dt, this.pedWorld);
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
      p.y = groundHeight(s.x, s.z);
      p.rig.root.position.set(s.x, p.y, s.z);
      p.rig.root.rotation.y = s.yaw;
      // Solo se dibuja y anima de cerca; la sombra, más cerca todavía.
      const dc = dist2D(s.x, s.z, camPos.x, camPos.z);
      const visible = dc < this.quality.pedDraw;
      p.rig.root.visible = visible;
      if (visible) {
        p.rig.setShadow(dc < this.quality.shadowChars);
        p.rig.animate(dt, {
          speed: s.speed ?? 0,
          onGround: true,
          aiming: s.mode === 'attack' && !!p.weapon && s.speed < 0.5,
          dead: !p.alive,
          aimPitch: 0,
        });
      }
    }
  }

  // ------------------------------------------------------------- policía
  updatePolice(dt, player, wanted) {
    const want = wanted.desiredUnits();
    // Crear patrullas hasta la cantidad deseada.
    if (this.policeUnits.filter((u) => !u.leaving).length < want) {
      this._spawnPolice(player);
    }
    let seen = false;
    let nearest = Infinity;
    for (const u of [...this.policeUnits]) {
      const v = u.vehicle;
      const s = v.state;
      // El jugador se robó la patrulla: la unidad se disuelve (los agentes
      // siguen a pie) y el carro ya no es de la IA.
      if (v.driver === 'player') {
        this.policeUnits.splice(this.policeUnits.indexOf(u), 1);
        continue;
      }
      const d = dist2D(s.x, s.z, player.x, player.z);
      nearest = Math.min(nearest, d);
      if (wanted.level === 0 && !u.leaving) {
        u.leaving = true;
        v.chasing = false;
        v.siren = false;
        // Los agentes vuelven a la patrulla.
        for (const o of u.officers) this.removePed(o);
        u.officers = [];
        if (!v.driver) {
          v.driver = 'npc';
          v.setDriverRig(randomLook(this.rng, 'police'));
        }
        v.kind = 'police';
        const n = this.graph.nearestNode(s.x, s.z);
        v.agent = { from: n.id, to: n.links[0].node, next: null };
      }
      if (u.leaving) {
        if (d > 200) this._removeUnit(u);
        continue;
      }
      // Muy lejos (el jugador escapó en carro): reubicar.
      if (d > 320) {
        this._removeUnit(u);
        continue;
      }
      if (u.state === 'pursuit') {
        v.chasing = true;
        v.siren = true;
        const playerSlow = !player.inVehicle || player.speed < 6;
        if (d < 22 && playerSlow && Math.abs(s.forwardSpeed) < 6) {
          // Detenerse y desplegar agentes.
          u.state = 'deployed';
          v.kind = 'parked';
          v.agent = null;
          v.clearDriverRig();
          v.driver = null;
          for (let k = 0; k < 2; k++) {
            const side = k === 0 ? -1 : 1;
            const ox = s.x + Math.cos(s.heading) * side * 1.6;
            const oz = s.z - Math.sin(s.heading) * side * 1.6;
            const off = this.city.collision.resolveCircle(ox, oz, PED.radius);
            const o = this.spawnPedAt(off.x, off.z, { outfit: 'police', faction: 'police', weapon: 'pistol', police: u, health: 120, sim: { hostile: true } });
            o.sim.mode = 'attack';
            u.officers.push(o);
          }
        }
      } else if (u.state === 'deployed') {
        u.officers = u.officers.filter((o) => this.peds.includes(o));
        const alive = u.officers.filter((o) => o.alive);
        const farFromCar = d > 55 || (player.inVehicle && player.speed > 8 && d > 25);
        if (alive.length === 0 || farFromCar) {
          // Recoger agentes y volver a perseguir.
          for (const o of alive) this.removePed(o);
          u.officers = u.officers.filter((o) => !o.alive);
          if (!v.state.destroyed) {
            u.state = 'pursuit';
            v.kind = 'police';
            v.driver = 'npc';
            v.setDriverRig(randomLook(this.rng, 'police'));
            const n = this.graph.nearestNode(s.x, s.z);
            v.agent = { from: n.id, to: n.links[0].node, next: null };
          } else {
            u.leaving = true;
          }
        }
      }
      // ¿Nos ven?
      const eyes = [{ x: s.x, y: s.y + 1.4, z: s.z }, ...u.officers.filter((o) => o.alive).map((o) => ({ x: o.x, y: o.y + 1.6, z: o.z }))];
      for (const e of eyes) {
        const de = Math.hypot(e.x - player.x, e.z - player.z);
        if (de < 25 || (de < 80 && this.game.combat.lineOfSight(e, { x: player.x, y: player.y + 1.2, z: player.z }))) {
          seen = true;
          break;
        }
      }
    }
    return { seen, nearest };
  }

  _spawnPolice(player) {
    // Nodo vial a 90-170 m del jugador.
    const cands = this.graph.active.filter((n) => {
      const d = dist2D(n.x, n.z, player.x, player.z);
      return d > 90 && d < 170;
    });
    if (!cands.length) return null;
    const n = cands[Math.floor(this.rng.next() * cands.length)];
    const to = this.graph.pickToward(-1, n.id, player.x, player.z);
    const p = lanePoint(this.graph, n.id, to, 0.1);
    const v = new VehicleEntity(this, 'policia', p.x, p.z, p.yaw, { kind: 'police', agent: { from: n.id, to, next: null }, cruise: 20 });
    v.driver = 'npc';
    v.setDriverRig(randomLook(this.rng, 'police'));
    v.chasing = true;
    v.siren = true;
    this.vehicles.push(v);
    const unit = { vehicle: v, officers: [], state: 'pursuit', leaving: false };
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
    const a = this.graph.node(e.edge.a);
    const b = this.graph.node(e.edge.b);
    const p = lanePoint(this.graph, e.edge.a, e.edge.b, e.t);
    return { ...p, from: a.id, to: b.id };
  }
}
