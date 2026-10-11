# Traspaso a Unreal Engine: Medellín: Aranjuez

Juego actual: `medellin-aranjuez/` (web + escritorio). Proyecto de Unreal y
pasos de importación del mundo: `medellin-unreal/` (ver `LEEME.md`).

## 1. Tecnología actual

| Pieza | Versión | Uso |
| --- | --- | --- |
| JavaScript (ES modules) | Node 22 | Todo el juego; sin TypeScript |
| three.js | 0.186 | Render 3D, animación esquelética, carga de glTF |
| postprocessing / n8ao | 6.39 / 2.0 | Postproceso y oclusión ambiental |
| Vite | 8.3 | Servidor de desarrollo y empaquetado |
| Electron / electron-builder | 44.4 / 26.15 | App de escritorio para Windows (zip) |
| Vitest / Playwright | 5.0 / 1.63 | Pruebas unitarias y de juego (Chromium) |
| glTF-Transform, meshoptimizer, sharp | 4.5 / 1.2 / 0.35 | Optimización de modelos y texturas (solo herramientas) |
| Web Audio + AudioWorklet | navegador | Sonido 3D y motor granular |

No usa motor de física: movimiento, vehículos y colisiones son código propio (`src/sim`).

## 2. El juego

- **Tipo:** 3D, mundo abierto estilo GTA, en **tercera persona** (también tiene
  vista sobre el hombro, primera persona y cámara de capó).
- **Escenario:** Aranjuez–Moravia (Medellín), con calles reales de OpenStreetMap.

**Mecánicas principales**

- **Movimiento a pie:** caminar, correr, esprintar (con resistencia), saltar y
  agacharse.
- **Vehículos:** subirse a carros, motos y busetas y manejarlos, con cambios y
  sonido de motor. Radio con emisoras.
- **Combate:** armas (machete, pistola, subametralladora, escopeta, rifle) con
  balística, vida y blindaje.
- **Policía:** estrellas de búsqueda (0–5) que suben con los delitos; patrullas
  que persiguen; las estrellas se pierden escapando de la zona de búsqueda.
- **Ciudad viva:** peatones, tráfico, actividades del barrio (fútbol, ropa
  tendida, gente sentada) y aves.
- **Economía:** dinero, misiones, locales de comida, tiendas de ropa,
  lugares por descubrir, hospital y taller.
- **Historia:** capítulo 1 con cinemática y voces paisas.

## 3. Lógica central (pseudocódigo)

```text
ESTADOS: cargando -> menú -> jugando <-> {pausa, mapa, tienda}
         jugando -> muerto -> (5 s) -> reaparecer en el hospital -> jugando
         jugando -> cinemática (historia) -> jugando

CADA CUADRO (jugando):
  entrada = leer(teclado, ratón, mando)
  si jugador.enVehículo: pasoVehículo(vehículo, entrada, dt)
  si no:                 pasoJugador(jugador, entrada, dt)
  mundo.actualizar(dt)      # peatones, tráfico, policía, actividades
  búsqueda.actualizar(dt)   # estrellas
  misiones.actualizar(dt)
  cámara.seguir(objetivo)
  dibujar()

pasoJugador(j, entrada, dt):           # subpasos de 1/120 s
  velDeseada = caminar 1.8 | correr 4.6 | esprintar 7.4 | agachado 1.5 (m/s)
  esprintar gasta resistencia (14/s, se recupera 22/s; vuelve a esprintar con 25)
  acelerar hacia velDeseada (30 m/s² en el piso, 5 en el aire)
  saltar: vy = 6; gravedad -19.6
  mover en XZ y empujar fuera de obstáculos (círculo r=0.35 contra cajas)
  pegar al piso si el escalón mide <= 0.45 m

pasoVehículo(v, entrada, dt):
  motor: rpm según marcha y velocidad; caja automática; limitador
  fuerza = acelerador*torque - freno - arrastre;  giro según velocidad
  freno de mano -> derrape (marcas en el piso)
  choque OBB vs OBB (edificios, otros carros): rebote y daño
  daño >= máx -> humo -> fuego -> explota

colisiones:
  mundo estático = cajas/OBB en una grilla 2D + altura del terreno
  personas = círculo vs caja; carros = OBB vs OBB
  disparos = rayo vs (caja, cápsula de persona, OBB de carro)

reglas y puntaje (el "puntaje" es el dinero):
  inicio: $500, vida 100
  descubrir un lugar de interés: +$100 (una sola vez)
  misión cumplida: +recompensa; comprar comida, ropa o reparación: -precio
  hospital (E): curarse $200; taller (E): reparar $300
  morir: reaparecer en el hospital, pagar max($100, 10% del dinero) (sin quedar en negativo)
         estrellas = 0, vida = 100

búsqueda (estrellas):
  delito -> estrellas += {disparos 1, agresión 1, robar carro 1,
                          matar civil: mínimo 2, agredir policía: mínimo 3, matar policía +1}
  zona de búsqueda: radio 40 m + 14 m por estrella, crece si no te ven
  fuera de la zona y sin que te vean -> el contador baja -> se pierde 1 estrella
  más estrellas = más patrullas y más agresivas

peatones: pasear, quedarse quietos o en una actividad; huyen si hay disparos;
          algunos se sientan en sillas plásticas (asiento a 0.447 m)
tráfico: siguen el grafo de calles (carriles), frenan ante obstáculos
```

## 4. Inventario de assets

Todo está en `medellin-aranjuez/public/` y versionado en Git (83 MB).

| Tipo | Formato | Ubicación | Cantidad |
| --- | --- | --- | --- |
| Personajes (Rocketbox, MIT) | `.glb` con esqueleto | `models/personajes/` | 13 avatares |
| Animaciones | `.glb` **empacado a la medida** (no sirve en Unreal) | `models/personajes/animaciones.glb` | ~50 clips |
| Vehículos | `.glb` | `models/vehiculos/` | 15 |
| Armas | `.glb` + íconos | `models/armas/` | 5 |
| Utilería (silla, caneca, faroles, postes…) | `.glb` | `models/utileria/` | 15 |
| Vegetación (mango, guadua, palmas…) | `.glb` | `models/vegetacion/` | 18 |
| Texturas de materiales (PBR: color, normal, rugosidad) | `.webp` | `textures/<material>/` | 19 materiales |
| Cielo | `.hdr` | `hdri/` | 2 |
| Sonidos (armas, motor, historia, voces, música) | `.ogg` | `sounds/` | 625 |
| Mapa (calles, manzanas, edificios, alturas) | `.json` | `src/data/mapa.json` | 1 (2.9 MB) |
| Fuentes | `woff2` (paquetes npm) | `@fontsource/barlow`, `barlow-condensed` | 2 |

No hay sprites: es 3D. Los íconos del HUD son SVG en código (`src/ui/icons.js`).

Lo que se genera por código:
- **Mundo:** fachadas, techos, calles, terreno, metro y cables.
- **Sonidos:** algunos efectos (pájaros, interfaz).

Para llevar el mundo a Unreal sin rehacerlo:
- `npm run exportar:unreal` → `medellin-unreal/Importar` (archivos `.glb` + `.json`).
- Después, el script de Python `importar_medellin.py` lo carga en Unreal.

Las créditos y licencias están en `README.md` y en los `CREDITOS.txt` de cada carpeta.

## 5. Estructura en Unreal y equivalencias

```text
medellin-unreal/
  Content/Medellin/
    Core/        BP_GameMode, BP_GameInstance, SG_Partida (SaveGame)
    Personaje/   BP_Jugador, ABP_Humano, BS_Locomocion, IK_Rocketbox
    Vehiculos/   BP_Carro, BP_Moto, BP_Buseta, MS_Motor (MetaSound)
    Armas/       BP_Arma (base) + hijos, DA_Armas
    IA/          BT_Peaton, BT_Policia, EQS_*, ZoneGraph de calles
    Mundo/       Mapas/Aranjuez, Importado/ (del exportador), Foliage
    Juego/       Misiones (DA_Mision), Tiendas, Actividades (Smart Objects), Historia (Sequencer)
    Audio/       Musica, Voces, SFX
    UI/          WBP_HUD, WBP_Menu, WBP_Mapa, WBP_Tienda, WBP_Radio
    Materiales/  M_ColorVertice, M_Fachada
  Source/MedellinAranjuez/  (C++, solo lo de abajo marcado "C++")
```

| Actual (`medellin-aranjuez/src`) | En Unreal | Cómo |
| --- | --- | --- |
| `game/Game.js` (estados, bucle) | GameMode + GameInstance + estados de UI | Blueprint |
| `sim/playerController.js`, `game/cameraRig.js` | `Character` + `CharacterMovement` + `SpringArm`, Enhanced Input | Blueprint (plantilla Third Person) |
| `render/characterRig.js` (capas, gestos, mirar) | Animation Blueprint + Blend Spaces + Montages | Blueprint |
| `sim/seatFit.js` (sentarse bien) | Control Rig / IK de piernas | Blueprint |
| `sim/vehiclePhysics.js`, `sim/engineModel.js` | Chaos Vehicles | Blueprint |
| `game/engineSound.js` + `engineWorklet.js` (granular) | MetaSound con los granos de `sounds/motor` | MetaSound |
| `sim/collision.js` | Colisión de Unreal (complejo como simple para el mundo) | Nada que portar |
| `sim/weapons.js`, `sim/ballistics.js`, `game/combat.js` | Line traces + Damage | Blueprint |
| `sim/wanted.js` | Componente `Búsqueda` (estrellas, zona, temporizador) | **C++** (reglas con muchos números, fácil de probar) o Blueprint |
| `sim/policeAI.js` | Behavior Tree + EQS (rodear, cortar el paso) | Blueprint |
| `sim/pedAI.js`, `game/world.js` (población) | Mass Entity + ZoneGraph (multitudes) | **C++** (los procesadores de Mass son C++) |
| `sim/roadNav.js` (grafo de calles) | ZoneGraph / splines generados desde `mapa.json` | **C++** o Python de editor (importador) |
| `game/activities.js` | Smart Objects | Blueprint |
| `sim/missions.js`, `game/story*.js` | Data Assets + Sequencer + Level Sequence | Blueprint |
| `game/radio.js`, `game/dialogue.js` | Sound Cues / MetaSounds, Subtitles | Blueprint |
| `render/sky.js`, `environment.js` | Sky Atmosphere, Volumetric Clouds, Directional Light | Nada que portar |
| `render/cityRenderer.js`, `props.js`, `vegetation.js` | Mundo importado + Nanite + HISM + Foliage | Exportador ya hecho |
| `ui/*` | UMG | Blueprint |
| Guardado (`localStorage`) | SaveGame | Blueprint |

## 6. Plan por fases (de lo más fácil a lo más difícil)

1. **Entorno:** abrir `MedellinAranjuez.uproject` y correr el exportador y el
   script de importación. Con eso queda el mundo, la utilería, la luz y el
   PlayerStart. Activar Nanite en el mundo.
2. **Jugador a pie:** plantilla Third Person. Reorientar los avatares
   Rocketbox al maniquí de Unreal (IK Retargeter) o importar los FBX
   originales de Rocketbox con sus animaciones. Ajustar las velocidades a la
   sección 3.
3. **Cámaras, HUD, menú, pausa y guardado:** UMG + SaveGame (dinero, vida,
   ropa, misiones hechas).
4. **Vehículos:** Chaos Vehicles para carro, moto y buseta; entrar y salir
   con montajes; motor con MetaSound; radio.
5. **Combate y salud:** armas por Data Asset, line traces, daño, muerte y
   reaparición en el hospital con cobro.
6. **Economía y lugares:** lugares de interés desde `puntos.json`, tiendas,
   locales de comida, ropa en sockets de la cabeza o el torso, hospital y taller.
7. **Misiones e historia:** Data Assets de misión y cinemática del capítulo 1
   en Sequencer con las voces de `sounds/historia`.
8. **Policía y estrellas:** componente de búsqueda con las reglas de la
   sección 3, y patrullas con Behavior Tree y EQS.
9. **Ciudad viva:** peatones y tráfico con Mass + ZoneGraph generados desde
   `mapa.json`; actividades con Smart Objects; gente sentada; aves.
10. **Pulido y rendimiento:** World Partition, HLOD, perfiles de calidad,
    empaquetado para Windows.

**Riesgos a vigilar**

- **Animaciones:** `animaciones.glb` no sirve en Unreal; hay que usar las
  fuentes FBX de Rocketbox.
- **Fachadas:** el color por vértice de las fachadas necesita `M_ColorVertice`
  (el script de importación lo crea).
- **Exportador sin probar de punta a punta:** el exportador (`exportar:unreal`)
  y el script de Unreal no se han probado en un Unreal real. Revisar el
  *Output Log* en la primera importación.
