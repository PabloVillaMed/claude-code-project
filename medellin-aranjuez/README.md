# Medellín: Aranjuez

Juego de mundo abierto en tercera persona inspirado en el barrio **Aranjuez (Comuna 4, Medellín)**. Es un MVP para escritorio **Windows 11** hecho con Three.js (WebGL 2) y empaquetado con Electron.

> El barrio es una recreación libre, no un plano exacto. Todo el contenido (texturas, modelos, sonido) se genera por código al arrancar: el juego no usa assets externos.

## Capturas (del juego corriendo)

| | |
|---|---|
| ![Menú](docs/capturas/00-menu-principal.png) | ![Disparando](docs/capturas/05-disparando.png) |
| ![Taxi](docs/capturas/07-taxi-amarillo.png) | ![Moto](docs/capturas/08-moto.png) |
| ![Persecución](docs/capturas/12-persecucion-policial.png) | ![Noche](docs/capturas/13-aranjuez-de-noche.png) |
| ![Rueda de armas](docs/capturas/06-rueda-de-armas.png) | ![Mapa](docs/capturas/14-mapa.png) |

Generadas con `npm run shots` (render por software en calidad Media; en una GPU real se ve igual pero a 60 FPS).

## Qué incluye el MVP

| Área | Contenido |
|---|---|
| **Mundo** | Ladera de ~630 × 630 m con calles empinadas (hasta 21 %), 81 manzanas y ~1.300 edificaciones: ladrillo a la vista, casas pintadas, locales con persiana, torres, terrazas con tanques de agua y varillas, balcones con reja, murales, postes con cableado aéreo, faroles y guayacanes. De fondo, el valle de Aburrá con miles de casas que se encienden de noche y el río Medellín. |
| **Puntos de interés (13)** | Parque de Aranjuez, Iglesia de San Cayetano, Casa Museo Pedro Nel Gómez, Jardín Botánico (con Orquideorama), Parque Explora, Estación Universidad del Metro (con tren en movimiento), Hospital San Vicente, Cementerio Museo San Pedro, Morro de Moravia, cancha del barrio, Mirador, Armería y Taller. Descubrir cada uno paga $100. |
| **Movilidad a pie** | Caminar, trotar, correr con estamina, agacharse, saltar, subir andenes y pendientes, colisiones sin atravesar paredes aunque el framerate caiga. |
| **Vehículos (6 tipos)** | Taxi amarillo, sedán, camioneta, buseta, patrulla de la Policía y moto. Física de aceleración, frenado, reversa, freno de mano con derrape, pendientes, choques con daño, fuego y explosión. Se pueden robar con el conductor adentro. |
| **Armas (6)** | Puños, machete, pistola 9 mm, subametralladora, escopeta y fusil. Selección con 1–6, rueda del ratón o rueda de armas (Tab, con cámara lenta). Cargador, reserva, recarga, dispersión, retroceso, disparos a la cabeza y disparos desde el vehículo. |
| **NPCs** | Peatones que caminan por los andenes, cruzan en las esquinas y huyen de los disparos; tráfico que respeta el carril derecho y frena ante obstáculos; policía que persigue en patrulla y se baja a disparar; pandilla hostil en misión. |
| **Jugabilidad** | Nivel de búsqueda de 0 a 5 estrellas, 3 misiones (domicilio contrarreloj, pique en moto por checkpoints y "limpiar el parche"), armería, hospital, taller, recogibles de plata/munición/salud/chaleco, ciclo día-noche, GPS en el minimapa y mapa completo con destino por clic, guardado automático. |
| **Gráficos** | Iluminación física (PBR), cielo atmosférico con nubes, sombras suaves, reflejos del cielo, oclusión ambiental (GTAO), bloom, SMAA, gradación de color y 4 niveles de calidad. |

### Sobre los "gráficos hiperrealistas"
Un nivel de detalle como el de GTA V/VI requiere miles de modelos y texturas hechas por artistas y un motor como Unreal. Este MVP usa un pipeline realista (PBR, sombras, AO, iluminación atmosférica) sobre geometría procedural, así que se ve moderno pero **no fotorrealista**. El código está preparado para reemplazar las piezas procedurales por modelos glTF y texturas fotográficas cuando existan.

## Instalar en Windows 11

1. Descarga el artefacto **MedellinAranjuez-Windows** del flujo de GitHub Actions *Medellín Aranjuez* (pestaña **Actions** del repositorio, última ejecución).
2. Elige una opción:
   - `MedellinAranjuez-Setup-<versión>.exe`: instalador con acceso directo en el escritorio y el menú Inicio.
   - `MedellinAranjuez-Portable-<versión>.exe`: se ejecuta sin instalar.
   - `MedellinAranjuez-<versión>-win-x64.zip`: descomprime y abre `MedellinAranjuez.exe`.
3. Como el ejecutable no está firmado, Windows SmartScreen puede avisar: **Más información → Ejecutar de todas formas**.

Requisitos: Windows 10/11 de 64 bits y una GPU con WebGL 2 (cualquier integrada reciente sirve en calidad Media; se recomienda una GPU dedicada para Alta/Ultra).

## Controles

| Acción | Teclado y ratón | Mando Xbox |
|---|---|---|
| Moverse / cámara | WASD / ratón | LS / RS |
| Correr · caminar · agacharse | Shift · Alt · C o Ctrl | L3 · — · B |
| Saltar | Espacio | A |
| Apuntar · disparar | Clic derecho · clic izquierdo | LT · RT |
| Recargar | R | X |
| Cambiar arma | 1–6, rueda del ratón, Tab (rueda de armas) | LB / RB |
| Subir, bajar o robar vehículo | F | Y |
| Acelerar · frenar/reversa · freno de mano | W · S · Espacio | RT · LT · B |
| Pito · mirar atrás | H · C | L3 |
| Interactuar (tiendas, misiones) | E | Cruceta ↑ |
| Mapa · cámara · pausa | M · V · Esc | View · R3 · Menu |

## Desarrollo

```bash
npm install
npm run dev          # navegador en http://localhost:5173
npm start            # app de escritorio (Electron)
npm test             # pruebas unitarias (Vitest)
npm run test:e2e     # pruebas de extremo a extremo en Chromium (Playwright)
npm run dist:win     # instalador + portable + zip para Windows (desde Windows)
npm run dist:win:zip # zip de Windows (funciona desde Linux/macOS sin wine)
npm run shots        # capturas reales de una sesión guionizada en shots/
```

### Estructura

```
src/sim/      Lógica pura y testeable: terreno, ciudad, colisiones, jugador,
              vehículos, armas, balística, peatones, tráfico, misiones, policía
src/render/   Three.js: texturas procedurales, ciudad, cielo, personajes,
              vehículos, efectos y postprocesado
src/game/     Orquestación: bucle, entrada, audio, mundo vivo, combate, cámara
src/ui/       HUD, minimapa/GPS, rueda de armas y estilos
electron/     Proceso principal y preload de la app de escritorio
tests/unit/   Pruebas de la simulación (Vitest)
tests/e2e/    Pruebas del juego real con teclado y ratón (Playwright)
```

### Pruebas

- **Unitarias (Vitest)**: generación determinista de la ciudad, accesibilidad de los puntos de interés, colisiones, movilidad a pie (velocidades, estamina, salto, paredes a cualquier framerate, andenes y pendientes), física de cada vehículo (0–100, frenado, giro, derrape, lomas, choques), tráfico autónomo circulando 3 minutos por el barrio sin salirse de la vía, persecución policial, peatones en andenes y huyendo, armas (cadencia, cargador, recarga, cambio, dispersión, daño), balística y misiones.
- **Extremo a extremo (Playwright)**: arranca el juego real y lo maneja con teclado y ratón: caminar, correr, saltar, cambiar de arma, disparar y recargar, subirse al taxi y a la moto, descubrir un lugar, completar una misión, activar la policía, morir y reaparecer, pausar.
- **Prueba de humo del .exe**: en CI se abre el ejecutable empaquetado en Windows, se entra a jugar y se guarda una captura.
