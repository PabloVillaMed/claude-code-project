// HUD al estilo de los mundos abiertos: plata, estrellas de búsqueda, arma y
// munición, salud/chaleco, minimapa giratorio con GPS, avisos y objetivos.
// Estética sobria: mapa oscuro, íconos de silueta y tipografía condensada.

import { MAPA, MAP_MAX_X, MAP_MAX_Z, MAP_MIN_X, MAP_MIN_Z, RIVER, terrainHeight } from '../sim/terrain.js';
import { frameCorners } from '../sim/geom2d.js';
import { yawFromDir } from '../sim/math.js';
import { WEAPONS } from '../sim/weapons.js';
import { STAR_SVG, preloadWeaponIcons, weaponIconHtml } from './icons.js';

const $ = (id) => document.getElementById(id);

const MAP_PAD = 60;
const MAP_SCALE = 1.5; // px por metro en el mapa pre-renderizado
const POI_STYLE = {
  landmark: { color: '#e8b64c', letter: '•' },
  shop: { color: '#d9534f', letter: '$' },
  food: { color: '#f4a261', letter: 'C' },
  service: { color: '#4f8fd9', letter: '+' },
  mission: { color: '#e8b64c', letter: '!' },
};
// Letras sencillas (sin emojis) dentro de cada punto del mapa.
const POI_LETTER = { parque: 'P', iglesia: 'I', museo: 'M', botanico: 'J', explora: 'E', metro: 'M', hospital: 'H', cementerio: 'C', moravia: 'V', armeria: '$', taller: 'T', cancha: 'F', mirador: 'O' };
const MM_RES = 2; // el minimapa se dibuja al doble de resolución (nítido en 1440p/4K)

export class Hud {
  constructor(game) {
    this.game = game;
    this.el = $('hud');
    this.minimap = $('minimap');
    this.mctx = this.minimap.getContext('2d');
    this.toasts = $('toasts');
    this.bigTimer = 0;
    this.helpTimer = 0;
    this.poiTimer = 0;
    this.moneyShown = 0;
    this.lastWanted = -1;
    this.damageTimer = 0;
    this.mapCanvas = this._prerenderMap();
    this.fullmap = $('fullmap');
    this.fctx = this.fullmap.getContext('2d');
    this.route = null;
    this.fps = { frames: 0, t: 0, value: 0 };
    preloadWeaponIcons(WEAPONS.map((w) => w.id));
  }

  show(on) {
    this.el.classList.toggle('hidden', !on);
  }

  // --------------------------------------------------------- mapa base
  _prerenderMap() {
    const city = this.game.city;
    const minX = MAP_MIN_X - MAP_PAD;
    const minZ = MAP_MIN_Z - MAP_PAD;
    const w = (MAP_MAX_X - MAP_MIN_X + MAP_PAD * 2) * MAP_SCALE;
    const h = (MAP_MAX_Z - MAP_MIN_Z + MAP_PAD * 2) * MAP_SCALE;
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d');
    this.mapOrigin = { minX, minZ };
    const X = (x) => (x - minX) * MAP_SCALE;
    const Z = (z) => (z - minZ) * MAP_SCALE;
    // Fondo con sombreado de altura (ladera).
    for (let py = 0; py < h; py += 6) {
      for (let px = 0; px < w; px += 6) {
        const x = px / MAP_SCALE + minX;
        const z = py / MAP_SCALE + minZ;
        const t = terrainHeight(x, z);
        const k = Math.max(0, Math.min(1, (t + 60) / 210));
        ctx.fillStyle = `rgb(${24 + k * 12},${30 + k * 12},${28 + k * 10})`;
        ctx.fillRect(px, py, 6, 6);
      }
    }
    const poly = (pts) => {
      ctx.beginPath();
      pts.forEach(([x, z], i) => (i ? ctx.lineTo(X(x), Z(z)) : ctx.moveTo(X(x), Z(z))));
      ctx.closePath();
    };
    const line = (pts) => {
      ctx.beginPath();
      pts.forEach(([x, z], i) => (i ? ctx.lineTo(X(x), Z(z)) : ctx.moveTo(X(x), Z(z))));
    };
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    // Río y quebradas.
    ctx.strokeStyle = '#2d5566';
    ctx.lineWidth = RIVER.half * 2 * MAP_SCALE;
    if (RIVER.pts.length) {
      line(RIVER.pts);
      ctx.stroke();
    }
    ctx.lineWidth = 3 * MAP_SCALE;
    for (const w of city.water) {
      line(w.pts);
      ctx.stroke();
    }
    // Manzanas (con su andén) y zonas verdes.
    for (const b of city.blocks) {
      ctx.fillStyle = b.type === 'residencial' ? '#2c3236' : '#2f4432';
      poly(b.curb);
      ctx.fill();
    }
    for (const p of city.props) {
      if (!p.poly || !['garden', 'plazaPoly', 'fieldPoly'].includes(p.type)) continue;
      ctx.fillStyle = p.type === 'plazaPoly' ? '#46463e' : p.type === 'fieldPoly' ? '#36573a' : '#35523a';
      poly(p.poly);
      ctx.fill();
    }
    // Vías: más anchas y claras las principales.
    const edges = [...city.edges].sort((p, q) => p.width - q.width);
    for (const e of edges) {
      ctx.strokeStyle = e.width >= 9 ? '#9aa1a6' : '#7d858c';
      ctx.lineWidth = e.width * MAP_SCALE;
      line(e.pts);
      ctx.stroke();
    }
    // Edificios.
    for (const b of city.buildings) {
      const floors = (b.topY - b.groundY) / 3;
      const k = Math.min(1, floors / 8);
      const c = 58 + k * 22;
      ctx.fillStyle = `rgb(${c},${c + 4},${c + 9})`;
      poly(frameCorners(b.frame));
      ctx.fill();
    }
    // Metro (línea A).
    ctx.strokeStyle = '#3f9a67';
    ctx.lineWidth = 5;
    for (const l of MAPA.rail) {
      if (l.kind !== 'subway') continue;
      line(l.pts);
      ctx.stroke();
    }
    return c;
  }

  worldToMap(x, z) {
    return { u: (x - this.mapOrigin.minX) * MAP_SCALE, v: (z - this.mapOrigin.minZ) * MAP_SCALE };
  }

  // --------------------------------------------------------- minimapa
  drawMinimap(state) {
    const ctx = this.mctx;
    const W = this.minimap.width / MM_RES;
    const H = this.minimap.height / MM_RES;
    const p = this.worldToMap(state.x, state.z);
    const zoom = state.inVehicle ? 0.55 + 0.35 * Math.max(0, 1 - state.speed / 30) : 0.95;
    ctx.setTransform(MM_RES, 0, 0, MM_RES, 0, 0);
    ctx.save();
    ctx.fillStyle = '#15191c';
    ctx.fillRect(0, 0, W, H);
    ctx.translate(W / 2, H * 0.62);
    ctx.scale(zoom, zoom);
    ctx.rotate(state.camYaw);
    ctx.drawImage(this.mapCanvas, -p.u, -p.v);
    // Ruta GPS.
    if (this.route && this.route.length > 1) {
      ctx.strokeStyle = this.routeColor ?? '#b98ae8';
      ctx.lineWidth = 5;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      this.route.forEach((pt, i) => {
        const m = this.worldToMap(pt.x, pt.z);
        if (i === 0) ctx.moveTo(m.u - p.u, m.v - p.v);
        else ctx.lineTo(m.u - p.u, m.v - p.v);
      });
      ctx.stroke();
    }
    // Zona de búsqueda policial: círculo rojo/azul donde te están buscando.
    if (state.searchZone) {
      const z = state.searchZone;
      const m = this.worldToMap(z.x, z.z);
      const on = Math.floor(performance.now() / 400) % 2;
      ctx.beginPath();
      ctx.arc(m.u - p.u, m.v - p.v, z.r * MAP_SCALE, 0, Math.PI * 2);
      ctx.fillStyle = on ? 'rgba(255,45,45,0.16)' : 'rgba(45,107,255,0.16)';
      ctx.fill();
      ctx.strokeStyle = on ? 'rgba(255,45,45,0.8)' : 'rgba(45,107,255,0.8)';
      ctx.lineWidth = 2.5 / zoom;
      ctx.stroke();
    }
    const R = Math.hypot(W, H) / zoom;
    const blip = (x, z, color, size = 5, clampEdge = false, letter = null) => {
      const m = this.worldToMap(x, z);
      let du = m.u - p.u;
      let dv = m.v - p.v;
      const d = Math.hypot(du, dv);
      const maxR = Math.min(W, H) * 0.55 / zoom;
      if (d > maxR) {
        if (!clampEdge) return;
        du = (du / d) * maxR;
        dv = (dv / d) * maxR;
      }
      if (d > R) return;
      ctx.save();
      ctx.translate(du, dv);
      ctx.rotate(-state.camYaw);
      ctx.fillStyle = color;
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.lineWidth = 1.2 / zoom;
      ctx.beginPath();
      ctx.arc(0, 0, size / zoom, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      if (letter) {
        ctx.fillStyle = '#101214';
        ctx.font = `700 ${Math.round((size * 1.45) / zoom)}px 'Barlow Condensed', Arial`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(letter, 0, 1);
      }
      ctx.restore();
    };
    for (const poi of this.game.city.pois) {
      const st = POI_STYLE[poi.type] ?? POI_STYLE.landmark;
      blip(poi.x, poi.z, st.color, 7, poi.type !== 'landmark', POI_LETTER[poi.id] ?? st.letter);
    }
    for (const e of state.enemies) blip(e.x, e.z, e.police ? (Math.floor(performance.now() / 250) % 2 ? '#ff2d2d' : '#2d6bff') : '#ff3b3b', 4);
    for (const v of state.policeCars) blip(v.x, v.z, Math.floor(performance.now() / 250) % 2 ? '#2d6bff' : '#ff2d2d', 5);
    if (state.target) blip(state.target.x, state.target.z, '#e8b64c', 7, true, null);
    if (state.waypoint) blip(state.waypoint.x, state.waypoint.z, '#b98ae8', 6, true, null);
    // Jugador.
    ctx.rotate(-state.playerYaw);
    ctx.fillStyle = '#f2f2f2';
    ctx.strokeStyle = '#101214';
    ctx.lineWidth = 2 / zoom;
    ctx.beginPath();
    ctx.moveTo(0, -9 / zoom);
    ctx.lineTo(6 / zoom, 7 / zoom);
    ctx.lineTo(0, 3 / zoom);
    ctx.lineTo(-6 / zoom, 7 / zoom);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
    // Brújula: la N se mueve por el borde del minimapa según la cámara.
    const nx = Math.sin(state.camYaw);
    const ny = -Math.cos(state.camYaw);
    const cx = W / 2;
    const cy = H * 0.62;
    const t = Math.min(nx ? (nx > 0 ? W - 8 - cx : 8 - cx) / nx : Infinity, ny ? (ny > 0 ? H - 8 - cy : 8 - cy) / ny : Infinity);
    this._set('compass-n', 'left', `${(((cx + nx * t) / W) * 100).toFixed(1)}%`);
    this._set('compass-n', 'top', `${(((cy + ny * t) / H) * 100).toFixed(1)}%`);
  }

  // --------------------------------------------------------- mapa completo
  drawFullMap(state) {
    const ctx = this.fctx;
    const S = this.fullmap.width;
    ctx.fillStyle = '#101315';
    ctx.fillRect(0, 0, S, S);
    const k = S / this.mapCanvas.width;
    ctx.drawImage(this.mapCanvas, 0, 0, S, (this.mapCanvas.height * S) / this.mapCanvas.width);
    const toS = (x, z) => {
      const m = this.worldToMap(x, z);
      return { x: m.u * k, y: m.v * k };
    };
    if (this.route) {
      ctx.strokeStyle = '#b98ae8';
      ctx.lineWidth = 4;
      ctx.beginPath();
      this.route.forEach((pt, i) => {
        const s = toS(pt.x, pt.z);
        if (i === 0) ctx.moveTo(s.x, s.y);
        else ctx.lineTo(s.x, s.y);
      });
      ctx.stroke();
    }
    ctx.font = "600 14px 'Barlow Condensed', Arial";
    for (const poi of this.game.city.pois) {
      const s = toS(poi.x, poi.z);
      const st = POI_STYLE[poi.type] ?? POI_STYLE.landmark;
      ctx.fillStyle = st.color;
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(s.x, s.y, 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#111';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(POI_LETTER[poi.id] ?? st.letter, s.x, s.y + 1);
      const discovered = this.game.discovered.has(poi.id);
      ctx.fillStyle = discovered ? '#f2f2f2' : 'rgba(255,255,255,0.5)';
      ctx.strokeStyle = 'rgba(0,0,0,0.85)';
      ctx.textAlign = 'left';
      ctx.lineWidth = 3;
      ctx.strokeText(poi.name, s.x + 12, s.y);
      ctx.fillText(poi.name, s.x + 12, s.y);
    }
    if (state.waypoint) {
      const s = toS(state.waypoint.x, state.waypoint.z);
      ctx.fillStyle = '#b98ae8';
      ctx.beginPath();
      ctx.arc(s.x, s.y, 8, 0, Math.PI * 2);
      ctx.fill();
    }
    if (state.target) {
      const s = toS(state.target.x, state.target.z);
      ctx.fillStyle = '#e8b64c';
      ctx.beginPath();
      ctx.arc(s.x, s.y, 8, 0, Math.PI * 2);
      ctx.fill();
    }
    const pp = toS(state.x, state.z);
    ctx.save();
    ctx.translate(pp.x, pp.y);
    ctx.rotate(-state.playerYaw);
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = '#000';
    ctx.beginPath();
    ctx.moveTo(0, -11);
    ctx.lineTo(8, 9);
    ctx.lineTo(0, 4);
    ctx.lineTo(-8, 9);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
    const dot = (c) => `<i class="dot" style="background:${c}"></i>`;
    $('map-legend').innerHTML = `Lugares descubiertos <b>${this.game.discovered.size}/${this.game.city.pois.length}</b><span>${dot(POI_STYLE.landmark.color)}Lugares</span><span>${dot(POI_STYLE.shop.color)}Tienda</span><span>${dot(POI_STYLE.food.color)}Comida</span><span>${dot(POI_STYLE.service.color)}Servicios</span><span>${dot(POI_STYLE.mission.color)}Misiones</span>`;
  }

  /** Convierte un clic en el mapa completo a coordenadas del mundo. */
  fullMapToWorld(clientX, clientY) {
    const r = this.fullmap.getBoundingClientRect();
    const sx = ((clientX - r.left) / r.width) * this.fullmap.width;
    const sy = ((clientY - r.top) / r.height) * this.fullmap.height;
    const k = this.fullmap.width / this.mapCanvas.width;
    return { x: sx / k / MAP_SCALE + this.mapOrigin.minX, z: sy / k / MAP_SCALE + this.mapOrigin.minZ };
  }

  // --------------------------------------------------------- DOM
  /** Escribe en el DOM solo si el valor cambió (cada escritura invalida estilos y layout). */
  _set(id, prop, value) {
    const cache = (this._dom ??= {});
    const byProp = (cache[prop] ??= new Map());
    if (byProp.get(id) === value) return;
    byProp.set(id, value);
    const el = $(id);
    if (!el) return;
    if (prop === 'text') el.textContent = value;
    else if (prop === 'html') el.innerHTML = value;
    else el.style[prop] = value;
  }

  _toggle(id, cls, on) {
    const cache = (this._cls ??= new Map());
    const key = `${id} ${cls}`;
    on = !!on;
    if (cache.get(key) === on) return;
    cache.set(key, on);
    $(id)?.classList.toggle(cls, on);
  }

  // --------------------------------------------------------- actualización
  update(dt, st) {
    // FPS.
    // Medido con el reloj real (dt viene limitado a 50 ms).
    const now = performance.now();
    this.fps.frames++;
    this.fps.start ??= now;
    if (now - this.fps.start >= 500) {
      this.fps.value = Math.round((this.fps.frames * 1000) / (now - this.fps.start));
      this.fps.frames = 0;
      this.fps.start = now;
      const g = this.game;
      const res = g.resScale < 0.999 ? ` · res ${Math.round(g.resScale * 100)} %` : '';
      this._set('fps', 'text', `${this.fps.value} FPS${res}`);
    }
    this._set('clock', 'text', st.clock);
    // Plata con conteo animado.
    if (this.moneyShown !== st.money) {
      const diff = st.money - this.moneyShown;
      this.moneyShown += Math.abs(diff) < 2 ? diff : diff * Math.min(1, dt * 8);
      if (Math.abs(st.money - this.moneyShown) < 1) this.moneyShown = st.money;
      this._set('money', 'text', `$${Math.round(this.moneyShown).toLocaleString('es-CO')}`);
    }
    const w = st.weapon;
    this._set('weapon-icon', 'html', weaponIconHtml(w.id));
    this._set('weapon-name', 'text', w.name);
    const gun = w.kind === 'gun';
    this._set('weapon-ammo', 'html', gun ? (st.reloading ? '<small>Recargando</small>' : `${st.ammo.mag}<small>/ ${st.ammo.reserve}</small>`) : '');
    this._toggle('weapon-ammo', 'empty', gun && st.ammo.mag === 0 && !st.reloading);
    this._toggle('reload-bar', 'on', gun && st.reloading);
    if (st.reloading) this._set('reload-fill', 'width', `${Math.round((st.reloadFrac ?? 0) * 100)}%`);
    if (st.wanted !== this.lastWanted) {
      this._set('wanted', 'html', st.wanted > 0 ? Array.from({ length: 5 }, (_, i) => STAR_SVG(i < st.wanted)).join('') : '');
      this.lastWanted = st.wanted;
    }
    this._toggle('wanted', 'flash', st.wantedFlash);
    this._toggle('minimap-frame', 'wanted', st.wanted > 0);
    const hp = Math.max(0, st.health);
    this._set('health-bar', 'width', `${Math.round(hp)}%`);
    this._toggle('health-bar', 'low', hp < 25 && !st.dead);
    this._set('low-health', 'opacity', st.dead ? '0' : String(Math.max(0, Math.min(1, (35 - hp) / 25)).toFixed(2)));
    this._set('armor-bar', 'width', `${Math.round(Math.max(0, st.armor))}%`);
    this._set('stamina-bar', 'width', `${Math.round(st.stamina)}%`);
    this._toggle('stamina-wrap', 'full', st.stamina >= 99.5);
    this._set('street-name', 'html', st.street);
    this._toggle('crosshair', 'hidden', !(st.aiming || (st.weapon.kind === 'gun' && !st.inVehicle)) || st.dead);
    this._toggle('crosshair', 'aim', st.aiming && st.weapon.kind === 'gun');
    this._toggle('crosshair', 'enemy', !!st.aimEnemy);
    this._toggle('speedometer', 'hidden', !st.inVehicle);
    if (st.inVehicle) {
      this._set('speed-value', 'text', String(Math.round(st.speedKmh)));
      this._set('vehicle-name', 'text', st.vehicleName);
      this._set('vehicle-health', 'width', `${Math.round(Math.max(0, st.vehicleHealth * 100))}%`);
    }
    // Minimapa a ~30 Hz: se ve igual de fluido y cuesta la mitad.
    this.miniAccum = (this.miniAccum ?? 1) + dt;
    if (this.miniAccum >= 1 / 30) {
      this.miniAccum = 0;
      this.drawMinimap(st);
    }

    // Temporizadores de mensajes.
    if (this.bigTimer > 0) {
      this.bigTimer -= dt;
      if (this.bigTimer <= 0) $('big-message').classList.add('hidden');
    }
    if (this.helpTimer > 0) {
      this.helpTimer -= dt;
      if (this.helpTimer <= 0) $('help-box').classList.add('hidden');
    }
    if (this.poiTimer > 0) {
      this.poiTimer -= dt;
      if (this.poiTimer <= 0) $('poi-banner').classList.add('hidden');
    }
    if (this.damageTimer > 0) {
      this.damageTimer -= dt;
      if (this.damageTimer <= 0) $('damage-indicator').style.opacity = 0;
    }
  }

  toast(msg, time = 2.2) {
    const d = document.createElement('div');
    d.className = 'toast';
    d.innerHTML = msg;
    this.toasts.appendChild(d);
    while (this.toasts.children.length > 4) this.toasts.firstChild.remove();
    setTimeout(() => d.remove(), time * 1000);
  }

  big(title, sub = '', cls = 'gold', time = 3) {
    const el = $('big-message');
    el.className = cls;
    el.querySelector('.title').textContent = title;
    el.querySelector('.sub').innerHTML = sub;
    this.bigTimer = time;
  }

  hideBig() {
    $('big-message').classList.add('hidden');
    this.bigTimer = 0;
  }

  help(html, time = 6) {
    const el = $('help-box');
    el.innerHTML = html;
    el.classList.remove('hidden');
    this.helpTimer = time;
  }

  objective(html) {
    $('objective').innerHTML = html ?? '';
  }

  missionTimer(sec) {
    const el = $('mission-timer');
    if (sec === null || sec === undefined) {
      el.classList.add('hidden');
      return;
    }
    el.classList.remove('hidden');
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    el.textContent = `${m}:${String(s).padStart(2, '0')}`;
    el.classList.toggle('urgent', sec < 15);
  }

  poi(poi) {
    const el = $('poi-banner');
    el.querySelector('.poi-title').textContent = poi.name;
    el.querySelector('.poi-desc').textContent = poi.desc;
    el.classList.remove('hidden');
    this.poiTimer = 5;
  }

  hitmarker() {
    const el = $('hitmarker');
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
  }

  damageFrom(from) {
    const g = this.game;
    // Ángulo del atacante relativo a la cámara (0 = arriba, horario positivo).
    const rel = -(yawFromDir(from.x - g.player.x, from.z - g.player.z) - g.camRig.yaw);
    const el = $('damage-indicator');
    el.style.transform = `rotate(${rel}rad)`;
    el.style.opacity = 1;
    this.damageTimer = 0.8;
  }

  bumpMoney() {
    const el = $('money');
    el.classList.remove('bump');
    void el.offsetWidth;
    el.classList.add('bump');
  }

  showFps(on) {
    $('fps').classList.toggle('hidden', !on);
  }
}

