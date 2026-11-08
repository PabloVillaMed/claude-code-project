// Damas de compañía en el juego: de noche, unas pocas mujeres adultas con
// pinta de salir esperan en el andén de algunas esquinas de avenida y cerca
// de la rumba de la 92 (salen solo cerca del jugador y con tope por
// calidad). Si el jugador para un carro a su lado: "E para invitarla". Se
// sube de copiloto con la animación de subir (game/boarding.js) y hay que
// llevarla a un lugar tranquilo (aviso en el HUD); ahí la pantalla se va a
// negro unos segundos (todo fuera de cámara), se cobra y se recupera vida;
// luego se baja, se despide y se va caminando. Disparos, policía o un choque
// fuerte la asustan: se baja y se va sin cobrar. Si la atacan, es un peatón
// más (huye y aplican las reglas de delito de siempre). Puestos, estados,
// lugar tranquilo, cobro y vida: sim/companions.js (puro y probado).

import * as THREE from 'three';
import { PRECIO, REAPARECER, TRANQUILO_PEATONES, TRANQUILO_POLICIA, TRANQUILO_TIEMPO, aMarco, alcanza, avisoLugar, cobrar, esDeNoche, fundidoCita, nuevaCita, pasoCita, pintaDama, puedeOfrecer, puestosDamas, topeDamas } from '../sim/companions.js';
import { isPoliceVehicle } from '../sim/vehicleVariants.js';
import { makeRng } from '../sim/rng.js';
import { randomLook } from '../render/characterRig.js';
import { applyOutfit } from '../render/outfit.js';
import { Boarding } from './boarding.js';

// ------------------------------------------------------------ constantes configurables
/** s entre revisiones (aparecer, ofrecer, lugar tranquilo, avisos). */
const TICK = 0.25;
/** s del fundido corto con el que se sienta cuando no hay animación de subir (muñeco sin gestos). */
export const FUNDIDO_SUBIR = 0.8;
/** s en que el velo negro se va si la cita se corta a la mitad (susto). */
export const FUNDIDO_CORTE = 0.5;
/** s entre comentarios de ella mientras buscan lugar (con gente o policía cerca). */
export const HABLA_VIAJE = 20;
/** s entre avisos del HUD cuando no cambian. */
export const AVISO_CADA = 2.5;
/** s sin avisos después de la instrucción inicial ("llévala a un lugar tranquilo…"). */
export const AVISO_PRIMERO = 4.5;
/** s antes de que vuelva a saludar al mismo carro. */
export const SALUDO_CADA = 20;
/** s sin ofrecerle otra vez después de decir que no alcanza la plata. */
export const SIN_PLATA_PAUSA = 8;
/** m: la que se va caminando se borra cuando el jugador está más lejos que esto. */
export const SE_VA_LEJOS = 60;
/** m: no aparece más cerca que esto del jugador (que no salga de la nada). */
export const APARECE_LEJOS = 12;
/** Vida con que aparece (como la gente de la rumba). */
export const VIDA_DAMA = 90;

const AVISOS = {
  policia: 'Hay <b>policía</b> cerca: así no. Busca otro lugar.',
  gente: 'Hay <b>gente</b> cerca: llévala a un lugar más solo.',
  para: 'Este lugar está tranquilo: <b>detén el carro</b>.',
  espera: 'Lugar tranquilo. Quédate quieto un momento…',
};

export class Companions {
  constructor(game) {
    this.game = game;
    const avoid = [...(game.street?.plazas ?? []), ...(game.street?.homeless ?? [])];
    this.spots = puestosDamas(game.city, { avoid }).map((s) => ({ ...s, ped: null, libreEn: 0, noAt: 0, saludoAt: 0 }));
    this.rng = makeRng(5150);
    this.t = 0;
    this.tick = 0;
    this.offer = null; // puesto con el carro del jugador al lado (E: invitarla)
    this.offerAt = -Infinity;
    this.date = null; // la cita en curso
    this.leaving = []; // las que se van caminando (se borran lejos)
    this.served = 0; // citas completas
    this.fade = 0; // velo negro propio (sale suave si se corta)
    this._fadeOn = false;
    this.shotD = null; // m al disparo más cercano desde el último cuadro
    this.impact = 0; // golpe más fuerte desde el último cuadro (m/s)
    this._ctx = { sentada: false, abajo: false, enCarro: false, muerto: false, vel: 0, peatones: 0, policia: false, buscado: 0, disparo: null, choque: 0, plata: 0 };
    this._v = new THREE.Vector3();
    game.events?.on('shot', (e) => this._onShot(e));
    game.events?.on('explosion', (e) => this._onShot(e)); // (una explosión asusta igual que un tiro)
    // Si la atacan esperando, deja el puesto y huye de una (combat.js ya la puso
    // en 'flee' y aplicó el delito; quieta en su puesto no se movería).
    game.events?.on('pedHurt', (e) => {
      if (e.ped?.dama && e.ped.sim.fixed) e.ped.sim.fixed = false;
    });
  }

  /** El carro del jugador se queda quieto (y sin bajarse) mientras ella sube, se baja o en el fundido. */
  get locked() {
    const d = this.date;
    if (!d || this.game.player?.vehicle !== d.vehicle) return false;
    return d.cita.estado === 'cita' || !!d.blink || !!d.boarding;
  }

  /** Entradas del jugador con el carro quieto (input.poll() arma un objeto nuevo en cada cuadro: se corrige ese). */
  mask(a) {
    const m = a;
    m.throttle = 0;
    m.brake = 0;
    m.steer = 0;
    m.handbrake = true;
    m.wheelie = false;
    m.enterVehicle = false;
    m.interact = false;
    m.fire = false;
    m.aim = false;
    m.horn = false;
    return m;
  }

  /** Golpe del carro del jugador (Game.updateDriving). */
  onImpact(impact) {
    if (this.date) this.impact = Math.max(this.impact, impact);
  }

  update(dt) {
    const g = this.game;
    if (g.state !== 'playing' || !g.world || !g.player) return;
    this.t += dt;
    this.tick -= dt;
    const tick = this.tick <= 0;
    if (tick) this.tick = TICK;
    if (this.date) this._updateDate(dt, tick);
    this._updateFade(dt);
    if (!tick) return;
    this._spawns();
    this._updateOffer();
  }

  // ------------------------------------------------------------ aparecer y desaparecer
  _spawns() {
    const g = this.game;
    const w = g.world;
    const p = g.player;
    const night = esDeNoche(g.env?.timeOfDay ?? 12);
    const near = g.quality.pedDraw ?? 90;
    const tope = topeDamas(g.quality);
    let active = this.date ? 1 : 0;
    for (const s of this.spots) if (s.ped) active++;
    for (const s of this.spots) {
      const m = s.ped;
      const d = Math.hypot(s.x - p.x, s.z - p.z);
      if (m) {
        if (!w.peds.includes(m)) {
          // El mundo la borró (lejos o muerta hace rato).
          s.ped = null;
          s.libreEn = this.t + REAPARECER;
          active--;
        } else if (!m.alive || !m.sim.fixed || m.sim.mode === 'flee') {
          // La asustaron o la atacaron: huye como cualquier peatón.
          m.sim.fixed = false;
          this._release(s, m);
        } else if (d > near * 1.15) {
          w.removePed(m);
          s.ped = null;
          active--;
        } else if (!night) {
          // Amaneció: se va caminando.
          m.sim.fixed = false;
          m.sim.mode = 'walk';
          this._release(s, m);
        }
      } else if (night && active < tope && this.t >= s.libreEn && d < near * 0.85 && d > APARECE_LEJOS) {
        s.ped = this._spawnDama(s);
        active++;
      }
    }
    for (let i = this.leaving.length - 1; i >= 0; i--) {
      const m = this.leaving[i];
      if (!w.peds.includes(m)) this.leaving.splice(i, 1);
      else if (m.alive && Math.hypot(m.x - p.x, m.z - p.z) > SE_VA_LEJOS) {
        w.removePed(m);
        this.leaving.splice(i, 1);
      }
    }
  }

  _release(s, m) {
    s.ped = null;
    s.libreEn = this.t + REAPARECER;
    if (this.offer === s) this.offer = null;
    if (!this.leaving.includes(m)) this.leaving.push(m);
  }

  /** Una dama esperando en su puesto, de pinta de salir (prendas de rumba de sim/ropa.js). */
  _spawnDama(s) {
    const w = this.game.world;
    // Mujer adulta: los avatares de mujer del barrio son todos de adultas (Rocketbox Adults).
    let look = randomLook(this.rng, 'civil');
    for (let k = 0; k < 12 && !look.female; k++) look = randomLook(this.rng, 'civil');
    const m = w.spawnPedAt(s.x, s.z, { outfit: 'civil', health: VIDA_DAMA, look });
    m.dama = true;
    const q = m.sim;
    q.fixed = true;
    q.mode = 'idle';
    q.speed = 0;
    q.yaw = s.yaw + (this.rng.next() - 0.5) * 0.9;
    // Esperando: mira para los lados, cambia el peso o revisa el celular.
    const k = this.rng.int(0, 2);
    m.idleClip = k === 0 ? 'idle_look' : 'idle_wait';
    m.fixedActivity = k === 2 ? 'phone' : null;
    applyOutfit(m.rig, pintaDama(this.rng));
    return m;
  }

  // ------------------------------------------------------------ invitarla
  _carOk(v) {
    const st = v.state;
    return v.type !== 'moto' && !st.spec.twoWheels && !v.exploded && st.health > 0 && !isPoliceVehicle(v.type, st.variant);
  }

  _prompt() {
    return `Presiona <kbd>E</kbd> para invitarla (<b>$${PRECIO}</b>).`;
  }

  _updateOffer() {
    const g = this.game;
    const p = g.player;
    const v = p.vehicle;
    let best = null;
    let bestD = Infinity;
    if (!this.date && v && !p.dead && !p.boarding && (g.wanted?.level ?? 0) === 0 && this._carOk(v)) {
      const st = v.state;
      const vel = Math.hypot(st.vx, st.vz);
      const lado = v.view.seat.x < 0 ? 1 : -1;
      for (const s of this.spots) {
        const m = s.ped;
        if (!m?.alive || !m.sim.fixed || m.sim.mode !== 'idle' || this.t < s.noAt) continue;
        const dx = m.x - st.x;
        const dz = m.z - st.z;
        if (Math.abs(dx) > 8 || Math.abs(dz) > 8) continue;
        const l = aMarco(dx, dz, st.heading);
        if (!puedeOfrecer({ lx: l.x, lz: l.z, ancho: st.spec.width, largo: st.spec.length, lado, vel })) continue;
        const d = Math.hypot(dx, dz);
        if (d < bestD) {
          best = s;
          bestD = d;
        }
      }
    }
    if (best !== this.offer) {
      this.offer = best;
      if (!best) return;
      this.offerAt = this.t;
      g.hud.help(this._prompt(), 4);
      if (this.t < best.saludoAt) return;
      best.saludoAt = this.t + SALUDO_CADA;
      // Se voltea hacia el carro, saluda y le coquetea un poquito.
      const m = best.ped;
      m.sim.yaw = Math.atan2(v.state.x - m.x, v.state.z - m.z);
      m.rig.play?.('wave', { fadeIn: 0.25 });
      g.dialogue?.speak(m, 'dama');
    } else if (best && this.t - this.offerAt > 3.5) {
      this.offerAt = this.t;
      g.hud.help(this._prompt(), 4);
    }
  }

  /** E con el carro al lado de una: la invita. Devuelve si atendió la tecla. */
  interact() {
    const s = this.offer;
    const g = this.game;
    if (!s || this.date || !s.ped?.alive || !g.player.vehicle) return false;
    const m = s.ped;
    this.offer = null;
    if (!alcanza(g.player.money)) {
      g.dialogue?.interrupt(m);
      g.dialogue?.speak(m, 'dama_sin_plata');
      g.hud.toast(`No te alcanza: son <b>$${PRECIO}</b>.`, 2.5);
      s.noAt = this.t + SIN_PLATA_PAUSA;
      return true;
    }
    this._startDate(s);
    return true;
  }

  _animated() {
    return this.game._animBoarding?.() ?? true;
  }

  _startDate(s) {
    const g = this.game;
    const v = g.player.vehicle;
    const m = s.ped;
    s.ped = null;
    s.libreEn = this.t + REAPARECER;
    // Fuera del bucle de peatones mientras va en el carro (la anima esta escena).
    g.world.detachPed(m);
    m.rig.root.visible = true;
    g.dialogue?.interrupt(m);
    g.dialogue?.speak(m, 'dama_si');
    // Puesto del copiloto: el del conductor reflejado; entra por esa puerta.
    const vs = v.view.seat;
    const seat = { x: -vs.x, y: vs.y, z: vs.z };
    const side = vs.x < 0 ? 1 : -1;
    const d = { spot: s, ped: m, vehicle: v, seat, side, cita: nuevaCita(), boarding: null, seated: false, out: false, blink: null, talkAt: this.t + 8, avisoAt: this.t + AVISO_PRIMERO, aviso: null, tomba: false, cobro: null };
    this.date = d;
    if (this._animated()) {
      v.view.group.updateMatrixWorld(true);
      const f = v.view.group.worldToLocal(this._v.set(m.x, m.y, m.z));
      d.boarding = Boarding.create(m.rig, v, 'enter', { from: { x: f.x, y: f.y, z: f.z, yaw: m.sim.yaw - v.state.heading }, seat, side, passenger: true });
    }
    // Sin animación (muñeco sin gestos o pruebas automáticas): fundido corto y aparece sentada.
    if (!d.boarding) d.blink = { t: 0, dur: FUNDIDO_SUBIR };
    g.hud.help('Llévala a un <b>lugar tranquilo</b>: sin gente ni policía cerca, y detén el carro unos segundos.', 5);
  }

  // ------------------------------------------------------------ la cita
  _updateDate(dt, tick) {
    const g = this.game;
    const d = this.date;
    const v = d.vehicle;
    const m = d.ped;
    const p = g.player;
    // El carro desapareció (partida nueva, limpieza): se corta de una.
    if (tick && !g.world.vehicles.includes(v)) return this._abort();
    // Animación: subir / bajar, el fundido corto o sentada de copiloto.
    if (d.boarding) {
      if (d.boarding.update(dt)) {
        if (d.boarding.mode === 'enter') this._seat(d);
        else this._out(d);
      }
    } else if (d.blink) {
      const b = d.blink;
      b.t += dt;
      if (!d.seated && b.t >= b.dur / 2) this._seat(d);
      if (b.t >= b.dur) d.blink = null;
    } else if (d.seated && !d.out) {
      m.rig.animate(dt, { speed: 0, onGround: true, driving: 'car', handsFree: true, sway: v.state.bodyRoll });
    }
    // Va con el carro (el diálogo mide la distancia desde aquí).
    if (!d.out) {
      m.sim.x = v.state.x;
      m.sim.z = v.state.z;
      m.y = v.state.y;
    }
    const ctx = this._ctx;
    ctx.sentada = d.seated && !d.blink;
    ctx.abajo = d.out;
    ctx.enCarro = p.vehicle === v && !p.dead;
    ctx.muerto = !!p.dead;
    ctx.vel = Math.hypot(v.state.vx, v.state.vz);
    if (tick) this._scan(ctx, v);
    ctx.disparo = this.shotD;
    ctx.choque = this.impact;
    ctx.plata = p.money;
    this.shotD = null;
    this.impact = 0;
    const ev = pasoCita(d.cita, dt, ctx);
    if (ev) this._onEvent(ev, d);
    if (tick && this.date === d && d.cita.estado === 'a_bordo') this._avisos(ctx, d);
  }

  /** Peatones y policía alrededor del carro (cada TICK). */
  _scan(ctx, v) {
    const g = this.game;
    const x = v.state.x;
    const z = v.state.z;
    const r2 = TRANQUILO_PEATONES * TRANQUILO_PEATONES;
    const p2 = TRANQUILO_POLICIA * TRANQUILO_POLICIA;
    let n = 0;
    let pol = false;
    for (const q of g.world.peds) {
      if (!q.alive) continue;
      const dd = (q.x - x) ** 2 + (q.z - z) ** 2;
      if (q.faction === 'police') pol ||= dd < p2;
      else if (dd < r2) n++;
    }
    if (!pol) {
      for (const u of g.world.policeUnits) {
        const s = u.vehicle?.state;
        if (s && (s.x - x) ** 2 + (s.z - z) ** 2 < p2) {
          pol = true;
          break;
        }
      }
    }
    ctx.peatones = n;
    ctx.policia = pol;
    ctx.buscado = g.wanted?.level ?? 0;
  }

  _avisos(ctx, d) {
    const g = this.game;
    // Comentarios de ella mientras buscan.
    if (this.t >= d.talkAt && (ctx.policia || ctx.peatones > 0)) {
      d.talkAt = this.t + HABLA_VIAJE;
      if (ctx.policia && !d.tomba) {
        d.tomba = true;
        g.dialogue?.speak(d.ped, 'dama_tomba');
      } else g.dialogue?.speak(d.ped, 'dama_viaje');
    }
    if (this.t < d.avisoAt - AVISO_CADA && d.aviso == null) return; // (la instrucción inicial)
    const k = avisoLugar(ctx);
    const txt = k === 'espera' ? `${AVISOS.espera} <b>${Math.max(1, Math.ceil(TRANQUILO_TIEMPO - d.cita.quieto))}</b>` : AVISOS[k];
    if (txt === d.aviso && this.t < d.avisoAt) return;
    d.aviso = txt;
    d.avisoKey = k;
    d.avisoAt = this.t + AVISO_CADA;
    g.hud.help(txt, AVISO_CADA + 0.6);
  }

  _onEvent(ev, d) {
    const g = this.game;
    const m = d.ped;
    const dlg = g.dialogue;
    switch (ev) {
      case 'lugar':
        dlg?.speak(m, 'dama_lugar');
        g.hud.help('', 0.01);
        break;
      case 'cobro': {
        // En pleno negro: se cobra y se recupera la vida (sim/companions.js cobrar).
        const p = g.player;
        const r = cobrar({ dinero: p.money, vida: p.health });
        g.addMoney(r.dinero - p.money);
        p.health = r.vida;
        d.cobro = r;
        this.served++;
        break;
      }
      case 'sin_plata':
        dlg?.speak(m, 'dama_sin_plata');
        break;
      case 'susto':
        dlg?.interrupt(m);
        dlg?.speak(m, 'dama_susto');
        if (d.vehicle.state && Math.hypot(d.vehicle.state.vx, d.vehicle.state.vz) > 2) g.hud.help('Se asustó y se quiere bajar: <b>detén el carro</b>.', 3);
        break;
      case 'abandono':
        dlg?.speak(m, 'dama_abandono');
        break;
      case 'salir':
        this._startExit(d);
        break;
      case 'abajo':
        this._finish(d);
        break;
    }
  }

  _seat(d) {
    const v = d.vehicle;
    const r = d.ped.rig.root;
    if (d.boarding) {
      d.boarding.cancel();
      d.boarding = null;
    }
    v.view.group.add(r);
    r.position.set(d.seat.x, d.seat.y - 0.5, d.seat.z);
    r.rotation.set(0, 0, 0);
    d.seated = true;
  }

  _startExit(d) {
    const enter = d.boarding?.mode === 'enter';
    if (d.boarding && enter) {
      // (Se asustó caminando a la puerta: se suelta ahí mismo.)
      return this._out(d);
    }
    d.blink = null;
    if (!d.seated) return this._out(d);
    const b = this._animated() ? Boarding.create(d.ped.rig, d.vehicle, 'exit', { side: d.side, seat: d.seat, passenger: true }) : null;
    if (b) d.boarding = b;
    else this._out(d);
  }

  /** Ya afuera: vuelve al andén como peatón (se despide y se va, o huye asustada). */
  _out(d) {
    const g = this.game;
    const v = d.vehicle;
    const m = d.ped;
    const grp = v.view.group;
    grp.updateMatrixWorld(true);
    let w;
    let yaw;
    if (d.boarding) {
      // Donde la dejó la animación.
      w = m.rig.root.getWorldPosition(this._v);
      yaw = grp.rotation.y + m.rig.root.rotation.y;
      d.boarding.cancel();
      d.boarding = null;
    } else {
      // Sin animación: junto a la puerta del copiloto, mirando hacia afuera.
      w = grp.localToWorld(this._v.set(d.side * (v.state.spec.width / 2 + 0.7), 0, d.seat.z));
      yaw = grp.rotation.y + (d.side * Math.PI) / 2;
    }
    g.world.attachPed(m, w.x, w.z, yaw);
    const s = m.sim;
    s.fixed = false;
    if (d.cita.motivo === 'susto') {
      s.mode = 'flee';
      s.fleeFrom = { x: v.state.x, z: v.state.z };
      s.timer = 8;
    } else {
      s.mode = 'walk';
      if (d.cita.motivo === 'fin') {
        g.dialogue?.speak(m, 'dama_chao');
        m.rig.play?.('wave', { fadeIn: 0.3 });
      }
    }
    d.out = true;
  }

  _finish(d) {
    const g = this.game;
    // (El -$ ya lo muestra el HUD con addMoney.)
    if (d.cobro) g.hud.toast(`Vida recuperada: ${Math.round(d.cobro.vida)} %`, 3);
    if (!this.leaving.includes(d.ped)) this.leaving.push(d.ped);
    this.date = null;
  }

  /** Corta la cita sin escena (el carro ya no está): ella se borra. */
  _abort() {
    const d = this.date;
    if (!d) return;
    d.boarding?.cancel();
    const w = this.game.world;
    if (w.peds.includes(d.ped)) w.removePed(d.ped);
    else d.ped.dispose();
    this.date = null;
    this.offer = null;
  }

  /** Partida nueva: sin cita ni velo. */
  reset() {
    this._abort();
    this.offer = null;
    this.fade = 0;
    if (this._fadeOn) this.game.setFade(0);
    this._fadeOn = false;
  }

  _updateFade(dt) {
    const d = this.date;
    let target = d ? fundidoCita(d.cita) : 0;
    if (d?.blink) {
      const b = d.blink;
      target = Math.max(target, 1 - Math.abs(b.t / (b.dur / 2) - 1));
    }
    // Entra con la curva de la cita; si se corta, sale suave.
    this.fade = target >= this.fade ? target : Math.max(target, this.fade - dt / FUNDIDO_CORTE);
    if (this.fade > 0) {
      this.game.setFade(this.fade);
      this._fadeOn = true;
    } else if (this._fadeOn) {
      this.game.setFade(0);
      this._fadeOn = false;
    }
  }

  _onShot(e) {
    const d = this.date;
    if (!d) return;
    const s = d.vehicle.state;
    const dist = Math.hypot(e.x - s.x, e.z - s.z);
    this.shotD = this.shotD == null ? dist : Math.min(this.shotD, dist);
  }

  /** Para las pruebas (window.__game.companions()). */
  state() {
    const g = this.game;
    const d = this.date;
    return {
      hora: +(g.env?.timeOfDay ?? 0).toFixed(2),
      noche: esDeNoche(g.env?.timeOfDay ?? 12),
      tope: topeDamas(g.quality),
      precio: PRECIO,
      puestos: this.spots.map((s) => ({ id: s.id, tipo: s.tipo, x: +s.x.toFixed(2), z: +s.z.toFixed(2), yaw: +s.yaw.toFixed(3), ped: s.ped?.id ?? null, esperando: !!s.ped?.sim.fixed })),
      enEscena: this.spots.filter((s) => s.ped).length + (d ? 1 : 0),
      oferta: this.offer?.id ?? null,
      cita: d
        ? { puesto: d.spot.id, ped: d.ped.id, estado: d.cita.estado, motivo: d.cita.motivo, susto: d.cita.susto ?? null, quieto: +d.cita.quieto.toFixed(2), t: +d.cita.t.toFixed(2), cobrado: d.cita.cobrado, sentada: d.seated, animada: !!d.boarding, fundidoCorto: !!d.blink, aviso: d.avisoKey ?? null }
        : null,
      seVan: this.leaving.length,
      citas: this.served,
      fundido: +this.fade.toFixed(3),
      bloqueado: this.locked,
    };
  }
}
