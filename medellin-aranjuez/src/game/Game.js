// Orquestador del juego: renderizado, bucle principal, jugador, vehículos,
// armas, policía, misiones, puntos de interés, tiendas y guardado.

import * as THREE from 'three';
import { generateCity } from '../sim/cityLayout.js';
import { groundHeight } from '../sim/terrain.js';
import { dist2D } from '../sim/math.js';
import { circleVsObb } from '../sim/collision.js';
import { createPlayerState, stepPlayer } from '../sim/playerController.js';
import { stepVehicle, exitPoint, speedKmh, VEHICLE_TYPES } from '../sim/vehiclePhysics.js';
import { Inventory, WEAPONS, WEAPON_BY_ID } from '../sim/weapons.js';
import { WantedSystem } from '../sim/wanted.js';
import { MissionSystem, createMissionDefs } from '../sim/missions.js';
import { createTextureLibrary } from '../render/textures.js';
import { assets } from '../render/assets.js';
import '../render/assetManifest.js';
import { CityRenderer } from '../render/cityRenderer.js';
import { Environment } from '../render/environment.js';
import { PostFX, QUALITY_PRESETS } from '../render/postfx.js';
import { Effects } from '../render/effects.js';
import { CharacterRig, PLAYER_LOOK } from '../render/characterRig.js';
import { Input } from './input.js';
import { AudioSystem } from './audio.js';
import { World, VehicleEntity } from './world.js';
import { Combat } from './combat.js';
import { CameraRig } from './cameraRig.js';
import { Pickups } from './pickups.js';
import { Hud } from '../ui/hud.js';
import { WeaponWheel } from '../ui/weaponWheel.js';

const SETTINGS_KEY = 'aranjuez.settings.v1';
const SAVE_KEY = 'aranjuez.save.v1';

export const DEFAULT_SETTINGS = { quality: 'alta', sensitivity: 1, volume: 0.7, fov: 65, invertY: false, showFps: false };

function safeStorage(fn, fallback = null) {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

export function loadSettings() {
  const raw = safeStorage(() => localStorage.getItem(SETTINGS_KEY));
  return { ...DEFAULT_SETTINGS, ...(raw ? safeStorage(() => JSON.parse(raw), {}) : {}) };
}

export function saveSettings(s) {
  safeStorage(() => localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)));
}

export function loadSave() {
  const raw = safeStorage(() => localStorage.getItem(SAVE_KEY));
  return raw ? safeStorage(() => JSON.parse(raw)) : null;
}

class Player {
  constructor(game, x, z) {
    this.game = game;
    this.state = createPlayerState(x, z, groundHeight);
    this.rig = new CharacterRig(PLAYER_LOOK);
    game.scene.add(this.rig.root);
    this.inventory = new Inventory(['fists']);
    this.health = 100;
    this.armor = 0;
    this.money = 500;
    this.vehicle = null;
    this.lastVehicle = null;
    this.dead = false;
    this.damageFlash = 0;
    this.aiming = false;
  }

  get inVehicle() {
    return !!this.vehicle;
  }

  get x() {
    return this.vehicle ? this.vehicle.state.x : this.state.pos.x;
  }

  get y() {
    return this.vehicle ? this.vehicle.state.y : this.state.pos.y;
  }

  get z() {
    return this.vehicle ? this.vehicle.state.z : this.state.pos.z;
  }

  get speed() {
    return this.vehicle ? Math.abs(this.vehicle.state.forwardSpeed) : this.state.speed;
  }

  get yaw() {
    return this.vehicle ? this.vehicle.state.heading : this.state.yaw;
  }
}

export class Game {
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.opts = opts;
    this.settings = loadSettings();
    const qKey = opts.quality ?? this.settings.quality;
    this.quality = { ...(QUALITY_PRESETS[qKey] ?? QUALITY_PRESETS.alta) };
    this.state = 'loading';
    this.stats = { kills: 0, missions: 0, distance: 0, playTime: 0 };
    this.discovered = new Set();
    this.waypoint = null;
    this.target = null;
    this.gang = [];
    this.godMode = false;
    this.timers = { save: 0, street: 0, gps: 0 };
    this.nearPoi = null;

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: !this.quality.post, powerPreference: 'high-performance', stencil: false });
    this.basePixelRatio = Math.min(window.devicePixelRatio || 1, this.quality.pixelRatio);
    this.resScale = 1; // escala de la resolución dinámica (ver _adaptResolution)
    this.dynamicRes = opts.dynamicResolution ?? !opts.autotest;
    renderer.setPixelRatio(this.basePixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1;
    renderer.shadowMap.enabled = this.quality.shadows > 0;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.info.autoReset = false; // se reinicia por frame (incluye sombras y postproceso)
    this.renderer = renderer;
    this._detectGpu(qKey, opts);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(this.settings.fov, window.innerWidth / window.innerHeight, 0.1, this.quality.drawDistance);
    this.scene.add(this.camera);
    window.addEventListener('resize', () => this.resize());
  }

  /**
   * Nombre de la GPU (para diagnóstico) y, si WebGL corre por software
   * (controlador en lista negra, escritorio remoto…), calidad Baja
   * automáticamente: con render por software nada más es jugable.
   */
  _detectGpu(qKey, opts) {
    const gl = this.renderer.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    this.gpuName = String((ext && gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) || gl.getParameter(gl.RENDERER) || '?');
    this.softwareGpu = /swiftshader|llvmpipe|softpipe|software|basic render/i.test(this.gpuName);
    console.info(`GPU: ${this.gpuName}${this.softwareGpu ? ' (render por software)' : ''}`);
    if (this.softwareGpu && !opts.autotest && !opts.quality && qKey !== 'baja') {
      this.quality = { ...QUALITY_PRESETS.baja };
      this.basePixelRatio = Math.min(window.devicePixelRatio || 1, this.quality.pixelRatio);
      this.renderer.setPixelRatio(this.basePixelRatio);
      this.renderer.shadowMap.enabled = false;
    }
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.postfx?.setSize(w, h);
  }

  async init(progress = () => {}) {
    const step = async (p) => {
      progress(p);
      await new Promise((r) => setTimeout(r, 0));
    };
    await step(0.05);
    this.city = generateCity(4);
    await step(0.2);
    this.textures = createTextureLibrary();
    await step(0.3);
    // Recursos externos (modelos, texturas fotográficas, HDRI). Si alguno
    // falta, cada módulo usa su versión procedural.
    this.assetReport = await assets.loadAll(this.renderer, (p) => progress(0.3 + p * 0.15));
    await step(0.45);
    this.env = new Environment(this.renderer, this.scene, this.quality);
    await step(0.55);
    this.cityRenderer = new CityRenderer(this.scene, this.city, this.textures, this.quality);
    await step(0.8);
    this.effects = new Effects(this.scene);
    this.audio = new AudioSystem();
    this.audio.volume = this.settings.volume;
    this.input = new Input(this.canvas);
    this.input.sensitivity = this.settings.sensitivity;
    this.input.invertY = this.settings.invertY;
    this.camRig = new CameraRig(this.camera, this.city.collision);
    this.camRig.baseFov = this.settings.fov;
    this.wanted = new WantedSystem();
    this.missions = new MissionSystem(createMissionDefs(this.city));
    const sp = this.city.spawn;
    this.player = new Player(this, sp.x, sp.z);
    this.combat = new Combat(this);
    this.hud = new Hud(this);
    this.hud.showFps(this.settings.showFps);
    this.world = new World(this);
    this.pickups = new Pickups(this);
    this.wheel = new WeaponWheel(this);
    this.postfx = new PostFX(this.renderer, this.scene, this.camera, this.quality);
    await step(0.92);
    // Precalentar: pobla el barrio y compila shaders antes de mostrarlo.
    this.world.populate(sp.x, sp.z);
    for (let i = 0; i < 30; i++) this.world.update(0.05, this.player);
    await this._warmUp(sp);
    await step(1);
    this.state = 'menu';
    this.last = performance.now();
    this.menuT = 0;
    this._loop = (t) => {
      this.frame(t);
      this.raf = requestAnimationFrame(this._loop);
    };
    this.raf = requestAnimationFrame(this._loop);
    this._exposeApi();
  }

  /**
   * Precalentado detrás de la pantalla de carga: compila los shaders en
   * paralelo (KHR_parallel_shader_compile), sube las texturas a la GPU y
   * dibuja unos cuadros mirando a cada lado (sombras y postproceso incluidos),
   * para que el primer minuto de juego no tenga tirones.
   */
  async _warmUp(sp) {
    const r = this.renderer;
    try {
      await r.compileAsync(this.scene, this.camera);
    } catch {
      r.compile(this.scene, this.camera);
    }
    const seen = new Set();
    this.scene.traverse((o) => {
      for (const m of Array.isArray(o.material) ? o.material : o.material ? [o.material] : []) {
        for (const v of Object.values(m)) if (v?.isTexture && !seen.has(v.source)) {
          seen.add(v.source);
          r.initTexture(v);
        }
      }
    });
    const cam = this.camera;
    const y = groundHeight(sp.x, sp.z) + 2;
    const views = this.opts.autotest ? 1 : 4;
    for (let i = 0; i < views; i++) {
      cam.position.set(sp.x, y, sp.z);
      cam.rotation.set(-0.1, (i / 4) * Math.PI * 2, 0, 'YXZ');
      cam.updateMatrixWorld();
      this.env.update(0, cam.position);
      this.cityRenderer.updateLod(cam.position);
      this.postfx.render(this.scene, cam);
      await new Promise((res) => setTimeout(res, 0));
    }
  }

  /**
   * Resolución dinámica: mide el tiempo real entre cuadros y, si el juego no
   * alcanza la frecuencia de la pantalla (~60 fps), baja la resolución
   * interna hasta quality.minScale; cuando sobra margen la sube de a poco.
   * Si una subida hace caer los fps, no lo vuelve a intentar en un rato.
   */
  _adaptResolution(realDt) {
    if (!this.dynamicRes || this.state !== 'playing' || !(realDt > 0) || realDt > 0.25) return;
    const d = (this._dres ??= { avg: 1 / 60, minDt: 1 / 60, t: 0, good: 0, clock: 0, lastRaise: -1e9, blockUntil: 0 });
    d.clock += realDt;
    d.avg += (realDt - d.avg) * 0.08;
    // Pantallas de más de 60 Hz: el cuadro más rápido visto (la meta sigue siendo >= ~55 fps).
    d.minDt = Math.min(d.minDt, realDt);
    d.t += realDt;
    if (d.t < 0.5) return;
    d.t = 0;
    const budget = Math.max(1 / 54, d.minDt * 1.12);
    const min = this.quality.minScale ?? 0.6;
    if (d.avg > budget && this.resScale > min + 1e-3) {
      if (d.clock - d.lastRaise < 4) d.blockUntil = d.clock + 30; // la subida no aguantó
      this._setResScale(Math.max(min, this.resScale - (d.avg > 1 / 40 ? 0.15 : 0.08)));
      d.good = 0;
    } else if (d.avg < Math.max(1 / 58.5, d.minDt * 1.03)) {
      d.good += 0.5;
      if (d.good >= 3 && this.resScale < 1 && d.clock > d.blockUntil) {
        this._setResScale(Math.min(1, this.resScale + 0.05));
        d.lastRaise = d.clock;
        d.good = 0;
      }
    } else d.good = 0;
  }

  _setResScale(s) {
    this.resScale = s;
    const pr = this.basePixelRatio * s;
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.postfx?.setPixelRatio(pr);
  }

  // ================================================================ partida
  newGame(save = null) {
    const p = this.player;
    const sp = this.city.spawn;
    if (p.vehicle) this.exitVehicle(true);
    p.state = createPlayerState(sp.x, sp.z, groundHeight, sp.yaw);
    p.health = 100;
    p.armor = 0;
    p.money = 500;
    p.dead = false;
    p.inventory = new Inventory(['fists']);
    this.discovered.clear();
    this.missions.completed.clear();
    this.stats = { kills: 0, missions: 0, distance: 0, playTime: 0 };
    this.env.setTime(16.5);
    if (save) {
      p.money = save.money ?? 500;
      p.health = save.health ?? 100;
      p.armor = save.armor ?? 0;
      if (save.inventory) p.inventory = Inventory.deserialize(save.inventory);
      for (const id of save.discovered ?? []) this.discovered.add(id);
      for (const id of save.missions ?? []) this.missions.completed.add(id);
      Object.assign(this.stats, save.stats ?? {});
      if (save.time !== undefined) this.env.setTime(save.time);
      if (save.pos && !this.city.collision.pointBlocked(save.pos.x, save.pos.z)) {
        p.state = createPlayerState(save.pos.x, save.pos.z, groundHeight, 0);
      }
    } else {
      // Un regalo para empezar: una pistola con algo de munición.
      p.inventory.give('pistol', 30);
    }
    this.wanted.clear();
    this.world.clearPolice();
    this.world.populate(p.x, p.z);
    this.camRig.yaw = p.state.yaw;
    this.camRig.pitch = -0.12;
    this.camRig.first = true;
    this.hud.moneyShown = p.money;
    document.getElementById('money').textContent = `$${p.money.toLocaleString('es-CO')}`;
    this.setState('playing');
    this.hud.show(true);
    this.hud.big('ARANJUEZ', 'Comuna 4 · Medellín', 'gold', 3);
    setTimeout(() => {
      if (this.state === 'playing') {
        this.hud.help('Explora el barrio: los <b style="color:#ffd200">★</b> del minimapa son lugares por descubrir. Las misiones <b style="color:#f4a261">!</b> dan plata. <kbd>F</kbd> para subirte a un carro o moto, <kbd>M</kbd> mapa, <kbd>F1</kbd> controles.', 9);
      }
    }, 3200);
  }

  save() {
    const p = this.player;
    const data = {
      money: p.money,
      health: p.health,
      armor: p.armor,
      inventory: p.inventory.serialize(),
      discovered: [...this.discovered],
      missions: [...this.missions.completed],
      stats: this.stats,
      time: this.env.timeOfDay,
      pos: { x: p.x, z: p.z },
    };
    safeStorage(() => localStorage.setItem(SAVE_KEY, JSON.stringify(data)));
  }

  setState(s) {
    this.state = s;
    this.audio.suspend(s === 'paused' || s === 'shop');
    if (s !== 'playing') this.audio.setEngine(false);
    if (this.onStateChange) this.onStateChange(s);
  }

  addMoney(n) {
    this.player.money = Math.max(0, this.player.money + n);
    if (n > 0) {
      this.audio.ui('money');
      this.hud.bumpMoney();
      this.hud.toast(`<span style="color:#32c36c">+$${n.toLocaleString('es-CO')}</span>`);
    }
  }

  // ================================================================ bucle
  frame(t) {
    this.frameCount = (this.frameCount ?? 0) + 1;
    const tCpu0 = performance.now();
    this.renderer.info.reset();
    const realDt = (t - this.last) / 1000;
    let dt = Math.min(0.05, realDt);
    this.last = t;
    this._adaptResolution(realDt);
    if (!(dt > 0)) dt = 1 / 60;
    const a = this.input.poll();
    if (this.state === 'playing') {
      const simDt = this.wheel.open ? dt * 0.25 : dt;
      this.updatePlaying(simDt, dt, a);
    } else if (this.state === 'menu') {
      this.updateMenuCamera(dt);
    } else if (this.state === 'map') {
      if (a.map || a.pause) this.closeMap();
      else this.hud.drawFullMap(this._hudState());
    }
    const focus = (this._focus ??= new THREE.Vector3());
    if (this.state === 'playing' || this.state === 'paused') focus.set(this.player.x, this.player.y, this.player.z);
    else focus.copy(this.camRig.pos).setY(0);
    const running = this.state !== 'paused' && this.state !== 'shop';
    this.env.update(running ? dt : 0, focus);
    this.cityRenderer.update(running ? dt : 0, this.env.night);
    this.cityRenderer.updateLod(this.camera.position);
    if (running) this.effects.update(dt);
    this.postfx.setNight(this.env.night);
    this.player.damageFlash = Math.max(0, this.player.damageFlash - dt * 1.5);
    this.postfx.setDamage(this.player.damageFlash + (this.player.health < 25 && !this.player.dead ? 0.25 : 0));
    const tRender0 = performance.now();
    this.postfx.render(this.scene, this.camera);
    this.input.endFrame();
    this._recordPerf(tCpu0, tRender0, performance.now());
  }

  /** Telemetría de rendimiento (promedios móviles) para ajustar calidad y depurar. */
  _recordPerf(t0, tRender, t1) {
    const info = this.renderer.info.render;
    const p = (this.perf ??= { updateMs: 0, renderMs: 0, calls: 0, triangles: 0 });
    const k = 0.1;
    p.updateMs += (tRender - t0 - p.updateMs) * k;
    p.renderMs += (t1 - tRender - p.renderMs) * k;
    p.calls += (info.calls - p.calls) * k;
    p.triangles += (info.triangles - p.triangles) * k;
  }

  updateMenuCamera(dt) {
    this.menuT += dt;
    const c = this.city.pois.find((p) => p.id === 'parque');
    const ang = this.menuT * 0.05;
    const r = 120;
    this.camera.position.set(c.x + Math.cos(ang) * r, groundHeight(c.x, c.z) + 55, c.z + Math.sin(ang) * r);
    this.camera.lookAt(c.x - 40, groundHeight(c.x, c.z) + 5, c.z);
    this.camRig.pos.copy(this.camera.position);
    // La ciudad sigue viva en el fondo del menú.
    this.world.update(dt, { x: c.x, y: 0, z: c.z, inVehicle: false, speed: 0, dead: false });
  }

  updatePlaying(dt, realDt, a) {
    const p = this.player;
    this.stats.playTime += realDt;
    if (a.pause) return this.pause();
    if (a.map) return this.openMap();
    if (a.help) {
      this.pause();
      document.querySelector('#pause [data-action="controls"]').click();
      return;
    }
    if (a.camera) this.camRig.cycleZoom();

    // Rueda de armas.
    if (a.weaponWheel && !this.wheel.open && !p.dead) this.wheel.show(p.inventory);
    let lookX = a.lookX;
    let lookY = a.lookY;
    if (this.wheel.open) {
      this.wheel.update(lookX, lookY, p.inventory);
      lookX = lookY = 0;
      if (!a.weaponWheel) {
        const sel = this.wheel.close();
        if (sel) p.inventory.select(sel);
      }
    }

    // Selección de arma.
    if (!p.dead) {
      if (a.weaponSlot) p.inventory.selectSlot(a.weaponSlot);
      if (a.weaponCycle) p.inventory.cycle(a.weaponCycle);
      if (a.reload && p.inventory.reload()) this.audio.ui('tick');
    }

    if (p.dead) {
      p.rig.animate(dt, { dead: true, speed: 0, onGround: true });
      this.deathTimer -= realDt;
      if (this.deathTimer <= 0) this.respawn();
    } else if (p.inVehicle) {
      this.updateDriving(dt, a);
    } else {
      this.updateOnFoot(dt, a);
    }

    // Cámara.
    const v = p.vehicle;
    this.camRig.update(realDt, {
      x: p.x,
      y: p.y,
      z: p.z,
      inVehicle: !!v,
      vehicleHeading: v?.state.heading ?? 0,
      vehicleSpeed: v?.state.forwardSpeed ?? 0,
      vehicleSize: v ? v.state.spec.length : 0,
      aiming: p.aiming,
      sprinting: p.state.sprinting,
      lookBehind: a.lookBehind,
      lookX,
      lookY,
    });
    this.audio.listener = { x: this.camera.position.x, y: this.camera.position.y, z: this.camera.position.z };

    // Mundo vivo.
    this.world.update(dt, p);
    const police = this.world.updatePolice(dt, p, this.wanted);
    this.wanted.update(dt, police.seen, { x: p.x, z: p.z });
    this.audio.setSiren(this.wanted.level > 0 ? police.nearest : Infinity);
    this.pickups.update(dt, p);
    this._updateMissions(dt);
    this._updatePois(realDt, a);
    this._updateGps(realDt);

    // Guardado automático.
    this.timers.save += realDt;
    if (this.timers.save > 30 && !p.dead) {
      this.timers.save = 0;
      this.save();
    }
    this.hud.update(realDt, this._hudState());
  }

  // ================================================================ a pie
  updateOnFoot(dt, a) {
    const p = this.player;
    const inv = p.inventory;
    const w = inv.current;
    p.aiming = a.aim && !this.wheel.open;
    const moving = Math.hypot(a.moveX, a.moveY) > 0.1;
    const obstacles = [];
    for (const v of this.world.vehicles) {
      if (Math.abs(v.state.x - p.state.pos.x) < 8 && Math.abs(v.state.z - p.state.pos.z) < 8) obstacles.push(v.obb());
    }
    stepPlayer(
      p.state,
      {
        forward: a.moveY,
        right: a.moveX,
        sprint: a.sprint,
        jump: a.jump,
        crouch: a.crouch,
        walk: a.walk,
        aiming: p.aiming || (a.fire && w.kind === 'gun'),
        camYaw: this.camRig.yaw,
      },
      dt,
      { groundHeight, collision: this.city.collision, obstacles },
    );
    this.stats.distance += p.state.speed * dt;
    this._checkRunOver(dt);
    if (p.state.landedImpact > 13) {
      this.combat.damagePlayer((p.state.landedImpact - 13) * 6, null);
    }
    p.state.landedImpact = 0;

    // Armas.
    inv.update(dt, moving);
    if (!this.wheel.open) {
      const shot = inv.tryFire(a.fire, Math.random, p.aiming, moving);
      if (shot) {
        // Al disparar sin apuntar, el personaje gira hacia la mira.
        p.state.yaw = this.camRig.yaw;
        this.combat.playerFire(shot, this.camRig.aimRay());
      }
    }
    p.rig.setWeapon(w.id);
    p.rig.root.position.set(p.state.pos.x, p.state.pos.y, p.state.pos.z);
    p.rig.root.rotation.y = p.state.yaw;
    p.rig.animate(dt, {
      speed: p.state.speed,
      onGround: p.state.onGround,
      aiming: (p.aiming || inv.cooldown > 0.05) && w.kind === 'gun',
      crouching: p.state.crouching,
      aimPitch: this.camRig.pitch,
    });

    // Subirse a un vehículo.
    if (a.enterVehicle) {
      const v = this.world.nearestVehicle(p.state.pos.x, p.state.pos.z, 2.5);
      if (v) this.enterVehicle(v);
    }
  }

  /** Un vehículo en marcha que golpea al jugador a pie le hace daño y lo empuja. */
  _checkRunOver(dt) {
    const p = this.player;
    this.hitCooldown = Math.max(0, (this.hitCooldown ?? 0) - dt);
    if (this.hitCooldown > 0) return;
    for (const v of this.world.vehicles) {
      const s = v.state;
      const speed = Math.hypot(s.vx, s.vz);
      if (speed < 4 || Math.abs(s.x - p.x) > 6 || Math.abs(s.z - p.z) > 6) continue;
      const hit = circleVsObb(p.state.pos.x, p.state.pos.z, 0.45, v.obb(0.1));
      if (!hit) continue;
      this.hitCooldown = 1;
      this.combat.damagePlayer(speed * 4, { x: s.x, y: s.y, z: s.z });
      p.state.vel.x = s.vx * 0.8 + hit.nx * 3;
      p.state.vel.z = s.vz * 0.8 + hit.nz * 3;
      p.state.vel.y = 3;
      p.state.onGround = false;
      this.audio.crash({ x: p.x, y: p.y, z: p.z }, speed);
      break;
    }
  }

  // ================================================================ conduciendo
  updateDriving(dt, a) {
    const p = this.player;
    const v = p.vehicle;
    const s = v.state;
    const input = { throttle: a.throttle, brake: a.brake, steer: a.steer, handbrake: a.handbrake };
    const obstacles = [];
    for (const o of this.world.vehicles) {
      if (o === v) continue;
      if (Math.abs(o.state.x - s.x) < 14 && Math.abs(o.state.z - s.z) < 14) obstacles.push(o.obb());
    }
    const prevSpeed = Math.hypot(s.vx, s.vz);
    const impact = stepVehicle(s, input, dt, { groundHeight, collision: this.city.collision, obstacles });
    // Empujar a los otros vehículos con los que chocamos.
    if (impact > 0) {
      for (const o of this.world.vehicles) {
        if (o === v) continue;
        const d = dist2D(o.state.x, o.state.z, s.x, s.z);
        if (d < (o.state.spec.length + s.spec.length) / 2 + 0.3) {
          const k = (s.spec.mass / (s.spec.mass + o.state.spec.mass)) * prevSpeed * 0.6;
          const l = d || 1;
          o.state.vx += ((o.state.x - s.x) / l) * k;
          o.state.vz += ((o.state.z - s.z) / l) * k;
          o.state.health -= impact * 12;
          o.lastHitBy = 'player';
          if (o.driver === 'npc') o.panic = 10;
        }
      }
    }
    if (impact > 3) {
      this.audio.crash({ x: s.x, y: s.y, z: s.z }, impact);
      this.camRig.shake(Math.min(0.5, impact * 0.03));
      if (impact > 14 && s.type === 'moto') {
        // En moto, un choque fuerte te tumba.
        this.exitVehicle(true);
        this.combat.damagePlayer(impact * 2.5, null);
        return;
      }
      if (impact > 16) this.combat.damagePlayer((impact - 16) * 2, null);
    }
    this.stats.distance += Math.abs(s.forwardSpeed) * dt;
    this.audio.setEngine(true, Math.min(1, Math.abs(s.forwardSpeed) / s.spec.maxSpeed + a.throttle * 0.15), s.type);
    this.audio.horn(a.horn);
    if (a.horn) this.world.addThreat(s.x, s.z, 12, 0.3);

    // Disparar desde el vehículo (drive-by) con armas de una mano.
    const inv = p.inventory;
    inv.update(dt, true);
    p.aiming = a.aim && inv.current.kind === 'gun';
    if (p.aiming && ['pistol', 'smg'].includes(inv.currentId)) {
      const shot = inv.tryFire(a.fire, Math.random, true, true);
      if (shot) this.combat.playerFire(shot, this.camRig.aimRay());
    }
    p.rig.animate(dt, { speed: 0, onGround: true, driving: s.type === 'moto' ? 'moto' : 'car', aiming: p.aiming });

    if (s.health <= 0 && !v.exploded && v.burnTimer > 0 && v.burnTimer < 3.5) {
      this.hud.toast('¡El vehículo se está incendiando! Bájate (F)');
    }
    if (v.exploded) {
      this.exitVehicle(true);
      return;
    }
    if (a.enterVehicle) {
      if (Math.abs(s.forwardSpeed) < 7) this.exitVehicle();
      else {
        // Tirarse del vehículo en marcha (con daño).
        this.exitVehicle(true);
        this.combat.damagePlayer(Math.abs(s.forwardSpeed) * 1.2, null);
      }
    }
  }

  enterVehicle(v) {
    const p = this.player;
    if (v.driver && v.driver !== 'player') {
      // Robo del vehículo: el conductor sale corriendo.
      this.world.ejectDriver(v, { x: p.x, z: p.z });
      const policeNear = this.world.policeUnits.some((u) => dist2D(u.vehicle.state.x, u.vehicle.state.z, p.x, p.z) < 60) || this.world.peds.some((q) => q.faction === 'police' && q.alive && dist2D(q.x, q.z, p.x, p.z) < 40);
      if (policeNear || v.type === 'policia') this.wanted.report('carjack', p);
      this.hud.toast(`Robaste: ${v.state.spec.name}`);
    }
    if (v.type === 'policia' && this.wanted.level < 1) this.wanted.report('carjack', p);
    v.driver = 'player';
    v.kind = 'player';
    v.agent = null;
    v.siren = false;
    v.clearDriverRig();
    p.vehicle = v;
    p.lastVehicle = v;
    p.state.vel.x = p.state.vel.y = p.state.vel.z = 0;
    const seat = v.view.seat;
    p.rig.root.position.set(seat.x, seat.y - 0.5 + (v.type === 'moto' ? 0.35 : 0), seat.z);
    p.rig.root.rotation.set(0, 0, 0);
    v.view.group.add(p.rig.root);
    p.rig.setWeapon(null);
    // Cámara detrás del vehículo.
    this.camRig.yaw = v.state.heading;
    this.audio.init();
    this.audio.setEngine(true, 0, v.type);
  }

  exitVehicle(force = false) {
    const p = this.player;
    const v = p.vehicle;
    if (!v) return;
    const s = v.state;
    let pt = exitPoint(s);
    // Si el lado del conductor está bloqueado, salir por el otro lado.
    if (this.city.collision.pointBlocked(pt.x, pt.z)) {
      pt = { x: 2 * s.x - pt.x, z: 2 * s.z - pt.z };
    }
    const r = this.city.collision.resolveCircle(pt.x, pt.z, 0.4);
    if (!force && this.city.collision.pointBlocked(r.x, r.z)) {
      this.hud.toast('No hay espacio para bajarse');
      return;
    }
    this.scene.add(p.rig.root);
    p.state = createPlayerState(r.x, r.z, groundHeight, s.heading);
    p.state.stamina = 100;
    v.driver = null;
    v.kind = 'parked';
    p.vehicle = null;
    p.aiming = false;
    this.audio.setEngine(false);
    this.audio.horn(false);
  }

  // ================================================================ muerte
  killPlayer() {
    const p = this.player;
    if (p.dead) return;
    if (p.vehicle) this.exitVehicle(true);
    p.dead = true;
    p.health = 0;
    this.deathTimer = 5;
    this.hud.big('HERIDO', 'Te llevan al Hospital San Vicente…', 'red', 5);
    this.audio.ui('fail');
    if (this.missions.active) this._handleMissionEvents(this.missions.update(0, { x: p.x, z: p.z, dead: true }));
  }

  respawn() {
    const p = this.player;
    const h = this.city.hospital;
    const fee = Math.min(p.money, Math.max(100, Math.round(p.money * 0.1)));
    p.money -= fee;
    p.state = createPlayerState(h.x, h.z, groundHeight, Math.PI);
    p.health = 100;
    p.armor = 0;
    p.dead = false;
    p.rig.deadBlend = 0;
    this.wanted.clear();
    this.world.clearPolice();
    this.camRig.yaw = Math.PI;
    this.camRig.first = true;
    this.world.populate(h.x, h.z);
    this.hud.hideBig();
    this.hud.toast(`Cuenta del hospital: -$${fee.toLocaleString('es-CO')}`, 4);
    this.save();
  }

  // ================================================================ misiones
  _updateMissions(dt) {
    const p = this.player;
    const ctx = { x: p.x, z: p.z, inVehicle: p.inVehicle, gangAlive: this.gang.filter((g) => g.alive).length, dead: p.dead };
    this._handleMissionEvents(this.missions.update(dt, ctx));
    const a = this.missions.active;
    this.hud.missionTimer(a && a.timer !== null ? Math.max(0, a.timer) : null);
    // Marcadores de dadores de misión / tiendas cuando no hay misión activa.
    for (const poi of this.city.pois) {
      const giver = !a && this.missions.available(poi.id) && !this.missions.completed.has(this.missions.available(poi.id).id);
      const shop = poi.type === 'shop' || poi.id === 'hospital' || poi.id === 'taller';
      if (giver || shop) {
        const color = giver ? 0xffd200 : poi.id === 'armeria' ? 0xe63946 : 0x3a86ff;
        this.effects.setMarker(`poi-${poi.id}`, new THREE.Vector3(poi.x, groundHeight(poi.x, poi.z), poi.z), color);
      } else {
        this.effects.removeMarker(`poi-${poi.id}`);
      }
    }
    // Marcas de los pandilleros en el minimapa las da el HUD (enemigos).
  }

  _handleMissionEvents(events) {
    for (const e of events) {
      switch (e.type) {
        case 'start':
          this.hud.big(e.mission.title.toUpperCase(), 'Misión', 'gold', 2.5);
          this.audio.ui('ok');
          break;
        case 'objective':
          this.hud.objective(e.text);
          this.target = e.target ? { x: e.target.x, z: e.target.z } : null;
          if (this.target) this.effects.setMarker('mission', new THREE.Vector3(this.target.x, groundHeight(this.target.x, this.target.z), this.target.z), 0xffd200, 6);
          else this.effects.removeMarker('mission');
          this.timers.gps = 99;
          break;
        case 'stageComplete':
          this.audio.ui('checkpoint');
          break;
        case 'spawnVehicle': {
          const poi = this.city.pois.find((x) => x.id === 'taller');
          const lp = this.world.lanePointNear(poi.x - 8, poi.z);
          const v = new VehicleEntity(this.world, e.vehicle, lp.x, lp.z, lp.yaw, { kind: 'parked', color: 0xd62828 });
          this.world.vehicles.push(v);
          this.player.lastVehicle = v;
          this.hud.help('Súbete a la moto roja (<kbd>F</kbd>) y pasa por todos los checkpoints antes de que se acabe el tiempo.', 7);
          break;
        }
        case 'spawnGang':
          this.gang = this.world.spawnGang(e.at, e.count);
          break;
        case 'complete':
          this.addMoney(e.reward);
          this.stats.missions++;
          this.hud.big('¡MISIÓN CUMPLIDA!', `+$${e.reward.toLocaleString('es-CO')}`, 'gold', 4);
          this._endMission();
          this.save();
          break;
        case 'fail':
          this.hud.big('MISIÓN FALLIDA', e.reason, 'red', 4);
          this.audio.ui('fail');
          this._endMission();
          break;
        default:
          break;
      }
    }
  }

  _endMission() {
    this.hud.objective('');
    this.target = null;
    this.effects.removeMarker('mission');
    for (const g of this.gang) {
      g.missionGang = false;
      if (g.alive) {
        g.faction = 'civil';
        g.sim.hostile = false;
        g.sim.mode = 'flee';
        g.sim.fleeFrom = { x: this.player.x, z: this.player.z };
      }
    }
    this.gang = [];
  }

  // ================================================================ lugares
  _updatePois(dt, a) {
    const p = this.player;
    let near = null;
    for (const poi of this.city.pois) {
      const d = dist2D(poi.x, poi.z, p.x, p.z);
      if (d < 28 && !this.discovered.has(poi.id)) {
        this.discovered.add(poi.id);
        this.hud.poi(poi);
        this.addMoney(100);
        this.hud.toast(`Lugar descubierto (${this.discovered.size}/${this.city.pois.length})`);
      }
      if (d < (poi.radius ?? 3.5) + (p.inVehicle ? 3 : 0)) near = poi;
    }
    if (near !== this.nearPoi) {
      this.nearPoi = near;
      const prompt = near ? this._interactPrompt(near) : null;
      if (prompt) this.hud.help(prompt, 4);
    }
    if (near && a.interact && !p.dead) this.interact(near);
  }

  _interactPrompt(poi) {
    const m = this.missions.available(poi.id);
    if (poi.id === 'armeria') return 'Presiona <kbd>E</kbd> para comprar armas, munición y chaleco.';
    if (poi.id === 'hospital') return 'Presiona <kbd>E</kbd> para curarte ($200).';
    if (poi.id === 'taller') return this.player.inVehicle ? 'Presiona <kbd>E</kbd> para reparar el vehículo ($300).' : m ? `Presiona <kbd>E</kbd> para iniciar: <b>${m.title}</b> ($${m.reward}).` : null;
    if (m) return `Presiona <kbd>E</kbd> para iniciar la misión: <b>${m.title}</b> (recompensa $${m.reward.toLocaleString('es-CO')}).`;
    return null;
  }

  interact(poi) {
    const p = this.player;
    if (poi.id === 'armeria') return this.openShop();
    if (poi.id === 'hospital') {
      if (p.health >= 100) return this.hud.toast('Estás sano, parce.');
      if (p.money < 200) return this.hud.toast('No te alcanza la plata.');
      this.addMoney(-200);
      p.health = 100;
      this.audio.ui('ok');
      return this.hud.toast('Curado: salud al 100 %');
    }
    if (poi.id === 'taller' && p.inVehicle) {
      const v = p.vehicle;
      if (p.money < 300) return this.hud.toast('No te alcanza la plata.');
      if (v.state.health >= v.state.spec.health) return this.hud.toast('El vehículo está perfecto.');
      this.addMoney(-300);
      v.state.health = v.state.spec.health;
      v.burnTimer = -1;
      this.audio.ui('ok');
      return this.hud.toast('Vehículo reparado');
    }
    const m = this.missions.available(poi.id);
    if (m) this._handleMissionEvents(this.missions.start(m.id));
  }

  // ================================================================ GPS
  _updateGps(dt) {
    this.timers.gps += dt;
    this.timers.street += dt;
    if (this.timers.street > 0.5) {
      this.timers.street = 0;
      this._street = this._streetName();
    }
    if (this.timers.gps < 1) return;
    this.timers.gps = 0;
    const dest = this.target ?? this.waypoint;
    if (!dest) {
      this.hud.route = null;
      return;
    }
    const p = this.player;
    if (this.waypoint && !this.target && dist2D(p.x, p.z, this.waypoint.x, this.waypoint.z) < 8) {
      this.waypoint = null;
      this.hud.route = null;
      this.hud.toast('Llegaste al destino');
      return;
    }
    const g = this.world.graph;
    const a = g.nearestNode(p.x, p.z);
    const b = g.nearestNode(dest.x, dest.z);
    const route = g.route(a.id, b.id);
    this.hud.routeColor = this.target ? '#ffd200' : '#b04dff';
    this.hud.route = route ? [{ x: p.x, z: p.z }, ...route.map((id) => g.node(id)), { x: dest.x, z: dest.z }] : null;
  }

  _streetName() {
    const p = this.player;
    const e = this.world.graph.nearestEdge(p.x, p.z);
    let zone = 'Aranjuez';
    let best = 60;
    for (const poi of this.city.pois) {
      const d = dist2D(poi.x, poi.z, p.x, p.z);
      if (d < best) {
        best = d;
        zone = poi.name;
      }
    }
    return `${e.edge.name}<small>${zone} · Comuna 4</small>`;
  }

  _hudState() {
    const p = this.player;
    const inv = p.inventory;
    const enemies = this.world.peds.filter((q) => q.alive && (q.faction === 'gang' || (q.faction === 'police' && this.wanted.level > 0))).map((q) => ({ x: q.x, z: q.z, police: q.faction === 'police' }));
    const policeCars = this.wanted.level > 0 ? this.world.policeUnits.map((u) => ({ x: u.vehicle.state.x, z: u.vehicle.state.z })) : [];
    const v = p.vehicle;
    return {
      x: p.x,
      z: p.z,
      camYaw: this.camRig.yaw,
      playerYaw: p.yaw,
      clock: this.env.clockText,
      money: p.money,
      weapon: inv.current,
      ammo: inv.ammo ?? { mag: 0, reserve: 0 },
      reloading: inv.reloading > 0,
      wanted: this.wanted.level,
      // Zona donde busca la policía (solo cuando te perdió de vista).
      searchZone: this.wanted.level > 0 && this.wanted.sinceSeen > 1.5 ? { ...this.wanted.zoneCenter(), r: this.wanted.zoneRadius() } : null,
      wantedFlash: this.wanted.flash > 0 || (this.wanted.level > 0 && this.wanted.unseenTimer > 2),
      health: p.health,
      armor: p.armor,
      stamina: p.state.stamina,
      street: this._street ?? '',
      aiming: p.aiming,
      dead: p.dead,
      inVehicle: !!v,
      speed: p.speed,
      speedKmh: v ? speedKmh(v.state) : 0,
      vehicleName: v ? v.state.spec.name : '',
      vehicleHealth: v ? v.state.health / v.state.spec.health : 0,
      enemies,
      policeCars,
      target: this.target,
      waypoint: this.waypoint,
    };
  }

  // ================================================================ menús
  pause() {
    if (this.state !== 'playing') return;
    this.setState('paused');
    this.input.exitLock();
    this.wheel.close();
    this.save();
  }

  resume() {
    this.setState('playing');
    this.audio.init();
    if (!this.opts.autotest) this.input.requestLock();
  }

  openMap() {
    if (this.state !== 'playing' && this.state !== 'paused') return;
    this.setState('map');
    this.input.exitLock();
    document.getElementById('map-screen').classList.remove('hidden');
    document.getElementById('pause').classList.add('hidden');
    this.hud.drawFullMap(this._hudState());
  }

  closeMap() {
    document.getElementById('map-screen').classList.add('hidden');
    this.resume();
  }

  setWaypoint(x, z) {
    this.waypoint = { x, z };
    this.timers.gps = 99;
    this._updateGps(0);
    this.hud.drawFullMap(this._hudState());
  }

  openShop() {
    this.setState('shop');
    this.input.exitLock();
    if (this.onOpenShop) this.onOpenShop();
  }

  buy(item) {
    const p = this.player;
    if (p.money < item.price) {
      this.hud.toast('No te alcanza la plata, parce.');
      this.audio.ui('fail');
      return false;
    }
    if (item.kind === 'weapon') {
      p.inventory.give(item.id);
      p.inventory.select(item.id);
    } else if (item.kind === 'ammo') {
      const w = WEAPON_BY_ID[item.id];
      if (p.inventory.addAmmo(item.id, w.mag * 2) === 0) {
        this.hud.toast('Ya tienes la munición al tope.');
        return false;
      }
    } else if (item.kind === 'armor') {
      if (p.armor >= 100) return false;
      p.armor = 100;
    } else if (item.kind === 'health') {
      if (p.health >= 100) return false;
      p.health = 100;
    }
    p.money -= item.price;
    this.audio.ui('money');
    this.save();
    return true;
  }

  shopItems() {
    const inv = this.player.inventory;
    const items = [];
    for (const w of WEAPONS) {
      if (w.kind === 'melee' && w.price === 0) continue;
      if (!inv.has(w.id)) items.push({ kind: 'weapon', id: w.id, name: w.name, icon: w.icon, price: w.price, desc: w.kind === 'gun' ? `Daño ${w.damage}${w.pellets > 1 ? `×${w.pellets}` : ''} · Cargador ${w.mag} · ${w.auto ? 'Automática' : 'Semiautomática'}` : `Cuerpo a cuerpo · Daño ${w.damage}` });
      else if (w.kind === 'gun') items.push({ kind: 'ammo', id: w.id, name: `Munición: ${w.name}`, icon: '📦', price: w.ammoPrice, desc: `+${w.mag * 2} balas (tienes ${inv.owned.get(w.id).reserve}/${w.maxReserve})` });
    }
    items.push({ kind: 'armor', id: 'armor', name: 'Chaleco antibalas', icon: '🦺', price: 400, desc: 'Absorbe 2/3 del daño recibido' });
    items.push({ kind: 'health', id: 'health', name: 'Botiquín', icon: '🩹', price: 150, desc: 'Salud al 100 %' });
    return items;
  }

  // ================================================================ API de pruebas
  _exposeApi() {
    const g = this;
    window.__game = {
      get ready() {
        return g.state !== 'loading';
      },
      get frames() {
        return g.frameCount ?? 0;
      },
      perf() {
        const r = g.renderer.info;
        return { ...g.perf, geometries: r.memory.geometries, textures: r.memory.textures, programs: r.programs?.length ?? 0, pixelRatio: g.renderer.getPixelRatio() };
      },
      assetReport() {
        return { ...g.assetReport, keys: [...assets.items.keys()] };
      },
      state() {
        const p = g.player;
        return {
          state: g.state,
          x: p.x,
          y: p.y,
          z: p.z,
          yaw: p.yaw,
          inVehicle: p.inVehicle,
          vehicleType: p.vehicle?.type ?? null,
          speed: p.speed,
          speedKmh: p.vehicle ? speedKmh(p.vehicle.state) : p.speed * 3.6,
          onGround: p.state.onGround,
          health: p.health,
          armor: p.armor,
          money: p.money,
          weapon: p.inventory.currentId,
          ammo: p.inventory.ammo ? { ...p.inventory.ammo } : null,
          owned: p.inventory.ownedList().map((w) => w.id),
          wanted: g.wanted.level,
          dead: p.dead,
          peds: g.world.peds.length,
          vehicles: g.world.vehicles.length,
          police: g.world.policeUnits.length,
          mission: g.missions.active?.def.id ?? null,
          missionStage: g.missions.active?.stage ?? null,
          completed: [...g.missions.completed],
          discovered: [...g.discovered],
          time: g.env.timeOfDay,
          fps: g.hud.fps.value,
          blocked: g.city.collision.pointBlocked(p.x, p.z, p.y + 1),
        };
      },
      setInput(v) {
        g.input.virtual = v ? { ...v } : null;
      },
      start() {
        g.newGame();
      },
      teleport(x, z) {
        if (g.player.vehicle) g.exitVehicle(true);
        g.player.state = createPlayerState(x, z, groundHeight, g.player.state.yaw);
      },
      look(yaw, pitch = -0.12) {
        g.camRig.yaw = yaw;
        g.camRig.pitch = pitch;
      },
      giveAll() {
        for (const w of WEAPONS) g.player.inventory.give(w.id);
      },
      spawnVehicle(type = 'taxi') {
        const lp = g.world.lanePointNear(g.player.x, g.player.z);
        const v = new VehicleEntity(g.world, type, lp.x, lp.z, lp.yaw, { kind: 'parked' });
        g.world.vehicles.push(v);
        return { x: lp.x, z: lp.z, heading: lp.yaw };
      },
      enterNearest(maxD = 6) {
        const v = g.world.nearestVehicle(g.player.x, g.player.z, maxD);
        if (v) g.enterVehicle(v);
        return !!v;
      },
      exitVehicle() {
        g.exitVehicle(true);
      },
      startMission(id) {
        g._handleMissionEvents(g.missions.start(id));
      },
      setTime(h) {
        g.env.setTime(h);
      },
      pois() {
        return g.city.pois.map((p) => ({ id: p.id, name: p.name, x: p.x, z: p.z }));
      },
      damage(n) {
        g.combat.damagePlayer(n, null);
      },
      addWanted(level) {
        for (let i = 0; i < level; i++) g.wanted.report('copKill', g.player);
      },
      /** Simula `seconds` de juego (con entrada virtual) sin esperar al render. */
      advance(seconds, input = null, step = 1 / 30) {
        const n = Math.max(1, Math.round(seconds / step));
        for (let i = 0; i < n; i++) {
          g.input.virtual = input ? { ...input } : null;
          const a = g.input.poll();
          if (g.state === 'playing') g.updatePlaying(step, step, a);
          const p = g.player;
          g.env.update(step, new THREE.Vector3(p.x, p.y, p.z));
          g.cityRenderer.update(step, g.env.night);
          g.effects.update(step);
          g.input.endFrame();
        }
        g.input.virtual = null;
        return this.state();
      },
      clearMessages() {
        g.hud.hideBig();
        g.hud.helpTimer = 0.001;
        g.hud.poiTimer = 0.001;
      },
      pause: () => g.pause(),
      resume: () => g.resume(),
      vehicleTypes: () => Object.keys(VEHICLE_TYPES),
      screenshotHudHidden(on) {
        g.hud.show(!on);
      },
    };
  }
}
