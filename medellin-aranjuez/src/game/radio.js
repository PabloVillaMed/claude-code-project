// Radio del juego, al estilo GTA: al subirse a un carro o a una moto suena la
// emisora escogida (Q siguiente, Z anterior; cruceta ← → en el mando), que se
// recuerda entre partidas. Cada emisora va "en vivo": su programación corre
// aunque no se escuche, así que al volver a ella no arranca de cero.
// Además, algunas tiendas, billares y parches tienen un parlante con música
// bajita que solo se oye de cerca (máximo dos a la vez).
//
// La música (public/sounds/musica, ver radioStations.js y ASSETS-CREDITS.md)
// se reproduce en streaming con <audio> (nunca se decodifica el archivo
// entero ni bloquea el juego), conectado a WebAudio para el volumen, el
// ducking bajo las voces, el filtro de "adentro del local" y el paneo.

import { EMISORAS, rutaPista } from './radioStations.js';
import { APAGADA, MAX_PARLANTES, enVivo, gananciaParlante, mover, objetivoDuck, ordenPistas, parlantesCercanos, pasoDuck, semillaDe } from '../sim/radioDial.js';
import { RadioHud } from '../ui/radioHud.js';

const CLAVE = 'aranjuez.radio.v1';
const PAUSA_ENTRE_PISTAS = 1.2;
const VOL_CARRO = 0.9;
const VOL_PARLANTE = 0.5;

const guardar = (fn) => {
  try {
    return fn();
  } catch {
    return null;
  }
};

/** Un reproductor: <audio> → ganancia → paso bajo → paneo → bus de música. */
class Canal {
  constructor(radio, { filtro = 0 } = {}) {
    this.radio = radio;
    this.el = new Audio();
    this.el.preload = 'auto';
    this.el.volume = 0; // hasta que esté conectado a WebAudio
    this.filtro = filtro;
    this.key = null;
    this.gain = null;
    this.lp = null;
    this.pan = null;
    this.nivel = 0; // ganancia actual (para el apagado suave)
    this.objetivo = 0;
    this.quiere = false;
    this.el.addEventListener('error', () => {
      if (this.key) console.warn('Radio: no se pudo cargar', this.el.src);
      this.key = null;
    });
  }

  _conectar() {
    if (this.gain) return;
    const ctx = this.radio.ctx;
    const bus = this.radio.bus;
    if (!ctx || !bus) return;
    try {
      const src = ctx.createMediaElementSource(this.el);
      this.gain = ctx.createGain();
      this.gain.gain.value = 0;
      let n = src.connect(this.gain);
      if (this.filtro) {
        this.lp = ctx.createBiquadFilter();
        this.lp.type = 'lowpass';
        this.lp.frequency.value = this.filtro;
        n = n.connect(this.lp);
      }
      if (ctx.createStereoPanner) {
        this.pan = ctx.createStereoPanner();
        n = n.connect(this.pan);
      }
      n.connect(bus);
      this.el.volume = 1;
    } catch (e) {
      // Sin WebAudio: se usa el volumen del propio <audio>.
      console.warn('Radio sin WebAudio:', e?.message ?? e);
      this.gain = null;
    }
  }

  /** Carga una pista y la pone en `offset` segundos. */
  cargar(key, url, offset) {
    this._conectar();
    this.key = key;
    this.el.src = url;
    const seek = () => {
      if (offset > 0.5 && offset < (this.el.duration || Infinity) - 1) {
        try {
          this.el.currentTime = offset;
        } catch {
          /* el servidor no deja buscar: arranca desde el principio */
        }
      }
    };
    if (this.el.readyState >= 1) seek();
    else this.el.addEventListener('loadedmetadata', seek, { once: true });
    this._play();
  }

  _play() {
    const p = this.el.play();
    if (p?.catch) p.catch(() => {});
  }

  /** Ganancia (0..1 ya con volumen de música y ducking) y paneo; dt para suavizar. */
  mezclar(g, dt, pan = 0) {
    this.objetivo = g;
    this.nivel = pasoDuck(this.nivel, g, dt, 0.08, 0.25);
    if (this.gain) {
      const t = this.radio.ctx.currentTime;
      this.gain.gain.setTargetAtTime(this.nivel, t, 0.05);
      this.pan?.pan.setTargetAtTime(pan, t, 0.1);
    } else this.el.volume = Math.max(0, Math.min(1, this.nivel));
  }

  pausar() {
    if (!this.el.paused) this.el.pause();
  }

  reanudar() {
    if (this.key && this.el.paused && !this.el.ended) this._play();
  }

  detener() {
    if (!this.key && !this.el.getAttribute('src')) return;
    this.pausar();
    this.key = null;
    this.nivel = 0;
    if (this.gain) this.gain.gain.value = 0;
    this.el.removeAttribute('src');
    this.el.load();
  }
}

export class RadioSystem {
  constructor(game) {
    this.game = game;
    this.hud = new RadioHud();
    this.ctx = null;
    this.bus = null;
    this.duracion = null; // {emisora: {pista: segundos}} desde manifest.json
    this.volumenMusica = game.settings?.musicVolume ?? 0.8;
    const guardado = guardar(() => JSON.parse(localStorage.getItem(CLAVE)));
    const i = EMISORAS.findIndex((e) => e.id === guardado?.emisora);
    this.dial = guardado?.emisora === 'apagada' ? APAGADA : i >= 0 ? i : 0;
    // Orden fijo de cada emisora y un reloj por emisora que arranca en un
    // punto cualquiera (al prender la radio se cae en la mitad de algo).
    this.orden = Object.fromEntries(EMISORAS.map((e) => [e.id, ordenPistas(e.pistas.map((p) => p.id), semillaDe(e.id))]));
    this.reloj = Math.random() * 3600;
    this.duck = 1;
    this.carro = null;
    this.parlantes = null; // lugares con parlante (se arman al primer update)
    this.canalesParlante = [];
    this.estado = { encendida: false, emisora: null, pista: null };
    this._cargarManifest();
  }

  _cargarManifest() {
    if (typeof fetch !== 'function') return;
    fetch('sounds/musica/manifest.json')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((m) => {
        this.duracion = {};
        for (const [id, pistas] of Object.entries(m.emisoras ?? {})) this.duracion[id] = Object.fromEntries(Object.entries(pistas).map(([k, v]) => [k, v.dur]));
      })
      .catch((e) => console.warn('Música no disponible:', e?.message ?? e));
  }

  /** Crea el bus de música cuando ya existe el AudioContext (tras un gesto). */
  _bus() {
    const a = this.game.audio;
    if (this.bus || !a?.ctx) return !!this.bus;
    this.ctx = a.ctx;
    this.bus = this.ctx.createGain();
    this.bus.gain.value = 0;
    // Va directo a la salida (no por el compresor de los efectos, que la
    // haría "bombear" con cada disparo); el volumen general se aplica aquí.
    this.bus.connect(this.ctx.destination);
    this.carro = new Canal(this);
    for (let k = 0; k < MAX_PARLANTES; k++) this.canalesParlante.push(new Canal(this, { filtro: 1800 }));
    return true;
  }

  get emisora() {
    return this.dial === APAGADA ? null : EMISORAS[this.dial];
  }

  setMusicVolume(v) {
    this.volumenMusica = Math.max(0, Math.min(1, v));
  }

  /** Cambia de emisora (+1 / -1) y lo muestra en pantalla. */
  cambiar(paso) {
    this.dial = mover(this.dial, EMISORAS.length, paso);
    guardar(() => localStorage.setItem(CLAVE, JSON.stringify({ emisora: this.emisora?.id ?? 'apagada' })));
    if (this.carro) this.carro.key = null; // la siguiente actualización carga la nueva
    this._anunciarEmisora();
    this.game.audio?.ui?.('tick');
  }

  _anunciarEmisora() {
    const e = this.emisora;
    this.hud.emisora(e ? { nombre: `${e.nombre} ${e.frecuencia}`, genero: e.genero, color: e.color } : { nombre: 'Radio apagada', genero: '', color: '#888' });
  }

  /** Qué debería sonar ahora en una emisora: {pista, offset} o null. */
  _programa(e, desfase = 0) {
    const dur = this.duracion?.[e.id];
    if (!dur) return null;
    const ids = this.orden[e.id].filter((id) => dur[id] > 0);
    if (!ids.length) return null;
    const { i, offset } = enVivo(ids.map((id) => dur[id]), this.reloj + desfase + (semillaDe(e.id) % 997), PAUSA_ENTRE_PISTAS);
    return { pista: e.pistas.find((p) => p.id === ids[i]), offset };
  }

  /** ¿Hay alguien hablando (diálogos de la calle o historia)? */
  _voces() {
    const g = this.game;
    const calle = g.dialogue?.active?.some((u) => u.started && !u.done && u.node) ?? false;
    const historia = !!(g.storyDir?.speaking && !g.storyDir.speaking.done);
    return { voz: calle || historia, cinematica: !!g.storyDir?.cinematic };
  }

  /** Lugares con parlante: billares, fritanga, bares y tiendas con dominó. */
  _armarParlantes() {
    const g = this.game;
    const out = [];
    const emisoraDe = (i, pref) => pref ?? EMISORAS[(i * 7 + 3) % EMISORAS.length].id;
    const pois = { billares92: 'sabrosa', fritanga: 'perreo', coctelazo: 'perreo', abuela: 'sabrosa', tortas: 'chill' };
    for (const p of g.city?.pois ?? []) if (p.id in pois) out.push({ x: p.x, z: p.z, emisora: pois[p.id], id: p.id });
    const spots = g.world?.activities?.spots;
    this._conDominos = !!spots;
    const dominos = spots?.filter((s) => s.kind === 'domino') ?? [];
    dominos.forEach((s, i) => out.push({ x: s.x, z: s.z, emisora: emisoraDe(i, i % 2 ? 'sabrosa' : null), id: `domino${i}` }));
    // Unas cuantas tiendas más (una de cada seis), repartidas por el barrio.
    const tiendas = (g.city?.buildings ?? []).filter((b) => b.style === 'tienda');
    tiendas.forEach((b, i) => {
      if (i % 6 === 0) out.push({ x: (b.minX + b.maxX) / 2, z: (b.minZ + b.maxZ) / 2, emisora: emisoraDe(i), id: `tienda${i}` });
    });
    this.parlantes = out;
  }

  /** Paneo estéreo de un punto respecto a la cámara (como las voces). */
  _pan(x, z) {
    const cam = this.game.camera;
    const l = this.game.audio?.listener ?? this.game.player;
    const dx = x - l.x;
    const dz = z - l.z;
    const d = Math.hypot(dx, dz);
    if (!cam || d < 0.5) return 0;
    const e = cam.matrixWorld.elements;
    const rl = Math.hypot(e[0], e[2]) || 1;
    return Math.max(-1, Math.min(1, ((dx / d) * e[0] + (dz / d) * e[2]) / rl)) * 0.7;
  }

  update(dt) {
    const g = this.game;
    if (!this._bus()) return;
    const jugando = g.state === 'playing';
    // En menús, pausa y tienda: todo en silencio (y el reloj de las emisoras quieto).
    if (!jugando) {
      if (g.state === 'menu' || g.state === 'loading') {
        this.carro.detener();
        for (const c of this.canalesParlante) c.detener();
      } else {
        this.carro.pausar();
        for (const c of this.canalesParlante) c.pausar();
      }
      this.estado.encendida = false;
      return;
    }
    this.reloj += dt;
    this.bus.gain.setTargetAtTime(g.audio.volume ?? 0.7, this.ctx.currentTime, 0.05);
    this.duck = pasoDuck(this.duck, objetivoDuck(this._voces()), dt);
    const p = g.player;
    const v = p.vehicle;
    const enCarro = !!v && !p.dead && !v.state?.destroyed;
    // Al subirse: la emisora de siempre, con su letrero.
    if (enCarro && !this._enCarro) this._anunciarEmisora();
    this._enCarro = enCarro;

    // ------------------------------------------------ radio del vehículo
    const e = enCarro ? this.emisora : null;
    const prog = e ? this._programa(e) : null;
    if (prog) {
      const key = `${e.id}/${prog.pista.id}`;
      // Si la pista terminó antes que la programación (arrancó tarde), se adelanta el reloj.
      if (this.carro.key === key && this.carro.el.ended) this.reloj += Math.max(0, (this.duracion[e.id][prog.pista.id] ?? 0) - prog.offset) + PAUSA_ENTRE_PISTAS;
      if (this.carro.key !== key) {
        this.carro.cargar(key, rutaPista(e, prog.pista), prog.offset);
        this.hud.pista(prog.pista, e.color);
      } else this.carro.reanudar();
      this.carro.mezclar(VOL_CARRO * this.volumenMusica * this.duck, dt);
      this.estado = { encendida: true, emisora: e.id, pista: prog.pista.id };
    } else {
      this.carro.mezclar(0, dt);
      if (this.carro.nivel < 0.01) this.carro.pausar();
      this.estado = { encendida: false, emisora: e?.id ?? null, pista: null };
    }

    // ------------------------------------------------ parlantes de los locales
    if (!this.parlantes || (!this._conDominos && g.world?.activities?.spots)) this._armarParlantes();
    const cerca = this.duracion ? parlantesCercanos(this.parlantes, p.x, p.z) : [];
    // Canal libre para cada parlante nuevo; los que se alejan se apagan.
    const asignados = new Map();
    for (const c of this.canalesParlante) {
      const o = cerca.find((q) => c.lugar === q.p);
      if (o) asignados.set(o.p, c);
    }
    for (const o of cerca) {
      if (asignados.has(o.p)) continue;
      const libre = this.canalesParlante.find((c) => ![...asignados.values()].includes(c) && c.nivel < 0.02);
      if (libre) {
        libre.lugar = o.p;
        libre.key = null;
        asignados.set(o.p, libre);
      }
    }
    this.parlantesSonando = 0;
    for (const c of this.canalesParlante) {
      const o = cerca.find((q) => q.p === c.lugar);
      if (!o || !asignados.has(o.p)) {
        c.mezclar(0, dt);
        if (c.nivel < 0.005) {
          c.pausar();
          c.lugar = null;
        }
        continue;
      }
      const em = EMISORAS.find((x) => x.id === o.p.emisora) ?? EMISORAS[0];
      const pr = this._programa(em, 1234 + (semillaDe(o.p.id) % 600)); // cada local va en otro punto de la emisora
      if (!pr) continue;
      const key = `${em.id}/${pr.pista.id}`;
      if (c.key !== key) c.cargar(key, rutaPista(em, pr.pista), pr.offset);
      else c.reanudar();
      // Dentro del carro se oye poco (ventanas arriba) y menos con la radio prendida.
      const tapado = enCarro ? (this.estado.encendida ? 0.15 : 0.4) : 1;
      c.mezclar(VOL_PARLANTE * this.volumenMusica * this.duck * tapado * gananciaParlante(o.d), dt, this._pan(o.p.x, o.p.z));
      if (c.nivel > 0.01) this.parlantesSonando++;
    }
  }

  /** Estado para pruebas y depuración. */
  status() {
    return {
      ...this.estado,
      dial: this.dial,
      emisoraNombre: this.emisora ? `${this.emisora.nombre} ${this.emisora.frecuencia}` : 'Radio apagada',
      volumenMusica: this.volumenMusica,
      duck: Math.round(this.duck * 100) / 100,
      cargada: !!this.duracion,
      reproduciendo: !!this.carro && !this.carro.el.paused,
      ganancia: this.carro ? Math.round(this.carro.nivel * 100) / 100 : 0,
      parlantes: this.parlantesSonando ?? 0,
      emisoras: EMISORAS.map((e) => e.id),
    };
  }
}
