import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { LINES, VOICES, CIVIL_VOICES, VENDOR_KINDS, CONVERSATIONS, voiceFile } from '../../src/game/dialogueLines.js';
import { LinePicker, Cooldowns, Emitter, hashId, voiceForPed, inHours, voiceGain, estimateSeconds } from '../../src/game/dialogue.js';

/** Aleatorio con semilla (mulberry32). */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('líneas de diálogo', () => {
  it('ids únicos, texto y voces existentes', () => {
    const ids = new Set();
    for (const l of LINES) {
      expect(ids.has(l.id)).toBe(false);
      ids.add(l.id);
      expect(l.text.length).toBeGreaterThan(3);
      expect(l.voices.length).toBeGreaterThan(0);
      for (const v of l.voices) expect(VOICES[v]).toBeDefined();
    }
    expect(LINES.length).toBeGreaterThanOrEqual(120);
    expect(LINES.length).toBeLessThanOrEqual(200);
  });

  it('cada ventero tiene pregones y cada voz del barrio tiene de todo', () => {
    for (const k of VENDOR_KINDS) expect(LINES.filter((l) => l.cat === 'pregon' && l.kind === k).length).toBeGreaterThanOrEqual(3);
    for (const v of CIVIL_VOICES) {
      for (const cat of ['saludo', 'empujon', 'carro', 'disparos', 'apuntado', 'muerte', 'golpe']) {
        expect(LINES.some((l) => l.cat === cat && l.voices.includes(v)), `${cat}/${v}`).toBe(true);
      }
    }
  });

  it('las charlas alternan A/B en orden', () => {
    const p = new LinePicker();
    for (let n = 0; n < CONVERSATIONS; n++) {
      const c = p.conversation(n);
      expect(c.length).toBeGreaterThanOrEqual(2);
      expect(c.length).toBeLessThanOrEqual(4);
      c.forEach((l, k) => expect(l.role).toBe(k % 2 ? 'B' : 'A'));
    }
  });

  it('el audio generado (si está) cubre todas las líneas y voces', () => {
    const file = path.resolve('public/sounds/voces/manifest.json');
    if (!fs.existsSync(file)) return;
    const m = JSON.parse(fs.readFileSync(file, 'utf8'));
    for (const l of LINES) {
      for (const v of l.voices) {
        const key = `${l.id}-${v}`;
        expect(m.files[key], key).toBeGreaterThan(0.4);
        expect(fs.existsSync(path.resolve('public', voiceFile(l.id, v))), key).toBe(true);
      }
    }
  });
});

describe('LinePicker', () => {
  it('nunca repite seguida la misma línea de una categoría', () => {
    const p = new LinePicker();
    const r = rng(1);
    for (const cat of ['saludo', 'empujon', 'disparos', 'policia_alto']) {
      let prev = null;
      for (let i = 0; i < 200; i++) {
        const voice = cat.startsWith('policia') ? (i % 2 ? 'p1' : 'p2') : CIVIL_VOICES[i % CIVIL_VOICES.length];
        const l = p.pick(cat, { voice }, r);
        expect(l).not.toBeNull();
        expect(l.id).not.toBe(prev);
        expect(l.voices).toContain(voice);
        prev = l.id;
      }
    }
  });

  it('recorre variedad antes de repetir (misma voz)', () => {
    const p = new LinePicker();
    const r = rng(7);
    const c = p.candidates('saludo', { voice: 'h1', hour: 10 });
    const seen = [];
    for (let i = 0; i < Math.ceil(c.length * 0.6); i++) seen.push(p.pick('saludo', { voice: 'h1', hour: 10 }, r).id);
    expect(new Set(seen).size).toBe(seen.length);
  });

  it('respeta la hora y el tipo de ventero', () => {
    const p = new LinePicker();
    const r = rng(3);
    for (let i = 0; i < 60; i++) {
      const night = p.pick('saludo', { hour: 22 }, r);
      expect(inHours(night.hours, 22)).toBe(true);
      expect(night.text).not.toMatch(/Buenos días/);
      const m = p.pick('pregon', { kind: 'mangos' }, r);
      expect(m.kind).toBe('mangos');
    }
  });

  it('una categoría con una sola línea igual responde', () => {
    const p = new LinePicker([{ id: 'x', cat: 'solo', text: 'Hola', voices: ['h1'] }]);
    expect(p.pick('solo', {}).id).toBe('x');
    expect(p.pick('solo', {}).id).toBe('x');
    expect(p.pick('nada', {})).toBeNull();
  });

  it('las charlas no se repiten hasta haber oído la mayoría', () => {
    const p = new LinePicker();
    const r = rng(11);
    const got = [];
    for (let i = 0; i < Math.floor((CONVERSATIONS * 2) / 3); i++) got.push(p.pickConversation(r));
    expect(new Set(got).size).toBe(got.length);
  });
});

describe('Cooldowns', () => {
  it('bloquea hasta que vence y no se acorta', () => {
    const c = new Cooldowns();
    expect(c.ready('saludo', 0)).toBe(true);
    c.set('saludo', 0, 10);
    expect(c.ready('saludo', 5)).toBe(false);
    c.set('saludo', 5, 1); // no acorta
    expect(c.ready('saludo', 8)).toBe(false);
    expect(c.ready('saludo', 10)).toBe(true);
    c.prune(11);
    expect(c.until.size).toBe(0);
  });
});

describe('voces y utilidades', () => {
  it('la voz de un peatón es estable y según su género', () => {
    for (let id = 0; id < 200; id++) {
      const f = voiceForPed({ id, faction: 'civil', look: { female: true } });
      const m = voiceForPed({ id, faction: 'civil', look: { female: false } });
      expect(VOICES[f].gender).toBe('f');
      expect(VOICES[m].gender).toBe('m');
      expect(voiceForPed({ id, faction: 'civil', look: { female: true } })).toBe(f);
      expect(voiceForPed({ id, faction: 'police' })).toMatch(/^p/);
    }
    const counts = {};
    for (let id = 0; id < 600; id++) counts[voiceForPed({ id, faction: 'civil', look: { female: false } })] = 1 + (counts[voiceForPed({ id, faction: 'civil', look: { female: false } })] ?? 0);
    for (const n of Object.values(counts)) expect(n).toBeGreaterThan(120);
    expect(hashId(5)).toBe(hashId(5));
  });

  it('horas que cruzan la medianoche', () => {
    expect(inHours([18.5, 29], 23)).toBe(true);
    expect(inHours([18.5, 29], 2)).toBe(true);
    expect(inHours([18.5, 29], 12)).toBe(false);
    expect(inHours(null, 3)).toBe(true);
  });

  it('ganancia por distancia: llena cerca, cero fuera del radio', () => {
    expect(voiceGain(2, 5, 20)).toBe(1);
    expect(voiceGain(10, 5, 20)).toBeCloseTo(0.5);
    expect(voiceGain(20, 5, 20)).toBe(0);
    expect(voiceGain(19, 5, 20)).toBeLessThan(voiceGain(15, 5, 20));
    expect(estimateSeconds('Hola')).toBeGreaterThan(0.6);
  });

  it('Emitter: on/off/emit y errores aislados', () => {
    const e = new Emitter();
    const got = [];
    const off = e.on('shot', (d) => got.push(d.x));
    e.on('shot', () => {
      throw new Error('x');
    });
    const err = console.error;
    console.error = () => {};
    e.emit('shot', { x: 1 });
    off();
    e.emit('shot', { x: 2 });
    console.error = err;
    expect(got).toEqual([1]);
  });
});
