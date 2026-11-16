// Comercios del día a día a los que se entra (v3.8): tiendas de barrio,
// panaderías, droguerías, cacharrerías, papelerías, comidas y los almacenes
// de ropa (sim/interiors.js armarLocal; render/localInteriors.js los dibuja).
// Como los interiores de las discotecas (game/interiors.js): cada uno se
// arma solo con el jugador cerca y se suelta al alejarse (con caché de los
// más recientes); la cortina sube en su horario y baja de noche (la hoja de
// la colisión del vano se quita y se pone); adentro, el tendero o la
// vendedora detrás del mostrador, a veces uno o dos clientes, y con E frente
// al mostrador se abre EL MISMO menú o almacén de ropa de su lugar
// (Game.interact). En los almacenes, frente al espejo, E abre la ropa con la
// cámara mirando al jugador de frente (probarse lo que compra).

import * as THREE from 'three';
import { RUBROS, aLocal, aMundo, abiertoA, dentroInterior, puntoCompra, techoInterior } from '../sim/interiors.js';
import { COMERCIO_FX, LocalFronts, LocalView, brilloComercios } from '../render/localInteriors.js';
import { randomLook } from '../render/characterRig.js';
import { applyOutfit } from '../render/outfit.js';
import { makeRng } from '../sim/rng.js';

// ------------------------------------------------------------------ configurables
/** m: a esta distancia de la puerta se arma el interior (si está abierto). */
const CARGAR = 40;
/** m: más lejos se suelta (salvo los CACHE más recientes). */
const SOLTAR = 55;
/** Interiores que se quedan armados aunque el jugador se aleje (los más recientes). */
const CACHE = 2;
/** m: el interior armado se dibuja desde afuera solo a esta distancia y de frente a la fachada. */
const VER_DESDE_AFUERA = 34;
/** m de la puerta a los que aparece la gente de adentro (y a los que se va). */
const GENTE_CERCA = 14;
const GENTE_LEJOS = 22;
/** Clientes (además del que atiende) por calidad, y la probabilidad de que haya alguno. */
const CLIENTES_POR_CALIDAD = { baja: 0, media: 1, alta: 2, ultra: 2 };
const CLIENTES_PROB = 0.8;
// (Distancias para comprar y probarse con E: sim/interiors.js COMERCIO.RANGO_COMPRA y RANGO_ESPEJO.)
/** s: el que atiende saluda al rato de entrar; la clienta conversa cada tanto (s, entre a y b). */
const SALUDO_DEMORA = 0.7;
const CHARLA_CADA = [11, 19];
const RESPUESTA_DEMORA = 2.8;
/** s que se queda agachada la gente con un susto (tiros cerca). */
const SUSTO = 6;
/** Luz real prestada de los faroles (render/nightLights.js) con el jugador adentro, por calidad; fuerza y alcance (m). */
const LUCES_POR_CALIDAD = { baja: 0, media: 1, alta: 1, ultra: 1 };
const LUZ_FUERZA = 1.4;
const LUZ_ALCANCE = 7.5;
/** De noche, con la cámara adentro y la puerta fuera de cuadro, no se dibuja la ciudad de afuera (de día no: el sol y sus sombras). */
const OCULTAR_AFUERA_NOCHE = true;
/** Cámara adentro: distancia máxima detrás del personaje (m), cuánto sube (m) y margen con muros y techo (m). */
const CAM_DIST = 2.3;
const CAM_SUBE = 0.15;
const CAM_MARGEN = 0.2;
/**
 * Probarse la ropa frente al espejo: la cámara se pone del lado del espejo
 * (m del jugador; el espejo está a 1,35 m), a qué altura y a qué altura mira,
 * cuánto se corre la mira (m) para que el jugador quede a la izquierda del
 * almacén (que va a la derecha: ui/styles.css #shop.espejo) y segundos del giro.
 */
const ESPEJO_CAM = { dist: 1.2, alto: 1.5, mira: 1.25, lado: 0.45, giro: 0.8 };
/** s entre avisos de "cerrado" en la puerta. */
const AVISO_CADA = 6;
/**
 * El vano de la puerta (m, en local): margen a cada lado del ancho y de
 * cuánto adentro a cuánto afuera. Con el jugador ahí ni la cortina ni la hoja
 * de la colisión se cierran encima de él (como en game/interiors.js).
 */
const VANO_MARGEN = 0.45;
const VANO_Z = [-0.7, 0.5];
/**
 * m/s: en carro o moto más rápido que esto no se arma la gente ni el interior
 * de los locales por los que pasa (de lejos se ve el cuarto pintado de LocalFronts).
 */
const GENTE_VEHICULO_VEL = 4;

/** Pinta del que atiende y de los clientes por tema (prendas de sim/ropa.js). */
const PINTAS = {
  tienda: [{ torso: 'camisa-cuadros', piernas: 'pantalon-dril', pies: 'tenis-negros' }, { torso: 'camiseta-gris', piernas: 'jean-azul', pies: 'chanclas' }],
  panaderia: [{ torso: 'camisa-blanca-larga', piernas: 'pantalon-dril', pies: 'tenis-blancos' }],
  comidas: [{ torso: 'camiseta-blanca', piernas: 'jean-negro', pies: 'tenis-negros', cabeza: 'gorra-curva-negra' }],
  drogueria: [{ torso: 'camisa-blanca-larga', piernas: 'jean-azul', pies: 'tenis-blancos' }],
  cacharreria: [{ torso: 'camiseta-roja', piernas: 'jean-azul', pies: 'tenis-negros' }],
  papeleria: [{ torso: 'camisa-rosada', piernas: 'jean-claro', pies: 'tenis-blancos' }],
  almacen: [{ torso: 'camisa-blanca-larga', piernas: 'pantalon-dril', pies: 'alpargatas', cabeza: 'sombrero-aguadeno', hombro: 'poncho-blanco' }],
  almacenModa: [{ torso: 'camiseta-negra', piernas: 'jean-negro', pies: 'tenis-blancos', cuello: 'cadena-plateada' }],
};

const sinSombra = () => {};
const hash = (s) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
};

export class Comercios {
  constructor(game) {
    this.game = game;
    this.list = game.city.locales ?? [];
    this.views = new Map(); // id -> LocalView
    this.used = []; // ids, el más reciente al final
    // open: la cortina arriba; paso: la hoja de la colisión del vano quitada (a pie se entra; en carro o moto, no).
    this.state = this.list.map(() => ({ open: false, paso: false, msgAt: -1e9 }));
    this.inside = null; // comercio donde está el jugador
    this.camInside = null;
    this.t = 0;
    this.hidOutside = false;
    this.lights = [];
    this._shut = this.list.map(() => true);
    this.fronts = this.list.length ? new LocalFronts(this.list) : null;
    if (this.fronts) game.scene.add(this.fronts.group);
    this.gente = null; // {r, peds, tendero, cola, charlaT, respT, saludo}
    this.compra = null; // compra en curso (para el "gracias" del que atiende)
    this.espejo = null; // cámara de probarse la ropa
    this.visitas = 0;
    this.act = { dress: (p, st) => this._dress(p, st), threat: (p) => this._susto(p) };
    this._p = { x: 0, z: 0 };
    this._v = new THREE.Vector3();
    this._frustum = new THREE.Frustum();
    this._pm = new THREE.Matrix4();
    this._virt = new Map();
    this._avisos = { mostrador: false, espejo: false };
  }

  _calidad() {
    return String(this.game.quality?.label ?? 'alta').toLowerCase();
  }

  update(dt) {
    if (!this.list.length) return;
    const g = this.game;
    const p = g.player;
    const cam = g.camera.position;
    this.t += dt;
    const hour = g.env.timeOfDay;
    const prevInside = this.inside;
    this.inside = null;
    this.camInside = null;
    let building = false;
    const lento = !p.inVehicle || p.speed < GENTE_VEHICULO_VEL;
    for (let i = 0; i < this.list.length; i++) {
      const r = this.list[i];
      const st = this.state[i];
      const d = Math.hypot(p.x - r.ox, p.z - r.oz);
      const pin = !p.inVehicle && dentroInterior(r, p.x, p.z, p.y);
      if (pin) this.inside = r;
      if (d < 30 && dentroInterior(r, cam.x, cam.z, cam.y)) this.camInside = r;
      // Puerta: abierta en su horario (o con el jugador adentro, para que salga).
      const abierto = abiertoA(r, hour);
      const want = abierto || pin;
      // (No se cierra encima del jugador parado en el vano.)
      const enVano = d < 6 && this._enVano(r, p);
      if (want !== st.open && (want || !enVano)) this._setDoor(i, r, want);
      // En carro o moto no se entra: la hoja de la colisión se queda puesta (la cortina, arriba).
      const paso = st.open && (pin || !p.inVehicle);
      if (paso !== st.paso && (paso || !enVano)) this._setPaso(i, r, paso);
      this._shut[i] = !st.open;
      if (!st.open && d < 4 && !p.inVehicle && this.t - st.msgAt > AVISO_CADA) {
        st.msgAt = this.t;
        g.hud?.toast?.(`${r.name}: cerrado. Abre a las ${r.horario[0]}:00.`, 2.4);
      }
      // Armar (solo abierto o con el jugador adentro) y tocar.
      let v = this.views.get(r.id);
      if (!v && d < CARGAR && st.open && lento) {
        v = new LocalView(r);
        this.views.set(r.id, v);
        g.scene.add(v.group);
      }
      if (v && !v.ready && !building) {
        building = true;
        v.step(COMERCIO_FX.ARMADO_MS);
      }
      if (v && d < CARGAR) this._touch(r.id);
    }
    // Soltar los lejanos que no están entre los más recientes.
    for (const [id, v] of this.views) {
      const r = v.r;
      if (Math.hypot(p.x - r.ox, p.z - r.oz) <= SOLTAR) continue;
      if (this.used.indexOf(id) >= this.used.length - CACHE && this.used.includes(id)) continue;
      v.dispose();
      this.views.delete(id);
      const k = this.used.indexOf(id);
      if (k >= 0) this.used.splice(k, 1);
    }
    // Entrar: el nombre del local.
    if (this.inside && this.inside !== prevInside) {
      g.hud?.toast?.(`<b>${this.inside.name}</b>`, 2.4);
      this.visitas++;
      if (this.gente?.r === this.inside) this.gente.saludo = this.t + SALUDO_DEMORA;
    }
    // Ver: adentro, o de frente a la fachada y con la cortina arriba.
    for (let i = 0; i < this.list.length; i++) {
      const r = this.list[i];
      const v = this.views.get(r.id);
      if (!v) continue;
      const loc = aLocal(r, cam.x, cam.z, this._p);
      const dc = Math.hypot(cam.x - r.ox, cam.z - r.oz);
      const inCam = this.camInside === r;
      v.group.visible = v.ready && (inCam || (loc.z > -0.3 && dc < VER_DESDE_AFUERA && !this.fronts.cerrada(i)));
    }
    this.fronts?.update(dt, this._shut);
    brilloComercios(COMERCIO_FX.BRILLO_DIA + (COMERCIO_FX.BRILLO_NOCHE - COMERCIO_FX.BRILLO_DIA) * (g.env.night ?? 0));
    this._gente(dt);
    this._avisar();
    this._compraHecha();
    this._luz();
    this._outside();
  }

  _touch(id) {
    if (this.used[this.used.length - 1] === id) return;
    const k = this.used.indexOf(id);
    if (k >= 0) this.used.splice(k, 1);
    this.used.push(id);
  }

  /** La cortina (y con ella la hoja de la colisión). */
  _setDoor(i, r, open) {
    this.state[i].open = open;
    this._setPaso(i, r, open);
  }

  /** La hoja de la colisión del vano: quitada (se pasa) o puesta. */
  _setPaso(i, r, paso) {
    const st = this.state[i];
    if (st.paso === paso) return;
    st.paso = paso;
    const col = this.game.city.collision;
    if (r.doorBox) {
      if (paso) col.remove(r.doorBox);
      else col.restore(r.doorBox);
    }
  }

  /** ¿El jugador está parado en el vano de la puerta de r? */
  _enVano(r, p) {
    const d = r.door;
    const l = aLocal(r, p.x, p.z, this._p);
    return Math.abs(l.x - (d.x0 + d.x1) / 2) < (d.x1 - d.x0) / 2 + VANO_MARGEN && l.z > VANO_Z[0] && l.z < VANO_Z[1];
  }

  // -------------------------------------------------------------- la gente de adentro
  /** El comercio con gente: donde está el jugador o el abierto más cercano (a GENTE_CERCA de la puerta). */
  _activo() {
    const g = this.game;
    const p = g.player;
    if (this.inside) return this.inside;
    const cur = this.gente?.r;
    if (cur && Math.hypot(p.x - cur.ox, p.z - cur.oz) < GENTE_LEJOS && abiertoA(cur, g.env.timeOfDay)) return cur;
    // (Pasando en carro o moto no se arma la gente de cada local de la cuadra.)
    if (p.inVehicle && p.speed >= GENTE_VEHICULO_VEL) return null;
    let best = null;
    let bd = GENTE_CERCA;
    for (const r of this.list) {
      const d = Math.hypot(p.x - r.ox, p.z - r.oz);
      if (d < bd && abiertoA(r, g.env.timeOfDay)) {
        bd = d;
        best = r;
      }
    }
    return best;
  }

  _gente(dt) {
    const g = this.game;
    if (!g.world) return;
    const r = g.player.dead ? null : this._activo();
    if (this.gente && this.gente.r !== r) this._soltarGente();
    if (!r) return;
    if (!this.gente) this.gente = this._repartir(r);
    const G = this.gente;
    // Uno por cuadro (cada muñeco nuevo cuesta).
    if (G.cola.length) this._crear(G, G.cola.shift());
    // Saludo al entrar, conversa de la clienta y la respuesta del que atiende.
    const dlg = g.dialogue;
    const label = G.label;
    if (G.tendero?.alive && this.inside === r && G.saludo > 0 && this.t >= G.saludo) {
      G.saludo = 0;
      if (dlg?.speak(G.tendero, r.tema === 'almacen' ? 'vendedora' : 'tendero', { label })) G.tendero.rig.play('wave', { fadeIn: 0.25 });
    }
    // (La que conversa se guarda al crearla; solo si se murió se busca otra.)
    if (G.charla && !G.charla.alive) G.charla = G.peds.find((m) => m.alive && m._rol === 'charla') ?? null;
    const charla = G.charla;
    if (charla && G.tendero?.alive && this.t >= G.charlaT) {
      G.charlaT = this.t + G.rng.range(CHARLA_CADA[0], CHARLA_CADA[1]);
      if (dlg?.speak(charla, 'clienta', { label: charla.look?.female ? 'Clienta' : 'Cliente' })) G.respT = this.t + RESPUESTA_DEMORA;
    }
    if (G.respT > 0 && this.t >= G.respT) {
      G.respT = 0;
      if (G.tendero?.alive) dlg?.speak(G.tendero, 'tendero_charla', { label });
    }
    for (const m of G.peds) if (m._susto > 0) m._susto -= dt;
  }

  /** Quién va a estar: el que atiende y, a veces, uno o dos clientes (por calidad). */
  _repartir(r) {
    const rng = makeRng((hash(r.id) + this.visitas * 7919) >>> 0 || 1);
    const cola = [];
    const t = r.spots.tendero[0];
    const femTendero = r.tema === 'almacen' ? true : hash(r.id) % 3 === 0;
    if (t) cola.push({ ...t, rol: 'tendero', female: femTendero });
    const cupo = CLIENTES_POR_CALIDAD[this._calidad()] ?? 1;
    if (cupo > 0 && rng.chance(CLIENTES_PROB)) {
      const n = rng.int(1, cupo);
      const orden = ['compra', 'charla', 'espera', 'mesa', 'mira', 'barra'];
      const spots = [...r.spots.clientes].sort((a, b) => orden.indexOf(a.rol) - orden.indexOf(b.rol));
      // (El que compra o la que espera primero; si no, cualquiera.)
      for (const s of spots.slice(0, n)) cola.push({ ...s, female: s.female ?? rng.chance(0.4) });
    }
    const label = r.tema === 'almacen' ? 'Vendedora' : femTendero ? 'Tendera' : 'Tendero';
    return { r, cola, peds: [], tendero: null, charla: null, rng, label, saludo: this.inside === r ? this.t + SALUDO_DEMORA : 0, charlaT: this.t + rng.range(4, 8), respT: 0 };
  }

  _look(female, rng) {
    let look = randomLook(rng, 'civil');
    for (let k = 0; k < 8 && !!look.female !== female; k++) look = randomLook(rng, 'civil');
    return look;
  }

  _crear(G, q) {
    const g = this.game;
    const r = G.r;
    const m = g.world.spawnPedAt(q.x, q.z, { outfit: 'civil', health: 80, look: this._look(!!q.female, G.rng) });
    const s = m.sim;
    s.x = q.x;
    s.z = q.z;
    s.yaw = q.yaw + Math.PI; // (los puntos miran hacia (sin, cos); el peatón hacia (-sin, -cos): sim/math.js yawFromDir)
    s.fixed = true;
    s.mode = 'idle';
    s.speed = 0;
    s.timer = Infinity;
    s.sitting = !!q.sit;
    s.elev = q.y;
    m.act = this.act;
    m.walkStyle = null;
    m.idleClip = null;
    m.fixedActivity = null;
    m.activity = null;
    m.comercio = r.id;
    m._rol = q.rol;
    m._label = q.rol === 'tendero' ? G.label : null; // (rótulo de sus frases: game/dialogue.js)
    m._susto = 0;
    m.rig.setShadow(false);
    m.rig.setShadow = sinSombra;
    const pintas = q.rol === 'tendero' ? PINTAS[r.tema === 'almacen' && (r.variante === 'moda' || r.variante === 'deportes') ? 'almacenModa' : r.tema] : null;
    if (pintas) applyOutfit(m.rig, pintas[hash(r.id) % pintas.length]);
    G.peds.push(m);
    if (q.rol === 'tendero') G.tendero = m;
    else if (q.rol === 'charla' && !G.charla?.alive) G.charla = m;
  }

  _soltarGente() {
    const G = this.gente;
    this.gente = null;
    if (!G) return;
    const w = this.game.world;
    for (const m of G.peds) {
      if (m.act === this.act) m.act = null;
      if (m.rig.setShadow === sinSombra) delete m.rig.setShadow;
      if (m.alive && w.peds.includes(m)) w.removePed(m);
    }
  }

  /** Lo que el mundo le pregunta a la gente de adentro cada cuadro: agachados con un susto. */
  _dress(m, st) {
    if (m._susto > 0) {
      st.crouching = true;
      st.driving = null;
    }
  }

  /** Tiros cerca: se agachan detrás del mostrador (no salen corriendo a la calle). */
  _susto(m) {
    m._susto = SUSTO;
    return true;
  }

  // -------------------------------------------------------------- comprar y probarse
  /** El lugar de la compra: el mismo de afuera (con su menú, encargo o surtido) o uno propio con el menú del tema. */
  _poi(r) {
    if (r.poi) {
      const p = this.game.city.pois.find((q) => q.id === r.poi);
      if (p) return p;
    }
    let p = this._virt.get(r.id);
    if (!p) {
      const w = aMundo(r, (r.door.x0 + r.door.x1) / 2, 1.2);
      p = { id: r.id, name: r.name, type: r.store ? 'ropa' : 'food', menu: r.store ? undefined : (r.menu ?? []), store: r.store ?? undefined, kicker: RUBROS[r.tema], x: w.x, z: w.z, radius: 0, comercio: true };
      this._virt.set(r.id, p);
    }
    return p;
  }

  /** Avisos de la tecla E al arrimarse al mostrador o al espejo (una vez por arrimada). */
  _avisar() {
    const r = this.inside;
    const p = this.game.player;
    const q = r ? puntoCompra(r, p.x, p.z) : null;
    const m = q === 'mostrador';
    const e = q === 'espejo';
    const hud = this.game.hud;
    if (m && !this._avisos.mostrador) hud?.help?.('Presiona <kbd>E</kbd> para comprar', 4);
    if (e && !this._avisos.espejo) hud?.help?.('Presiona <kbd>E</kbd> para probarte la ropa frente al espejo', 4);
    this._avisos.mostrador = m;
    this._avisos.espejo = e;
  }

  /** E adentro: frente al espejo, a probarse; frente al mostrador, a comprar (sim/interiors.js puntoCompra). Devuelve true si atendió la tecla. */
  interact() {
    const r = this.inside;
    const p = this.game.player;
    if (!r || p.dead || p.inVehicle) return false;
    const q = puntoCompra(r, p.x, p.z);
    if (q === 'espejo') this.probarse(r);
    else if (q === 'mostrador') this._comprar(r);
    return !!q;
  }

  _comprar(r) {
    const g = this.game;
    const p = g.player;
    this.compra = { r, plata: p.money, t: this.t };
    g.interact(this._poi(r));
    // (Si no se abrió la tienda, nada que agradecer.)
    if (g.state !== 'shop') this.compra = null;
  }

  /** De vuelta al juego después de comprar: el que atiende da las gracias. */
  _compraHecha() {
    const c = this.compra;
    const g = this.game;
    if (!c || g.state === 'shop') return;
    this.compra = null;
    this.espejo = null;
    const gastó = g.player.money < c.plata;
    const t = this.gente?.r === c.r ? this.gente.tendero : null;
    if (gastó && t?.alive) {
      g.dialogue?.speak(t, 'tendero_gracias', { label: this.gente.label });
      t.rig.play('nod', { fadeIn: 0.25 });
    }
  }

  /** Probarse la ropa: el jugador mira al espejo y la cámara gira hasta verlo de frente; se abre el almacén. */
  probarse(r = this.inside) {
    const g = this.game;
    const p = g.player;
    const esp = r?.spots.espejo[0];
    if (!esp) return false;
    // Mirando al espejo, en su sitio.
    p.state.yaw = esp.yaw + Math.PI;
    if (p.rig?.root) p.rig.root.rotation.y = p.state.yaw;
    const fx = Math.sin(esp.yaw);
    const fz = Math.cos(esp.yaw);
    const cam = g.camera;
    const to = new THREE.Vector3(p.x + fx * ESPEJO_CAM.dist, p.y + ESPEJO_CAM.alto, p.z + fz * ESPEJO_CAM.dist);
    // (La derecha de la cámara que mira al jugador es (fz, -fx): la mira se corre hacia allá.)
    const look = new THREE.Vector3(p.x + fz * ESPEJO_CAM.lado, p.y + ESPEJO_CAM.mira, p.z - fx * ESPEJO_CAM.lado);
    const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(to, look, new THREE.Vector3(0, 1, 0)));
    this.espejo = { from: cam.position.clone(), fromQ: cam.quaternion.clone(), to, toQ: q, t: 0 };
    this._comprar(r);
    if (!this.compra) this.espejo = null; // (no se abrió el almacén)
    const t = this.gente?.r === r ? this.gente.tendero : null;
    if (t?.alive) g.dialogue?.speak(t, 'vendedora_espejo', { label: this.gente.label });
    return true;
  }

  /** Con la tienda abierta (Game.frame en estado 'shop'): el giro de la cámara del espejo. */
  updateShopCam(dt) {
    const e = this.espejo;
    if (!e) return;
    e.t = Math.min(1, e.t + dt / ESPEJO_CAM.giro);
    const k = e.t * e.t * (3 - 2 * e.t);
    const cam = this.game.camera;
    cam.position.lerpVectors(e.from, e.to, k);
    cam.quaternion.slerpQuaternions(e.fromQ, e.toQ, k);
    cam.updateMatrixWorld();
  }

  // -------------------------------------------------------------- luz, cámara y afuera
  /** Una luz real prestada sobre el salón con el jugador adentro (la gente y el jugador se alumbran). */
  _luz() {
    const g = this.game;
    const nl = g.nightLights;
    if (!nl?.lend) return;
    if (g.interiors?.inside) return; // (la discoteca manda)
    const r = this.inside;
    const v = r ? this.views.get(r.id) : null;
    const want = v?.ready ? LUCES_POR_CALIDAD[this._calidad()] ?? 1 : 0;
    // Solo al cambiar (entrar, salir, otro local): las prestadas no las toca nadie más.
    const key = want ? `${r.id}:${want}` : null;
    if (key === (this._luzKey ?? null)) return;
    this._luzKey = key;
    this.lights = nl.lend(want);
    if (!want) {
      this.lights = [];
      return;
    }
    const s = v.lightSpot;
    const w = aMundo(r, s.x, s.z);
    for (const l of this.lights) {
      l.position.set(w.x, s.y, w.z);
      l.color.setRGB(1, 0.98, 0.94);
      l.distance = LUZ_ALCANCE;
      l.intensity = LUZ_FUERZA;
    }
  }

  /** De noche, con la cámara adentro y la puerta fuera de cuadro, la ciudad de afuera no se dibuja. */
  _outside() {
    const g = this.game;
    let hide = false;
    const r = this.camInside;
    if (OCULTAR_AFUERA_NOCHE && r && (g.env.night ?? 0) > 0.6 && this.views.get(r.id)?.ready && !g.interiors?.camInside) {
      const cam = g.camera;
      cam.updateMatrixWorld();
      this._pm.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
      this._frustum.setFromProjectionMatrix(this._pm);
      const d = r.door;
      let seen = false;
      // Las esquinas y el centro del vano (sin arreglos nuevos por cuadro).
      for (let k = 0; k < 5 && !seen; k++) {
        const lx = k === 4 ? (d.x0 + d.x1) / 2 : k % 2 ? d.x1 : d.x0;
        const y = r.floorY + (k === 4 ? d.h / 2 : k >= 2 ? d.h : 0);
        const w = aMundo(r, lx, 0.05, this._p);
        seen = this._frustum.containsPoint(this._v.set(w.x, y, w.z));
      }
      const loc = aLocal(r, cam.position.x, cam.position.z, this._p);
      hide = !seen && loc.z < -1.2;
    }
    if (hide !== this.hidOutside) {
      this.hidOutside = hide;
      if (g.cityRenderer?.root) g.cityRenderer.root.visible = !hide;
      if (g.horizon?.group) g.horizon.group.visible = !hide;
    }
  }

  /** Límites para la cámara (game/cameraRig.js) con el jugador adentro: más cerca y sin salirse del local. */
  cameraHint() {
    const r = this.inside;
    if (!r) return null;
    const p = this.game.player;
    const loc = aLocal(r, p.x, p.z, this._p);
    if (loc.z > -0.9) return null;
    return (this._hint ??= {
      maxDist: CAM_DIST,
      lift: CAM_SUBE,
      clamp: (pos) => {
        const q = this.inside;
        if (!q) return;
        const l = aLocal(q, pos.x, pos.z, this._p);
        const m = CAM_MARGEN;
        const lx = Math.min(q.X1 - m, Math.max(q.X0 + m, l.x));
        const lz = Math.min(q.Z1 - m, Math.max(q.Z0 + m, l.z));
        if (lx !== l.x || lz !== l.z) {
          const w = aMundo(q, lx, lz);
          pos.x = w.x;
          pos.z = w.z;
        }
        const top = techoInterior(q, lx, lz, pos.y) - m;
        if (pos.y > top) pos.y = Math.max(top, this.game.player.y + 0.4);
      },
    });
  }

  // -------------------------------------------------------------- pruebas
  /** Para pruebas (__game.comercios()). */
  info() {
    const h = this.game.env.timeOfDay;
    return {
      dentro: this.inside?.id ?? null,
      camaraDentro: this.camInside?.id ?? null,
      afueraOculto: this.hidOutside,
      armados: [...this.views.values()].filter((v) => v.ready).map((v) => v.r.id),
      gente: this.gente ? { local: this.gente.r.id, personas: this.gente.peds.filter((m) => m.alive).length, roles: this.gente.peds.map((m) => m._rol), pendientes: this.gente.cola.length } : null,
      luces: this.lights.length,
      locales: this.list.map((r, i) => {
        const afuera = aMundo(r, (r.door.x0 + r.door.x1) / 2, 1.4);
        const adentro = aMundo(r, (r.door.x0 + r.door.x1) / 2, r.Z1 - 1.0);
        const m = r.spots.mostrador[0];
        const e = r.spots.espejo[0];
        return {
          id: r.id,
          name: r.name,
          tema: r.tema,
          variante: r.variante,
          horario: r.horario,
          abierto: abiertoA(r, h),
          puertaAbierta: this.state[i].open,
          pasoLibre: this.state[i].paso,
          cortina: this.fronts ? +this.fronts.state[i].k.toFixed(2) : null,
          ancho: +r.W.toFixed(2),
          fondo: +r.D.toFixed(2),
          piso: +r.y0.toFixed(3),
          afuera: { x: +afuera.x.toFixed(2), z: +afuera.z.toFixed(2) },
          adentro: { x: +adentro.x.toFixed(2), z: +adentro.z.toFixed(2) },
          yawAdentro: +Math.atan2(r.nx, r.nz).toFixed(3),
          mostrador: m ? { x: +m.x.toFixed(2), z: +m.z.toFixed(2), yaw: +m.yaw.toFixed(3) } : null,
          espejo: e ? { x: +e.x.toFixed(2), z: +e.z.toFixed(2), yaw: +e.yaw.toFixed(3) } : null,
          poi: r.poi,
          armado: !!this.views.get(r.id)?.ready,
          visible: !!this.views.get(r.id)?.group.visible,
          items: r.items.length,
        };
      }),
    };
  }

  /** Pruebas: arma el local `id` de una y devuelve dónde pararse adentro (mirando hacia el fondo). */
  enter(id) {
    const i = this.list.findIndex((r) => r.id === id);
    if (i < 0) return false;
    const r = this.list[i];
    this._setDoor(i, r, true);
    let v = this.views.get(r.id);
    if (!v) {
      v = new LocalView(r);
      this.views.set(r.id, v);
      this.game.scene.add(v.group);
    }
    v.buildNow();
    this._touch(r.id);
    const w = aMundo(r, (r.door.x0 + r.door.x1) / 2, r.Z1 - 1.0);
    return { x: w.x, z: w.z, yaw: Math.atan2(r.nx, r.nz), y: r.y0 };
  }

  /** Pruebas: llena de una la gente del comercio activo (sin esperar un cuadro por muñeco). */
  llenar() {
    const G = this.gente;
    while (G?.cola.length) this._crear(G, G.cola.shift());
    return G ? G.peds.length : 0;
  }
}
