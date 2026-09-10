import { describe, expect, it } from 'vitest'
import { aplicarPuntuacion } from './puntuaciones'

describe('aplicarPuntuacion', () => {
  it('guarda una puntuación nueva', () => {
    expect(aplicarPuntuacion({}, 'x', 4)).toEqual({ x: 4 })
  })

  it('cambia una puntuación existente', () => {
    expect(aplicarPuntuacion({ x: 2 }, 'x', 5)).toEqual({ x: 5 })
  })

  it('quita la puntuación al tocar la misma estrella', () => {
    expect(aplicarPuntuacion({ x: 3 }, 'x', 3)).toEqual({})
  })

  it('no toca las demás', () => {
    expect(aplicarPuntuacion({ x: 3, y: 1 }, 'x', 3)).toEqual({ y: 1 })
  })
})
