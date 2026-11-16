// La gente adentro de las discotecas de la 92 en el juego: en el local donde
// está el jugador (o, parado frente a la puerta abierta mirando hacia
// adentro, en ese) hay gente bailando en la pista en parejas y en rondas,
// gente en la barra con sus bartenders, mesas y VIP con botella y bengala,
// DJ, orquesta o trío en la tarima, animador, meseros que van y vienen y
// bailarines en las plataformas. Quién hay, dónde se para y qué baila sale
// de sim/clubLife.js (puro y probado); los bailes, de sim/baile.js sobre el
// esqueleto (render/dancePoses.js), todos al tempo del local.
//
// Son peatones quietos del mundo (game/world.js: `fixed`, con su `act`), así
// les llegan los tiros, las amenazas y las miradas como a cualquiera, pero
// no cuentan en el cupo de la calle. Para que entrar y salir no cueste, los
// muñecos se guardan en una reserva al salir del local y se vuelven a vestir
// en el siguiente (y se precargan de a uno al acercarse a la 92 de noche).
// Con un arma apuntando o tiros adentro: los de la pista y la barra corren a
// la puerta por el piso libre (sim/clubLife.js salidaDe), los que atienden se
// agachan y los sentados se cubren.

import * as THREE from 'three';
import { CLUB_MINIMO, TEMPOS, apartarse, armarGente, cupoClub, ocupado, pasoSalida, pintaClub, rejilla, rutaEntre, salidaDe, tempoDe } from '../sim/clubLife.js';
import { BAILE, ESTILOS, limpiarPose, nuevaPose, poseBaile, poseBartender, poseBillar, poseCubrirse, poseDJ, poseMesero, poseMusico, poseRockola, poseSentado } from '../sim/baile.js';
import { ESTAMPIDA, bajadaMezz, enMezz, frenoCola, restante } from '../sim/estampida.js';
import { tempoPista, tiempoPista } from '../sim/pulsos.js';
import { aLocal, aMundo } from '../sim/interiors.js';
import { nivelRumba } from '../sim/nightlife.js';
import { angleDiff, damp, yawFromDir } from '../sim/math.js';
import { makeRng } from '../sim/rng.js';
import { randomLook } from '../render/characterRig.js';
import { applyOutfit } from '../render/outfit.js';
import { animarBengala, aplicarPose, botellasVip, medidasBaile, ponerUtileria, quitarUtileria, soltarPose } from '../render/dancePoses.js';

// ------------------------------------------------------------------ configurables
/** Afuera: parado a esta distancia (m) o menos de la puerta abierta, a lo sumo PUERTA_LADO m a cada lado y con la cámara mirando hacia adentro (coseno >= MIRANDO), el local ya se llena. */
export const PUERTA_CERCA = 7;
export const PUERTA_LADO = 4;
export const MIRANDO = 0.3;
/** Afuera: el local sigue lleno hasta alejarse esto (m) de su puerta. */
export const PUERTA_SOLTAR = 14;
/** s sin local activo antes de guardar la gente en la reserva; más lejos que RECICLAR_LEJOS m del local (un salto, un carro rápido) se guarda de una (antes de que el mundo la borre por lejana). */
export const RECICLAR_TRAS = 3;
export const RECICLAR_LEJOS = 40;
/**
 * Personas que aparecen por cuadro: creando el muñeco (con el jugador afuera / ya adentro) y sacándolo de la reserva.
 * (Cada una cuesta su primer dibujo: textura de huesos, buffers y uniforms, ~3 ms; con 8 de la reserva por cuadro la
 * puerta de flow92 daba cuadros de 50-80 ms; con 3 se reparte en ~15 cuadros.)
 */
export const PONER = { nuevosAfuera: 1, nuevosAdentro: 3, reserva: 3 };
/** Reserva de muñecos: cuántos se guardan, s sin usarla (y lejos) antes de liberarla, y la precarga (uno cada `cada` s con un local abierto a menos de `dist` m). */
export const RESERVA_MAX = 64;
export const RESERVA_SOLTAR = 90;
export const PRECARGA = { usar: true, dist: 38, cada: 0.15 };
/** La gente de adentro no proyecta sombra (adentro no entra el sol: el pase de sombras sería puro costo). */
export const SIN_SOMBRA = true;
/** Cada cuántos cuadros se anima cada quien según la distancia a la cámara (m), por calidad ([hasta m, cada n cuadros]); fuera de cámara no se animan (ANIM_LOD.oculto). */
export const CLUB_LOD = {
  ultra: [[12, 1], [22, 2], [Infinity, 3]],
  alta: [[9, 1], [16, 2], [Infinity, 3]],
  media: [[7, 1], [13, 2], [Infinity, 3]],
  baja: [[5, 1], [10, 2], [Infinity, 4]],
};
/** Fracción de la clientela con el vaso en la mano (cada vaso es una llamada de dibujo más). */
export const VASOS = 0.55;
/** Botellas con bengala en las mesitas de los VIP ocupados. */
export const BENGALAS_VIP = true;
/** Empuje suave: el jugador a menos de EMPUJE_RADIO m corre a la gente hasta EMPUJE_TOPE m; EMPUJE_VEL = qué tan rápido se corren y vuelven (1/s). */
export const EMPUJE_RADIO = 0.8;
export const EMPUJE_TOPE = 0.55;
export const EMPUJE_VEL = 7;
/** Meseros: velocidad (m/s) y s que paran en cada punto. */
export const MESERO_VEL = 1.1;
export const MESERO_PAUSA = [3, 7];
/** Susto: velocidad al correr (m/s), demora máxima en reaccionar (s), s de calma para que los que se quedaron vuelvan a lo suyo, s que el local queda casi solo y radio mínimo (m) de una amenaza del mundo para asustar (un pito no asusta). */
export const PANICO_VEL = [3.4, 4.8];
export const PANICO_DEMORA = 0.9;
export const PANICO_CALMA = 25;
export const SUSTO = 90;
export const AMENAZA_RADIO = 20;
/** Solo asustan los tiros de adentro del local, los de la calle a menos de AMENAZA_PUERTA m de la puerta y lo que tenga radio de explosión (>= AMENAZA_EXPLOSION m); una balacera más allá en la 92 no vacía la discoteca. */
export const AMENAZA_PUERTA = 6;
export const AMENAZA_EXPLOSION = 60;
/** Corro alrededor del jugador (corro()): radio (m), cuántos a lo sumo, de qué tan lejos vienen (m) y a qué velocidad caminan (m/s). */
export const CORRO_RADIO = 2.2;
export const CORRO_MAX = 8;
export const CORRO_ALCANCE = 6.5;
export const CORRO_VEL = 1.3;
/** Clip de baile de animaciones.glb ('dance', captura de movimiento): fracción de los que bailan solos en estos estilos que lo usan en vez del baile por código, y su tempo propio (BPM) para acompasarlo al del local. */
export const CLIP_BAILE = { usar: true, fraccion: 0.3, estilos: ['regueton', 'electronica'], bpm: 100, min: 0.8, max: 1.3 };
/** Fase del compás con el reloj de la pista que suena (game/radio.js tiempoRumba): si se aleja más de SINC_SALTO tiempos, salta; si no, se corrige suave. */
export const SINC_RADIO = true;
export const SINC_SALTO = 1.5;
/** Tempo y fase de verdad de la pista que suena (sim/pulsos.js, medidos sobre los .ogg); false = el tempo supuesto del estilo. */
export const PULSO_MEDIDO = true;
/** s entre cambios de quién habla, oye o toma en las mesas y la barra. */
export const CHARLA_CADA = 0.7;
/** El baile del jugador con combo alto (game/danceGame.js): 'doble' baila al doble; 'vuelta' además da una vuelta entera cada VUELTA_CADA compases de 4, en los tiempos 2 a 4. */
export const VUELTA_CADA = 2;
/** Pareja del jugador en las salsotecas (parejaJugador): si nadie baila solo cerca, viene alguien parado solo en la barra a menos de PAREJA_BARRA veces el alcance. */
export const PAREJA_BARRA = 2.2;

const sinSombra = () => {};
const SIN_ZONAS = [];
/** Los que atienden: con tiros se agachan donde están (el resto corre a la salida). */
const TRABAJAN = new Set(['bartender', 'dj', 'musico', 'animador', 'bailarin']);
const _p = { x: 0, z: 0 };
const _w = { x: 0, z: 0 };
const _o = { x: 0, z: 0 };
const _dir = new THREE.Vector3();
const TAU = Math.PI * 2;

export class ClubLife {
  constructor(game) {
    this.game = game;
    this.r = null; // interior cuya gente está en escena
    this.datos = null; // {personas, unidades, reparto} de sim/clubLife.js
    this.gente = []; // PedEntity en escena (cada uno con su `club`)
    this.cola = []; // personas por poner (se sacan del final)
    this.reserva = []; // PedEntity guardados (fuera del mundo y de la escena)
    this.porI = []; // persona i -> PedEntity
    this.unid = []; // parejas y abrazos: corrimiento compartido
    this.rng = makeRng(9238);
    this.rngPinta = makeRng(1);
    this.t = 0;
    this.frame = 0;
    this.b = 0; // tiempos de la música transcurridos
    this.tempo = { estilo: 'regueton', ...TEMPOS.regueton };
    this.sinc = false;
    this.sinLocal = 0;
    this.reservaT = 0;
    this.precargaT = 0;
    this.charlaT = 0;
    this.cupo = 0;
    this.lod = CLUB_LOD.alta;
    this.clipRate = 1;
    this.panico = false;
    this.panicoT = -1e9;
    this.susto = new Map(); // id del local -> hasta cuándo queda casi solo
    this.rej = null;
    this.salida = null;
    this.pisos = new Map(); // id del local -> {rej, salida}: el piso del salón no cambia (se calcula una vez por local)
    this.botellas = null;
    this.corroOn = null;
    this.pose = nuevaPose();
    this.cuenta = { creados: 0, reciclados: 0, liberados: 0, huyeron: 0 };
    // El baile del jugador (bailarJugador): estilo, peso de la mezcla y sus parámetros.
    this.jug = { estilo: null, ultimo: 'regueton', w: 0, paso: 'normal', rate: 1, pareja: null, P: { id: 9001, energia: 1, espejo: 1, lider: true, solo: true, unidad: 0, cuentas: TEMPOS.salsa.cuentas } };
    this.bpm = 0; // tempo de verdad (el de la pista que suena, si está medida)
    this.clavePista = null;
    // La estampida: la bajada del mezanine y los arreglos de la cola (sin crear objetos por cuadro).
    this.bajada = null;
    this.extraMezz = 0;
    this.corr = { n: 0, m: [], xs: new Float32Array(64), ys: new Float32Array(64), zs: new Float32Array(64), dxs: new Float32Array(64), dzs: new Float32Array(64), prio: new Float32Array(64) };
    // Lo que el mundo le pregunta a cada persona de adentro (game/world.js: p.act).
    this.act = { dress: (p, st) => this._dress(p, st), threat: (p, th) => this._amenaza(th) };
    this._post = (rig) => this._pose(rig);
    this._postJug = (rig) => this._poseJugador(rig);
  }

  update(dt) {
    const g = this.game;
    if (g.state !== 'playing' || !g.world || !g.player || !g.interiors?.list.length) return;
    this.t += dt;
    this.frame++;
    this._revisar(dt);
    this._compas(dt);
    this._jugador(dt);
    if (!this.r) {
      this._precargar(dt);
      this._reservaVieja(dt);
      return;
    }
    this._poner();
    this._sustos(dt);
    this._gente(dt);
    this.botellas?.animar(this.t);
    this.charlaT -= dt;
    if (this.charlaT <= 0) {
      this.charlaT = CHARLA_CADA;
      this._charla();
    }
  }

  // ------------------------------------------------------------ qué local
  /** El local que toca: donde está el jugador o, afuera, el de la puerta abierta que tiene al frente. */
  _cual() {
    const g = this.game;
    const it = g.interiors;
    const p = g.player;
    if (it.inside) return it.inside;
    if (p.inVehicle) return null;
    const act = this.r;
    let sigue = false;
    let best = null;
    let bd = Infinity;
    g.camera.getWorldDirection(_dir);
    for (let i = 0; i < it.list.length; i++) {
      const r = it.list[i];
      if (Math.abs(p.x - r.ox) > 30 || Math.abs(p.z - r.oz) > 30) continue;
      const l = aLocal(r, p.x, p.z, _p);
      const d = Math.hypot(l.x, l.z);
      if (r === act && l.z > -1 && d < PUERTA_SOLTAR) sigue = true;
      if (!it.state[i].open || !it.views.get(r.id)?.ready) continue;
      if (l.z < -0.5 || d > PUERTA_CERCA || Math.abs(l.x) > PUERTA_LADO) continue;
      if (-(_dir.x * r.nx + _dir.z * r.nz) < MIRANDO) continue;
      if (d < bd) {
        bd = d;
        best = r;
      }
    }
    return best ?? (sigue ? act : null);
  }

  _revisar(dt) {
    const r = this._cual();
    if (r === this.r) this.sinLocal = 0;
    else if (r) this._activar(r);
    else if ((this.sinLocal += dt) > RECICLAR_TRAS || (this.r && Math.hypot(this.game.player.x - this.r.ox, this.game.player.z - this.r.oz) > RECICLAR_LEJOS)) this._desactivar();
  }

  _activar(r) {
    this._desactivar();
    const g = this.game;
    this.r = r;
    this.sinLocal = 0;
    this.tempo = tempoDe(r);
    this.clipRate = Math.min(CLIP_BAILE.max, Math.max(CLIP_BAILE.min, this.tempo.bpm / CLIP_BAILE.bpm));
    const peds = g.quality?.peds ?? 30;
    this.lod = CLUB_LOD[g.quality?.label?.toLowerCase()] ?? (peds >= 56 ? CLUB_LOD.ultra : peds >= 44 ? CLUB_LOD.alta : peds >= 34 ? CLUB_LOD.media : CLUB_LOD.baja);
    let n = cupoClub(r.tam, peds, nivelRumba(g.env?.timeOfDay ?? 12));
    if (this.t < (this.susto.get(r.id) ?? -1)) n = Math.min(n, CLUB_MINIMO);
    this.cupo = n;
    const G = (this.datos = n > 0 ? armarGente(r, n, 1) : { personas: [], unidades: [], reparto: {} });
    this.porI = G.personas.map(() => null);
    this.unid = G.unidades.map((u) => {
      if (u.tipo !== 'pareja' && u.tipo !== 'abrazo') return null;
      const w = aMundo(r, u.cx, u.cz);
      return { ox: 0, oz: 0, x: w.x, z: w.z, rad: u.rad, f: -1 };
    });
    // Primero los que se ven desde la puerta (los más cercanos a ella): se sacan del final.
    this.cola = [...G.personas].sort((a, b) => a.lz - b.lz);
    let h = n;
    for (let i = 0; i < r.id.length; i++) h = (h * 31 + r.id.charCodeAt(i)) >>> 0;
    this.rngPinta = makeRng(h || 1);
    this._botellas(G);
  }

  /** La gente del local activo vuelve a la reserva (los muertos y los que huyeron se quedan con el mundo). */
  _desactivar() {
    if (!this.r && !this.gente.length) return;
    if (this.jug.pareja) this.parejaJugador(false); // (el jugador vuelve a bailar solo: J.P)
    for (const m of this.gente) this._guardar(m);
    this.gente.length = 0;
    this.cola.length = 0;
    this.porI.length = 0;
    this.unid.length = 0;
    this.botellas?.dispose();
    this.botellas = null;
    this.corroOn = null;
    this.panico = false;
    this.rej = null;
    this.salida = null;
    this.bajada = null;
    this.jug.pareja = null;
    this.datos = null;
    this.r = null;
    this.reservaT = 0;
  }

  /** La rejilla del piso del local r (y su salida, la primera vez que se necesita), guardadas por local. */
  _piso(r) {
    let P = this.pisos.get(r.id);
    if (!P) this.pisos.set(r.id, (P = { rej: rejilla(r), salida: null }));
    return P;
  }

  /** Pruebas: pone de una vez a toda la gente del local que toca. */
  llenar() {
    this._revisar(0);
    while (this.cola.length) this._siguiente();
    return this.gente.length;
  }

  // ------------------------------------------------------------ poner y guardar
  _poner() {
    let nuevos = this.game.interiors.inside ? PONER.nuevosAdentro : PONER.nuevosAfuera;
    let res = PONER.reserva;
    while (this.cola.length) {
      const hay = this._enReserva(!!this.cola[this.cola.length - 1].female) >= 0;
      if (hay ? res-- <= 0 : nuevos-- <= 0) break;
      this._siguiente();
    }
  }

  _enReserva(female) {
    for (let i = this.reserva.length - 1; i >= 0; i--) if (!!this.reserva[i].look.female === female) return i;
    return -1;
  }

  /** Aspecto al azar de mujer o de hombre (randomLook escoge el avatar según el género). Todos adultos (sin `scale`). */
  _look(female) {
    let look = randomLook(this.rng, 'civil');
    for (let k = 0; k < 8 && !!look.female !== female; k++) look = randomLook(this.rng, 'civil');
    return look;
  }

  _crear(female, x, z) {
    const m = this.game.world.spawnPedAt(x, z, { outfit: 'civil', health: 90, look: this._look(female) });
    this.cuenta.creados++;
    if (SIN_SOMBRA) {
      m.rig.setShadow(false);
      m.rig.setShadow = sinSombra;
    }
    return m;
  }

  /** La siguiente persona de la cola entra en escena (con un muñeco de la reserva si hay de su género). */
  _siguiente() {
    const q = this.cola.pop();
    const r = this.r;
    const w = this.game.world;
    const yaw = yawFromDir(q.fx, q.fz);
    const k = this._enReserva(!!q.female);
    let m;
    if (k >= 0) {
      m = this.reserva.splice(k, 1)[0];
      w.attachPed(m, q.x, q.z, yaw);
      m.rig.root.visible = true;
      m.health = 90;
      this.cuenta.reciclados++;
    } else m = this._crear(!!q.female, q.x, q.z);
    const s = m.sim;
    s.x = q.x;
    s.z = q.z;
    s.yaw = yaw;
    s.fixed = true;
    s.mode = 'idle';
    s.speed = 0;
    s.timer = Infinity;
    s.sitting = !!q.sentado;
    s.elev = q.y;
    s.health = m.health;
    m.act = this.act;
    m.walkStyle = null;
    m.idleClip = null;
    m.fixedActivity = null;
    m.activity = null;
    m.lastMode = 'idle';
    const rig = m.rig;
    applyOutfit(rig, pintaClub(r, q, this.rngPinta));
    const med = medidasBaile(rig);
    const u = q.unidad >= 0 ? this.datos.unidades[q.unidad] : null;
    const piso = Math.abs(q.y - r.y0) < 0.05;
    const C = {
      q,
      modo: q.gesto === 'bartender' || q.gesto === 'dj' || q.gesto === 'mesero' || q.gesto === 'billar' || q.gesto === 'rockola' ? q.gesto : q.gesto ? 'musico' : q.estilo ? 'baile' : q.sentado ? 'sentado' : null,
      estilo: q.estilo,
      // Parámetros de las poses (sim/baile.js).
      P: { id: q.i * 13 + 5, energia: q.energia, espejo: q.espejo, unidad: q.unidad, lider: q.lider, dist: u?.dist, cuentas: this.tempo.cuentas, alto: med.alto, altoPareja: undefined, hombroPareja: undefined, consolaY: q.consolaY, consolaZ: q.consolaZ, barraY: q.barraY, barraZ: q.barraZ, tamborY: q.tamborY, tamborZ: q.tamborZ, tira: q.tira, mesaY: q.mesaY, lento: q.lento },
      alto: med.alto,
      hombro: med.hombro,
      hx: q.x, // su sitio
      hz: q.z,
      bx: q.x, // dónde está (sin el empuje)
      bz: q.z,
      ox: 0, // corrimiento por el empuje del jugador
      oz: 0,
      yaw,
      u: q.unidad >= 0 ? this.unid[q.unidad] : null,
      w: 0, // peso de la pose por código (entra suave)
      wT: 1,
      vel: 0,
      estado: 'normal', // 'normal', 'corre', 'agachado' o 'cubierto'
      demora: 0,
      velMax: 0,
      e: null, // por dónde va el que corre (sim/clubLife.js pasoSalida)
      util: null,
      upper: null,
      charla: q.rol === 'mesa' || q.rol === 'vip' || q.rol === 'barra',
      clip: false,
      girado: false,
      ir: null, // a dónde camina (el corro y la vuelta a su sitio)
      enCorro: false,
      mesero: q.rol === 'mesero' ? { ruta: null, k: 0, pausa: this.rng.range(0.5, 4), parada: q.parada ?? 0, lx: q.lx, lz: q.lz } : null,
      movil: piso && !q.sentado && (q.rol === 'baile' || q.rol === 'barra' || q.rol === 'mesa' || q.rol === 'rockola'),
      mira: !!q.sentado || q.rol === 'barra' || q.rol === 'mesa',
    };
    if (CLIP_BAILE.usar && q.rol === 'baile' && u?.tipo === 'solo' && CLIP_BAILE.estilos.includes(q.estilo) && rig.hasClip?.('dance') && this.rngPinta.chance(CLIP_BAILE.fraccion)) {
      C.clip = true;
      C.modo = null;
      rig.clock = this.rngPinta.range(0, 6);
    }
    if (C.charla) C.upper = this.rngPinta.chance(0.3) ? 'drink' : 'listen';
    if (q.prop === 'vaso') rig.forceProp = this.rngPinta.chance(VASOS) ? 'cup' : null;
    else if (q.prop) C.util = ponerUtileria(rig, q.prop);
    // La pareja: cada uno sabe la estatura y el hombro del otro (para tomarse de las manos y abrazarse).
    this.porI[q.i] = m;
    const o = q.pareja >= 0 ? this.porI[q.pareja]?.club : null;
    if (o) {
      C.P.altoPareja = o.alto;
      C.P.hombroPareja = o.hombro;
      o.P.altoPareja = C.alto;
      o.P.hombroPareja = C.hombro;
    }
    rig.post = this._post;
    rig.postLocal = true;
    rig._club = C;
    rig._poseDirty = true;
    m.club = C;
    this.gente.push(m);
    return m;
  }

  /** Le quita al muñeco lo de la rumba (pose, utilería, quién lo anima). */
  _soltar(m) {
    const C = m.club;
    const rig = m.rig;
    if (C?.util) quitarUtileria(rig, C.util);
    if (rig.post === this._post) {
      rig.post = null;
      rig.postLocal = false;
    }
    rig._club = null;
    rig.forceProp = null;
    // (el estado de animación del mundo no borra lo que se agregó aquí)
    if (m._animSt) m._animSt.lod = m._animSt.rate = undefined;
    soltarPose(rig);
    if (m.act === this.act) m.act = null;
    if (C && this.porI[C.q.i] === m) this.porI[C.q.i] = null;
    m.club = null;
  }

  /** A la reserva (o, si ya está llena, se libera con su esqueleto). Los muertos se quedan con el mundo, que los recoge. */
  _guardar(m) {
    this._soltar(m);
    const w = this.game.world;
    if (!m.alive || !m.rig.root.parent || !w.peds.includes(m)) return;
    if (this.reserva.length >= RESERVA_MAX) {
      w.removePed(m);
      this.cuenta.liberados++;
      return;
    }
    w.detachPed(m);
    m.rig.root.removeFromParent();
    m.rig.root.visible = false;
    this.reserva.push(m);
  }

  /** Con un local abierto cerca y nadie en escena, la reserva se va llenando de a un muñeco (así entrar no da tirón). */
  _precargar(dt) {
    if (!PRECARGA.usar) return;
    this.precargaT -= dt;
    if (this.precargaT > 0) return;
    this.precargaT = PRECARGA.cada;
    const g = this.game;
    const p = g.player;
    let best = null;
    let bd = PRECARGA.dist;
    for (const r of g.interiors.list) {
      const d = Math.hypot(p.x - r.ox, p.z - r.oz);
      if (d < bd) {
        bd = d;
        best = r;
      }
    }
    if (!best) return;
    const n = Math.min(RESERVA_MAX, cupoClub(best.tam, g.quality?.peds ?? 30, nivelRumba(g.env?.timeOfDay ?? 12)));
    // (Con el local cerrado la reserva no sirve: se deja correr el reloj de _reservaVieja aunque el jugador siga cerca.)
    if (n > 0) this.reservaT = 0;
    if (this.reserva.length >= n) return;
    let mujeres = 0;
    for (const m of this.reserva) if (m.look.female) mujeres++;
    const m = this._crear(mujeres * 2 <= this.reserva.length, best.ox, best.oz);
    g.world.detachPed(m);
    m.rig.root.removeFromParent();
    m.rig.root.visible = false;
    this.reserva.push(m);
  }

  /** Lejos de la 92 un buen rato, la reserva se libera (esqueletos y texturas de huesos). */
  _reservaVieja(dt) {
    if (!this.reserva.length) return;
    this.reservaT += dt;
    if (this.reservaT < RESERVA_SOLTAR) return;
    for (const m of this.reserva) m.dispose();
    this.cuenta.liberados += this.reserva.length;
    this.reserva.length = 0;
  }

  /** Botellas con bengala en la mesita de cada VIP ocupado. */
  _botellas(G) {
    if (!BENGALAS_VIP) return;
    const r = this.r;
    const sitios = [];
    for (const u of G.unidades) {
      if (u.tipo !== 'vip') continue;
      let best = null;
      let bd = 2.4;
      for (const it of r.items) {
        if (it.t !== 'mesita') continue;
        const d = Math.hypot((it.x0 + it.x1) / 2 - u.cx, (it.z0 + it.z1) / 2 - u.cz);
        if (d < bd) {
          bd = d;
          best = it;
        }
      }
      if (!best) continue;
      const w = aMundo(r, (best.x0 + best.x1) / 2, (best.z0 + best.z1) / 2);
      sitios.push({ x: w.x, y: best.y + best.h, z: w.z });
    }
    if (!sitios.length) return;
    this.botellas = botellasVip(sitios.length);
    this.botellas.poner(sitios);
    this.game.scene.add(this.botellas.group);
  }

  // ------------------------------------------------------------ el compás
  /** Avanza el compás al tempo del local; si la pista del local está sonando, la fase sigue su reloj. */
  _compas(dt) {
    let bpm = this.bpm || this.tempo.bpm;
    this.b += (dt * bpm) / 60;
    this.sinc = false;
    if (!SINC_RADIO || !this.r) return;
    const pr = this.game.radio?.pistaRumba?.(this.r.id);
    const tt = pr ? pr.t : this.game.radio?.tiempoRumba?.(this.r.id);
    if (tt == null) return;
    // Con la pista medida (sim/pulsos.js): su tempo (llevado al del estilo) y su primer tiempo.
    const medido = PULSO_MEDIDO && pr ? tempoPista(pr.key, this.tempo.bpm) : null;
    bpm = this.bpm = medido ?? this.tempo.bpm;
    this.clavePista = pr?.key ?? null;
    const d = (medido ? tiempoPista(pr.key, tt, bpm) : (tt * bpm) / 60) - this.b;
    this.b += Math.abs(d) > SINC_SALTO ? d : d * Math.min(1, dt * 4);
    this.sinc = true;
  }

  /**
   * Dónde va la música: {local, estilo, bpm, cuentas, tiempo (tiempos
   * transcurridos), fase (0..1 dentro del tiempo), cuenta (0..8, la de
   * baile), compas (número de compás de 8), golpe (1 justo en el tiempo),
   * sincronizado (con el reloj de la pista)}. Con `estilo`, la cuenta de ese
   * baile sobre la misma música (la salsa cuenta doble).
   */
  ritmo(estilo = null) {
    const T = estilo && TEMPOS[estilo] ? TEMPOS[estilo] : this.tempo;
    const c = this.b * (T.cuentas ?? 1);
    // (Siempre el mismo objeto: el minijuego lo pide cada cuadro.)
    const o = (this._ritmo ??= {});
    o.local = this.r?.id ?? null;
    o.estilo = estilo ?? this.tempo.estilo;
    o.bpm = this.bpm || this.tempo.bpm;
    o.pista = this.clavePista;
    o.cuentas = T.cuentas ?? 1;
    o.tiempo = this.b;
    o.fase = this.b - Math.floor(this.b);
    o.cuenta = ((c % 8) + 8) % 8;
    o.compas = Math.floor(c / 8);
    o.golpe = 0.5 + 0.5 * Math.cos(TAU * this.b);
    o.sincronizado = this.sinc;
    return o;
  }

  // ------------------------------------------------------------ el jugador
  /**
   * El jugador baila `estilo` ('regueton', 'salsa', 'popular', 'electronica'
   * o 'aplauso') al compás del local, encima de su pose (de pie y quieto se
   * ve mejor); null o false = deja de bailar. Opciones: energia (0.6..1.3),
   * espejo (-1 = al revés), paso ('normal', 'doble' = al doble, 'vuelta' =
   * al doble y con una vuelta cada VUELTA_CADA compases). Devuelve true si
   * quedó bailando.
   */
  bailarJugador(estilo = null, { energia = 1, espejo = 1, paso = 'normal' } = {}) {
    const J = this.jug;
    const rig = this.game.player?.rig;
    if (!estilo || !rig || (!ESTILOS.includes(estilo) && estilo !== 'aplauso')) {
      J.estilo = null;
      J.paso = 'normal';
      return false;
    }
    if (!J.estilo) {
      J.rate = 1;
      J.off = 0;
    }
    J.estilo = J.ultimo = estilo;
    J.P.energia = energia;
    J.P.espejo = espejo;
    J.paso = paso;
    rig.post = this._postJug;
    rig.postLocal = true;
    return true;
  }

  _jugador(dt) {
    const J = this.jug;
    const p = this.game.player;
    if (J.estilo && (p.dead || p.inVehicle)) J.estilo = null;
    J.w = damp(J.w, J.estilo ? 1 : 0, 8, dt);
    if (!J.estilo && J.w < 0.01 && p.rig.post === this._postJug) {
      J.w = 0;
      p.rig.post = null;
      p.rig.postLocal = false;
      soltarPose(p.rig);
    }
  }

  _poseJugador(rig) {
    const J = this.jug;
    if (J.w < 0.01) return;
    // Al doble: el tiempo de la pose corre a 2x, empalmado donde iba (redondeado a 2 tiempos: sigue en fase con la música).
    const rate = J.paso === 'normal' || J.pareja ? 1 : 2;
    if (rate !== J.rate) {
      J.off = Math.round((J.rate * this.b + (J.off ?? 0) - rate * this.b) / 2) * 2;
      J.rate = rate;
    }
    const b = rate * this.b + (J.off ?? 0);
    poseBaile(this.pose, J.ultimo, b, J.P);
    // La vuelta: una entera en los tiempos 2 a 4 de uno de cada VUELTA_CADA compases.
    if (J.paso === 'vuelta' && !J.pareja && J.ultimo !== 'salsa') {
      const k = Math.floor(b / 4);
      const t = b - k * 4;
      if (((k % VUELTA_CADA) + VUELTA_CADA) % VUELTA_CADA === VUELTA_CADA - 1 && t > 1) {
        const u = Math.min(1, (t - 1) / 2.5);
        this.pose.yaw += TAU * u * u * (3 - 2 * u) * (J.P.espejo < 0 ? -1 : 1);
      }
    }
    aplicarPose(rig, this.pose, J.w);
  }

  /**
   * Pareja para el jugador en la pista (las salsotecas): el que baila solo
   * más cerca (a menos de `alcance` m) camina a quedar de frente a él a la
   * distancia de la salsa y bailan juntos; `yaw` = hacia dónde mira el
   * jugador. false = la pareja vuelve a su sitio. Devuelve true si hay pareja.
   */
  parejaJugador(on = true, { alcance = 3.6, yaw = null } = {}) {
    const J = this.jug;
    const r = this.r;
    const p = this.game.player;
    if (J.pareja) {
      const C = J.pareja;
      J.pareja = null;
      C.conJugador = false;
      C.charla = C.q.rol === 'mesa' || C.q.rol === 'vip' || C.q.rol === 'barra';
      Object.assign(C.P, C.Pantes);
      C.Pantes = null;
      if (C.estado === 'normal') C.ir = { x: C.hx, z: C.hz, yaw: C.yaw, estilo: C.q.estilo };
      J.P.solo = true;
      J.P.lider = true;
      J.P.unidad = 0;
      J.P.dist = undefined;
      J.P.altoPareja = undefined;
    }
    if (!on || !r || this.panico || !p) return false;
    const a = yaw ?? p.state.yaw;
    const D = BAILE.SALSA_DIST;
    const x = p.x - Math.sin(a) * D;
    const z = p.z - Math.cos(a) * D;
    const l = aLocal(r, x, z, _p);
    if (ocupado(r, l.x, l.z, 0.22, SIN_ZONAS, false)) return false;
    // Primero alguien que baila solo en la pista; si no hay (en la salsoteca casi todos van en pareja),
    // alguien parado solo en la barra que se anima (con el camino libre de muebles).
    let best = null;
    let bd = Infinity;
    for (const m of this.gente) {
      const C = m.club;
      if (C.estado !== 'normal' || !C.movil || C.enCorro || C.clip || C.ir || C.q.sentado) continue;
      const solo = C.q.rol === 'baile' && !C.u && !(C.q.unidad >= 0 && this.datos.unidades[C.q.unidad]?.tipo !== 'solo');
      const barra = C.q.rol === 'barra';
      if (!solo && !barra) continue;
      const d = Math.hypot(m.sim.x - p.x, m.sim.z - p.z);
      if (d > (solo ? alcance : alcance * PAREJA_BARRA)) continue;
      const k = d - (C.q.female ? 0.6 : 0) + (solo ? 0 : alcance);
      if (k < bd && this._caminoLibre(m.sim.x, m.sim.z, x, z)) {
        bd = k;
        best = m;
      }
    }
    if (!best) return false;
    p.state.yaw = a;
    const C = best.club;
    C.upper = null;
    C.charla = false; // (vuelve a charlar al soltarla: ver arriba)
    C.Pantes = { lider: C.P.lider, solo: C.P.solo, unidad: C.P.unidad, dist: C.P.dist, altoPareja: C.P.altoPareja, hombroPareja: C.P.hombroPareja };
    const med = medidasBaile(p.rig);
    Object.assign(C.P, { lider: false, solo: false, unidad: 4242, dist: D, altoPareja: med.alto, hombroPareja: med.hombro });
    Object.assign(J.P, { lider: true, solo: false, unidad: 4242, dist: D, altoPareja: C.alto, hombroPareja: C.hombro });
    C.conJugador = true;
    C.ir = { x, z, yaw: yawFromDir(p.x - x, p.z - z), estilo: 'salsa' };
    J.pareja = C;
    return true;
  }

  /** ¿Se puede caminar derecho de (ax, az) a (bx, bz) (mundo) sin atravesar muebles? (cada 0,3 m) */
  _caminoLibre(ax, az, bx, bz) {
    const r = this.r;
    const n = Math.ceil(Math.hypot(bx - ax, bz - az) / 0.3);
    for (let k = 1; k < n; k++) {
      const l = aLocal(r, ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n, _p);
      if (ocupado(r, l.x, l.z, 0.2, SIN_ZONAS, false)) return false;
    }
    return true;
  }

  /** Fracción del volumen de la música del local `id` (game/radio.js): baja con la estampida y mientras el local sigue casi vacío. */
  musica(id) {
    if (this.r?.id === id && this.panico) return ESTAMPIDA.MUSICA_PANICO;
    return this.t < (this.susto.get(id) ?? -1) ? ESTAMPIDA.MUSICA_VACIO : 1;
  }

  // ------------------------------------------------------------ cada quien
  /** Lo que la animación de cada persona necesita (game/world.js lo llama antes de animar). */
  _dress(p, st) {
    const C = p.club;
    if (!C) return;
    const normal = C.estado === 'normal';
    st.fidget = false;
    st.lod = this.lod;
    st.rate = undefined;
    st.speed = C.vel;
    st.upper = normal && !C.ir ? C.upper : null;
    if (!C.mira || !normal) st.lookAt = null;
    if (C.estado === 'agachado') st.crouching = true;
    if (st.driving && C.q.rol === 'mesa') st.seat = 'table';
    if (C.clip && normal && !C.ir && !C.enCorro) {
      st.idle = 'dance';
      st.rate = this.clipRate;
    }
  }

  /** La pose por código de cada persona (rig.post: después del mezclador). */
  _pose(rig) {
    const C = rig._club;
    if (!C) return;
    const o = this.pose;
    if (C.estado === 'cubierto') {
      limpiarPose(o);
      poseCubrirse(o, C.w, this.t);
      aplicarPose(rig, o, 1);
      return;
    }
    const modo = C.estilo === 'aplauso' ? 'baile' : C.modo;
    if (C.w < 0.01 || !modo) {
      if (C.girado) {
        soltarPose(rig);
        C.girado = false;
      }
      return;
    }
    const q = C.q;
    const P = C.P;
    const b = this.b + (C.conJugador ? 0 : q.retraso); // (la pareja del jugador va en su mismo tiempo)
    if (modo === 'baile') poseBaile(o, C.estilo, b, P);
    else {
      limpiarPose(o);
      if (modo === 'sentado') poseSentado(o, b, P);
      else if (modo === 'dj') poseDJ(o, b, P);
      else if (modo === 'bartender') poseBartender(o, this.t, P);
      else if (modo === 'musico') poseMusico(o, q.inst, b, P);
      else if (modo === 'mesero') {
        poseMesero(o, this.t);
        if (C.util?.bengala) animarBengala(C.util.bengala, this.t);
      } else if (modo === 'billar') poseBillar(o, this.t + q.i, P);
      else if (modo === 'rockola') poseRockola(o, this.t, P);
    }
    aplicarPose(rig, o, C.w);
    C.girado = o.yaw !== 0;
  }

  _gente(dt) {
    const g = this.game;
    const r = this.r;
    const p = g.player;
    const px = p.x;
    const pz = p.z;
    const empuja = !p.inVehicle && !p.dead && Math.abs(p.y - r.y0) < 1;
    // (También después de la calma, mientras quede alguien corriendo: K.n > 0.)
    if (this.panico || this.corr.n > 0) this._cola();
    for (let i = this.gente.length - 1; i >= 0; i--) {
      const m = this.gente[i];
      const C = m.club;
      const s = m.sim;
      // Muerto (lo recoge el mundo) o borrado por el mundo: ya no es de aquí.
      if (!m.alive || !m.rig.root.parent) {
        this._soltar(m);
        this.gente.splice(i, 1);
        continue;
      }
      // Herido por el jugador (game/combat.js lo pone a huir): susto general.
      if (s.mode === 'flee') {
        s.mode = 'idle';
        this._susto();
      }
      if (C.estado === 'corre') {
        if (this._correr(m, C, dt)) this.gente.splice(i, 1);
        continue;
      }
      if (this.panico && C.estado === 'normal' && (C.demora -= dt) <= 0) {
        this._reaccionar(m, C);
        continue;
      }
      C.w = damp(C.w, C.wT, 6, dt);
      if (C.estado !== 'normal') continue;
      if (C.mesero) {
        this._mesero(m, C, dt, px, pz);
        continue;
      }
      if (C.ir) {
        this._caminar(m, C, dt);
        continue;
      }
      if (!C.movil || C.conJugador) continue;
      // Empuje suave del jugador (la pareja se corre junta).
      const u = C.enCorro ? null : C.u;
      let ox;
      let oz;
      if (u) {
        if (u.f !== this.frame) {
          u.f = this.frame;
          this._empuje(u, u.x, u.z, u.rad * 0.6, px, pz, empuja, dt);
        }
        ox = u.ox;
        oz = u.oz;
      } else {
        const dx = C.bx - px;
        const dz = C.bz - pz;
        if (C.ox || C.oz || (dx < 3 && dx > -3 && dz < 3 && dz > -3)) this._empuje(C, C.bx, C.bz, 0, px, pz, empuja, dt);
        ox = C.ox;
        oz = C.oz;
      }
      const x = C.bx + ox;
      const z = C.bz + oz;
      if (x !== s.x || z !== s.z) {
        s.x = x;
        s.z = z;
      }
    }
  }

  /** Corrimiento de `o` ({ox, oz}) parado en (x, z) para dejar pasar al jugador, sin meterse en un mueble ni en un muro. */
  _empuje(o, x, z, extra, px, pz, empuja, dt) {
    let tx = 0;
    let tz = 0;
    if (empuja) {
      const a = apartarse(x - px, z - pz, EMPUJE_RADIO + extra, EMPUJE_TOPE, _o);
      if (a.x || a.z) {
        const l = aLocal(this.r, x + a.x, z + a.z, _p);
        if (!ocupado(this.r, l.x, l.z, 0.22, SIN_ZONAS, false)) {
          tx = a.x;
          tz = a.z;
        }
      }
    }
    o.ox = Math.abs(tx - o.ox) < 0.002 ? tx : damp(o.ox, tx, EMPUJE_VEL, dt);
    o.oz = Math.abs(tz - o.oz) < 0.002 ? tz : damp(o.oz, tz, EMPUJE_VEL, dt);
  }

  /** Camina derecho a `C.ir` (el corro o la vuelta a su sitio) y al llegar queda mirando a `yaw` con su baile. */
  _caminar(m, C, dt) {
    const s = m.sim;
    const t = C.ir;
    const dx = t.x - C.bx;
    const dz = t.z - C.bz;
    const d = Math.hypot(dx, dz);
    const paso = CORRO_VEL * dt;
    if (d <= paso) {
      C.bx = t.x;
      C.bz = t.z;
      C.vel = 0;
      C.ir = null;
      C.wT = 1;
      C.estilo = t.estilo;
      s.yaw = t.yaw;
    } else {
      C.bx += (dx / d) * paso;
      C.bz += (dz / d) * paso;
      C.vel = CORRO_VEL;
      C.wT = 0;
      s.yaw += angleDiff(s.yaw, yawFromDir(dx, dz)) * Math.min(1, dt * 10);
    }
    s.x = C.bx;
    s.z = C.bz;
  }

  /** El mesero va de parada en parada por el piso libre, con la bandeja en alto. */
  _mesero(m, C, dt, px, pz) {
    const M = C.mesero;
    const s = m.sim;
    const r = this.r;
    if (M.pausa > 0) {
      M.pausa -= dt;
      C.vel = 0;
      if (M.pausa > 0) return;
      const ps = C.q.paradas;
      if (!ps || ps.length < 2) {
        M.pausa = 60;
        return;
      }
      M.parada = (M.parada + 1 + (ps.length > 2 ? this.rng.int(0, ps.length - 2) : 0)) % ps.length;
      const t = ps[M.parada];
      M.ruta = rutaEntre((this.rej ??= this._piso(r).rej), M.lx, M.lz, t.lx, t.lz);
      M.k = 0;
      if (!M.ruta) M.pausa = 4;
      return;
    }
    const pt = M.ruta?.[M.k];
    if (!pt) {
      M.ruta = null;
      M.pausa = this.rng.range(MESERO_PAUSA[0], MESERO_PAUSA[1]);
      C.vel = 0;
      return;
    }
    const dx = pt.x - M.lx;
    const dz = pt.z - M.lz;
    const d = Math.hypot(dx, dz);
    const wx = r.ux * dx + r.nx * dz;
    const wz = r.uz * dx + r.nz * dz;
    // Con el jugador atravesado, espera.
    if (Math.hypot(px - s.x, pz - s.z) < 0.8 && (px - s.x) * wx + (pz - s.z) * wz > 0) {
      C.vel = 0;
      return;
    }
    const paso = MESERO_VEL * dt;
    if (d <= paso) {
      M.lx = pt.x;
      M.lz = pt.z;
      M.k++;
    } else {
      M.lx += (dx / d) * paso;
      M.lz += (dz / d) * paso;
      s.yaw += angleDiff(s.yaw, yawFromDir(wx, wz)) * Math.min(1, dt * 8);
    }
    const w = aMundo(r, M.lx, M.lz, _w);
    s.x = w.x;
    s.z = w.z;
    C.vel = MESERO_VEL;
  }

  /** En las mesas y la barra: de vez en cuando alguien cambia entre hablar, oír y tomar. */
  _charla() {
    if (!this.gente.length || this.panico) return;
    const C = this.gente[Math.floor(this.rng.next() * this.gente.length)]?.club;
    if (!C?.charla) return;
    const k = this.rng.next();
    C.upper = k < 0.3 ? 'talk' : k < 0.55 ? 'drink' : 'listen';
  }

  // ------------------------------------------------------------ susto
  /** Amenaza del mundo (tiros, explosiones) que alcanza a alguien de adentro: la atiende el local. */
  _amenaza(th) {
    const r = this.r;
    if (!r || th.radius < AMENAZA_RADIO) return true;
    const l = aLocal(r, th.x, th.z, _p);
    const adentro = l.x > r.X0 - 1 && l.x < r.X1 + 1 && l.z > r.Z0 - 1 && l.z < r.Z1 + 0.5;
    if (adentro || Math.hypot(l.x, l.z) < AMENAZA_PUERTA || th.radius >= AMENAZA_EXPLOSION) this._susto();
    return true;
  }

  /** Arma apuntando adentro, y la calma después. */
  _sustos() {
    const g = this.game;
    const p = g.player;
    const armado = p.aiming && !p.dead && (p.inventory?.currentId ?? 'fists') !== 'fists' && g.interiors.inside === this.r;
    if (armado) this._susto();
    if (this.panico && !armado && this.t - this.panicoT > PANICO_CALMA) {
      this.panico = false;
      for (const m of this.gente) {
        const C = m.club;
        if (C.estado === 'agachado' || C.estado === 'cubierto') {
          C.estado = 'normal';
          C.w = 0;
          C.wT = 1;
        }
      }
    }
  }

  /** Susto general: cada quien reacciona con su demora (correr a la puerta, agacharse o cubrirse). */
  _susto() {
    this.panicoT = this.t;
    if (this.panico || !this.r) return;
    this.panico = true;
    this.susto.set(this.r.id, this.t + SUSTO);
    this.corroOn = null;
    this.cola.length = 0;
    const piso = this._piso(this.r);
    this.rej ??= piso.rej;
    this.salida ??= piso.salida ??= salidaDe(this.r, piso.rej);
    // Del mezanine se baja por su escalera (sim/estampida.js) y abajo sigue la salida de todos.
    if (ESTAMPIDA.MEZZ_BAJA && this.r.mezz && !this.bajada) {
      this.bajada = bajadaMezz(this.r);
      const pie = this.bajada?.tramo[1];
      this.extraMezz = pie ? restante(this.salida, { lx: pie.x, lz: pie.z, k: -1 }) : 0;
    }
    if (this.jug.pareja) this.parejaJugador(false);
    for (const m of this.gente) {
      const C = m.club;
      C.demora = this.rng.range(0, PANICO_DEMORA) + (C.q.sentado && ESTAMPIDA.SENTADOS_CORREN ? ESTAMPIDA.LEVANTARSE : 0);
      C.ir = null;
      C.enCorro = false;
    }
  }

  _reaccionar(m, C) {
    const r = this.r;
    const s = m.sim;
    const q = C.q;
    C.upper = null;
    C.vel = 0;
    // Corre la clientela (y los meseros); los que atienden (barra, cabina, tarima, plataformas) se agachan.
    const y = s.elev ?? r.y0;
    const l = aLocal(r, s.x, s.z, _p);
    const cliente = !TRABAJAN.has(q.rol) && (q.panico === 'correr' || (q.sentado && ESTAMPIDA.SENTADOS_CORREN) || q.rol === 'mesero' || q.rol === 'vip');
    const mezz = !!this.bajada && enMezz(r, l.x, l.z, y);
    if (cliente && (Math.abs(y - r.y0) < 0.6 || mezz)) {
      C.estado = 'corre';
      C.e = { lx: l.x, lz: l.z, y, k: -1, carril: this.rng.range(-1, 1), dx: 0, dz: 0, mezz };
      C.velMax = this.rng.range(PANICO_VEL[0], PANICO_VEL[1]);
      C.ax = l.x;
      C.az = l.z;
      C.atasco = 0;
      C.pasa = 0;
      C.ci = -1;
      s.sitting = false;
      if (C.mesero) C.mesero.ruta = null;
    } else if (q.panico === 'cubrirse' && q.sentado) {
      C.estado = 'cubierto';
      C.w = 0;
      C.wT = 1;
    } else {
      C.estado = 'agachado';
      C.wT = 0;
    }
  }

  /** Un paso del que corre a la puerta; true cuando ya salió al andén (sigue huyendo como cualquier peatón). */
  _correr(m, C, dt) {
    const r = this.r;
    const s = m.sim;
    const e = C.e;
    // La cola (sim/estampida.js): frena detrás del que va adelante; si lleva rato trabado, se cuela.
    const K = this.corr;
    let f = 1;
    if (C.pasa > 0) {
      C.pasa -= dt;
      f = ESTAMPIDA.PASA_VEL;
    }
    else if (C.ci >= 0 && C.ci < K.n) f = frenoCola(K.xs, K.ys, K.zs, K.dxs, K.dzs, K.prio, K.n, C.ci);
    if (Math.hypot(e.lx - C.ax, e.lz - C.az) > ESTAMPIDA.ATASCO_MUEVE) {
      C.ax = e.lx;
      C.az = e.lz;
      C.atasco = 0;
    } else if ((C.atasco += dt) > ESTAMPIDA.ATASCO && f < ESTAMPIDA.ATASCO_FRENO) {
      C.atasco = 0;
      C.pasa = ESTAMPIDA.ATASCO_PASA;
    }
    const obj = C.velMax * f;
    C.vel = obj < C.vel ? obj : damp(C.vel, obj, 6, dt);
    C.w = damp(C.w, 0, 10, dt);
    let fin = false;
    if (e.mezz) {
      // Bajando del mezanine: al pie de la escalera sigue por la salida del salón.
      if (pasoSalida(r, this.bajada, e, C.vel * dt)) {
        e.mezz = false;
        e.k = -1;
      }
    } else fin = pasoSalida(r, this.salida, e, C.vel * dt);
    const w = aMundo(r, e.lx, e.lz, _w);
    s.x = w.x;
    s.z = w.z;
    s.elev = e.y;
    if (e.dx || e.dz) s.yaw += angleDiff(s.yaw, yawFromDir(r.ux * e.dx + r.nx * e.dz, r.uz * e.dx + r.nz * e.dz)) * Math.min(1, dt * 12);
    if (!fin) return false;
    this._soltar(m);
    if (m.rig.setShadow === sinSombra) delete m.rig.setShadow;
    s.fixed = false;
    s.sitting = false;
    s.elev = undefined;
    s.mode = 'flee';
    s.fleeFrom = { x: r.ox, z: r.oz };
    s.timer = 10 + this.rng.next() * 6;
    this.cuenta.huyeron++;
    return true;
  }

  /** Posiciones, direcciones y camino restante de los que corren (una vez por cuadro, en los arreglos de this.corr). */
  _cola() {
    const K = this.corr;
    let n = 0;
    for (const m of this.gente) {
      const C = m.club;
      if (C.estado !== 'corre' || n >= K.xs.length) {
        C.ci = -1;
        continue;
      }
      const e = C.e;
      K.xs[n] = e.lx;
      K.zs[n] = e.lz;
      K.ys[n] = e.y;
      K.dxs[n] = e.dx;
      K.dzs[n] = e.dz;
      K.prio[n] = e.mezz ? restante(this.bajada, e, this.extraMezz) : restante(this.salida, e);
      C.ci = n++;
    }
    K.n = n;
  }

  // ------------------------------------------------------------ el corro
  /**
   * Los que bailan cerca del jugador le hacen corro: caminan a un círculo de
   * `radio` m a su alrededor (a lo sumo `max`, los que estén a menos de
   * CORRO_ALCANCE m) y aplauden al compás mirándolo. corro(false) los
   * devuelve a su sitio. Devuelve cuántos vienen.
   */
  corro(on = true, { radio = CORRO_RADIO, max = CORRO_MAX } = {}) {
    const r = this.r;
    const p = this.game.player;
    for (const m of this.gente) {
      const C = m.club;
      if (!C.enCorro) continue;
      C.enCorro = false;
      if (C.estado === 'normal') C.ir = { x: C.hx, z: C.hz, yaw: C.yaw, estilo: C.q.estilo };
    }
    this.corroOn = null;
    if (!on || !r || this.panico) return 0;
    const cand = [];
    for (const m of this.gente) {
      const C = m.club;
      if (C.q.rol !== 'baile' || C.estado !== 'normal' || !C.movil) continue;
      const d = Math.hypot(C.hx - p.x, C.hz - p.z);
      if (d < CORRO_ALCANCE) cand.push({ C, d, a: Math.atan2(C.bx - p.x, C.bz - p.z) });
    }
    cand.sort((a, b) => a.d - b.d);
    cand.length = Math.min(cand.length, max);
    cand.sort((a, b) => a.a - b.a);
    let n = 0;
    cand.forEach((c, i) => {
      // Repartidos parejo en el círculo, en el orden en que ya están alrededor.
      const a = cand[0].a + (i * TAU) / cand.length;
      const x = p.x + Math.sin(a) * radio;
      const z = p.z + Math.cos(a) * radio;
      const l = aLocal(r, x, z, _p);
      if (ocupado(r, l.x, l.z, 0.25, SIN_ZONAS, false)) return;
      c.C.enCorro = true;
      c.C.ir = { x, z, yaw: yawFromDir(p.x - x, p.z - z), estilo: 'aplauso' };
      n++;
    });
    this.corroOn = n ? { x: p.x, z: p.z, radio, n } : null;
    return n;
  }

  // ------------------------------------------------------------ pruebas
  /** Estado para pruebas (__game.clubLife()); con {detalle: true}, cada persona. */
  info({ detalle = false } = {}) {
    const roles = {};
    let sentados = 0;
    let bailando = 0;
    let mujeres = 0;
    let conClip = 0;
    let corriendo = 0;
    let agachados = 0;
    let visibles = 0;
    for (const m of this.gente) {
      const C = m.club;
      const q = C.q;
      roles[q.rol] = (roles[q.rol] ?? 0) + 1;
      if (q.sentado) sentados++;
      if (q.estilo && q.estilo !== 'meneo' && q.rol !== 'vip') bailando++;
      if (q.female) mujeres++;
      if (C.clip) conClip++;
      if (C.estado === 'corre') corriendo++;
      if (C.estado === 'agachado' || C.estado === 'cubierto') agachados++;
      if (m.rig.frame - m.rig.rendered <= 2) visibles++;
    }
    const R = this.ritmo();
    return {
      ...R,
      cupo: this.cupo,
      gente: this.gente.length,
      enCola: this.cola.length,
      reserva: this.reserva.length,
      panico: this.panico,
      corro: this.corroOn ? { ...this.corroOn } : null,
      jugador: this.jug.estilo,
      paso: this.jug.paso,
      pareja: !!this.jug.pareja,
      musica: this.r ? this.musica(this.r.id) : 1,
      roles,
      sentados,
      bailando,
      parejas: this.datos?.unidades.filter((u) => u.tipo === 'pareja').length ?? 0,
      rondas: this.datos?.unidades.filter((u) => u.tipo === 'ronda').length ?? 0,
      mujeres,
      conClip,
      corriendo,
      agachados,
      visibles,
      botellas: this.botellas?.n ?? 0,
      conteo: { ...this.cuenta },
      personas: detalle
        ? this.gente.map((m) => {
            const C = m.club;
            return { i: C.q.i, rol: C.q.rol, estilo: C.estilo, modo: C.modo, estado: C.estado, x: +m.sim.x.toFixed(2), y: +(m.sim.elev ?? 0).toFixed(2), z: +m.sim.z.toFixed(2), yaw: +m.sim.yaw.toFixed(2), sentado: !!C.q.sentado, female: !!C.q.female, w: +C.w.toFixed(2), clip: C.clip, enCorro: C.enCorro, salud: m.health };
          })
        : undefined,
    };
  }
}
