// Utilería que se tumba en el juego: postes, faroles, placas y árboles.
// Arma el registro (sim/destructibles.js, lo consulta la física de los
// vehículos) y su dibujo (render/destructibles.js), avanza las caídas y
// convierte sus eventos en sonido (game/audio.js tumbe), chispas u hojas
// (render/effects.js) y una sacudida corta de la cámara.

import * as THREE from 'three';
import { Destructibles } from '../sim/destructibles.js';
import { groundHeight } from '../sim/terrain.js';
import { DestructiblesView } from '../render/destructibles.js';

// ------------------------------------------------------------------ ajustes
/** Sacudida de cámara al tumbar algo: por m/s del vehículo y tope (poca: no es un choque). */
export const SACUDIDA_POR_VEL = 0.006;
export const SACUDIDA_MAX = 0.12;
/** Sacudida cuando lo tumbado cae al piso a menos de DIST_SACUDIDA_SUELO m del jugador. */
export const SACUDIDA_SUELO = 0.05;
export const DIST_SACUDIDA_SUELO = 15;
/** Ráfagas de chispas (effects.impact, 10 chispas cada una) al golpear algo metálico y al caer. */
export const CHISPAS_GOLPE = 2;
export const CHISPAS_SUELO = 1;
/** Hojas (effects.puff) que suelta un árbol al golpearlo y al caer al piso. */
export const HOJAS_GOLPE = 10;
export const HOJAS_SUELO = 16;
/** Color, tamaño (m) y vida (s) de las hojas que caen. */
export const COLOR_HOJAS = [0.28, 0.42, 0.16];
export const TAMANO_HOJA = 0.22;
export const VIDA_HOJA = 1.8;
/** Más lejos que esto (m) de la cámara, lo tumbado ya no se distingue: se puede reponer aunque quede dentro del cuadro. */
export const DIST_VISTA = 220;

export class Tumbables {
  constructor(game) {
    this.game = game;
    this.sim = new Destructibles(game.city, { groundHeight });
    this.view = new DestructiblesView(game.cityRenderer, this.sim);
    // ¿Lo ve la cámara? (para no reponer algo frente al jugador). El frustum
    // se arma una sola vez por paso y solo si hay algo que revisar.
    this._frustum = new THREE.Frustum();
    this._pv = new THREE.Matrix4();
    this._sph = new THREE.Sphere();
    this._listo = false;
    this._visto = (x, y, z, r) => {
      const cam = game.camera;
      const cp = cam.position;
      if ((x - cp.x) ** 2 + (z - cp.z) ** 2 > (DIST_VISTA + r) ** 2) return false;
      if (!this._listo) {
        this._frustum.setFromProjectionMatrix(this._pv.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
        this._listo = true;
      }
      this._sph.center.set(x, y, z);
      this._sph.radius = r;
      return this._frustum.intersectsSphere(this._sph);
    };
    this._p = { x: 0, y: 0, z: 0 };
    this._n = { x: 0, y: 0, z: 0 };
    this.ms = 0; // tiempo del último paso (pruebas)
  }

  update(dt) {
    const s = this.sim;
    const t0 = performance.now();
    if (dt > 0) {
      const p = this.game.player;
      const at = p.inVehicle ? p.vehicle.state : p;
      this._listo = false;
      s.update(dt, at.x, at.z, this._visto);
    }
    this.view.update();
    for (let j = 0; j < s.nEventos; j++) this._efecto(s.eventos[j]);
    s.limpiarEventos();
    this.ms = performance.now() - t0;
  }

  _efecto(ev) {
    const g = this.game;
    const e = ev.e;
    const cfg = e.cfg;
    const madera = cfg.material === 'madera';
    g.audio.tumbe(ev, cfg.material, ev.fuerza, ev.tipo);
    if (ev.tipo === 'golpe') {
      // Hacia el vehículo y un poco arriba.
      this._n.x = -e.dirX;
      this._n.y = 0.4;
      this._n.z = -e.dirZ;
      if (madera) {
        this._hojas(e, HOJAS_GOLPE, 0.8);
        g.effects.impact(ev, this._n, 'dust');
      } else {
        for (let k = 0; k < CHISPAS_GOLPE; k++) g.effects.impact(ev, this._n, 'spark');
        // El farol revienta: chispazo en el bombillo.
        if (cfg.luz) g.effects.impact(this.sim.punta(e, this._p, 0.95), null, 'spark');
      }
      if (e.porJugador) g.camRig.shake(Math.min(SACUDIDA_MAX, ev.fuerza * SACUDIDA_POR_VEL));
      return;
    }
    // 'suelo': la punta da contra el piso.
    if (madera) this._hojas(e, HOJAS_SUELO, 0.75);
    else for (let k = 0; k < CHISPAS_SUELO; k++) g.effects.impact(ev, null, 'spark');
    g.effects.impact(ev, null, 'dust');
    const p = g.player;
    if (Math.hypot(ev.x - p.x, ev.z - p.z) < DIST_SACUDIDA_SUELO) g.camRig.shake(SACUDIDA_SUELO);
  }

  /** Hojas sueltas alrededor de la copa (a la fracción `f` de la altura). */
  _hojas(e, n, f) {
    const c = this.sim.punta(e, this._p, f);
    const r = Math.min(3, e.h * 0.25);
    for (let k = 0; k < n; k++) {
      this._n.x = c.x + (Math.random() - 0.5) * 2 * r;
      this._n.y = c.y + (Math.random() - 0.5) * r;
      this._n.z = c.z + (Math.random() - 0.5) * 2 * r;
      this.game.effects.puff(this._n, TAMANO_HOJA, COLOR_HOJAS, 0.95, -0.6 - Math.random() * 0.8, VIDA_HOJA);
    }
  }

  /** Resumen para las pruebas (window.__game.destructibles). */
  stats() {
    return { ...this.sim.stats(), enlazados: this.view.enlazados, firmes: this.view.firmes, ms: this.ms };
  }
}
