import { describe, it, expect } from 'vitest';
import {
  generateCard, columnOf, columnRange, cardRow, cardNumbers,
  COLS, ROWS, PER_ROW, NUMBERS_PER_CARD,
} from '../card';

const SEEDS = Array.from({ length: 500 }, (_, i) => `ronda-${i}-jugador-${i * 7}`);

describe('generateCard: invariantes del cartón de 90 bolas', () => {
  it('tiene 27 celdas y exactamente 15 números', () => {
    for (const seed of SEEDS) {
      const card = generateCard(seed);
      expect(card).toHaveLength(COLS * ROWS);
      expect(cardNumbers(card)).toHaveLength(NUMBERS_PER_CARD);
    }
  });

  it('tiene exactamente 5 números en cada fila', () => {
    for (const seed of SEEDS) {
      const card = generateCard(seed);
      for (let row = 0; row < ROWS; row++) {
        expect(cardRow(card, row).filter((n) => n !== 0)).toHaveLength(PER_ROW);
      }
    }
  });

  it('tiene entre 1 y 3 números en cada columna, nunca 0', () => {
    for (const seed of SEEDS) {
      const card = generateCard(seed);
      for (let col = 0; col < COLS; col++) {
        const n = [0, 1, 2].filter((row) => card[row * COLS + col] !== 0).length;
        expect(n).toBeGreaterThanOrEqual(1);
        expect(n).toBeLessThanOrEqual(3);
      }
    }
  });

  it('coloca cada número en la columna que le corresponde', () => {
    for (const seed of SEEDS) {
      const card = generateCard(seed);
      for (let col = 0; col < COLS; col++) {
        const [lo, hi] = columnRange(col);
        for (let row = 0; row < ROWS; row++) {
          const n = card[row * COLS + col];
          if (n === 0) continue;
          expect(columnOf(n)).toBe(col);
          expect(n).toBeGreaterThanOrEqual(lo);
          expect(n).toBeLessThanOrEqual(hi);
        }
      }
    }
  });

  it('ordena cada columna de arriba abajo', () => {
    for (const seed of SEEDS) {
      const card = generateCard(seed);
      for (let col = 0; col < COLS; col++) {
        const colNums = [0, 1, 2].map((r) => card[r * COLS + col]).filter((n) => n !== 0);
        expect(colNums).toEqual([...colNums].sort((a, b) => a - b));
      }
    }
  });

  it('nunca repite un número dentro del cartón', () => {
    for (const seed of SEEDS) {
      const nums = cardNumbers(generateCard(seed));
      expect(new Set(nums).size).toBe(nums.length);
    }
  });

  it('es determinista: misma semilla, mismo cartón', () => {
    expect(generateCard('sala-1')).toEqual(generateCard('sala-1'));
    expect(generateCard('sala-1')).not.toEqual(generateCard('sala-2'));
  });
});
