import { describe, expect, it } from 'vitest'
import { traducirParches } from './traducir'
import { PARCHES } from '../data/parches'
import { PARCHES_EN } from '../data/parches-en'

describe('traducirParches', () => {
  it('en español devuelve el catálogo tal cual', () => {
    expect(traducirParches(PARCHES, 'es')).toBe(PARCHES)
  })

  it('traduce el texto visible y deja el resto intacto', () => {
    const [primero] = traducirParches(PARCHES, 'en')
    const original = PARCHES[0]
    const traduccion = PARCHES_EN[original.id]
    expect(primero.nombre).toBe(traduccion.nombre)
    expect(primero.descripcion).toBe(traduccion.descripcion)
    // Lo que no es texto de pantalla no cambia con el idioma.
    expect(primero.id).toBe(original.id)
    expect(primero.horarios).toEqual(original.horarios)
    expect(primero.accesibilidad).toEqual(original.accesibilidad)
    expect(primero.consultaMapa).toBe(original.consultaMapa)
    expect(primero.presupuesto).toBe(original.presupuesto)
  })

  it('no pierde ni duplica parches', () => {
    const traducidos = traducirParches(PARCHES, 'en')
    expect(traducidos).toHaveLength(PARCHES.length)
    expect(traducidos.map((p) => p.id)).toEqual(PARCHES.map((p) => p.id))
  })
})

describe('catálogo en inglés', () => {
  it('traduce los 54 parches, sin sobrar ninguno', () => {
    const ids = PARCHES.map((p) => p.id).sort()
    expect(Object.keys(PARCHES_EN).sort()).toEqual(ids)
  })

  it('no deja ningún texto vacío', () => {
    for (const [id, t] of Object.entries(PARCHES_EN)) {
      expect(t.nombre.trim().length, id).toBeGreaterThan(0)
      expect(t.sector.trim().length, id).toBeGreaterThan(0)
      expect(t.descripcion.trim().length, id).toBeGreaterThan(20)
    }
  })

  it('traduce cómo llegar, la nota de horario y la advertencia donde el original las tiene', () => {
    for (const parche of PARCHES) {
      const t = PARCHES_EN[parche.id]
      expect(Boolean(t.comoLlegar), `comoLlegar de ${parche.id}`).toBe(Boolean(parche.comoLlegar))
      expect(Boolean(t.notaHorario), `notaHorario de ${parche.id}`).toBe(Boolean(parche.notaHorario))
      // Una advertencia sin traducir dejaría a quien lee en inglés sin el aviso
      // de seguridad, que es justo lo que no se puede perder.
      expect(Boolean(t.advertencia), `advertencia de ${parche.id}`).toBe(Boolean(parche.advertencia))
    }
  })
})
