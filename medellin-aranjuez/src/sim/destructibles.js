// Utilería que se puede tumbar con un vehículo: postes de energía, faroles,
// placas de nomenclatura y árboles. Lógica pura (sin three):
//  - un registro que casa cada caja de colisión con su objeto (en O(1) desde
//    el choque, por el id de la caja) y guarda el enlace a su instancia del
//    dibujo (`inst`, lo pone render/destructibles.js);
//  - quién tumba qué y a qué velocidad (umbrales por tipo);
//  - la caída: gira sobre la base hacia el lado del golpe, rebota corto y
//    queda en el piso (o recostada contra una pared); la base se arrastra un
//    poco y el objeto se tuerce;
//  - la reposición: un rato después, lejos del jugador y fuera de su vista,
//    vuelve a quedar de pie con su colisionador.
// La ciudad no cambia: el registro se arma al empezar el juego a partir de
// city.props y city.collision, sin escribir nada en ellos.

// ------------------------------------------------------------------ ajustes
/** Velocidad mínima (m/s) con la que cualquier vehículo (carro o moto) tumba postes, faroles y placas. */
export const VEL_TUMBA_POSTE = 6;
/** Velocidad mínima (m/s) con la que un CARRO tumba un árbol (las motos nunca los tumban). */
export const VEL_TUMBA_ARBOL = 9;
/** Árboles con escala (prop.scale) desde este valor no se caen: son muy grandes. */
export const ARBOL_ESCALA_FIRME = 1.3;
/** Especies gigantes que nunca se caen, sea cual sea su escala. */
export const ARBOLES_FIRMES = ['ceiba', 'saman', 'palmaReal'];
/** Árboles que, ya dibujados, miden desde esta altura (m) tampoco se caen. */
export const ARBOL_ALTO_FIRME = 13;
/** Masa (kg) de referencia: un vehículo más pesado pierde proporcionalmente menos velocidad. */
export const MASA_REF = 1200;
/** Máximo de objetos cayendo a la vez (si llega otro, el más viejo se asienta de una). */
export const MAX_CAYENDO = 8;
/** Segundos mínimos que un objeto queda tumbado antes de poder reponerse. */
export const TIEMPO_TUMBADO = 45;
/** Distancia mínima (m) al jugador para reponer un objeto tumbado (y además fuera de la vista). */
export const DIST_REPONER = 70;
/** Cada cuánto (s) se revisan los tumbados para reponerlos (no hace falta en cada cuadro). */
export const REVISAR_CADA = 0.5;
/** Gravedad (m/s²) de la caída; más alta = cae más rápido. */
export const GRAVEDAD_CAIDA = 9.8;
/** Giro inicial (rad/s) por cada m/s del vehículo, y su tope; lo multiplica `empuje` del tipo. */
export const GIRO_POR_VEL = 0.09;
export const GIRO_MAX = 2.4;
/** Rebote al tocar el piso: fracción del giro que devuelve, giro mínimo para rebotar y rebotes máximos. */
export const REBOTE = 0.28;
export const REBOTE_MIN = 0.5;
export const MAX_REBOTES = 2;
/** Fracción de la velocidad del vehículo con la que se arrastra la base y su frenado (m/s²). */
export const ARRASTRE_BASE = 0.25;
export const FRENO_BASE = 4;
/** Torcida (giro sobre su eje) por m/s del vehículo, tope (rad/s) y frenado (1/s). */
export const TORCIDA_POR_VEL = 0.05;
export const TORCIDA_MAX = 0.9;
export const TORCIDA_FRENO = 2.5;
/** Ángulo mínimo (rad) de la caída cuando una pared lo detiene (queda recostado). */
export const RECOSTADO_MIN = 0.3;

/**
 * Tipos que se tumban (prop.type → ajustes). h: altura (m, para la caída;
 * los árboles la multiplican por su escala), perdida: fracción de la
 * velocidad que pierde el vehículo al tumbarlo (no se frena en seco),
 * empuje: cuánto del golpe se vuelve giro, arrastre: cuánto se arrastra la
 * base, reposo: cuánto le falta para quedar acostado (grosor, copa), luz:
 * el farol se apaga, material: sonido y efectos ('metal' o 'madera').
 */
export const TUMBABLES = {
  pole: { h: 9, minVel: VEL_TUMBA_POSTE, soloCarro: false, perdida: 0.25, empuje: 0.8, arrastre: 0.6, reposo: 0.02, material: 'metal' },
  lamp: { h: 7.5, minVel: VEL_TUMBA_POSTE, soloCarro: false, perdida: 0.18, empuje: 1, arrastre: 0.8, reposo: 0.03, luz: true, material: 'metal' },
  parkLamp: { h: 4.4, minVel: VEL_TUMBA_POSTE, soloCarro: false, perdida: 0.12, empuje: 1.1, arrastre: 1, reposo: 0.03, luz: true, material: 'metal' },
  streetSign: { h: 2.9, minVel: VEL_TUMBA_POSTE, soloCarro: false, perdida: 0.06, empuje: 1.4, arrastre: 1.2, reposo: 0.02, material: 'metal' },
  tree: { h: 8, minVel: VEL_TUMBA_ARBOL, soloCarro: true, perdida: 0.35, empuje: 0.55, arrastre: 0, reposo: 0.32, material: 'madera' },
};

// Estados de un objeto.
export const DE_PIE = 0;
export const CAYENDO = 1;
export const TUMBADO = 2;

// Paredes contra las que un objeto que cae se queda recostado.
const PAREDES = new Set(['building', 'metro', 'discoteca', 'tienda']);
const MAX_EVENTOS = 24;
const MAX_CAMBIADOS = 64;
const PASO = 1 / 60; // subpaso de la caída (con cuadros largos)

/**
 * Velocidad mínima para que un vehículo (dosRuedas = moto) tumbe un objeto
 * de tipo `tipo`; Infinity si nunca lo tumba (moto contra árbol, árbol muy
 * grande o tipo que no se tumba).
 */
export function velocidadParaTumbar(tipo, { dosRuedas = false, escala = 1, especie = null } = {}) {
  const cfg = TUMBABLES[tipo];
  if (!cfg) return Infinity;
  if (cfg.soloCarro && dosRuedas) return Infinity;
  if (tipo === 'tree' && (escala >= ARBOL_ESCALA_FIRME || ARBOLES_FIRMES.includes(especie))) return Infinity;
  return cfg.minVel;
}

/** Fracción de la velocidad que conserva un vehículo de `masa` kg al tumbar un objeto del tipo. */
export function velocidadQueQueda(tipo, masa = MASA_REF) {
  const cfg = TUMBABLES[tipo];
  if (!cfg) return 1;
  return 1 - cfg.perdida * Math.min(1, MASA_REF / Math.max(1, masa || MASA_REF));
}

const clave = (tipo, x, z) => `${tipo}|${Math.round(x * 1000)}|${Math.round(z * 1000)}`;

class Entrada {
  constructor(prop, box, cfg) {
    this.prop = prop;
    this.box = box;
    this.tipo = prop.type;
    this.cfg = cfg;
    this.h = prop.type === 'tree' ? cfg.h * (prop.scale ?? 1) : (prop.h ?? cfg.h);
    this.minCarro = velocidadParaTumbar(prop.type, { dosRuedas: false, escala: prop.scale ?? 1, especie: prop.kind ?? null });
    this.minMoto = velocidadParaTumbar(prop.type, { dosRuedas: true, escala: prop.scale ?? 1, especie: prop.kind ?? null });
    this.estado = DE_PIE;
    this.ang = 0; // inclinación desde la vertical (rad)
    this.vAng = 0;
    this.dirX = 0; // hacia dónde cae (unitario en XZ)
    this.dirZ = 1;
    this.giro = 0; // torcida sobre su propio eje (rad)
    this.vGiro = 0;
    this.desliz = 0; // cuánto se arrastró la base (m, en la dirección de la caída)
    this.vDesliz = 0;
    this.dy = 0; // cambio de altura de la base al arrastrarse
    this.reposo = Math.PI / 2;
    this.t = 0; // segundos tumbado
    this.rebotes = 0;
    this.porJugador = false;
    this.inst = null; // enlace con su instancia del dibujo (render/destructibles.js)
  }
}

export class Destructibles {
  /**
   * city: {props, collision} (la ciudad generada). groundHeight(x, z): altura
   * del piso (para la pendiente y la base arrastrada).
   */
  constructor(city, { groundHeight = () => 0 } = {}) {
    this.collision = city.collision;
    this.ground = groundHeight;
    this.entries = [];
    // Caja (por su id) → índice de la entrada, o -1.
    this.byBox = new Int32Array(this.collision.boxes.length).fill(-1);
    // Utilería por su posición exacta (en milímetros) para casarla con su caja:
    // addPropCollider (sim/cityLayout.js) la centra en (p.x, p.z) con kind = p.type.
    const porLugar = new Map();
    for (const p of city.props) {
      if (!p.collider || !TUMBABLES[p.type]) continue;
      const k = clave(p.type, p.x, p.z);
      const l = porLugar.get(k);
      if (l) l.push(p);
      else porLugar.set(k, [p]);
    }
    for (const b of this.collision.boxes) {
      const cfg = TUMBABLES[b.kind];
      if (!cfg || b.obb) continue;
      const l = porLugar.get(clave(b.kind, (b.minX + b.maxX) / 2, (b.minZ + b.maxZ) / 2));
      const p = l?.shift();
      if (!p) continue;
      this.byBox[b.id] = this.entries.length;
      this.entries.push(new Entrada(p, b, cfg));
    }
    this.cayendo = new Array(MAX_CAYENDO).fill(null);
    this.nCayendo = 0;
    this.tumbados = [];
    // Entradas cuya pose cambió en este paso (el dibujo solo toca esas).
    this.cambiados = new Array(MAX_CAMBIADOS).fill(null);
    this.nCambiados = 0;
    // Eventos para sonido, efectos y cámara (los lee el juego y los vacía).
    this.eventos = Array.from({ length: MAX_EVENTOS }, () => ({ tipo: '', e: null, x: 0, y: 0, z: 0, fuerza: 0 }));
    this.nEventos = 0;
    this._reloj = 0;
    this.total = 0; // tumbados desde que empezó el juego
  }

  /** Entrada de una caja de colisión (O(1)), o null. */
  entryOf(box) {
    const i = box && box.id < this.byBox.length ? this.byBox[box.id] : -1;
    return i >= 0 && this.entries[i].box === box ? this.entries[i] : null;
  }

  /**
   * Enlaza una entrada con su instancia del dibujo (render/destructibles.js).
   * h: altura real del objeto dibujado (m), si se conoce: ajusta la caída y,
   * en los árboles, los que llegan a ARBOL_ALTO_FIRME quedan firmes.
   */
  enlazar(e, inst, h = 0) {
    e.inst = inst;
    if (h > 0) e.h = h;
    if (e.tipo === 'tree' && e.h >= ARBOL_ALTO_FIRME) e.minCarro = e.minMoto = Infinity;
  }

  /** Las entradas sin dibujo (sin `inst`) quedan firmes: no se tumban sin verse caer. */
  fijarSinDibujo() {
    let n = 0;
    for (const e of this.entries) {
      if (e.inst) continue;
      e.minCarro = e.minMoto = Infinity;
      n++;
    }
    return n;
  }

  /**
   * Choque de un vehículo contra la caja `box` (lo llama sim/vehiclePhysics.js
   * con el resultado del SAT: res.nx/nz empuja el vehículo fuera de la caja).
   * Si la tumba: quita su colisionador, le baja la velocidad al vehículo y
   * devuelve true (el choque no rebota). Si no, false (choque normal).
   */
  golpe(box, v, res, porJugador = false) {
    const e = this.entryOf(box);
    if (!e || e.estado !== DE_PIE) return false;
    const vel = Math.hypot(v.vx, v.vz);
    if (vel < (v.spec?.twoWheels ? e.minMoto : e.minCarro)) return false;
    // Que vaya hacia el objeto, no saliendo de un roce.
    if (v.vx * res.nx + v.vz * res.nz >= 0) return false;
    // Cae hacia donde va el vehículo, corrido hacia el lado por donde lo tocó.
    let dx = (v.vx / vel) * 0.65 - res.nx * 0.35;
    let dz = (v.vz / vel) * 0.65 - res.nz * 0.35;
    const l = Math.hypot(dx, dz) || 1;
    dx /= l;
    dz /= l;
    // Se tuerce según el lado del vehículo que lo golpeó.
    const lado = Math.sign(dx * (e.prop.z - v.z) - dz * (e.prop.x - v.x)) || 1;
    this.tumbar(e, dx, dz, vel, lado, porJugador);
    const k = velocidadQueQueda(e.tipo, v.spec?.mass);
    v.vx *= k;
    v.vz *= k;
    return true;
  }

  /** Tumba una entrada hacia (dx, dz) como si la golpearan a `vel` m/s. */
  tumbar(e, dx, dz, vel, lado = 1, porJugador = false) {
    if (e.estado !== DE_PIE) return false;
    if (this.nCayendo >= MAX_CAYENDO) this._asentar(this.cayendo[0], 0);
    this.collision.remove(e.box);
    const cfg = e.cfg;
    e.estado = CAYENDO;
    e.dirX = dx;
    e.dirZ = dz;
    e.ang = 0.02;
    e.vAng = Math.min(GIRO_MAX, vel * GIRO_POR_VEL * cfg.empuje);
    e.vDesliz = vel * ARRASTRE_BASE * cfg.arrastre;
    e.desliz = 0;
    e.dy = 0;
    e.vGiro = lado * Math.min(TORCIDA_MAX, vel * TORCIDA_POR_VEL);
    e.giro = 0;
    e.rebotes = 0;
    e.t = 0;
    e.porJugador = porJugador;
    e.reposo = this._reposo(e);
    if (e.reposo < Math.PI / 2 - 0.4) e.vDesliz = 0; // contra una pared: la base no se arrastra
    this.cayendo[this.nCayendo++] = e;
    this.total++;
    this._marcar(e);
    const g0 = this.ground(e.prop.x, e.prop.z);
    this._evento('golpe', e, e.prop.x, g0 + 0.8, e.prop.z, vel);
    return true;
  }

  /** Ángulo final de la caída: acostado según la pendiente o recostado contra una pared. */
  _reposo(e) {
    const { x, z } = e.prop;
    const h = e.h;
    const g0 = this.ground(x, z);
    const dy = this.ground(x + e.dirX * h, z + e.dirZ * h) - g0;
    let r = Math.PI / 2 - Math.atan2(dy, h) - e.cfg.reposo;
    const hit = this.collision.raycast(x, g0 + 1.2, z, e.dirX, 0, e.dirZ, h);
    if (hit && PAREDES.has(hit.box.kind) && hit.t > 0) r = Math.min(r, Math.max(RECOSTADO_MIN, Math.asin(Math.min(1, (hit.t + 0.1) / h))));
    return r;
  }

  /**
   * Avanza las caídas y repone lo que lleva rato tumbado lejos del jugador
   * (px, pz) y fuera de su vista: visto(x, y, z, r) → true si la esfera se ve.
   * Lo que cambia queda en `cambiados` (y lo que suena en `eventos`) hasta
   * que quien lo dibuja llama limpiarCambios() / limpiarEventos().
   */
  update(dt, px, pz, visto = null) {
    for (let k = 0; k < this.nCayendo; ) {
      const e = this.cayendo[k];
      if (this._caer(e, dt)) this._asentar(e, k);
      else {
        this._marcar(e);
        k++;
      }
    }
    if (!this.tumbados.length) return;
    this._reloj += dt;
    if (this._reloj < REVISAR_CADA) return;
    const paso = this._reloj;
    this._reloj = 0;
    const d2 = DIST_REPONER * DIST_REPONER;
    for (let k = this.tumbados.length - 1; k >= 0; k--) {
      const e = this.tumbados[k];
      e.t += paso;
      if (e.t < TIEMPO_TUMBADO) continue;
      const dx = e.prop.x - px;
      const dz = e.prop.z - pz;
      if (dx * dx + dz * dz < d2) continue;
      if (visto && visto(e.prop.x, this.ground(e.prop.x, e.prop.z) + e.h * 0.4, e.prop.z, e.h + e.desliz)) continue;
      this.reponer(e);
    }
  }

  /** Vuelve a poner de pie una entrada tumbada, con su colisionador. */
  reponer(e) {
    if (e.estado === DE_PIE) return false;
    if (e.estado === CAYENDO) {
      const k = this.cayendo.indexOf(e);
      if (k >= 0 && k < this.nCayendo) this._quitarCayendo(k);
    } else {
      const k = this.tumbados.indexOf(e);
      if (k >= 0) {
        this.tumbados[k] = this.tumbados[this.tumbados.length - 1];
        this.tumbados.pop();
      }
    }
    this.collision.restore(e.box);
    e.estado = DE_PIE;
    e.ang = e.vAng = e.giro = e.vGiro = e.desliz = e.vDesliz = e.dy = 0;
    e.t = 0;
    this._marcar(e);
    return true;
  }

  /** Un subpaso de la caída; true cuando quedó quieta en el piso. */
  _caer(e, dt) {
    const k = (1.5 * GRAVEDAD_CAIDA) / e.h; // varilla que gira sobre su base: 3g/2L
    for (let left = dt; left > 1e-6; left -= PASO) {
      const h = Math.min(PASO, left);
      e.vAng += k * Math.sin(e.ang) * h;
      e.ang += e.vAng * h;
      if (e.ang < 0) {
        e.ang = 0;
        e.vAng = Math.abs(e.vAng) * 0.5;
      }
      if (e.vDesliz > 0) {
        e.desliz += e.vDesliz * h;
        e.vDesliz = Math.max(0, e.vDesliz - FRENO_BASE * h);
      }
      e.giro += e.vGiro * h;
      e.vGiro -= e.vGiro * Math.min(1, TORCIDA_FRENO * h);
      if (e.ang >= e.reposo) {
        e.ang = e.reposo;
        if (e.vAng > REBOTE_MIN && e.rebotes < MAX_REBOTES) {
          if (e.rebotes === 0) {
            const x = e.prop.x + e.dirX * (e.desliz + e.h * Math.sin(e.ang) * 0.85);
            const z = e.prop.z + e.dirZ * (e.desliz + e.h * Math.sin(e.ang) * 0.85);
            this._evento('suelo', e, x, this.ground(x, z) + 0.3, z, e.vAng * e.h);
          }
          e.vAng = -e.vAng * REBOTE;
          e.rebotes++;
        } else e.vAng = 0; // quieto en el piso (la base aún puede arrastrarse)
      }
    }
    if (e.vDesliz > 0 || e.desliz) e.dy = this.ground(e.prop.x + e.dirX * e.desliz, e.prop.z + e.dirZ * e.desliz) - this.ground(e.prop.x, e.prop.z);
    return e.ang >= e.reposo && e.vAng === 0 && e.vDesliz <= 0;
  }

  /** Deja una entrada que cae quieta en el piso (k: su lugar en `cayendo`). */
  _asentar(e, k) {
    if (this.cayendo[k] !== e) k = this.cayendo.indexOf(e);
    if (k >= 0 && k < this.nCayendo) this._quitarCayendo(k);
    e.ang = e.reposo;
    e.vAng = e.vDesliz = e.vGiro = 0;
    e.estado = TUMBADO;
    e.t = 0;
    this.tumbados.push(e);
    this._marcar(e);
  }

  _quitarCayendo(k) {
    // Corre los demás (orden de llegada: el primero es el más viejo).
    for (let j = k; j < this.nCayendo - 1; j++) this.cayendo[j] = this.cayendo[j + 1];
    this.cayendo[--this.nCayendo] = null;
  }

  limpiarCambios() {
    for (let j = 0; j < this.nCambiados; j++) this.cambiados[j] = null;
    this.nCambiados = 0;
  }

  limpiarEventos() {
    for (let j = 0; j < this.nEventos; j++) this.eventos[j].e = null;
    this.nEventos = 0;
  }

  _marcar(e) {
    for (let j = 0; j < this.nCambiados; j++) if (this.cambiados[j] === e) return;
    if (this.nCambiados < MAX_CAMBIADOS) this.cambiados[this.nCambiados++] = e;
  }

  _evento(tipo, e, x, y, z, fuerza) {
    if (this.nEventos >= MAX_EVENTOS) return;
    const ev = this.eventos[this.nEventos++];
    ev.tipo = tipo;
    ev.e = e;
    ev.x = x;
    ev.y = y;
    ev.z = z;
    ev.fuerza = fuerza;
  }

  /** Punta del objeto en su pose actual (para efectos): escribe en out {x, y, z}. */
  punta(e, out, f = 1) {
    const s = Math.sin(e.ang) * e.h * f;
    out.x = e.prop.x + e.dirX * (e.desliz + s);
    out.z = e.prop.z + e.dirZ * (e.desliz + s);
    out.y = this.ground(e.prop.x, e.prop.z) + e.dy + Math.cos(e.ang) * e.h * f;
    return out;
  }

  /** Resumen para las pruebas. */
  stats() {
    let tumbados = 0;
    for (const e of this.entries) if (e.estado !== DE_PIE) tumbados++;
    return { entradas: this.entries.length, cayendo: this.nCayendo, tumbados, total: this.total };
  }
}
