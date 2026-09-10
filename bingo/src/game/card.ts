import { mulberry32, seedFromString } from './rng';

export const COLS = 9;
export const ROWS = 3;
export const PER_ROW = 5;
export const NUMBERS_PER_CARD = 15;

/** Cartón 9x3 aplanado por filas. 0 = hueco. */
export type Card = number[];

/** Rango de cada columna: col 0 -> 1..9, col 1..7 -> 10..79, col 8 -> 80..90. */
export function columnRange(col: number): [number, number] {
  if (col === 0) return [1, 9];
  if (col === COLS - 1) return [80, 90];
  return [col * 10, col * 10 + 9];
}

export function columnOf(n: number): number {
  if (n <= 9) return 0;
  if (n >= 80) return COLS - 1;
  return Math.floor(n / 10);
}

/** Cuántos números lleva cada columna: 1..3, sumando 15. */
function columnCounts(rnd: () => number): number[] {
  const counts = new Array(COLS).fill(1);
  let left = NUMBERS_PER_CARD - COLS;
  while (left > 0) {
    const c = Math.floor(rnd() * COLS);
    if (counts[c] < ROWS) {
      counts[c]++;
      left--;
    }
  }
  return counts;
}

/**
 * Reparte las columnas en filas dejando exactamente 5 por fila.
 * Greedy por capacidad restante: las columnas de 3 ocupan todo, y el resto
 * elige siempre las filas con más hueco. Con estas cotas siempre hay solución.
 */
function assignRows(counts: number[], rnd: () => number): boolean[][] {
  const mask: boolean[][] = Array.from({ length: COLS }, () => new Array(ROWS).fill(false));
  const capacity = new Array(ROWS).fill(PER_ROW);
  const order = counts
    .map((count, col) => ({ count, col, tie: rnd() }))
    .sort((a, b) => b.count - a.count || a.tie - b.tie);

  for (const { col, count } of order) {
    const rows = capacity
      .map((cap, row) => ({ cap, row, tie: rnd() }))
      .sort((a, b) => b.cap - a.cap || a.tie - b.tie)
      .slice(0, count);
    for (const { row } of rows) {
      mask[col][row] = true;
      capacity[row]--;
    }
  }
  return mask;
}

/** Genera un cartón válido. Misma semilla, mismo cartón. */
export function generateCard(seed: string): Card {
  const rnd = mulberry32(seedFromString(seed));
  const counts = columnCounts(rnd);
  const mask = assignRows(counts, rnd);
  const card: Card = new Array(COLS * ROWS).fill(0);

  for (let col = 0; col < COLS; col++) {
    const [lo, hi] = columnRange(col);
    const pool: number[] = [];
    for (let n = lo; n <= hi; n++) pool.push(n);
    // Fisher-Yates parcial: basta con los primeros counts[col]
    for (let i = 0; i < counts[col]; i++) {
      const j = i + Math.floor(rnd() * (pool.length - i));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    const picked = pool.slice(0, counts[col]).sort((a, b) => a - b);

    let k = 0;
    for (let row = 0; row < ROWS; row++) {
      if (mask[col][row]) card[row * COLS + col] = picked[k++];
    }
  }
  return card;
}

export function cardRow(card: Card, row: number): number[] {
  return card.slice(row * COLS, row * COLS + COLS);
}

export function cardNumbers(card: Card): number[] {
  return card.filter((n) => n !== 0);
}
