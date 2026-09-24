import { describe, expect, it } from 'vitest';
import { parseCredits } from '../../src/ui/credits.js';

describe('créditos dentro del juego', () => {
  it('lista todos los recursos y los CC-BY llevan autor y enlace', () => {
    const sections = parseCredits();
    const rows = sections.flatMap((s) => s.rows);
    expect(rows.length).toBeGreaterThan(40);
    const ccby = rows.filter((r) => /CC-BY|CC BY/i.test(r.license));
    expect(ccby.length).toBeGreaterThan(0);
    for (const r of ccby) {
      expect(r.author.length).toBeGreaterThan(1);
      expect(r.source).toMatch(/https?:\/\//);
    }
    // Los datos geográficos (OpenStreetMap, ODbL) también se reconocen.
    expect(rows.some((r) => /OpenStreetMap/.test(r.name) && /ODbL/.test(r.license))).toBe(true);
  });
});
