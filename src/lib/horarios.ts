import type { Horario, Parche } from '../types'

/** Convierte 'HH:MM' a minutos desde medianoche. */
export function aMinutos(hora: string): number {
  const [h, m] = hora.split(':')
  return Number(h) * 60 + Number(m)
}

/**
 * Indica si una franja cubre el momento dado.
 * Una franja que cierra antes de abrir (ej. 20:00 a 03:00) cruza la medianoche
 * y por tanto tambien cubre las primeras horas del dia siguiente.
 */
function cubre(franja: Horario, diaSemana: number, minutos: number): boolean {
  const abre = aMinutos(franja.abre)
  const cierra = aMinutos(franja.cierra)

  if (cierra > abre) {
    return franja.dia === diaSemana && minutos >= abre && minutos < cierra
  }

  // Cruza medianoche: la parte inicial cuenta para su dia y la final para el siguiente.
  if (franja.dia === diaSemana && minutos >= abre) return true
  const diaAnterior = (diaSemana + 6) % 7
  return franja.dia === diaAnterior && minutos < cierra
}

/** Indica si el parche esta abierto en el momento dado. */
export function estaAbierto(parche: Parche, momento: Date = new Date()): boolean {
  const diaSemana = momento.getDay()
  const minutos = momento.getHours() * 60 + momento.getMinutes()
  return parche.horarios.some((franja) => cubre(franja, diaSemana, minutos))
}

const NOMBRES_DIA = ['Dom', 'Lun', 'Mar', 'Mie', 'Jue', 'Vie', 'Sab']

/**
 * Resume los horarios en texto legible, agrupando los dias que comparten franja.
 * Ej: 'Lun a Vie 08:00-18:00 | Sab 09:00-16:00'.
 */
export function resumirHorarios(horarios: Horario[]): string {
  if (horarios.length === 0) return 'Sin horario registrado'
  if (horarios.length === 7 && horarios.every((h) => h.abre === horarios[0].abre && h.cierra === horarios[0].cierra)) {
    const { abre, cierra } = horarios[0]
    if (abre === '00:00' && cierra === '23:59') return 'Espacio publico, abierto siempre'
    return `Todos los dias ${abre}-${cierra}`
  }

  const porFranja = new Map<string, number[]>()
  for (const h of horarios) {
    const clave = `${h.abre}-${h.cierra}`
    porFranja.set(clave, [...(porFranja.get(clave) ?? []), h.dia])
  }

  const partes: string[] = []
  for (const [franja, listaDias] of porFranja) {
    const ordenados = [...listaDias].sort((a, b) => a - b)
    const etiqueta = esRangoContinuo(ordenados)
      ? `${NOMBRES_DIA[ordenados[0]]} a ${NOMBRES_DIA[ordenados[ordenados.length - 1]]}`
      : ordenados.map((d) => NOMBRES_DIA[d]).join(', ')
    partes.push(`${etiqueta} ${franja}`)
  }
  return partes.join(' | ')
}

function esRangoContinuo(dias: number[]): boolean {
  return dias.length > 2 && dias.every((d, i) => i === 0 || d === dias[i - 1] + 1)
}
