# Parche

Buscador de **parches**: lugares de encuentro, establecimientos y zonas de esparcimiento
en Medellín y los municipios cercanos del Valle de Aburrá y el Oriente antioqueño.

La app se llama **Parche** (así aparece en el lanzador); `com.parchesmedellin.app` sigue
siendo el identificador del paquete y no cambia, porque cambiarlo haría que Android
instalara una app nueva al lado en vez de actualizar la que ya está.

La idea es simple: que cualquiera —con o sin plata, con carro o en Metro, con niños, con
mascota, en silla de ruedas, de rumba o buscando dónde estudiar— pueda encontrar un plan
que le sirva. Por eso los filtros no son solo de categoría: también de **presupuesto**,
**transporte público** y **condiciones de acceso**.

## Qué hace

- **Busca por texto** en nombre, sector, descripción y etiquetas, sin importar tildes ni mayúsculas.
- **Filtra por tipo de plan**: parques, naturaleza, cultura, miradores, comida, cafés, rumba,
  deporte, mercados, bibliotecas, sitios para trabajar y **parches bohemios** (las plazas y
  esquinas donde la ciudad se junta en la calle).
- **Avisos de *Antes de ir*** en 19 fichas: seguridad, transporte y a qué hora conviene ir.
  Sirve para recomendar sitios reales sin maquillarlos.
- **Filtro de zona de tolerancia**, en los dos sentidos: *Solo estas* para quien busca ese
  ambiente y *Sin consumo a la vista* para quien prefiere evitarlo.
- **Filtra por presupuesto**: gratis, económico, medio, alto.
- **Filtra por acceso** (todos los criterios que marques deben cumplirse): cerca al Metro,
  movilidad reducida, apto para niños, pet friendly, LGBTIQ+ friendly y plan sin alcohol.
- **Filtra por municipio, momento del día y ambiente.**
- **Abierto ahora**: calcula si el sitio está abierto según sus horarios, incluidas las
  franjas que cruzan la medianoche (esa discoteca que cierra a las 3 a. m.).
- **Cambia de idioma** desde el desplegable de la esquina superior derecha:
  español e inglés. La primera vez se escoge por el idioma del dispositivo y
  después se recuerda.
- **Carrusel de fotos** en cada parche que tenga más de una, arrastrable en el
  teléfono y con flechas en el escritorio.
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
├── data/fotos.ts            # créditos de las fotos de Wikimedia Commons (generado)
├── data/parches-en.ts       # traducción del catálogo al inglés
├── i18n/                    # textos de la interfaz por idioma y contexto de React
├── lib/
│   ├── filtros.ts           # lógica de filtrado y búsqueda
│   ├── orden.ts             # criterios de ordenación
│   ├── horarios.ts          # "abierto ahora" y resumen de horarios
│   ├── favoritos.ts         # persistencia en localStorage
│   ├── puntuaciones.ts      # tus estrellas, en localStorage
│   ├── traducir.ts          # catálogo en el idioma elegido
│   ├── ladera.ts            # generador de las fachadas de colores
│   └── etiquetas.ts         # textos y color por tipo de plan
├── components/              # PanelFiltros, TarjetaParche, DetalleParche, Carrusel, Estrellas, Ladera, SelectorIdioma
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

Las tipografías (**Baloo 2** y **Asap**, ambas SIL Open Font License) están en
`public/fuentes/` y se sirven desde la propia app, no desde Google Fonts: así la
tipografía funciona sin conexión, igual que el catálogo.

## Idiomas

La app está en **español** e **inglés**. El desplegable de la esquina superior
derecha cambia entre los dos; la elección se guarda en el dispositivo y el
atributo `lang` del documento la sigue, que es lo que leen los lectores de
pantalla.

- `src/i18n/tipos.ts` declara la forma de los textos. Al ser una interfaz de
  TypeScript, **no se puede añadir un idioma a medias**: falla la compilación
  si falta una cadena.
- `src/i18n/es.ts` y `src/i18n/en.ts` son los textos de la interfaz.
- `src/data/parches-en.ts` traduce el catálogo.

Los **nombres propios se quedan en español** a propósito: `Parque Lleras` sigue
siendo `Parque Lleras` en inglés, porque es lo que dice el letrero, lo que
entiende un taxista y lo que hay que buscar en un mapa. Lo que se traduce es
todo lo demás. Cuando el nombre es puramente descriptivo se añade la parte
genérica en inglés (`Girardota main square and Señor Caído basilica`).

Para añadir un idioma: crea `src/i18n/<código>.ts` implementando `Textos`,
añádelo a `IDIOMAS` y a `NOMBRE_IDIOMA` en `tipos.ts`, registra los textos en
`contexto.tsx` y traduce el catálogo en un `parches-<código>.ts`. Las pruebas
comprueban que los idiomas tengan exactamente las mismas claves.

## Fotos y créditos

Las fotos vienen de **Wikimedia Commons**, todas con licencia libre (CC BY, CC BY-SA o
dominio público). Están recortadas a 16:9, convertidas a WebP y empaquetadas en
`public/fotos/`, así que se ven sin conexión.

**41 de los 54 lugares tienen fotografía verificada**, 92 fotos en total, y 32 de ellos
tienen más de una: esos se muestran en carrusel. `src/data/fotos.ts` guarda para cada
foto el autor, la licencia y el enlace a su página en Commons, y la app muestra todos
esos créditos en el detalle del parche, como exigen las licencias CC BY y CC BY-SA.

**Un parche sin foto no lleva la foto de otro sitio.** Los 13 restantes se dibujan con
una fachada generada a partir de su id.

Las candidatas se buscan por **categoría** de Commons, no por texto libre, que es mucho
más fiable, y después se revisan **una por una**. La búsqueda automática trae falsos
positivos con nombre idéntico que hay que descartar a mano: el Cerro de las Tres Cruces
de **Cali**, el Parque del Poblado de **Puertollano (España)**, el Museo Casa de la
Memoria Indómita de **Ciudad de México**, la Biblioteca Piloto del **Caribe**
(Barranquilla), los parques de Salamina y La Dorada (**departamento** de Caldas, no el
municipio antioqueño) y un retrato del prócer Atanasio Girardot en vez del estadio.

Una prueba comprueba que cada archivo referenciado en `fotos.ts` exista de verdad en
`public/fotos/`, que la numeración no tenga huecos y que ninguna foto se quede sin
autor, licencia ni página de origen.

## Investigación del catálogo

Los parches de calle y los miradores que se añadieron en la 1.4.0 están
documentados en [`docs/investigacion-parches-de-calle.md`](docs/investigacion-parches-de-calle.md):
qué se confirmó de cada sitio, con qué fuente, y qué no se pudo consultar
(Reddit bloquea al rastreador y los grupos de Facebook están tras un login).

## Zonas de tolerancia

Seis fichas están marcadas como **zona de tolerancia**: sitios donde se consume cannabis y
otras sustancias a la vista, con una permisividad que no hay en otros barrios.

Es un dato **descriptivo, no una recomendación**, y la app lo dice con todas las letras en
la ficha: *que se tolere no quiere decir que sea legal*. En Medellín el
[Decreto 0044 de 2024](https://www.elcolombiano.com/medellin/hasta-un-salario-minimo-de-multa-por-consumir-drogas-en-el-espacio-en-medellin-alcalde-federico-gutierrez-decreto-EB23557322)
prohíbe el consumo de sustancias psicoactivas —dosis mínima incluida— en parques, plazas y
alrededor de colegios, con multas de 8 a 32 salarios mínimos diarios.

El filtro funciona en los dos sentidos a propósito. A una familia con niños le sirve tanto
como a quien busca ese parche, y marcar el sitio sin explicar qué pasa ahí sería dejar el
aviso a medias: una prueba comprueba que **toda zona marcada lleve su nota de *Antes de ir***,
en español y en inglés.

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
