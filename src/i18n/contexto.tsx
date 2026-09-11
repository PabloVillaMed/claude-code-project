import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { ES } from './es'
import { EN } from './en'
import { IDIOMAS } from './tipos'
import type { Idioma, Textos } from './tipos'

const TEXTOS: Record<Idioma, Textos> = { es: ES, en: EN }
const CLAVE = 'parches-medellin:idioma'

function esIdioma(valor: unknown): valor is Idioma {
  return typeof valor === 'string' && (IDIOMAS as readonly string[]).includes(valor)
}

/**
 * Idioma inicial: el que se eligió antes, si no el del dispositivo, y si no
 * español, que es el idioma de la ciudad.
 */
function idiomaInicial(): Idioma {
  try {
    const guardado = localStorage.getItem(CLAVE)
    if (esIdioma(guardado)) return guardado
  } catch {
    // Sin almacenamiento se cae al idioma del dispositivo.
  }
  const delSistema = typeof navigator !== 'undefined' ? navigator.language.slice(0, 2) : ''
  return esIdioma(delSistema) ? delSistema : 'es'
}

interface ValorContexto {
  idioma: Idioma
  t: Textos
  cambiarIdioma: (idioma: Idioma) => void
}

const Contexto = createContext<ValorContexto | null>(null)

export function ProveedorIdioma({ children }: { children: React.ReactNode }) {
  const [idioma, setIdioma] = useState<Idioma>(idiomaInicial)

  const cambiarIdioma = useCallback((nuevo: Idioma) => {
    setIdioma(nuevo)
    try {
      localStorage.setItem(CLAVE, nuevo)
    } catch {
      // Sin persistencia: la sesión actual sigue funcionando igual.
    }
  }, [])

  // El atributo lang importa para lectores de pantalla y para la separación
  // silábica del navegador, así que sigue al idioma elegido.
  useEffect(() => {
    document.documentElement.lang = TEXTOS[idioma].meta.htmlLang
    document.title = TEXTOS[idioma].meta.titulo
  }, [idioma])

  const valor = useMemo(() => ({ idioma, t: TEXTOS[idioma], cambiarIdioma }), [idioma, cambiarIdioma])

  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>
}

export function useIdioma(): ValorContexto {
  const valor = useContext(Contexto)
  if (!valor) throw new Error('useIdioma necesita estar dentro de ProveedorIdioma')
  return valor
}
