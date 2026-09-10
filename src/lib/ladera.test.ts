import { describe, expect, it } from 'vitest'
import { generarLadera } from './ladera'

describe('generarLadera', () => {
  const opciones = { ancho: 300, alto: 100, colores: 5 }

  it('da siempre la misma ladera para la misma clave', () => {
    expect(generarLadera('parque-arvi', opciones)).toEqual(generarLadera('parque-arvi', opciones))
  })

  it('da laderas distintas para claves distintas', () => {
    expect(generarLadera('parque-arvi', opciones)).not.toEqual(generarLadera('la-romera', opciones))
  })

  it('cubre todo el ancho pedido', () => {
    const bloques = generarLadera('x', opciones)
    const ultimo = bloques[bloques.length - 1]
    expect(ultimo.x + ultimo.ancho).toBeGreaterThanOrEqual(opciones.ancho)
  })

  it('mantiene las casas dentro del alto y de la paleta', () => {
    for (const bloque of generarLadera('y', opciones)) {
      expect(bloque.alto).toBeGreaterThan(0)
      expect(bloque.alto).toBeLessThanOrEqual(opciones.alto)
      expect(bloque.color).toBeGreaterThanOrEqual(0)
      expect(bloque.color).toBeLessThan(opciones.colores)
    }
  })

  it('no repite color en dos casas seguidas', () => {
    const bloques = generarLadera('z', opciones)
    for (let i = 1; i < bloques.length; i++) {
      expect(bloques[i].color).not.toBe(bloques[i - 1].color)
    }
  })
})
