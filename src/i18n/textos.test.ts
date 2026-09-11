import { describe, expect, it } from 'vitest'
import { ES } from './es'
import { EN } from './en'
import { IDIOMAS, NOMBRE_IDIOMA } from './tipos'
import type { Textos } from './tipos'

/** Recorre el objeto de textos y devuelve la ruta de cada hoja. */
function rutas(valor: unknown, prefijo = ''): string[] {
  if (typeof valor !== 'object' || valor === null) return [prefijo]
  if (Array.isArray(valor)) return [prefijo]
  return Object.entries(valor).flatMap(([clave, v]) => rutas(v, prefijo ? `${prefijo}.${clave}` : clave))
}

describe('textos', () => {
  it('los dos idiomas tienen exactamente las mismas claves', () => {
    expect(rutas(EN).sort()).toEqual(rutas(ES).sort())
  })

  it('ningún texto quedó vacío', () => {
    for (const textos of [ES, EN] as Textos[]) {
      for (const ruta of rutas(textos)) {
        const valor = ruta.split('.').reduce<any>((o, k) => o[k], textos)
        if (typeof valor === 'string') expect(valor.trim().length, ruta).toBeGreaterThan(0)
      }
    }
  })

  it('cada idioma tiene su nombre en su propia lengua', () => {
    for (const codigo of IDIOMAS) {
      expect(NOMBRE_IDIOMA[codigo]?.length).toBeGreaterThan(0)
    }
  })

  it('los nombres de los días son siete en cada idioma', () => {
    expect(ES.horario.dias).toHaveLength(7)
    expect(EN.horario.dias).toHaveLength(7)
  })

  it('el español y el inglés no comparten las mismas cadenas de interfaz', () => {
    // Si coincidieran todas sería señal de que un idioma quedó sin traducir.
    expect(EN.panel.quePlan).not.toBe(ES.panel.quePlan)
    expect(EN.resultados.ordenes.presupuesto).not.toBe(ES.resultados.ordenes.presupuesto)
  })
})
