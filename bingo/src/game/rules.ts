import { COLS, ROWS, PER_ROW, type Card, cardRow, cardNumbers } from './card';

export type ClaimKind = 'line' | 'double_line' | 'bingo';

/** Índices de fila completadas con las bolas ya cantadas. */
export function completedRows(card: Card, drawn: ReadonlySet<number>): number[] {
  const out: number[] = [];
  for (let row = 0; row < ROWS; row++) {
    const nums = cardRow(card, row).filter((n) => n !== 0);
    if (nums.length === PER_ROW && nums.every((n) => drawn.has(n))) out.push(row);
  }
  return out;
}

/** Cuántas bolas del cartón han salido ya. */
export function markedCount(card: Card, drawn: ReadonlySet<number>): number {
  return cardNumbers(card).filter((n) => drawn.has(n)).length;
}

/**
 * ¿El cartón cumple ya este canto?
 * Autoridad real: la misma regla vive en SQL. Esto solo habilita el botón.
 */
export function satisfies(card: Card, drawn: ReadonlySet<number>, kind: ClaimKind): boolean {
  const rows = completedRows(card, drawn).length;
  if (kind === 'line') return rows >= 1;
  if (kind === 'double_line') return rows >= 2;
  return rows === ROWS;
}

/** Qué puede cantar ahora, descontando lo ya reclamado por alguien. */
export function availableClaims(
  card: Card,
  drawn: ReadonlySet<number>,
  taken: { line: boolean; double_line: boolean; bingo: boolean },
): ClaimKind[] {
  const kinds: ClaimKind[] = ['line', 'double_line', 'bingo'];
  return kinds.filter((k) => !taken[k] && satisfies(card, drawn, k));
}

export const CELLS = COLS * ROWS;
