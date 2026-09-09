interface ChipProps {
  activo: boolean
  onClick: () => void
  children: React.ReactNode
  titulo?: string
}

/** Boton de filtro con estado activo/inactivo. */
export function Chip({ activo, onClick, children, titulo }: ChipProps) {
  return (
    <button
      type="button"
      className={activo ? 'chip chip--activo' : 'chip'}
      onClick={onClick}
      aria-pressed={activo}
      title={titulo}
    >
      {children}
    </button>
  )
}
