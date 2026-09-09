import { describe, expect, it } from 'vitest'
import {
  alternar,
  coincide,
  contarFiltrosActivos,
  filtrarParches,
  FILTROS_VACIOS,
  normalizar,
  parcheAlAzar,
} from './filtros'
import type { Filtros } from './filtros'
import { PARCHES } from '../data/parches'
import type { Parche } from '../types'

function base(cambios: Partial<Parche> = {}): Parche {
  return {
    id: 'demo',
    nombre: 'Parque Demo',
    municipio: 'Medellin',
    sector: 'Laureles',
    categorias: ['parque'],
    presupuesto: 'gratis',
    momentos: ['tarde'],
    ambiente: ['tranquilo'],
    accesibilidad: {
      movilidadReducida: true,
      cercaAlMetro: true,
      aptoNinos: false,
      petFriendly: false,
      lgbtiqFriendly: true,
      sinAlcohol: false,
    },
    descripcion: 'Un parque con arboles y bancas',
    horarios: [{ dia: 3, abre: '09:00', cierra: '17:00' }],
    consultaMapa: 'Parque Demo',
    ...cambios,
  }
}

function con(cambios: Partial<Filtros>): Filtros {
  return { ...FILTROS_VACIOS, ...cambios }
}

describe('normalizar', () => {
  it('quita tildes, espacios y mayusculas', () => {
    expect(normalizar('  Medellín ')).toBe('medellin')
    expect(normalizar('Jardín Botánico')).toBe('jardin botanico')
  })
})

describe('coincide', () => {
  it('acepta todo cuando no hay filtros', () => {
    expect(coincide(base(), FILTROS_VACIOS)).toBe(true)
  })

  it('busca sin importar tildes ni mayusculas', () => {
    expect(coincide(base({ nombre: 'Jardín Botánico' }), con({ busqueda: 'JARDIN' }))).toBe(true)
    expect(coincide(base(), con({ busqueda: 'discoteca' }))).toBe(false)
  })

  it('busca tambien en descripcion, sector y etiquetas', () => {
    expect(coincide(base(), con({ busqueda: 'bancas' }))).toBe(true)
    expect(coincide(base(), con({ busqueda: 'laureles' }))).toBe(true)
    expect(coincide(base(), con({ busqueda: 'tranquilo' }))).toBe(true)
  })

  it('filtra por municipio', () => {
    expect(coincide(base(), con({ municipios: ['Envigado'] }))).toBe(false)
    expect(coincide(base(), con({ municipios: ['Medellin', 'Envigado'] }))).toBe(true)
  })

  it('usa OR entre categorias', () => {
    const p = base({ categorias: ['parque', 'naturaleza'] })
    expect(coincide(p, con({ categorias: ['rumba', 'naturaleza'] }))).toBe(true)
    expect(coincide(p, con({ categorias: ['rumba'] }))).toBe(false)
  })

  it('usa AND entre requisitos de accesibilidad', () => {
    const p = base()
    expect(coincide(p, con({ accesos: ['movilidadReducida', 'cercaAlMetro'] }))).toBe(true)
    expect(coincide(p, con({ accesos: ['movilidadReducida', 'petFriendly'] }))).toBe(false)
  })

  it('filtra por presupuesto exacto', () => {
    expect(coincide(base({ presupuesto: '$$' }), con({ presupuestos: ['gratis', '$'] }))).toBe(false)
    expect(coincide(base({ presupuesto: '$$' }), con({ presupuestos: ['$$'] }))).toBe(true)
  })

  it('respeta solo abiertos segun la hora consultada', () => {
    const p = base()
    const miercolesMediodia = new Date(2026, 8, 9, 12, 0)
    const miercolesDeNoche = new Date(2026, 8, 9, 22, 0)
    expect(coincide(p, con({ soloAbiertos: true }), { ahora: miercolesMediodia })).toBe(true)
    expect(coincide(p, con({ soloAbiertos: true }), { ahora: miercolesDeNoche })).toBe(false)
  })

  it('respeta solo favoritos', () => {
    const p = base()
    expect(coincide(p, con({ soloFavoritos: true }), { favoritos: new Set() })).toBe(false)
    expect(coincide(p, con({ soloFavoritos: true }), { favoritos: new Set(['demo']) })).toBe(true)
  })

  it('combina varios criterios a la vez', () => {
    const p = base({ municipio: 'Envigado', presupuesto: '$', categorias: ['comida'] })
    const filtros = con({ municipios: ['Envigado'], presupuestos: ['$'], categorias: ['comida'] })
    expect(coincide(p, filtros)).toBe(true)
    expect(coincide(p, { ...filtros, presupuestos: ['gratis'] })).toBe(false)
  })
})

describe('filtrarParches', () => {
  it('devuelve el catalogo completo sin filtros', () => {
    expect(filtrarParches(PARCHES, FILTROS_VACIOS)).toHaveLength(PARCHES.length)
  })

  it('encuentra planes gratis en el catalogo real', () => {
    const gratis = filtrarParches(PARCHES, con({ presupuestos: ['gratis'] }))
    expect(gratis.length).toBeGreaterThan(5)
    expect(gratis.every((p) => p.presupuesto === 'gratis')).toBe(true)
  })

  it('encuentra parches fuera de Medellin', () => {
    const cercanos = filtrarParches(PARCHES, con({ municipios: ['Envigado', 'Sabaneta', 'Itagui'] }))
    expect(cercanos.length).toBeGreaterThan(0)
    expect(cercanos.some((p) => p.municipio === 'Sabaneta')).toBe(true)
  })
})

describe('contarFiltrosActivos', () => {
  it('no cuenta nada cuando esta vacio', () => {
    expect(contarFiltrosActivos(FILTROS_VACIOS)).toBe(0)
  })

  it('suma cada criterio activo', () => {
    const filtros = con({ busqueda: 'cafe', municipios: ['Medellin'], accesos: ['aptoNinos'], soloAbiertos: true })
    expect(contarFiltrosActivos(filtros)).toBe(4)
  })

  it('ignora una busqueda de solo espacios', () => {
    expect(contarFiltrosActivos(con({ busqueda: '   ' }))).toBe(0)
  })
})

describe('alternar', () => {
  it('agrega el valor si no esta y lo quita si esta', () => {
    expect(alternar<string>([], 'a')).toEqual(['a'])
    expect(alternar(['a', 'b'], 'a')).toEqual(['b'])
  })
})

describe('parcheAlAzar', () => {
  it('devuelve null sin resultados', () => {
    expect(parcheAlAzar([])).toBeNull()
  })

  it('elige segun la funcion aleatoria dada', () => {
    const lista = [base({ id: 'a' }), base({ id: 'b' }), base({ id: 'c' })]
    expect(parcheAlAzar(lista, () => 0)?.id).toBe('a')
    expect(parcheAlAzar(lista, () => 0.99)?.id).toBe('c')
  })
})

describe('catalogo', () => {
  it('no tiene ids repetidos', () => {
    const ids = PARCHES.map((p) => p.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('tiene los campos minimos para mostrarse', () => {
    for (const p of PARCHES) {
      expect(p.nombre.length, p.id).toBeGreaterThan(0)
      expect(p.descripcion.length, p.id).toBeGreaterThan(20)
      expect(p.categorias.length, p.id).toBeGreaterThan(0)
      expect(p.ambiente.length, p.id).toBeGreaterThan(0)
      expect(p.horarios.length, p.id).toBeGreaterThan(0)
      expect(p.consultaMapa.length, p.id).toBeGreaterThan(0)
    }
  })

  it('usa horas validas en formato HH:MM', () => {
    for (const p of PARCHES) {
      for (const h of p.horarios) {
        expect(h.abre, p.id).toMatch(/^([01]\d|2[0-3]):[0-5]\d$/)
        expect(h.cierra, p.id).toMatch(/^([01]\d|2[0-3]):[0-5]\d$/)
      }
    }
  })
})
