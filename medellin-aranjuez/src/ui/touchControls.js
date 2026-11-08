// Controles táctiles para jugar en celular y tableta: joystick flotante en la
// mitad izquierda (a pie camina y, empujado hasta el borde, corre; en vehículo
// gira, acelera y frena), arrastrar en la mitad derecha para mirar (varios
// dedos a la vez, también con el dedo sobre Disparar) y botones al alcance del
// pulgar. Las acciones las arma TouchInput (game/input.js), que Input.poll
// mezcla con el teclado, el ratón y el mando; aquí va solo la interfaz.
//
// Cuándo se ven: en pantallas táctiles (platform.touchPrimary) o, en equipos
// híbridos, después del primer toque; se esconden si se vuelve al ratón, al
// teclado o al mando. Solo jugando, sin la entrada de cine; en las
// cinemáticas la capa queda vacía y tocar la pantalla las salta.
//
// En la URL, `?touch=1` los obliga a verse siempre (pruebas automáticas, o
// probarlos en el PC con el ratón) y `?touch=0` los apaga del todo.
//
// Contrato: `installTouchControls(game)` se llama cuando `game.init()` ya
// terminó (existe `game.input`). Devuelve el objeto de los controles (con
// `state()` legible para las pruebas y `destroy()`) o null si el dispositivo
// no los necesita.

import './touch.css';
import { platform } from '../web/platform.js';
import { TouchInput } from '../game/input.js';

// ---------------------------------------------------------------- íconos
// Trazos sencillos de 24×24 (sin relleno: se ven sobre cualquier fondo).
const ICONS = {
  fire: '<circle cx="12" cy="12" r="6.5"/><path d="M12 2.5v5M12 16.5v5M2.5 12h5M16.5 12h5"/>',
  aim: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="2.6"/>',
  jump: '<path d="M12 20V5M6 11l6-6 6 6"/>',
  crouch: '<path d="M12 3.5v11M6.5 9l5.5 5.5L17.5 9M5 20h14"/>',
  reload: '<path d="M19.5 12a7.5 7.5 0 1 1-2.4-5.5"/><path d="M19.5 4v4.5H15"/>',
  weapon: '<path d="M4 8.5h14l-3.2-3.2M20 15.5H6l3.2 3.2"/>',
  car: '<path d="M3.5 15.5v-3.2L6 7h12l2.5 5.3v3.2z"/><circle cx="7.8" cy="17" r="1.9"/><circle cx="16.2" cy="17" r="1.9"/>',
  use: '<path d="M8.5 12.5V5.8a1.5 1.5 0 0 1 3 0V11M11.5 10.5V4.5a1.5 1.5 0 0 1 3 0v6M14.5 10.8V6.5a1.5 1.5 0 0 1 3 0V14a7 7 0 0 1-7 7h-.6a6 6 0 0 1-5-2.7l-2.4-3.7a1.5 1.5 0 0 1 2.4-1.8l2.1 2.2"/>',
  emote: '<circle cx="12" cy="12" r="8.5"/><path d="M8.2 14.2a4.6 4.6 0 0 0 7.6 0M9 9.6h.01M15 9.6h.01"/>',
  camera: '<path d="M4 8h3.2l1.8-2.8h6l1.8 2.8H20v11H4z"/><circle cx="12" cy="13.2" r="3.4"/>',
  map: '<path d="M3.5 6.2 9 4.3l6 1.9 5.5-1.9v13.5L15 19.7l-6-1.9-5.5 1.9z"/><path d="M9 4.3v13.5M15 6.2v13.5"/>',
  pause: '<path d="M9 5.5v13M15 5.5v13"/>',
  fullscreen: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  handbrake: '<circle cx="12" cy="12" r="8.5"/><path d="M10 16.5v-9h3a2.6 2.6 0 0 1 0 5.2h-3"/>',
  horn: '<path d="M4 10v4h3l6 4V6l-6 4z"/><path d="M16.2 9.2a4 4 0 0 1 0 5.6M18.8 6.6a7.6 7.6 0 0 1 0 10.8"/>',
  exit: '<path d="M10.5 4H5v16h5.5"/><path d="M14 8l4 4-4 4M18 12H9"/>',
  radio: '<path d="M9 17.5V6.3l10-2.1v11.3"/><circle cx="6.5" cy="17.5" r="2.5"/><circle cx="16.5" cy="15.5" r="2.5"/>',
  back: '<path d="M9 13.5 5 9.5l4-4"/><path d="M5 9.5h9a5 5 0 0 1 0 10h-2.5"/>',
  // Moto en caballito: llanta de atrás en el piso, la de adelante arriba.
  wheelie: '<circle cx="6.5" cy="17" r="3"/><circle cx="16.5" cy="8.5" r="3"/><path d="M6.5 17 11 11.5l5.5-3M9 12.5h4.5"/><path d="M3 20.5h8"/>',
};

// ---------------------------------------------------------------- botones
// kind: 'hold' vale mientras el dedo esté encima · 'tap' una acción de un solo
// cuadro · 'toggle' se prende y se apaga · 'fullscreen' pide pantalla completa.
// modes: en qué modo se ven ('pie', 'veh'). `at`: centro en px desde la esquina
// inferior derecha (derecha, abajo), escalado en touch.css; sin `at` van en la
// fila de arriba. size: l 80 px, m 64 px, s 56 px (nada por debajo de 56).
// `look`: arrastrar el dedo sobre el botón también mueve la cámara.
export const BUTTONS = [
  // A pie: el racimo de la esquina, con Disparar donde descansa el pulgar.
  { id: 'fire', key: 'fire', kind: 'hold', look: true, label: 'Disparar', icon: 'fire', modes: ['pie'], size: 'l', at: [50, 50] },
  { id: 'jump', key: 'jump', kind: 'hold', label: 'Saltar', icon: 'jump', modes: ['pie'], size: 'm', at: [124, 40] },
  { id: 'crouch', key: 'crouch', kind: 'toggle', label: 'Agacharse', short: 'Agachar', icon: 'crouch', modes: ['pie'], at: [192, 36] },
  { id: 'aim', key: 'aim', kind: 'toggle', label: 'Apuntar', icon: 'aim', modes: ['pie'], size: 'm', at: [44, 134] },
  { id: 'reload', key: 'reload', kind: 'tap', label: 'Recargar', icon: 'reload', modes: ['pie'], at: [118, 118] },
  { id: 'vehicle', key: 'enterVehicle', kind: 'tap', label: 'Vehículo', icon: 'car', modes: ['pie'], at: [186, 104] },
  { id: 'weapon', key: 'weaponCycle', value: 1, kind: 'tap', label: 'Arma', icon: 'weapon', modes: ['pie'], at: [118, 186] },
  { id: 'use', key: 'interact', kind: 'tap', label: 'Usar', icon: 'use', modes: ['pie', 'veh'], at: [186, 172] },
  // En vehículo: los mismos puestos, con el freno de mano bajo el pulgar.
  { id: 'handbrake', key: 'handbrake', kind: 'hold', label: 'Freno de mano', short: 'Freno', icon: 'handbrake', modes: ['veh'], size: 'l', at: [50, 50] },
  { id: 'horn', key: 'horn', kind: 'hold', label: 'Pito', icon: 'horn', modes: ['veh'], size: 'm', at: [124, 40] },
  { id: 'lookBehind', key: 'lookBehind', kind: 'hold', label: 'Mirar atrás', short: 'Atrás', icon: 'back', modes: ['veh'], at: [192, 36] },
  { id: 'fireVeh', key: 'fire', kind: 'hold', look: true, label: 'Disparar', icon: 'fire', modes: ['veh'], size: 'm', at: [44, 134] },
  { id: 'exit', key: 'enterVehicle', kind: 'tap', label: 'Bajarse', icon: 'exit', modes: ['veh'], at: [118, 118] },
  { id: 'radio', key: 'radioNext', kind: 'tap', label: 'Radio', icon: 'radio', modes: ['veh'], at: [186, 104] },
  // Solo en moto (data-moto en la capa): mantener y acelerar levanta la rueda.
  { id: 'wheelie', key: 'wheelie', kind: 'hold', label: 'Caballito', icon: 'wheelie', modes: ['veh'], at: [118, 186], moto: true },
  // Fila de arriba, en el centro.
  { id: 'pause', key: 'pause', kind: 'tap', label: 'Pausa', icon: 'pause', modes: ['pie', 'veh'] },
  { id: 'map', key: 'map', kind: 'tap', label: 'Mapa', icon: 'map', modes: ['pie', 'veh'] },
  { id: 'camera', key: 'camera', kind: 'tap', label: 'Cámara', icon: 'camera', modes: ['pie', 'veh'] },
  { id: 'emote', key: 'emote', kind: 'tap', label: 'Gestos', icon: 'emote', modes: ['pie'] },
  { id: 'fullscreen', kind: 'fullscreen', label: 'Pantalla completa', short: 'Pantalla', icon: 'fullscreen', modes: ['pie', 'veh'] },
];
const BY_ID = new Map(BUTTONS.map((b) => [b.id, b]));

/** Modo de los controles: 'pie' | 'vehiculo' | 'cine' (capa vacía: tocar salta) | null (escondidos). */
export function touchMode(game, active) {
  if (!active || game?.state !== 'playing' || game.intro) return null;
  if (game.storyDir?.cinematic) return 'cine';
  return game.player?.inVehicle ? 'vehiculo' : 'pie';
}

/** Ids de los botones que se ven en un modo (`fullscreen`: si se puede pedir pantalla completa; `moto`: en moto, con el caballito). */
export function buttonsFor(mode, { fullscreen = false, moto = false } = {}) {
  const m = mode === 'vehiculo' ? 'veh' : mode;
  return BUTTONS.filter((b) => b.modes.includes(m) && (b.kind !== 'fullscreen' || fullscreen) && (!b.moto || moto)).map((b) => b.id);
}

// Teclas que nombran los textos de ayuda del juego → el botón que hace lo mismo.
const KEY_LABELS = { E: 'Usar', F: 'Vehículo', M: 'Mapa', F1: 'Pausa', G: 'Gestos', V: 'Cámara', R: 'Recargar', Q: 'Radio', H: 'Pito', Espacio: 'Saltar' };

/** Los textos de ayuda ('Presiona <kbd>E</kbd> para…') con los nombres de los botones táctiles. */
export function touchHelpText(html) {
  return String(html ?? '')
    .replace(/<kbd>M<\/kbd>\s*mapa/g, '<kbd>Mapa</kbd>')
    .replace(/<kbd>F1<\/kbd>\s*controles/g, '<kbd>Pausa</kbd> › Controles')
    .replace(/Presiona(\s*<kbd>)/g, 'Toca$1')
    .replace(/<kbd>([^<]{1,8})<\/kbd>/g, (m, k) => (KEY_LABELS[k] ? `<kbd>${KEY_LABELS[k]}</kbd>` : m));
}

const TOUCH_HELP_HTML = `<div class="tc-help">
  <h3>Pantalla táctil</h3>
  <div class="tc-help-cols">
    <div>
      <p><b>Mitad izquierda</b>: el joystick aparece donde pongas el pulgar; empújalo hasta el borde para correr.</p>
      <p><b>Mitad derecha</b>: arrastra para mirar (también con el dedo sobre <b>Disparar</b>).</p>
      <p><b>Disparar</b> (mantener) · <b>Apuntar</b> y <b>Agachar</b> se prenden y se apagan · <b>Saltar</b></p>
      <p><b>Arma</b> cambia de arma · <b>Recargar</b> · <b>Vehículo</b> subirse o robarlo</p>
      <p><b>Usar</b> tiendas y misiones: se ilumina cuando hay algo cerca</p>
    </div>
    <div>
      <p><b>En vehículo</b>: joystick a los lados gira, arriba acelera y abajo frena (quieto, da reversa).</p>
      <p><b>Freno</b> de mano · <b>Pito</b> · <b>Atrás</b> mirar atrás · <b>Radio</b> otra emisora · <b>Bajarse</b></p>
      <p><b>Disparar</b> desde el vehículo con pistola o subametralladora</p>
      <p>Arriba: <b>Pausa</b>, <b>Mapa</b>, <b>Cámara</b>, <b>Gestos</b> y pantalla completa.</p>
      <p>En el mapa, toca para marcar el destino. En las cinemáticas, toca la pantalla para saltarlas.</p>
    </div>
  </div>
</div>`;

const svg = (name) => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] ?? ''}</svg>`;
// Estados con una partida en curso (el aviso de girar el celular los tapa).
const IN_PROGRESS = new Set(['playing', 'paused', 'map', 'shop']);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/**
 * Instala los controles (ver el comentario de arriba). Devuelve el objeto de
 * los controles o null (sin pantalla táctil, o con `?touch=0`).
 */
export function installTouchControls(game, { win = globalThis.window, plat = platform } = {}) {
  const doc = win?.document;
  if (!doc || !game?.input) return null;
  const param = new URLSearchParams(win.location?.search ?? '').get('touch');
  // true: siempre · false: nunca · null: según el dispositivo y lo último que se usó.
  let forced = param === '1' ? true : param === '0' ? false : null;
  if (forced === false) return null;
  if (forced === null && !plat.touchPrimary && !plat.hasTouch) return null;

  const html = doc.documentElement;
  const touch = new TouchInput({ isVehicle: () => !!game.player?.inVehicle });
  game.input.touch = touch;

  // ------------------------------------------------------------ DOM
  const layer = doc.createElement('div');
  layer.id = 'touch';
  layer.hidden = true;
  layer.setAttribute('aria-hidden', 'true');
  const btnHtml = (b) => {
    const pos = b.at ? ` style="--cx:${b.at[0]};--cy:${b.at[1]}"` : '';
    const cls = `tc-btn tc-${b.size ?? 's'} ${b.modes.map((m) => `tc-${m}`).join(' ')}`;
    return `<button type="button" class="${cls}" data-id="${b.id}" aria-label="${b.label}"${pos}>${svg(b.icon)}<span>${b.short ?? b.label}</span></button>`;
  };
  layer.innerHTML = `<div class="tc-stick-hint"></div><div class="tc-stick-base"></div><div class="tc-stick-knob"></div>
    <div class="tc-top">${BUTTONS.filter((b) => !b.at).map(btnHtml).join('')}</div>
    ${BUTTONS.filter((b) => b.at).map(btnHtml).join('')}`;
  doc.body.appendChild(layer);
  const base = layer.querySelector('.tc-stick-base');
  const knob = layer.querySelector('.tc-stick-knob');
  const els = new Map([...layer.querySelectorAll('.tc-btn')].map((el) => [el.dataset.id, el]));
  const fsBtn = els.get('fullscreen');

  const rotate = doc.createElement('div');
  rotate.id = 'tc-rotate';
  rotate.innerHTML = `<svg viewBox="0 0 48 48" aria-hidden="true"><rect x="15" y="6" width="18" height="32" rx="3"/><path d="M8 30a16 16 0 0 0 14 12M40 18A16 16 0 0 0 26 6"/><path d="M19 42l3 0 0-3M29 6l-3 0 0 3"/></svg><div>Gira el celular para jugar</div>`;
  doc.body.appendChild(rotate);

  // Mapa completo: botón para cerrarlo (con el dedo no hay M ni Esc).
  const mapScreen = doc.getElementById('map-screen');
  const mapClose = doc.createElement('button');
  mapClose.type = 'button';
  mapClose.className = 'tc-map-close';
  mapClose.textContent = 'Cerrar';
  mapScreen?.appendChild(mapClose);

  // Pantalla de controles: la sección de la pantalla táctil.
  const grid = doc.querySelector('#controls .controls-grid');
  grid?.insertAdjacentHTML('beforebegin', TOUCH_HELP_HTML);
  const helpSection = grid?.previousElementSibling?.classList.contains('tc-help') ? grid.previousElementSibling : null;
  const controlsDesc = doc.querySelector('#menu [data-action="controls"] .d');
  const controlsDescText = controlsDesc?.textContent ?? '';

  // ------------------------------------------------------------ estado
  let active = false;
  let mode = null;
  let raf = 0;
  let frame = 0;
  let toggleVersion = -1;
  let hot = { use: false, vehicle: false };
  let lastPoi;
  let poiUsable = false;
  let helpHasUse = false;
  let fsShown = null;
  let padWas = !!game.input.usingPad;
  let stickId = null;
  let sprintShown = false;
  let rotateShown = false;
  let wasDead = false;
  let onMoto = false;
  // pointerId → { type: 'stick' | 'look' | 'btn', def?, el?, x, y, cx?, cy? }
  const bindings = new Map();

  const off = [];
  const on = (target, type, fn, opts) => {
    if (!target?.addEventListener) return;
    target.addEventListener(type, fn, opts);
    off.push(() => target.removeEventListener(type, fn, opts));
  };

  const canFullscreen = () => !!(doc.fullscreenEnabled && html.requestFullscreen) && !plat.desktopApp && !win.desktop;
  const lockLandscape = () => {
    try {
      const r = win.screen?.orientation?.lock?.('landscape');
      r?.catch?.(() => {});
    } catch {
      /* solo funciona en pantalla completa (Android); si no, no importa */
    }
  };
  const goFullscreen = () => {
    try {
      const r = html.requestFullscreen({ navigationUI: 'hide' });
      r?.then?.(lockLandscape, () => {});
    } catch {
      /* sin pantalla completa: se sigue jugando igual */
    }
  };

  // ------------------------------------------------------------ joystick
  let R = 60;
  const KNOB = 56;
  function resize() {
    const w = win.innerWidth || 800;
    const h = win.innerHeight || 450;
    R = Math.round(clamp(Math.min(w, h) * 0.16, 50, 78));
    touch.radius = R;
    base.style.width = base.style.height = `${R * 2}px`;
    layer.style.setProperty('--tc-stick', `${R * 2}px`);
  }

  function placeStick(cx, cy, v) {
    base.style.transform = `translate3d(${cx - R}px, ${cy - R}px, 0)`;
    knob.style.transform = `translate3d(${cx + v.knobX - KNOB / 2}px, ${cy + v.knobY - KNOB / 2}px, 0)`;
    const sprint = mode === 'pie' && v.push > 0.9;
    if (sprint !== sprintShown) {
      sprintShown = sprint;
      knob.classList.toggle('tc-sprint', sprint);
    }
  }

  function startStick(e) {
    const w = win.innerWidth;
    const h = win.innerHeight;
    // El centro queda donde tocó el pulgar, sin que la base se salga de la
    // pantalla. Si se corrió (pulgar junto al borde), ese corrimiento no cuenta
    // como empuje: el jugador arranca quieto hasta que el dedo se mueva.
    const cx = clamp(e.clientX, R + 4, w - R - 4);
    const cy = clamp(e.clientY, R + 4, h - R - 4);
    stickId = e.pointerId;
    bindings.set(e.pointerId, { type: 'stick', cx, cy, ox: e.clientX - cx, oy: e.clientY - cy });
    layer.classList.add('tc-sticking');
    placeStick(cx, cy, touch.setStick(0, 0));
  }

  function endStick() {
    stickId = null;
    touch.releaseStick();
    layer.classList.remove('tc-sticking');
    if (sprintShown) {
      sprintShown = false;
      knob.classList.remove('tc-sprint');
    }
  }

  // ------------------------------------------------------------ botones
  function syncToggles() {
    if (touch.version === toggleVersion) return;
    toggleVersion = touch.version;
    els.get('aim')?.classList.toggle('tc-on', !!touch.toggles.aim);
    els.get('crouch')?.classList.toggle('tc-on', !!touch.toggles.crouch);
  }

  function pressButton(el, e) {
    const def = BY_ID.get(el.dataset.id);
    if (!def) return;
    if (def.kind === 'hold') touch.press(def.key);
    else if (def.kind === 'tap') touch.tap(def.key, def.value ?? true);
    else if (def.kind === 'toggle') touch.toggle(def.key);
    syncToggles();
    el.classList.add('tc-down');
    bindings.set(e.pointerId, { type: 'btn', def, el, x: e.clientX, y: e.clientY });
  }

  /** `lifted`: el dedo se levantó (no se canceló): es un gesto del usuario. */
  function releaseBinding(id, lifted = false) {
    const b = bindings.get(id);
    if (!b) return;
    bindings.delete(id);
    if (b.type === 'stick') endStick();
    else if (b.type === 'btn') {
      b.el.classList.remove('tc-down');
      if (b.def.kind === 'hold' && ![...bindings.values()].some((o) => o.type === 'btn' && o.def.key === b.def.key)) touch.release(b.def.key);
      // La pantalla completa exige un gesto: con el dedo cuenta al levantarlo, no al tocar.
      if (b.def.kind === 'fullscreen' && lifted) goFullscreen();
    }
  }

  /** Suelta los botones (al cambiar de modo); el joystick y la cámara siguen. */
  function releaseButtons() {
    for (const [id, b] of bindings) if (b.type === 'btn') releaseBinding(id);
  }

  function releaseEverything() {
    for (const id of [...bindings.keys()]) releaseBinding(id);
    touch.releaseAll();
  }

  // ------------------------------------------------------------ eventos de la capa
  function onDown(e) {
    if (!mode) return;
    e.preventDefault();
    if (mode === 'cine') {
      // La cinemática se salta con saltar / pausa / usar; saltar es lo único
      // que no deja nada raro si la cinemática ya terminó en este cuadro.
      touch.tap('jump');
      return;
    }
    const el = e.target?.closest?.('.tc-btn');
    if (el && layer.contains(el)) pressButton(el, e);
    else if (e.clientX < win.innerWidth * 0.5 && stickId === null) startStick(e);
    else bindings.set(e.pointerId, { type: 'look', x: e.clientX, y: e.clientY });
    try {
      (el ?? layer).setPointerCapture(e.pointerId);
    } catch {
      /* puntero sintético o ya suelto */
    }
  }

  function onMove(e) {
    const b = bindings.get(e.pointerId);
    if (!b) return;
    if (b.type === 'stick') {
      placeStick(b.cx, b.cy, touch.setStick(e.clientX - b.cx - b.ox, e.clientY - b.cy - b.oy));
    } else if (b.type === 'look' || b.def?.look) {
      touch.addLook(e.clientX - b.x, e.clientY - b.y);
      b.x = e.clientX;
      b.y = e.clientY;
    }
  }

  on(layer, 'pointerdown', onDown);
  on(win, 'pointermove', onMove);
  on(win, 'pointerup', (e) => releaseBinding(e.pointerId, true));
  on(win, 'pointercancel', (e) => releaseBinding(e.pointerId));
  // Sin gestos del navegador sobre la capa: ni scroll, ni zoom, ni el menú de
  // pulsación larga, ni clics fantasma sobre lo que aparezca debajo (pausa, mapa).
  const stop = (e) => e.preventDefault();
  on(layer, 'touchstart', stop, { passive: false });
  on(layer, 'touchmove', stop, { passive: false });
  on(layer, 'contextmenu', stop);
  on(doc, 'gesturestart', (e) => active && e.preventDefault(), { passive: false });
  // Que arrastrar fuera de los menús no desplace la página ni la recargue.
  on(doc, 'touchmove', (e) => active && !e.target?.closest?.('.overlay') && e.cancelable && e.preventDefault(), { passive: false });
  const releaseOnBlur = () => releaseEverything();
  on(win, 'blur', releaseOnBlur);
  on(doc, 'visibilitychange', () => doc.hidden && releaseEverything());

  // ------------------------------------------------------------ táctil o ratón/teclado
  function setActive(v) {
    v = forced ?? v;
    if (v === active) return;
    active = v;
    touch.active = v;
    html.classList.toggle('touch-on', v);
    if (controlsDesc) controlsDesc.textContent = v ? 'Pantalla táctil, teclado y mando' : controlsDescText;
    if (!v) {
      releaseEverything();
      // De vuelta al ratón o al teclado en plena partida: se captura el ratón
      // otra vez (este cambio llega dentro de un clic o una tecla, que valen como gesto).
      if (game.state === 'playing' && !game.opts?.autotest && !doc.pointerLockElement) game.input.requestLock?.();
    }
    // Lo que el juego ya escribió en las ayudas, con los nombres de los botones.
    if (v) rewriteHelp();
    update();
  }

  on(
    win,
    'pointerdown',
    (e) => {
      if (e.pointerType === 'touch') {
        // Volvió al dedo: si después agarra el mando otra vez, los controles se vuelven a esconder.
        game.input.usingPad = false;
        padWas = false;
        if (!active) setActive(true);
        // El primer toque de un equipo híbrido cae sobre el canvas: que no
        // llegue como clic de ratón (dispararía).
        if (e.target === game.canvas) e.preventDefault();
      } else if (e.pointerType === 'mouse' && active && forced === null) setActive(false);
    },
    { capture: true },
  );
  on(win, 'keydown', (e) => {
    if (active && forced === null && e.code && !/^(Audio|Media|Unidentified|Launch|Browser)/.test(e.code)) setActive(false);
  });
  on(win, 'wheel', () => active && forced === null && setActive(false), { passive: true });
  // Con el ratón capturado (pointer lock), moverlo es volver al ratón.
  on(win, 'mousemove', (e) => {
    if (active && forced === null && doc.pointerLockElement && Math.abs(e.movementX) + Math.abs(e.movementY) > 2) setActive(false);
  });

  // ------------------------------------------------------------ textos de ayuda
  const helpBox = doc.getElementById('help-box');
  const objective = doc.getElementById('objective');
  function rewriteHelp() {
    if (!active) return;
    for (const el of [helpBox, objective]) {
      if (!el) continue;
      const before = el.innerHTML;
      const after = touchHelpText(before);
      if (after !== before) el.innerHTML = after;
    }
  }
  function readHelp() {
    helpHasUse = !!helpBox && !helpBox.classList.contains('hidden') && /<kbd>(E|Usar)<\/kbd>/.test(helpBox.innerHTML);
  }
  const observer = typeof win.MutationObserver === 'function' ? new win.MutationObserver(() => (rewriteHelp(), readHelp())) : null;
  if (helpBox) observer?.observe(helpBox, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['class'] });
  if (objective) observer?.observe(objective, { childList: true, subtree: true, characterData: true });

  // ------------------------------------------------------------ mapa, giro y pantalla completa
  on(mapClose, 'click', () => {
    game.audio?.ui?.('tick');
    if (game.state === 'map') game.closeMap();
  });
  on(doc, 'fullscreenchange', () => {
    if (doc.fullscreenElement && active) lockLandscape();
    update();
  });
  // Celular puesto en vertical en plena partida: se pausa y el aviso de girarlo
  // tapa todo (también la pausa, el mapa y la tienda) hasta que vuelva a horizontal.
  const portrait = win.matchMedia?.('(orientation: portrait) and (max-width: 760px)');
  if (portrait) on(portrait, 'change', () => update());
  on(win, 'resize', resize);

  // ------------------------------------------------------------ bucle barato
  /** Repinta solo lo que cambió (modo, botones iluminados, alternables). */
  function update() {
    const m = touchMode(game, active);
    const rot = !!portrait?.matches && active && IN_PROGRESS.has(game.state);
    if (rot !== rotateShown) {
      rotateShown = rot;
      html.classList.toggle('tc-portrait', rot);
    }
    if (rot && (m === 'pie' || m === 'vehiculo')) game.pause?.();
    if (m !== mode) {
      const prev = mode;
      mode = m;
      layer.hidden = !m;
      if (m) layer.dataset.mode = m;
      html.classList.toggle('tc-play', !!m);
      html.classList.toggle('tc-veh', m === 'vehiculo');
      if (!m || m === 'cine') {
        releaseEverything();
        touch.reset();
      } else if (prev === 'pie' || prev === 'vehiculo') {
        // Subirse o bajarse: los botones del otro modo se sueltan y apuntar / agacharse se apagan.
        releaseButtons();
        touch.setToggle('aim', false);
        touch.setToggle('crouch', false);
      } else if (doc.fullscreenElement) lockLandscape();
    }
    if (!m || m === 'cine') return;
    // En moto aparece el botón del caballito (touch.css: #touch[data-moto]).
    const moto = m === 'vehiculo' && game.player?.vehicle?.state?.spec?.twoWheels === true;
    if (moto !== onMoto) {
      onMoto = moto;
      layer.dataset.moto = moto ? '1' : '0';
    }
    // Al morir se sueltan los botones y se apagan apuntar y agacharse (reaparece de pie).
    const dead = !!game.player?.dead;
    if (dead !== wasDead) {
      wasDead = dead;
      if (dead) {
        releaseButtons();
        touch.setToggle('aim', false);
        touch.setToggle('crouch', false);
      }
    }
    syncToggles();
    const fs = canFullscreen() && !doc.fullscreenElement;
    if (fs !== fsShown) {
      fsShown = fs;
      fsBtn?.classList.toggle('hidden', !fs);
    }
    // Cada ~8 cuadros: ¿hay algo que usar o un vehículo al lado?
    if (frame % 8 === 0) {
      const p = game.player;
      const poi = game.nearPoi ?? null;
      if (poi !== lastPoi || frame % 32 === 0) {
        lastPoi = poi;
        try {
          poiUsable = !!poi && !!game._interactPrompt?.(poi);
        } catch {
          poiUsable = !!poi;
        }
      }
      const use = poiUsable || helpHasUse;
      let veh = false;
      if (m === 'pie' && p && !p.dead) {
        try {
          veh = !!game.world?.nearestVehicle?.(p.x, p.z, 2.5);
        } catch {
          veh = false;
        }
      }
      if (use !== hot.use) els.get('use')?.classList.toggle('tc-hot', use);
      if (veh !== hot.vehicle) els.get('vehicle')?.classList.toggle('tc-hot', veh);
      hot = { use, vehicle: veh };
    }
  }

  function tick() {
    raf = win.requestAnimationFrame(tick);
    frame++;
    // Agarró el mando: los controles en pantalla sobran.
    const pad = !!game.input.usingPad;
    if (pad && !padWas && active) setActive(false);
    padWas = pad;
    update();
  }

  resize();
  readHelp();
  setActive(forced === true || !!plat.touchPrimary);
  update();
  raf = win.requestAnimationFrame(tick);

  const controls = {
    input: touch,
    get active() {
      return active;
    },
    get visible() {
      return !!mode;
    },
    /** 'pie' | 'vehiculo' | 'cine' | null */
    get mode() {
      return mode;
    },
    /** Estado legible para las pruebas. */
    state() {
      return {
        active,
        forced,
        visible: !!mode,
        mode,
        buttons: mode && mode !== 'cine' ? buttonsFor(mode, { fullscreen: !!fsShown, moto: onMoto }) : [],
        stick: touch.stick ? { x: touch.stick.x, y: touch.stick.y, push: touch.stick.push } : null,
        radius: R,
        toggles: { ...touch.toggles },
        hot: { ...hot },
        pointers: bindings.size,
      };
    },
    /** true / false obliga a mostrarlos o esconderlos; null vuelve a lo automático. */
    force(v) {
      forced = v === null || v === undefined ? null : !!v;
      const want = forced ?? (!!plat.touchPrimary || active);
      active = !want; // para que setActive repinte
      setActive(want);
    },
    destroy() {
      win.cancelAnimationFrame(raf);
      observer?.disconnect();
      for (const f of off.splice(0)) f();
      releaseEverything();
      touch.active = false;
      if (game.input.touch === touch) game.input.touch = null;
      layer.remove();
      rotate.remove();
      mapClose.remove();
      helpSection?.remove();
      if (controlsDesc) controlsDesc.textContent = controlsDescText;
      html.classList.remove('touch-on', 'tc-play', 'tc-veh');
    },
  };
  return controls;
}
