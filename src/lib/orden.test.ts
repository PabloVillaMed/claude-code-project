import { describe, expect, it } from 'vitest'
import { ordenarParches } from './orden'
import type { Parche } from '../types'

function parche(id: string, nombre: string, presupuesto: Parche['presupuesto']): Parche {
  return {
    id,
    nombre,
    municipio: 'Medellin',
    sector: 'Centro',
    categorias: ['parque'],
    presupuesto,
    momentos: ['tarde'],
    ambiente: ['tranquilo'],
    accesibilidad: {
      movilidadReducida: false,
      cercaAlMetro: false,
      aptoNinos: false,
      petFriendly: false,
      lgbtiqFriendly: false,
      sinAlcohol: false,
    },
    descripcion: '',
    horarios: [{ dia: 3, abre: '09:00', cierra: '17:00' }],
    consultaMapa: nombre,
  }
}

const LISTA = [parche('c', 'Cerro', '$$$'), parche('a', 'Arví', 'gratis'), parche('b', 'Bosque', '$')]

describe('ordenarParches', () => {
  it('deja el orden del catálogo en sugeridos', () => {
    expect(ordenarParches(LISTA, 'sugeridos', {}).map((p) => p.id)).toEqual(['c', 'a', 'b'])
  })

  it('ordena por nombre respetando el alfabeto español', () => {
    expect(ordenarParches(LISTA, 'nombre', {}).map((p) => p.id)).toEqual(['a', 'b', 'c'])
  })

  it('pone lo más barato primero', () => {
    expect(ordenarParches(LISTA, 'presupuesto', {}).map((p) => p.id)).toEqual(['a', 'b', 'c'])
  })

  it('ordena por tu puntuación y manda los sin puntuar al final', () => {
    const puntuaciones = { b: 5, c: 3 }
    expect(ordenarParches(LISTA, 'puntuacion', puntuaciones).map((p) => p.id)).toEqual(['b', 'c', 'a'])
  })

  it('no modifica la lista original', () => {
    const copia = [...LISTA]
    ordenarParches(LISTA, 'nombre', {})
    expect(LISTA).toEqual(copia)
  })
})
