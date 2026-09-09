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

## Estructura

```
src/
├── types.ts                 # modelo de dominio (Parche, Accesibilidad, Horario...)
├── data/parches.ts          # catálogo semilla de lugares
├── lib/
│   ├── filtros.ts           # lógica de filtrado y búsqueda
│   ├── horarios.ts          # "abierto ahora" y resumen de horarios
│   ├── favoritos.ts         # persistencia en localStorage
│   └── etiquetas.ts         # textos y emojis de la interfaz
├── components/              # PanelFiltros, TarjetaParche, DetalleParche, Chip
└── App.tsx
```

La lógica de negocio (`src/lib/filtros.ts` y `src/lib/horarios.ts`) está separada de la
interfaz y tiene pruebas propias, así que se puede reutilizar tal cual si más adelante
esto se convierte en app móvil o en API.

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
