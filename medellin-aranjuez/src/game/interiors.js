// Locales a los que se entra (las discotecas, bares y la fonda de la 92):
// arma cada interior (render/interiorBuilder.js) solo con el jugador cerca y
// lo suelta al alejarse (con caché de los más recientes), abre y cierra la
// puerta (la hoja de la colisión de sim/interiors.js), cobra el cover al
// cruzarla de noche, dice el nombre del local al entrar, presta 1-2 luces
// reales de los faroles (render/nightLights.js) mientras el jugador está
// adentro, le da a la cámara los límites del salón y, con la cámara adentro
// y la puerta fuera de cuadro, deja de dibujar la ciudad de afuera.
// Adentro no hay tráfico, y la policía de afuera no ve a través de los
// muros (su línea de vista choca con la colisión del cascarón).

import * as THREE from 'three';
import { INTERIOR, aLocal, aMundo, dentroInterior, localAbierto, techoInterior } from '../sim/interiors.js';
import { InteriorFronts, InteriorView } from '../render/interiorBuilder.js';

// ------------------------------------------------------------------ configurables
/** m: a esta distancia de la puerta se arma el interior. */
const CARGAR = 60;
/** m: más lejos se suelta (salvo los CACHE más recientes). */
const SOLTAR = 80;
/** Interiores que se quedan armados aunque el jugador se aleje (los más recientes). */
const CACHE = 2;
/** m: el interior armado se dibuja desde afuera solo a esta distancia y de frente a la fachada. */
const VER_DESDE_AFUERA = 45;
/** m: lo que se anima (haces, pantalla, bola) solo con la cámara a esta distancia. */
const ANIMAR = 40;
/** Luces reales prestadas de los faroles con el jugador adentro, por calidad (lampLights 0 = ninguna). */
const LUCES_POR_CALIDAD = { baja: 0, media: 1, alta: 2, ultra: 2 };
/** Con la cámara adentro y la puerta fuera de cuadro, no se dibuja la ciudad de afuera. */
const OCULTAR_AFUERA = true;
/** s entre avisos del portero. */
const AVISO_CADA = 6;
/** Cámara adentro: distancia máxima detrás del personaje (m), cuánto sube (m) y margen con muros y techo (m). */
const CAM_DIST = 2.6;
const CAM_SUBE = 0.12;
const CAM_MARGEN = 0.22;

export class Interiors {
  constructor(game) {
    this.game = game;
    this.list = game.city.interiors ?? [];
    this.views = new Map(); // id -> InteriorView
    this.used = []; // ids, el más reciente al final
    this.state = this.list.map(() => ({ open: false, paidNight: -1, msgAt: -1e9, inside: false }));
    this.inside = null; // interior donde está el jugador
    this.camInside = null; // interior donde está la cámara
    this.t = 0;
    this.hidOutside = false;
    this.lights = [];
    this.fronts = this.list.length ? new InteriorFronts(this.list) : null;
    if (this.fronts) game.scene.add(this.fronts.group);
    this._open = this.list.map(() => false);
    this._shut = this.list.map(() => true);
    this._built = this.list.map(() => false);
    this._frustum = new THREE.Frustum();
    this._pm = new THREE.Matrix4();
    this._v = new THREE.Vector3();
    this._p = { x: 0, z: 0 };
    this.night = 0;
  }

  /** Noche de la partida (cambia al amanecer): el cover se paga una vez por noche y local. */
  _nightKey() {
    const g = this.game;
    const h = g.env.timeOfDay;
    return Math.floor((g.stats?.playTime ?? 0) / 600) * 0 + Math.floor(((g.env.day ?? 0) * 24 + h + 12) / 24);
  }

  update(dt) {
    if (!this.list.length) return;
    const g = this.game;
    const p = g.player;
    const cam = g.camera.position;
    this.t += dt;
    const hour = g.env.timeOfDay;
    const abierto = localAbierto(hour);
    const prevInside = this.inside;
    this.inside = null;
    this.camInside = null;
    let building = false;
    for (let i = 0; i < this.list.length; i++) {
      const r = this.list[i];
      const st = this.state[i];
      const dx = p.x - r.ox;
      const dz = p.z - r.oz;
      const d = Math.hypot(dx, dz);
      // Armar / soltar.
      let v = this.views.get(r.id);
      if (!v && d < CARGAR) {
        v = new InteriorView(r, g.quality);
        this.views.set(r.id, v);
        g.scene.add(v.group);
      }
      if (v && !v.ready && !building) {
        building = true;
        v.step();
      }
      if (v) this._touch(r.id, d < CARGAR);
      // Adentro (jugador y cámara).
      const pin = !p.inVehicle && dentroInterior(r, p.x, p.z, p.y);
      if (pin) this.inside = r;
      if (dentroInterior(r, cam.x, cam.z, cam.y)) this.camInside = r;
      // Puerta: abierta de noche al que puede pagar (o ya pagó), cerrada de día;
      // con el jugador adentro queda abierta para que salga.
      if (d < 18) this._door(i, r, st, abierto, pin);
      else if (st.open && !pin) this._setDoor(i, r, false);
      this._shut[i] = !abierto && !pin;
      this._built[i] = !!v?.ready;
    }
    // Soltar los lejanos que no están entre los más recientes.
    for (const [id, v] of this.views) {
      const r = v.r;
      const d = Math.hypot(p.x - r.ox, p.z - r.oz);
      if (d > SOLTAR && !this.used.slice(-CACHE).includes(id)) {
        v.dispose();
        this.views.delete(id);
        this.used = this.used.filter((q) => q !== id);
      }
    }
    // Entrar / salir: el nombre del local en el HUD.
    if (this.inside && this.inside !== prevInside) g.hud?.toast?.(`<b>${this.inside.name}</b>`, 2.6);
    // Ver y animar.
    for (const v of this.views.values()) {
      const r = v.r;
      const loc = aLocal(r, cam.x, cam.z, this._p);
      const dc = Math.hypot(cam.x - r.ox, cam.z - r.oz);
      const inCam = this.camInside === r;
      v.group.visible = v.ready && (inCam || (loc.z > -0.3 && dc < VER_DESDE_AFUERA));
      if (v.group.visible && dc < ANIMAR) v.update(dt, { inside: inCam, camYaw: g.camRig?.yaw ?? 0 });
    }
    this.night = g.env.night ?? 0;
    this.fronts?.update(dt, this._open, this._shut, this._built, this.night);
    this._lights(dt);
    this._outside();
  }

  _touch(id, near) {
    if (!near) return;
    if (this.used[this.used.length - 1] === id) return;
    this.used = this.used.filter((q) => q !== id);
    this.used.push(id);
  }

  /** La puerta del local i (con el jugador cerca). */
  _door(i, r, st, abierto, pin) {
    const g = this.game;
    const p = g.player;
    const loc = aLocal(r, p.x, p.z, this._p);
    const near = Math.abs(loc.x) < (r.door.x1 - r.door.x0) / 2 + 1.6 && loc.z > -1.2 && loc.z < 3.2;
    const inDoor = Math.abs(loc.x) < (r.door.x1 - r.door.x0) / 2 + 0.45 && loc.z > -0.7 && loc.z < 0.5;
    const night = this._nightKey();
    const paid = st.paidNight === night || r.cover <= 0;
    const money = p.money ?? 0;
    const want = pin || (abierto && !p.inVehicle && (paid || money >= r.cover));
    // (No se cierra encima del jugador parado en el vano.)
    if (want !== st.open && !(inDoor && !want && st.open)) this._setDoor(i, r, want);
    // Cobro al cruzar hacia adentro.
    if (pin && !st.inside && !paid && abierto) {
      g.addMoney?.(-r.cover);
      st.paidNight = night;
      g.hud?.toast?.(`Cover de ${r.name.replace(/^(Discoteca|Salsoteca|Bar|Fonda) /, '')}: <span style="color:#ff6b6b">-$${r.cover}</span>`, 2.6);
    }
    st.inside = pin;
    // Avisos del portero en la puerta cerrada.
    if (!st.open && near && !pin && this.t - st.msgAt > AVISO_CADA) {
      st.msgAt = this.t;
      if (p.inVehicle) g.hud?.toast?.('Portero: en moto no entra, parce. Parquee afuera.', 2.6);
      else if (!abierto) g.hud?.toast?.(`${r.name}: cerrado. Abre de noche.`, 2.6);
      else g.hud?.toast?.(`Portero: sin los $${r.cover} del cover no entra, parce.`, 2.6);
    } else if (st.open && near && !pin && !paid && r.cover > 0 && this.t - st.msgAt > AVISO_CADA * 2) {
      st.msgAt = this.t;
      g.hud?.toast?.(`Portero: el cover es de $${r.cover}, siga.`, 2.2);
    }
  }

  _setDoor(i, r, open) {
    const col = this.game.city.collision;
    const st = this.state[i];
    if (open) col.remove(r.doorBox);
    else col.restore(r.doorBox);
    st.open = open;
    this._open[i] = open;
  }

  /** Luces reales prestadas: sobre la pista y la barra, solo con el jugador adentro. */
  _lights(dt) {
    const g = this.game;
    const nl = g.nightLights;
    if (!nl?.lend) return;
    const r = this.inside;
    const v = r ? this.views.get(r.id) : null;
    const want = v?.ready ? Math.min(LUCES_POR_CALIDAD[g.qualityKey ?? ''] ?? (g.quality?.lampLights >= 8 ? 2 : g.quality?.lampLights > 0 ? 1 : 0), v.lightSpots.length) : 0;
    this.lights = nl.lend(want);
    if (!want) return;
    const pulse = 0.85 + 0.15 * Math.sin(this.t * 7.5) * Math.sin(this.t * 1.3);
    this.lights.forEach((l, k) => {
      const s = v.lightSpots[k];
      const w = aMundo(r, s.x, s.z);
      l.position.set(w.x, s.y, w.z);
      l.color.setRGB(s.c[0], s.c[1], s.c[2]);
      l.distance = s.d;
      l.intensity = s.i * (k === 0 ? pulse : 1) * (1 + (v.strobe ?? 0) * 2);
    });
  }

  /** Con la cámara adentro y la puerta fuera de cuadro, la ciudad de afuera no se dibuja. */
  _outside() {
    const g = this.game;
    let hide = false;
    const r = this.camInside;
    if (OCULTAR_AFUERA && r && this.views.get(r.id)?.ready) {
      const cam = g.camera;
      cam.updateMatrixWorld();
      this._pm.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
      this._frustum.setFromProjectionMatrix(this._pm);
      const d = r.door;
      let seen = false;
      for (const [lx, y] of [[d.x0, r.floorY], [d.x1, r.floorY], [d.x0, r.floorY + d.h], [d.x1, r.floorY + d.h], [0, r.floorY + d.h / 2]]) {
        const w = aMundo(r, lx, 0.05);
        if (this._frustum.containsPoint(this._v.set(w.x, y, w.z))) {
          seen = true;
          break;
        }
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

  /**
   * Límites para la cámara (game/cameraRig.js) con el jugador adentro: más
   * cerca, un poco más alta y sin salirse del salón ni pasar el techo.
   */
  cameraHint() {
    const r = this.inside;
    if (!r) return null;
    const p = this.game.player;
    const loc = aLocal(r, p.x, p.z, this._p);
    // Recién entrando (en el vano), la cámara todavía puede estar en la calle.
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
        const py = this.game.player.y;
        if (pos.y > top) pos.y = Math.max(top, py + 0.4);
      },
    });
  }

  /** Para pruebas (__game.interiors()). */
  info() {
    const h = this.game.env.timeOfDay;
    return {
      dentro: this.inside?.id ?? null,
      camaraDentro: this.camInside?.id ?? null,
      afueraOculto: this.hidOutside,
      abierto: localAbierto(h),
      luces: this.lights.length,
      armados: [...this.views.values()].filter((v) => v.ready).map((v) => v.r.id),
      locales: this.list.map((r, i) => {
        const door = aMundo(r, 0, 1.2);
        return {
          id: r.id,
          name: r.name,
          tema: r.tema,
          tam: r.tam,
          cover: r.cover,
          ancho: +r.W.toFixed(2),
          fondo: +r.D.toFixed(2),
          alto: +r.H.toFixed(2),
          piso: +r.y0.toFixed(2),
          pisoPuerta: +r.floorY.toFixed(2),
          puerta: { x: +door.x.toFixed(2), z: +door.z.toFixed(2), abierta: this.state[i].open },
          mezanine: r.mezz ? { y: +r.mezz.y.toFixed(2) } : null,
          pista: r.pista ? (() => {
            const c = aMundo(r, (r.pista.x0 + r.pista.x1) / 2, (r.pista.z0 + r.pista.z1) / 2);
            return { x: +c.x.toFixed(2), z: +c.z.toFixed(2), y: +r.y0.toFixed(2), ancho: +(r.pista.x1 - r.pista.x0).toFixed(2), fondo: +(r.pista.z1 - r.pista.z0).toFixed(2) };
          })() : null,
          cabina: r.cabina ? { x: +r.cabina.x.toFixed(2), z: +r.cabina.z.toFixed(2), y: +r.cabina.y.toFixed(2), yaw: +r.cabina.yaw.toFixed(3) } : null,
          puntos: Object.fromEntries(Object.entries(r.spots).map(([k, v]) => [k, v.length])),
          armado: !!this.views.get(r.id)?.ready,
          visible: !!this.views.get(r.id)?.group.visible,
        };
      }),
    };
  }

  /** Pruebas: mete al jugador adentro del local `id` (puerta abierta y cover pagado). */
  enter(id) {
    const i = this.list.findIndex((r) => r.id === id);
    if (i < 0) return false;
    const r = this.list[i];
    this.state[i].paidNight = this._nightKey();
    this._setDoor(i, r, true);
    // Unos pasos adentro, mirando hacia el fondo; el interior se arma de una.
    // (3,6 m: con menos, la cámara quedaba en el vano de la puerta y el canto del muro tapaba un lado)
    const lz = r.landing ? r.stairs[0].z0 - 1.2 : r.mezz ? r.mezz.z0 - 1.5 : r.Z1 - 3.6;
    const w = aMundo(r, 0, lz);
    let v = this.views.get(r.id);
    if (!v) {
      v = new InteriorView(r, this.game.quality);
      this.views.set(r.id, v);
      this.game.scene.add(v.group);
    }
    v.buildNow();
    this._touch(r.id, true);
    return { x: w.x, z: w.z, yaw: Math.atan2(r.nx, r.nz), y: r.y0 };
  }

  /** Puntos de la gente de adentro (para game/ quien los use): spots del interior `id`. */
  spots(id) {
    return this.list.find((r) => r.id === id)?.spots ?? null;
  }
}

export { INTERIOR };
