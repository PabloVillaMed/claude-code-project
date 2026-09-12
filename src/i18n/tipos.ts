import type { Ambiente, Categoria, Momento, Municipio, Presupuesto } from '../types'
import type { ClaveAcceso } from '../lib/filtros'
import type { Orden } from '../lib/orden'

export const IDIOMAS = ['es', 'en'] as const
export type Idioma = (typeof IDIOMAS)[number]

/** Nombre de cada idioma en su propia lengua, que es como se elige un idioma. */
export const NOMBRE_IDIOMA: Record<Idioma, string> = {
  es: 'Español',
  en: 'English',
}

/**
 * Todo el texto de la interfaz. Al ser una interfaz y no un diccionario suelto,
 * TypeScript obliga a que cada idioma la complete entera: no se puede olvidar
 * una cadena sin que falle la compilación.
 */
export interface Textos {
  meta: {
    titulo: string
    descripcion: string
    htmlLang: string
  }
  cabecera: {
    sobre: string
    bajada: string
    buscarPlaceholder: string
    buscarEtiqueta: string
    sorprendeme: string
    verFiltros: string
    ocultarFiltros: string
    elegirIdioma: string
  }
  panel: {
    titulo: string
    limpiar: (n: number) => string
    abiertoAhora: string
    favoritos: string
    quePlan: string
    cuantoGastar: string
    acceso: string
    accesoAyuda: string
    tuPuntuacion: string
    minEstrellas: (n: number) => string
    soloCinco: string
    puntuados: (n: number) => string
    sinPuntuar: string
    municipio: string
    momento: string
    ambiente: string
  }
  resultados: {
    /** El numero va aparte porque se muestra en grande. */
    conteoResto: (total: number) => string
    ordenarPor: string
    ordenes: Record<Orden, string>
    vacioTitulo: string
    vacioTexto: string
    limpiarFiltros: string
  }
  parche: {
    abierto: string
    cerrado: string
    verDetalles: string
    guardarFavorito: (nombre: string) => string
    quitarFavorito: (nombre: string) => string
    cerrarDetalle: string
    advertencia: string
    horarios: string
    comoLlegar: string
    ambiente: string
    accesoTitulo: string
    abrirMapa: string
    sitioOficial: string
    guardarEnFavoritos: string
    quitarDeFavoritos: string
    tuPuntuacion: string
    notaPuntuada: string
    notaSinPuntuar: string
    puntuarCon: (nombre: string, n: number) => string
    quitarPuntuacion: (nombre: string) => string
    puntuacionActual: (n: number) => string
    sinPuntuacion: string
    credito: (autor: string) => string
    creditoVia: string
    fotoDe: (nombre: string, sector: string) => string
    fotoAnterior: string
    fotoSiguiente: string
    irAFoto: (n: number, total: number) => string
  }
  horario: {
    dias: string[]
    siempreAbierto: string
    todosLosDias: (abre: string, cierra: string) => string
    sinHorario: string
    a: string
  }
  pie: {
    catalogo: string
    fotos: string
  }
  categorias: Record<Categoria, string>
  presupuestos: Record<Presupuesto, string>
  momentos: Record<Momento, string>
  ambientes: Record<Ambiente, string>
  municipios: Record<Municipio, string>
  accesos: Record<ClaveAcceso, { corto: string; largo: string }>
}
