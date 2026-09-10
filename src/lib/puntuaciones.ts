const CLAVE = 'parches-medellin:puntuaciones'

/** Puntuacion de 1 a 5 estrellas por parche. 0 o ausente significa sin puntuar. */
export type Puntuaciones = Record<string, number>

function valida(n: unknown): n is number {
  return typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= 5
}

/**
 * Lee las puntuaciones guardadas en el navegador.
 * Son de quien usa el telefono: no se comparten ni se suben a ningun lado.
 * Cualquier fallo de almacenamiento se trata como "sin puntuaciones".
 */
export function leerPuntuaciones(): Puntuaciones {
  try {
    const crudo = localStorage.getItem(CLAVE)
    if (!crudo) return {}
    const valor: unknown = JSON.parse(crudo)
    if (typeof valor !== 'object' || valor === null || Array.isArray(valor)) return {}
    const limpio: Puntuaciones = {}
    for (const [id, n] of Object.entries(valor as Record<string, unknown>)) {
      if (valida(n)) limpio[id] = n
    }
    return limpio
  } catch {
    return {}
  }
}

/** Guarda las puntuaciones. Si el navegador no deja escribir, no pasa nada. */
export function guardarPuntuaciones(puntuaciones: Puntuaciones): void {
  try {
    localStorage.setItem(CLAVE, JSON.stringify(puntuaciones))
  } catch {
    // Sin persistencia: la sesion actual sigue funcionando igual.
  }
}

/**
 * Aplica una puntuacion. Volver a tocar la misma estrella la quita, que es
 * como se corrige un voto sin necesitar un boton aparte.
 */
export function aplicarPuntuacion(puntuaciones: Puntuaciones, id: string, estrellas: number): Puntuaciones {
  const siguiente = { ...puntuaciones }
  if (siguiente[id] === estrellas) delete siguiente[id]
  else siguiente[id] = estrellas
  return siguiente
}
