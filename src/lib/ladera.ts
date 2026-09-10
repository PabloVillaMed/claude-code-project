/**
 * Generador de "laderas": franjas de bloques de alturas distintas, como las
 * casas trepando el cerro. Se usa en la cabecera y como imagen de los parches
 * que no tienen fotografia libre.
 *
 * Es determinista: el mismo texto da siempre la misma ladera, asi que un parche
 * no cambia de aspecto entre visitas.
 */

export interface Bloque {
  x: number
  ancho: number
  alto: number
  /** Indice dentro de la paleta que reciba el componente. */
  color: number
  /** Ventanas encendidas, en coordenadas relativas al bloque. */
  ventanas: { x: number; y: number }[]
}

/** Hash FNV-1a de 32 bits: barato y suficiente para sembrar el generador. */
function semilla(texto: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < texto.length; i++) {
    h ^= texto.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** Generador congruencial lineal: numeros pseudoaleatorios reproducibles. */
function generador(estado: number): () => number {
  let s = estado || 1
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 0x100000000
  }
}

export interface OpcionesLadera {
  /** Ancho total del lienzo. */
  ancho: number
  /** Alto total del lienzo. */
  alto: number
  /** Ancho aproximado de cada casa. */
  paso?: number
  /** Fraccion del alto que ocupan las casas mas bajas y las mas altas. */
  minAlto?: number
  maxAlto?: number
  /** Cuantos colores tiene la paleta destino. */
  colores?: number
  /** Si se dibujan ventanas. */
  conVentanas?: boolean
}

export function generarLadera(clave: string, opciones: OpcionesLadera): Bloque[] {
  const {
    ancho,
    alto,
    paso = 26,
    minAlto = 0.25,
    maxAlto = 1,
    colores = 5,
    conVentanas = true,
  } = opciones

  const azar = generador(semilla(clave))
  const bloques: Bloque[] = []
  let x = 0
  let colorPrevio = -1

  while (x < ancho) {
    const anchoBloque = Math.round(paso * (0.65 + azar() * 0.8))
    const altoBloque = Math.round(alto * (minAlto + azar() * (maxAlto - minAlto)))

    // Evitar dos casas seguidas del mismo color: el contraste es el punto.
    let color = Math.floor(azar() * colores)
    if (color === colorPrevio) color = (color + 1) % colores
    colorPrevio = color

    const ventanas: Bloque['ventanas'] = []
    if (conVentanas) {
      const columnas = Math.max(1, Math.floor(anchoBloque / 11))
      const filas = Math.max(1, Math.floor(altoBloque / 14))
      for (let c = 0; c < columnas; c++) {
        for (let f = 0; f < filas; f++) {
          if (azar() > 0.55) ventanas.push({ x: 5 + c * 11, y: 7 + f * 14 })
        }
      }
    }

    bloques.push({ x, ancho: anchoBloque, alto: altoBloque, color, ventanas })
    x += anchoBloque + 1
  }

  return bloques
}
