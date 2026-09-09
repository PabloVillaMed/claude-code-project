const CLAVE = 'parches-medellin:favoritos'

/**
 * Lee los favoritos guardados en el navegador.
 * Cualquier fallo (modo privado, almacenamiento bloqueado, datos corruptos)
 * se trata como "no hay favoritos" en vez de romper la app.
 */
export function leerFavoritos(): Set<string> {
  try {
    const crudo = localStorage.getItem(CLAVE)
    if (!crudo) return new Set()
    const valor: unknown = JSON.parse(crudo)
    if (!Array.isArray(valor)) return new Set()
    return new Set(valor.filter((v): v is string => typeof v === 'string'))
  } catch {
    return new Set()
  }
}

/** Guarda los favoritos. Si el navegador no deja escribir, no pasa nada. */
export function guardarFavoritos(favoritos: Set<string>): void {
  try {
    localStorage.setItem(CLAVE, JSON.stringify([...favoritos]))
  } catch {
    // Sin persistencia: la sesion actual sigue funcionando igual.
  }
}
