// Punto de entrada: carga el juego y conecta menús, configuración, tienda y mapa.

import '@fontsource/barlow/latin-400.css';
import '@fontsource/barlow/latin-500.css';
import '@fontsource/barlow/latin-600.css';
import '@fontsource/barlow-condensed/latin-400.css';
import '@fontsource/barlow-condensed/latin-500.css';
import '@fontsource/barlow-condensed/latin-600.css';
import '@fontsource/barlow-condensed/latin-700.css';
import { Game, loadSave, saveSettings } from './game/Game.js';
import { LINE_ICONS, ropaIconHtml, weaponIconHtml } from './ui/icons.js';
import { creditsHtml } from './ui/credits.js';
import pkg from '../package.json';

const $ = (id) => document.getElementById(id);
const escapeHtml = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const params = new URLSearchParams(location.search);
const autotest = params.has('autotest');

const canvas = $('game');
const game = new Game(canvas, { autotest, quality: params.get('quality') ?? undefined });
window.__gameInstance = game;

let returnTo = 'menu'; // a dónde vuelven Controles/Configuración

function showOverlay(id) {
  for (const o of ['menu', 'pause', 'controls', 'settings', 'credits', 'shop', 'map-screen']) $(o).classList.toggle('hidden', o !== id);
  document.body.classList.toggle('menu-open', id === 'menu');
  if (id === 'menu') $('menu').classList.remove('leaving');
}

function hideOverlays() {
  showOverlay(null);
}

function refreshMenu() {
  const save = loadSave();
  $('menu').querySelector('[data-action="continue"]').classList.toggle('hidden', !save);
  if (save) {
    const min = Math.floor((save.stats?.playTime ?? 0) / 60);
    $('continue-desc').textContent = `${save.missions?.length ?? 0}/3 misiones · $${(save.money ?? 0).toLocaleString('es-CO')} · ${min} min jugados`;
  }
}

// Leyenda del lugar que muestra la cámara del menú.
game.onMenuShot = (shot) => {
  const cap = document.querySelector('.menu-caption');
  cap.classList.add('swap');
  setTimeout(() => {
    $('menu-cap-title').textContent = shot.title;
    $('menu-cap-sub').textContent = shot.sub;
    cap.classList.remove('swap');
  }, 450);
};
$('menu-version').textContent = `Versión ${pkg.version} · Datos © OpenStreetMap`;

/** Del menú a la partida: el panel se va, fundido a negro y entrada de cine. */
function enterGame(save) {
  $('menu').classList.add('leaving');
  game.setFade(1);
  setTimeout(() => {
    game.newGame(save);
    resumeFullscreen();
    if (!autotest) game.input.requestLock();
  }, 550);
}

game.onStateChange = (s) => {
  if (s === 'playing') hideOverlays();
  else if (s === 'paused') {
    showOverlay('pause');
    const st = game.stats;
    $('stats').innerHTML = `Misiones completadas: <b>${game.missions.completed.size}/3</b><br>Lugares descubiertos: <b>${game.discovered.size}/${game.city.pois.length}</b><br>Bajas: <b>${st.kills}</b> · Distancia: <b>${(st.distance / 1000).toFixed(1)} km</b><br>Tiempo jugado: <b>${Math.floor(st.playTime / 60)} min</b><br><small style="opacity:.6">GPU: ${escapeHtml(game.gpuName ?? '?')}${game.softwareGpu ? ' (por software: revisa los controladores de video)' : ''}</small>`;
    $('pause').querySelector('button').focus();
  } else if (s === 'menu') {
    showOverlay('menu');
    refreshMenu();
  }
};

game.onOpenShop = () => {
  renderShop();
  showOverlay('shop');
};

function renderShop() {
  $('shop-title').textContent = game.shopPoi?.name ?? 'Armería El Parcero';
  $('shop-kicker').textContent = game.shopPoi?.menu ? 'Pedido' : game.shopPoi?.type === 'ropa' ? 'Almacén de ropa' : 'Tienda';
  $('shop-money').textContent = `Tu plata: $${game.player.money.toLocaleString('es-CO')}`;
  const items = game.shopItems();
  $('shop-items').innerHTML = items
    .map((it, i) => `<div class="shop-item"><div class="ico">${it.ropa ? ropaIconHtml(it.ropa) : (LINE_ICONS[it.icon] ?? weaponIconHtml(it.icon))}</div><div class="info"><div class="name">${escapeHtml(it.name)}</div><div class="desc">${escapeHtml(it.desc)}</div></div><button data-i="${i}" ${game.player.money < it.price || it.disabled ? 'disabled' : ''}>${it.label ?? `$${it.price.toLocaleString('es-CO')}`}</button></div>`)
    .join('');
  $('shop-items').querySelectorAll('button').forEach((b) => {
    b.addEventListener('click', () => {
      const r = game.buy(items[+b.dataset.i]);
      if (r === 'close') closeShop();
      else if (r) renderShop();
    });
  });
}

function closeShop() {
  hideOverlays();
  game.resume();
}

// ---------------------------------------------------------------- botones
document.body.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-action]');
  if (!btn) return;
  game.audio.init();
  game.audio.ui('tick');
  const action = btn.dataset.action;
  switch (action) {
    case 'play':
      enterGame(null);
      break;
    case 'continue':
      enterGame(loadSave());
      break;
    case 'resume':
      game.resume();
      break;
    case 'map':
      game.openMap();
      break;
    case 'save':
      game.save();
      game.hud.toast('Partida guardada');
      btn.textContent = 'Guardado';
      setTimeout(() => (btn.textContent = 'Guardar partida'), 1200);
      break;
    case 'mainmenu':
      game.save();
      game.wanted.clear();
      game.world.clearPolice();
      game.hud.show(false);
      game.setState('menu');
      break;
    case 'controls':
      returnTo = game.state === 'menu' ? 'menu' : 'pause';
      showOverlay('controls');
      break;
    case 'credits':
      returnTo = game.state === 'menu' ? 'menu' : 'pause';
      if (!$('credits-body').innerHTML) $('credits-body').innerHTML = creditsHtml();
      showOverlay('credits');
      break;
    case 'settings':
      returnTo = game.state === 'menu' ? 'menu' : 'pause';
      loadSettingsUi();
      showOverlay('settings');
      break;
    case 'back':
      showOverlay(returnTo);
      break;
    case 'close-shop':
      closeShop();
      break;
    case 'quit':
      if (window.desktop?.quit) window.desktop.quit();
      else window.close();
      break;
    default:
      break;
  }
});

window.addEventListener('keydown', (e) => {
  if (e.code === 'Escape') {
    if (game.state === 'shop') closeShop();
    else if (game.state === 'paused' && !$('controls').classList.contains('hidden')) showOverlay('pause');
    else if (game.state === 'paused' && !$('settings').classList.contains('hidden')) showOverlay('pause');
    else if (game.state === 'paused' && !$('credits').classList.contains('hidden')) showOverlay('pause');
  }
  if (e.code === 'F11') {
    e.preventDefault();
    setFullscreen(!isFullscreen());
  }
});

// Volver a capturar el ratón al hacer clic en el juego.
canvas.addEventListener('click', () => {
  if (game.state === 'playing' && !game.input.locked && !autotest) game.input.requestLock();
});

// Si se pierde el pointer lock (Esc del navegador / alt+tab), pausar.
document.addEventListener('pointerlockchange', () => {
  if (!document.pointerLockElement && game.state === 'playing' && !autotest) game.pause();
});

// ---------------------------------------------------------------- mapa
$('fullmap').addEventListener('click', (e) => {
  const w = game.hud.fullMapToWorld(e.clientX, e.clientY);
  game.setWaypoint(w.x, w.z);
  game.audio.ui('tick');
});
$('fullmap').addEventListener('contextmenu', (e) => {
  e.preventDefault();
  game.waypoint = null;
  game.hud.route = null;
  game.hud.drawFullMap(game._hudState());
});
$('map-screen').addEventListener('keydown', () => {});

// ---------------------------------------------------------------- configuración
function loadSettingsUi() {
  const s = game.settings;
  $('set-quality').value = s.quality;
  $('set-sens').value = s.sensitivity;
  $('set-vol').value = s.volume;
  $('set-music').value = s.musicVolume ?? 0.8;
  $('set-fov').value = s.fov;
  $('set-invert').checked = s.invertY;
  $('set-fps').checked = s.showFps;
  $('set-subs').checked = s.subtitles !== false;
  $('set-dynres').checked = s.dynamicRes !== false;
  $('set-bright').value = s.brightness ?? 1;
  $('set-bright-val').textContent = `${Math.round((s.brightness ?? 1) * 100)} %`;
  $('set-vehview').value = s.vehicleView ?? 'cerca';
  $('set-smooth').value = s.camSmoothing ?? 0.5;
  $('set-smooth-val').textContent = `${Math.round((s.camSmoothing ?? 0.5) * 100)} %`;
  $('set-fp').checked = !!s.firstPerson;
  $('set-full').checked = isFullscreen();
}

// ---------------------------------------------------------------- pantalla completa
// En la app de escritorio la ventana entra en pantalla completa desde Electron
// (sin pedir gesto del usuario, así se recuerda entre sesiones); en el
// navegador se usa la API estándar, que exige un clic o una tecla.
let desktopFull = false;
function isFullscreen() {
  return window.desktop?.setFullscreen ? desktopFull : !!document.fullscreenElement;
}
function setFullscreen(on) {
  if (window.desktop?.setFullscreen) window.desktop.setFullscreen(on);
  else if (on && !document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => {});
  else if (!on && document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
}
function onFullscreenChanged(on) {
  if (window.desktop?.setFullscreen) desktopFull = on;
  $('set-full').checked = on;
  if (game.settings.fullscreen !== on) {
    game.settings.fullscreen = on;
    saveSettings(game.settings);
  }
}
/** En el navegador, la pantalla completa guardada se retoma con el clic de Jugar. */
function resumeFullscreen() {
  if (!autotest && game.settings.fullscreen && !window.desktop?.setFullscreen && !document.fullscreenElement) setFullscreen(true);
}
window.desktop?.onFullscreenChange?.(onFullscreenChanged);
document.addEventListener('fullscreenchange', () => onFullscreenChanged(!!document.fullscreenElement));
if (game.settings.fullscreen && window.desktop?.setFullscreen) setFullscreen(true);
$('set-full').addEventListener('change', () => setFullscreen($('set-full').checked));

function applySettings() {
  const s = game.settings;
  s.quality = $('set-quality').value;
  s.sensitivity = +$('set-sens').value;
  s.volume = +$('set-vol').value;
  s.musicVolume = +$('set-music').value;
  s.fov = +$('set-fov').value;
  s.invertY = $('set-invert').checked;
  s.showFps = $('set-fps').checked;
  s.subtitles = $('set-subs').checked;
  s.dynamicRes = $('set-dynres').checked;
  s.brightness = +$('set-bright').value;
  $('set-bright-val').textContent = `${Math.round(s.brightness * 100)} %`;
  s.vehicleView = $('set-vehview').value;
  s.camSmoothing = +$('set-smooth').value;
  $('set-smooth-val').textContent = `${Math.round(s.camSmoothing * 100)} %`;
  s.firstPerson = $('set-fp').checked;
  game.applyCameraSettings();
  if (game.env) game.env.brightness = s.brightness;
  game.setDynamicResolution(s.dynamicRes);
  game.input.sensitivity = s.sensitivity;
  game.input.invertY = s.invertY;
  game.audio.setVolume(s.volume);
  game.radio?.setMusicVolume(s.musicVolume);
  game.camRig.baseFov = s.fov;
  game.hud.showFps(s.showFps);
  saveSettings(s);
}
for (const id of ['set-quality', 'set-sens', 'set-vol', 'set-music', 'set-fov', 'set-invert', 'set-fps', 'set-subs', 'set-dynres', 'set-bright', 'set-vehview', 'set-smooth', 'set-fp']) $(id).addEventListener('input', applySettings);

// ---------------------------------------------------------------- navegación con teclado y mando
function visibleButtons() {
  const ov = ['menu', 'pause', 'controls', 'settings', 'credits', 'shop'].map($).find((o) => !o.classList.contains('hidden'));
  return ov ? [...ov.querySelectorAll('.menu-buttons button:not(.hidden)')] : [];
}
function moveFocus(dir) {
  const list = visibleButtons();
  if (!list.length) return;
  const i = list.indexOf(document.activeElement);
  const next = list[(i + dir + list.length) % list.length];
  next.focus();
  if (game.audio?.ctx) game.audio.ui('tick');
}
window.addEventListener('keydown', (e) => {
  if (game.state === 'playing') return;
  if (e.code === 'ArrowDown') {
    e.preventDefault();
    moveFocus(1);
  } else if (e.code === 'ArrowUp') {
    e.preventDefault();
    moveFocus(-1);
  } else if (e.code === 'Escape' && game.state === 'menu' && ['controls', 'settings', 'credits'].some((o) => !$(o).classList.contains('hidden'))) {
    showOverlay('menu');
  }
});
// Mando en los menús: cruceta arriba/abajo, A aceptar, B volver.
{
  const prev = {};
  const poll = () => {
    const pad = navigator.getGamepads?.().find((p) => p);
    if (pad && game.state !== 'playing') {
      const press = (i) => pad.buttons[i]?.pressed && !prev[i];
      if (press(12)) moveFocus(-1);
      if (press(13)) moveFocus(1);
      if (press(0)) document.activeElement?.click?.();
      if (press(1)) visibleButtons().find((b) => ['back', 'resume', 'close-shop'].includes(b.dataset.action))?.click();
      pad.buttons.forEach((b, i) => (prev[i] = b.pressed));
    }
    requestAnimationFrame(poll);
  };
  requestAnimationFrame(poll);
}
// Sonido suave al pasar por las opciones.
document.querySelectorAll('.menu-buttons button').forEach((b) =>
  b.addEventListener('mouseenter', () => {
    if (game.audio?.ctx) game.audio.ui('tick');
  }),
);

// ---------------------------------------------------------------- carga
const TIPS = [
  'El Metro de Medellín fue el primero de Colombia: la Línea A empezó a rodar en 1995.',
  'El Morro de Moravia fue el basurero de la ciudad; hoy es un jardín comunitario.',
  'Aranjuez nació en los años veinte como barrio obrero, al pie de las lomas nororientales.',
  'La Casa Museo Pedro Nel Gómez guarda los murales del gran pintor antioqueño.',
  'La estación Caribe conecta con la Terminal del Norte por un puente peatonal cubierto.',
  'El guayacán amarillo florece dos veces al año y tiñe las calles de Medellín.',
  'La Comuna 4 lleva el nombre de Aranjuez y va del río hasta las lomas de Manrique.',
  'Por la Carrera 52 (Carabobo) pasa buena parte de la vida comercial del sector.',
];
const STAGES = [
  [0.05, 'Trazando las calles reales'],
  [0.2, 'Mezclando el ladrillo y el repello'],
  [0.3, 'Cargando modelos y sonidos'],
  [0.45, 'Pintando el cielo del valle'],
  [0.55, 'Levantando las casas y los techos'],
  [0.8, 'Llenando el barrio de gente'],
  [0.92, 'Preparando los últimos detalles'],
];
let tip = Math.floor(Math.random() * TIPS.length);
$('boot-tip-text').textContent = TIPS[tip];
const tipTimer = setInterval(() => {
  const el = document.querySelector('.boot-tip');
  el.classList.add('swap');
  setTimeout(() => {
    tip = (tip + 1) % TIPS.length;
    $('boot-tip-text').textContent = TIPS[tip];
    el.classList.remove('swap');
  }, 500);
}, 5200);

function finishBoot() {
  clearInterval(tipTimer);
  $('boot').classList.add('done');
  setTimeout(() => $('boot').remove(), 1200);
}

game
  .init((p) => {
    const pct = Math.round(p * 100);
    $('boot-fill').style.width = `${pct}%`;
    $('boot-pct').textContent = `${pct} %`;
    let label = 'Iniciando…';
    for (const [at, text] of STAGES) if (p >= at) label = text;
    $('boot-stage').textContent = label;
  })
  .then(() => {
    refreshMenu();
    if (autotest) {
      finishBoot();
      hideOverlays();
      game.newGame();
      return;
    }
    $('boot-stage').textContent = 'Listo';
    setTimeout(() => {
      showOverlay('menu');
      finishBoot();
      $('menu-main').querySelector('button:not(.hidden)').focus({ preventScroll: true });
    }, 350);
  })
  .catch((err) => {
    console.error(err);
    $('boot-stage').textContent = `Error al iniciar: ${err.message}`;
  });
