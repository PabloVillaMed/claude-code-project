# Dirección de diseño

## El encargo

Una app para encontrar plan en Medellín, para gente de contextos muy distintos:
quien no tiene plata, quien anda en Metro, quien va con niños, quien va en silla
de ruedas, quien busca rumba y quien busca dónde estudiar. El trabajo de la
interfaz es que alguien decida a dónde ir **hoy**, sabiendo de una qué cuesta y
cómo se llega.

La primera versión se veía genérica: fondo crema tibio, tipografía del sistema,
tarjetas redondeadas con sombra gris suave, filas de chips con emoji. Es el kit
por defecto que sale para cualquier producto, y no dice nada de Medellín.

## De dónde sale la forma

Del valle mismo. Las laderas del Aburrá son bloques de color plano apilados:
fachadas pintadas en colores que no combinan y que juntos funcionan. A eso se
suma la rotulación a mano de las tiendas de barrio y las chivas: letra pesada,
ancha, sin sutilezas, y color saturado sin degradados.

## Paleta

Cinco acentos, y **cada uno significa algo**: es el tipo de plan, no decoración.

| Token | Hex | Qué marca |
|---|---|---|
| `--verde` | `#0B6E3F` | parques, naturaleza, miradores |
| `--azul` | `#0A5FA8` | cultura, bibliotecas, trabajar |
| `--amarillo` | `#F0B310` | comida, cafés, mercados |
| `--rosa` | `#C8226A` | rumba |
| `--naranja` | `#E0561C` | deporte |

Sobre `--tinta` `#14231A` (un verde casi negro, no un gris tintado) y `--papel`
`#E9ECE3` (verde grisáceo lavado, no crema).

## Tipografía

La primera pasada usaba **Archivo** (grotesca de cartel ultra negra) con
**Bitter**. Funcionaba, pero la grotesca pesadísima es justo el tic de la
tipografía generada: dura, apretada y sin calidez. Se cambió por dos letras
redondas:

- **Baloo 2** (variable, 400–800) para el logotipo y los títulos. Terminaciones
  redondeadas y trazo grueso: se lee como algo hecho a mano, no como un cartel
  corporativo.
- **Asap** (variable, 400–700) para el texto. Es de Omnibus-Type, un taller
  argentino, y está dibujada pensando en el español; sus esquinas ligeramente
  redondeadas hacen juego con el logotipo sin competir con él.

Se eligieron mirándolas: se montó un espécimen con seis parejas candidatas
puestas sobre contenido real de la app, y se decidió sobre la imagen, no de
memoria. Ambas se empaquetan en `public/fuentes/`, así que la tipografía
funciona sin conexión igual que el catálogo.

## Redondeo

Hay **tres radios, cada uno con un trabajo**, no uno solo para todo (que es
precisamente el tic del kit de tarjetas genérico):

| Token | Valor | Para qué |
|---|---|---|
| `--radio-control` | pastilla | botones, filtros, desplegables, el buscador |
| `--radio` | 18 px | tarjetas, modal, bloques grandes |
| `--radio-chico` | 8 px | etiquetas pequeñas dentro de la tarjeta |

Las casas de la ladera se redondean **solo por el tejado**: se dibujan más
altas de la cuenta y lo que sobra cae fuera del lienzo, así apoyan en el suelo
en ángulo recto.

La profundidad sigue viniendo del color plano y de una línea de 1 px. No hay
sombras difusas ni degradados: eso es lo que convierte un diseño redondeado en
el kit de cualquier producto.

## Estructura

- **El bloque de tinta.** La cabecera es un rectángulo oscuro a sangre con el
  logotipo grande y, en su borde inferior, la **ladera**: una franja de bloques
  de color de alturas distintas, como las casas trepando el cerro. Es el único
  momento atrevido de la página; todo lo demás va callado.
- **Las tarjetas** llevan foto real del lugar arriba y una cinta de color del
  tipo de plan como dintel. Sin sombra, sin degradado, borde de 1px y radio de
  3px: la profundidad la da el color, no el desenfoque.
- **Sin foto, no se inventa una.** Los lugares sin fotografía libre verificable
  llevan una fachada generada a partir de su id, con el mismo lenguaje de la
  ladera.
- **Los filtros** no van en una caja: son texto y controles sobre el papel,
  separados por una línea fina.

## El nombre y el icono

La app se llama **Parche**. Es la palabra local, cabe en un lanzador y funciona
igual en las dos versiones de idioma. `Medellín` va debajo, pequeño, como
apellido de la marca.

El icono es la P blanca sobre la ladera de colores, en naranja. Se dibujaron
cinco propuestas y se compararon **a 44 px**, que es el tamaño en el que de
verdad se ve un icono: las que eran solo barras de color se leían como un
gráfico de barras, y la oscura desaparecía sobre fondos oscuros. La P resuelve
las dos cosas: identifica y contrasta.

Va en tres piezas (`assets/icon.png`, `icon-background.png`,
`icon-foreground.png`) porque el icono adaptativo de Android recorta los bordes
con la forma que use cada lanzador: el fondo lleva el naranja y la ladera, y la
capa delantera solo la P, dentro de la zona segura.

## Lo que se evitó a propósito

Repasado contra los tics que delatan una interfaz generada:

- Crema `#F4F1EA` + serif de alto contraste + acento terracota.
- Negro casi puro con un único acento ácido.
- El kit de tarjetas SaaS: mismo radio en todo, misma sombra gris, lavados de
  degradado como adorno.
- Rótulos en VERSALITAS sobre cada sección.
- Metadatos encadenados con puntos medios (`A · B · C`).
- Emoji haciendo de sistema de iconos.
- Flecha `→` pegada al texto de los botones.
- Entradas con desvanecido y deslizamiento en cada tarjeta. El movimiento queda
  solo donde responde a una acción: abrir el detalle y puntuar. Se respeta
  `prefers-reduced-motion`.
