import { useState } from 'react'
import type { Parche } from '../types'
import { rutaFoto } from '../data/fotos'
import { Ladera } from './Ladera'
import { familiaDe } from '../lib/etiquetas'

/** Paleta de las fachadas generadas, por familia del parche. */
const PALETAS: Record<string, string[]> = {
  verde: ['#0B6E3F', '#148950', '#F0B310', '#0A5FA8', '#E0561C'],
  azul: ['#0A5FA8', '#1478C9', '#F0B310', '#C8226A', '#0B6E3F'],
  amarillo: ['#F0B310', '#E0561C', '#0B6E3F', '#0A5FA8', '#C8226A'],
  rosa: ['#C8226A', '#E0561C', '#F0B310', '#0A5FA8', '#0B6E3F'],
  naranja: ['#E0561C', '#F0B310', '#C8226A', '#0B6E3F', '#0A5FA8'],
}

interface ImagenParcheProps {
  parche: Parche
}

/**
 * La foto del parche, o una fachada generada a partir de su id cuando no hay
 * fotografia libre del lugar. No se pone la foto de otro sitio para rellenar.
 */
export function ImagenParche({ parche }: ImagenParcheProps) {
  const [fallo, setFallo] = useState(false)
  const ruta = rutaFoto(parche.id)

  if (ruta && !fallo) {
    return (
      <img
        className="imagen-parche"
        src={ruta}
        alt={`${parche.nombre}, ${parche.sector}`}
        loading="lazy"
        width={640}
        height={360}
        onError={() => setFallo(true)}
      />
    )
  }

  return (
    <div className="imagen-parche imagen-parche--fachada">
      <Ladera
        clave={parche.id}
        ancho={320}
        alto={180}
        paso={30}
        minAlto={0.3}
        paleta={PALETAS[familiaDe(parche)]}
        className="fachada-svg"
      />
    </div>
  )
}
