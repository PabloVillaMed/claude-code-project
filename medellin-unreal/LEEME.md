# Medellín: Aranjuez en Unreal Engine 5

Proyecto de Unreal para seguir el juego en el motor. Por ahora trae **el mundo**
(terreno, calles, manzanas, edificios casa por casa, metro), **la utilería**
(sillas, canastas, canecas, faroles, postes, árboles…) en su sitio exacto y
**los modelos** (personajes Rocketbox, vehículos, armas), todo sacado del juego
web en `../medellin-aranjuez`. La jugabilidad (manejar, gente, misiones,
policía, radio, historia) todavía vive en JavaScript y hay que rehacerla en
Blueprints o C++: abajo está el plan.

## 1. Preparar la copia local (Windows)

Necesitas: Git, Node.js 22, VS Code y Unreal Engine 5 (5.3 o más nuevo).

```bat
git clone https://github.com/PabloVillaMed/claude-code-project.git
cd claude-code-project
git checkout claude/medellin-third-person-game-od3odk
cd medellin-aranjuez
npm ci
npx playwright install chromium
```

Abre `claude-code-project/medellin.code-workspace` en VS Code: quedan las dos
carpetas (juego web y Unreal) y las tareas (*Terminal > Run Task*):

- **Juego: modo desarrollo**: el juego en el navegador con recarga en vivo.
- **Juego: pruebas unitarias**: las pruebas unitarias (Vitest).
- **Juego: escritorio (Electron)**: el juego como aplicación de escritorio.
- **Unreal: exportar el mundo**: genera `medellin-unreal/Importar`.

Para seguir trabajando con Claude Code en tu PC: en una terminal dentro de
`claude-code-project`, `claude` (o `claude remote-control` para manejar esa
sesión local desde la app de Claude), o la app Claude Desktop.

## 2. Exportar el mundo del juego

```bat
cd medellin-aranjuez
npm run exportar:unreal
```

Tarda unos minutos (abre el juego sin ventana con calidad alta). Deja en
`medellin-unreal/Importar/`:

| Archivo | Qué es |
| --- | --- |
| `mundo/*.glb` | Geometría fija fusionada por material y por cuadros de 200 m. Los vértices ya están en coordenadas del mundo: en Unreal todo va en el origen. |
| `plantillas/*.glb` | Un modelo por cada utilería repetida. |
| `instancias.json` | Dónde va cada copia (matrices 4×4 de three.js, metros, Y arriba). |
| `calibracion.glb` | Tres cubitos a 10 m en +X, +Y, +Z para medir cómo convierte los ejes tu versión de Unreal. |
| `puntos.json` | Aparición del jugador, lugares de interés, sillas y venteros. |
| `modelos/` | Personajes, vehículos y armas originales (glb). |

## 3. Importar en Unreal

1. Abre `MedellinAranjuez.uproject`. Si pregunta la versión, elige la tuya (o
   clic derecho > *Switch Unreal Engine version*). Es un proyecto sin C++: no
   hay que compilar nada.
2. Si pide activar *Python Editor Script Plugin* y *Editor Scripting
   Utilities*, acepta y reinicia el editor.
3. *Tools > Execute Python Script…* > `Content/Python/importar_medellin.py`.
   Otra forma: en el *Output Log*, con la consola en modo **Python**:
   ```python
   import importar_medellin; importar_medellin.run()
   ```
   Opciones: `run(vegetacion=True, pasto=False, modelos=True, radio_m=None)`.
   Con `radio_m=400` solo se pone la utilería a 400 m de la aparición, más
   liviano para empezar.
4. Queda el nivel `/Game/Medellin/Mapas/Aranjuez` guardado, con sol, cielo,
   niebla, nubes y un `PlayerStart`. Dale *Play*: aparece el muñeco por defecto
   de Unreal en la calle donde arranca el juego web.

El script se puede volver a correr: limpia lo que puso la vez anterior.

### Qué revisar después de importar

- **Escala y ejes**: el script mide la conversión con `calibracion.glb` y lo
  dice en el *Output Log* (`ejes three.js -> Unreal: ...`). Si algo queda girado
  o espejado, mira ese mensaje.
- **Colores de las fachadas**: en el juego cada casa tiene su color por vértice.
  El script cambia esos materiales (los que terminan en `_vc`) por
  `M_ColorVertice`: color de vértice × textura × tinte.
- **Instancias**: la utilería va en componentes de instancias jerárquicas
  (un actor por tipo). Si tu versión no deja crearlos desde Python, el script
  pone actores sueltos y lo avisa. Esa forma es más pesada: usa `radio_m`.
- **Nanite**: para el terreno y los edificios conviene activarlo (selecciona las
  mallas de `Importado/Mundo` > clic derecho > *Nanite > Enable*).

## 4. Plan para pasar la jugabilidad

El juego web está ordenado por sistemas (`medellin-aranjuez/src`). Equivalencias
sugeridas en Unreal:

| Juego web | Archivos | En Unreal |
| --- | --- | --- |
| Personaje en tercera persona, cámaras (hombro, primera persona, capó) | `game/player.js`, `game/cameraRig.js` | Plantilla *Third Person* + `SpringArm`, *Enhanced Input* |
| Animaciones Rocketbox (caminar, correr, sentarse, gestos…) | `render/characterRig.js`, `scripts/assets/rocketbox.mjs` | Importar los FBX originales de [Microsoft Rocketbox](https://github.com/microsoft/Microsoft-Rocketbox) (MIT) con su esqueleto; *Animation Blueprint* y *Blend Spaces*. `animaciones.glb` viene empacado a la medida del juego web y no sirve. |
| Sentarse en la silla plástica | `sim/seatFit.js` | La silla mide 0,447 m de asiento; *Control Rig* o IK de piernas para los pies. |
| Carros y motos (física, cambios, sonido granular) | `sim/vehicle*.js`, `sim/engineModel.js`, `game/engineSound.js` | *Chaos Vehicles*; el motor con *MetaSounds* usando los granos de `public/sounds/motor` |
| Tráfico y peatones | `sim/roadNav.js`, `game/world.js`, `sim/npc*.js` | *ZoneGraph* + *Mass* (o *AI Controller* + *NavMesh* para pocos) |
| Actividades del barrio (ropa, fútbol, fumar…) | `game/activities.js` | *Smart Objects* |
| Policía y estrellas | `sim/police*.js`, `game/wanted*.js` | *Behavior Trees* + *EQS* |
| Misiones, locales, historia y cinemática | `game/missions.js`, `game/story*.js` | *Data Assets* para las misiones; *Sequencer* para la cinemática |
| Radio y voces paisas | `game/radio.js`, `public/sounds` | *MetaSounds* / *Sound Cues*; los audios de `public/sounds` se importan tal cual (revisa licencias en el README) |
| Cielo y hora del día | `render/sky.js` | *Sky Atmosphere* + *Volumetric Clouds* (ya están en el nivel) |
| HUD, menús, mapa | `ui/` | *UMG* |

El mapa real (calles de OpenStreetMap, alturas, lugares) está en
`medellin-aranjuez/src/data/mapa.json`; `puntos.json` trae lo más útil para
empezar la jugabilidad.

## Licencias

Los modelos y sonidos conservan sus licencias (ver `../medellin-aranjuez/README.md`
y `public/models/personajes/LICENSE-Rocketbox.md`).
