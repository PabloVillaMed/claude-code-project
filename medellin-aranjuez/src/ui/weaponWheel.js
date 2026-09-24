// Rueda de armas (mantener Tab): se elige con la dirección del ratón y el
// tiempo se ralentiza mientras está abierta.

import { WEAPONS } from '../sim/weapons.js';
import { weaponIconHtml } from './icons.js';

export class WeaponWheel {
  constructor(game) {
    this.game = game;
    this.el = document.getElementById('weapon-wheel');
    this.open = false;
    this.vx = 0;
    this.vy = 0;
    this.selected = null;
  }

  show(inventory) {
    this.open = true;
    this.vx = 0;
    this.vy = 0;
    this.selected = inventory.currentId;
    this.el.classList.remove('hidden');
    this._render(inventory);
  }

  _render(inventory) {
    const R = 170;
    const n = WEAPONS.length;
    let html = '';
    WEAPONS.forEach((w, i) => {
      const a = (i / n) * Math.PI * 2 - Math.PI / 2;
      const x = 230 + Math.cos(a) * R;
      const y = 230 + Math.sin(a) * R;
      const owned = inventory.has(w.id);
      const ammo = owned && w.kind === 'gun' ? `${inventory.owned.get(w.id).mag + inventory.owned.get(w.id).reserve}` : '';
      html += `<div class="wheel-slot ${owned ? 'owned' : ''} ${w.id === this.selected ? 'sel' : ''}" style="left:${x}px;top:${y}px"><div class="ico">${weaponIconHtml(w.id)}</div><div class="nm">${w.name}</div><small>${ammo}</small></div>`;
    });
    const cur = WEAPONS.find((w) => w.id === this.selected);
    html += `<div class="wheel-center">${cur ? cur.name : ''}</div>`;
    this.el.innerHTML = html;
  }

  /** Mueve el cursor virtual; devuelve el arma resaltada. */
  update(lookX, lookY, inventory) {
    this.vx += lookX * 120;
    this.vy += lookY * 120;
    const l = Math.hypot(this.vx, this.vy);
    if (l > 40) {
      this.vx = (this.vx / l) * 60;
      this.vy = (this.vy / l) * 60;
      let a = Math.atan2(this.vy, this.vx) + Math.PI / 2;
      if (a < 0) a += Math.PI * 2;
      const n = WEAPONS.length;
      const idx = Math.round((a / (Math.PI * 2)) * n) % n;
      const w = WEAPONS[idx];
      if (inventory.has(w.id) && w.id !== this.selected) {
        this.selected = w.id;
        this._render(inventory);
      }
    }
    return this.selected;
  }

  close() {
    this.open = false;
    this.el.classList.add('hidden');
    return this.selected;
  }
}
