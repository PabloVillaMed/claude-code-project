# La versión web

Guía técnica de cómo se construye, se publica, se guarda en caché y se prueba
el juego en el navegador. Para jugar: [README](../README.md#jugar-en-el-navegador).

El mismo build (`dist/`) sirve para tres cosas sin cambiar nada:

| Dónde | URL | Quién lo sirve |
| --- | --- | --- |
| GitHub Pages | https://pablovillamed.github.io/medellin-aranjuez/ (cuando Pages esté activado) | Pages, bajo la subruta `/medellin-aranjuez/` |
| Prueba local como Pages | http://localhost:4191/medellin-aranjuez/ | `npm run preview:pages` (`scripts/serve-cli.mjs --base=…`) |
| App de Windows | `app://juego/` | Electron (`electron/main.cjs`), sin service worker |

## 1. Cómo se construye

- **Vite 8** (`npx vite build` o `npm run build`) deja en `dist/`: `index.html`,
  `assets/` (JS, CSS y fuentes con hash en el nombre) y, copiado tal cual de
  `public/`, `models/`, `textures/`, `hdri/` y `sounds/`. Son ~88 MB y ~800
  archivos.
- **Base relativa** (`base: './'` en `vite.config.js`): `index.html` pide
  `./assets/index-<hash>.js` y el código pide `models/…`, `textures/…`,
  `sounds/…` sin barra inicial. Todo se resuelve contra la URL de la página,
  por eso el mismo build anda en la raíz, bajo `/medellin-aranjuez/` y dentro
  de Electron. Lo único que exige es que la página termine en `/`: Pages (y
  `serve.mjs` con `--base`) redirigen `/medellin-aranjuez` a
  `/medellin-aranjuez/` con un 301.
- **No usar rutas absolutas** (`/models/x.glb`, `fetch('/sounds/…')`): en Pages
  irían a `pablovillamed.github.io/models/…` y darían 404. La prueba e2e *web*
  falla si algún pedido sale de la subruta.

### Qué pide el juego y cuándo

| Recurso | Tamaño | Cuándo se pide | Service worker |
| --- | --- | --- | --- |
| `index.html`, `assets/` (código, estilos, fuentes Barlow, worklet del motor) | ~5 MB | Al abrir | Precarga |
| `manifest.webmanifest`, `icons/` | <1 MB | Al abrir (app instalable) | Precarga |
| `models/` (personajes Rocketbox, vehículos, armas, utilería, vegetación) | 17 MB | En la carga (`src/render/assets.js`, `loadAll` en `Game.init`) | Precarga |
| `textures/<material>/` | ~10 MB | En la carga | Precarga |
| `textures/<material>/hd/` | ~8 MB | En la carga, solo en calidad Alta y Ultra | Al usarse |
| `hdri/*.hdr` (el normal; `*_2k.hdr` es el de Alta/Ultra) | 6,6 MB | En la carga | Precarga (el 2K, al usarse) |
| `sounds/armas`, `sounds/motor`, `sounds/historia` | <1 MB | Al usarse (primer disparo, primer motor, la historia) | Precarga |
| `sounds/voces/manifest.json` y 537 `*.ogg` | 5,7 MB | El manifiesto al arrancar; cada frase cuando alguien la dice | Manifiesto en la precarga, voces al usarse |
| `sounds/musica/manifest.json` y `<emisora>/*.ogg` | 36 MB | La radio, por streaming con `<audio>` y pedidos de rangos (`Range`) | Manifiesto en la precarga, pistas siempre a la red |

Las reglas están en `scripts/web/swManifest.js` (la primera que coincide gana).
Un archivo nuevo en `public/` que no encaje en ninguna va a la red sin caché y
el build lo avisa: hay que clasificarlo ahí.

## 2. Service worker: qué se guarda y qué no

`vite build` escribe `dist/sw.js` desde `src/web/sw-template.js` con el plugin
`scripts/web/vite-plugin-sw.js`; `src/web/pwa.js` lo registra. Con él, después
de la primera visita el juego abre rápido y sin conexión.

- **Se registra solo** en el build de producción servido por https (o http en
  `localhost`), fuera de Electron y fuera de `?autotest`, y **después de que el
  juego terminó de cargar**, para que la primera carga no compita con la
  descarga de la precarga. `npm run dev` no usa service worker.
- **Alcance**: la carpeta donde está `sw.js`, o sea `/medellin-aranjuez/` en
  Pages. No toca otros sitios de `pablovillamed.github.io`.
- **Precarga** (caché `medellin-<BUILD>`, ~35 MB): lo marcado *Precarga* en la
  tabla. Cada archivo va en la lista con su **revisión** (los primeros 12
  caracteres del SHA-256 del contenido); `BUILD` es la huella de toda la lista.
  Al instalar una versión nueva, lo que tiene la misma revisión se copia de la
  caché anterior y solo se baja lo que cambió (revalidando, y verificado contra
  su revisión).
- **Al usarse** (caché `medellin-runtime`): voces, texturas HD y el cielo 2K se
  guardan la primera vez que el juego los pide con el service worker activo.
- **Navegaciones**: la raíz y `index.html` (con cualquier `?…`) salen del
  `index.html` de la caché; por eso el juego abre sin red.
- **Siempre a la red**: la **música de la radio** y cualquier pedido por rangos.
  Sin conexión la radio no suena; todo lo demás funciona.
- **Sin conexión en Alta o Ultra**: si las texturas HD o el cielo 2K todavía no
  quedaron en `medellin-runtime` (en la primera visita se cargan antes de que el
  service worker controle la página), el juego usa las normales de la precarga
  sin fallar. Quedan guardadas en la siguiente visita con red.
- Los nombres empiezan por `medellin-` porque el almacenamiento (cachés y
  `localStorage`) es por **origen**, y el origen `pablovillamed.github.io` lo
  comparten todos los proyectos de Pages de la cuenta. Al activarse, el service
  worker nuevo borra solo las cachés `medellin-` viejas y limpia de
  `medellin-runtime` lo que esta versión ya no tiene.
- El juego pide **almacenamiento persistente** (`navigator.storage.persist()`)
  para que el navegador no borre la caché ni la partida cuando le falte
  espacio. Si igual las borra, la siguiente visita con red vuelve a bajar todo.
- Si algo falla dentro del service worker, el pedido va a la red como si no
  existiera.

### Versiones nuevas

1. El workflow publica un build nuevo (otro `BUILD`, otras revisiones).
2. El navegador revisa `sw.js` al abrir el juego, y el juego le pide revisar
   cada hora mientras la pestaña siga abierta. `sw.js` se revisa contra el
   servidor sin la caché HTTP.
3. El service worker nuevo se instala en segundo plano y baja lo que cambió,
   pero **queda esperando**: no cambia los archivos debajo de una partida.
4. En el menú aparece el botón **«Hay una versión nueva · Actualizar»** (si se
   está jugando, solo un aviso: *se aplica al volver al menú*). Al tocarlo,
   `apply()` (de `onUpdateReady`) le manda `SKIP_WAITING` al nuevo, este toma
   el control y la página se recarga una vez. Si nadie lo toca, la versión
   nueva entra sola cuando se cierren todas las pestañas del juego.

La partida guardada está en `localStorage`, aparte de las cachés: no se pierde
al actualizar.

## 3. Protecciones del navegador

En una pestaña el navegador manda sobre varios atajos y puede cerrar, esconder
o congelar la página. `src/web/browserGuards.js` se defiende así (nada de esto
corre con `?autotest`):

| Problema | Qué hace el juego |
| --- | --- |
| **Ctrl+W**, Ctrl+T, Ctrl+N cierran o abren pestañas (agacharse es Ctrl y avanzar es W) | Una página no puede cancelarlos. En **pantalla completa**, Chrome y Edge dejan capturar el teclado con la *Keyboard Lock API* y esos atajos (y Esc) le llegan al juego; para salir de la pantalla completa hay que **mantener Esc**. Solo se capturan W, T, N y Esc: Alt+Tab, la tecla Windows y Ctrl+Tab siguen siendo del sistema y del navegador. Firefox y Safari no tienen Keyboard Lock: ahí protege el aviso al cerrar. |
| Otros atajos del navegador jugando: Ctrl/Cmd + cualquier tecla (marcador, guardar página, buscar, recargar, cambiar de pestaña…), Alt (barra de menú, atrás), F3, F5, F6, F7, F10, Retroceso, `/` y `'` (búsqueda rápida de Firefox) | Se cancelan mientras se juega; el juego igual recibe la tecla. F11 (pantalla completa del juego) y F12 y Ctrl+Mayús+I/J (herramientas de desarrollo) quedan libres. |
| Ctrl + rueda o pellizco del touchpad (zoom de la página) | Se cancela mientras se juega. |
| Cerrar o recargar la pestaña con una partida en curso | Se **guarda** y el navegador **pregunta antes de salir** (`beforeunload`). Los navegadores solo muestran la pregunta si ya hubo un clic o una tecla en la página. |
| Safari e iOS (no siempre mandan `beforeunload`) | Se guarda en `pagehide`. |
| Cambiar de pestaña, minimizar o bloquear el celular | **Pausa sola** al ocultarse la pestaña (`visibilitychange`), que además guarda y suspende el audio. |
| Esc suelta el ratón (Pointer Lock) | Como antes: el juego se pausa; un clic en el juego vuelve a capturar el ratón. |

En la app de Windows no hay pestañas ni atajos del navegador: ahí solo se
guarda y se pausa, y el botón **Salir** cierra la app. En la web ese botón no
aparece (una página no puede cerrar la pestaña que el usuario abrió).

## 4. Compatibilidad por navegador

| Navegador | Juega | Instalable como app | Pantalla completa | Teclado en pantalla completa (Keyboard Lock) | Notas |
| --- | --- | --- | --- | --- | --- |
| Chrome / Edge (Windows, macOS, Linux) | Sí | Sí (ícono en la barra) | Sí | Sí | El de referencia; las pruebas e2e corren en Chromium. |
| Chrome / Edge (Android) | Sí, táctil o con mando | Sí | Sí | — | La calidad arranca en Baja en celular. |
| Firefox (escritorio) | Sí | No en todas las versiones: se juega en pestaña | Sí | No | |
| Safari 17+ (macOS) | Sí | *Archivo → Agregar al Dock* | Sí | No | |
| Safari 17+ (iPhone) | Sí, táctil | *Compartir → Agregar a inicio* | **No** | — | Instalado en el inicio abre sin barras. iOS cierra la pestaña si la memoria no alcanza: usar calidad Baja. |
| Safari 17+ (iPad) | Sí, táctil o con teclado | *Compartir → Agregar a inicio* | Sí | No | |

Requisito duro: **WebGL 2**. Sin aceleración por hardware (WebGL por software:
SwiftShader, llvmpipe, «Microsoft Basic Render») el juego baja solo a calidad
Baja y anda lento; en Chrome se revisa en `chrome://gpu`, y el menú de pausa
muestra la GPU que detectó.

## 5. Limitaciones conocidas

- **Sin pantalla completa en iPhone**: Safari no deja poner una página en
  pantalla completa; la salida es agregarla al inicio.
- **Pages no deja poner cabeceras propias**: no hay COOP/COEP (el juego no usa
  `SharedArrayBuffer`, así que no hace falta), ni `Service-Worker-Allowed`, ni
  control de caché por archivo.
- **`Cache-Control: max-age=600`** en todo lo que sirve Pages: un navegador que
  ya tenía un archivo puede tardar hasta 10 minutos en ver el nuevo. Por eso la
  lista de la precarga lleva revisiones, y `sw.js` se revisa siempre.
- **La radio necesita conexión** (streaming, sin caché).
- **La partida es por navegador y por sitio**: no pasa de Chrome a Firefox, ni
  entre la web y la app de Windows; borrar los datos del sitio la borra.
- **Primera carga pesada** (~40 MB): en datos móviles conviene abrirlo con wifi
  la primera vez.

## 6. Publicar en GitHub Pages

1. **Activar Pages una sola vez** (lo hace el dueño del repositorio):
   *Settings → Pages → Build and deployment → Source: **GitHub Actions***.
   Desde la terminal:
   ```bash
   gh api -X POST repos/PabloVillaMed/medellin-aranjuez/pages -f build_type=workflow
   ```
2. El workflow [`.github/workflows/medellin-web.yml`](../../.github/workflows/medellin-web.yml)
   (*Medellín Aranjuez (web)*) corre en cada push a `main` que toque
   `medellin-aranjuez/**` o el propio workflow, y a mano desde *Actions → Run
   workflow*. Hace `npm ci` (sin bajar Electron), `npm test`, `npm run build`,
   sube `dist/` como artefacto de Pages y lo publica. Si las pruebas unitarias
   fallan, no publica.
3. Queda en **https://pablovillamed.github.io/medellin-aranjuez/**. La URL
   también sale en el resumen de la corrida (paso *Publicar en GitHub Pages*) y
   en el ambiente `github-pages` del repositorio.

Solo `main` puede publicar (regla del ambiente `github-pages`). Dos
publicaciones seguidas no se pisan: la segunda espera a la primera.

## 7. Probar

```bash
npm test              # unitarias (Vitest, ~35 s), incluye el servidor estático
npm run preview:pages # build + http://localhost:4191/medellin-aranjuez/
npm run test:e2e:web  # build + e2e de los proyectos web y tactil
npm run test:e2e      # build + todas las e2e (juego, web, tactil)
npm start             # la app de Windows (Electron) con el mismo build
```

- **Proyectos de Playwright** (`playwright.config.js`): *juego*
  (`gameplay.spec.js`, `http://localhost:4190`, con `?autotest`), *web*
  (`web.spec.js`, `http://localhost:4191/medellin-aranjuez/`) y *tactil*
  (`touch.spec.js`, 844 × 390 con pantalla táctil). Playwright levanta los dos
  servidores (4190 en la raíz y 4191 bajo la subruta) o reusa los que ya estén
  corriendo. Un solo proyecto: `npx playwright test --project=web`.
- La prueba *web* no usa `?autotest`: abre `?quality=baja`, espera el menú,
  revisa errores de consola, recursos fallidos y pedidos fuera de la subruta,
  el manifiesto y sus íconos, que no esté el botón Salir, y que el service
  worker precargue y el juego vuelva a llegar al menú **sin red**
  (`context.setOffline(true)` y recarga). El render es por software
  (SwiftShader): cada carga puede tardar varios minutos, y con un vehículo en
  pantalla cada cuadro tarda segundos. En un PC con tarjeta de video,
  `PW_GPU=1 npx playwright test` dibuja con la GPU (en Windows, Direct3D 11) y
  la suite completa corre en minutos.
- **Servidor de pruebas** (`scripts/serve-cli.mjs`): `--port=N`,
  `--base=/ruta/` y `--dir=carpeta` (o `PORT`, `BASE`, `DIST_DIR`). Imita a
  Pages: fuera de la base da 404, la base sin barra da 301, responde rangos de
  bytes y manda `Cache-Control: no-cache` para que las pruebas no vean un build
  viejo. En Git Bash, `--base=/medellin-aranjuez/` llega convertido en una
  ruta de Windows si se llama a `node` directamente: escribirlo sin la barra
  inicial (`--base=medellin-aranjuez/`) o con `MSYS_NO_PATHCONV=1`; por `npm
  run` no pasa.
- Para probar en un **celular** de la misma red: `npm run preview:pages` y abrir
  `http://<ip-del-pc>:4191/medellin-aranjuez/`. Ojo: por http y una IP que no
  es `localhost` el navegador no deja registrar el service worker (exige
  https), así que ahí no se prueba el modo sin conexión.

## 8. Depurar

| En la URL | Qué hace |
| --- | --- |
| `?sw=0` | Desregistra el service worker (y no lo vuelve a registrar en esa carga). Para borrar también la caché: DevTools → *Application* → *Storage* → *Clear site data*. |
| `?quality=baja` (`media`, `alta`, `ultra`) | Fuerza la calidad en esa carga. |
| `?autotest=1` | Modo de las pruebas automáticas: entra directo a jugar con la entrada virtual (`game.input.virtual`) y sin service worker. Se combina con `&quality=baja`. |

- **DevTools → Application → Service workers**: estado, *Update on reload*
  (toma cada versión al recargar) y *Bypass for network* (ignora la caché).
  **Cache storage**: `medellin-<BUILD>` (precarga) y `medellin-runtime…`.
- En la consola: `__game.state()` (estado, posición, salud…),
  `__game.assetReport()` (recursos cargados y fallidos) y `__gameInstance` (el
  objeto `Game`).
- Un recurso que da 404 solo en Pages y no en `npm run dev` casi siempre es una
  ruta absoluta (ver arriba) o una mayúscula: Pages distingue mayúsculas y
  minúsculas y Windows no.
