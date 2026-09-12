import { describe, expect, it } from 'vitest'
import { PARCHES } from './parches'
import { PARCHES_EN } from './parches-en'

describe('zonas de tolerancia', () => {
  const marcadas = PARCHES.filter((p) => p.toleranciaConsumo)

  it('hay zonas marcadas en el catálogo', () => {
    expect(marcadas.length).toBeGreaterThan(0)
  })

  it('toda zona marcada lleva su nota de antes de ir', () => {
    // Marcar el sitio sin decir qué pasa ahí sería dejar a medias el aviso.
    for (const parche of marcadas) {
      expect(parche.advertencia?.trim().length, parche.id).toBeGreaterThan(20)
      expect(PARCHES_EN[parche.id].advertencia?.trim().length, parche.id).toBeGreaterThan(20)
    }
  })
})

describe('advertencias', () => {
  it('ninguna se queda en un aviso genérico', () => {
    for (const parche of PARCHES) {
      if (!parche.advertencia) continue
      expect(parche.advertencia.length, parche.id).toBeGreaterThan(40)
    }
  })
})
