// Población viva del barrio: tráfico, peatones, policía y pandilla.
// Une la simulación pura (sim/*) con los modelos 3D (render/*).

import { makeRng } from '../sim/rng.js';
import { dist2D, forwardX, forwardZ, yawFromDir } from '../sim/math.js';
import { groundHeight, onRoad } from '../sim/terrain.js';
import { createVehicleState, stepVehicle, vehicleObb, exitPoint, emptyDriveInput } from '../sim/vehiclePhysics.js';
import { RoadGraph, autopilot, lanePoint, obstacleAhead } from '../sim/roadNav.js';
import { createPed, nearestBlock, stepPed, PED } from '../sim/pedAI.js';
import { NAV_FRAME_MS, PedNav, buildPedGraph } from '../sim/pedNav.js';
import { pointInPoly } from '../sim/geom2d.js';
import { Group } from 'three';
import { POLICE_AI, POLICE_MOTO, PoliceDispatch, assignRoles, canSee, pickSpawnNode, planOfficerSearch, planPatrol, policeMotoVariant } from '../sim/policeAI.js';
import { VehicleView } from '../render/vehicleMesh.js';
import { pickVariant, randomPaint } from '../sim/vehicleVariants.js';
import { CharacterRig, randomLook } from '../render/characterRig.js';
import { skipWhenHidden } from '../render/staticScene.js';
import { walkStyle, walkSpeedScale, standingActivity, walkingActivity, speechGesture, idleVariant } from '../sim/animSelect.js';
import { Activities } from './activities.js';

let nextId = 1;

export class VehicleEntity {
  constructor(world, type, x, z, heading, opts = {}) {
    this.id = nextId++;
    this.world = world;
    // Variante (modelo, medidas y motor) y color al azar según el tipo.
    const variant = opts.variant ?? pickVariant(type, world.rng.next, opts.kind ?? 'parked');
    this.state = createVehicleState(type, x, z, heading, groundHeight, variant);
    this.view = new VehicleView(type, { color: randomPaint(type, world.rng.next), ...opts, variant: this.state.variant });
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

  /**
   * La misma caja que obb(), pero reciclada (un objeto por vehículo): para
   * las listas de obstáculos de un cuadro, que la física lee y suelta.
   */
  obbNow() {
    const s = this.state;
    const o = (this._obb ??= { x: 0, z: 0, hx: 0, hz: 0, angle: 0, mass: 0 });
    o.x = s.x;
    o.z = s.z;
    o.hx = s.spec.width / 2;
    o.hz = s.spec.length / 2;
    o.angle = s.heading;
    o.mass = s.spec.mass;
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

// Mezcla del tráfico de Medellín: casi la mitad son motos, luego los carros
// particulares pequeños, los taxis amarillos, camionetas y busetas.
const TRAFFIC_TYPES = [
  ['moto', 0.4],
  ['sedan', 0.23],
  ['taxi', 0.21],
  ['camioneta', 0.1],
  ['buseta', 0.06],
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
    // Rutas a pie (sim/pedNav.js): un grafo peatonal (andenes, cruces,
    // senderos, parques) que comparten los peatones y los animales; el
    // buscador tiene un presupuesto de búsquedas por cuadro.
    this.pedGraph = buildPedGraph(this.city);
    this.nav = new PedNav(this.pedGraph, { collision: this.city.collision, frameMs: NAV_FRAME_MS });
    this.pedWorld = {
      blocks: this.city.blocks,
      blockAt: (x, z) => this.blockAt(x, z),
      collision: this.city.collision,
      rand: this.rng.next,
      threats: this.threats,
      player: { x: 0, z: 0 },
      nav: this.nav,
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
    while (this.peds.filter((p) => p.faction === 'civil' && !p.sim.fixed && !p.calle && !p.dama).length < this.quality.peds && guard++ < this.quality.peds * 3) this.spawnPed(x, z, 12, 110);
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

  /** Saca un peatón del mundo sin borrarlo: va sentado en un carro (game/companions.js) y lo anima otro. */
  detachPed(p) {
    const i = this.peds.indexOf(p);
    if (i >= 0) this.peds.splice(i, 1);
  }

  /** Lo devuelve al andén en (x, z) mirando a `yaw`, con su lógica de nuevo (la de la manzana de ahí). */
  attachPed(p, x, z, yaw) {
    const b = this.blockAt(x, z) ?? nearestBlock(this.city.blocks, x, z);
    const sim = createPed(b, this.rng);
    sim.x = x;
    sim.z = z;
    sim.yaw = yaw;
    sim.health = p.health;
    if (sim.walkSpeed) sim.walkSpeed *= walkSpeedScale(p.walkStyle);
    p.sim = sim;
    p.y = groundHeight(x, z);
    this.scene.add(p.rig.root);
    p.rig.root.position.set(x, p.y, z);
    p.rig.root.rotation.set(0, yaw, 0);
    if (!this.peds.includes(p)) this.peds.push(p);
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
    this.nav.beginFrame(dt); // vuelve a haber presupuesto de búsquedas de rutas
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
      // Los habitantes de calle (game/streetLife.js) y las damas de compañía (game/companions.js) no cuentan en el cupo.
      const civ = this.peds.filter((p) => p.faction === 'civil' && !p.sim.fixed && !p.calle && !p.dama).length;
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

  /**
   * Vehículos a menos de `r` (en caja) de (x, z), menos `self`, como cajas
   * recicladas (obbNow) en `out` (se vacía): la física los lee en el mismo
   * cuadro y no los guarda, así no se arma nada nuevo por vehículo y cuadro.
   */
  obstaclesNear(x, z, r, self = null, out = (this._obstacles ??= [])) {
    out.length = 0;
    for (const o of this.vehicles) {
      if (o === self) continue;
      if (Math.abs(o.state.x - x) > r || Math.abs(o.state.z - z) > r) continue;
      out.push(o.obbNow());
    }
    return out;
  }

  _updateVehicles(dt, player) {
    const night = this.game.env.night;
    const camPos = this.game.camera.position;
    const q = this.quality;
    // Entornos de la física, entradas y listas reciclados (nada nuevo por vehículo y cuadro).
    const envFar = (this._envFar ??= { groundHeight, collision: this.city.collision });
    const envNear = (this._envNear ??= { groundHeight, collision: this.city.collision, obstacles: null, breakables: null });
    envNear.breakables = this.game.breakables;
    const near = (self) => {
      envNear.obstacles = this.obstaclesNear(self.state.x, self.state.z, 14, self);
      return envNear;
    };
    const idle = (this._idleInput ??= { throttle: 0, brake: 0, steer: 0, handbrake: false });
    const apOpts = (this._apOpts ??= { cruise: 0, blockedAhead: 0, rand: this.rng.next, dt: 0, target: undefined });
    const aheadList = (this._aheadList ??= []);
    const aheadPool = (this._aheadPool ??= []);
    const ahead = (x, z, r) => {
      const o = (aheadPool[aheadList.length] ??= { x: 0, z: 0, r: 0 });
      o.x = x;
      o.z = z;
      o.r = r;
      aheadList.push(o);
    };
    for (const v of this.vehicles) {
      const s = v.state;
      const far = dist2D(s.x, s.z, player.x, player.z) > 160;
      if (v.driver === 'player') {
        // El jugador maneja; la física se integra en Game.
      } else if ((v.kind === 'traffic' || v.kind === 'police') && v.agent && !s.destroyed) {
        aheadList.length = 0;
        for (const o of this.vehicles) {
          if (o !== v && Math.abs(o.state.x - s.x) < 20 && Math.abs(o.state.z - s.z) < 20) ahead(o.state.x, o.state.z, o.state.spec.width / 2 + 0.3);
        }
        for (const p of this.peds) {
          if (p.alive && Math.abs(p.x - s.x) < 18 && Math.abs(p.z - s.z) < 18 && onRoad(p.x, p.z)) ahead(p.x, p.z, 0.5);
        }
        if (!player.inVehicle) ahead(player.x, player.z, 0.5);
        // Patrullas: siguen el plan de la IA policial (en persecución embisten).
        const nav = v.kind === 'police' && v.chasing ? v.nav : null;
        const blocked = nav?.mode === 'pursue' ? Infinity : obstacleAhead(s, aheadList, 14, s.spec.width / 2 + 0.2);
        const opts = apOpts;
        opts.cruise = v.panic > 0 ? 17 : v.cruise;
        opts.blockedAhead = blocked;
        opts.dt = dt;
        opts.target = undefined;
        if (nav) {
          opts.target = nav.target;
          opts.cruise = nav.cruise;
        }
        v.input = autopilot(this.graph, v.agent, s, opts);
        if (v.panic > 0) v.panic -= dt;
        // Pitan si llevan rato bloqueados.
        if (blocked < 8 && Math.abs(s.forwardSpeed) < 0.5) v.honk += dt;
        else v.honk = 0;
        // (Los cercanos también tumban postes y árboles: sim/destructibles.js.)
        stepVehicle(s, v.input, dt, far ? envFar : near(v));
      } else if (Math.abs(s.forwardSpeed) > 0.05 || Math.abs(s.lateralSpeed) > 0.05 || s.wheelie) {
        // Estacionado / abandonado: sigue rodando hasta detenerse.
        // (Una moto que quedó en caballito sigue hasta bajar la rueda.)
        idle.brake = Math.abs(s.forwardSpeed) > 0.3 ? 0.4 : 0;
        idle.handbrake = Math.abs(s.forwardSpeed) < 3;
        stepVehicle(s, idle, dt, near(v));
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
      // Oculto, three tampoco le recalcula las matrices (render/staticScene.js);
      // al volverse visible se actualiza en el siguiente dibujo.
      v.view.group.visible = dv < (moving ? q.vehicleDraw ?? 260 : q.parkedDraw ?? 120);
      skipWhenHidden(v.view.group);
      if (v.view.group.visible) v.view.sync(s, dt, night, v.siren);
      if (v.driverRig) {
        // Conductores: solo se dibujan (y animan) de cerca; en moto se ven desde más lejos.
        const dc = dist2D(s.x, s.z, camPos.x, camPos.z);
        const show = dc < (v.type === 'moto' ? q.driverDraw * 1.6 : q.driverDraw);
        v.driverRig.root.visible = show;
        skipWhenHidden(v.driverRig.root);
        if (show) {
          v.driverRig.setShadow(dc < q.shadowChars);
          v.driverRig.animate(dt, { speed: 0, onGround: true, driving: v.type === 'moto' ? 'moto' : 'car', steer: s.steer, sway: s.bodyRoll });
        }
      }
    }
  }

  _updatePeds(dt, player) {
    const camPos = this.game.camera.position;
    // Atropellos: solo cuentan los vehículos rápidos (una lista por cuadro, no
    // peatones x 280 vehículos).
    const fast = (this._fastVehicles ??= []);
    fast.length = 0;
    for (const v of this.vehicles) if (Math.abs(v.state.forwardSpeed) >= 3.5) fast.push(v);
    for (const p of this.peds) {
      const s = p.sim;
      const d = dist2D(s.x, s.z, player.x, player.z);
      if (p.alive) {
        // Hostiles: detectar y atacar al jugador.
        // (Los de las plazas solo atacan si los provocan; en una balacera entre
        // bandas los maneja game/streetLife.js.)
        if (p.faction !== 'civil' && !p.police && !p.war) {
          const hostileNow = p.faction === 'gang' ? p.alerted || d < p.aggroRange : p.faction === 'banda' ? p.alerted : this.game.wanted.level > 0;
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
          let th = null;
          if (p.faction !== 'banda') for (const t of this.threats) if (dist2D(t.x, t.z, s.x, s.z) < t.radius) { th = t; break; }
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
        for (const v of fast) {
          const vs = v.state;
          const speed = Math.abs(vs.forwardSpeed);
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
      skipWhenHidden(p.rig.root);
      if (visible) {
        p.rig.setShadow(dc < this.quality.shadowChars);
        const body = this._body(p, s, dt);
        // Estado de animación reciclado (uno por peatón); lo que las
        // actividades agregan en dress() se borra en cada cuadro.
        const st = (p._animSt ??= {});
        st.speed = s.speed ?? 0;
        st.onGround = true;
        st.driving = s.sitting ? 'chair' : null;
        st.aiming = (s.mode === 'attack' || !!p.war) && !!p.weapon && s.speed < 0.5;
        st.dead = !p.alive;
        st.aimPitch = 0;
        st.style = body.style;
        st.upper = body.upper;
        st.fidget = body.fidget;
        st.idle = p.idleClip;
        st.lookAt = this._lookAt(p, s, dt, player);
        st.seat = st.fidgets = st.crouching = st.bodyPitch = st.bodyShift = undefined;
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
      p.activity = s.fixed ? (p.fixedActivity ?? null) : s.mode === 'idle' ? standingActivity(p.id, p.stops) : s.mode === 'walk' || s.mode === 'goto' ? walkingActivity(p.id, p.stops) : null;
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
    } else if ((p.faction === 'civil' || p.faction === 'banda') && (s.mode === 'idle' || s.mode === 'walk' || s.mode === 'goto')) upper = p.activity;
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

    // Despacho por radio (sim/policeAI.js PoliceDispatch): los refuerzos
    // salen de a uno, escalonados según las estrellas, hasta el tope del nivel
    // (wanted.js MAX_UNITS); si sobran (bajaron las estrellas) se retiran.
    const dispatch = (this.policeDispatch ??= new PoliceDispatch());
    const order = dispatch.step(dt, wanted.level, this._activeUnits());
    if (order === 'retire') this._retireUnit(player);
    else if (order && !this._spawnPolice(player, wanted, order)) dispatch.failed();
    // Papeles (perseguir, cortar el paso, barrer): se recalculan solo si
    // cambió quién está en el caso.
    const active = this._activeUnits();
    let key = active.length;
    for (const u of active) key = (key * 31 + u.id) % 1e9;
    if (key !== this._rolesKey) {
      this._rolesKey = key;
      assignRoles(active);
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
    const pvel = (this._policePv ??= { x: 0, z: 0 });
    pvel.x = pvx;
    pvel.z = pvz;
    const taken = (this._policeTaken ??= []);
    const ctx = { graph, wanted, seen, player, playerVel: pvel, rand: this.rng.next, dt, taken, role: 'chase', moto: false, pedNav: !!this.nav };
    const camPos = this.game.camera.position;
    for (const u of [...this.policeUnits]) {
      const v = u.vehicle;
      const s = v.state;
      // El vehículo se recicló por lejos: la unidad sale del caso (si no,
      // ocuparía un cupo del despacho sin moverse).
      if (!this.vehicles.includes(v)) {
        this._removeUnit(u);
        continue;
      }
      // Moto sin conductor de la Policía o vuelta nada: el parrillero se baja.
      if (u.pillion && (v.driver !== 'npc' || s.health <= 0 || s.destroyed)) this._dropPillion(u);
      if (u.pillion) this._updatePillion(u, dt, camPos, wanted, player);
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
      taken.length = 0;
      for (const o of this.policeUnits) if (o !== u && o.ai.goalNode != null) taken.push(graph.node(o.ai.goalNode));
      ctx.role = u.role ?? 'chase';
      ctx.moto = u.kind === 'moto';

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
    // Se bajan los mismos que iban montados (conductor y, en moto, parrillero).
    const looks = [v.driverLook, u.pillion?.look];
    this._clearPillion(u);
    v.clearDriverRig();
    v.driver = null;
    const sideOff = u.kind === 'moto' ? POLICE_MOTO.deployOffset : 1.6;
    for (let k = 0; k < 2; k++) {
      const side = k === 0 ? -1 : 1;
      const ox = s.x + Math.cos(s.heading) * side * sideOff;
      const oz = s.z - Math.sin(s.heading) * side * sideOff;
      const off = this.city.collision.resolveCircle(ox, oz, PED.radius);
      const o = this.spawnPedAt(off.x, off.z, { outfit: 'police', faction: 'police', weapon: 'pistol', police: u, health: 120, sim: { hostile: true }, look: looks[k] ?? undefined });
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
    if (u.kind === 'moto' && v.state.health > 0) this._seatPillion(u);
    const n = this.graph.nearestNode(v.state.x, v.state.z);
    v.agent = { from: n.id, to: n.links[0].node, next: null };
  }

  /**
   * Sale un refuerzo: kind 'car' (camioneta) o 'moto' (moto con parrillero).
   * Llegan hacia la zona de búsqueda (no hacia la posición real), desde un
   * nodo vial lejos de ella (DISPATCH.spawnMin-spawnMax), fuera de la vista
   * inmediata del jugador y lejos de las otras unidades: por lados distintos.
   */
  _spawnPolice(player, wanted, kind = 'car') {
    const c = wanted.zoneCenter() ?? { x: player.x, z: player.z };
    const others = this._activeUnits().map((o) => o.vehicle.state);
    const n = pickSpawnNode(this.graph, c, player, others, this.rng.next);
    if (!n) return null;
    const to = this.graph.pickToward(-1, n.id, c.x, c.z);
    const p = lanePoint(this.graph, n.id, to, 0.1);
    const moto = kind === 'moto';
    const v = moto
      ? new VehicleEntity(this, 'moto', p.x, p.z, p.yaw, { kind: 'police', agent: { from: n.id, to, next: null }, cruise: 20, variant: policeMotoVariant() })
      : new VehicleEntity(this, 'policia', p.x, p.z, p.yaw, { kind: 'police', agent: { from: n.id, to, next: null }, cruise: 20 });
    v.driver = 'npc';
    v.setDriverRig(randomLook(this.rng, 'police'));
    v.chasing = true;
    v.siren = true;
    this.vehicles.push(v);
    const unit = { id: this._unitId = (this._unitId ?? 0) + 1, kind: moto ? 'moto' : 'car', role: null, vehicle: v, officers: [], state: 'pursuit', leaving: false, ai: {}, sees: false };
    if (moto) this._seatPillion(unit);
    this.policeUnits.push(unit);
    return unit;
  }

  /** Unidades que siguen en el caso (no se están yendo), en orden de llegada. */
  _activeUnits() {
    const out = (this._activeList ??= []);
    out.length = 0;
    for (const u of this.policeUnits) if (!u.leaving && u.vehicle.driver !== 'player') out.push(u);
    return out;
  }

  /** Bajaron las estrellas: se va la unidad más lejana que no te esté viendo. */
  _retireUnit(player) {
    let best = null;
    let bestD = -Infinity;
    for (const u of this._activeUnits()) {
      const s = u.vehicle.state;
      const d = dist2D(s.x, s.z, player.x, player.z) - (u.sees ? 1000 : 0);
      if (d > bestD) {
        bestD = d;
        best = u;
      }
    }
    if (!best) return;
    best.leaving = true;
    best.vehicle.siren = false;
    if (best.state === 'deployed') this._recall(best);
  }

  // ------------------------------------------------- parrillero (motos)
  /** Sienta al parrillero detrás del conductor de la moto. */
  _seatPillion(u) {
    this._clearPillion(u);
    const v = u.vehicle;
    const look = randomLook(this.rng, 'police');
    const rig = new CharacterRig(look);
    // Un grupo propio con los puntos de apoyo del puesto de atrás (el
    // esqueleto lee los de la moto en root.parent.userData.ride): manos a
    // los lados de la cintura del conductor y pies en las estriberas de atrás.
    const seatG = new Group();
    const base = v.view.group.userData.ride;
    const back = POLICE_MOTO.pillionBack;
    const up = POLICE_MOTO.pillionUp;
    if (base) {
      const mv = (p, dy = 0, dz = back) => ({ x: p.x, y: p.y + dy, z: p.z + dz });
      seatG.userData.ride = {
        ...base,
        seatY: base.seatY + up,
        seatZ: base.seatZ + back,
        grips: base.grips.map((g) => ({ x: Math.sign(g.x) * 0.2, y: base.seatY + up + 0.32, z: base.seatZ + back * 0.35 })),
        pegs: base.pegs.map((p) => mv(p, 0.08, back + 0.12)),
        speed: 0,
      };
    }
    const seat = v.view.seat;
    rig.root.position.set(seat.x, seat.y - 0.15 + up, seat.z + back);
    seatG.add(rig.root);
    v.view.group.add(seatG);
    u.pillion = { rig, look, group: seatG, aimT: 0, gun: null };
    if (!v.pillionHook) {
      // Si la moto se recicla por lejos (removeVehicle), el parrillero se
      // libera antes: VehicleView.dispose liberaría también sus mallas.
      v.pillionHook = true;
      const dispose = v.dispose.bind(v);
      v.dispose = () => {
        this._clearPillion(u);
        dispose();
      };
    }
  }

  /** Quita al parrillero de la moto (sin dejarlo en la calle). */
  _clearPillion(u) {
    const pl = u.pillion;
    if (!pl) return;
    pl.group.removeFromParent();
    pl.rig.dispose();
    u.pillion = null;
  }

  /**
   * La moto se quedó sin conductor de la Policía (lo bajaron, la robaron o
   * se dañó): el parrillero se baja y sigue a pie.
   */
  _dropPillion(u) {
    const pl = u.pillion;
    const s = u.vehicle.state;
    this._clearPillion(u);
    if (!pl) return;
    const off = this.city.collision.resolveCircle(s.x + Math.cos(s.heading) * POLICE_MOTO.deployOffset, s.z - Math.sin(s.heading) * POLICE_MOTO.deployOffset, PED.radius);
    const o = this.spawnPedAt(off.x, off.z, { outfit: 'police', faction: 'police', weapon: 'pistol', health: 120, sim: { hostile: true }, look: pl.look });
    o.sim.mode = 'attack';
  }

  /**
   * Parrillero: se dibuja y anima de cerca (como los conductores) y, con
   * POLICE_MOTO.gunnerMinLevel estrellas o más, dispara desde la moto a lo
   * que tenga al frente o al lado.
   */
  _updatePillion(u, dt, camPos, wanted, player) {
    const pl = u.pillion;
    const v = u.vehicle;
    const s = v.state;
    const q = this.quality;
    const ride = pl.group.userData.ride;
    const baseRide = v.view.group.userData.ride;
    if (ride && baseRide) ride.speed = baseRide.speed;
    const dc = dist2D(s.x, s.z, camPos.x, camPos.z);
    const show = v.view.group.visible && dc < q.driverDraw * 1.6;
    pl.rig.root.visible = show;
    skipWhenHidden(pl.rig.root);
    // ¿Dispara? Te ve, está cerca y quedas al frente o al lado de la moto.
    const dx = player.x - s.x;
    const dz = player.z - s.z;
    const dp = Math.hypot(dx, dz);
    let aiming = false;
    if (wanted.level >= POLICE_MOTO.gunnerMinLevel && u.sees && !u.leaving && !player.dead && dp < POLICE_MOTO.gunnerRange) {
      const fx = forwardX(s.heading);
      const fz = forwardZ(s.heading);
      aiming = Math.acos(Math.max(-1, Math.min(1, (fx * dx + fz * dz) / (dp || 1)))) < POLICE_MOTO.gunnerMaxAngle;
    }
    pl.aimT = aiming ? pl.aimT + dt : 0;
    // Saca la pistola solo para disparar (el resto del tiempo va agarrado).
    pl.rig.setWeapon(aiming ? 'pistol' : null);
    if (aiming && pl.aimT > POLICE_MOTO.gunnerAim) {
      // Un tirador liviano para combat.npcAttack (la misma puntería y daño
      // que los agentes a pie), con el cañón un poco adelante del parrillero.
      const g = (pl.gun ??= {
        x: 0, y: 0, z: 0, weapon: 'pistol', faction: 'police', mounted: true, fireCooldown: 0, sim: { yaw: 0 },
        rig: { muzzleWorld: (out) => out.set(g.x + g.mx, g.y + 1.35, g.z + g.mz) },
        mx: 0, mz: 0,
      });
      const back = POLICE_MOTO.pillionBack;
      g.x = s.x - forwardX(s.heading) * back;
      g.y = s.y + 0.3;
      g.z = s.z - forwardZ(s.heading) * back;
      g.mx = (dx / (dp || 1)) * 0.6;
      g.mz = (dz / (dp || 1)) * 0.6;
      const before = g.fireCooldown;
      this.game.combat.npcAttack(g, dt, player, dp);
      if (g.fireCooldown > before) g.fireCooldown += POLICE_MOTO.gunnerSlow;
    }
    if (show) {
      pl.rig.setShadow(dc < q.shadowChars);
      pl.rig.animate(dt, { speed: 0, onGround: true, driving: 'moto', aiming: aiming && pl.aimT > POLICE_MOTO.gunnerAim * 0.4, handsFree: true });
    }
  }

  _removeUnit(u) {
    this._clearPillion(u);
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
