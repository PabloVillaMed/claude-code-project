// La historia dentro del juego: la cinemática de entrada (con los mismos
// actores del juego: el jugador, la abuela sentada frente a su tienda, el
// barrio vivo alrededor), las voces y subtítulos de la historia, el objetivo
// en pantalla cuando no hay una misión activa y la escena final del capítulo.

import * as THREE from 'three';
import { groundHeight } from '../sim/terrain.js';
import { dist2D } from '../sim/math.js';
import { makeRng } from '../sim/rng.js';
import { CharacterRig, randomLook } from '../render/characterRig.js';
import { StorySystem } from './story.js';
import { CHAPTER_1, STORY_CAST, STORY_LINE, storyVoiceFile } from './storyLines.js';

const WALK = 1.35; // m/s, paso tranquilo en las tomas
const ease = (u) => (u < 0.5 ? 4 * u * u * u : 1 - (-2 * u + 2) ** 3 / 2);
const yawTo = (dx, dz) => Math.atan2(-dx, -dz);

export class StoryDirector {
  constructor(game) {
    this.game = game;
    this.story = new StorySystem(CHAPTER_1);
    this.cinematic = null;
    this.buffers = new Map();
    this.speaking = null;
    this.el = document.getElementById('cine');
    this.subEl = document.getElementById('cine-sub');
    this.titleEl = document.getElementById('cine-title');
    this._setupPlaces();
  }

  // ------------------------------------------------------------ lugares y actores
  _setupPlaces() {
    const g = this.game;
    const city = g.city;
    this.poi = city.pois.find((p) => p.id === 'abuela') ?? city.pois.find((p) => p.id === 'parque');
    const b = city.buildings.find((q) => q.local?.name === 'Tienda Doña Rosa');
    const f = b?.frame;
    // Marco de la fachada: n hacia la calle, u a lo largo del andén.
    this.front = f
      ? { x: f.x + f.nx * f.hv, z: f.z + f.nz * f.hv, nx: f.nx, nz: f.nz, ux: f.ux, uz: f.uz, len: f.hu * 2 }
      : { x: this.poi.x, z: this.poi.z, nx: 0, nz: 1, ux: 1, uz: 0, len: 6 };
    // La silla de la abuela: la más cercana a la puerta de su tienda.
    let chair = null;
    for (const p of city.props) {
      if (p.type !== 'chair') continue;
      if (p.owner === 'abuela') {
        chair = { x: p.x, z: p.z, d: 0, rot: p.rot };
        break;
      }
      const d = dist2D(p.x, p.z, this.front.x, this.front.z);
      if (d < 7 && (!chair || d < chair.d)) chair = { x: p.x, z: p.z, d, rot: p.rot };
    }
    const F = this.front;
    this.seat = chair
      ? { x: chair.x, z: chair.z, sit: true }
      : { x: F.x + F.nx * 0.7 + F.ux * 1.4, z: F.z + F.nz * 0.7 + F.uz * 1.4, sit: false };
    // Mirando a la calle; en la silla, alineada con ella (la silla mira a su +Z).
    this.seat.yaw = chair?.rot != null ? chair.rot + Math.PI : yawTo(F.nx, F.nz);
    // Nadie más se sienta en su silla.
    if (g.world?.fixedSpots) g.world.fixedSpots = g.world.fixedSpots.filter((s) => dist2D(s.x, s.z, this.seat.x, this.seat.z) > 1.2);
    const look = { ...randomLook(makeRng(1947), 'civil'), avatar: 'civil-f2', female: true, height: 0.95 };
    this.abuela = new CharacterRig(look);
    g.scene.add(this.abuela.root);
  }

  _placeAbuela(dt) {
    const g = this.game;
    const s = this.seat;
    const cam = g.camera.position;
    const d = dist2D(s.x, s.z, cam.x, cam.z);
    const rig = this.abuela;
    rig.root.visible = d < (g.quality.pedDraw ?? 90) * 1.2;
    if (!rig.root.visible) return;
    rig.root.position.set(s.x, groundHeight(s.x, s.z), s.z);
    rig.root.rotation.y = s.yaw;
    rig.setShadow?.(d < (g.quality.shadowChars ?? 30));
    rig.animate(dt, { speed: 0, onGround: true, driving: s.sit ? 'chair' : null, aimPitch: 0 });
  }

  // ------------------------------------------------------------ voces
  _buffer(id) {
    let pr = this.buffers.get(id);
    if (!pr) {
      const ctx = this.game.audio?.ctx;
      pr = !ctx
        ? Promise.resolve(null)
        : fetch(storyVoiceFile(id))
            .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
            .then((ab) => ctx.decodeAudioData(ab))
            .catch(() => null);
      this.buffers.set(id, pr);
    }
    return pr;
  }

  /** Precarga las voces de una lista de líneas. */
  preload(ids) {
    this.game.audio?.init?.();
    for (const id of ids) this._buffer(id);
  }

  /**
   * Dice una línea (voz + subtítulo). Devuelve {done} que pasa a true al
   * terminar; sin audio, el subtítulo dura según el largo del texto.
   */
  say(id) {
    const line = STORY_LINE[id];
    const who = STORY_CAST[line.who];
    this.stopSpeaking();
    const u = { id, done: false, t: 0, dur: 1.2 + line.text.length * 0.062, node: null };
    this.speaking = u;
    this._showSub(who.name, line.text);
    this._buffer(id).then((buf) => {
      const a = this.game.audio;
      if (u.done || !buf || !a?.ctx || !a.master) return;
      const src = a.ctx.createBufferSource();
      src.buffer = buf;
      const gain = a.ctx.createGain();
      gain.gain.value = 1.1;
      src.connect(gain).connect(a.master);
      src.start();
      u.node = src;
      u.dur = u.t + buf.duration + 0.15;
    });
    return u;
  }

  stopSpeaking() {
    const u = this.speaking;
    if (!u) return;
    u.done = true;
    try {
      u.node?.stop();
    } catch {
      /* ya terminó */
    }
    this.speaking = null;
    this._hideSub();
  }

  _tickSpeech(dt) {
    const u = this.speaking;
    if (!u) return;
    u.t += dt;
    if (u.t >= u.dur) {
      u.done = true;
      this.speaking = null;
      this._hideSub();
    }
  }

  _showSub(name, text) {
    if (!this.subEl || this.game.settings?.subtitles === false) return;
    this.subEl.innerHTML = '';
    const div = document.createElement('div');
    div.className = 'line';
    const who = document.createElement('span');
    who.className = 'who';
    who.textContent = name;
    div.append(who, document.createTextNode(text));
    this.subEl.append(div);
    this.el?.classList.add('talking');
  }

  _hideSub() {
    if (this.subEl) this.subEl.innerHTML = '';
    this.el?.classList.remove('talking');
  }

  _title(html, show) {
    if (!this.titleEl) return;
    if (html !== null) this.titleEl.innerHTML = html;
    this.titleEl.classList.toggle('show', show);
  }

  // ------------------------------------------------------------ bucle de juego
  /** Cada cuadro de juego (fuera de la cinemática). */
  update(dt) {
    const g = this.game;
    this._tickSpeech(dt);
    this._placeAbuela(dt);
    if (this.cinematic || g.state !== 'playing') return;
    if (this.story.step < 0) return;
    for (const e of this.story.update({ completed: g.missions.completed, money: g.player.money })) this._event(e);
    // Objetivo y marcador de la historia solo si no hay una misión en curso.
    const active = !!g.missions.active;
    if (active !== this._missionActive) {
      this._missionActive = active;
      this.story._shown = null; // al terminar la misión se vuelve a mostrar el objetivo
    }
  }

  _event(e) {
    const g = this.game;
    switch (e.type) {
      case 'objective': {
        if (g.missions.active) break;
        g.hud.objective(`<span class="story-tag">Historia</span> ${e.text}`);
        const p = e.poi ? g.city.pois.find((q) => q.id === e.poi) : null;
        if (p) {
          g.target = { x: p.x, z: p.z };
          g.effects.setMarker('mission', new THREE.Vector3(p.x, groundHeight(p.x, p.z), p.z), 0xffd200, 6);
          g.timers.gps = 99;
        } else {
          g.target = null;
          g.effects.removeMarker('mission');
          if (e.hint) g.hud.help(e.hint, 6);
        }
        break;
      }
      case 'line':
        this.say(e.id);
        break;
      case 'pay':
        g.player.money -= e.amount;
        g.hud.moneyShown = g.player.money;
        g.audio.ui('money');
        break;
      case 'chapterEnd':
        g.hud.objective('');
        g.target = null;
        g.effects.removeMarker('mission');
        this.playFinale();
        break;
      default:
        break;
    }
  }

  /** E en un lugar: ¿es de la historia? (true = ya se atendió). */
  onInteract(poi) {
    const evs = this.story.talk(poi.id, this.game.player.money);
    if (!evs.length) return false;
    for (const e of evs) this._event(e);
    return true;
  }

  /** Aviso de la historia en el mensaje de E (o null). */
  prompt(poi) {
    const st = this.story.current;
    if (st?.kind === 'talk' && st.poi === poi.id) return `Presiona <kbd>E</kbd> para darle la plata del arriendo a tu abuela ($${CHAPTER_1.rent.toLocaleString('es-CO')}).`;
    return null;
  }

  onMissionStart(id) {
    const st = this.story.current;
    if (st?.kind === 'mission' && st.mission === id) this.say('oscar-01');
  }

  serialize() {
    return this.story.serialize();
  }

  restore(data) {
    this.story.restore(data);
    if (this.story.step < 0) this.story.start();
  }

  // ------------------------------------------------------------ cinemáticas
  /** Cinemática de entrada del capítulo 1 (al empezar una partida nueva). */
  playIntro() {
    const g = this.game;
    const city = g.city;
    const F = this.front;
    const P = { x: this.poi.x, z: this.poi.z };
    const metro = city.pois.find((p) => p.id === 'metro');
    const mirador = city.pois.find((p) => p.id === 'mirador') ?? P;
    const st = city.metro?.station;
    // Del paradero hacia Moravia (alejándose de la estación).
    let mdx = metro.x - (st?.x ?? metro.x - 1);
    let mdz = metro.z - (st?.z ?? metro.z);
    const ml = Math.hypot(mdx, mdz) || 1;
    mdx /= ml;
    mdz /= ml;
    // Por el andén de la tienda: llega caminando de un lado.
    const side = -1;
    const walkA = { x: P.x + F.ux * side * 24, z: P.z + F.uz * side * 24 };
    const walkB = { x: P.x + F.ux * side * 2.2, z: P.z + F.uz * side * 2.2 };
    const stand = { x: this.seat.x + F.nx * 1.6 + F.ux * side * 1.3, z: this.seat.z + F.nz * 1.6 + F.uz * side * 1.3 };
    const faceAbuela = yawTo(this.seat.x - stand.x, this.seat.z - stand.z);
    // Llegada por la estación Caribe: el final del puente y la escalera que
    // baja a Moravia (marco local de la estación: a = a lo largo, c = a lo ancho).
    const S = city.metro?.geo;
    const east = S?.bridges?.find((b) => b.sgn > 0);
    let metroShot;
    if (east?.stair) {
      const stq = east.stair;
      const cm = (stq.c0 + stq.c1) / 2;
      const Wp = (a, cc) => {
        const [x, z] = S.frame.W(a, cc);
        return { x, z };
      };
      const path = [Wp(0, cm - 5), Wp(0, cm), Wp(stq.a0 + 0.3, cm), Wp(stq.a1 + 0.4, cm), Wp(stq.a1 + 4.5, cm)];
      const eye = Wp(stq.a1 + 7.5, cm - 5.5);
      const L = path.reduce((acc, q, i) => acc + (i ? dist2D(q.x, q.z, path[i - 1].x, path[i - 1].z) : 0), 0);
      metroShot = {
        minDur: L / 1.5 + 0.8,
        hour: 17.4,
        lines: ['intro-01'],
        actor: { path, speed: 1.5, yHint: S.yC },
        cam: (u, a) => ({ pos: [eye.x, groundHeight(eye.x, eye.z) + 1.7, eye.z], look: [a.x, a.y + 1.3, a.z] }),
        focus: path[path.length - 1],
      };
    } else {
      metroShot = {
        minDur: 7,
        hour: 17.4,
        lines: ['intro-01'],
        actor: { from: { x: metro.x - mdx * 2, z: metro.z - mdz * 2 }, to: { x: metro.x + mdx * 9, z: metro.z + mdz * 9 } },
        cam: (u, a) => ({ pos: [metro.x + mdx * 12 - mdz * 5, groundHeight(metro.x, metro.z) + 2.2, metro.z + mdz * 12 + mdx * 5], look: [a.x, a.y + 1.3, a.z] }),
        focus: metro,
      };
    }
    const shots = [
      {
        // El valle desde el oriente, a la hora dorada.
        dur: 6.5,
        hour: 17.2,
        title: '<small>Medellín · Comuna 4</small>ARANJUEZ<em>Seis años después</em>',
        cam: (u) => {
          const gy = groundHeight(mirador.x, mirador.z);
          return { pos: [mirador.x + 30 - u * 40, gy + 60 + u * 10, mirador.z + 60 - u * 30], look: [mirador.x - 700, gy - 120, mirador.z + 120 + u * 60] };
        },
        focus: mirador,
      },
      // Llega en el metro: baja del puente de la estación Caribe.
      metroShot,
      {
        // Por la cuadra de la abuela, cámara que lo sigue de lado.
        minDur: 7.5,
        hour: 17.6,
        lines: ['intro-02'],
        actor: { from: walkA, to: walkB },
        cam: (u, a) => {
          const k = 5.5;
          return { pos: [a.x + F.nx * k + F.ux * side * -3.5, a.y + 1.9, a.z + F.nz * k + F.uz * side * -3.5], look: [a.x - F.ux * side * 1.5, a.y + 1.35, a.z - F.uz * side * 1.5] };
        },
        focus: P,
      },
      {
        // La abuela: conversación frente a la tienda (plano y contraplano).
        minDur: 4,
        hour: 17.7,
        lines: ['intro-03', 'intro-04', 'intro-05', 'intro-06', 'intro-07'],
        actor: { from: walkB, to: stand, face: faceAbuela, walkDur: 2 },
        cam: (u, a, spk) => {
          const s = this.seat;
          const gy = groundHeight(s.x, s.z);
          const mid = [(a.x + s.x) / 2, gy + 1.15, (a.z + s.z) / 2];
          if (spk === 'rosa') return { pos: [a.x + F.nx * 1.2 - F.ux * side * 1.1, gy + 1.75, a.z + F.nz * 1.2 - F.uz * side * 1.1], look: [s.x, gy + 1.05, s.z] };
          if (spk === 'santi') return { pos: [s.x + F.nx * 0.9 + F.ux * side * 1.4, gy + 1.35, s.z + F.nz * 0.9 + F.uz * side * 1.4], look: [a.x, a.y + 1.55, a.z] };
          return { pos: [mid[0] + F.nx * 5.5, gy + 2.1, mid[2] + F.nz * 5.5], look: mid };
        },
        focus: P,
      },
    ];
    this.preload(shots.flatMap((s) => s.lines ?? []));
    this._run(shots, { title: `<small>${CHAPTER_1.title.split(':')[0]}</small>${CHAPTER_1.title.split(':')[1].trim().toUpperCase()}`, end: { x: stand.x, z: stand.z, yaw: faceAbuela }, onEnd: () => this.story.start() });
  }

  /** Escena final del capítulo: le entrega la plata a la abuela. */
  playFinale() {
    const F = this.front;
    const s = this.seat;
    const p = this.game.player;
    const at = { x: p.state.pos.x, z: p.state.pos.z };
    const stand = { x: s.x + F.nx * 1.6 - F.ux * 1.3, z: s.z + F.nz * 1.6 - F.uz * 1.3 };
    const face = yawTo(s.x - stand.x, s.z - stand.z);
    const shots = [
      {
        minDur: 3,
        lines: ['final-01', 'final-02'],
        actor: { from: at, to: stand, face, walkDur: 1.2 },
        cam: (u, a) => {
          const gy = groundHeight(s.x, s.z);
          const mid = [(a.x + s.x) / 2, gy + 1.2, (a.z + s.z) / 2];
          return { pos: [mid[0] + F.nx * (6 - u * 1.5) + F.ux * 2, gy + 2.2, mid[2] + F.nz * (6 - u * 1.5) + F.uz * 2], look: mid };
        },
        focus: s,
      },
    ];
    this.preload(['final-01', 'final-02']);
    this._run(shots, { title: '<small>Fin del capítulo 1</small>EL REGRESO<em>Aranjuez sigue siendo tu casa</em>', end: { x: stand.x, z: stand.z, yaw: face } });
  }

  _run(shots, opts) {
    const g = this.game;
    if (g.player.vehicle) g.exitVehicle(true);
    this.cinematic = { shots, opts, i: -1, t: 0, lineIdx: 0, speech: null, skip: false, ending: null, focus: { x: 0, y: 0, z: 0, inVehicle: false, speed: 0, dead: false } };
    g.hud.show(false);
    // Sin marcadores de misiones ni tiendas en cámara (vuelven al terminar).
    for (const m of g.effects.markers.values()) m.group.visible = false;
    document.body.classList.add('intro', 'cinematic');
    this.el?.classList.add('on');
    g.setFade(1);
    this._nextShot();
  }

  _nextShot() {
    const c = this.cinematic;
    const g = this.game;
    c.i++;
    c.t = 0;
    c.lineIdx = 0;
    c.speech = null;
    const shot = c.shots[c.i];
    if (!shot) return this._end();
    if (shot.hour !== undefined && !this._keepTime) g.env.setTime(shot.hour);
    this._title(shot.title ?? null, !!shot.title);
    if (shot.focus) {
      c.focus.x = shot.focus.x;
      c.focus.z = shot.focus.z;
      g.world.populate(shot.focus.x, shot.focus.z);
    }
    g.player.rig.root.visible = !!shot.actor;
  }

  /** Cada cuadro durante una cinemática (en lugar del control del jugador). */
  updateCinematic(dt, a) {
    const c = this.cinematic;
    const g = this.game;
    this._tickSpeech(dt);
    this._placeAbuela(dt);
    if (c.ending) return this._updateEnding(dt);
    if (a.pause || a.jump || a.interact) return this._skip();
    const shot = c.shots[c.i];
    c.t += dt;
    // Actor: el jugador camina de `from` a `to` (o se queda quieto).
    const rig = g.player.rig;
    const act = shot.actor;
    let ax = c.focus.x;
    let az = c.focus.z;
    let speed = 0;
    let yaw = rig.root.rotation.y;
    if (act) {
      const path = act.path ?? [act.from, act.to];
      const seg = [];
      let L = 0;
      for (let i = 1; i < path.length; i++) {
        const l = dist2D(path[i].x, path[i].z, path[i - 1].x, path[i - 1].z);
        seg.push(l);
        L += l;
      }
      const wd = act.walkDur ?? Math.max(0.1, L / (act.speed ?? WALK));
      let s = Math.min(1, c.t / wd) * L;
      let i = 0;
      while (i < seg.length - 1 && s > seg[i]) s -= seg[i++];
      const k = seg[i] > 0 ? Math.min(1, s / seg[i]) : 1;
      const A = path[i];
      const B = path[i + 1];
      ax = A.x + (B.x - A.x) * k;
      az = A.z + (B.z - A.z) * k;
      const moving = c.t < wd && L > 0.05;
      speed = moving ? L / wd : 0;
      yaw = moving ? yawTo(B.x - A.x, B.z - A.z) : (act.face ?? yaw);
      // Sobre puentes y escaleras: la superficie caminable bajo la altura anterior.
      c.ay = c.i === c.ayShot ? c.ay : (act.yHint ?? groundHeight(ax, az));
      c.ayShot = c.i;
      const ay = groundHeight(ax, az, c.ay + 0.6);
      c.ay = ay;
      rig.root.position.set(ax, ay, az);
      rig.root.rotation.y = yaw;
      rig.animate(dt, { speed, onGround: true, aimPitch: 0 });
    }
    const actor = { x: ax, y: act ? c.ay : groundHeight(ax, az), z: az };
    // Diálogo: una línea tras otra, con una pausa corta.
    const lines = shot.lines ?? [];
    if (c.lineIdx < lines.length && (!c.speech || c.speech.done)) {
      c.gap = (c.gap ?? 0) + dt;
      if (!c.speech || c.gap > 0.35) {
        c.gap = 0;
        c.speech = this.say(lines[c.lineIdx]);
        c.speaker = STORY_LINE[lines[c.lineIdx]].who;
        c.lineIdx++;
        // Quien habla mueve los brazos (gesto de conversación en bucle).
        for (const r of [g.player.rig, this.abuela]) r.stopGesture?.(0.3);
        const who = c.speaker === 'santi' ? (act ? g.player.rig : null) : c.speaker === 'rosa' ? this.abuela : null;
        if (who?.hasClip?.('talk')) who.play('talk', { loop: true, mask: 'upper', fadeIn: 0.3 });
      }
    }
    if (c.speech?.done && !c.gestureOff) {
      c.gestureOff = true;
      for (const r of [g.player.rig, this.abuela]) r.stopGesture?.(0.4);
    } else if (c.speech && !c.speech.done) c.gestureOff = false;
    const talking = c.speech && !c.speech.done ? c.speaker : null;
    // Cámara (las tomas con diálogo se mueven despacio mientras dure).
    const linesDone = c.lineIdx >= lines.length && (!c.speech || c.speech.done);
    const u = ease(Math.min(1, c.t / Math.max(0.1, shot.dur ?? (shot.minDur ?? 4) + 3)));
    const cam = shot.cam(u, actor, talking);
    g.camera.position.set(cam.pos[0], cam.pos[1], cam.pos[2]);
    g.camera.lookAt(cam.look[0], cam.look[1], cam.look[2]);
    g.camRig.pos.copy(g.camera.position);
    // Fundidos al entrar y al salir de cada toma.
    const fin = shot.dur !== undefined ? c.t >= shot.dur : c.t >= (shot.minDur ?? 0) && linesDone;
    c.out = fin ? (c.out ?? 0) + dt : 0;
    g.setFade(Math.max(1 - c.t / 0.6, c.out / 0.6));
    if (fin && c.out >= 0.6) {
      if (shot.title) this._title(null, false);
      this._nextShot();
    }
    c.focus.y = actor.y;
    g.audio.listener = { x: g.camera.position.x, y: g.camera.position.y, z: g.camera.position.z };
  }

  _skip() {
    const c = this.cinematic;
    this.stopSpeaking();
    c.i = c.shots.length;
    this._end();
  }

  _end() {
    const c = this.cinematic;
    const g = this.game;
    const e = c.opts.end;
    // Tarjeta de título sobre negro y luego el juego.
    c.ending = { t: 0 };
    this.stopSpeaking();
    g.setFade(1);
    this._title(c.opts.title, true);
    if (e) {
      g.player.state.pos.x = e.x;
      g.player.state.pos.z = e.z;
      g.player.state.pos.y = groundHeight(e.x, e.z);
      g.player.state.yaw = e.yaw;
      g.camRig.yaw = e.yaw;
      g.camRig.pitch = -0.12;
      g.camRig.first = true;
      g.world.populate(e.x, e.z);
    }
  }

  _updateEnding(dt) {
    const c = this.cinematic;
    const g = this.game;
    c.ending.t += dt;
    const T = 3.2;
    if (c.ending.t >= T - 0.9) this._title(null, false);
    if (c.ending.t < T) return;
    this.cinematic = null;
    this.el?.classList.remove('on');
    document.body.classList.remove('intro', 'cinematic');
    g.player.rig.root.visible = true;
    g.hud.show(true);
    g.setFade(0);
    this.story._shown = null;
    c.opts.onEnd?.();
    g.save();
  }
}
