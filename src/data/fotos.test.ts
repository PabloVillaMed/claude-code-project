import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { FOTOS, fotosDe } from './fotos'
import { PARCHES } from './parches'

const IDS = new Set(PARCHES.map((p) => p.id))

describe('fotos', () => {
  it('solo tiene fotos de parches que existen', () => {
    for (const id of Object.keys(FOTOS)) {
      expect(IDS.has(id), `${id} no está en el catálogo`).toBe(true)
    }
  })

  it('cada archivo referenciado está empaquetado', () => {
    // Sin esta comprobación, una descarga fallida deja la app pidiendo una
    // imagen que no existe y la tarjeta se queda en blanco.
    for (const [id, fotos] of Object.entries(FOTOS)) {
      for (const foto of fotos) {
        expect(existsSync(`public/${foto.archivo}`), `falta public/${foto.archivo} (${id})`).toBe(true)
      }
    }
  })

  it('numera los archivos de cada parche sin huecos', () => {
    for (const [id, fotos] of Object.entries(FOTOS)) {
      fotos.forEach((foto, i) => {
        expect(foto.archivo, id).toBe(`fotos/${id}-${i + 1}.webp`)
      })
    }
  })

  it('toda foto lleva autor, licencia y página de origen', () => {
    for (const [id, fotos] of Object.entries(FOTOS)) {
      for (const foto of fotos) {
        expect(foto.autor.trim().length, id).toBeGreaterThan(0)
        expect(foto.licencia.trim().length, id).toBeGreaterThan(0)
        expect(foto.licenciaUrl.startsWith('http'), `${id}: ${foto.licenciaUrl}`).toBe(true)
        expect(foto.pagina.startsWith('https://commons.wikimedia.org/'), `${id}: ${foto.pagina}`).toBe(true)
      }
    }
  })

  it('no repite la misma foto dentro de un parche', () => {
    for (const [id, fotos] of Object.entries(FOTOS)) {
      const paginas = fotos.map((f) => f.pagina)
      expect(new Set(paginas).size, id).toBe(paginas.length)
    }
  })

  it('devuelve lista vacía para un parche sin fotos', () => {
    expect(fotosDe('no-existe')).toEqual([])
  })
})
