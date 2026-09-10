# Parches Medellín

Buscador de **parches**: lugares de encuentro, establecimientos y zonas de esparcimiento
en Medellín y los municipios cercanos del Valle de Aburrá y el Oriente antioqueño.

La idea es simple: que cualquiera —con o sin plata, con carro o en Metro, con niños, con
mascota, en silla de ruedas, de rumba o buscando dónde estudiar— pueda encontrar un plan
que le sirva. Por eso los filtros no son solo de categoría: también de **presupuesto**,
**transporte público** y **condiciones de acceso**.

## Qué hace

- **Busca por texto** en nombre, sector, descripción y etiquetas, sin importar tildes ni mayúsculas.
- **Filtra por tipo de plan**: parques, naturaleza, cultura, miradores, comida, cafés, rumba,
  deporte, mercados, bibliotecas y sitios para trabajar.
- **Filtra por presupuesto**: gratis, económico, medio, alto.
- **Filtra por acceso** (todos los criterios que marques deben cumplirse): cerca al Metro,
  movilidad reducida, apto para niños, pet friendly, LGBTIQ+ friendly y plan sin alcohol.
- **Filtra por municipio, momento del día y ambiente.**
- **Abierto ahora**: calcula si el sitio está abierto según sus horarios, incluidas las
  franjas que cruzan la medianoche (esa discoteca que cierra a las 3 a. m.).
- **Puntúa con estrellas** cada parche, de 1 a 5. La puntuación es **tuya y de este
  dispositivo**: se guarda en el navegador, no se comparte ni se sube a ningún servidor.
  Puedes ordenar por ella y filtrar por «4 estrellas o más».
- **Ordena** por sugeridos, tu puntuación, nombre o precio.
- **Favoritos** guardados en el navegador.
- **Sorpréndeme**: escoge un parche al azar entre los resultados filtrados.
- **Abrir en Google Maps** desde el detalle de cada parche.

## Cómo correrlo

Requiere Node 20 o superior.

```bash
npm install
npm run dev        # servidor de desarrollo
npm test           # pruebas (vitest)
npm run typecheck  # revisión de tipos
npm run build      # build de producción en dist/
npm run preview    # sirve el build
```

## App para Android

El proyecto se empaqueta como app nativa con [Capacitor](https://capacitorjs.com):
la misma interfaz web corre dentro de un WebView y el catálogo viaja dentro del APK,
así que **la app abre sin conexión**. Solo se necesita internet para abrir Google Maps
o el sitio oficial de un lugar.

- **Package**: `com.parchesmedellin.app`
- **Versión**: 1.0.0 (versionCode 1)
- **Mínimo**: Android 7.0 (API 24). Compila y apunta a API 36.

### Compilar el APK

Necesitas JDK 21 y el SDK de Android (plataforma 36 y build-tools 36) con
`ANDROID_HOME` apuntando a él.

```bash
npm run android:debug     # APK de depuración, sin configurar firma
npm run android:release   # APK firmado, requiere android/keystore.properties
```

El resultado queda en `android/app/build/outputs/apk/`.

### Firma

`android/app/build.gradle` lee la firma de `android/keystore.properties`, que **no está
en el repositorio** (ver `keystore.properties.example`). Si ese archivo no existe, el
proyecto sigue compilando y el APK de release simplemente queda sin firmar.

Para generar tu propio keystore:

```bash
keytool -genkeypair -v -keystore android/parches-release.keystore -alias parches \
  -keyalg RSA -keysize 2048 -validity 10950
```

Guarda bien ese archivo y su contraseña: Android identifica la app por su firma, y sin
el mismo keystore no se pueden publicar actualizaciones sobre una instalación existente.

### Iconos

Los originales están en `assets/` (`icon.png` de 1024×1024 y los splash de 2732×2732).
Después de cambiarlos, regenera todas las densidades con:

```bash
npx @capacitor/assets generate --android
```

## Estructura

```
src/
├── types.ts                 # modelo de dominio (Parche, Accesibilidad, Horario...)
├── data/parches.ts          # catálogo semilla de lugares
├── data/fotos.ts            # créditos de las fotos de Wikimedia Commons
├── lib/
│   ├── filtros.ts           # lógica de filtrado y búsqueda
│   ├── orden.ts             # criterios de ordenación
│   ├── horarios.ts          # "abierto ahora" y resumen de horarios
│   ├── favoritos.ts         # persistencia en localStorage
│   ├── puntuaciones.ts      # tus estrellas, en localStorage
│   ├── ladera.ts            # generador de las fachadas de colores
│   └── etiquetas.ts         # textos y color por tipo de plan
├── components/              # PanelFiltros, TarjetaParche, DetalleParche, Estrellas, Ladera
└── App.tsx

android/                     # proyecto nativo generado por Capacitor
assets/                      # icono y splash originales de la app
```

La lógica de negocio (`src/lib/filtros.ts` y `src/lib/horarios.ts`) está separada de la
interfaz y tiene pruebas propias, así que se puede reutilizar tal cual si más adelante
esto se convierte en app móvil o en API.

## Diseño

La dirección visual está documentada en [`docs/diseno.md`](docs/diseno.md): de dónde
sale la forma, la paleta, la tipografía y los tics que se evitaron a propósito.

Se apoyó en la skill `frontend-design` del marketplace `anthropics/skills`, que está
copiada en [`.claude/skills/`](.claude/skills/) junto con `webapp-testing` y
`brand-guidelines` para que cualquier sesión de Claude Code en este repo las tenga a mano.

Las tipografías (Archivo y Bitter, ambas SIL Open Font License) están en
`public/fuentes/` y se sirven desde la propia app, no desde Google Fonts: así la
tipografía funciona sin conexión, igual que el catálogo.

## Fotos y créditos

Las fotos vienen de **Wikimedia Commons**, todas con licencia libre (CC BY, CC BY-SA o
dominio público). Están recortadas a 16:9, convertidas a WebP y empaquetadas en
`public/fotos/`, así que se ven sin conexión.

`src/data/fotos.ts` guarda para cada una el autor, la licencia y el enlace a su página
en Commons, y la app muestra ese crédito en el detalle del parche, como exigen las
licencias CC BY y CC BY-SA.

**Un parche sin foto no lleva la foto de otro sitio.** De los 54 lugares, 33 tienen
fotografía verificada; los otros 21 se dibujan con una fachada generada a partir de su
id. Se descartaron a mano las candidatas que no correspondían al lugar (una iglesia
homónima en Brasil, el aeropuerto en vez del parque de al lado, una montaña con el mismo
nombre en otro país).

## Sobre los datos

El catálogo de `src/data/parches.ts` es una **semilla** armada con espacios públicos y
sectores conocidos del Valle de Aburrá y el Oriente cercano. Un par de advertencias
honestas:

- **Horarios y precios son referenciales.** Cambian por temporada, festivos y
  mantenimiento. La app lo dice en el pie y en el detalle de cada parche: confirma antes de salir.
- **No hay coordenadas inventadas.** Cada parche guarda un texto de búsqueda
  (`consultaMapa`) y la app arma con él un enlace a Google Maps, en vez de fijar un punto
  que podría estar mal.
- **Faltan establecimientos privados.** La semilla se concentra en espacio público, que es
  lo que se puede verificar y lo que además es gratis. Los bares, cafés y restaurantes
  puntuales están para que los agregue quien los conozca.

## Agregar un parche

Añade un objeto al arreglo `PARCHES` en `src/data/parches.ts`:

```ts
{
  id: 'mi-parche',                       // único, en minúsculas y con guiones
  nombre: 'Nombre del lugar',
  municipio: 'Envigado',                 // ver el tipo Municipio en src/types.ts
  sector: 'Barrio o vereda',
  categorias: ['cafe', 'coworking'],
  presupuesto: '$',                      // 'gratis' | '$' | '$$' | '$$$'
  momentos: ['manana', 'tarde'],
  ambiente: ['tranquilo', 'estudiar'],
  accesibilidad: acceso('cercaAlMetro', 'aptoNinos'),  // lo que no listes queda en false
  descripcion: 'Qué es y por qué vale la pena.',
  comoLlegar: 'Estación X del Metro.',   // opcional
  horarios: dias([1, 2, 3, 4, 5], '08:00', '18:00'),
  consultaMapa: 'Nombre del lugar',      // texto para buscar en Google Maps
}
```

Los ayudantes `acceso`, `dias`, `todosLosDias` y `siempreAbierto` están al principio del
mismo archivo. `npm test` valida que no haya ids repetidos, que los campos mínimos estén
completos y que las horas tengan formato `HH:MM`.

Al agregar un lugar, ponle atención a los campos de accesibilidad: son los que hacen que
la app sirva para gente en situaciones distintas a la de quien la escribe.
