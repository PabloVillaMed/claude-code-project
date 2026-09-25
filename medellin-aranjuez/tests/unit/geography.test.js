import { describe, expect, it } from 'vitest';
import { GEO_REF, riverX, urbanAmount, valleyAsl, valleyHeight } from '../../src/sim/geography.js';
import { MAP_MAX_X, MAP_MAX_Z, MAP_MIN_X, MAP_MIN_Z, PLAY_BOUNDS, RIVER, backdropHeight, riverDistance, terrainHeight } from '../../src/sim/terrain.js';

const deg = (r) => (r * 180) / Math.PI;
/** Ángulo máximo de elevación del horizonte en un rumbo (0 = norte, 90 = oriente), visto desde el centro. */
function horizonElevation(bearing) {
  let max = -90;
  const b = (bearing * Math.PI) / 180;
  for (let d = 1500; d < 34000; d *= 1.03) {
    const x = Math.sin(b) * d;
    const z = -Math.cos(b) * d;
    max = Math.max(max, deg(Math.atan2(valleyHeight(x, z), d)));
  }
  return max;
}

describe('geografía del valle de Aburrá', () => {
  it('el río va por el fondo y Aranjuez queda en la ladera oriental', () => {
    const river = valleyAsl(riverX(0), 0);
    expect(river).toBeGreaterThan(1440);
    expect(river).toBeLessThan(1480);
    // Aranjuez (oriente del mapa) está entre el río y la montaña.
    expect(valleyAsl(500, -300)).toBeGreaterThan(river + 30);
    expect(valleyAsl(500, -300)).toBeLessThan(1650);
  });

  it('cordillera occidental y oriental a alturas reales', () => {
    // Cuchilla occidental (~2.600-3.000 m) a unos 9-10 km del río.
    expect(valleyAsl(-10000, 0)).toBeGreaterThan(2550);
    expect(valleyAsl(-10000, 0)).toBeLessThan(3150);
    // Santo Domingo (~1.900-2.000 m) y Arví (~2.400 m) al oriente.
    expect(valleyAsl(2500, -300)).toBeGreaterThan(1850);
    expect(valleyAsl(2500, -300)).toBeLessThan(2100);
    expect(valleyAsl(6500, 0)).toBeGreaterThan(2250);
    // El Volador sobresale del fondo del valle y es verde.
    expect(valleyAsl(-2980, 900) - valleyAsl(-2980, 2200)).toBeGreaterThan(90);
    expect(urbanAmount(-2980, 900)).toBe(0);
  });

  it('el horizonte se ve como desde el barrio: montañas a lado y lado, el valle abierto al sur', () => {
    const west = horizonElevation(270);
    const east = horizonElevation(90);
    const south = horizonElevation(180);
    expect(west).toBeGreaterThan(5);
    expect(west).toBeLessThan(11);
    expect(east).toBeGreaterThan(7);
    expect(east).toBeLessThan(14);
    // Hacia el sur el valle sigue largo: la vista es mucho más baja.
    expect(south).toBeLessThan(west - 3);
  });

  it('la ciudad cubre las laderas bajas y el monte las altas', () => {
    let lowUrban = 0;
    let highUrban = 0;
    let lowN = 0;
    let highN = 0;
    for (let x = -12000; x <= 8000; x += 250) {
      for (let z = -8000; z <= 8000; z += 500) {
        const h = valleyAsl(x, z);
        if (h < 1750) {
          lowUrban += urbanAmount(x, z, h);
          lowN++;
        } else if (h > 2300) {
          highUrban += urbanAmount(x, z, h);
          highN++;
        }
      }
    }
    expect(lowUrban / lowN).toBeGreaterThan(0.7);
    expect(highUrban / highN).toBeLessThan(0.02);
  });

  it('el fondo cercano empata con el mapa sin escalones y se funde con el valle', () => {
    // (salvo en el cauce del río, que la física cava y el fondo no)
    const dry = (x, z) => riverDistance(x, z) > RIVER.half + RIVER.bank;
    for (let z = MAP_MIN_Z; z <= MAP_MAX_Z; z += 35) {
      if (!dry(MAP_MIN_X, z) || !dry(MAP_MAX_X, z)) continue;
      expect(backdropHeight(MAP_MIN_X, z)).toBeCloseTo(terrainHeight(MAP_MIN_X, z), 6);
      expect(backdropHeight(MAP_MAX_X, z)).toBeCloseTo(terrainHeight(MAP_MAX_X, z), 6);
      // Lejos del mapa es exactamente la geografía del valle (la del horizonte).
      expect(backdropHeight(MAP_MIN_X - 500, z)).toBeCloseTo(valleyHeight(MAP_MIN_X - 500, z), 6);
    }
    // En toda el área jugable el suelo dibujado es el mismo de la física.
    for (let x = PLAY_BOUNDS.minX; x <= PLAY_BOUNDS.maxX; x += 13) {
      for (const z of [PLAY_BOUNDS.minZ, 0, PLAY_BOUNDS.maxZ]) if (dry(x, z)) expect(backdropHeight(x, z)).toBe(terrainHeight(x, z));
    }
    // Sin saltos: la pendiente del fondo es razonable en todo el borde.
    for (let x = MAP_MIN_X - 600; x < MAP_MIN_X; x += 5) {
      expect(Math.abs(backdropHeight(x + 5, 0) - backdropHeight(x, 0))).toBeLessThan(2.5);
    }
    for (let x = MAP_MAX_X; x < MAP_MAX_X + 600; x += 5) {
      expect(Math.abs(backdropHeight(x + 5, 0) - backdropHeight(x, 0))).toBeLessThan(2.5);
    }
    expect(GEO_REF).toBeGreaterThan(1400);
  });
});
