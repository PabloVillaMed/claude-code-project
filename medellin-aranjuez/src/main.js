// Punto de entrada: carga el juego y conecta menús, configuración, tienda y mapa.

import '@fontsource/barlow/latin-400.css';
import '@fontsource/barlow/latin-500.css';
import '@fontsource/barlow/latin-600.css';
import '@fontsource/barlow-condensed/latin-400.css';
import '@fontsource/barlow-condensed/latin-500.css';
import '@fontsource/barlow-condensed/latin-600.css';
import '@fontsource/barlow-condensed/latin-700.css';
import { Game, loadSave, saveSettings } from './game/Game.js';
import { LINE_ICONS, weaponIconHtml } from './ui/icons.js';
import { creditsHtml } from './ui/credits.js';

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
}

function hideOverlays() {
  showOverlay(null);
}

function refreshMenu() {
  $('menu').querySelector('[data-action="continue"]').classList.toggle('hidden', !loadSave());
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
  $('shop-money').textContent = `Tu plata: $${game.player.money.toLocaleString('es-CO')}`;
  const items = game.shopItems();
  $('shop-items').innerHTML = items
    .map((it, i) => `<div class="shop-item"><div class="ico">${LINE_ICONS[it.icon] ?? weaponIconHtml(it.icon)}</div><div class="info"><div class="name">${it.name}</div><div class="desc">${it.desc}</div></div><button data-i="${i}" ${game.player.money < it.price ? 'disabled' : ''}>$${it.price.toLocaleString('es-CO')}</button></div>`)
    .join('');
  $('shop-items').querySelectorAll('button').forEach((b) => {
    b.addEventListener('click', () => {
      if (game.buy(items[+b.dataset.i])) renderShop();
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
      game.newGame();
      resumeFullscreen();
      if (!autotest) game.input.requestLock();
      break;
    case 'continue':
      game.newGame(loadSave());
      resumeFullscreen();
      if (!autotest) game.input.requestLock();
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
  $('set-fov').value = s.fov;
  $('set-invert').checked = s.invertY;
  $('set-fps').checked = s.showFps;
  $('set-subs').checked = s.subtitles !== false;
  $('set-dynres').checked = s.dynamicRes !== false;
  $('set-bright').value = s.brightness ?? 1;
  $('set-bright-val').textContent = `${Math.round((s.brightness ?? 1) * 100)} %`;
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
  s.fov = +$('set-fov').value;
  s.invertY = $('set-invert').checked;
  s.showFps = $('set-fps').checked;
  s.subtitles = $('set-subs').checked;
  s.dynamicRes = $('set-dynres').checked;
  s.brightness = +$('set-bright').value;
  $('set-bright-val').textContent = `${Math.round(s.brightness * 100)} %`;
  if (game.env) game.env.brightness = s.brightness;
  game.setDynamicResolution(s.dynamicRes);
  game.input.sensitivity = s.sensitivity;
  game.input.invertY = s.invertY;
  game.audio.setVolume(s.volume);
  game.camRig.baseFov = s.fov;
  game.hud.showFps(s.showFps);
  saveSettings(s);
}
for (const id of ['set-quality', 'set-sens', 'set-vol', 'set-fov', 'set-invert', 'set-fps', 'set-subs', 'set-dynres', 'set-bright']) $(id).addEventListener('input', applySettings);

// ---------------------------------------------------------------- carga
$('menu-main').classList.add('hidden');
$('loading').classList.remove('hidden');
game
  .init((p) => {
    $('load-bar').style.width = `${Math.round(p * 100)}%`;
  })
  .then(() => {
    $('loading').classList.add('hidden');
    $('menu-main').classList.remove('hidden');
    refreshMenu();
    $('menu-main').querySelector('button:not(.hidden)').focus();
    if (autotest) {
      hideOverlays();
      game.newGame();
    }
  })
  .catch((err) => {
    console.error(err);
    $('loading').querySelector('.load-text').textContent = `Error al iniciar: ${err.message}`;
  });
