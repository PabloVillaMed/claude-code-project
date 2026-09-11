import { useMemo } from 'react'
import { generarLadera } from '../lib/ladera'

interface LaderaProps {
  /** Semilla: la misma clave dibuja siempre la misma ladera. */
  clave: string
  ancho: number
  alto: number
  paso?: number
  minAlto?: number
  conVentanas?: boolean
  /** Colores de las casas, en orden. */
  paleta: string[]
  colorVentana?: string
  /** Redondeo de las casas. Con 0 quedan en esquina viva. */
  radio?: number
  className?: string
}

/**
 * Franja de casas de colores trepando el cerro. Es el motivo de la app: se usa
 * grande en la cabecera y pequena en los parches que no tienen fotografia.
 */
export function Ladera({
  clave,
  ancho,
  alto,
  paso,
  minAlto,
  conVentanas = true,
  paleta,
  colorVentana = 'rgba(20, 35, 26, 0.45)',
  radio = 3,
  className,
}: LaderaProps) {
  const bloques = useMemo(
    () => generarLadera(clave, { ancho, alto, paso, minAlto, colores: paleta.length, conVentanas }),
    [clave, ancho, alto, paso, minAlto, paleta.length, conVentanas],
  )

  return (
    <svg
      className={className}
      viewBox={`0 0 ${ancho} ${alto}`}
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
    >
      {bloques.map((bloque, i) => (
        <g key={i}>
          {/*
            Solo se redondea el tejado. Como <rect> no admite un radio por
            esquina, la casa se dibuja mas alta y lo que sobra por abajo cae
            fuera del viewBox: asi las esquinas de abajo quedan en angulo recto
            y las casas se apoyan en el suelo.
          */}
          <rect
            x={bloque.x}
            y={alto - bloque.alto}
            width={bloque.ancho}
            height={bloque.alto + radio}
            rx={radio}
            fill={paleta[bloque.color]}
          />
          {bloque.ventanas.map((ventana, j) => (
            <rect
              key={j}
              x={bloque.x + ventana.x}
              y={alto - bloque.alto + ventana.y}
              width={4}
              height={5}
              fill={colorVentana}
            />
          ))}
        </g>
      ))}
    </svg>
  )
}
