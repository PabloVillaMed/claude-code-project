// Calentamiento de programas (render/warmupSamples.js) y cupos de la rumba de la 92.
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { pinPrograms, revealHidden } from '../../src/render/warmupSamples.js';
import { cupoRumba, parejasRumba } from '../../src/sim/nightlife.js';

describe('calentamiento: lo oculto se compila', () => {
  it('revealHidden muestra lo oculto sin luces y lo vuelve a ocultar', () => {
    const scene = new THREE.Scene();
    const box = () => new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
    const oculto = box();
    oculto.visible = false;
    const grupo = new THREE.Group();
    grupo.visible = false;
    const hijo = box();
    grupo.add(hijo);
    // Un grupo oculto con una luz no se muestra: cambiaría la clave de los programas.
    const conLuz = new THREE.Group();
    conLuz.visible = false;
    conLuz.add(new THREE.PointLight(), box());
    const visible = box();
    scene.add(oculto, grupo, conLuz, visible);
    const hide = revealHidden(scene);
    expect(oculto.visible).toBe(true);
    expect(grupo.visible).toBe(true);
    expect(conLuz.visible).toBe(false);
    hide();
    expect(oculto.visible).toBe(false);
    expect(grupo.visible).toBe(false);
    expect(visible.visible).toBe(true);
  });

  it('pinPrograms suma un uso a cada programa una sola vez', () => {
    const progs = [{ usedTimes: 1 }, { usedTimes: 3 }];
    const renderer = { info: { programs: progs } };
    expect(pinPrograms(renderer)).toBe(2);
    pinPrograms(renderer);
    expect(progs.map((p) => p.usedTimes)).toEqual([2, 4]);
  });
});

describe('rumba de la 92: abundante', () => {
  it('Alta tiene al menos 34 personas y Ultra 44 (parejas: dos cada una)', () => {
    const total = (peds) => cupoRumba(peds, 1) + 2 * parejasRumba(peds, 1);
    expect(total(44)).toBeGreaterThanOrEqual(34);
    expect(total(56)).toBeGreaterThanOrEqual(44);
    expect(parejasRumba(44, 1)).toBeGreaterThanOrEqual(5);
    expect(parejasRumba(56, 1)).toBeGreaterThanOrEqual(5);
  });
});
