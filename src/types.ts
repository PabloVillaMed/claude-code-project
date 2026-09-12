/** Modelo de dominio de la app de parches. */

/** Municipios del Valle de Aburra y alrededores cubiertos por el catalogo. */
export type Municipio =
  | 'Medellin'
  | 'Envigado'
  | 'Sabaneta'
  | 'Itagui'
  | 'La Estrella'
  | 'Caldas'
  | 'Bello'
  | 'Copacabana'
  | 'Girardota'
  | 'Barbosa'
  | 'Rionegro'
  | 'Guarne'
  | 'Santa Elena'

/** Tipo de plan. Un parche puede pertenecer a varias categorias. */
export type Categoria =
  | 'parque'
  | 'naturaleza'
  | 'cultura'
  | 'mirador'
  | 'comida'
  | 'cafe'
  | 'rumba'
  | 'deporte'
  | 'mercado'
  | 'biblioteca'
  | 'coworking'
  /**
   * Parche de calle: plazas y esquinas donde la ciudad se junta por fuera de
   * los bares, con ambiente alternativo y mucha tolerancia.
   */
  | 'bohemio'

/**
 * Cuanto cuesta entrar o pasar un rato.
 * `gratis` no cuesta nada, `$` es hasta ~30k COP por persona,
 * `$$` hasta ~80k y `$$$` de ahi para arriba.
 */
export type Presupuesto = 'gratis' | '$' | '$$' | '$$$'

/** Momento del dia en el que el parche esta en su mejor punto. */
export type Momento = 'manana' | 'tarde' | 'noche' | 'madrugada'

/**
 * Etiquetas de ambiente. Son la forma en que la gente describe un parche
 * cuando lo recomienda: "es tranquilo", "es para bailar", "es familiar".
 */
export type Ambiente =
  | 'tranquilo'
  | 'familiar'
  | 'bailable'
  | 'romantico'
  | 'creativo'
  | 'estudiar'
  | 'deportivo'
  | 'turistico'
  | 'local'
  | 'al aire libre'
  | 'alternativo'

/**
 * Criterios de acceso. Existen para que el buscador sirva a personas
 * de contextos distintos, no solo a quien tiene carro y plata.
 */
export interface Accesibilidad {
  /** Acceso en silla de ruedas o con movilidad reducida. */
  movilidadReducida: boolean
  /** Se llega caminando desde una estacion de Metro, Tranvia, Metrocable o Metroplus. */
  cercaAlMetro: boolean
  /** Espacio pensado o seguro para ir con ninos. */
  aptoNinos: boolean
  /** Se puede entrar con mascota. */
  petFriendly: boolean
  /** Espacio que se declara abierto y seguro para personas LGBTIQ+. */
  lgbtiqFriendly: boolean
  /** Hay plan sin consumo de alcohol. */
  sinAlcohol: boolean
}

/** Franja horaria de un dia. `dia` usa la convencion de Date: 0 = domingo. */
export interface Horario {
  dia: 0 | 1 | 2 | 3 | 4 | 5 | 6
  /** Hora de apertura en formato HH:MM (24h). */
  abre: string
  /** Hora de cierre en formato HH:MM (24h). Puede pasar de medianoche (ej. '02:00'). */
  cierra: string
}

export interface Parche {
  id: string
  nombre: string
  municipio: Municipio
  /** Barrio, vereda o sector. */
  sector: string
  categorias: Categoria[]
  presupuesto: Presupuesto
  momentos: Momento[]
  ambiente: Ambiente[]
  accesibilidad: Accesibilidad
  /** Que es y por que vale la pena. */
  descripcion: string
  /** Como llegar en transporte publico, cuando aplica. */
  comoLlegar?: string
  horarios: Horario[]
  /** Nota libre sobre horarios: temporadas, festivos, cierres por mantenimiento. */
  notaHorario?: string
  /**
   * Lo que hay que saber antes de ir: seguridad, transporte, con quien ir.
   * Existe para poder recomendar sitios reales sin maquillarlos.
   */
  advertencia?: string
  /**
   * Sitio donde se consume cannabis y otras sustancias a la vista, con una
   * permisividad que no hay en otros barrios.
   *
   * Es un dato descriptivo, no una recomendacion: en Medellin el consumo en
   * espacio publico esta prohibido por el Decreto 0044 de 2024 y la multa
   * puede pasar de un salario minimo. Se marca para que cada quien decida,
   * tanto quien busca ese ambiente como quien prefiere evitarlo.
   */
  toleranciaConsumo?: boolean
  /** Texto que se usa para armar el enlace de Google Maps. */
  consultaMapa: string
  /** Sitio web oficial, cuando existe. */
  web?: string
}
