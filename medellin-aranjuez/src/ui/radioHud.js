// Letrero de la radio (arriba, al centro): el nombre de la emisora al
// cambiarla o al subirse al vehículo, y el título, artista y licencia de cada
// pista que empieza (atribución CC BY dentro del juego). Se arma solo, dentro
// de #hud, para que se oculte con el resto del HUD.

const CSS = `
#radio-hud { position: absolute; left: 50%; top: 2.4em; transform: translateX(-50%); text-align: center; pointer-events: none;
  font-family: var(--hud-cond); text-shadow: var(--shadow); transition: opacity 0.4s; opacity: 0; }
#radio-hud.on { opacity: 1; }
#radio-hud .r-nombre { font-size: 1.7em; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; }
#radio-hud .r-genero { font-size: 0.95em; color: var(--muted); letter-spacing: 0.12em; text-transform: uppercase; }
#radio-hud .r-pista { margin-top: 0.3em; font-family: var(--hud-font); font-size: 0.95em; color: var(--text); }
#radio-hud .r-lic { color: var(--muted); font-size: 0.85em; }
`;

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

export class RadioHud {
  constructor() {
    this.el = null;
    this.timer = null;
  }

  _el() {
    if (this.el || typeof document === 'undefined') return this.el;
    const padre = document.getElementById('hud');
    if (!padre) return null;
    const st = document.createElement('style');
    st.textContent = CSS;
    document.head.appendChild(st);
    this.el = document.createElement('div');
    this.el.id = 'radio-hud';
    this.el.innerHTML = '<div class="r-nombre"></div><div class="r-genero"></div><div class="r-pista"></div>';
    padre.appendChild(this.el);
    return this.el;
  }

  _mostrar(seg) {
    const el = this._el();
    if (!el) return;
    el.classList.add('on');
    clearTimeout(this.timer);
    this.timer = setTimeout(() => el.classList.remove('on'), seg * 1000);
  }

  /** Nombre de la emisora (al cambiar o al subirse). */
  emisora({ nombre, genero, color }) {
    const el = this._el();
    if (!el) return;
    const n = el.querySelector('.r-nombre');
    n.textContent = nombre;
    n.style.color = color;
    el.querySelector('.r-genero').textContent = genero;
    el.querySelector('.r-pista').innerHTML = '';
    this._mostrar(3);
  }

  /** Pista que empieza: título, artista y licencia. */
  pista(p, color) {
    const el = this._el();
    if (!el) return;
    el.querySelector('.r-pista').innerHTML = `<span style="color:${esc(color)}">&#9834;</span> "${esc(p.titulo)}" · ${esc(p.artista)} <span class="r-lic">(${esc(p.licencia)})</span>`;
    this._mostrar(5);
  }
}
