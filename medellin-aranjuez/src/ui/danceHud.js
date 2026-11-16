// La pista de ritmo del minijuego de baile (game/danceGame.js): una columna
// sobria a la derecha con los cuatro carriles (← ↓ ↑ →), las flechas que
// suben hacia la fila de llegada al compás de la música, el juicio de cada
// toque, el combo con su multiplicador, la cuenta de entrada y el resumen de
// la tanda. Se arma sola dentro de #hud (se oculta con el resto del HUD) y
// usa la tipografía y los paneles del HUD (ui/styles.css).
//
// Barato: las flechas son un grupo fijo de elementos que se reciclan (solo
// cambia su transform y su clase); nada se crea por cuadro.

import { multiplicador } from '../sim/danceGame.js';

const CARRIL_COLOR = ['#e8b64c', '#7fcf95', '#7db8e8', '#e88aa0'];
/** Flechas de la pista que pueden verse a la vez (las demás esperan). */
const FLECHAS = 28;
/** Giro del dibujo de la flecha (apunta hacia arriba) por carril. */
const GIRO = [-90, 180, 0, 90];
const FLECHA_SVG = '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M24 6 42 25H31v16H17V25H6z"/></svg>';

const CSS = `
#baile-hud { position: absolute; right: 2.2em; top: 50%; transform: translateY(-50%); width: 13.4em; pointer-events: none;
  font-family: var(--hud-cond); opacity: 0; transition: opacity 0.35s; }
#baile-hud.on { opacity: 1; }
#baile-hud .bh-cab { display: flex; justify-content: space-between; align-items: baseline; padding: 0 0.15em 0.35em;
  letter-spacing: 0.12em; text-transform: uppercase; font-size: 0.85em; color: var(--muted); }
#baile-hud .bh-cab b { color: var(--text); font-weight: 600; letter-spacing: 0.08em; }
#baile-hud .bh-pista { position: relative; height: min(46vh, 26em); overflow: hidden; border-radius: 0.35em;
  background: linear-gradient(180deg, rgba(8,10,12,0.78), rgba(8,10,12,0.5) 55%, rgba(8,10,12,0.26));
  box-shadow: inset 0 0 0 1px rgba(255,255,255,0.08); } /* (sin backdrop-filter: desenfocar el canvas 3D en cada cuadro cuesta fps) */
#baile-hud .bh-car { position: absolute; top: 0; bottom: 0; width: 25%; border-left: 1px solid rgba(255,255,255,0.05); }
#baile-hud .bh-car:first-child { border-left: 0; }
#baile-hud .bh-car.toca { background: linear-gradient(180deg, rgba(255,255,255,0.10), rgba(255,255,255,0) 40%); }
#baile-hud .bh-rec, #baile-hud .bh-n { position: absolute; left: 0; top: 0; width: 25%; display: flex; justify-content: center; }
#baile-hud .bh-rec svg, #baile-hud .bh-n svg { width: 2.5em; height: 2.5em; }
#baile-hud .bh-rec { transform: translateY(0.55em); }
#baile-hud .bh-rec svg { fill: rgba(255,255,255,0.04); stroke: rgba(255,255,255,0.55); stroke-width: 2.2; stroke-linejoin: round;
  transition: transform 0.08s ease-out; }
#baile-hud .bh-rec.pulso svg { transform: scale(1.08); stroke: rgba(255,255,255,0.8); }
#baile-hud .bh-rec.dio svg { stroke: var(--c); fill: var(--c); filter: drop-shadow(0 0 0.5em var(--c)); }
#baile-hud .bh-n { will-change: transform; }
#baile-hud .bh-n svg { fill: var(--c); stroke: rgba(0,0,0,0.45); stroke-width: 1.5; stroke-linejoin: round;
  filter: drop-shadow(0 0.15em 0.2em rgba(0,0,0,0.5)); }
#baile-hud .bh-n.off { display: none; }
#baile-hud .bh-n.paso { opacity: 0.25; }
#baile-hud .bh-n.media svg { stroke: rgba(255,255,255,0.75); }
#baile-hud .bh-juicio { position: absolute; left: 0; right: 0; top: 4.2em; text-align: center; font-size: 1.55em; font-weight: 700;
  letter-spacing: 0.14em; text-transform: uppercase; text-shadow: var(--shadow); opacity: 0; transition: opacity 0.25s; }
#baile-hud .bh-juicio.ve { opacity: 1; transition: none; }
#baile-hud .bh-cuenta { position: absolute; left: 0; right: 0; top: 40%; text-align: center; font-size: 3.4em; font-weight: 700;
  letter-spacing: 0.06em; text-shadow: var(--shadow); color: var(--text); }
#baile-hud .bh-combo { display: flex; justify-content: space-between; align-items: baseline; padding: 0.35em 0.15em 0; }
#baile-hud .bh-combo .n { font-size: 2.1em; font-weight: 700; line-height: 1; color: var(--text); transition: color 0.2s; }
#baile-hud .bh-combo .n.alto { color: var(--accent); }
#baile-hud .bh-combo .k { font-size: 0.8em; letter-spacing: 0.2em; text-transform: uppercase; color: var(--muted); margin-left: 0.3em; }
#baile-hud .bh-combo .x { font-size: 1.2em; font-weight: 600; color: var(--accent); }
#baile-hud .bh-combo .pts { font-size: 1.05em; color: var(--muted); font-variant-numeric: tabular-nums; }
#baile-hud .bh-barra { height: 0.18em; margin-top: 0.45em; background: rgba(255,255,255,0.12); border-radius: 0.1em; overflow: hidden; }
#baile-hud .bh-barra i { display: block; height: 100%; width: 0; background: var(--accent); }
#baile-hud .bh-teclas { margin-top: 0.55em; font-family: var(--hud-font); font-size: 0.82em; color: var(--muted); line-height: 1.5; text-align: center; }
#baile-hud .bh-res { margin-top: 0.5em; padding: 0.5em 0.7em; font-family: var(--hud-font); font-size: 0.9em; line-height: 1.45;
  background: var(--panel-strong); border-left: 0.18em solid var(--accent); display: none; }
#baile-hud .bh-res.ve { display: block; }
#baile-hud .bh-res b { font-family: var(--hud-cond); font-weight: 600; letter-spacing: 0.06em; }
html.touch-on #baile-hud .bh-teclas { display: none; }
html.touch-on #baile-hud { top: 42%; }
`;

const JUICIOS = {
  perfecto: { txt: '¡Perfecto!', color: '#ffd76a' },
  bien: { txt: 'Bien', color: '#9fe3b0' },
  justo: { txt: 'Justo', color: '#cfd8e3' },
  fallo: { txt: 'Fallo', color: '#e87a7a' },
};

const NOMBRES = { regueton: 'Reguetón', salsa: 'Salsa', popular: 'Popular', electronica: 'Electrónica' };

export class DanceHud {
  constructor() {
    this.el = null;
    this.alto = 0;
    this.notas = [];
    this.rec = [];
    this.car = [];
    this.recDio = [0, 0, 0, 0];
    this.juicioT = 0;
    this.visible = false;
    this.ultCombo = -1;
    this.ultPts = -1;
    this.ultMult = -1;
    this.ultCuenta = null;
  }

  _el() {
    if (this.el || typeof document === 'undefined') return this.el;
    const padre = document.getElementById('hud');
    if (!padre) return null;
    const st = document.createElement('style');
    st.textContent = CSS;
    document.head.appendChild(st);
    const el = document.createElement('div');
    el.id = 'baile-hud';
    const carriles = [0, 1, 2, 3].map((i) => `<div class="bh-car" style="left:${i * 25}%"></div>`).join('');
    const rec = [0, 1, 2, 3].map((i) => `<div class="bh-rec" style="left:${i * 25}%;--c:${CARRIL_COLOR[i]}"><span style="display:block;transform:rotate(${GIRO[i]}deg)">${FLECHA_SVG}</span></div>`).join('');
    let notas = '';
    for (let k = 0; k < FLECHAS; k++) notas += `<div class="bh-n off">${FLECHA_SVG}</div>`;
    el.innerHTML = `<div class="bh-cab"><span class="bh-estilo"></span><b class="bh-bpm"></b></div>
      <div class="bh-pista">${carriles}${rec}${notas}<div class="bh-juicio"></div><div class="bh-cuenta"></div></div>
      <div class="bh-combo"><div><span class="n">0</span><span class="k">combo</span></div><span class="x">×1</span><span class="pts">0</span></div>
      <div class="bh-barra"><i></i></div>
      <div class="bh-teclas"><kbd>A</kbd> <kbd>S</kbd> <kbd>W</kbd> <kbd>D</kbd> o las flechas · <kbd>E</kbd> salir</div>
      <div class="bh-res"></div>`;
    padre.appendChild(el);
    this.el = el;
    this.pista = el.querySelector('.bh-pista');
    this.car = [...el.querySelectorAll('.bh-car')];
    this.rec = [...el.querySelectorAll('.bh-rec')];
    this.notas = [...el.querySelectorAll('.bh-n')].map((d) => ({ d, svg: d.firstElementChild, carril: -1, clase: 'off' }));
    this.juicio = el.querySelector('.bh-juicio');
    this.cuenta = el.querySelector('.bh-cuenta');
    this.comboN = el.querySelector('.bh-combo .n');
    this.multX = el.querySelector('.bh-combo .x');
    this.ptsEl = el.querySelector('.bh-combo .pts');
    this.barra = el.querySelector('.bh-barra i');
    this.res = el.querySelector('.bh-res');
    this.estiloEl = el.querySelector('.bh-estilo');
    this.bpmEl = el.querySelector('.bh-bpm');
    return el;
  }

  /** Muestra la pista del estilo (al empezar a bailar). */
  mostrar(estilo, bpm) {
    const el = this._el();
    if (!el) return;
    el.classList.add('on');
    this.visible = true;
    this.estiloEl.textContent = NOMBRES[estilo] ?? estilo;
    this.bpmEl.textContent = `${Math.round(bpm)} bpm`;
    this.res.classList.remove('ve');
    this.alto = this.pista.clientHeight || 300;
    this.ultCombo = this.ultPts = this.ultMult = -1;
  }

  ocultar() {
    if (!this.el) return;
    this.el.classList.remove('on');
    this.visible = false;
    for (const n of this.notas) this._clase(n, 'off');
  }

  _clase(n, c) {
    if (n.clase === c) return;
    n.clase = c;
    n.d.className = `bh-n ${c}`;
  }

  /** El juicio de un toque (perfecto, bien, justo, fallo) y el destello del carril. */
  juicioDe(tipo, carril, ahora) {
    if (!this.el) return;
    const J = JUICIOS[tipo];
    if (!J) return;
    this.juicio.textContent = J.txt;
    this.juicio.style.color = J.color;
    this.juicio.classList.add('ve');
    this.juicioT = ahora + 0.32;
    if (carril >= 0 && tipo !== 'fallo') this.recDio[carril] = ahora + 0.12;
  }

  /** El resumen de la tanda (al terminar o al salir); `html` ya armado. */
  resumen(html, ahora, seg = 4.5) {
    if (!this._el()) return;
    this.res.innerHTML = html;
    this.res.classList.add('ve');
    this.resT = ahora + seg;
  }

  /**
   * Repinta la pista: `S` la tanda (sim/danceGame.js), `b` el tiempo de la
   * música, `spb` segundos por tiempo, `vista` s que se ven por adelantado,
   * `ahora` reloj (s), `tocando` carriles sostenidos, `cuenta` texto de la
   * cuenta de entrada (o null).
   */
  pintar(S, b, spb, vista, ahora, tocando, cuenta) {
    if (!this.visible || !this.el) return;
    if (!this.alto) this.alto = this.pista.clientHeight || 300;
    const H = this.alto;
    const y0 = H * 0.035; // fila de llegada (arriba)
    const pxPorSeg = (H - y0) / vista;
    // Las flechas que vienen (de las más próximas a las más lejanas).
    let k = 0;
    if (S)
      for (const n of S.notas) {
        if (k >= this.notas.length) break;
        const dt = (n.b - b) * spb;
        if (dt > vista || n.estado === 1 || dt < -0.45) continue; // (las acertadas se van: la llegada destella)
        const N = this.notas[k++];
        if (N.carril !== n.carril) {
          N.carril = n.carril;
          N.d.style.left = `${n.carril * 25}%`;
          N.d.style.setProperty('--c', CARRIL_COLOR[n.carril]);
          N.svg.style.transform = `rotate(${GIRO[n.carril]}deg)`;
        }
        N.d.style.transform = `translate3d(0, ${(y0 + dt * pxPorSeg).toFixed(1)}px, 0)`;
        // Las de contratiempo, con borde claro (para leer el ritmo).
        this._clase(N, n.estado === 2 ? 'paso' : n.b % 1 !== 0 ? 'media' : '');
      }
    for (; k < this.notas.length; k++) this._clase(this.notas[k], 'off');
    // La fila de llegada late con el tiempo y se ilumina al acertar.
    const fase = b - Math.floor(b);
    const pulso = fase < 0.12;
    for (let i = 0; i < 4; i++) {
      const c = (pulso ? 'pulso ' : '') + (ahora < this.recDio[i] ? 'dio' : '');
      const R = this.rec[i];
      if (R._c !== c) {
        R._c = c;
        R.className = `bh-rec ${c}`;
      }
      const t = !!tocando?.[i];
      if (this.car[i]._t !== t) {
        this.car[i]._t = t;
        this.car[i].classList.toggle('toca', t);
      }
    }
    if (this.juicioT && ahora > this.juicioT) {
      this.juicioT = 0;
      this.juicio.classList.remove('ve');
    }
    if (this.resT && ahora > this.resT) {
      this.resT = 0;
      this.res.classList.remove('ve');
    }
    if (cuenta !== this.ultCuenta) {
      this.ultCuenta = cuenta;
      this.cuenta.textContent = cuenta ?? '';
    }
    if (!S) return;
    if (S.combo !== this.ultCombo) {
      this.ultCombo = S.combo;
      this.comboN.textContent = String(S.combo);
      this.comboN.classList.toggle('alto', S.combo >= 10);
    }
    const mult = multiplicador(S.combo);
    if (mult !== this.ultMult) {
      this.ultMult = mult;
      this.multX.textContent = `×${mult}`;
    }
    if (S.puntos !== this.ultPts) {
      this.ultPts = S.puntos;
      this.ptsEl.textContent = S.puntos.toLocaleString('es-CO');
    }
    const tot = Math.max(1, (S.c1 - S.c0) * 4);
    this.barra.style.width = `${Math.max(0, Math.min(100, ((b - S.c0 * 4) / tot) * 100)).toFixed(1)}%`;
  }

  /** Estado para pruebas. */
  info() {
    return { visible: this.visible, flechas: this.notas.filter((n) => n.clase !== 'off').length, combo: this.comboN?.textContent ?? null, juicio: this.juicio?.classList.contains('ve') ? this.juicio.textContent : null };
  }
}
