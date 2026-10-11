// Orquestador del juego: renderizado, bucle principal, jugador, vehículos,
// armas, policía, misiones, puntos de interés, tiendas y guardado.

import * as THREE from 'three';
import { generateCity } from '../sim/cityLayout.js';
import { groundHeight } from '../sim/terrain.js';
import { dist2D } from '../sim/math.js';
import { circleVsObb } from '../sim/collision.js';
import { createPlayerState, stepPlayer } from '../sim/playerController.js';
import { stepVehicle, exitPoint, speedKmh, VEHICLE_TYPES } from '../sim/vehiclePhysics.js';
import { VEHICLE_VARIANTS, defaultVariant } from '../sim/vehicleVariants.js';
import { Inventory, WEAPONS, WEAPON_BY_ID } from '../sim/weapons.js';
import { WantedSystem } from '../sim/wanted.js';
import { MissionSystem, createMissionDefs } from '../sim/missions.js';
import { createTextureLibrary } from '../render/textures.js';
import { assets } from '../render/assets.js';
import '../render/assetManifest.js';
import { CityRenderer } from '../render/cityRenderer.js';
import { NightLights } from '../render/nightLights.js';
import { Environment } from '../render/environment.js';
import { Horizon } from '../render/horizon.js';
import { BirdRenderer } from '../render/birds.js';
import { BirdSim, pigeonHomes } from '../sim/birds.js';
import { playBirdEvents } from './birdSounds.js';
import { PostFX, QUALITY_PRESETS } from '../render/postfx.js';
import { Effects } from '../render/effects.js';
import { CharacterRig, PLAYER_LOOK } from '../render/characterRig.js';
import { applyOutfit } from '../render/outfit.js';
import { ROPA_BY_ID, buyOrWear, deserializeWardrobe, newWardrobe, serializeWardrobe, storeCatalog, takeOff } from '../sim/ropa.js';
import { Input } from './input.js';
import { AudioSystem } from './audio.js';
import { RadioSystem } from './radio.js';
import { World, VehicleEntity } from './world.js';
import { Combat } from './combat.js';
import { CameraRig } from './cameraRig.js';
import { Pickups } from './pickups.js';
import { Dialogue } from './dialogue.js';
import { StoryDirector } from './storyDirector.js';
import { Boarding } from './boarding.js';
import { playerStyle, purchaseGestures, EMOTES, nextEmote } from '../sim/animSelect.js';
import { Hud } from '../ui/hud.js';
import { WeaponWheel } from '../ui/weaponWheel.js';

// Tomas del menú principal (relativas al punto de interés, en metros; y sobre el suelo).
const MENU_SHOTS = [
  { poi: 'parque', title: 'Parque de Aranjuez', sub: 'Calle 92 · la iglesia San Nicolás al lado', from: [95, 48, 55], to: [45, 34, -80], look: [0, 4, 0] },
  { poi: 'moravia', title: 'Morro de Moravia', sub: 'De basurero a jardín comunitario', from: [-90, 45, 70], to: [70, 58, 95], look: [0, 12, 0] },
  { poi: 'metro', title: 'Estación Caribe', sub: 'Línea A del Metro · río Medellín', from: [45, 24, 75], to: [-5, 28, 100], look: [-60, 6, 0] },
  { poi: 'mirador', title: 'Mirador de Aranjuez', sub: 'El valle de Aburrá a tus pies', from: [15, 14, -35], to: [15, 16, 35], look: [-400, -70, 0] },
  { poi: 'iglesia', title: 'Iglesia San Nicolás', sub: 'Aranjuez · Comuna 4', from: [28, 7, 42], to: [-20, 9, 34], look: [0, 9, 0] },
];

const SETTINGS_KEY = 'aranjuez.settings.v1';
const SAVE_KEY = 'aranjuez.save.v1';

export const DEFAULT_SETTINGS = { quality: 'alta', sensitivity: 1, volume: 0.7, musicVolume: 0.8, fov: 65, invertY: false, showFps: false, dynamicRes: true, brightness: 1, fullscreen: false, subtitles: true, vehicleView: 'cerca', camSmoothing: 0.5, firstPerson: false };

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
    // Ropa: lo que tiene puesto y lo que ha comprado (sim/ropa.js).
    this.wardrobe = newWardrobe();
    applyOutfit(this.rig, this.wardrobe.outfit);
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
    this.dynamicRes = opts.dynamicResolution ?? (!opts.autotest && this.settings.dynamicRes !== false);
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
  /**
   * Si el controlador de video reinicia la GPU (o Windows la suspende), WebGL
   * pierde el contexto y la pantalla queda negra o congelada. Se guarda la
   * partida y, cuando el navegador devuelve el contexto, se recarga el juego
   * (rearmar a mano miles de geometrías y texturas no vale el riesgo).
   */
  _watchContext() {
    const c = this.canvas;
    c.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      if (this.state === 'playing' && !this.player.dead) this.save();
      this.contextLost = true;
      this.hud?.toast?.('La tarjeta de video se reinició: recuperando el juego…', 6);
    });
    c.addEventListener('webglcontextrestored', () => window.location.reload());
  }

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
    assets.hd = !!this.quality.hdTextures;
    this.assetReport = await assets.loadAll(this.renderer, (p) => progress(0.3 + p * 0.15));
    await step(0.45);
    this.env = new Environment(this.renderer, this.scene, this.quality);
    this.env.brightness = this.settings.brightness ?? 1;
    this.horizon = new Horizon(this.scene, this.quality);
    await step(0.55);
    this.cityRenderer = new CityRenderer(this.scene, this.city, this.textures, this.quality);
    this.nightLights = new NightLights(this.scene, this.quality, this.cityRenderer.lampHeads ?? []);
    await step(0.8);
    this.effects = new Effects(this.scene);
    this.audio = new AudioSystem();
    this.audio.volume = this.settings.volume;
    this.audio.camera = this.camera;
    this.input = new Input(this.canvas);
    this.input.sensitivity = this.settings.sensitivity;
    this.input.invertY = this.settings.invertY;
    this.camRig = new CameraRig(this.camera, this.city.collision);
    this.camRig.baseFov = this.settings.fov;
    this.applyCameraSettings();
    this.wanted = new WantedSystem();
    this.missions = new MissionSystem(createMissionDefs(this.city));
    const sp = this.city.spawn;
    this.player = new Player(this, sp.x, sp.z);
    this.combat = new Combat(this);
    this.hud = new Hud(this);
    this.hud.showFps(this.settings.showFps);
    this.world = new World(this);
    this.pickups = new Pickups(this);
    this.dialogue = new Dialogue(this); // voces y subtítulos de la calle (crea game.events)
    this._initBirds();
    this.storyDir = new StoryDirector(this); // historia: cinemáticas, abuela y objetivos
    this.radio = new RadioSystem(this); // radio de los vehículos y parlantes de los locales
    this.wheel = new WeaponWheel(this);
    this.postfx = new PostFX(this.renderer, this.scene, this.camera, this.quality);
    await step(0.92);
    // Precalentar: pobla el barrio y compila shaders antes de mostrarlo.
    this.world.populate(sp.x, sp.z);
    for (let i = 0; i < 30; i++) this.world.update(0.05, this.player);
    await this._warmUp(sp);
    await step(1);
    this.state = 'menu';
    this.env.setTime(17.4);
    this._menuShot = -1;
    this.last = performance.now();
    this.menuT = 0;
    // El siguiente cuadro se pide antes de dibujar este: si un cuadro falla
    // (un error raro en un sistema), el juego sigue en vez de congelarse.
    this.frameErrors = 0;
    this._loop = (t) => {
      this.raf = requestAnimationFrame(this._loop);
      try {
        this.frame(t);
      } catch (e) {
        this.frameErrors++;
        if (this.frameErrors <= 3 || this.frameErrors % 300 === 0) console.error(`Error en el cuadro (${this.frameErrors}):`, e);
        // Que el error no deje la entrada a medias (teclas "pegadas").
        try {
          this.input.endFrame();
        } catch {
          /* nada más que hacer */
        }
      }
    };
    this._watchContext();
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
    // Las dos variantes de iluminación (día sin luces de faroles, noche con
    // ellas) quedan compiladas: al anochecer no hay tirones.
    for (const on of [true, false]) {
      this.nightLights.setEnabled(on);
      try {
        await r.compileAsync(this.scene, this.camera);
      } catch {
        r.compile(this.scene, this.camera);
      }
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
      this.horizon.update(0, cam, this.env, 1);
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

  /** Activa/desactiva la resolución dinámica (al desactivarla vuelve a la resolución completa). */
  /** Cámara según la configuración: vista de vehículo por defecto, suavizado y primera persona. */
  applyCameraSettings() {
    const s = this.settings;
    this.camRig.smoothing = s.camSmoothing ?? 0.5;
    this.camRig.setFirstPerson(!!s.firstPerson);
    if (s.vehicleView !== this._appliedVehicleView) {
      this._appliedVehicleView = s.vehicleView;
      this.camRig.setVehicleView(s.vehicleView ?? 'cerca');
    }
  }

  setDynamicResolution(on) {
    this.dynamicRes = on;
    this._dres = null;
    if (!on && this.resScale !== 1) this._setResScale(1);
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
    p.wardrobe = deserializeWardrobe(save?.ropa ?? null);
    applyOutfit(p.rig, p.wardrobe.outfit);
    this.discovered.clear();
    this.missions.completed.clear();
    this.stats = { kills: 0, missions: 0, distance: 0, playTime: 0 };
    this.env.setTime(16.5);
    this.storyDir.story.restore({ chapter: 'cap1', step: -1 });
    if (save) {
      this.storyDir.restore(save.story);
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
    if (this.opts.autotest) {
      this.hud.show(true);
      this.hud.big('ARANJUEZ', 'Comuna 4 · Medellín', 'gold', 3);
      if (!save) this.storyDir.story.start();
    } else if (!save) this.storyDir.playIntro();
    else this._startIntro();
    setTimeout(() => {
      if (this.state === 'playing' && !this.storyDir.cinematic) {
        this.hud.help('Explora el barrio: los <b class="hl">puntos dorados</b> del minimapa son lugares por descubrir y las misiones <b class="hl">!</b> dan plata. <kbd>F</kbd> para subirte a un carro o moto, <kbd>M</kbd> mapa, <kbd>F1</kbd> controles.', 9);
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
      story: this.storyDir.serialize(),
      ropa: serializeWardrobe(p.wardrobe),
    };
    safeStorage(() => localStorage.setItem(SAVE_KEY, JSON.stringify(data)));
  }

  setState(s) {
    this.state = s;
    if (s === 'menu') {
      // El menú se ve a la hora dorada, con la ciudad encendiendo sus luces.
      this.env?.setTime(17.4);
      this.menuT = 0;
      this._menuShot = -1;
      this.intro = null;
      document.body.classList.remove('intro');
    } else if (s !== 'playing') this.setFade(0);
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
    if (this.contextLost) return; // sin GPU no se dibuja (se recarga al recuperarla)
    this.frameCount = (this.frameCount ?? 0) + 1;
    const tCpu0 = performance.now();
    this.renderer.info.reset();
    const realDt = (t - this.last) / 1000;
    let dt = Math.min(0.05, realDt);
    this.last = t;
    this._adaptResolution(realDt);
    if (!(dt > 0)) dt = 1 / 60;
    const a = this.input.poll();
    // Durante la entrada cinematográfica el jugador no se mueve.
    if (this.intro) for (const k of Object.keys(a)) a[k] = typeof a[k] === 'number' ? 0 : false;
    if (this.state === 'playing') {
      const simDt = this.wheel.open ? dt * 0.25 : dt;
      this.updatePlaying(simDt, dt, a);
    } else if (this.state === 'menu') {
      this.updateMenuCamera(dt);
    } else if (this.state === 'map') {
      if (a.map || a.pause) this.closeMap();
      else this.hud.drawFullMap(this._hudState());
    }
    // La música corre en tiempo real (el <audio> no se frena con el juego).
    this.radio.update(Math.min(Math.max(realDt, 0), 2));
    const focus = (this._focus ??= new THREE.Vector3());
    if (this.state === 'playing' || this.state === 'paused') focus.set(this.player.x, this.player.y, this.player.z);
    else focus.copy(this.camRig.pos).setY(0);
    const running = this.state !== 'paused' && this.state !== 'shop';
    this.env.update(running ? dt : 0, focus);
    this.env.followCamera(this.camera.position);
    this.horizon.update(running ? dt : 0, this.camera, this.env, this.renderer.getPixelRatio());
    this.cityRenderer.update(running ? dt : 0, this.env.night);
    this.cityRenderer.updateLod(this.camera.position);
    this.nightLights.update(running ? dt : 0, this.camera.position, this.env.night, this.world.vehicles, this.player.vehicle);
    if (running) this.effects.update(dt);
    this._updateBirds(running ? dt : 0);
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

  /**
   * Menú principal: tomas de cine por lugares reales del mapa, con fundido a
   * negro entre una y otra. `onMenuShot(toma)` avisa a la interfaz del lugar.
   */
  updateMenuCamera(dt) {
    this.menuT += dt;
    const SHOT = 11;
    const k = Math.floor(this.menuT / SHOT) % MENU_SHOTS.length;
    const t = (this.menuT % SHOT) / SHOT;
    const shot = MENU_SHOTS[k];
    const c = this.city.pois.find((p) => p.id === shot.poi) ?? this.city.spawn;
    if (this._menuShot !== k) {
      this._menuShot = k;
      this.onMenuShot?.(shot, c);
    }
    const e = t * t * (3 - 2 * t);
    const g = groundHeight(c.x, c.z);
    const lerp = (i) => shot.from[i] + (shot.to[i] - shot.from[i]) * e;
    this.camera.position.set(c.x + lerp(0), g + lerp(1), c.z + lerp(2));
    this.camera.lookAt(c.x + shot.look[0], g + shot.look[1], c.z + shot.look[2]);
    this.camRig.pos.copy(this.camera.position);
    // Fundido entre tomas.
    const fade = Math.max(0, 1 - (this.menuT % SHOT) / 0.9, 1 - (SHOT - (this.menuT % SHOT)) / 0.9);
    this.setFade(this.menuT < 1.2 ? Math.max(fade, 1 - this.menuT / 1.2) : fade);
    // La ciudad sigue viva en el fondo del menú.
    this.world.update(dt, { x: c.x, y: 0, z: c.z, inVehicle: false, speed: 0, dead: false });
  }

  /** Opacidad del velo negro de transiciones (0 = nada). */
  setFade(v) {
    const el = (this._fadeEl ??= document.getElementById('fade'));
    if (!el) return;
    const o = Math.max(0, Math.min(1, v));
    if (this._fadeV === o) return;
    this._fadeV = o;
    el.style.opacity = o.toFixed(3);
  }

  /** Entrada a la partida: la cámara baja del cielo hasta el jugador. */
  _startIntro() {
    const p = this.player;
    const yaw = p.state.yaw;
    // Detrás y muy arriba del jugador, mirando hacia donde él mira.
    const bx = Math.sin(yaw) * 70;
    const bz = Math.cos(yaw) * 70;
    this.intro = { t: 0, dur: 3.4, from: new THREE.Vector3(p.x + bx, p.y + 85, p.z + bz), look: new THREE.Vector3(p.x, p.y + 2, p.z) };
    this.hud.show(false);
    document.body.classList.add('intro');
    this.setFade(1);
  }

  _updateIntro(dt) {
    const it = this.intro;
    it.t += dt;
    const u = Math.min(1, it.t / it.dur);
    // Suave al arrancar y al llegar (ease in-out cúbico).
    const e = u < 0.5 ? 4 * u * u * u : 1 - (-2 * u + 2) ** 3 / 2;
    const rigPos = this.camera.position.clone();
    const rigQ = this.camera.quaternion.clone();
    const m = new THREE.Matrix4().lookAt(it.from, it.look, THREE.Object3D.DEFAULT_UP);
    const fromQ = new THREE.Quaternion().setFromRotationMatrix(m);
    this.camera.position.lerpVectors(it.from, rigPos, e);
    this.camera.quaternion.slerpQuaternions(fromQ, rigQ, e);
    this.setFade(1 - Math.min(1, it.t / 0.7));
    if (u >= 1) {
      this.intro = null;
      document.body.classList.remove('intro');
      this.setFade(0);
      this.hud.show(true);
      this.hud.big('ARANJUEZ', 'Comuna 4 · Medellín', 'gold', 3.2);
    }
  }

  updatePlaying(dt, realDt, a) {
    const p = this.player;
    // Cinemática de la historia: la cámara y los actores los mueve el director.
    if (this.storyDir.cinematic) {
      this.storyDir.updateCinematic(realDt, a);
      this.world.update(dt, this.storyDir.cinematic?.focus ?? p);
      return;
    }
    this.stats.playTime += realDt;
    if (a.pause) return this.pause();
    if (a.map) return this.openMap();
    if (a.help) {
      this.pause();
      document.querySelector('#pause [data-action="controls"]').click();
      return;
    }
    if (a.camera) {
      this.camRig.cycleZoom();
      if (this.player.inVehicle) this.hud.toast(`Cámara: ${{ cerca: 'cerca', lejos: 'lejos', capo: this.player.vehicle.type === 'moto' ? 'sobre el hombro' : 'capó' }[this.camRig.vehicleViewName]}`, 1.2);
      else this.hud.toast(`Cámara: ${{ normal: 'normal', lejos: 'lejos', cerca: 'cerca', primera: 'primera persona' }[this.camRig.footViewName]}`, 1.2);
    }
    if (a.shoulder && !this.player.inVehicle) {
      this.camRig.swapShoulder();
      this.hud.toast(`Cámara: hombro ${this.camRig.side > 0 ? 'derecho' : 'izquierdo'}`, 1.2);
    }

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
      if (a.reload) p.inventory.reload();
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
      vehicleHeading: v ? this._driveCamHeading(v.state) : 0,
      vehicleSpeed: v?.state.forwardSpeed ?? 0,
      vehicleSize: v ? v.state.spec.length : 0,
      moto: !!v && (v.type === 'moto' || v.state.spec.wheels === 2 || v.state.type === 'moto'),
      aiming: p.aiming,
      sprinting: p.state.sprinting,
      crouching: !v && p.state.crouching,
      lookBehind: a.lookBehind,
      lookX,
      lookY,
    });
    if (this.intro) this._updateIntro(realDt);
    // Cámara libre de depuración (__game.aerial).
    if (this._aerial) {
      const q = this._aerial;
      this.camera.position.set(q[0], q[1], q[2]);
      this.camera.lookAt(q[3], q[4], q[5]);
    }
    this.audio.listener = { x: this.camera.position.x, y: this.camera.position.y, z: this.camera.position.z };
    this.audio.updateWeapon(p.dead ? null : p.inventory);

    // Mundo vivo.
    this.world.update(dt, p);
    this.dialogue.update(dt, realDt);
    const police = this.world.updatePolice(dt, p, this.wanted);
    this.wanted.update(dt, police.seen, { x: p.x, z: p.z });
    this.audio.setSiren(this.wanted.level > 0 ? police.nearest : Infinity);
    this.audio.updateTraffic(this.world.vehicles, dt, p.vehicle);
    this._ambientAudio(dt);
    this.pickups.update(dt, p);
    this._updateMissions(dt);
    this.storyDir.update(realDt);
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

  /** Palomas en las plazas, gallinazos en las térmicas y loros al amanecer y al atardecer. */
  _initBirds() {
    const col = this.city.collision;
    const homes = pigeonHomes(this.city.pois, groundHeight, (x, z) => col.pointBlocked(x, z, groundHeight(x, z) + 0.3));
    this.birds = new BirdSim({ homes, groundHeight });
    this.birdView = new BirdRenderer(this.scene);
    this._nearVehicles = [];
    // Tiros y explosiones espantan a las palomas.
    this.events?.on('shot', (e) => this.birds.alarm(e.x, e.z));
    this.events?.on('explosion', (e) => this.birds.alarm(e.x, e.z, 70));
  }

  _updateBirds(dt) {
    if (!this.birds) return;
    const p = this.player;
    const playing = this.state === 'playing' || this.state === 'paused';
    const focus = playing ? p : this.camera.position;
    if (dt > 0) {
      const near = this._nearVehicles;
      near.length = 0;
      for (const v of this.world.vehicles) {
        const s = v.state;
        if (Math.abs(s.x - focus.x) < 120 && Math.abs(s.z - focus.z) < 120) near.push({ x: s.x, z: s.z, speed: Math.abs(s.forwardSpeed ?? 0) });
      }
      const who = playing ? { x: p.x, y: p.y, z: p.z, speed: p.inVehicle ? Math.abs(p.vehicle.state.forwardSpeed ?? 0) : p.state.speed ?? 0, inVehicle: p.inVehicle, dead: p.dead } : { x: focus.x, y: focus.y, z: focus.z, speed: 0, inVehicle: false, dead: true };
      this.birds.update(dt, { player: who, vehicles: near, hour: this.env.timeOfDay, focus: { x: focus.x, z: focus.z } });
      playBirdEvents(this.audio, this.birds.events);
    }
    this.birdView.update(dt, this.birds.list, this.camera.position);
  }

  /** Sonido ambiente según dónde está el jugador y la hora. */
  _ambientAudio(dt) {
    const p = this.player;
    if (!this._shopSpots) {
      this._shopSpots = this.city.buildings.filter((b) => b.style === 'tienda').map((b) => ({ x: (b.minX + b.maxX) / 2, z: (b.minZ + b.maxZ) / 2 }));
      this._church = this.city.pois.find((q) => q.id === 'iglesia');
      this._park = this.city.pois.find((q) => q.id === 'parque');
    }
    let shopDist = Infinity;
    for (const s of this._shopSpots) shopDist = Math.min(shopDist, Math.hypot(s.x - p.x, s.z - p.z));
    const d = (q) => (q ? Math.hypot(q.x - p.x, q.z - p.z) : Infinity);
    // En carro, con las ventanas arriba, casi no se oye la música de afuera.
    this.audio.updateAmbient(dt, { night: this.env.night, shopDist: p.inVehicle || this.radio.parlantesSonando ? Infinity : shopDist, churchDist: d(this._church), parkDist: d(this._park), hour: this.env.timeOfDay });
  }

  /** En un derrape la cámara mira hacia donde va el carro, no hacia donde apunta. */
  _driveCamHeading(s) {
    const sp = Math.hypot(s.vx, s.vz);
    if (sp < 4 || s.forwardSpeed < 0) return s.heading;
    const velH = Math.atan2(-s.vx, -s.vz);
    let d = velH - s.heading;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    const k = Math.min(0.6, (s.slip ?? 0) / 10);
    return s.heading + d * k;
  }

  /** Marcas de llanta y humo al derrapar, con freno de mano o en frenadas de pánico. */
  _skid(v, a, dt) {
    const s = v.state;
    const speed = Math.abs(s.forwardSpeed);
    const skidding = s.slip > 2.6 || (a.brake > 0.8 && speed > 15) || (a.handbrake && speed > 5);
    this.effects.skid(v, skidding && !s.destroyed, dt);
    if (skidding && Math.random() < dt * 14) {
      const back = s.spec.length * 0.4;
      const k = 0.75 * (1 - this.env.night * 0.65); // de noche el humo no brilla
      this.effects.puff({ x: s.x + Math.sin(s.heading) * back, y: s.y + 0.3, z: s.z + Math.cos(s.heading) * back }, 1.1, [k, k, k * 0.99], 0.35, 0.6, 1.6);
    }
    this.audio.skid?.(skidding ? Math.min(1, 0.4 + s.slip / 8) : 0);
  }

  // ================================================================ a pie
  updateOnFoot(dt, a) {
    const p = this.player;
    // Bajándose de un vehículo: termina de levantarse antes de moverse.
    if (this._stepBoarding(dt, a)) return;
    if (p.rig.root.parent !== this.scene) this.scene.add(p.rig.root);
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
    // Primera persona: el cuerpo mira hacia donde mira la cámara.
    if (this.camRig.firstPerson && !p.dead) p.state.yaw = this.camRig.yaw;
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
    this._playerGestures(a);
    p.rig.animate(dt, {
      speed: p.state.speed,
      onGround: p.state.onGround,
      aiming: (p.aiming || inv.cooldown > 0.05) && w.kind === 'gun',
      crouching: p.state.crouching,
      aimPitch: this.camRig.pitch,
      style: playerStyle(p.health), // herido: cojea
      fidget: true, // quieto un rato: mira alrededor, se rasca, bosteza...
    });

    // Subirse a un vehículo.
    if (a.enterVehicle) {
      const v = this.world.nearestVehicle(p.state.pos.x, p.state.pos.z, 2.5);
      if (v) this.enterVehicle(v);
    }
  }

  /** Gestos del jugador: los de una compra (recibir, beber) y los emotes (G). */
  _playerGestures(a) {
    const p = this.player;
    if (a.emote && !p.aiming) {
      p.emote = nextEmote(p.emote ?? -1);
      p.gestures = [EMOTES[p.emote]];
    }
    const g = p.rig.gestureLayer;
    // Lo comprado se recibe enseguida, aunque haya otro gesto en curso.
    if (p.gestures?.length && (!g || g.fidget || a.emote || p.gestureNow)) {
      p.gestureNow = false;
      const name = p.gestures.shift();
      p.rig.play(name, { speed: name === 'take' ? 1.4 : 1, fadeIn: 0.3, fadeOut: 0.4 });
    }
  }

  /** ¿Subir / bajar con animación? (en las pruebas automáticas es instantáneo, salvo que se pida). */
  _animBoarding() {
    return this.animatedBoarding ?? !this.opts.autotest;
  }

  /**
   * Avanza la animación de subir / bajar en curso. Devuelve true mientras
   * dure. Acelerar, frenar o girar (al subir) o moverse (al bajar) la adelantan.
   */
  _stepBoarding(dt, a) {
    const p = this.player;
    const b = p.boarding;
    if (!b) return false;
    const skip = b.mode === 'enter' ? a.throttle > 0 || a.brake > 0 || Math.abs(a.steer) > 0.2 : Math.hypot(a.moveX, a.moveY) > 0.3 || a.jump || a.aim;
    // Teletransporte o reaparición durante la bajada: se corta.
    const far = b.mode === 'exit' && dist2D(b.vehicle.state.x, b.vehicle.state.z, p.state.pos.x, p.state.pos.z) > 8;
    if (!far && !b.update(dt, skip)) return true;
    this._endBoarding();
    return false;
  }

  /** Termina (o corta) la subida / bajada: el personaje queda sentado o de pie donde va. */
  _endBoarding() {
    const p = this.player;
    const b = p.boarding;
    if (!b) return;
    p.boarding = null;
    b.cancel();
    if (p.vehicle) this._seatPlayer(p.vehicle);
    else {
      this.scene.add(p.rig.root);
      p.rig.root.position.set(p.state.pos.x, p.state.pos.y, p.state.pos.z);
      p.rig.root.rotation.set(0, p.state.yaw, 0);
    }
  }

  /** Personaje sentado en el puesto del conductor (sin animación). */
  _seatPlayer(v) {
    const p = this.player;
    const seat = v.view.seat;
    p.rig.root.position.set(seat.x, seat.y - 0.5 + (v.type === 'moto' ? 0.35 : 0), seat.z);
    p.rig.root.rotation.set(0, 0, 0);
    v.view.group.add(p.rig.root);
    p.rig.setWeapon(null);
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
    // Subiéndose: el vehículo espera frenado hasta que el personaje esté sentado.
    if (this._stepBoarding(dt, a)) {
      // (Freno solo si va hacia delante: quieto, el freno es reversa.)
      stepVehicle(s, { throttle: s.forwardSpeed < -0.3 ? 0.6 : 0, brake: s.forwardSpeed > 0.3 ? 1 : 0, steer: 0, handbrake: true }, dt, { groundHeight, collision: this.city.collision });
      this.audio.drive(s, { throttle: 0, brake: 0 }, dt);
      return;
    }
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
    // Motor: caja de cambios simulada y explosiones grabadas (audio.drive).
    this.audio.drive(s, a, dt);
    this._skid(v, a, dt);
    this.audio.horn(a.horn);
    if (a.horn) this.world.addThreat(s.x, s.z, 12, 0.3);
    if (a.radioNext) this.radio.cambiar(1);
    if (a.radioPrev) this.radio.cambiar(-1);

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

  enterVehicle(v, opts = {}) {
    const p = this.player;
    this._endBoarding();
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
    // Con animación: camina a la puerta, la abre y se sienta (boarding.js);
    // con afán (policía cerca) todo va más rápido.
    if (opts.animate ?? this._animBoarding()) {
      v.view.group.updateMatrixWorld(true);
      const from = v.view.group.worldToLocal(new THREE.Vector3(p.state.pos.x, p.state.pos.y, p.state.pos.z));
      p.boarding = Boarding.create(p.rig, v, 'enter', { from: { x: from.x, z: from.z, yaw: p.state.yaw - v.state.heading }, hurry: this.wanted.level > 0 });
    }
    if (!p.boarding) this._seatPlayer(v);
    // Cámara detrás del vehículo.
    this.camRig.yaw = v.state.heading;
    this.audio.init();
  }

  exitVehicle(force = false) {
    this.audio.skid(0);
    const p = this.player;
    const v = p.vehicle;
    if (!v) return;
    // Bajarse (o salir volando) a mitad de la subida: se corta la animación.
    if (p.boarding) {
      force = true;
      this._endBoarding();
    }
    const s = v.state;
    let pt = exitPoint(s);
    let side = -1;
    // Si el lado del conductor está bloqueado, salir por el otro lado.
    if (this.city.collision.pointBlocked(pt.x, pt.z)) {
      pt = { x: 2 * s.x - pt.x, z: 2 * s.z - pt.z };
      side = 1;
    }
    let r = this.city.collision.resolveCircle(pt.x, pt.z, 0.4);
    if (!force && this.city.collision.pointBlocked(r.x, r.z)) {
      this.hud.toast('No hay espacio para bajarse');
      return;
    }
    let yaw = s.heading;
    // Con animación: se levanta y sale por la puerta; queda de pie junto a
    // ella (el control vuelve al terminar, o antes si el jugador se mueve).
    let b = !force && this._animBoarding() ? Boarding.create(p.rig, v, 'exit', { side }) : null;
    if (b) {
      v.view.group.updateMatrixWorld(true);
      const f = v.view.group.localToWorld(new THREE.Vector3(b.final.x, 0, b.final.z));
      const rf = this.city.collision.resolveCircle(f.x, f.z, 0.4);
      if (this.city.collision.pointBlocked(rf.x, rf.z)) {
        b.cancel();
        b = null;
      } else {
        r = rf;
        yaw = s.heading + b.final.yaw;
      }
    }
    p.boarding = b;
    if (!b) this.scene.add(p.rig.root);
    p.state = createPlayerState(r.x, r.z, groundHeight, yaw);
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
    this._endBoarding();
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
      const shop = poi.type === 'shop' || poi.type === 'food' || poi.type === 'ropa' || poi.id === 'hospital' || poi.id === 'taller';
      // Solo los cercanos: cada marcador son tres mallas más por cuadro.
      const near = Math.abs(poi.x - p.x) < 260 && Math.abs(poi.z - p.z) < 260;
      if ((giver || shop) && near) {
        const color = giver ? 0xffd200 : poi.id === 'armeria' ? 0xe63946 : poi.type === 'food' ? 0xf4a261 : poi.type === 'ropa' ? 0xc2185b : 0x3a86ff;
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
          this.storyDir.onMissionStart(e.mission.id);
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
          const poi = this.city.pois.find((x) => x.id === e.at) ?? this.city.pois.find((x) => x.id === 'taller');
          const lp = this.world.lanePointNear(poi.x - 8, poi.z);
          // La del pique es la moto de siempre; la de los domicilios lleva caja.
          const variant = e.vehicle === 'moto' ? (e.at === 'taller' ? 'moto' : 'domicilio') : defaultVariant(e.vehicle);
          const v = new VehicleEntity(this.world, e.vehicle, lp.x, lp.z, lp.yaw, { kind: 'parked', color: 0xd62828, variant });
          this.world.vehicles.push(v);
          this.player.lastVehicle = v;
          this.hud.help(e.at === 'taller' ? 'Súbete a la moto roja (<kbd>F</kbd>) y pasa por todos los checkpoints antes de que se acabe el tiempo.' : 'Ahí está la moto roja del negocio (<kbd>F</kbd>): haz las entregas antes de que se enfríe el pedido.', 7);
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
    const sp = this.storyDir.prompt(poi);
    if (sp) return sp;
    const m = this.missions.available(poi.id);
    if (poi.id === 'armeria') return 'Presiona <kbd>E</kbd> para comprar armas, munición y chaleco.';
    if (poi.type === 'ropa') return `Presiona <kbd>E</kbd> para ver la ropa de <b>${poi.name}</b>.`;
    if (poi.type === 'food') return `Presiona <kbd>E</kbd> para pedir en <b>${poi.name}</b>${m && !this.missions.completed.has(m.id) ? ' (tienen un encargo para vos)' : ''}.`;
    if (poi.id === 'hospital') return 'Presiona <kbd>E</kbd> para curarte ($200).';
    if (poi.id === 'taller') return this.player.inVehicle ? 'Presiona <kbd>E</kbd> para reparar el vehículo ($300).' : m ? `Presiona <kbd>E</kbd> para iniciar: <b>${m.title}</b> ($${m.reward}).` : null;
    if (m) return `Presiona <kbd>E</kbd> para iniciar la misión: <b>${m.title}</b> (recompensa $${m.reward.toLocaleString('es-CO')}).`;
    return null;
  }

  interact(poi) {
    const p = this.player;
    if (this.storyDir.onInteract(poi)) return;
    if (poi.id === 'armeria' || poi.type === 'food' || poi.type === 'ropa') return this.openShop(poi);
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
    // En carro respeta el sentido de las vías; a pie no.
    const route = g.route(a.id, b.id, !!p.vehicle);
    this.hud.routeColor = this.target ? '#e8b64c' : '#b98ae8';
    if (!route) {
      this.hud.route = null;
      return;
    }
    // La ruta sigue la forma real de cada vía (curvas incluidas).
    const pts = [{ x: p.x, z: p.z }, g.node(route[0])];
    for (let i = 1; i < route.length; i++) {
      const l = g.link(route[i - 1], route[i]);
      if (!l) {
        pts.push(g.node(route[i]));
        continue;
      }
      const e = g.edges[l.edge].pts;
      const seq = l.dir === 1 ? e : [...e].reverse();
      for (let k = 1; k < seq.length; k++) pts.push({ x: seq[k][0], z: seq[k][1] });
    }
    pts.push({ x: dest.x, z: dest.z });
    this.hud.route = pts;
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
      reloadFrac: inv.reloading > 0 ? 1 - inv.reloading / (inv.current.reload ?? 1) : 0,
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

  openShop(poi = this.city.pois.find((q) => q.id === 'armeria')) {
    this.shopPoi = poi;
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
    if (item.kind === 'ropa' || item.kind === 'quitar') return this._dress(item);
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
    } else if (item.kind === 'food') {
      if (p.health >= 100) {
        this.hud.toast('Estás lleno, parce. Después comés.');
        return false;
      }
      p.health = Math.min(100, p.health + item.heal);
      this.hud.toast(`${item.name}: +${item.heal} de salud`);
    } else if (item.kind === 'mission') {
      this._handleMissionEvents(this.missions.start(item.id));
      return 'close';
    }
    // Al volver al juego: recibe lo comprado (y se lo come / toma).
    if (!p.inVehicle) {
      p.gestures = purchaseGestures(item.kind);
      p.gestureNow = p.gestures.length > 0;
    }
    p.money -= item.price;
    this.audio.ui('money');
    this.save();
    return true;
  }

  /** Comprar / ponerse / quitarse ropa en un almacén (sin gesto: se ve de una). */
  _dress(item) {
    const p = this.player;
    if (item.kind === 'quitar') {
      p.wardrobe = { ...p.wardrobe, outfit: takeOff(p.wardrobe.outfit, item.slot) };
    } else {
      const r = buyOrWear(p.wardrobe, item.ropa, p.money);
      if (!r.ok) {
        this.hud.toast('No te alcanza la plata, parce.');
        this.audio.ui('fail');
        return false;
      }
      p.wardrobe = r.wardrobe;
      if (r.cost > 0) {
        p.money -= r.cost;
        this.audio.ui('money');
        this.hud.toast(`Estrenando: ${item.ropa.name}`);
      } else this.audio.ui('ok');
    }
    applyOutfit(p.rig, p.wardrobe.outfit);
    this.save();
    return true;
  }

  shopItems() {
    const poi = this.shopPoi;
    if (poi?.type === 'ropa') {
      const w = this.player.wardrobe;
      const worn = new Set(Object.values(w.outfit));
      const items = storeCatalog(poi.store).map((r) => {
        const owned = w.owned.has(r.id);
        return { kind: 'ropa', id: r.id, ropa: r, name: r.name, icon: 'ropa', price: owned ? 0 : r.price, desc: r.desc, label: worn.has(r.id) ? 'Puesto' : owned ? 'Ponerse' : undefined, disabled: worn.has(r.id) };
      });
      // Quitarse lo que sobra (gorra, gafas, cadena, canguro).
      for (const [slot, what] of [['cabeza', 'la gorra'], ['ojos', 'las gafas'], ['cuello', 'la cadena'], ['cintura', 'el canguro']]) {
        const id = w.outfit[slot];
        if (id) items.push({ kind: 'quitar', id: `quitar-${slot}`, slot, ropa: ROPA_BY_ID[id], name: `Quitarse ${what}`, icon: 'ropa', price: 0, desc: ROPA_BY_ID[id]?.name ?? '', label: 'Quitar' });
      }
      return items;
    }
    if (poi?.menu) {
      const items = poi.menu.map((f) => ({ kind: 'food', id: f.id, name: f.name, icon: 'food', price: f.price, heal: f.heal, desc: `${f.desc} · +${f.heal} de salud` }));
      const m = this.missions.available(poi.id);
      if (m && !this.missions.completed.has(m.id)) items.push({ kind: 'mission', id: m.id, name: `Encargo: ${m.title}`, icon: 'mission', price: 0, desc: `Recompensa $${m.reward.toLocaleString('es-CO')}`, label: 'Aceptar' });
      return items;
    }
    const inv = this.player.inventory;
    const items = [];
    for (const w of WEAPONS) {
      if (w.kind === 'melee' && w.price === 0) continue;
      if (!inv.has(w.id)) items.push({ kind: 'weapon', id: w.id, name: w.name, icon: w.id, price: w.price, desc: w.kind === 'gun' ? `Daño ${w.damage}${w.pellets > 1 ? `×${w.pellets}` : ''} · Cargador ${w.mag} · ${w.auto ? 'Automática' : 'Semiautomática'}` : `Cuerpo a cuerpo · Daño ${w.damage}` });
      else if (w.kind === 'gun') items.push({ kind: 'ammo', id: w.id, name: `Munición: ${w.name}`, icon: 'ammo', price: w.ammoPrice, desc: `+${w.mag * 2} balas (tienes ${inv.owned.get(w.id).reserve}/${w.maxReserve})` });
    }
    items.push({ kind: 'armor', id: 'armor', name: 'Chaleco antibalas', icon: 'armor', price: 400, desc: 'Absorbe 2/3 del daño recibido' });
    items.push({ kind: 'health', id: 'health', name: 'Botiquín', icon: 'health', price: 150, desc: 'Salud al 100 %' });
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
      /** Historia: paso actual, y la cinemática de entrada a pedido (pruebas/capturas). */
      story() {
        const d = g.storyDir;
        return { step: d.story.current?.id ?? null, done: d.story.done, cinematic: !!d.cinematic, shot: d.cinematic?.i ?? -1 };
      },
      playIntro() {
        g.storyDir.playIntro();
      },
      /** Estado de la iluminación nocturna y de las marcas de llanta (pruebas). */
      lights() {
        const n = g.nightLights;
        return {
          on: n.on,
          lamps: n.lights.filter((l) => l.visible && l.intensity > 0).length,
          spot: n.spot ? n.spot.intensity : 0,
          pools: n.pools.count,
          night: g.env.night,
          skids: g.effects.skids?.count ?? 0,
        };
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
          vehicleVariant: p.vehicle?.state.variant ?? null,
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
      /** Depuración: qué objeto hay bajo un punto de la pantalla (coordenadas -1..1). */
      pick(nx, ny) {
        const rc = new THREE.Raycaster();
        rc.setFromCamera(new THREE.Vector2(nx, ny), g.camera);
        const hits = rc.intersectObjects(g.scene.children, true).filter((h) => h.object.visible && h.object.name !== 'horizonte');
        return hits.slice(0, 4).map((h) => ({ name: h.object.name || h.object.parent?.name || h.object.type, dist: +h.distance.toFixed(1), point: h.point.toArray().map((v) => +v.toFixed(1)) }));
      },
      /**
       * Punto sobre el carril de una calle recta y larga del barrio (para
       * pruebas): {x, z, yaw}. `k` elige otra calle.
       */
      streetSpot(k = 0) {
        const c = g.city;
        const ref = c.pois.find((p) => p.id === 'cayetano') ?? c.spawn;
        const gr = g.world.graph;
        const list = gr.activeEdges
          .filter((e) => !e.oneway && e.pts.length === 2 && e.length > 60 && gr.core.has(e.a) && gr.core.has(e.b))
          .sort((p, q) => Math.hypot(p.pts[0][0] - ref.x, p.pts[0][1] - ref.z) - Math.hypot(q.pts[0][0] - ref.x, q.pts[0][1] - ref.z));
        const e = list[k % list.length];
        const p = g.world.lanePointNear((e.pts[0][0] + e.pts[1][0]) / 2, (e.pts[0][1] + e.pts[1][1]) / 2);
        return { x: p.x, z: p.z, yaw: p.yaw };
      },
      /**
       * Exporta el mundo para Unreal (src/tools/exportUnreal.js, se carga solo
       * aquí). Devuelve [{nombre, bytes}]; los archivos se leen por trozos con
       * leerExportado (scripts/exportar-unreal.mjs).
       */
      async exportarUnreal() {
        const { exportarUnreal } = await import('../tools/exportUnreal.js');
        const log = [];
        g._exportado = await exportarUnreal(g, { log: (m) => log.push(m) });
        return { log, archivos: [...g._exportado].map(([nombre, b]) => ({ nombre, bytes: b.length })) };
      },
      /** Trozo de un archivo exportado en base64. */
      leerExportado(nombre, desde, cuanto) {
        const b = g._exportado?.get(nombre);
        if (!b) return null;
        const sub = b.subarray(desde, Math.min(b.length, desde + cuanto));
        let s = '';
        for (let i = 0; i < sub.length; i += 0x8000) s += String.fromCharCode.apply(null, sub.subarray(i, i + 0x8000));
        return btoa(s);
      },
      /** Cámara fija de depuración: aerial(x, y, z, tx, ty, tz); sin argumentos la suelta. */
      aerial(...q) {
        g._aerial = q.length === 6 ? q : null;
      },
      look(yaw, pitch = -0.12) {
        g.camRig.yaw = yaw;
        g.camRig.pitch = pitch;
      },
      giveAll() {
        for (const w of WEAPONS) g.player.inventory.give(w.id);
      },
      spawnVehicle(type = 'taxi', variant = undefined) {
        const lp = g.world.lanePointNear(g.player.x, g.player.z);
        // Sin variante: la del modelo original del tipo (pruebas reproducibles).
        const v = new VehicleEntity(g.world, type, lp.x, lp.z, lp.yaw, { kind: 'parked', variant: variant ?? defaultVariant(type) });
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
      /** Subir / bajar con animación también en las pruebas automáticas (o volver a lo instantáneo). */
      setAnimatedBoarding(on) {
        g.animatedBoarding = on;
      },
      /** Animación de subir / bajar en curso: {mode, t, total} o null. */
      boarding() {
        const b = g.player.boarding;
        return b ? { mode: b.mode, t: b.t, total: b.plan.total } : null;
      },
      /** Pájaros: bandadas de palomas (estado y dónde), gallinazos, loros y cuántos se dibujan. */
      birds() {
        const b = g.birds;
        return {
          homes: b.flocks.map((f) => ({ id: f.home.id, x: f.home.x, z: f.home.z, active: f.active, state: f.state, n: f.birds?.length ?? 0, flying: f.birds?.filter((q) => q.state !== 'ground').length ?? 0 })),
          vultures: b.vultures.length,
          parrots: b.parrots.reduce((s, f) => s + f.birds.length, 0),
          drawn: g.birdView.mesh.count,
        };
      },
      /** Simula pájaros sin esperar al render (pruebas): segundos de juego. */
      advanceBirds(seconds, step = 1 / 30) {
        for (let t = 0; t < seconds; t += step) g._updateBirds(step);
        return this.birds();
      },
      /** Actividades del barrio: lugares por tipo y las que están en escena. */
      activities() {
        return g.world.activities.summary();
      },
      /** Lugar más cercano al jugador de una actividad ('ropa', 'futbol'...), o null. */
      activitySpot(kind, street = null) {
        const s = g.world.activities.nearest(kind, g.player.x, g.player.z, (q) => street == null || !!q.street === street);
        return s ? { ...JSON.parse(JSON.stringify(s)), gy: groundHeight(s.x, s.z) } : null;
      },
      /** Gesto que está haciendo el jugador (o null). */
      playerGesture() {
        return g.player.rig.gesture ?? null;
      },
      startMission(id) {
        g._handleMissionEvents(g.missions.start(id));
      },
      setTime(h) {
        g.env.setTime(h);
      },
      /** Locales con vitrina: nombre, tipo de interior y punto del frente (capturas). */
      storefronts() {
        return g.cityRenderer.facades.shops.map((s) => ({ ...s }));
      },
      /** Ropa del jugador: {outfit, owned}. */
      outfit() {
        const w = g.player.wardrobe;
        return { outfit: { ...w.outfit }, owned: [...w.owned] };
      },
      /** Viste al jugador (pruebas y capturas): {cabeza: 'gorra-plana-negra', ...}; null = la de siempre. */
      setOutfit(o) {
        const w = deserializeWardrobe({ outfit: o ?? undefined, owned: [...g.player.wardrobe.owned] });
        g.player.wardrobe = w;
        return applyOutfit(g.player.rig, w.outfit);
      },
      /** Voltea al jugador (capturas de la ropa). */
      facePlayer(yaw) {
        g.player.state.yaw = yaw;
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
      vehicleVariants: () => Object.keys(VEHICLE_VARIANTS),
      engineStatus: () => g.audio.engineStatus?.() ?? null,
      /** Radio: emisora, pista, ducking, parlantes que suenan; y cambiar de emisora (+1 / -1). */
      radio: () => g.radio.status(),
      radioStep: (paso = 1) => {
        g.radio.cambiar(paso);
        return g.radio.status();
      },
      /** Vehículos por clase (traffic/parked/police) y variante. */
      vehicleCensus() {
        const out = {};
        for (const v of g.world.vehicles) {
          const k = `${v.kind}:${v.state.variant ?? v.type}`;
          out[k] = (out[k] ?? 0) + 1;
        }
        return out;
      },
      screenshotHudHidden(on) {
        g.hud.show(!on);
      },
    };
  }
}
