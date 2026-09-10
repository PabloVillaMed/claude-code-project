/** Mesa de bingo de noche: fieltro, papel impreso, tinta y latón. */
export const c = {
  felt: '#123C2E',
  feltDeep: '#0B2A20',
  feltEdge: '#1B5140',
  paper: '#F5EFE0',
  paperShade: '#E4DAC4',
  ink: '#1B2018',
  inkSoft: '#6B6858',
  carmin: '#C42A3F',
  laton: '#E0A93B',
  latonDeep: '#A97722',
} as const;

export const type = {
  slab: 'AlfaSlabOne_400Regular',
  ui: 'Archivo_600SemiBold',
  uiBold: 'Archivo_700Bold',
} as const;

export const space = (n: number) => n * 4;
