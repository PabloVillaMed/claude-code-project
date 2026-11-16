// Bailar en la pista de las discotecas (el minijuego de ritmo): parado en la
// pista sale "Presiona E para bailar"; al entrar, el jugador baila el estilo
// del local (game/clubLife.js bailarJugador) y en pantalla sube la pista de
// ritmo (ui/danceHud.js) con flechas que hay que tocar al compás de la
// canción que suena (el reloj de la pista de game/radio.js, por medio de
// clubLife.b). Las reglas (patrones, juicio, combo, propina con tope) son de
// sim/danceGame.js; aquí se reparten los toques del teclado (con la hora del
// evento, para no perder precisión entre cuadros), del mando (botones de
// cara) y de la pantalla (ui/touchControls.js), y se arma lo demás: pasos más
// vistosos con combo alto, el corro de la gente que aplaude, las luces que se
// emocionan (game/interiors.js lee `emocion`), los gritos (game/salonSound.js),
// la pareja en las salsotecas, la propina y la frase de alguien al final.
//
// Mientras baila, WASD y las flechas son los carriles (no mueven al jugador);
// sostener una de ellas un momento, o mover el stick, lo saca caminando. E,
// Esc, apuntar, disparar o pausar también lo sacan. La barra va primero: con
// el jugador pegado a ella, E pide el guaro (Game._updatePois).

import { CARRILES, RITMO, acertarSiguiente, avanzarTanda, emocionDe, nuevaTanda, pasoVistoso, propinaTanda, resumenTanda, tocarTanda } from '../sim/danceGame.js';
import { tempoDe } from '../sim/clubLife.js';
import { aLocal, aMundo } from '../sim/interiors.js';
import { DanceHud } from '../ui/danceHud.js';

// ------------------------------------------------------------------ configurables
/** El minijuego en el juego (las reglas del ritmo están en sim/danceGame.js RITMO y PROPINA). */
export const BAILE_JUEGO = {
  /** m hacia adentro del borde de la pista (negativo = un poco por fuera) para que salga el aviso y se pueda empezar. */
  PISTA_MARGEN: -0.35,
  /** s sosteniendo una tecla de carril para salir caminando, y empuje del stick (0..1) que también lo saca. */
  SALIR_SOSTENER: 0.42,
  STICK_SALIR: 0.55,
  /** s que se ven por adelantado en la pista de ritmo (cuánto tarda una flecha en subir). */
  VISTA: 1.9,
  /** s que se le descuentan a cada toque (lo que tarda en salir el sonido y en pintarse la pantalla). */
  LATENCIA: 0.03,
  /** Combo con el que la gente cercana le abre el corro, y combo con el que lo deshace (al fallar mucho). */
  COMBO_CORRO: 10,
  COMBO_CORRO_FIN: 2,
  /** Cada tantos de combo la gente grita y alguien del corro dice algo. */
  GRITO_CADA: 12,
  /** Energía del baile del jugador: base y lo que sube con la emoción (sim/baile.js P.energia). */
  ENERGIA: [0.95, 0.35],
  /** Pareja en las salsotecas: de qué tan lejos (m) viene alguien que baila solo en la pista. */
  PAREJA: true,
  PAREJA_ALCANCE: 3.6,
  /** El jugador queda de frente a la cámara al empezar (de lado si baila en pareja, para ver a los dos). */
  DE_FRENTE: true,
  /** s entre tanda y tanda mientras sigue bailando (la cuenta de entrada va aparte). */
  ENTRE_TANDAS: 1.5,
};

/** Teclas de cada carril (izquierda, abajo, arriba, derecha). */
const TECLAS = { KeyA: 0, ArrowLeft: 0, KeyS: 1, ArrowDown: 1, KeyW: 2, ArrowUp: 2, KeyD: 3, ArrowRight: 3 };
/** Botones de cara del mando por carril: X, A, Y, B (estándar de la Gamepad API). */
const BOTON_CARRIL = [2, 0, 3, 1];
/** Estilo de la pista de ritmo por estilo de baile del local. */
const PATRON_DE = { regueton: 'regueton', salsa: 'salsa', popular: 'popular', electronica: 'electronica' };
const _p = { x: 0, z: 0 };

export class DanceGame {
  constructor(game) {
    this.game = game;
    this.hud = new DanceHud();
    this.active = false;
    this.S = null; // la tanda en curso (sim/danceGame.js)
    this.r = null; // el local donde baila
    this.estilo = 'regueton';
    this.emocion = 0; // 0..1 (luces, gritos)
    this.emocionT = 0;
    this.toques = []; // [{c, t (ms del evento)}] por repartir
    this.sostenidas = new Map(); // tecla -> ms desde que se oprimió
    this.tocando = [false, false, false, false];
    this.padPrev = [];
    this.avisado = false;
    this.esperaT = 0; // s para la siguiente tanda
    this.tandas = 0;
    this.ganado = { noche: -1, monto: 0 };
    this.corroOn = false;
    this.pareja = false;
    this.ultimoGrito = 0;
    this.clave = null; // pista que suena (al cambiar de canción se cierra la tanda)
    this.bPrev = 0;
    this.reloj = 0;
    this.log = [];
    this._onKey = (e) => {
      if (!this.active || e.repeat) return;
      const c = TECLAS[e.code];
      if (c === undefined) return;
      this.toques.push({ c, t: e.timeStamp });
      this.sostenidas.set(e.code, e.timeStamp);
    };
    this._onKeyUp = (e) => this.sostenidas.delete(e.code);
  }

  // ------------------------------------------------------------ cuándo se puede
  /** ¿El jugador está parado en la pista del local donde está? (el local o null) */
  _enPista() {
    const g = this.game;
    const p = g.player;
    const r = g.interiors?.inside;
    if (!r?.pista || !p || p.dead || p.inVehicle || p.aiming) return null;
    if (Math.abs(p.y - r.y0) > 0.4) return null;
    const P = r.pista;
    const l = aLocal(r, p.x, p.z, _p);
    const m = BAILE_JUEGO.PISTA_MARGEN;
    if (l.x < P.x0 + m || l.x > P.x1 - m || l.z < P.z0 + m || l.z > P.z1 - m) return null;
    if (g.interiors._enBarra?.()) return null; // (la barra va primero)
    if (g.clubLife?.panico || g.clubLife?.r !== r) return null;
    return r;
  }

  /** E en la pista: empieza a bailar. Devuelve true si atendió la tecla. */
  interact() {
    if (this.active) return false;
    const r = this._enPista();
    if (!r) return false;
    this.empezar(r);
    return true;
  }

  // ------------------------------------------------------------ empezar y salir
  empezar(r = this.game.interiors?.inside) {
    const g = this.game;
    const cl = g.clubLife;
    if (!r || !cl) return false;
    this.active = true;
    this.r = r;
    this.estilo = tempoDe(r).estilo;
    this.S = null;
    this.esperaT = 0;
    this.toques.length = 0;
    this.sostenidas.clear();
    this.padPrev = this.game.input?._pad?.()?.buttons.map((b) => b.pressed) ?? [];
    this.emocion = 0;
    this.corroOn = false;
    this.ultimoGrito = 0;
    this.clave = g.radio?.pistaRumba?.(r.id)?.key ?? null;
    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', this._onKey, true);
      window.addEventListener('keyup', this._onKeyUp, true);
    }
    // Pareja en las salsotecas (alguien que baila solo cerca) o solo, de frente a la cámara.
    const p = g.player;
    this.pareja = BAILE_JUEGO.PAREJA && this.estilo === 'salsa' && !!cl.parejaJugador?.(true, { alcance: BAILE_JUEGO.PAREJA_ALCANCE, yaw: BAILE_JUEGO.DE_FRENTE ? (g.camRig?.yaw ?? p.state.yaw) + Math.PI / 2 : p.state.yaw });
    if (!this.pareja && BAILE_JUEGO.DE_FRENTE && g.camRig) p.state.yaw = g.camRig.yaw + Math.PI;
    this._paso();
    this.hud.mostrar(this.estilo, cl.ritmo().bpm);
    this._nuevaTanda();
    g.hud?.help?.('Toca cada flecha cuando llegue arriba, al compás: <kbd>A</kbd> <kbd>S</kbd> <kbd>W</kbd> <kbd>D</kbd> o las flechas. <kbd>E</kbd> para salir.', 5);
    this._log('empieza', { local: r.id, estilo: this.estilo, pareja: this.pareja });
    return true;
  }

  /** Deja de bailar (paga la tanda si se ganó algo). */
  salir(motivo = 'salir') {
    if (!this.active) return;
    const g = this.game;
    this._cerrarTanda(motivo);
    this.active = false;
    if (typeof window !== 'undefined') {
      window.removeEventListener('keydown', this._onKey, true);
      window.removeEventListener('keyup', this._onKeyUp, true);
    }
    g.clubLife?.bailarJugador(null);
    if (this.corroOn) g.clubLife?.corro(false);
    if (this.pareja) g.clubLife?.parejaJugador?.(false);
    this.corroOn = false;
    this.pareja = false;
    this.emocion = 0;
    this.S = null;
    this.hud.ocultar();
    this.avisado = true; // (no repetir el aviso apenas sale)
    this._log('sale', { motivo });
  }

  _nuevaTanda() {
    const cl = this.game.clubLife;
    const R = cl.ritmo();
    const semilla = (this.tandas++ * 7919 + (this.r?.id.length ?? 1) * 131 + Math.floor(R.tiempo)) >>> 0;
    const nivel = this.S ? Math.min(2, Math.floor(this.S.comboMax / 16)) : 0;
    this.S = nuevaTanda(PATRON_DE[this.estilo] ?? 'regueton', semilla, R.tiempo, R.bpm, { nivel });
    this.bPrev = R.tiempo;
  }

  /** Cierra la tanda en curso: propina (con tope por noche), frase y resumen. */
  _cerrarTanda(motivo) {
    const S = this.S;
    if (!S || S.pagada) return 0;
    S.pagada = true;
    const g = this.game;
    const noche = g.interiors?._nightKey?.() ?? 0;
    if (this.ganado.noche !== noche) this.ganado = { noche, monto: 0 };
    const plata = propinaTanda(S, this.ganado.monto);
    if (plata > 0) {
      this.ganado.monto += plata;
      g.addMoney?.(plata);
      g.audio?.ui?.('ok');
    }
    const R = resumenTanda(S);
    if (R.juzgadas >= 4) {
      const prop = plata > 0 ? ` · <span style="color:var(--money)">+$${plata}</span> de propina` : this.ganado.monto >= 1 && R.precision >= 0.45 && R.juzgadas >= 12 ? ' · ya le dieron bastante esta noche' : '';
      this.hud.resumen(`<b>${R.puntos.toLocaleString('es-CO')} puntos</b> · combo máximo ${R.comboMax} · ${Math.round(R.precision * 100)} %${prop}`, this.reloj);
      if (plata > 0) g.hud?.toast?.(`<span style="color:var(--money)">+$${plata}</span> · propina de la pista`, 2.6);
      // Alguien de cerca le dice algo (si bailó bien).
      if (R.precision >= 0.45 && R.comboMax >= 8) this._decir(plata > 0 ? 'baile_propina' : 'baile_corro');
    }
    this._log('tanda', { motivo, plata, ...R });
    return plata;
  }

  // ------------------------------------------------------------ cada cuadro
  /**
   * Filtra las acciones del cuadro mientras baila (Game.updatePlaying, antes
   * de usarlas): los carriles no mueven, E / Esc / apuntar / disparar / pausar
   * lo sacan, sostener un carril o mover el stick lo saca caminando.
   */
  mask(a) {
    if (!this.active) return a;
    const inp = this.game.input;
    const ahora = typeof performance !== 'undefined' ? performance.now() : 0;
    let sale = null;
    if (inp?.hit?.('Escape')) {
      a.pause = false;
      sale = 'esc';
    } else if (a.pause) sale = 'pausa';
    else if (a.interact) {
      a.interact = false;
      sale = 'e';
    } else if (a.aim || a.fire || a.firePressed || a.weaponSlot || a.weaponWheel) sale = 'arma';
    // Caminar: el stick (mando o pantalla) o una tecla de carril sostenida.
    const kx = (inp?.key?.('KeyD') ? 1 : 0) - (inp?.key?.('KeyA') ? 1 : 0);
    const ky = (inp?.key?.('KeyW') ? 1 : 0) - (inp?.key?.('KeyS') ? 1 : 0);
    const ox = a.moveX - kx;
    const oy = a.moveY - ky;
    if (!sale && Math.hypot(ox, oy) > BAILE_JUEGO.STICK_SALIR) sale = 'stick';
    if (!sale)
      for (const t0 of this.sostenidas.values())
        if (ahora - t0 > BAILE_JUEGO.SALIR_SOSTENER * 1000) {
          sale = 'camina';
          break;
        }
    if (sale) {
      this.salir(sale);
      return a;
    }
    a.moveX = 0;
    a.moveY = 0;
    a.sprint = a.jump = a.crouch = a.reload = a.enterVehicle = a.emote = a.handbrake = false;
    a.weaponCycle = 0;
    return a;
  }

  /** Un toque del carril `c` (pantalla táctil y pruebas) con la hora del evento en ms (performance.now). */
  tocar(c, t = typeof performance !== 'undefined' ? performance.now() : 0) {
    if (!this.active || c < 0 || c > 3) return;
    this.toques.push({ c, t });
  }

  update(dt, realDt = dt) {
    const g = this.game;
    this.reloj += realDt;
    if (!this.active) {
      // Aviso de la tecla E al pararse en la pista (una vez por arrimada).
      const r = g.state === 'playing' ? this._enPista() : null;
      if (r && !this.avisado) g.hud?.help?.('Presiona <kbd>E</kbd> para bailar', 4);
      this.avisado = !!r;
      return;
    }
    const p = g.player;
    const cl = g.clubLife;
    if (!cl || p.dead || p.inVehicle || g.interiors?.inside !== this.r || cl.panico || cl.r !== this.r) {
      this.salir(cl?.panico ? 'susto' : 'fuera');
      return;
    }
    const R = cl.ritmo();
    const b = R.tiempo;
    const spb = 60 / R.bpm;
    // ¿Cambió la canción (o saltó el reloj)? Se cierra la tanda y viene otra.
    const clave = g.radio?.pistaRumba?.(this.r.id)?.key ?? this.clave;
    const salto = Math.abs(b - this.bPrev - realDt / spb) > 1.2;
    this.bPrev = b;
    if (this.S && !this.S.terminada && (clave !== this.clave || salto || Math.abs(R.bpm - this.S.bpm) > 0.5)) {
      this._cerrarTanda('cancion');
      this.S = null;
      this.esperaT = 0.2;
    }
    this.clave = clave;
    if (!this.S) {
      if ((this.esperaT -= realDt) <= 0) this._nuevaTanda();
    }
    const S = this.S;
    const ev = (this._ev ??= []);
    ev.length = 0;
    if (S) {
      // Toques del teclado y la pantalla (con su hora) y del mando (de este cuadro).
      this._mando();
      const ahora = typeof performance !== 'undefined' ? performance.now() : 0;
      for (const q of this.toques) {
        if (ahora - q.t > 500) continue; // (de antes de una pausa)
        const bt = b - ((ahora - q.t) / 1000 + BAILE_JUEGO.LATENCIA) / spb;
        if (bt < S.c0 * 4 - 0.5) continue; // (en la cuenta de entrada los toques no cuentan)
        const e = tocarTanda(S, q.c, bt, ev);
        if (e) e.carril = q.c;
      }
      this.toques.length = 0;
      avanzarTanda(S, b, ev);
      for (const e of ev) this._evento(e);
      if (S.terminada) {
        this._cerrarTanda('fin');
        this.S = null;
        this.esperaT = BAILE_JUEGO.ENTRE_TANDAS;
      }
    } else this.toques.length = 0;
    // Teclas sostenidas (para iluminar el carril).
    for (let i = 0; i < 4; i++) this.tocando[i] = false;
    for (const code of this.sostenidas.keys()) this.tocando[TECLAS[code]] = true;
    // Emoción (luces, gritos, aplausos): sube con el combo, baja despacio.
    const em = emocionDe(this.S?.combo ?? 0);
    this.emocion += (em - this.emocion) * Math.min(1, realDt * (em > this.emocion ? 3 : 0.8));
    this._paso();
    this._corro();
    // Cuenta de entrada.
    let cuenta = null;
    if (this.S) {
      const falta = this.S.c0 * 4 - b;
      if (falta > 0 && falta <= RITMO.ENTRADA) cuenta = falta > 3 ? '4' : falta > 2 ? '3' : falta > 1 ? '2' : falta > 0.15 ? '1' : '¡Ya!';
    }
    this.hud.pintar(this.S, b, spb, BAILE_JUEGO.VISTA, this.reloj, this.tocando, cuenta);
  }

  /** Botones de cara del mando (flanco de subida). */
  _mando() {
    const pad = this.game.input?._pad?.();
    if (!pad) return;
    const ahora = typeof performance !== 'undefined' ? performance.now() : 0;
    for (let c = 0; c < 4; c++) {
      const i = BOTON_CARRIL[c];
      const on = !!pad.buttons[i]?.pressed;
      if (on && !this.padPrev[i]) this.toques.push({ c, t: ahora });
      this.padPrev[i] = on;
    }
  }

  _evento(e) {
    const g = this.game;
    if (e.tipo === 'fin') return;
    this.hud.juicioDe(e.tipo, e.nota?.carril ?? e.carril ?? -1, this.reloj);
    if (e.tipo === 'fallo') return;
    // Gritos de la gente cada tantos de combo.
    const c = e.combo;
    if (c >= BAILE_JUEGO.GRITO_CADA && c % BAILE_JUEGO.GRITO_CADA === 0 && c !== this.ultimoGrito) {
      this.ultimoGrito = c;
      g.salonSound?.vitorear?.(Math.min(1, 0.4 + c / 40));
      this._decir('baile_corro');
    }
  }

  /** Pasos más vistosos con el combo (al doble, la vuelta) y la energía con la emoción. */
  _paso() {
    const cl = this.game.clubLife;
    if (!cl || !this.active) return;
    const paso = this.pareja ? 'normal' : pasoVistoso(this.S?.combo ?? 0);
    const E = BAILE_JUEGO.ENERGIA;
    const energia = E[0] + E[1] * this.emocion;
    const J = cl.jug;
    if (J?.estilo === this.estilo && J.paso === paso && Math.abs((J.P?.energia ?? 0) - energia) < 0.04) return;
    cl.bailarJugador(this.estilo, { energia, paso });
  }

  /** Con combo alto la gente de cerca abre el corro y aplaude; si se cae el combo, vuelven a lo suyo. */
  _corro() {
    const cl = this.game.clubLife;
    const combo = this.S?.combo ?? (this.corroOn ? BAILE_JUEGO.COMBO_CORRO : 0);
    if (!this.corroOn && combo >= BAILE_JUEGO.COMBO_CORRO && !this.pareja) {
      this.corroOn = cl.corro(true) > 0;
      if (this.corroOn) {
        this.game.salonSound?.vitorear?.(0.6);
        this._decir('baile_corro');
      }
    } else if (this.corroOn && combo <= BAILE_JUEGO.COMBO_CORRO_FIN) {
      cl.corro(false);
      this.corroOn = false;
    }
    this.game.salonSound?.aplaudir?.(this.corroOn ? 0.45 + 0.55 * this.emocion : 0);
  }

  /** Alguien de cerca (del corro o de la pista) dice una frase de la categoría `cat`. */
  _decir(cat) {
    const g = this.game;
    const cl = g.clubLife;
    const p = g.player;
    if (!cl?.gente?.length || !g.dialogue) return;
    let best = null;
    let bd = Infinity;
    for (const m of cl.gente) {
      const C = m.club;
      if (!m.alive || C.estado !== 'normal' || (C.q.rol !== 'baile' && C.q.rol !== 'barra')) continue;
      const d = Math.hypot(m.sim.x - p.x, m.sim.z - p.z) - (C.enCorro ? 2 : 0) + Math.random() * 1.5;
      if (d < bd) {
        bd = d;
        best = m;
      }
    }
    if (best) g.dialogue.speak(best, cat, { label: best.look?.female ? 'Rumbera' : 'Rumbero' });
  }

  // ------------------------------------------------------------ pruebas
  _log(tipo, datos) {
    this.log.push({ t: +this.reloj.toFixed(2), tipo, ...datos });
    if (this.log.length > 30) this.log.shift();
  }

  /** Pruebas: pone al jugador en el centro de la pista del local donde está (mirando al fondo). */
  irPista() {
    const g = this.game;
    const r = g.interiors?.inside;
    if (!r?.pista) return null;
    const P = r.pista;
    const w = aMundo(r, (P.x0 + P.x1) / 2, (P.z0 + P.z1) / 2);
    const s = g.player.state;
    s.pos.x = w.x;
    s.pos.z = w.z;
    s.pos.y = r.y0;
    return { x: +w.x.toFixed(2), z: +w.z.toFixed(2), y: r.y0 };
  }

  /** Pruebas: le pega perfecto a las `n` notas siguientes (sin importar el tiempo). */
  acertar(n = 1) {
    let k = 0;
    for (let i = 0; i < n && this.S; i++) {
      let ev = acertarSiguiente(this.S);
      // (sin notas pendientes todavía: se arma el compás siguiente de una)
      if (!ev && this.S.hasta < this.S.c1) {
        avanzarTanda(this.S, (this.S.hasta - RITMO.ADELANTO) * 4 + 0.01);
        ev = acertarSiguiente(this.S);
      }
      if (!ev) break;
      this._evento(ev);
      k++;
    }
    this._paso();
    this._corro();
    return k;
  }

  info() {
    return {
      activo: this.active,
      local: this.r?.id ?? null,
      estilo: this.estilo,
      enPista: !!this._enPista(),
      pareja: this.pareja,
      corro: this.corroOn,
      emocion: +this.emocion.toFixed(3),
      paso: this.game.clubLife?.jug?.paso ?? null,
      tanda: this.S ? resumenTanda(this.S) : null,
      ganadoNoche: this.ganado.monto,
      carriles: CARRILES,
      hud: this.hud.info(),
      log: this.log.slice(-8),
    };
  }
}
