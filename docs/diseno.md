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

- **Archivo** (variable, 700–900, ancho 100–125) para el logotipo, los títulos y
  las cifras. Es una grotesca de cartel: hace el trabajo de la letra pintada.
- **Bitter** (400–600), una slab serif, para descripciones y texto largo. Da
  calidez de impreso y separa claramente el contenido del rótulo.

Ambas se empaquetan en la app (`public/fuentes/`), así que la tipografía
funciona sin conexión igual que el catálogo.

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
