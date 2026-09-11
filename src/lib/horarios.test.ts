import { describe, expect, it } from 'vitest'
import { aMinutos, estaAbierto, resumirHorarios } from './horarios'
import { ES } from '../i18n/es'
import { EN } from '../i18n/en'
import type { Horario, Parche } from '../types'

function parcheCon(horarios: Horario[]): Parche {
  return {
    id: 'x',
    nombre: 'X',
    municipio: 'Medellin',
    sector: 'Centro',
    categorias: ['parque'],
    presupuesto: 'gratis',
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
    horarios,
    consultaMapa: 'X',
  }
}

/** Miercoles 2026-09-09 a la hora indicada. */
function miercolesA(hora: number, minuto = 0): Date {
  return new Date(2026, 8, 9, hora, minuto)
}

describe('aMinutos', () => {
  it('convierte HH:MM a minutos desde medianoche', () => {
    expect(aMinutos('00:00')).toBe(0)
    expect(aMinutos('08:30')).toBe(510)
    expect(aMinutos('23:59')).toBe(1439)
  })
})

describe('estaAbierto', () => {
  it('reconoce una franja normal del mismo dia', () => {
    const p = parcheCon([{ dia: 3, abre: '09:00', cierra: '17:00' }])
    expect(estaAbierto(p, miercolesA(12))).toBe(true)
    expect(estaAbierto(p, miercolesA(8))).toBe(false)
    expect(estaAbierto(p, miercolesA(17))).toBe(false)
  })

  it('ignora franjas de otros dias', () => {
    const p = parcheCon([{ dia: 1, abre: '09:00', cierra: '17:00' }])
    expect(estaAbierto(p, miercolesA(12))).toBe(false)
  })

  it('maneja franjas que cruzan la medianoche', () => {
    // Martes de 20:00 a 03:00: el miercoles a la 01:00 sigue abierto.
    const p = parcheCon([{ dia: 2, abre: '20:00', cierra: '03:00' }])
    expect(estaAbierto(p, miercolesA(1))).toBe(true)
    expect(estaAbierto(p, miercolesA(4))).toBe(false)
    expect(estaAbierto(p, miercolesA(21))).toBe(false)
  })

  it('cubre el domingo hacia el lunes al cruzar la medianoche', () => {
    const p = parcheCon([{ dia: 0, abre: '22:00', cierra: '02:00' }])
    const lunesADeMadrugada = new Date(2026, 8, 14, 1, 0)
    expect(lunesADeMadrugada.getDay()).toBe(1)
    expect(estaAbierto(p, lunesADeMadrugada)).toBe(true)
  })
})

describe('resumirHorarios', () => {
  it('describe el espacio publico permanente', () => {
    const todos: Horario[] = [0, 1, 2, 3, 4, 5, 6].map((d) => ({
      dia: d as Horario['dia'],
      abre: '00:00',
      cierra: '23:59',
    }))
    expect(resumirHorarios(todos, ES.horario)).toBe('Espacio público, abierto siempre')
    expect(resumirHorarios(todos, EN.horario)).toBe('Public space, always open')
  })

  it('agrupa dias continuos con la misma franja', () => {
    const horarios: Horario[] = [
      { dia: 1, abre: '08:00', cierra: '18:00' },
      { dia: 2, abre: '08:00', cierra: '18:00' },
      { dia: 3, abre: '08:00', cierra: '18:00' },
      { dia: 6, abre: '09:00', cierra: '16:00' },
    ]
    expect(resumirHorarios(horarios, ES.horario)).toBe('Lun a Mié 08:00-18:00 | Sáb 09:00-16:00')
    expect(resumirHorarios(horarios, EN.horario)).toBe('Mon to Wed 08:00-18:00 | Sat 09:00-16:00')
  })

  it('avisa cuando no hay horario', () => {
    expect(resumirHorarios([], ES.horario)).toBe('Sin horario registrado')
    expect(resumirHorarios([], EN.horario)).toBe('No hours on record')
  })
})
