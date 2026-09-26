import { describe, expect, it } from 'vitest';
import { StorySystem } from '../../src/game/story.js';
import { CHAPTER_1, STORY_CAST, STORY_LINES } from '../../src/game/storyLines.js';
import { VOICES } from '../../src/game/dialogueLines.js';
import { createMissionDefs } from '../../src/sim/missions.js';
import { city } from './helpers.js';

const kinds = (evs) => evs.map((e) => e.type);

describe('historia: capítulo 1', () => {
  it('las líneas tienen personaje con voz existente e ids únicos', () => {
    const ids = new Set();
    for (const l of STORY_LINES) {
      expect(ids.has(l.id)).toBe(false);
      ids.add(l.id);
      expect(VOICES[STORY_CAST[l.who].voice]).toBeDefined();
    }
  });

  it('la tienda de la abuela y los lugares y misiones de los pasos existen', () => {
    const c = city();
    const defs = createMissionDefs(c);
    expect(c.pois.find((p) => p.id === 'abuela')?.type).toBe('food');
    expect(c.buildings.some((b) => b.local?.name === 'Tienda Doña Rosa')).toBe(true);
    for (const st of CHAPTER_1.steps) {
      if (st.poi) expect(c.pois.some((p) => p.id === st.poi), st.poi).toBe(true);
      if (st.mission) expect(defs[st.mission], st.mission).toBeDefined();
    }
  });

  it('avanza: Don Óscar → juntar la plata → pagarle a la abuela', () => {
    const s = new StorySystem(CHAPTER_1);
    expect(s.update({ completed: new Set(), money: 0 })).toEqual([]); // sin empezar
    s.start();
    const done = new Set();
    let evs = s.update({ completed: done, money: 500 });
    expect(evs[0]).toMatchObject({ type: 'objective', poi: 'mandingas92' });
    expect(s.update({ completed: done, money: 500 })).toEqual([]); // no repite
    done.add('mandingas');
    evs = s.update({ completed: done, money: 1900 });
    expect(s.current.id).toBe('plata');
    expect(evs[0].text).toContain('$1.900');
    // Hablar con la abuela antes de tiempo no cuenta.
    expect(s.talk('abuela', 1900)).toEqual([]);
    s.update({ completed: done, money: 5200 });
    expect(s.current.id).toBe('pagar');
    // Si gasta la plata, vuelve a juntarla.
    s.update({ completed: done, money: 4000 });
    expect(s.current.id).toBe('plata');
    s.update({ completed: done, money: 6000 });
    expect(kinds(s.talk('parque', 6000))).toEqual([]);
    expect(kinds(s.talk('abuela', 6000))).toEqual(['pay', 'chapterEnd']);
    expect(s.done).toBe(true);
    expect(s.current).toBeNull();
  });

  it('se guarda y se recupera', () => {
    const s = new StorySystem(CHAPTER_1);
    s.start();
    s.update({ completed: new Set(['mandingas']), money: 0 });
    const t = new StorySystem(CHAPTER_1);
    t.restore(JSON.parse(JSON.stringify(s.serialize())));
    expect(t.current.id).toBe('plata');
  });
});
